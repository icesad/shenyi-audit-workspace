import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {countActiveBusinessSeats} from './subscription-store.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';

const MAX=Number.MAX_SAFE_INTEGER,MAX_BIG=BigInt(MAX),UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const FIELDS=['grantId','teamId','seats','startsAt','endsAt','sourceRef'];
const matches=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v;
const integer=(v,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&!Object.is(v,-0)&&v>=min;
const ref=v=>typeof v==='string'&&v.isWellFormed()&&[...v].length>=1&&[...v].length<=128&&!/[\p{Cc}\p{Cf}]/u.test(v);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const conflict=()=>{throw new ApiError(409,'SEAT_CAPACITY_CONFLICT','席位容量记录无法核实，请重新核对。');};
function input(value){
 if(!value||typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length!==FIELDS.length||keys.some(k=>typeof k!=='string'||!FIELDS.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))invalid();
 const v=Object.fromEntries(FIELDS.map(k=>[k,ds[k].value]));
 if(!matches(UUID,v.grantId)||!matches(ID,v.teamId)||!integer(v.seats,1)||!integer(v.startsAt)||!integer(v.endsAt)||v.endsAt<=v.startsAt||!ref(v.sourceRef))invalid();return v;
}
function typed(v,min=0){if(typeof v!=='bigint'||v<BigInt(min)||v>MAX_BIG)conflict();return Number(v);}
function one(db,sql,...args){const q=db.prepare(sql);q.setReadBigInts(true);return q.get(...args);}
function team(db,teamId){if(!matches(ID,teamId))invalid();if(!one(db,"SELECT 1 FROM teams WHERE team_id=? AND status='active'",teamId))deny();}
function fact(row){
 if(!row||!matches(UUID,row.grant_id)||!matches(ID,row.team_id)||!ref(row.source_ref)||!matches(SHA,row.request_sha256))conflict();
 const receipt={grantId:row.grant_id,teamId:row.team_id,seats:typed(row.seats,1),startsAt:typed(row.starts_at),endsAt:typed(row.ends_at),recordedAt:typed(row.recorded_at),sourceRef:row.source_ref};
 if(receipt.endsAt<=receipt.startsAt)conflict();
 const request=Object.fromEntries(FIELDS.map(k=>[k,receipt[k]]));if(digest(request)!==row.request_sha256)conflict();return Object.freeze(receipt);
}

// Trusted internal capacity fact, never a payment claim or an HTTP grant. It
// owns its transaction and cannot accidentally commit a caller's transaction.
export function recordSeatCapacityGrant(db,value,{now=Date.now}={}){
 const v=input(value),hash=digest(v);if(typeof now!=='function')invalid();if(db.isTransaction===true)conflict();let began=false;
 try{
  db.exec('BEGIN IMMEDIATE');began=true;team(db,v.teamId);
  const previous=one(db,'SELECT * FROM team_seat_capacity_grants WHERE grant_id=?',v.grantId);
  if(previous){const receipt=fact(previous);if(receipt.teamId!==v.teamId||previous.request_sha256!==hash)conflict();db.exec('COMMIT');began=false;return receipt;}
  const recordedAt=now();if(!integer(recordedAt))conflict();
  const inserted=db.prepare('INSERT INTO team_seat_capacity_grants(grant_id,team_id,seats,starts_at,ends_at,recorded_at,source_ref,request_sha256) VALUES (?,?,?,?,?,?,?,?)').run(v.grantId,v.teamId,v.seats,v.startsAt,v.endsAt,recordedAt,v.sourceRef,hash);
  if(inserted.changes!==1)conflict();const receipt=fact(one(db,'SELECT * FROM team_seat_capacity_grants WHERE grant_id=?',v.grantId));
  if(receipt.teamId!==v.teamId||receipt.recordedAt!==recordedAt||FIELDS.some(k=>receipt[k]!==v[k]))conflict();team(db,v.teamId);
  db.exec('COMMIT');began=false;return receipt;
 }catch(error){if(began)try{db.exec('ROLLBACK');}catch{}if(error instanceof ApiError)throw error;if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();throw error;}
}

function read(db,teamId,at){
 team(db,teamId);let purchased=0n;const grants=db.prepare('SELECT * FROM team_seat_capacity_grants WHERE team_id=? ORDER BY grant_id');grants.setReadBigInts(true);
 for(const row of grants.iterate(teamId)){const current=fact(row);if(current.teamId!==teamId)conflict();if(current.startsAt<=at&&at<current.endsAt){purchased+=BigInt(current.seats);if(purchased>MAX_BIG)conflict();}}
 const activeBusinessSeats=countActiveBusinessSeats(db,teamId);if(!integer(activeBusinessSeats))conflict();
 // Each pending invitation is a separate hold, even across sources or after
 // its inviter loses eligibility. Restoring that role does not create a seat
 // mutation; current activation authorization must still deny an invalid inviter.
 const reserved=typed(one(db,`SELECT COUNT(*) AS seats FROM (
  SELECT 1 FROM team_invitations WHERE team_id=? AND accepted_at IS NULL AND expires_at>?
  UNION ALL SELECT 1 FROM team_employee_invitations WHERE team_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?
  UNION ALL SELECT 1 FROM team_operator_employee_invitations WHERE team_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?
 )`,teamId,at,teamId,at,teamId,at).seats);
 const used=BigInt(activeBusinessSeats)+BigInt(reserved);if(used>MAX_BIG)conflict();
 return Object.freeze({purchasedSeats:Number(purchased),activeBusinessSeats,reservedInvitationSeats:reserved,usedSeats:Number(used),availableSeats:Number(purchased>used?purchased-used:0n)});
}
// A coherent read snapshot outside a transaction; when the caller already owns
// one, stay synchronous inside it without beginning, committing or rolling it back.
export function readSeatCapacity(db,teamId,at){
 if(!matches(ID,teamId)||!integer(at))invalid();if(db.isTransaction===true)return read(db,teamId,at);let began=false;
 try{db.exec('BEGIN');began=true;const result=read(db,teamId,at);db.exec('COMMIT');began=false;return result;}
 catch(error){if(began)try{db.exec('ROLLBACK');}catch{}throw error;}
}
