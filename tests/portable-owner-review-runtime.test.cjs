'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const configuration=require('../desktop/isolated-preview-config.cjs');
const {OWNER_REVIEW_RUNTIME_MARKER,loadOwnerReviewRuntime,prepareIsolatedPreviewDirectory,writeIsolatedPreviewConfiguration,loadIsolatedPreviewConfiguration}=configuration;
const BASE=process.platform==='win32'?'D:/codex-temp/shenyi-m8-portable-owner-review-20261119/runtime-tests':path.join(os.tmpdir(),'shenyi-portable-owner-review-tests');
const invalid={code:'ISOLATED_PREVIEW_CONFIGURATION_INVALID'};
const serverId='11111111-1111-4111-8111-111111111111';
async function fixture({marker=true,electron=true}={}){
 await fs.mkdir(BASE,{recursive:true});const appRoot=await fs.mkdtemp(path.join(BASE,"review 'space-"));
 if(marker)await fs.writeFile(path.join(appRoot,'owner-review-runtime.json'),OWNER_REVIEW_RUNTIME_MARKER);
 if(electron){await fs.mkdir(path.join(appRoot,'runtime','electron'),{recursive:true});await fs.writeFile(path.join(appRoot,'runtime','electron','electron.exe'),'synthetic non-executable fixture');}
 return appRoot;
}
async function profile(appRoot){
 const prepared=await prepareIsolatedPreviewDirectory({appRoot});await fs.mkdir(prepared.desktopDataDirectory);
 return writeIsolatedPreviewConfiguration({...prepared,apiBase:'http://127.0.0.1:23456',serverId});
}
const envFor=context=>({SHENYI_ISOLATED_PREVIEW_CONFIG:context.configFile,SHENYI_DESKTOP_DATA_DIR:context.desktopDataDirectory});
const windows={skip:process.platform!=='win32'||process.arch!=='x64'};

test('owner-review marker has exact public schema and a literal final newline',()=>{
 assert.equal(OWNER_REVIEW_RUNTIME_MARKER,'{"schemaVersion":1,"kind":"shenyi-owner-review-windows-x64"}\n');
 assert.equal(Buffer.from(OWNER_REVIEW_RUNTIME_MARKER).at(-1),10);
});

test('absent marker keeps legacy behavior and ignores untrusted owner-review environment',async()=>{
 const appRoot=await fixture({marker:false,electron:false});
 assert.equal(await loadOwnerReviewRuntime({appRoot}),null);
 assert.equal(await loadIsolatedPreviewConfiguration({appRoot,env:{SHENYI_OWNER_REVIEW_ROOT:appRoot,SHENYI_OWNER_REVIEW_RUNTIME:'1'}}),null);
 assert.equal(await loadIsolatedPreviewConfiguration({appRoot,env:{},isPackaged:true,rootDirectory:'\0not-opened'}),null);
});

test('portable paths derive only from the module root and require Windows x64',windows,async()=>{
 const appRoot=await fixture(),runtime=await loadOwnerReviewRuntime({appRoot});
 assert.deepEqual(runtime,{appRoot,rootDirectory:path.join(appRoot,'review-runs'),electronExecutable:path.join(appRoot,'runtime','electron','electron.exe')});
 assert.equal(Object.isFrozen(runtime),true);
 for(const options of [{platform:'linux'},{platform:'darwin'},{arch:'arm64'}])await assert.rejects(loadOwnerReviewRuntime({appRoot,...options}),invalid);
 const context=await profile(appRoot),loaded=await loadIsolatedPreviewConfiguration({appRoot,env:{...envFor(context),SHENYI_OWNER_REVIEW_ROOT:'D:/unrelated',SHENYI_OWNER_REVIEW_ELECTRON:'D:/unrelated.exe'}});
 assert.equal(loaded.configFile,context.configFile);assert.equal(loaded.profile.serverId,serverId);
 const override=path.join(appRoot,'unrelated');
 await assert.rejects(prepareIsolatedPreviewDirectory({appRoot,rootDirectory:override}),invalid);
 await assert.rejects(loadIsolatedPreviewConfiguration({appRoot,env:envFor(context),rootDirectory:override}),invalid);
 await assert.rejects(fs.access(override),{code:'ENOENT'});
});

