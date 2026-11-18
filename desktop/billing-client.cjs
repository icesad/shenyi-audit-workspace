'use strict';
const {isProxy}=require('node:util').types;

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BILLING_ROOT='/api/auth/billing/access';
const BILLING_PATH=/^\/api\/teams\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/billing\/(?:overview|reconciliation|(?:orders|seat-orders)(?:\?limit=20(?:&after=([0-9a-f-]{36}))?|\/([0-9a-f-]{36})\/reconcile)?)$/;
const REFUND_ACCESS='/api/auth/refund-intake/access';
const REFUND_PATH=/^\/api\/platform\/billing\/refund-intakes\/(?:annual|seat)\/([0-9a-f-]{36})(?:\?beforeRevision=([1-9][0-9]{0,15}))?$/;
const REFUND_REFERENCE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const INTAKE_REASONS=new Set(['duplicate-payment','purchase-change','service-issue','other']);
const FOLLOW_UP_REASONS=new Set(['payment-checked','details-requested','customer-contacted','other']);
const PAGE_SIZE=20;
const RECONCILIATION_PAGE_SIZE=8;
const MAX_BILLING_BYTES=128*1024;
const PRODUCTS={annual:'team-annual-renewal',seat:'team-seat-addition'};
const SUBSCRIPTION_STATES=new Set(['unconfigured','scheduled','active','expired']);
const ORDER_STATES=new Set(['pending','payment-verified','paid']);
const PAYMENT_EXCEPTION_KINDS=new Set(['refund','chargeback']);
const RECONCILIATION_OUTCOMES=new Set(['no-evidence','matched','awaiting-review','lookup-unavailable','evidence-rejected','local-failure']);
const OFFER_KEYS=['id','revision','product','amountMinor','currency'];
const ORDER_KEYS=['id','teamId','actorId','requestId','merchantId','offer','simulation','createdAt','status','confirmedAt'];
const BILLING_ERRORS=Object.freeze({
  402:{SUBSCRIPTION_WRITE_UNAVAILABLE:'当前订阅期限不支持增购席位。'},
  403:{VERIFICATION_FAILED:'当前密码未通过核验，请重新输入。'},
  409:{
    BILLING_OFFER_CHANGED:'模拟账务方案已改变，请刷新后重新核对。',
    BILLING_RENEWAL_SEATS_RECONCILIATION_REQUIRED:'模拟续费席位无法确认，请核对已使用席位、预留邀请及待处理订单。',
    BILLING_CONFLICT:'模拟订单或收款状态需要核对，请保留原订单。',
    SEAT_ORDER_CONFLICT:'模拟增购订单或收款状态需要核对，请保留原订单。',
    SEAT_ORDER_RECONCILIATION_REQUIRED:'模拟收款已记录，当前报价或期限需核对后处理席位。',
    SEAT_CAPACITY_EXHAUSTED:'可用席位不足，请核对已使用席位和预留邀请。',
    SEAT_CAPACITY_CHANGED:'席位状态已改变，请刷新后核对。',
    BILLING_REFUND_INTAKE_CONFLICT:'退款受理记录已更新，请重新核对原订单。',
    BILLING_REFUND_INTAKE_PAYMENT_REQUIRED:'原订单尚未确认收款，请重新核对原订单。',
  },
  503:{BILLING_UNAVAILABLE:'模拟账务暂不可用，请稍后核对。'},
});

const match=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
const timestamp=value=>integer(value,0,8640000000000000);
const boolean=value=>typeof value==='boolean';
const teamName=value=>typeof value==='string'&&value.length<=160&&value.isWellFormed()&&value===value.trim()&&!!value&&[...value].length<=80&&!/[\p{Cc}\p{Cf}]/u.test(value);

function isBillingRoute(route){
  if(route===BILLING_ROOT||route===REFUND_ACCESS)return true;
  if(typeof route!=='string')return false;
  const refund=REFUND_PATH.exec(route);
  if(refund)return refund[0]===route&&match(UUID,refund[1])&&(!refund[2]||integer(Number(refund[2]),1));
  const parts=BILLING_PATH.exec(route);
  return parts!==null&&parts[0]===route&&(!parts[1]||match(UUID,parts[1]))&&(!parts[2]||match(UUID,parts[2]));
}

