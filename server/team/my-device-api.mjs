import {ApiError,deny,invalid,json,transaction} from './http-utils.mjs';
import {UUID,currentDeviceLease,deviceServerId,deviceConflict} from './device-policy.mjs';
const ROUTE='/api/auth/devices/overview',LIMIT=25;
const ACTIONS={device:new Set(['bound','proved','revoked']),replacement:new Set(['request','approve','reject','revoke','withdraw','claim','expire','stale'])};
const unavailable=()=>{throw new Error('Invalid own device overview data');};
const timestamp=value=>{if(!Number.isSafeInteger(value)||value<0)unavailable();return value;};
const uuid=value=>{if(typeof value!=='string'||!UUID.test(value))unavailable();return value;};
const name=value=>{if(typeof value!=='string'||!value.isWellFormed()||!value.trim()||[...value].length>80||/[\p{Cc}\p{Cf}]/u.test(value))unavailable();return value;};
const platform=value=>{if(!['win32','darwin'].includes(value))unavailable();return value;};
function cursor(url){
  if(url.hash||url.href.endsWith('?'))invalid();
  if([...url.searchParams.keys()].some(key=>key!=='before'||url.searchParams.getAll(key).length!==1))invalid();
  const value=url.searchParams.get('before');if(value===null)return null;
  if(!/^[DR]\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))invalid();
  return {kind:value[0]==='D'?'device':'replacement',id:value.slice(2)};
}
function lease(db,request,providers,context,at){
  if(providers.deviceProofRequired!==true||!context)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在已绑定设备上完成持钥登录后重试。');
  const identity=currentDeviceLease(db,request,at);
  if(identity.userId!==context.userId||identity.deviceId!==context.deviceId||identity.bindingRevision!==context.bindingRevision||identity.leaseId!==context.leaseId||identity.stamp!==context.stamp||deviceServerId(db)!==context.serverId)deviceConflict();
  return identity;
}
function sameLease(db,request,providers,context,before,serverId,at){
  const fresh=lease(db,request,providers,context,at);
  if(fresh.userId!==before.userId||fresh.token!==before.token||fresh.stamp!==before.stamp||fresh.leaseId!==before.leaseId||fresh.deviceId!==before.deviceId||fresh.bindingRevision!==before.bindingRevision||fresh.keyFingerprint!==before.keyFingerprint||deviceServerId(db)!==serverId)deviceConflict();
  return fresh;
}
function anchor(db,userId,before){
  if(!before)return null;
  const row=before.kind==='device'
    ?db.prepare(`SELECT event.created_at,event.event_id FROM team_device_events AS event
      JOIN team_device_bindings AS binding ON binding.device_id=event.device_id AND binding.user_id=event.user_id
      WHERE event.user_id=? AND event.event_id=?`).get(userId,before.id)
    :db.prepare(`SELECT event.created_at,event.event_id FROM team_device_replacement_events AS event
      JOIN team_device_replacement_requests AS application ON application.request_id=event.request_id
      WHERE application.user_id=? AND event.event_id=?`).get(userId,before.id);
  if(!row)deny();return {createdAt:timestamp(row.created_at),kind:before.kind,id:uuid(row.event_id)};
}
const EVENTS=`SELECT 'device' AS kind,event.event_id,event.action,binding.display_name,binding.platform,event.created_at
  FROM team_device_events AS event
  JOIN team_device_bindings AS binding ON binding.device_id=event.device_id AND binding.user_id=event.user_id
  WHERE event.user_id=?
  UNION ALL
  SELECT 'replacement' AS kind,event.event_id,event.action,application.display_name,application.platform,event.created_at
  FROM team_device_replacement_events AS event
  JOIN team_device_replacement_requests AS application ON application.request_id=event.request_id
  WHERE application.user_id=?`;
export async function handleMyDeviceRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
  const url=new URL(request.url);if(url.pathname!==ROUTE)return null;
  if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
  const before=cursor(url),initial=lease(db,request,identityProviders,deviceContext,now()),serverId=deviceServerId(db);
  return transaction(db,()=>{
    const actor=sameLease(db,request,identityProviders,deviceContext,initial,serverId,now());
    const row=db.prepare(`SELECT binding.device_id,binding.display_name,binding.platform,binding.status,binding.bound_at,usage.last_used_at
      FROM team_device_bindings AS binding LEFT JOIN team_device_usage AS usage ON usage.device_id=binding.device_id AND usage.user_id=binding.user_id
      WHERE binding.user_id=? AND binding.device_id=? AND binding.status='active'`).get(actor.userId,actor.deviceId);
    if(!row)deviceConflict();
    const position=anchor(db,actor.userId,before);
    const rows=db.prepare(`SELECT * FROM (${EVENTS}) AS timeline
      ${position?'WHERE created_at<? OR (created_at=? AND (kind<? OR (kind=? AND event_id<?)))':''}
      ORDER BY created_at DESC,kind DESC,event_id DESC LIMIT ?`).all(actor.userId,actor.userId,
        ...(position?[position.createdAt,position.createdAt,position.kind,position.kind,position.id]:[]),LIMIT+1);
    const device={id:uuid(row.device_id),displayName:name(row.display_name),platform:platform(row.platform),status:row.status,boundAt:timestamp(row.bound_at),lastUsedAt:row.last_used_at===null?null:timestamp(row.last_used_at)};
    if(device.status!=='active')unavailable();
    const events=rows.slice(0,LIMIT).map(event=>{
      if(!Object.hasOwn(ACTIONS,event.kind)||!ACTIONS[event.kind].has(event.action))unavailable();
      return {id:(event.kind==='device'?'D.':'R.')+uuid(event.event_id),kind:event.kind,action:event.action,displayName:name(event.display_name),platform:platform(event.platform),createdAt:timestamp(event.created_at)};
    });
    sameLease(db,request,identityProviders,deviceContext,actor,serverId,now());
    const hasMore=rows.length>LIMIT;return json({device,events,nextCursor:hasMore?events.at(-1).id:null,hasMore});
  });
}