test('invalid present markers fail closed without developer fallback',windows,async()=>{
 const appRoot=await fixture(),filename=path.join(appRoot,'owner-review-runtime.json');
 for(const text of ['',OWNER_REVIEW_RUNTIME_MARKER.trimEnd(),OWNER_REVIEW_RUNTIME_MARKER.replace('\n','\r\n'),'\ufeff'+OWNER_REVIEW_RUNTIME_MARKER,OWNER_REVIEW_RUNTIME_MARKER+' ',OWNER_REVIEW_RUNTIME_MARKER.replace('1,','2,'),'x'.repeat(4097),'{"schemaVersion":1,"kind":"shenyi-owner-review-windows-x64","path":"D:/other"}\n']){
  await fs.writeFile(filename,text);await assert.rejects(loadOwnerReviewRuntime({appRoot}),invalid);
  await assert.rejects(loadIsolatedPreviewConfiguration({appRoot,env:{}}),invalid);
  await assert.rejects(prepareIsolatedPreviewDirectory({appRoot}),invalid);
 }
 await assert.rejects(fs.access(path.join(appRoot,'review-runs')),{code:'ENOENT'});
});

test('portable startup needs its generated isolated configuration; packaged startup ignores marker',windows,async()=>{
 const appRoot=await fixture();
 await assert.rejects(loadIsolatedPreviewConfiguration({appRoot,env:{}}),invalid);
 const context=await profile(appRoot);
 await assert.rejects(loadIsolatedPreviewConfiguration({appRoot,env:{SHENYI_TEAM_SERVICE_CONFIG:path.join(appRoot,'foreign.json')}}),invalid);
 for(const extra of [{SHENYI_TEAM_API:'http://127.0.0.1:8774'},{SHENYI_TEAM_SERVICE_CONFIG:'foreign.json'},{SHENYI_TEAM_REVIEW_DEMO:'1'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}])await assert.rejects(loadIsolatedPreviewConfiguration({appRoot,env:{...envFor(context),...extra}}),invalid);
 assert.equal(await loadIsolatedPreviewConfiguration({appRoot,env:{},isPackaged:true}),null);
 await assert.rejects(loadIsolatedPreviewConfiguration({appRoot,env:envFor(context),isPackaged:true}),invalid);
 await fs.writeFile(path.join(appRoot,'owner-review-runtime.json'),'invalid');
 assert.equal(await loadIsolatedPreviewConfiguration({appRoot,env:{},isPackaged:true}),null);
});

test('marker and fixed Electron must be ordinary single-link files',windows,async()=>{
 const missing=await fixture({electron:false});await assert.rejects(loadOwnerReviewRuntime({appRoot:missing}),invalid);
 const directory=await fixture({electron:false});await fs.mkdir(path.join(directory,'runtime','electron','electron.exe'),{recursive:true});await assert.rejects(loadOwnerReviewRuntime({appRoot:directory}),invalid);
 const marker=await fixture(),markerFile=path.join(marker,'owner-review-runtime.json');await fs.link(markerFile,path.join(marker,'alias'));await assert.rejects(loadOwnerReviewRuntime({appRoot:marker}),invalid);
 const electron=await fixture(),electronFile=path.join(electron,'runtime','electron','electron.exe');await fs.link(electronFile,path.join(electron,'alias.exe'));await assert.rejects(loadOwnerReviewRuntime({appRoot:electron}),invalid);
 const reparse=await fixture({electron:false}),external=await fixture();await fs.symlink(path.join(external,'runtime'),path.join(reparse,'runtime'),'junction');await assert.rejects(loadOwnerReviewRuntime({appRoot:reparse}),invalid);
 assert.equal(await fs.readFile(path.join(external,'runtime','electron','electron.exe'),'utf8'),'synthetic non-executable fixture');
});

test('parallel first portable launches publish one complete root marker and distinct candidates',windows,async()=>{
 const appRoot=await fixture(),prepared=await Promise.all(Array.from({length:8},()=>prepareIsolatedPreviewDirectory({appRoot})));
 assert.equal(new Set(prepared.map(item=>item.candidateId)).size,8);
 assert.equal(new Set(prepared.map(item=>item.directory)).size,8);
 for(const item of prepared)assert.equal(path.dirname(item.directory),path.join(appRoot,'review-runs'));
 assert.equal(await fs.readFile(path.join(appRoot,'review-runs','isolated-preview-root.json'),'utf8'),'{"schemaVersion":1,"kind":"shenyi-isolated-preview-root"}\n');
 assert.deepEqual((await fs.readdir(path.join(appRoot,'review-runs'))).filter(name=>name.endsWith('.pending')),[]);
});

