'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
const moduleUrl=pathToFileURL(path.resolve(__dirname,'../server/team/renewal-calendar.mjs')).href;
const api=import(moduleUrl),errors=import(pathToFileURL(path.resolve(__dirname,'../server/team/http-utils.mjs')).href);
const utc=value=>Date.parse(value),MAX_DATE=8640000000000000;
const invalid=error=>error?.name==='Error'&&error.status===400&&error.code==='INVALID_INPUT';

test('fixed Beijing year preserves normal clocks, milliseconds and the valid epoch zero',async()=>{
 const {addBeijingCalendarYear:add}=await api;
 for(const [from,to] of [['1970-01-01T00:00:00.000Z','1971-01-01T00:00:00.000Z'],['2026-11-18T07:08:09.123Z','2027-11-18T07:08:09.123Z'],['2023-03-01T12:34:56.789Z','2024-03-01T12:34:56.789Z']])assert.equal(add(utc(from)),utc(to),from);
 assert.equal(add(0),31536000000);
});

test('Beijing leap day clamps to Feb28 at the same local clock, including both UTC date boundaries',async()=>{
 const {addBeijingCalendarYear:add}=await api;
 const vectors=[
  ['2024-02-28T15:59:59.999Z','2025-02-28T15:59:59.999Z'],
  ['2024-02-28T16:00:00.000Z','2025-02-27T16:00:00.000Z'],
  ['2024-02-28T16:23:45.678Z','2025-02-27T16:23:45.678Z'],
  ['2024-02-29T15:59:59.999Z','2025-02-28T15:59:59.999Z'],
  ['2024-02-29T16:00:00.000Z','2025-02-28T16:00:00.000Z'],
  ['2023-02-28T16:00:00.001Z','2024-02-29T16:00:00.001Z']
 ];for(const [from,to] of vectors)assert.equal(add(utc(from)),utc(to),from);
 assert.equal(add(utc('2023-03-01T00:00:00Z'))-utc('2023-03-01T00:00:00Z'),366*86400000);
});

test('Gregorian century and four-century boundaries retain their real calendar days',async()=>{
 const {addBeijingCalendarYear:add}=await api;
 for(const [from,to] of [['2099-02-28T16:00:00.456Z','2100-02-28T16:00:00.456Z'],['2399-02-28T16:00:00.456Z','2400-02-29T16:00:00.456Z'],['2400-02-28T16:00:00.456Z','2401-02-27T16:00:00.456Z']])assert.equal(add(utc(from)),utc(to),from);
});

test('Beijing year end uses the local Jan1 boundary and preserves every millisecond',async()=>{
 const {addBeijingCalendarYear:add}=await api;
 for(const [from,to] of [['2024-12-31T15:59:59.999Z','2025-12-31T15:59:59.999Z'],['2024-12-31T16:00:00.000Z','2025-12-31T16:00:00.000Z'],['2025-01-01T00:00:00.001Z','2026-01-01T00:00:00.001Z']])assert.equal(add(utc(from)),utc(to));
});

test('no current term begins exactly at confirmation and returns only three frozen primitive fields',async()=>{
 const {annualRenewalWindow:window}=await api,at=utc('2024-02-28T16:01:02.003Z'),result=window(null,at);
 assert.deepEqual(result,{startsAt:at,endsAt:utc('2025-02-27T16:01:02.003Z'),renewalStartsAt:at});assert.equal(Object.isFrozen(result),true);assert.deepEqual(Object.keys(result),['startsAt','endsAt','renewalStartsAt']);
 assert.deepEqual(window(null,0),{startsAt:0,endsAt:31536000000,renewalStartsAt:0});assert.throws(()=>{result.startsAt=1;},TypeError);
});

test('early renewal retains the original start, appends at the original end and uses that Beijing calendar anniversary',async()=>{
 const {annualRenewalWindow:window}=await api,current=Object.freeze({startsAt:utc('2023-03-01T00:00:00Z'),endsAt:utc('2024-02-28T16:00:00.987Z')}),before={...current},result=window(current,utc('2024-02-01T00:00:00Z'));
 assert.deepEqual(result,{startsAt:current.startsAt,endsAt:utc('2025-02-27T16:00:00.987Z'),renewalStartsAt:current.endsAt});assert.deepEqual(current,before);assert.equal(Object.isFrozen(result),true);
});

test('a scheduled term also extends its end without moving its future original start to confirmation',async()=>{
 const {annualRenewalWindow:window}=await api,current={startsAt:utc('2027-01-01T00:00:00Z'),endsAt:utc('2028-01-01T00:00:00Z')};
 assert.deepEqual(window(current,utc('2026-12-01T00:00:00Z')),{startsAt:current.startsAt,endsAt:utc('2029-01-01T00:00:00Z'),renewalStartsAt:current.endsAt});
});

