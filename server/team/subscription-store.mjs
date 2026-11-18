import {createHash} from 'node:crypto';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';

const MAX=Number.MAX_SAFE_INTEGER,MAX_BIG=BigInt(MAX),UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIELDS=['teamId','operationId','expectedRevision','startsAt','endsAt','sourceRef'];
const matches=(re,value)=>typeof value==='string'&&re.exec(value)?.[0]===value;
const integer=(value,min=0)=>typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min;
const ref=value=>typeof value==='string'&&value.isWellFormed()&&[...value].length>=1&&[...value].length<=128&&!/[\p{Cc}\p{Cf}]/u.test(value);
const conflict=()=>{throw new ApiError(409,'SUBSCRIPTION_CONFLICT','订阅记录或版本无法核实，请重新核对。');};
const unavailable=()=>{throw new ApiError(402,'SUBSCRIPTION_WRITE_UNAVAILABLE','当前团队订阅不允许新增或修改业务资料。');};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function teamInput(teamId){if(!matches(ID,teamId))invalid();return teamId;}
function passiveInput(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length!==FIELDS.length||keys.some(k=>typeof k!=='string'||!FIELDS.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))invalid();
 const v=Object.fromEntries(FIELDS.map(k=>[k,ds[k].value]));
 if(!matches(ID,v.teamId)||!matches(UUID,v.operationId)||!integer(v.expectedRevision)||v.expectedRevision>=MAX||!integer(v.startsAt)||!integer(v.endsAt)||v.endsAt<=v.startsAt||!ref(v.sourceRef))invalid();
 return v;
}
function storedInteger(value,min=0){if(typeof value!=='bigint'||value<BigInt(min)||value>MAX_BIG)conflict();return Number(value);}
function query(db,sql,...args){const statement=db.prepare(sql);statement.setReadBigInts(true);return statement.get(...args);}
function eventValue(row){
 if(!row||!matches(ID,row.team_id)||!matches(UUID,row.operation_id)||!ref(row.source_ref)||!matches(/^[0-9a-f]{64}$/,row.request_sha256))conflict();
 const value={teamId:row.team_id,operationId:row.operation_id,revision:storedInteger(row.revision,1),startsAt:storedInteger(row.starts_at),endsAt:storedInteger(row.ends_at),recordedAt:storedInteger(row.recorded_at),sourceRef:row.source_ref};
 if(value.endsAt<=value.startsAt)conflict();
 const request={teamId:value.teamId,operationId:value.operationId,expectedRevision:value.revision-1,startsAt:value.startsAt,endsAt:value.endsAt,sourceRef:value.sourceRef};
 if(digest(request)!==row.request_sha256)conflict();return Object.freeze(value);
}
function ledger(db,teamId){
 const row=query(db,`SELECT head.team_id AS head_team_id,head.revision AS head_revision,event.*
 FROM teams team LEFT JOIN team_subscription_heads head ON head.team_id=team.team_id
 LEFT JOIN team_subscription_events event ON event.team_id=team.team_id
  AND event.revision=(SELECT MAX(latest.revision) FROM team_subscription_events latest WHERE latest.team_id=team.team_id)
 WHERE team.team_id=? AND team.status='active'`,teamId);
 if(!row)deny();
 if(row.head_team_id===null){if(row.operation_id!==null)conflict();return null;}
 if(row.head_team_id!==teamId||row.operation_id===null)conflict();
 const current=eventValue(row);if(current.teamId!==teamId||storedInteger(row.head_revision,1)!==current.revision)conflict();return current;
}
function serverNow(now){if(typeof now!=='function')invalid();const at=now();if(!integer(at))conflict();return at;}

export function countActiveBusinessSeats(db,teamId){
 teamInput(teamId);
 const row=query(db,`SELECT COUNT(DISTINCT member.user_id) AS seats FROM team_memberships member
 JOIN team_users account ON account.user_id=member.user_id AND account.status='active'
 JOIN teams team ON team.team_id=member.team_id AND team.status='active'
 WHERE member.team_id=? AND member.status='active' AND member.role IN ('intern','assistant','manager','partner')
 AND ${administratorBusinessEligibilitySql('member')}`,teamId);
 return storedInteger(row.seats);
}
export function readSubscriptionState(db,teamId,at){
 teamInput(teamId);if(!integer(at))invalid();const current=ledger(db,teamId);
 return Object.freeze({teamId,revision:current?.revision??0,startsAt:current?.startsAt??null,endsAt:current?.endsAt??null,
  state:current===null?'unconfigured':at<current.startsAt?'scheduled':at<current.endsAt?'active':'expired',activeBusinessSeats:countActiveBusinessSeats(db,teamId)});
}
// Trusted service only. sourceRef is opaque provenance, not proof of payment.
export function recordSubscriptionTerm(db,input,{now=Date.now}={}){
 const v=passiveInput(input),requestSha256=digest(v);if(typeof now!=='function')invalid();let began=false;
 try{
  db.exec('BEGIN IMMEDIATE');began=true;const current=ledger(db,v.teamId);
  const prior=query(db,'SELECT * FROM team_subscription_events WHERE operation_id=?',v.operationId);
  if(prior){const receipt=eventValue(prior);if(receipt.teamId!==v.teamId||prior.request_sha256!==requestSha256)conflict();db.exec('COMMIT');began=false;return receipt;}
  if((current?.revision??0)!==v.expectedRevision)conflict();
  const revision=v.expectedRevision+1,recordedAt=serverNow(now);
  const inserted=db.prepare('INSERT INTO team_subscription_events(operation_id,team_id,revision,starts_at,ends_at,recorded_at,source_ref,request_sha256) VALUES (?,?,?,?,?,?,?,?)').run(v.operationId,v.teamId,revision,v.startsAt,v.endsAt,recordedAt,v.sourceRef,requestSha256);
  if(inserted.changes!==1)conflict();
  const head=current?db.prepare('UPDATE team_subscription_heads SET revision=? WHERE team_id=? AND revision=?').run(revision,v.teamId,v.expectedRevision):db.prepare('INSERT INTO team_subscription_heads(team_id,revision) VALUES (?,?)').run(v.teamId,revision);
  if(head.changes!==1)conflict();const receipt=ledger(db,v.teamId);
  if(!receipt||receipt.operationId!==v.operationId||receipt.revision!==revision||receipt.recordedAt!==recordedAt)conflict();
  db.exec('COMMIT');began=false;return receipt;
 }catch(error){
  if(began)try{db.exec('ROLLBACK');}catch{}
  if(error instanceof ApiError)throw error;
  if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();throw error;
 }
}
// Call assertCurrent again inside the caller's final publication transaction.
// This condition never substitutes for account/team/device/project/module checks.
export function captureSubscriptionWriteGuard(db,teamId,{now=Date.now}={}){
 const at=serverNow(now),captured=readSubscriptionState(db,teamId,at);if(captured.state!=='active')unavailable();let latestAt=at;
 return Object.freeze({revision:captured.revision,assertCurrent(){
  const nextAt=serverNow(now);if(nextAt<latestAt)conflict();latestAt=nextAt;
  const current=readSubscriptionState(db,teamId,nextAt);
  if(current.revision!==captured.revision||current.startsAt!==captured.startsAt||current.endsAt!==captured.endsAt)conflict();
  if(current.state!=='active')unavailable();
 }});
}