function billingErrorMessage(status,code){
  const messages=BILLING_ERRORS[status];
  return typeof code==='string'&&messages&&Object.hasOwn(messages,code)?messages[code]:undefined;
}

function fields(value,required,reject,optional=[]){
  if(value===null||typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)reject();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const keys=Reflect.ownKeys(descriptors);
  if(!required.every(key=>Object.hasOwn(descriptors,key))||keys.some(key=>
    (!required.includes(key)&&!optional.includes(key))||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')
  ))reject();
  return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}

function array(value,max,reject){
  if(isProxy(value)||!Array.isArray(value)||value.length>max||Reflect.ownKeys(value).length!==value.length+1)reject();
  return Array.from({length:value.length},(_,index)=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,index);
    if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))reject();
    return descriptor.value;
  });
}

function offerView(value,kind,reject){
  const offer=fields(value,OFFER_KEYS,reject);
  if(!match(ID,offer.id)||!integer(offer.revision,1)||offer.product!==PRODUCTS[kind]||!integer(offer.amountMinor,1)||offer.currency!=='CNY')reject();
  return offer;
}

function grantView(value,expected,orderId,minRecordedAt,maxRecordedAt,reject){
  const {grantId,seats,startsAt,endsAt,recordedAt:at}=fields(value,['grantId','seats','startsAt','endsAt','recordedAt'],reject);
  if(grantId!==orderId||seats!==expected.seats||startsAt!==expected.startsAt||endsAt!==expected.endsAt||!timestamp(at)||at<minRecordedAt||at>maxRecordedAt)reject();
  return {seats,startsAt,endsAt};
}

function annualOrderView(order,reject){
  let fulfilment=null,receipt=null;
  if(order.status==='paid'){
    receipt=fields(order.fulfilment,['id','orderId','teamId','operationId','subscriptionRevision','startsAt','endsAt','renewalStartsAt','confirmedAt','fulfilledAt'],reject);
    if(!match(UUID,receipt.id)||!match(UUID,receipt.operationId)||receipt.orderId!==order.id||receipt.teamId!==order.teamId||
      !integer(receipt.subscriptionRevision,1)||![receipt.startsAt,receipt.endsAt,receipt.renewalStartsAt,receipt.fulfilledAt].every(timestamp)||
      receipt.confirmedAt!==order.confirmedAt||receipt.fulfilledAt<order.confirmedAt||receipt.renewalStartsAt<order.confirmedAt||
      receipt.startsAt>receipt.renewalStartsAt||receipt.renewalStartsAt>=receipt.endsAt)reject();
    fulfilment={endsAt:receipt.endsAt,renewalStartsAt:receipt.renewalStartsAt};
  }else if(order.fulfilment!==null)reject();
  if(!Object.hasOwn(order,'renewalSeats')){
    if(Object.hasOwn(order,'renewalSeatGrant'))reject();
    return {fulfilment};
  }
  const renewalSeats=fields(order.renewalSeats,['defaultSeats','selectedSeats','baseAmountMinor','unitAmountMinor','basisRevision','basisEndsAt'],reject);
  const {defaultSeats,selectedSeats,baseAmountMinor,unitAmountMinor,basisRevision,basisEndsAt}=renewalSeats;
  if(!integer(defaultSeats)||!integer(selectedSeats)||!integer(baseAmountMinor,1)||!integer(unitAmountMinor,1)||
    !integer(basisRevision)||(basisRevision===0?(basisEndsAt!==null||defaultSeats!==0):!timestamp(basisEndsAt))||
    BigInt(baseAmountMinor)+BigInt(unitAmountMinor)*BigInt(selectedSeats)!==BigInt(order.offer.amountMinor))reject();
  let renewalSeatGrant=null;
  if(receipt&&selectedSeats>0){
    renewalSeatGrant=grantView(order.renewalSeatGrant,{seats:selectedSeats,startsAt:receipt.renewalStartsAt,endsAt:receipt.endsAt},order.id,receipt.fulfilledAt,receipt.fulfilledAt,reject);
  }else if(order.renewalSeatGrant!==null)reject();
  return {fulfilment,renewalSeats,renewalSeatGrant};
}