test('two independent processes race safely during first portable root creation',windows,async()=>{
 const appRoot=await fixture();await fs.mkdir(path.join(appRoot,'desktop'));
 await fs.copyFile(path.resolve(__dirname,'../desktop/isolated-preview-config.cjs'),path.join(appRoot,'desktop','isolated-preview-config.cjs'));
 const code='require(process.argv[1]).prepareIsolatedPreviewDirectory().then(v=>console.log(JSON.stringify({directory:v.directory})),()=>process.exitCode=1)';
 function run(){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',code,path.join(appRoot,'desktop','isolated-preview-config.cjs')],{windowsHide:true});let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.once('error',reject);child.once('close',status=>{try{assert.equal(status,0,err);assert.equal(err,'');resolve(JSON.parse(out));}catch(e){reject(e);}});});}
 const [first,second]=await Promise.all([run(),run()]);assert.notEqual(first.directory,second.directory);assert.equal(path.dirname(first.directory),path.join(appRoot,'review-runs'));assert.equal(path.dirname(second.directory),path.join(appRoot,'review-runs'));
});

test('a root-marker reader retries strict verification after publisher hard-link retirement',{...windows,timeout:10000},async t=>{
 const appRoot=await fixture(),marker=path.join(appRoot,'review-runs','isolated-preview-root.json');
 const originalOpen=fs.open,originalUnlink=fs.unlink;
 let firstRead,secondRead,retired;const firstReading=new Promise(resolve=>firstRead=resolve),secondReading=new Promise(resolve=>secondRead=resolve),publisherRetired=new Promise(resolve=>retired=resolve);let reads=0;
 fs.open=async function(filename,...args){
  const handle=await originalOpen.call(this,filename,...args);if(filename!==marker)return handle;
  const originalRead=handle.read;let initial=true;
  handle.read=async function(...readArgs){
   if(initial){initial=false;const order=++reads;if(order===1){firstRead();await secondReading;}else if(order===2){secondRead();await publisherRetired;}}
   return originalRead.apply(this,readArgs);
  };
  return handle;
 };
 fs.unlink=async function(filename,...args){const result=await originalUnlink.call(this,filename,...args);if(path.dirname(filename)===path.dirname(marker)&&path.basename(filename).endsWith('.pending'))retired();return result;};
 t.after(()=>{fs.open=originalOpen;fs.unlink=originalUnlink;firstRead();secondRead();retired();});
 const publisher=prepareIsolatedPreviewDirectory({appRoot});await firstReading;
 const reader=prepareIsolatedPreviewDirectory({appRoot}),prepared=await Promise.all([publisher,reader]);
 assert.notEqual(prepared[0].directory,prepared[1].directory);assert.ok(reads>=4,'strict root marker verification must be retried after ctime changes');
 assert.equal(await fs.readFile(marker,'utf8'),'{"schemaVersion":1,"kind":"shenyi-isolated-preview-root"}\n');
});

test('portable profile and root guards preserve foreign data',windows,async()=>{
 const appRoot=await fixture(),root=path.join(appRoot,'review-runs');await fs.mkdir(root);const sentinel=path.join(root,'foreign.txt');await fs.writeFile(sentinel,'synthetic unrelated marker');
 await assert.rejects(prepareIsolatedPreviewDirectory({appRoot}),invalid);assert.equal(await fs.readFile(sentinel,'utf8'),'synthetic unrelated marker');
 const other=await fixture(),context=await profile(other);
 await assert.rejects(loadIsolatedPreviewConfiguration({appRoot:await fixture(),env:envFor(context)}),invalid);
 const guarded=await fixture(),outside=await fixture();await fs.symlink(outside,path.join(guarded,'review-runs'),'junction');await assert.rejects(prepareIsolatedPreviewDirectory({appRoot:guarded}),invalid);assert.deepEqual(await fs.readdir(outside),['owner-review-runtime.json','runtime']);
});
