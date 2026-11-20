'use strict';
const {randomUUID}=require('node:crypto');
const {isProxy}=require('node:util').types;

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BILLING_ROOT='/api/auth/billing/access';
const BILLING_PATH=/^\/api\/teams\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/billing\/(?:overview|website-handoff|website-seat-handoff|native-website(?:-order)?-handoff|reconciliation|(?:orders|seat-orders)(?:\?limit=20(?:&after=([0-9a-f-]{36}))?|\/([0-9a-f-]{36})(?:\/(?:reconcile|resume-fulfilment))?)?)$/;
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
const ORDER_STATES=new Set(['pending','closed','payment-verified','paid']);
const PAYMENT_EXCEPTION_KINDS=new Set(['refund','chargeback']);
const RECONCILIATION_OUTCOMES=new Set(['no-evidence','matched','closed','awaiting-review','lookup-unavailable','evidence-rejected','local-failure']);
const OFFER_KEYS=['id','revision','product','amountMinor','currency'];
const ORDER_KEYS=['id','teamId','actorId','requestId','merchantId','offer','simulation','createdAt','status','confirmedAt'];
const BILLING_ERRORS=Object.freeze({
  402:{SUBSCRIPTION_WRITE_UNAVAILABLE:'当前订阅期限不支持增购席位。'},
  403:{VERIFICATION_FAILED:'当前密码未通过核验，请重新输入。'},
  409:{
    WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED:'请先在官网核对上一笔购买。权益到账或确认关单后可以开始下一笔。',
    BILLING_OFFER_CHANGED:'模拟账务方案已改变，请刷新后重新核对。',
    BILLING_RENEWAL_SEATS_RECONCILIATION_REQUIRED:'模拟续费席位无法确认，请核对已使用席位、预留邀请及待处理订单。',
    BILLING_CONFLICT:'模拟订单或收款状态需要核对，请保留原订单。',
    BILLING_RECONCILIATION_BUSY:'本团队已有一批订单正在核对，请稍后重试本批。',
    BILLING_RECONCILIATION_CONFLICT:'本批核对请求与已保存记录不一致，请核对团队、订单类型及批次。',
    SEAT_ORDER_CONFLICT:'模拟增购订单或收款状态需要核对，请保留原订单。',
    SEAT_ORDER_RECONCILIATION_REQUIRED:'模拟收款已记录，当前报价或期限需核对后处理席位。',
    BILLING_PAYMENT_EXCEPTION_REVIEW_REQUIRED:'该模拟订单已有退款或拒付记录，请先核对异常。',
    BILLING_ORDER_CLOSED_REVIEW_REQUIRED:'该模拟订单已超时关闭，后到的收款须单独复核。',
    SEAT_CAPACITY_EXHAUSTED:'可用席位不足，请核对已使用席位和预留邀请。',
    SEAT_CAPACITY_CHANGED:'席位状态已改变，请刷新后核对。',
    BILLING_REFUND_INTAKE_CONFLICT:'退款受理记录已更新，请重新核对原订单。',
    BILLING_REFUND_INTAKE_PAYMENT_REQUIRED:'原订单尚未确认收款，请重新核对原订单。',
  },
  503:{BILLING_UNAVAILABLE:'模拟账务暂不可用，请稍后核对。',BILLING_RECONCILIATION_RECEIPT_FAILED:'本批核对结果保存未确认，请沿用原请求重试。'},
});

const match=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
const timestamp=value=>integer(value,0,8640000000000000);
const noConfirmedPayment=status=>status==='pending'||status==='closed';
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

function orderClosureView(order,reject){
  if(!Object.hasOwn(order,'closure')){
    if(order.status==='closed')reject();
    return undefined;
  }
  const closure=fields(order.closure,['closedAt','deadlineAt'],reject);
  if(!timestamp(closure.closedAt)||!timestamp(closure.deadlineAt)||closure.closedAt<closure.deadlineAt||
    !(order.status==='closed'||order.status==='payment-verified'&&order.confirmedAt>=closure.closedAt))reject();
  return closure;
}

