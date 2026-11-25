'use strict';
const nodeTest=require('node:test'),test=(name,fn)=>nodeTest(name,{timeout:5000},fn),assert=require('node:assert/strict'),fs=require('node:fs');
const {createHash}=require('node:crypto'),{JSDOM}=require('jsdom'),A=require('../dist/audit-checklist.js');
const PROJECT='a3fc78ee-4052-4aa5-85d5-8b3f9ccf0471',OTHER='a3fc78ee-4052-4aa5-85d5-8b3f9ccf0472',IMPORT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FILE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ADDED='dddddddd-dddd-4ddd-8ddd-dddddddddddd',HASH='a'.repeat(64),PACKAGE='e'.repeat(64);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};

async function fixture(t,{empty=false,closed=false,confirmed=false}={}){
 const dom=new JSDOM(fs.readFileSync('desktop/team-ui/index.html','utf8'),{url:'shenyi://app/index.html',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[],polls=[];
 let context={actor:'manager-a:1',userId:'manager-a',device:'1:1',teamId:'team-a',projectId:PROJECT,title:'合成当前项目',status:'active',ready:true,busy:false};
 let record=A.createTree({quoteId:PROJECT,projectName:'合成完整清单',firmName:'合成事务所'},[{id:'n1',parentId:'',level:1,title:'合成叶资料',description:'保留说明',kind:'material'}],'历史合成人');
 record=A.apply(record,{type:'attachment-add',nodeId:'n1',reviewer:'历史合成人',file:{id:FILE,nodeId:'n1',generationId:record.generationId,name:'合成已有.txt',size:20,type:'text/plain',sha256:HASH}});
 if(confirmed||closed)record=A.apply(record,{type:'item',id:'n1',reviewer:'历史合成人',status:'confirmed',evidence:'已有合成证据'});
 if(closed)record=A.apply(record,{type:'close',reviewer:'历史合成人'});
 let materialRevision=empty?0:1,present=!empty,afterWrite=async()=>{},accessReader=null,dataReader=null,writeUnknown=false,lastReceipt=null,unauthorized=0;
 const originalRevision=record.revision,access={projectRevision:5,canManageAccess:true,read:true,import:true,review:true,close:true,maintain:true};
 const members=[{id:'manager-a',displayName:'合成经理',role:'manager',memberRevision:1,grantRevision:1,maintenanceRevision:1,read:true,import:true,review:true,close:true,maintain:true}];
 const payload=input=>({projectId:input.projectId,projectRevision:access.projectRevision,materialRevision,recordSha256:present?digest(record):null,record:present?(input.projectId===PROJECT?record:{...record,project:{...record.project,quoteId:input.projectId,projectName:'其他合成项目'}}):null,packageSha256:present?PACKAGE:null,importedAt:present?1:null,importedBy:present?{id:'manager-a',displayName:'合成经理'}:null});
 const makeReceipt=(input,kind)=>({requestId:input.requestId??input.handle,kind,projectId:input.projectId,projectRevision:access.projectRevision,materialRevision,recordSha256:digest(record),packageSha256:PACKAGE,sourceRecordRevision:originalRevision,recordRevision:record.revision,committedAt:2,...(kind.startsWith('attachment-')?{fileId:kind==='attachment-add'?ADDED:input.fileId,nodeId:'n1',generationId:record.generationId}:{})});
 async function write(input,kind){
  if(writeUnknown)return{ok:true,value:{status:'unknown',requestId:input.requestId??input.handle}};
  if(kind==='import'){present=true;materialRevision=1;}
  else if(kind==='attachment-add'){record=A.apply(record,{type:kind,nodeId:'n1',reviewer:'合成经理',file:{id:ADDED,nodeId:'n1',generationId:record.generationId,name:'合成新增.txt',size:32,type:'text/plain',sha256:HASH}});materialRevision++;}
  else if(kind==='attachment-remove'){record=A.apply(record,{type:kind,nodeId:'n1',fileId:input.fileId,reviewer:'合成经理',reason:input.reason});materialRevision++;}
  else{record=A.apply(record,{...input.action,reviewer:'合成经理'});materialRevision++;}
  lastReceipt=makeReceipt(input,kind);await afterWrite({input,kind,receipt:structuredClone(lastReceipt)});
  return{ok:true,value:{status:'committed',receipt:lastReceipt}};
 }
 const responses={
  getProjectMaterialAccess:async input=>accessReader?accessReader(input):{ok:true,value:access},
  getProjectMaterials:async input=>dataReader?dataReader(input):{ok:true,value:payload(input)},
  listProjectMaterialMembers:async()=>({ok:true,value:{members,hasMore:false}}),
  changeProjectMaterialAccess:async()=>({ok:true,value:{changed:true,projectRevision:5}}),
  chooseProjectMaterialImport:async()=>({ok:true,value:{handle:IMPORT,sha256:PACKAGE,summary:{projectId:PROJECT,projectName:'合成来源',firmName:'合成事务所',sourceNamespace:'hengdu.audit.materials.v1',recordSchema:2,revision:record.revision,generationId:record.generationId,closed:record.closed,nodeCount:1,fileCount:1,currentFileCount:1,historicalFileCount:0,totalBytes:20,packageSha256:PACKAGE}}}),
  discardProjectMaterialImport:async()=>({ok:true,value:{discarded:true,stageCanceled:null}}),
  importProjectMaterials:input=>write(input,'import'),
  changeProjectMaterials:input=>write(input,input.action.type),
  getProjectMaterialReceipt:async input=>({ok:true,value:{...lastReceipt,requestId:input.requestId,projectId:input.projectId}}),
  downloadProjectMaterial:async()=>({ok:true,value:{saved:true,filename:'合成已有.txt',byteLength:20}}),
  chooseProjectMaterialAttachment:async input=>({ok:true,value:{requestId:input.requestId,filename:'合成新增.txt',mimeType:'text/plain',byteLength:32,sha256:HASH}}),
  discardProjectMaterialAttachment:async()=>({ok:true,value:{discarded:true}}),
  commitProjectMaterialAttachment:input=>write(input,'attachment-add'),
  removeProjectMaterialAttachment:input=>write(input,'attachment-remove')
 };
 const api=Object.fromEntries(Object.entries(responses).map(([name,fn])=>[name,async input=>{const call={name,input:structuredClone(input)};calls.push(call);const reply=structuredClone(await fn(input));call.reply=reply;return reply;}]));
 w.setInterval=fn=>{polls.push(fn);return 42;};w.eval(fs.readFileSync('desktop/team-ui/project-materials.js','utf8'));
 const view=w.createProjectMaterialsView({api,getContext:()=>context,onUnauthorized:()=>unauthorized++});
 t.after(()=>{view.dispose();w.close();});
 const by=id=>d.getElementById('project-materials-'+id),flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,1));};
 const change=(id,value,event='change')=>{by(id)[typeof value==='boolean'?'checked':'value']=value;by(id).dispatchEvent(new w.Event(event,{bubbles:true}));};
 const submit=async form=>{assert.equal(by(form+'-save').disabled,false,'eligible normal form must be enabled');by(form+'-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
 const open=async()=>{view.show();by('panel').open=true;await flush();};
 const refresh=async()=>{by('refresh').click();await flush();};
 async function perform(kind){
  if(kind==='import'){by('source-open').click();await flush();change('import-password','Synthetic Current Password!','input');change('import-confirmed',true);await submit('import');}
  else if(kind.startsWith('attachment-')){
   by('tree').querySelector(kind==='attachment-add'?'[data-material-attachment-add]':'[data-material-attachment-remove]').click();await flush();
   if(kind==='attachment-remove')change('maintenance-reason','合成移除理由','input');
   change('maintenance-confirmed',true);await submit('maintenance');
  }else{
   change('action',kind);
   if(kind==='item'){by('tree').querySelector('[data-material-review]').click();change('item-status','confirmed');change('evidence','合成核对证据','input');}
   else{if(kind==='reopen')change('reason','合成重开理由','input');change('action-password','Synthetic Current Password!','input');}
   change('action-confirmed',true);await submit('action');
  }
 }
 await open();
 return{w,d,view,by,calls,access,flush,open,refresh,perform,change,context:()=>context,setContext:value=>{context={...context,...value};},record:()=>record,lastReceipt:()=>lastReceipt,payload,makeReceipt,
  afterWrite:fn=>afterWrite=fn,accessReader:fn=>accessReader=fn,dataReader:fn=>dataReader=fn,unknown:()=>writeUnknown=true,
  poll:async()=>{for(const fn of polls)fn();await flush();},unauthorized:()=>unauthorized,
  query:async id=>{change('request-id',id,'input');by('receipt').click();await flush();}
 };
}
const writes=f=>f.calls.filter(c=>['importProjectMaterials','changeProjectMaterials','commitProjectMaterialAttachment','removeProjectMaterialAttachment'].includes(c.name));
function fullReceipt(f,receipt=f.lastReceipt()){
 const text=f.by('receipt-summary').textContent;
 for(const value of [receipt.requestId,receipt.kind,receipt.recordSha256,receipt.packageSha256])assert.ok(text.includes(value),'fresh readable receipt must retain '+value);
 assert.match(text,new RegExp('materialRevision[：:]\\s*'+receipt.materialRevision));
 if(receipt.kind.startsWith('attachment-'))assert.ok(text.includes(receipt.fileId),'attachment receipt keeps exact file identity');
 assert.equal(f.by('request-id').value,receipt.requestId);assert.equal(writes(f).length,1);
}
function noReceiptDetails(f){
 const text=f.by('receipt-summary').textContent;assert.equal(text,'');
 for(const id of ['message','receipt-summary'])assert.doesNotMatch(f.by(id).textContent,/(?:recordSha256|packageSha256|materialRevision|recordRevision|fileId|generationId)[：:]/);
}
function safeCompletion(f){
 noReceiptDetails(f);assert.match(f.by('message').textContent,/已完成|已提交/);
 assert.ok((f.by('message').textContent+f.by('request-id').value).includes(f.lastReceipt().requestId),'keep exact opaque recovery ID');
 assert.equal(f.by('tree').textContent,'');assert.equal(f.by('history').textContent,'');assert.equal(f.by('record-section').hidden,true);
 assert.equal(writes(f).length,1);
}
async function heldRefresh(t,kind='item'){
 const f=await fixture(t),entered=deferred(),gate=deferred();
 f.afterWrite(()=>f.accessReader(()=>{entered.resolve();return gate.promise;}));
 await f.perform(kind);await entered.promise;
 return{f,gate,access:structuredClone(f.access)};
}

for(const kind of ['import','item','close','reopen','attachment-add','attachment-remove']){
 test('confirmed '+kind+' keeps its exact receipt after the automatic fresh readable refresh',async t=>{
  const f=await fixture(t,{empty:kind==='import',confirmed:kind==='close',closed:kind==='reopen'});
  await f.perform(kind);assert.equal(f.by('record-section').hidden,false);assert.ok(f.calls.filter(c=>c.name==='getProjectMaterialAccess').length>=2);
  fullReceipt(f);assert.match(f.by('message').textContent,kind==='attachment-remove'?/当前关联已移除/:/已完成|已提交/);assert.ok(['access','import','action'].every(k=>f.by(k+'-password').value===''));
 });
}
test('committed item with refresh503 exposes completion and its opaque ID without private receipt or body',async t=>{
 const f=await fixture(t);f.afterWrite(()=>f.accessReader(async()=>({ok:false,error:{code:'HTTP_503',message:'合成权限刷新失败'}})));
 await f.perform('item');safeCompletion(f);assert.match(f.by('message').textContent,/刷新未确认/);
 await f.poll();assert.equal(writes(f).length,1);
});
test('committed attachment with record refresh429 exposes completion without SHA file IDs or versions',async t=>{
 const f=await fixture(t);f.afterWrite(()=>f.dataReader(async()=>({ok:false,error:{code:'HTTP_429',message:'合成限流'}})));
 await f.perform('attachment-add');safeCompletion(f);assert.match(f.by('message').textContent,/刷新未确认/);
 await f.poll();assert.equal(writes(f).length,1);
});
test('invalid refreshed material identity cannot authorize restoring a confirmed private receipt',async t=>{
 const f=await fixture(t);f.afterWrite(()=>f.dataReader(async input=>({ok:true,value:{...f.payload(input),projectId:OTHER}})));
 await f.perform('item');safeCompletion(f);
});
test('fresh explicit read revocation clears all receipt details after confirmed write',async t=>{
 const f=await fixture(t);f.afterWrite(()=>Object.assign(f.access,{read:false,import:false,review:false,close:false,maintain:false}));
 await f.perform('item');noReceiptDetails(f);assert.equal(f.by('tree').textContent,'');assert.equal(f.by('record-section').hidden,true);assert.equal(writes(f).length,1);
});
test('fresh readable but changed authorization snapshot does not restore old maintenance receipt details',async t=>{
 const f=await fixture(t);f.afterWrite(()=>Object.assign(f.access,{projectRevision:6,maintain:false}));
 await f.perform('attachment-add');noReceiptDetails(f);assert.equal(f.by('record-section').hidden,false);assert.equal(writes(f).length,1);
});
test('closing the panel during postcommit refresh retires the old acknowledgment',async t=>{
 const {f,gate,access}=await heldRefresh(t);
 f.by('panel').querySelector('summary').click();await f.flush();gate.resolve({ok:true,value:access});await f.flush();
 noReceiptDetails(f);assert.equal(f.by('tree').textContent,'');assert.equal(f.by('panel').open,false);assert.doesNotMatch(f.by('message').textContent,/操作已完成|资料操作已提交/);assert.equal(writes(f).length,1);
});
test('account and actor switch during postcommit refresh cannot populate the new account acknowledgment',async t=>{
 const {f,gate,access}=await heldRefresh(t);
 f.accessReader(null);f.setContext({actor:'partner-a:2',userId:'partner-a',device:'2:2'});await f.open();const message=f.by('message').textContent;
 gate.resolve({ok:true,value:access});await f.flush();noReceiptDetails(f);assert.equal(f.by('message').textContent,message);assert.equal(f.unauthorized(),0);assert.equal(writes(f).length,1);
});
test('project switch during postcommit refresh cannot restore the old project receipt',async t=>{
 const {f,gate,access}=await heldRefresh(t);
 f.accessReader(null);f.setContext({projectId:OTHER,title:'其他合成项目'});await f.open();const message=f.by('message').textContent;
 gate.resolve({ok:true,value:access});await f.flush();noReceiptDetails(f);assert.equal(f.by('message').textContent,message);assert.equal(writes(f).length,1);
});
test('device-only change during postcommit refresh retires receipt and completion feedback',async t=>{
 const {f,gate,access}=await heldRefresh(t);
 f.setContext({device:'2:2'});const message=f.by('message').textContent;
 gate.resolve({ok:true,value:access});await f.flush();noReceiptDetails(f);assert.equal(f.by('message').textContent,message);assert.equal(writes(f).length,1);
});
test('same-scope close reopen ABA keeps the new queried receipt when the old postcommit refresh arrives late',async t=>{
 const {f,gate,access}=await heldRefresh(t);
 f.by('panel').querySelector('summary').click();await f.flush();f.accessReader(null);await f.open();
 const newId='ffffffff-ffff-4fff-8fff-ffffffffffff';await f.query(newId);const receipt=f.by('receipt-summary').textContent,message=f.by('message').textContent;assert.ok(receipt.includes(newId));
 gate.resolve({ok:true,value:access});await f.flush();assert.equal(f.by('receipt-summary').textContent,receipt);assert.equal(f.by('message').textContent,message);assert.equal(writes(f).length,1);
});
test('a later same-scope refresh wins and an earlier refresh cannot replace its query feedback',async t=>{
 const {f,gate,access}=await heldRefresh(t);f.accessReader(null);
 // A programmatic DOM event exercises the same public refresh handler while
 // an older bridge read is pending; no private controller state is invoked.
 f.by('refresh').dispatchEvent(new f.w.Event('click'));await f.flush();
 const newId='99999999-9999-4999-8999-999999999999';await f.query(newId);const receipt=f.by('receipt-summary').textContent,message=f.by('message').textContent;assert.ok(receipt.includes(newId));
 gate.resolve({ok:true,value:access});await f.flush();assert.equal(f.by('receipt-summary').textContent,receipt);assert.equal(f.by('message').textContent,message);assert.equal(writes(f).length,1);
});
test('unknown generic write never presents completion or a detailed receipt and never resends automatically',async t=>{
 const f=await fixture(t);f.unknown();await f.perform('item');const id=writes(f)[0].input.requestId;
 noReceiptDetails(f);assert.equal(f.by('request-id').value,id);assert.match(f.by('message').textContent,/不会自动重试/);assert.doesNotMatch(f.by('message').textContent,/已完成|已提交/);
 await f.poll();await f.refresh();assert.equal(writes(f).length,1);noReceiptDetails(f);
});
test('unknown attachment write keeps only its original query ID and never invents a confirmed receipt',async t=>{
 const f=await fixture(t);f.unknown();await f.perform('attachment-add');const id=writes(f)[0].input.requestId;
 noReceiptDetails(f);assert.equal(f.by('request-id').value,id);assert.equal(f.by('attachment-summary').textContent,'');assert.match(f.by('message').textContent,/不会自动重试/);assert.doesNotMatch(f.by('message').textContent,/已完成|已提交/);
 await f.poll();await f.refresh();assert.equal(writes(f).length,1);noReceiptDetails(f);
});
test('queried receipt still clears on ordinary manual refresh rather than becoming persistent receipt state',async t=>{
 const f=await fixture(t);await f.perform('item');const id=f.lastReceipt().requestId;
 await f.query(id);assert.ok(f.by('receipt-summary').textContent.includes(f.lastReceipt().recordSha256));await f.refresh();
 noReceiptDetails(f);assert.equal(f.by('request-id').value,id);assert.equal(f.by('record-section').hidden,false);assert.equal(writes(f).length,1);
});
