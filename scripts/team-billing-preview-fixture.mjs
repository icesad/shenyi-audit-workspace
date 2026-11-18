import {randomBytes,randomUUID} from 'node:crypto';
import {ANNUAL_PRODUCT,SEAT_PRODUCT,signSimulationPayment,verifySimulationPaymentEnvelope} from '../server/team/billing-simulation.mjs';
import {signSimulationOrderClosure} from '../server/team/billing-order-closure.mjs';
import {signSimulationPaymentException} from '../server/team/billing-payment-exception.mjs';
import {createAnnualOrderWithinTransaction} from '../server/team/billing-store.mjs';
import {transaction} from '../server/team/http-utils.mjs';
import {hashPassword} from '../server/team/passwords.mjs';
import {recordSeatCapacityGrantWithinTransaction} from '../server/team/seat-capacity-store.mjs';
import {createSeatOrderWithinTransaction,fulfilSeatOrder,recordVerifiedSeatPayment} from '../server/team/seat-order-store.mjs';
import {appendSubscriptionTermWithinTransaction} from '../server/team/subscription-store.mjs';

export const BILLING_PREVIEW_ADMIN='billing-admin-demo';
export const BILLING_PREVIEW_OWNER='refund-owner-demo';
export const BILLING_PREVIEW_PASSWORD='ShenyiDemo!2026';

const TEAM_ID='team-a';
const HOUR=60*60*1000;
const DAY=24*HOUR;
const DEMO_ACCOUNTS=[
  [BILLING_PREVIEW_ADMIN,'合成账务管理员'],
  [BILLING_PREVIEW_OWNER,'合成退款审核员'],
];
const EMPTY_TABLES=[
  'team_operators','team_subscription_heads','team_subscription_events','team_seat_capacity_grants',
  'team_annual_orders','team_annual_order_seat_plans','team_annual_verified_payments','team_annual_fulfilments',
  'team_seat_orders','team_seat_verified_payments','team_billing_annual_close_windows','team_billing_order_closures',
  'team_billing_payment_exceptions','team_billing_refund_intake_reviewers','team_billing_refund_intake_events',
];

function requireFreshDemo(db){
  const metadata=db.prepare('SELECT value FROM team_database_metadata WHERE name=?');
  const activeDemoTeam=db.prepare("SELECT 1 FROM teams WHERE team_id=? AND status='active'").get(TEAM_ID);
  if(metadata.get('prototype-version')?.value!=='2'||metadata.get('demo')?.value!=='true'||!activeDemoTeam){
    throw new Error('Billing preview requires an initialized synthetic team database');
  }
  if(EMPTY_TABLES.some(table=>db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())){
    throw new Error('Billing preview requires empty billing and team operator records');
  }
  const existingAccount=db.prepare('SELECT 1 FROM team_users WHERE user_id=? UNION ALL SELECT 1 FROM team_credentials WHERE username=? LIMIT 1');
  if(DEMO_ACCOUNTS.some(([id])=>existingAccount.get(id,id))){
    throw new Error('Refusing to reuse existing accounts for billing preview');
  }
}

function addDemoAccounts(db,passwordHashes){
  const addUser=db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')");
  const addCredential=db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)');
  for(const [index,[id,displayName]] of DEMO_ACCOUNTS.entries()){
    addUser.run(id);
    addCredential.run(id,id,displayName,passwordHashes[index]);
  }
  db.prepare("INSERT INTO team_operators(team_id,user_id,role,status) VALUES (?,?,'administrator','active')").run(TEAM_ID,BILLING_PREVIEW_ADMIN);
  db.prepare("INSERT INTO team_billing_refund_intake_reviewers(user_id,permission,status) VALUES (?,'billing.refund-intake','active')").run(BILLING_PREVIEW_OWNER);
}

function orderEvidence(order){
  return {
    merchantId:order.merchantId,orderId:order.id,product:order.offer.product,
    amountMinor:order.offer.amountMinor,currency:order.offer.currency,
  };
}

function paymentReceipt(order,paidAt){
  return {
    ...orderEvidence(order),protocol:'shenyi-simulation-payment-v1',eventId:randomUUID(),
    transactionId:randomUUID(),status:'succeeded',paidAt,
  };
}

function closureReceipt(order,closedAt){
  return {
    ...orderEvidence(order),protocol:'shenyi-simulation-order-closure-v1',eventId:randomUUID(),
    status:'closed',closedAt,
  };
}

function lockedOrderMatches(order,locked){
  return order.simulation===true&&order.teamId===locked.teamId&&order.actorId===locked.actorId
    &&order.requestId===locked.requestId&&order.merchantId===locked.merchantId&&order.createdAt===locked.createdAt
    &&order.paymentDeadlineAt===locked.paymentDeadlineAt&&order.quoteExpiresAt===locked.quoteExpiresAt
    &&Object.keys(locked.offer).every(field=>order.offer?.[field]===locked.offer[field]);
}

