'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {API_BASE,validateTrustedTeamService,loadTeamServiceConfiguration}=require('../desktop/team-service-config.cjs');
const PROFILE={schemaVersion:1,apiBase:'https://team.example.invalid:9443',serverId:'11111111-1111-4111-8111-111111111111'};
const invalid=error=>error.code==='TEAM_SERVICE_CONFIGURATION_INVALID'&&error.message==='团队服务配置无效，请联系管理员检查受信服务配置。';
async function fixture(t,content=JSON.stringify(PROFILE)){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shenyi-service-config-')),filename=path.join(directory,'team.json');
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(filename,content);
  return {directory,filename,env:{SHENYI_TEAM_SERVICE_CONFIG:filename}};
}

test('remote profile is canonical, copied, exactly shaped and frozen',()=>{
  for(const apiBase of [PROFILE.apiBase,PROFILE.apiBase+'/','https://localhost:43321','https://[::1]:43321']){
    const input={...PROFILE,apiBase},actual=validateTrustedTeamService(input);
    assert.deepEqual(actual,{...PROFILE,apiBase:apiBase.replace(/\/$/,'')});assert.notEqual(actual,input);assert.ok(Object.isFrozen(actual));
    assert.deepEqual(Reflect.ownKeys(actual),['schemaVersion','apiBase','serverId']);assert.throws(()=>{actual.apiBase='https://other.invalid';},TypeError);
  }
});

test('remote profile rejects URL rewriting, credentials, path/query/fragment and nonstring values',()=>{
  const urls=['http://team.example.invalid','https://team.example.invalid/path','https://team.example.invalid//','https://team.example.invalid?','https://team.example.invalid#','https://team.example.invalid/?x=1','https://a:b@team.example.invalid','https://@team.example.invalid','HTTPS://team.example.invalid','https://TEAM.example.invalid','https://team.example.invalid:443','https://team.example.invalid/../','https:\\team.example.invalid',' https://team.example.invalid','https://team.example.invalid\n','https://team.example.invalid\u0085','https://team.example.invalid\ud800','https://team.example.invalid/a%2fb',null,1,['https://team.example.invalid'],{toString(){throw Error('must not coerce');}}];
  for(const apiBase of urls)assert.throws(()=>validateTrustedTeamService({...PROFILE,apiBase}),invalid);
});

test('profile identity fields cannot coerce and only lowercase UUIDv4 is accepted',()=>{
  for(const serverId of [PROFILE.serverId.toUpperCase().replace('1111','AAAA'),PROFILE.serverId.replace('-4111-','-1111-'),PROFILE.serverId.replace('-8111-','-7111-'),PROFILE.serverId+' ',[PROFILE.serverId],1,null,{toString(){return PROFILE.serverId;}}])assert.throws(()=>validateTrustedTeamService({...PROFILE,serverId}),invalid);
  for(const schemaVersion of ['1',true,[1],null,0,2,NaN])assert.throws(()=>validateTrustedTeamService({...PROFILE,schemaVersion}),invalid);
});

test('profile rejects unknown, symbolic, hidden, inherited and accessor fields without executing getters',()=>{
  let getters=0;const accessor={...PROFILE};Object.defineProperty(accessor,'apiBase',{enumerable:true,get(){getters++;return PROFILE.apiBase;}});
  const hidden={...PROFILE};Object.defineProperty(hidden,'serverId',{value:PROFILE.serverId,enumerable:false});
  const symbolic={...PROFILE,[Symbol('private')]:true},inherited=Object.assign(Object.create({hidden:true}),PROFILE);
  for(const value of [null,[],Object.values(PROFILE),Object.assign(Object.create(null),PROFILE),accessor,hidden,symbolic,inherited,{...PROFILE,ca:'pem'},{...PROFILE,rejectUnauthorized:false},{...PROFILE,__proto__:{untrusted:true}},{...PROFILE,password:'secret'},{...PROFILE,proxy:'http://other'},{schemaVersion:1,apiBase:PROFILE.apiBase}])assert.throws(()=>validateTrustedTeamService(value),invalid);
  assert.equal(getters,0);assert.deepEqual(validateTrustedTeamService(Object.freeze({...PROFILE})),PROFILE);
});

test('unpackaged absent config preserves local preview while packaged fails closed',async()=>{
  for(const env of [{},{SHENYI_TEAM_API:API_BASE},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}]){
    const value=await loadTeamServiceConfiguration({env,isPackaged:false});assert.deepEqual(value,{mode:'local-preview',profile:null});assert.ok(Object.isFrozen(value));
  }
  await assert.rejects(loadTeamServiceConfiguration({env:{},isPackaged:true}),invalid);
  for(const SHENYI_TEAM_API of ['',undefined,null,['http://127.0.0.1:8774'],'http://127.0.0.1:8774/','https://team.example.invalid'])await assert.rejects(loadTeamServiceConfiguration({env:{SHENYI_TEAM_API},isPackaged:false}),invalid);
});

test('absolute config loads once into frozen profile with exact compatibility semantics',async t=>{
  const f=await fixture(t,JSON.stringify({...PROFILE,apiBase:PROFILE.apiBase+'/'}));
  for(const isPackaged of [false,true])for(const extra of [{},{SHENYI_TEAM_API:PROFILE.apiBase},{NODE_TLS_REJECT_UNAUTHORIZED:'1'}]){
    const value=await loadTeamServiceConfiguration({env:{...f.env,...extra},isPackaged});assert.equal(value.mode,'remote-https');assert.deepEqual(value.profile,PROFILE);assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.profile));
  }
  const loaded=await loadTeamServiceConfiguration({env:f.env,isPackaged:false});await fs.writeFile(f.filename,JSON.stringify({...PROFILE,apiBase:'https://changed.invalid'}));assert.equal(loaded.profile.apiBase,PROFILE.apiBase);
  for(const SHENYI_TEAM_API of ['',undefined,API_BASE,PROFILE.apiBase+'/'])await assert.rejects(loadTeamServiceConfiguration({env:{...f.env,SHENYI_TEAM_API},isPackaged:false}),invalid);
});