function seatOrderView(order,reject){
  const {quantity,annualUnitAmountMinor,createdAt,quoteExpiresAt,termStartsAt,termEndsAt,termRevision}=order;
  if(!integer(quantity,1,1000)||!integer(annualUnitAmountMinor,1)||!integer(termRevision,1)||
    ![quoteExpiresAt,termStartsAt,termEndsAt].every(timestamp)||termStartsAt>createdAt||createdAt>=quoteExpiresAt||quoteExpiresAt>termEndsAt)reject();
  let grant=null;
  if(order.status==='paid'){
    if(order.confirmedAt>=termEndsAt)reject();
    grant=grantView(order.grant,{seats:quantity,startsAt:order.confirmedAt,endsAt:termEndsAt},order.id,order.confirmedAt,termEndsAt-1,reject);
  }else if(order.grant!==null)reject();
  return {quantity,annualUnitAmountMinor,quoteExpiresAt,termEndsAt,grant};
}

function paymentExceptionView(value,createdAt,reject){
  const exception=fields(value,['kind','occurredAt','state'],reject);
  if(!PAYMENT_EXCEPTION_KINDS.has(exception.kind)||!timestamp(exception.occurredAt)||
    exception.occurredAt<createdAt||exception.state!=='review-required')reject();
  return exception;
}

function orderView(value,{teamId,kind,orderId,selection},reject){
  const annual=kind==='annual';
  const order=annual?fields(value,[...ORDER_KEYS,'fulfilment'],reject,['renewalSeats','renewalSeatGrant','paymentException']):
    fields(value,[...ORDER_KEYS,'quantity','annualUnitAmountMinor','quoteExpiresAt','termStartsAt','termEndsAt','termRevision','grant'],reject,['paymentException']);
  const {id,actorId,requestId,merchantId,createdAt,status,confirmedAt}=order;
  if(!match(UUID,id)||order.teamId!==teamId||orderId!==undefined&&id!==orderId||!match(ID,actorId)||
    !match(UUID,requestId)||!match(ID,merchantId)||order.simulation!==true||!timestamp(createdAt)||!ORDER_STATES.has(status)||
    (status==='pending'?confirmedAt!==null:!timestamp(confirmedAt)||confirmedAt<createdAt))reject();
  const offer=offerView(order.offer,kind,reject);
  const details=annual?annualOrderView(order,reject):seatOrderView(order,reject);
  if(selection&&(requestId!==selection.requestId||offer.id!==selection.offerId||offer.revision!==selection.offerRevision||
    (annual?(selection.selectedSeats??details.renewalSeats?.defaultSeats)!==details.renewalSeats?.selectedSeats:selection.quantity!==details.quantity)))reject();
  if(Object.hasOwn(order,'paymentException'))details.paymentException=paymentExceptionView(order.paymentException,createdAt,reject);
  return {id,teamId,offer,createdAt,status,confirmedAt,...details};
}

