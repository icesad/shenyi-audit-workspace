const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createWorkpaperDataFixture,good,denied,sha,source,restorePasswordWork}=require('./workpaper-data-fixture.cjs');
const {excel,word,legacy,zip}=require('./workpaper-office-fixture.cjs');
async function formFixture(t,{kind='xlsx',freeze=false,standalone=false,wrongIndex=false,prepareRecord,originalDocument}={}){
 const f=await createWorkpaperDataFixture(t,{freeze:false}),document=originalDocument||(kind==='docx'?word():kind==='doc'?legacy():excel({type:kind})),raw=zip([{name:document.name,data:document.bytes}]),H=sha(raw),archive={name:'合成原表包.zip',hash:H,blob:new Blob([raw],{type:'application/zip'})},index=[{name:document.name,path:document.name,sha256:document.sha256,size:document.bytes.length}],record=f.pack.record;
 record.archive=archive;record.index=index;record.workpaperSources={[H]:{archive,index,phase:3,canonicalName:archive.name}};record.answers={};record.docAnswers={};record.workpaperLocks={};
 if(freeze){record.answers[document.sha256]={'原表':{A2:'saved before freeze'}};const target={id:document.sha256+'::原表',sha256:document.sha256,path:document.name,archiveId:H,kind:'excel',sheet:'原表',fields:['A2'],fieldPolicy:'declared-structural-blank-input-boxes-v1'},context=vm.createContext({Blob,TextEncoder,crypto:crypto.webcrypto,WorkpaperRouteCatalog:{rows:{8:{mode:'targets',targets:[target]}}}});for(const name of ['workpaper-routing.js','workpaper-governance.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../dist',name),'utf8'),context);record.workpaperLocks[8]=structuredClone(await context.WorkpaperGovernance.createLock(record,8,[target],{name:'合成核对人',attested:true},{files:index.map(x=>({...x,archiveId:H,archive})),sources:[{archive,index,phase:3}]}));}
 if(wrongIndex){record.index[0].sha256='a'.repeat(64);}
 if(standalone){record.archive=null;record.index=[];record.workpaperSources={};record.supplementalWorkpapers[0].file={name:document.name,mime:'application/octet-stream',size:document.bytes.length,sha256:document.sha256,blob:new Blob([document.bytes],{type:'application/octet-stream'})};}
 if(prepareRecord)await prepareRecord({record,document,archive,index});
 const made=await require('../../dist/workpaper-package.js').create({record,readCurrent:async()=>record}),bytes=Buffer.from(made.bytes),requestId=await f.upload({input:bytes});good(await f.commit(requestId),201);
 const form=({current=f.actor,hash=document.sha256,version=1,search='?version='+version+'&projectRevision='+f.dataRevision()+'&grantRevision='+f.dataGrantRevision(current.account.id),...settings}={})=>f.api(f.wpRoute()+'/forms/'+hash+search,{session:current,...settings});
 return{...f,document,H,raw,record,bytes,requestId,form};
}
function holdOfficeResult(t){
 const {Worker}=require('node:worker_threads'),original=Worker.prototype.once,entered=Promise.withResolvers();let selected=null,callback=null,payload=null,queued=[],active=true,held=false;entered.promise.catch(()=>{});
 Worker.prototype.once=function(event,listener){
  if(active&&event==='message'&&!selected){selected=this;return original.call(this,event,data=>{if(!data?.form){entered.reject(Error('Actual form was not produced'));return listener(data);}held=true;callback=listener;payload=data;entered.resolve(data.form.sha256);});}
  if(active&&this===selected&&['exit','error'].includes(event))return original.call(this,event,(...args)=>{if(held&&active){queued.push(()=>listener(...args));return;}if(active)entered.reject(Error('Office worker ended before a form'));listener(...args);});
  return original.call(this,event,listener);
 };
 const release=()=>{if(!active)return;active=false;if(callback)callback(payload);for(const dispatch of queued)dispatch();};t.after(()=>{release();Worker.prototype.once=original;});return{entered:entered.promise,release};
}

module.exports={formFixture,holdOfficeResult,good,denied,sha,source,restorePasswordWork};