function previewGateway(orders,refundPayment,configuration,now){
  const plans=new Map(Object.entries(orders).map(([name,order])=>[order.id,{name,order}]));
  return order=>{
    const plan=plans.get(order.id);
    if(!plan||!lockedOrderMatches(order,plan.order))return null;
    const time=now();
    if(!Number.isSafeInteger(time)||time<order.createdAt)return null;

    if(plan.name==='refundSeat'){
      if(order.status!=='paid'||time<order.confirmedAt)return null;
      plan.refund??=Object.freeze({
        kind:'payment-exception',
        ...signSimulationPaymentException({
          ...orderEvidence(plan.order),protocol:'shenyi-simulation-payment-exception-v1',
          eventId:randomUUID(),originalTransactionId:refundPayment.transactionId,kind:'refund',occurredAt:time,
        },configuration),
      });
      return plan.refund;
    }
    if(plan.capture)return plan.capture;
    if(plan.name==='timedOutAnnual'&&order.closure&&time>=order.closure.closedAt){
      plan.capture=signSimulationPayment(paymentReceipt(plan.order,time),configuration);
      return plan.capture;
    }
    const deadline=plan.order.paymentDeadlineAt??plan.order.quoteExpiresAt;
    if(time>=deadline){
      if(order.status!=='pending'&&!plan.closure)return null;
      plan.closure??=Object.freeze({
        kind:'order-closure',...signSimulationOrderClosure(closureReceipt(plan.order,time),configuration),
      });
      return plan.closure;
    }
    if(plan.name==='timedOutAnnual'||order.status!=='pending')return null;
    plan.capture=signSimulationPayment(paymentReceipt(plan.order,time),configuration);
    return plan.capture;
  };
}

export async function prepareBillingPreview(db,{now=Date.now}={}){
  requireFreshDemo(db);
  const passwordHashes=await Promise.all(DEMO_ACCOUNTS.map(()=>hashPassword(BILLING_PREVIEW_PASSWORD)));
  const referenceTime=now();
  if(!Number.isSafeInteger(referenceTime)||referenceTime<DAY||referenceTime>8640000000000000-30*DAY){
    throw new Error('Invalid clock for the synthetic billing preview');
  }
  const initialTerm={teamId:TEAM_ID,startsAt:referenceTime-DAY,endsAt:referenceTime+30*DAY,sourceRef:'synthetic-billing-preview'};
  const annualOffer=Object.freeze({id:'preview-team-annual',revision:1,product:ANNUAL_PRODUCT,amountMinor:19900,currency:'CNY'});
  const seatOffer=Object.freeze({id:'preview-team-seat',revision:1,annualUnitAmountMinor:5000,currency:'CNY'});
  const billingSimulation={
    mode:'simulation-v1',merchantId:'synthetic-billing-preview',signingKey:randomBytes(32),
    offers:Object.freeze([annualOffer]),seatOffer,annualSeatUnitAmountMinor:seatOffer.annualUnitAmountMinor,
    paymentExceptions:true,batchReconciliation:true,refundIntake:true,timeoutClosure:Object.freeze({annualTimeoutMs:HOUR}),
  };
  const orderRequest=()=>({teamId:TEAM_ID,actorId:BILLING_PREVIEW_ADMIN,requestId:randomUUID(),merchantId:billingSimulation.merchantId});
  const annualOrder=at=>createAnnualOrderWithinTransaction(db,{...orderRequest(),offer:annualOffer},{
    now:()=>at,renewalSeats:{unitAmountMinor:billingSimulation.annualSeatUnitAmountMinor},
    closeAfterMs:billingSimulation.timeoutClosure.annualTimeoutMs,
  });
  const seatOrder=at=>createSeatOrderWithinTransaction(db,{...orderRequest(),offer:seatOffer,quantity:2},{now:()=>at});
  const refundOrderTime=referenceTime-3*HOUR;
  const refundPaymentTime=refundOrderTime+1000;
  const refundSeat=transaction(db,()=>{
    requireFreshDemo(db);
    addDemoAccounts(db,passwordHashes);
    appendSubscriptionTermWithinTransaction(db,{...initialTerm,operationId:randomUUID(),expectedRevision:0},{now:()=>initialTerm.startsAt});
    recordSeatCapacityGrantWithinTransaction(db,{...initialTerm,grantId:randomUUID(),seats:6},{now:()=>initialTerm.startsAt});
    return seatOrder(refundOrderTime);
  });
  const signedPayment=signSimulationPayment(paymentReceipt(refundSeat,refundPaymentTime),billingSimulation);
  const refundPayment=verifySimulationPaymentEnvelope(signedPayment.body,signedPayment.signature,billingSimulation);
  recordVerifiedSeatPayment(db,refundPayment,{now:()=>refundPaymentTime});
  fulfilSeatOrder(db,refundSeat.id,{now:()=>refundPaymentTime});
  const orders=transaction(db,()=>({
    refundSeat,
    timedOutAnnual:annualOrder(referenceTime-2*HOUR),
    annualRenewal:annualOrder(referenceTime),
    seatAddition:seatOrder(referenceTime),
  }));
  billingSimulation.lookupPayment=previewGateway(orders,refundPayment,billingSimulation,now);
  const cases=Object.fromEntries(Object.entries(orders).map(([name,order])=>[
    name,Object.freeze({kind:order.offer.product===SEAT_PRODUCT?'seat':'annual',orderId:order.id}),
  ]));
  return {billingSimulation:Object.freeze(billingSimulation),cases:Object.freeze(cases)};
}