function overviewView(value,teamId,reject){
  const overview=fields(value,['teamId','simulation','subscription','seats','annualOffers','renewalSeats','seatOffer','canReconcile'],reject,['canReconcilePaymentExceptions','canReconcileBillingBatch']);
  if(overview.teamId!==teamId||overview.simulation!==true||!boolean(overview.canReconcile))reject();
  const capabilities={canReconcile:overview.canReconcile};
  if(Object.hasOwn(overview,'canReconcilePaymentExceptions')){
    const enabled=overview.canReconcilePaymentExceptions;
    if(!boolean(enabled)||enabled&&!overview.canReconcile)reject();
    capabilities.canReconcilePaymentExceptions=enabled;
  }
  if(Object.hasOwn(overview,'canReconcileBillingBatch')){
    if(overview.canReconcileBillingBatch!==true||!overview.canReconcile)reject();
    capabilities.canReconcileBillingBatch=true;
  }
  const subscription=fields(overview.subscription,['state','revision','startsAt','endsAt'],reject);
  const {state,revision,startsAt,endsAt}=subscription;
  if(!SUBSCRIPTION_STATES.has(state)||(state==='unconfigured'?
    revision!==0||startsAt!==null||endsAt!==null:!integer(revision,1)||!timestamp(startsAt)||!timestamp(endsAt)||startsAt>=endsAt))reject();
  const seats=fields(overview.seats,['purchasedSeats','activeBusinessSeats','reservedInvitationSeats','usedSeats','availableSeats'],reject);
  if(!Object.values(seats).every(value=>integer(value))||seats.usedSeats!==seats.activeBusinessSeats+seats.reservedInvitationSeats||
    seats.availableSeats!==Math.max(0,seats.purchasedSeats-seats.usedSeats))reject();
  const annualOffers=array(overview.annualOffers,10,reject).map(item=>offerView(item,'annual',reject));
  if(new Set(annualOffers.map(item=>item.id)).size!==annualOffers.length)reject();
  let renewalSeats=null,seatOffer=null;
  if(overview.renewalSeats!==null){
    renewalSeats=fields(overview.renewalSeats,['defaultSeats','basisRevision','basisEndsAt','committedSeats','unitAmountMinor','currency'],reject);
    if(!integer(renewalSeats.defaultSeats)||renewalSeats.basisRevision!==revision||renewalSeats.basisEndsAt!==endsAt||
      renewalSeats.committedSeats!==seats.usedSeats||!integer(renewalSeats.unitAmountMinor,1)||renewalSeats.currency!=='CNY')reject();
  }else if(annualOffers.length)reject();
  if(overview.seatOffer!==null){
    seatOffer=fields(overview.seatOffer,['id','revision','annualUnitAmountMinor','currency','product'],reject);
    if(!match(ID,seatOffer.id)||!integer(seatOffer.revision,1)||!integer(seatOffer.annualUnitAmountMinor,1)||
      seatOffer.currency!=='CNY'||seatOffer.product!==PRODUCTS.seat)reject();
  }
  return {teamId,simulation:true,subscription,seats,annualOffers,renewalSeats,seatOffer,...capabilities};
}

function reconciliationPageView(value,{teamId,kind,after},reject){
  const page=fields(value,['simulation','teamId','kind','results','nextCursor'],reject);
  if(page.simulation!==true||page.teamId!==teamId||page.kind!==kind)reject();
  const results=array(page.results,RECONCILIATION_PAGE_SIZE,reject).map(item=>{
    const result=fields(item,['orderId','outcome','status','paymentException'],reject);
    const {orderId,outcome,status,paymentException}=result;
    if(!match(UUID,orderId)||!RECONCILIATION_OUTCOMES.has(outcome)||!ORDER_STATES.has(status)||!boolean(paymentException)||
      outcome==='matched'&&(status!=='paid'||paymentException)||
      outcome==='awaiting-review'&&status!=='payment-verified'&&!paymentException)reject();
    return result;
  });
  const {nextCursor}=page;
  if(results.some((result,index)=>result.orderId<=(index===0?after??'':results[index-1].orderId))||
    nextCursor!==null&&(results.length!==RECONCILIATION_PAGE_SIZE||nextCursor!==results.at(-1).orderId))reject();
  return {results,nextCursor};
}