function orderView(value,{teamId,kind,orderId,selection},reject){
  const annual=kind==='annual';
  const order=annual?fields(value,[...ORDER_KEYS,'fulfilment'],reject,['renewalSeats','renewalSeatGrant','paymentException','paymentDeadlineAt','closure']):
    fields(value,[...ORDER_KEYS,'quantity','annualUnitAmountMinor','quoteExpiresAt','termStartsAt','termEndsAt','termRevision','grant'],reject,['paymentException','closure']);
  const {id,actorId,requestId,merchantId,createdAt,status,confirmedAt}=order;
  if(!match(UUID,id)||order.teamId!==teamId||orderId!==undefined&&id!==orderId||!match(ID,actorId)||
    !match(UUID,requestId)||!match(ID,merchantId)||order.simulation!==true||!timestamp(createdAt)||!ORDER_STATES.has(status)||
    (noConfirmedPayment(status)?confirmedAt!==null:!timestamp(confirmedAt)||confirmedAt<createdAt))reject();
  const offer=offerView(order.offer,kind,reject);
  const details=annual?annualOrderView(order,reject):seatOrderView(order,reject);
  if(Object.hasOwn(order,'paymentDeadlineAt')){
    if(!timestamp(order.paymentDeadlineAt)||order.paymentDeadlineAt<=createdAt)reject();
    details.paymentDeadlineAt=order.paymentDeadlineAt;
  }
  const closure=orderClosureView(order,reject);
  if(closure){
    if(closure.deadlineAt!==(annual?order.paymentDeadlineAt:order.quoteExpiresAt))reject();
    details.closure=closure;
  }
  if(selection&&(requestId!==selection.requestId||offer.id!==selection.offerId||offer.revision!==selection.offerRevision||
    (annual?(selection.selectedSeats??details.renewalSeats?.defaultSeats)!==details.renewalSeats?.selectedSeats:selection.quantity!==details.quantity)))reject();
  if(Object.hasOwn(order,'paymentException'))details.paymentException=paymentExceptionView(order.paymentException,createdAt,reject);
  return {id,teamId,offer,createdAt,status,confirmedAt,...details};
}

