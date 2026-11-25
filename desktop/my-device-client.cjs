'use strict';
// Main-only, read-only account security view. No generic route or user target.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CURSOR=/^[DR]\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DEVICE_ACTIONS=new Set(['bound','proved','revoked']);
const REPLACEMENT_ACTIONS=new Set(['request','approve','reject','revoke','withdraw','claim','expire','stale']);
const timestamp=value=>Number.isSafeInteger(value)&&value>=0;
const name=value=>typeof value==='string'&&value.isWellFormed()&&value===value.trim()&&!!value&&[...value].length<=80&&!/[\p{Cc}\p{Cf}]/u.test(value);
function fields(value,allowed,required=allowed){
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const all=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(all);
 if(keys.some(key=>typeof key!=='string'||!allowed.includes(key)||!all[key].enumerable||!Object.hasOwn(all[key],'value'))||!required.every(key=>Object.hasOwn(all,key)))return null;
 return Object.fromEntries(keys.map(key=>[key,all[key].value]));
}
function myDeviceQuery(value,failure){
 const input=fields(value===undefined?{}:value,['before'],[]);
 if(!input||Object.hasOwn(input,'before')&&(typeof input.before!=='string'||!CURSOR.test(input.before)))throw failure('INVALID_INPUT','电脑记录查询参数无效，请刷新后重试。');
 return input;
}
function ordered(a,b){
 if(a.createdAt!==b.createdAt)return a.createdAt>b.createdAt;
 const ak=a.kind==='replacement'?'R':'D',bk=b.kind==='replacement'?'R':'D';
 return ak!==bk?ak>bk:a.id>b.id;
}
function createMyDeviceClient({request,failure,capture}={}){
 if(![request,failure,capture].every(fn=>typeof fn==='function'))throw Error('Missing my-device client dependencies');
 const bad=()=>{throw failure('INVALID_RESPONSE','本人电脑资料格式无效，请重新在线核对。');};
 function overview(value,expected,before){
  const top=fields(value,['device','events','nextCursor','hasMore']);if(!top)bad();
  const d=fields(top.device,['id','displayName','platform','status','boundAt','lastUsedAt']);
  if(!d||typeof d.id!=='string'||!UUID.test(d.id)||d.id!==expected||!name(d.displayName)||!['win32','darwin'].includes(d.platform)||d.status!=='active'||!timestamp(d.boundAt)||d.lastUsedAt!==null&&!timestamp(d.lastUsedAt))bad();
  if(!Array.isArray(top.events)||Object.getPrototypeOf(top.events)!==Array.prototype||top.events.length>25||typeof top.hasMore!=='boolean')bad();
  const arrayKeys=Reflect.ownKeys(top.events);if(arrayKeys.length!==top.events.length+1||arrayKeys.some(key=>key!=='length'&&(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=top.events.length)))bad();
  const events=[],seen=new Set();
  for(let i=0;i<top.events.length;i++){
   const entry=Object.getOwnPropertyDescriptor(top.events,String(i));if(!entry||!entry.enumerable||!Object.hasOwn(entry,'value'))bad();
   const e=fields(entry.value,['id','kind','action','displayName','platform','createdAt']);
   if(!e||typeof e.id!=='string'||!CURSOR.test(e.id)||!['device','replacement'].includes(e.kind)||e.id[0]!==({device:'D',replacement:'R'}[e.kind])||typeof e.action!=='string'||!(e.kind==='device'?DEVICE_ACTIONS:REPLACEMENT_ACTIONS).has(e.action)||!name(e.displayName)||!['win32','darwin'].includes(e.platform)||!timestamp(e.createdAt)||seen.has(e.id)||e.id===before)bad();
   if(events.length&&!ordered(events.at(-1),e))bad();seen.add(e.id);events.push({...e});
  }
  if(top.hasMore){if(events.length!==25||typeof top.nextCursor!=='string'||top.nextCursor!==events.at(-1).id)bad();}
  else if(top.nextCursor!==null)bad();
  return {device:{...d},events,nextCursor:top.nextCursor,hasMore:top.hasMore};
 }
 return Object.freeze({async getMyDeviceOverview(input){
  const query=myDeviceQuery(input,failure),context=capture();context.assertCurrent();
  const route='/api/auth/devices/overview'+(query.before?'?'+new URLSearchParams({before:query.before}):'');
  const value=await request(route,{beforeSend:context.assertCurrent,messagesOverride:{403:'请在当前获准电脑上重新在线核验。',404:'本人电脑记录无法访问，请刷新后重新查看。'}});
  context.assertCurrent();const result=overview(value,context.deviceId,query.before);context.assertCurrent();return result;
 }});
}
module.exports={createMyDeviceClient,myDeviceQuery};