function refundIntakeView(value,{kind,orderId,beforeRevision},reject){
  const result=fields(value,['order','revision','entries','nextBeforeRevision'],reject);
  const order=fields(result.order,['id','kind','teamId','teamName','amountMinor','currency','status','confirmedAt','paymentException'],reject);
  if(order.id!==orderId||order.kind!==kind||!match(ID,order.teamId)||!teamName(order.teamName)||
    !integer(order.amountMinor,1)||order.currency!=='CNY'||!ORDER_STATES.has(order.status)||
    (order.status==='pending'?order.confirmedAt!==null:!timestamp(order.confirmedAt))||!boolean(order.paymentException))reject();
  const {revision,nextBeforeRevision}=result;
  if(!integer(revision)||order.confirmedAt===null&&revision!==0)reject();
  const newest=beforeRevision===undefined?revision:Math.min(revision,beforeRevision-1);
  const entries=array(result.entries,PAGE_SIZE,reject);
  if(entries.length!==Math.min(newest,PAGE_SIZE)||nextBeforeRevision!==(newest>PAGE_SIZE?newest-PAGE_SIZE+1:null))reject();
  return {
    order,revision,nextBeforeRevision,
    entries:entries.map((value,index)=>{
      const entry=fields(value,['revision','kind','reason','reference','recordedAt','recordedBy'],reject);
      const expected=newest-index,first=expected===1,reasons=first?INTAKE_REASONS:FOLLOW_UP_REASONS;
      if(entry.revision!==expected||entry.kind!==(first?'intake':'follow-up')||!reasons.has(entry.reason)||
        entry.reference!==null&&!match(REFUND_REFERENCE,entry.reference)||!timestamp(entry.recordedAt)||
        entry.recordedAt<order.confirmedAt||!match(ID,entry.recordedBy))reject();
      return entry;
    }),
  };
}