test('exact expiry and already expired terms restart at confirmation; the millisecond before expiry still appends',async()=>{
 const {annualRenewalWindow:window}=await api,current={startsAt:utc('2022-01-01T00:00:00Z'),endsAt:utc('2024-02-28T16:00:00.789Z')};
 const early=window(current,current.endsAt-1);assert.equal(early.startsAt,current.startsAt);assert.equal(early.renewalStartsAt,current.endsAt);
 assert.deepEqual(window(current,current.endsAt),{startsAt:current.endsAt,endsAt:utc('2025-02-27T16:00:00.789Z'),renewalStartsAt:current.endsAt});
 const late=utc('2032-02-28T16:00:00.456Z');assert.deepEqual(window(current,late),{startsAt:late,endsAt:utc('2033-02-27T16:00:00.456Z'),renewalStartsAt:late});
});

test('the last usable annual base reaches Date maximum exactly and never loses its valid final UTC+08 hours',async()=>{
 const {addBeijingCalendarYear:add,annualRenewalWindow:window}=await api,last=utc('+275759-09-13T00:00:00.000Z');assert.equal(Number.isFinite(last),true);
 assert.equal(add(last),MAX_DATE);assert.equal(add(last-1),MAX_DATE-1);assert.throws(()=>add(last+1),invalid);assert.throws(()=>add(MAX_DATE),invalid);
 assert.deepEqual(window(null,last),{startsAt:last,endsAt:MAX_DATE,renewalStartsAt:last});
 const current={startsAt:last-1000,endsAt:last};assert.deepEqual(window(current,last-1),{startsAt:last-1000,endsAt:MAX_DATE,renewalStartsAt:last});assert.throws(()=>window({startsAt:last,endsAt:MAX_DATE},last),invalid);
});

test('invalid scalar instants, Date overflow, wrappers and coercion hooks are rejected with the existing ApiError contract',async()=>{
 const {addBeijingCalendarYear:add,annualRenewalWindow:window}=await api,{ApiError}=await errors;let called=0;
 const bad=[undefined,null,false,true,'0',1n,-1,-0,0.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,MAX_DATE+1,new Date(0),new Number(0),{valueOf(){called++;return 0;}},{[Symbol.toPrimitive](){called++;return 0;}}];
 for(const value of bad){assert.throws(()=>add(value),error=>error instanceof ApiError&&invalid(error));assert.throws(()=>window(null,value),invalid);}
 assert.equal(called,0);
});

test('current terms must be exact passive plain intervals and reject getters or hooks without invoking them',async()=>{
 const {annualRenewalWindow:window}=await api;let called=0;const at=utc('2026-11-18T00:00:00Z'),term={startsAt:0,endsAt:at+1},bad=[undefined,false,0,'term',[],new Date(0),Object.assign(Object.create(null),term),Object.assign(Object.create({toJSON(){called++;return term;}}),term),{...term,extra:1},{...term,[Symbol('extra')]:1},{startsAt:1,endsAt:1},{startsAt:2,endsAt:1},{startsAt:-1,endsAt:1},{startsAt:0,endsAt:MAX_DATE+1},{startsAt:new Number(0),endsAt:1},{startsAt:0,endsAt:'1'}];
 for(const key of ['startsAt','endsAt']){const getter={...term};Object.defineProperty(getter,key,{enumerable:true,get(){called++;return term[key];}});bad.push(getter);}
 const hook={...term};Object.defineProperty(hook,'toJSON',{get(){called++;return()=>term;}});bad.push(hook);
 const hidden={...term};Object.defineProperty(hidden,'endsAt',{value:at+1,enumerable:false});bad.push(hidden);
 const proxy=new Proxy(term,{getPrototypeOf(){called++;return Object.prototype;},ownKeys(){called++;return ['startsAt','endsAt'];}});bad.push(proxy);const revoked=Proxy.revocable(term,{});revoked.revoke();bad.push(revoked.proxy);
 for(const value of bad)assert.throws(()=>window(value,at),invalid);assert.equal(called,0);
 const ordinary=Object.defineProperties({},{endsAt:{value:at+1,enumerable:true},startsAt:{value:0,enumerable:true}});assert.equal(window(ordinary,at).startsAt,0);
});

test('actual Node runs in different host timezones produce exactly the same Beijing arithmetic',()=>{
 const program=`const m=await import(${JSON.stringify(moduleUrl)});const at=Date.parse('2024-02-28T16:23:45.678Z');process.stdout.write(JSON.stringify({offset:new Date('2026-11-18T00:00:00Z').getTimezoneOffset(),add:m.addBeijingCalendarYear(at),window:m.annualRenewalWindow({startsAt:0,endsAt:at},at-1)}));`;
 const rows=[];for(const TZ of ['UTC','Asia/Shanghai','America/Los_Angeles','Pacific/Chatham']){const r=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',env:{...process.env,TZ},timeout:10000});assert.equal(r.status,0,r.stderr);rows.push(JSON.parse(r.stdout));}
 assert.deepEqual(rows.map(x=>x.offset),[0,-480,480,-825]);for(const row of rows.slice(1))assert.deepEqual({add:row.add,window:row.window},{add:rows[0].add,window:rows[0].window});
});