test('remote rejects TLS bypass or unsupported TLS env without changing parent environment',async t=>{
  const f=await fixture(t),before=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  for(const NODE_TLS_REJECT_UNAUTHORIZED of ['0','','true','01',' 1',1,null,undefined,['1']])await assert.rejects(loadTeamServiceConfiguration({env:{...f.env,NODE_TLS_REJECT_UNAUTHORIZED},isPackaged:false}),invalid);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,before);
});

test('file path, environment accessors and option types fail with generic errors',async t=>{
  const f=await fixture(t);let getter=0;const env={};Object.defineProperty(env,'SHENYI_TEAM_SERVICE_CONFIG',{get(){getter++;return f.filename;}});
  await assert.rejects(loadTeamServiceConfiguration({env,isPackaged:false}),invalid);assert.equal(getter,0);
  for(const SHENYI_TEAM_SERVICE_CONFIG of ['',undefined,null,[],[f.filename],'relative.json','C:relative.json','\\relative.json','\\\\host\\share\\team.json','\\\\?\\C:\\team.json','//host/share/team.json',f.filename+'\0',f.filename+'\n'])await assert.rejects(loadTeamServiceConfiguration({env:{SHENYI_TEAM_SERVICE_CONFIG},isPackaged:false}),invalid);
  for(const value of [null,1,'false'])await assert.rejects(loadTeamServiceConfiguration({env:f.env,isPackaged:value}),invalid);
  for(const value of [null,1,'env'])await assert.rejects(loadTeamServiceConfiguration({env:value,isPackaged:false}),invalid);
  await assert.rejects(loadTeamServiceConfiguration({env:{SHENYI_TEAM_SERVICE_CONFIG:path.join(f.directory,'private-missing.json')},isPackaged:false}),invalid);
  await assert.rejects(loadTeamServiceConfiguration({env:{SHENYI_TEAM_SERVICE_CONFIG:f.directory},isPackaged:false}),invalid);
});

test('UTF8 JSON refuses duplicates including escaped keys, invalid bytes and unknown keys',async t=>{
  const bodies=['', '{', 'null','[]',JSON.stringify({...PROFILE,privateKey:'private'}),JSON.stringify(PROFILE).replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),JSON.stringify(PROFILE).replace('"apiBase":','"api\\u0042ase":"https://other.invalid","apiBase":'),JSON.stringify(PROFILE).replace('"serverId":','"serverId":"11111111-1111-4111-8111-111111111111","serverId":'),Buffer.from([0xff,0xfe,0x7b,0x7d])];
  const f=await fixture(t);
  for(const content of bodies){await fs.writeFile(f.filename,content);await assert.rejects(loadTeamServiceConfiguration({env:f.env,isPackaged:false}),invalid);}
  await fs.writeFile(f.filename,JSON.stringify(PROFILE).replace('"apiBase":','"api\\u0042ase":'));assert.deepEqual((await loadTeamServiceConfiguration({env:f.env,isPackaged:false})).profile,PROFILE);
});

test('configuration byte limit is inclusive and applies to bytes rather than characters',async t=>{
  const raw=JSON.stringify(PROFILE),f=await fixture(t,raw+' '.repeat(16384-Buffer.byteLength(raw)));
  assert.deepEqual((await loadTeamServiceConfiguration({env:f.env,isPackaged:false})).profile,PROFILE);
  await fs.appendFile(f.filename,' ');await assert.rejects(loadTeamServiceConfiguration({env:f.env,isPackaged:false}),invalid);
});

test('bounded file reader closes and reads at most 16385 bytes even if file grows after stat',async()=>{
  const code=syncFs.readFileSync(path.resolve(__dirname,'../desktop/team-service-config.cjs'),'utf8');
  for(const scenario of ['growing','non-file','chunks']){
    const bytes=Buffer.from(scenario==='growing'?' '.repeat(50000):JSON.stringify(PROFILE)),seen={read:0,closed:0,position:0},module={exports:{}};
    const file={async stat(){return {size:0,isFile:()=>scenario!=='non-file'};},async read(buffer,offset,length){seen.read+=length;const count=Math.min(length,bytes.length-seen.position,scenario==='chunks'?7:Infinity);bytes.copy(buffer,offset,seen.position,seen.position+count);seen.position+=count;return {bytesRead:count};},async close(){seen.closed++;}};
    vm.runInNewContext(code,{require:name=>name==='node:fs/promises'?{async open(){return file;}}:require(name),module,Buffer,URL,TextDecoder,process:{platform:process.platform,env:{}}});
    const promise=module.exports.loadTeamServiceConfiguration({env:{SHENYI_TEAM_SERVICE_CONFIG:path.resolve('synthetic-service.json')},isPackaged:false});
    if(scenario==='chunks'){const value=await promise;assert.equal(value.profile.apiBase,PROFILE.apiBase);assert.equal(seen.position,bytes.length);}
    else{await assert.rejects(promise,invalid);assert.equal(seen.position,scenario==='growing'?16385:0);}
    assert.equal(seen.closed,1);if(scenario==='growing')assert.equal(seen.read,16385);
  }
});
