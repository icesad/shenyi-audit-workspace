'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMyDeviceClient}=require('../desktop/my-device-client.cjs');
const uuid=n=>n.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111';
const DEVICE=uuid(1),OTHER=uuid(2);
const error=(code,message)=>Object.assign(new Error(message),{code});
const clone=value=>structuredClone(value);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const event=(n,{kind='device',action=kind==='device'?'proved':'approve',createdAt=1000+n,...rest}={})=>({id:(kind==='device'?'D.':'R.')+uuid(n),kind,action,displayName:'合成电脑'+n,platform:'win32',createdAt,...rest});
const good=()=>({device:{id:DEVICE,displayName:'<img src=x> 办公电脑',platform:'win32',status:'active',boundAt:1000,lastUsedAt:1300},events:[event(3),event(2,{kind:'replacement'})],nextCursor:null,hasMore:false});
function fixture(){
 const state={actor:'a',generation:1,epoch:1,token:'private-token',deviceId:DEVICE,ready:true,value:good(),request:null},calls=[];
 const client=createMyDeviceClient({failure:error,capture(){if(!state.ready)throw error('DEVICE_NOT_READY','not ready');const expected=[state.actor,state.generation,state.epoch,state.token,state.deviceId];return{deviceId:state.deviceId,assertCurrent(){assert.ok(!calls.some(c=>c.body!==undefined));if(!state.ready||expected.some((v,i)=>v!==[state.actor,state.generation,state.epoch,state.token,state.deviceId][i]))throw error('SESSION_CHANGED','changed');}};},async request(route,options){calls.push({route,...options});options.beforeSend();return state.request?state.request():clone(state.value);}});
 return {state,calls,client};
}
test('own overview uses one fixed read route and returns only the exact safe DTO',async()=>{
 const f=fixture(),result=await f.client.getMyDeviceOverview();assert.deepEqual(result,good());assert.notEqual(result,f.state.value);assert.equal(f.calls.length,1);assert.equal(f.calls[0].route,'/api/auth/devices/overview');assert.equal(f.calls[0].method,undefined);assert.equal(f.calls[0].body,undefined);assert.ok(Object.isFrozen(f.client));
 assert.equal(Object.keys(f.client).join(','),'getMyDeviceOverview');for(const key of ['token','lease','serverId','userId','teamId','publicKey','keyFingerprint'])assert.ok(!JSON.stringify(result).includes('"'+key+'"'));
});
test('before cursor is typed and encoded into the same fixed route, with no target override',async()=>{
 for(const before of ['D.'+uuid(99),'R.'+uuid(99)]){const f=fixture();await f.client.getMyDeviceOverview({before});assert.equal(f.calls[0].route,'/api/auth/devices/overview?before='+before);}
});
test('every unknown or coercible input is rejected before capture or request',async()=>{
 const f=fixture();let getter=0;const accessor={};Object.defineProperty(accessor,'before',{enumerable:true,get(){getter++;return 'D.'+uuid(99);}});
 const bad=[null,[],['D.'+uuid(99)],0,'query',new Date(),Object.assign(Object.create(null),{}),Object.assign(Object.create({extra:true}),{}),{before:undefined},{before:null},{before:[]},{before:['D.'+uuid(99)]},{before:{toString(){throw Error('must not coerce');}}},{before:'d.'+uuid(99)},{before:'D.'+uuid(99).toUpperCase().replace('1111','AAAA')},{before:'D.'+uuid(99)+' '},{before:'https://evil.invalid'},accessor,{[Symbol('extra')]:true}];
 for(const key of ['userId','teamId','deviceId','url','limit','after','cursor','token','currentPassword'])bad.push({[key]:'private'});
 for(const input of bad)await assert.rejects(f.client.getMyDeviceOverview(input),{code:'INVALID_INPUT'});assert.equal(f.calls.length,0);assert.equal(getter,0);
});
test('explicit empty query is supported, while non-ready devices perform no network read',async()=>{const f=fixture();await f.client.getMyDeviceOverview({});f.state.ready=false;await assert.rejects(f.client.getMyDeviceOverview({}),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,1);});
test('null last-used is preserved without inventing time; server clock rollback is not coerced to bound time',async()=>{const f=fixture();f.state.value.device.lastUsedAt=null;assert.equal((await f.client.getMyDeviceOverview()).device.lastUsedAt,null);f.state.value.device.lastUsedAt=999;assert.equal((await f.client.getMyDeviceOverview()).device.lastUsedAt,999);});
test('all current binding fields require exact shape and explicitly typed values',async()=>{
 const f=fixture(),original=good();const cases=[null,[],{...original.device,privateKey:'private'},{...original.device,id:OTHER},{...original.device,id:[DEVICE]},{...original.device,platform:['win32']},{...original.device,status:'revoked'},{...original.device,boundAt:'1000'},{...original.device,boundAt:-1},{...original.device,boundAt:Number.MAX_SAFE_INTEGER+1},{...original.device,lastUsedAt:'1300'},{...original.device,lastUsedAt:NaN},{...original.device,displayName:'  合成电脑'},{...original.device,displayName:'bad\u202ename'},{...original.device,displayName:'bad\ud800'}];
 for(const value of cases){f.state.value={...good(),device:value};await assert.rejects(f.client.getMyDeviceOverview(),{code:'INVALID_RESPONSE'});}
});
test('top-level and event records reject private, inherited, hidden and accessor fields without reading getters',async()=>{
 const f=fixture(),value=good();let getter=0;const accessor={...value};Object.defineProperty(accessor,'device',{enumerable:true,get(){getter++;return value.device;}});
 const eventAccessor={...value.events[0]};Object.defineProperty(eventAccessor,'action',{enumerable:true,get(){getter++;return 'proved';}});
 const hidden={...value};Object.defineProperty(hidden,'private',{value:'secret',enumerable:false});
 const cases=[{...value,token:'private'},Object.assign(Object.create({private:true}),value),hidden,{...value,[Symbol('extra')]:true},accessor,{...value,events:[eventAccessor]},{...value,events:[{...value.events[0],actorId:'other-user'}]},{...value,events:[{...value.events[0],oldSnapshot:{private:true}}]}];
 for(const candidate of cases){f.state.request=async()=>candidate;await assert.rejects(f.client.getMyDeviceOverview(),{code:'INVALID_RESPONSE'});}assert.equal(getter,0);
});
test('all event fields require typed ids, source-specific actions, valid times and safe names',async()=>{
 const f=fixture(),original=event(3);const cases=[null,[],{...original,id:[original.id]},{...original,id:'R.'+uuid(3)},{...original,kind:['device']},{...original,kind:'administrator'},{...original,action:['proved']},{...original,action:'approve'},{...original,platform:'linux'},{...original,displayName:''},{...original,createdAt:'1003'},{...original,createdAt:Infinity},{...original,createdAt:-1}];
 for(const candidate of cases){f.state.value={...good(),events:[candidate]};await assert.rejects(f.client.getMyDeviceOverview(),{code:'INVALID_RESPONSE'});}
 for(const action of ['bound','proved','revoked']){f.state.value={...good(),events:[event(3,{action})]};assert.equal((await f.client.getMyDeviceOverview()).events[0].action,action);}
 for(const action of ['request','approve','reject','revoke','withdraw','claim','expire','stale']){f.state.value={...good(),events:[event(3,{kind:'replacement',action})]};assert.equal((await f.client.getMyDeviceOverview()).events[0].action,action);}
});
test('history is bounded, dense, unique and strictly descending across same-millisecond sources and ids',async()=>{
 const f=fixture();f.state.value.events=[event(4,{kind:'replacement',createdAt:2000}),event(3,{kind:'replacement',createdAt:2000}),event(9,{createdAt:2000}),event(8,{createdAt:2000})];assert.equal((await f.client.getMyDeviceOverview()).events.length,4);
 const sparse=[];sparse.length=1;const extra=[];extra.private='secret';const symbolic=[];symbolic[Symbol('extra')]=true;
 const bad=[null,{},sparse,extra,symbolic,Array.from({length:26},(_,i)=>event(26-i)),[event(1),event(2)],[event(2),event(2)],[event(3,{createdAt:2000}),event(2,{kind:'replacement',createdAt:2000})],[event(2,{createdAt:2000}),event(3,{createdAt:2000})]];
 for(const events of bad){f.state.request=async()=>({...good(),events});await assert.rejects(f.client.getMyDeviceOverview(),{code:'INVALID_RESPONSE'});}
});
test('hasMore requires a full25-page and its last event cursor; a final page has null cursor',async()=>{
 const f=fixture(),events=Array.from({length:25},(_,i)=>event(25-i));f.state.value={...good(),events,hasMore:true,nextCursor:events.at(-1).id};assert.equal((await f.client.getMyDeviceOverview()).nextCursor,events.at(-1).id);
 for(const patch of [{hasMore:1},{hasMore:'true'},{hasMore:true,nextCursor:null},{hasMore:true,nextCursor:'D.'+uuid(99)},{hasMore:false,nextCursor:events.at(-1).id},{hasMore:true,events:[]},{hasMore:true,events:events.slice(1)}]){f.state.value={...good(),events,hasMore:true,nextCursor:events.at(-1).id,...patch};await assert.rejects(f.client.getMyDeviceOverview(),{code:'INVALID_RESPONSE'});}
});
test('an exclusive before anchor cannot reappear as an event or next cursor',async()=>{const f=fixture(),before=f.state.value.events[0].id;await assert.rejects(f.client.getMyDeviceOverview({before}),{code:'INVALID_RESPONSE'});});
for(const change of ['actor','generation','epoch','token','deviceId','ready'])test('held response never publishes after '+change+' changes',async()=>{
 const f=fixture(),held=deferred();f.state.request=()=>held.promise;const pending=f.client.getMyDeviceOverview();const rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});f.state[change]=change==='ready'?false:change==='deviceId'?OTHER:change==='generation'||change==='epoch'?2:'changed';held.resolve(good());await rejected;
});
test('same account pause-resume ABA rejects old response even after ready becomes true again',async()=>{const f=fixture(),held=deferred();f.state.request=()=>held.promise;const pending=f.client.getMyDeviceOverview(),rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});f.state.ready=false;f.state.epoch++;f.state.ready=true;held.resolve(good());await rejected;});