function overviewView(value,teamId,reject){
  const commonKeys=['teamId','simulation','subscription','seats'];
  const simulationKeys=['annualOffers','renewalSeats','seatOffer','canReconcile'];
  const optionalKeys=['canReconcilePaymentExceptions','canReconcileBillingBatch','canResumeBillingBatch','canResumeFulfilment','websiteCheckout'];
  const overview=fields(value,commonKeys,reject,[...simulationKeys,...optionalKeys,'nativeCheckout']);
  if(overview.teamId!==teamId||!boolean(overview.simulation))reject();
  if(Object.hasOwn(overview,'websiteCheckout')&&(!overview.simulation||overview.websiteCheckout!==true))reject();
  const subscription=fields(overview.subscription,['state','revision','startsAt','endsAt'],reject,['renewalReminderDays','pilot']);
  const {state,revision,startsAt,endsAt}=subscription;
  if(!SUBSCRIPTION_STATES.has(state)||(state==='unconfigured'?
    revision!==0||startsAt!==null||endsAt!==null:!integer(revision,1)||!timestamp(startsAt)||!timestamp(endsAt)||startsAt>=endsAt))reject();
  if(Object.hasOwn(subscription,'renewalReminderDays')&&(state!=='active'||!integer(subscription.renewalReminderDays,1,30)))reject();
  if(Object.hasOwn(subscription,'pilot')&&(overview.simulation||subscription.pilot!==true||revision!==1||state==='unconfigured'))reject();
  const seats=fields(overview.seats,['purchasedSeats','activeBusinessSeats','reservedInvitationSeats','usedSeats','availableSeats'],reject);
  if(!Object.values(seats).every(value=>integer(value))||seats.usedSeats!==seats.activeBusinessSeats+seats.reservedInvitationSeats||
    seats.availableSeats!==Math.max(0,seats.purchasedSeats-seats.usedSeats))reject();
  if(!overview.simulation){
    const native = Object.hasOwn(overview,'nativeCheckout');
    if(Object.keys(overview).length!==commonKeys.length+Number(native))reject();
    const capability=native?fields(overview.nativeCheckout,['canPurchase'],reject):null;
    if(capability&&!boolean(capability.canPurchase))reject();
    return {teamId,simulation:false,subscription,seats,...(native?{nativeCheckout:capability}:{})};
  }
  if(Object.hasOwn(overview,'nativeCheckout'))reject();
  if(!simulationKeys.every(key=>Object.hasOwn(overview,key))||!boolean(overview.canReconcile))reject();
  const capabilities={canReconcile:overview.canReconcile,...(overview.websiteCheckout===true?{websiteCheckout:true}:{})};
  if(Object.hasOwn(overview,'canReconcilePaymentExceptions')){
    const enabled=overview.canReconcilePaymentExceptions;
    if(!boolean(enabled)||enabled&&!overview.canReconcile)reject();
    capabilities.canReconcilePaymentExceptions=enabled;
  }
  if(Object.hasOwn(overview,'canReconcileBillingBatch')){
    if(overview.canReconcileBillingBatch!==true||!overview.canReconcile)reject();
    capabilities.canReconcileBillingBatch=true;
  }
  if(Object.hasOwn(overview,'canResumeBillingBatch')){
    if(overview.canResumeBillingBatch!==true||overview.canReconcileBillingBatch!==true)reject();
    capabilities.canResumeBillingBatch=true;
  }
  if(Object.hasOwn(overview,'canResumeFulfilment')){
    if(overview.canResumeFulfilment!==true)reject();
    capabilities.canResumeFulfilment=true;
  }
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
      outcome==='closed'&&status!=='closed'||
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
  const order=fields(result.order,['id','kind','teamId','teamName','amountMinor','currency','status','confirmedAt','paymentException'],reject,['closure']);
  if(order.id!==orderId||order.kind!==kind||!match(ID,order.teamId)||!teamName(order.teamName)||
    !integer(order.amountMinor,1)||order.currency!=='CNY'||!ORDER_STATES.has(order.status)||
    (noConfirmedPayment(order.status)?order.confirmedAt!==null:!timestamp(order.confirmedAt))||!boolean(order.paymentException))reject();
  if(Object.hasOwn(order,'closure')||order.status==='closed')order.closure=orderClosureView(order,reject);
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

function createBillingClient({request,failure,websiteCheckout,nativeCheckout}){
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
  let openingNative=false;
  function nativeInputError(){throw failure('INVALID_INPUT','请核对购买类型或原订单编号。');}
  function nativeStorageError(){throw failure('NATIVE_PURCHASE_STORAGE_UNAVAILABLE','无法读取或保存本次购买记录，请先在官网核对原订单。');}
  async function openNativeWebsiteCheckout(input){
    const selection=fields(input,['teamId'],nativeInputError,['kind','orderId','newPurchase']);
    const {teamId,kind,orderId,newPurchase}=selection, knownOrder=Object.hasOwn(selection,'orderId');
    if(!match(ID,teamId)||(knownOrder
      ? !match(UUID,orderId)||Object.hasOwn(selection,'kind')||Object.hasOwn(selection,'newPurchase')
      : (kind!=='annual'&&kind!=='seat')||(Object.hasOwn(selection,'newPurchase')&&newPurchase!==true)))nativeInputError();
    if(nativeCheckout?.configured!==true)throw failure('WEBSITE_CHECKOUT_UNAVAILABLE','当前电脑未连接受信官网付款服务。');
    if(openingNative)throw failure('WEBSITE_CHECKOUT_IN_PROGRESS','正在打开官网订单页，请稍候。');
    openingNative=true;
    try{
      const {assertCurrent,actorId}=nativeCheckout.capture();
      assertCurrent();
      const scope=[nativeCheckout.apiBase,nativeCheckout.serverId,actorId,teamId,kind];
      let existing,intent;
      if(!knownOrder){
        try{existing=await nativeCheckout.intents.read(scope);}catch{nativeStorageError();}
        assertCurrent();
        if(existing!==null&&(!match(UUID,existing?.requestId)||
          existing.previousRequestId!==null&&(!match(UUID,existing.previousRequestId)||existing.requestId===existing.previousRequestId)))nativeStorageError();
        if(newPurchase&&existing===null)throw failure('WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED','请先打开或继续本次购买。');
        intent=newPurchase||existing===null?{requestId:randomUUID(),previousRequestId:existing?.requestId??null}:existing;
      }
      const route='/api/teams/'+teamId+'/billing/native-website'+(knownOrder?'':'-order')+'-handoff';
      const body=knownOrder?{orderId}:{product:PRODUCTS[kind],requestId:intent.requestId,
        ...(intent.previousRequestId===null?{}:{previousRequestId:intent.previousRequestId})};
      const startedAt=performance.now();
      const value=fields(await request(route,{method:'POST',body,beforeSend:assertCurrent}),['handoff','expiresAt','expiresInMs'],badResponse);
      assertCurrent();
      if(!match(/^[A-Za-z0-9_-]{43}$/,value.handoff)||Buffer.from(value.handoff,'base64url').toString('base64url')!==value.handoff||
         !timestamp(value.expiresAt)||value.expiresAt<=0||!integer(value.expiresInMs,1,120_000))badResponse();
      const deadline=startedAt+value.expiresInMs;
      if(performance.now()>=deadline)badResponse();
      if(!knownOrder&&intent!==existing){
        try{await nativeCheckout.intents.write(scope,intent);}catch{nativeStorageError();}
      }
      assertCurrent();
      if(performance.now()>=deadline)badResponse();
      try{await nativeCheckout.open(value.handoff);}
      catch{assertCurrent();throw failure('WEBSITE_CHECKOUT_OPEN_FAILED','无法确认官网页面已打开，请核对浏览器后再操作。');}
      assertCurrent();
      return {opened:true};
    }finally{openingNative=false;}
  }
  return {
    openNativeWebsiteCheckout,
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
      const overview=overviewView(await request(scoped(teamId)),teamId,badResponse);
      if(overview.nativeCheckout&&nativeCheckout?.configured!==true)badResponse();
      return overview.websiteCheckout===true?{...overview,websiteCheckoutReady:websiteCheckout?.configured===true}:overview;
    },
    async openWebsiteCheckout(input){
      const selection=fields(input,['teamId'],badInput,['kind','orderId']);
      const {teamId,orderId}=selection,kind=Object.hasOwn(selection,'kind')?selection.kind:'annual';
      const existingOrder=Object.hasOwn(selection,'orderId');
      if(!match(ID,teamId)||(kind!=='annual'&&kind!=='seat')||(existingOrder&&!match(UUID,orderId)))badInput();
      if(websiteCheckout?.configured!==true||typeof websiteCheckout.capture!=='function'||typeof websiteCheckout.open!=='function')throw failure('WEBSITE_CHECKOUT_UNAVAILABLE','当前电脑尚未配置受信官网合成下单入口。');
      const check=websiteCheckout.capture();check();
      const body=existingOrder?{orderId}:{};
      const value=fields(await request('/api/teams/'+teamId+'/billing/'+(kind==='seat'?'website-seat-handoff':'website-handoff'),{method:'POST',body}),['handoff','expiresAt'],badResponse);check();
      if(typeof value.handoff!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.handoff)||Buffer.from(value.handoff,'base64url').length!==32||Buffer.from(value.handoff,'base64url').toString('base64url')!==value.handoff||!timestamp(value.expiresAt)||value.expiresAt<=websiteCheckout.now())badResponse();
      check();try{await websiteCheckout.open(value.handoff,kind);}catch{check();throw failure('WEBSITE_CHECKOUT_OPEN_FAILED','无法确认官网页面已打开，请核对浏览器后再操作。');}check();return {opened:true};
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
    async getBillingOrder(input){
      const {teamId,kind,orderId}=fields(input,['teamId','kind','orderId'],badInput);
      if((kind!=='annual'&&kind!=='seat')||!match(UUID,orderId))badInput();
      return orderResponse(await request(scoped(teamId,kind)+'/'+orderId),{teamId,kind,orderId});
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
      const selection=fields(input,['teamId','kind','orderId'],badInput,['source']);
      const {teamId,kind,orderId,source}=selection;
      if((kind!=='annual'&&kind!=='seat')||!match(UUID,orderId)||
        Object.hasOwn(selection,'source')&&source!=='recorded-payment')badInput();
      const recovering=source==='recorded-payment';
      const route=scoped(teamId,kind)+'/'+orderId+(recovering?'/resume-fulfilment':'/reconcile');
      const result=orderResponse(await request(route,{method:'POST',body:{}}),{teamId,kind,orderId});
      if(recovering&&result.order.status!=='paid')badResponse();
      return result;
    },
    async reconcileBillingPage(input){
      const scope=fields(input,['teamId','kind'],badInput,['after','requestId']);
      const {teamId,kind,after,requestId}=scope;
      if(!match(ID,teamId)||(kind!=='annual'&&kind!=='seat')||Object.hasOwn(scope,'after')&&!match(UUID,after)||
        Object.hasOwn(scope,'requestId')&&!match(UUID,requestId))badInput();
      const body=after===undefined?{kind}:{kind,after};
      if(requestId!==undefined)body.requestId=requestId;
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