function createBillingClient({request,failure}){
  const badInput=()=>{throw failure('INVALID_INPUT','模拟账务操作参数无效。');};
  const badResponse=()=>{throw failure('INVALID_RESPONSE','模拟账务响应无法确认，请按原操作核对。');};
  const scoped=(teamId,kind)=>{
    if(!match(ID,teamId)||kind!==undefined&&kind!=='annual'&&kind!=='seat')badInput();
    return '/api/teams/'+teamId+'/billing/'+(kind===undefined?'overview':kind==='annual'?'orders':'seat-orders');
  };
  const refundRoute=({kind,orderId})=>{
    if((kind!=='annual'&&kind!=='seat')||!match(UUID,orderId))badInput();
    return '/api/platform/billing/refund-intakes/'+kind+'/'+orderId;
  };
  const orderResponse=(data,scope)=>{
    const response=fields(data,['simulation','order'],badResponse);
    if(response.simulation!==true)badResponse();
    return {order:orderView(response.order,scope,badResponse)};
  };
  return {
    async getBillingAccess(input){
      if(input!==undefined)badInput();
      const data=fields(await request(BILLING_ROOT),['teams'],badResponse);
      const teams=array(data.teams,50,badResponse).map(item=>{
        const team=fields(item,['id','name'],badResponse);
        if(!match(ID,team.id)||!teamName(team.name))badResponse();
        return team;
      });
      if(teams.some((team,index)=>index>0&&team.id<=teams[index-1].id))badResponse();
      return {teams};
    },
    async getBillingOverview(input){
      const {teamId}=fields(input,['teamId'],badInput);
      return overviewView(await request(scoped(teamId)),teamId,badResponse);
    },
    async listBillingOrders(input){
      const {teamId,kind,after}=fields(input,['teamId','kind'],badInput,['after']);
      if((kind!=='annual'&&kind!=='seat')||(after!==undefined&&!match(UUID,after)))badInput();
      const route=scoped(teamId,kind)+'?limit='+PAGE_SIZE+(after===undefined?'':'&after='+after);
      const data=fields(await request(route),['simulation','orders','hasMore','nextCursor'],badResponse);
      if(data.simulation!==true||!boolean(data.hasMore))badResponse();
      const orders=array(data.orders,PAGE_SIZE,badResponse).map(order=>orderView(order,{teamId,kind},badResponse));
      if(orders.some((order,index)=>order.id<=(index===0?after??'':orders[index-1].id))||
        (data.hasMore?(orders.length!==PAGE_SIZE||data.nextCursor!==orders.at(-1).id):data.nextCursor!==null))badResponse();
      return {orders,hasMore:data.hasMore,nextCursor:data.nextCursor};
    },
    async createBillingOrder(input){
      const selection=fields(input,
        ['teamId','kind','requestId','offerId','offerRevision'],badInput,['selectedSeats','quantity']);
      const {teamId,kind,requestId,offerId,offerRevision,selectedSeats,quantity}=selection;
      if((kind!=='annual'&&kind!=='seat')||!match(UUID,requestId)||!match(ID,offerId)||!integer(offerRevision,1))badInput();
      const body={requestId,offerId,offerRevision};
      if(kind==='annual'){
        if(Object.hasOwn(selection,'quantity')||(Object.hasOwn(selection,'selectedSeats')&&!integer(selectedSeats)))badInput();
        if(selectedSeats!==undefined)body.selectedSeats=selectedSeats;
      }else{
        if(Object.hasOwn(selection,'selectedSeats')||!integer(quantity,1,1000))badInput();
        body.quantity=quantity;
      }
      const route=scoped(teamId,kind);
      return orderResponse(await request(route,{method:'POST',body}),{teamId,kind,selection:body});
    },
    async reconcileBillingOrder(input){
      const {teamId,kind,orderId}=fields(input,['teamId','kind','orderId'],badInput);
      if((kind!=='annual'&&kind!=='seat')||!match(UUID,orderId))badInput();
      const route=scoped(teamId,kind)+'/'+orderId+'/reconcile';
      return orderResponse(await request(route,{method:'POST',body:{}}),{teamId,kind,orderId});
    },
    async reconcileBillingPage(input){
      const scope=fields(input,['teamId','kind'],badInput,['after']);
      const {teamId,kind,after}=scope;
      if(!match(ID,teamId)||(kind!=='annual'&&kind!=='seat')||Object.hasOwn(scope,'after')&&!match(UUID,after))badInput();
      const body=after===undefined?{kind}:{kind,after};
      const route='/api/teams/'+teamId+'/billing/reconciliation';
      return reconciliationPageView(await request(route,{method:'POST',body}),scope,badResponse);
    },
    async getRefundIntakeAccess(input){
      if(input!==undefined)badInput();
      const value=fields(await request(REFUND_ACCESS),['canReview'],badResponse);
      if(!boolean(value.canReview))badResponse();
      return value;
    },
    async getRefundIntake(input){
      const scope=fields(input,['kind','orderId'],badInput,['beforeRevision']);
      if(Object.hasOwn(scope,'beforeRevision')&&!integer(scope.beforeRevision,1))badInput();
      const route=refundRoute(scope)+(scope.beforeRevision===undefined?'':'?beforeRevision='+scope.beforeRevision);
      return refundIntakeView(await request(route),scope,badResponse);
    },
    async recordRefundIntake(input){
      const selection=fields(input,['kind','orderId','requestId','expectedRevision','reason','currentPassword'],badInput,['reference']);
      const {kind,orderId,requestId,expectedRevision,reason,reference,currentPassword}=selection;
      const route=refundRoute(selection),reasons=expectedRevision===0?INTAKE_REASONS:FOLLOW_UP_REASONS;
      if(!match(UUID,requestId)||!integer(expectedRevision,0,Number.MAX_SAFE_INTEGER-1)||!reasons.has(reason)||
        Object.hasOwn(selection,'reference')&&!match(REFUND_REFERENCE,reference)||
        typeof currentPassword!=='string'||!currentPassword||Buffer.byteLength(currentPassword)>512)badInput();
      const body={requestId,expectedRevision,reason,...(reference===undefined?{}:{reference}),currentPassword};
      const data=refundIntakeView(await request(route,{method:'POST',body}),{kind,orderId},badResponse);
      if(data.revision<=expectedRevision||data.order.confirmedAt===null)badResponse();
      const saved=data.entries.find(entry=>entry.revision===expectedRevision+1);
      if(saved&&(saved.reason!==reason||saved.reference!==(reference??null)))badResponse();
      return data;
    },
  };
}

module.exports={createBillingClient,isBillingRoute,billingErrorMessage,MAX_BILLING_BYTES};
