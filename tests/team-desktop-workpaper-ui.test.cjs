'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,excel,until,tick,deferred,ok,fail,P,P2,Q,HASH,DOC,RECORD}=require('./helpers/workpaper-ui-fixture.cjs');
test('only ready seniors expose the panel and no metadata is prefetched',async t=>{for(const role of ['intern','assistant','administrator','product_owner']){const f=fixture(t,{role});assert.equal(f.id('panel').hidden,true);await tick();assert.equal(f.calls.length,0);}const f=fixture(t);assert.equal(f.id('panel').hidden,false);assert.equal(f.calls.length,0);await f.open();assert.equal(f.count('listWorkpaperProjects'),1);assert.equal(f.count('getWorkpaperData'),0);});
test('module owner without read sees grants only and never fetches data or forms',async t=>{const f=fixture(t,{read:false});await f.open();await f.select();assert.equal(f.id('owner').hidden,false);assert.equal(f.id('viewer').hidden,true);assert.equal(f.count('getWorkpaperData'),0);assert.equal(f.count('getWorkpaperForm'),0);assert.equal(f.count('chooseWorkpaperSource'),0);});
test('current native sheet displays saved answers and only admitted fields can be edited',async t=>{const f=fixture(t);await f.open();await f.select();assert.equal(f.id('form').querySelector('.pw-original-sheet')!==null,true);assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'已保存填写');assert.equal(f.id('form').querySelector('[data-cell=A1]').getAttribute('contenteditable'),'true');for(const field of ['B1','A2','B2'])assert.equal(f.id('form').querySelector('[data-cell='+field+']').getAttribute('contenteditable'),'false');assert.equal(f.id('form').querySelector('[data-cell=C3]'),null);f.edit('A1','=literal only');assert.equal(f.id('save').disabled,false);f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1&&!f.id('refresh').disabled);const v=f.calls.find(c=>c.name==='saveWorkpaperEntries').input;assert.equal(v.headRevision,2);assert.equal(v.sha256,HASH);assert.deepEqual(v.changes,[{sheet:'Sheet1',field:'A1',value:'=literal only'}]);assert.equal(v.projectId,P);assert.equal(f.id('draft-status').textContent,'当前没有未保存填写。');});
test('readonly and historical views retain saved answers without falsely calling them frozen',async t=>{const f=fixture(t,{write:false});await f.open();await f.select();assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'已保存填写');assert.equal(f.id('form').querySelectorAll('[contenteditable=true]').length,0);assert.doesNotMatch(f.id('form-note').textContent,/既有冻结/);f.d.querySelectorAll('#workpaper-history button')[1].click();await until(()=>f.id('data-title').textContent.endsWith('1')&&!f.id('refresh').disabled);assert.equal(f.id('form').querySelectorAll('[contenteditable=true]').length,0);assert.match(f.id('version-note').textContent,/历史版本/);});

test('an admitted reading area becomes a tab stop, and a sheet switch keeps focus and starts at the top left',async t=>{
 const form=excel();
 form.sheets.push({...form.sheets[0],name:'Sheet2'},{...form.sheets[0],name:'Hidden',visibility:1});
 const f=fixture(t,{write:false,form}),viewport=f.id('form');
 f.d.getElementById('workspace-view').hidden=false;
 assert.equal(viewport.tabIndex,-1);
 await f.open();await f.select();
 assert.equal(viewport.tabIndex,0);
 assert.equal(f.id('scroll-help').hidden,false);
 assert.equal(viewport.getAttribute('aria-label'),'底稿阅读区');
 const file=f.id('files').querySelector('button');
 file.focus();file.click();
 await until(()=>f.d.activeElement===viewport);
 const buttons=()=>[...f.id('sheets').querySelectorAll('button')];
 assert.deepEqual(buttons().map(button=>button.textContent),['Sheet1','Sheet2']);
 viewport.scrollTop=120;viewport.scrollLeft=100;
 const second=buttons()[1];
 second.focus();second.click();
 assert.equal(f.d.activeElement,buttons()[1]);
 assert.equal(buttons()[1].getAttribute('aria-pressed'),'true');
 assert.equal(viewport.scrollTop,0);assert.equal(viewport.scrollLeft,0);
 assert.equal(viewport.querySelectorAll('[contenteditable=true]').length,0);
 assert.equal(f.count('saveWorkpaperEntries'),0);
});

test('an explicit failed file read clears the old sheet and focuses the original permission refresh action',async t=>{
 let reads=0;
 const f=fixture(t,{write:false,overrides:{getWorkpaperForm:async (v,state)=>{
  if(++reads===2)return fail('HTTP_404');
  return ok({form:excel(),version:v.version,recordSha256:'c'.repeat(64),projectRevision:state.projectRevision,grantRevision:state.grantRevision});
 }}});
 f.d.getElementById('workspace-view').hidden=false;
 await f.open();await f.select();
 const file=f.id('files').querySelector('button');
 file.focus();file.click();
 await until(()=>f.id('viewer').hidden&&f.d.activeElement===f.id('refresh'));
 assert.equal(f.id('form').children.length,0);
 assert.equal(f.id('form').tabIndex,-1);
 assert.equal(f.id('scroll-help').hidden,true);
 assert.equal(f.id('import').hidden,true);
 assert.match(f.id('message').textContent,/刷新权限与版本/);
 assert.equal(reads,2);
 f.click('refresh');
 await until(()=>!f.id('viewer').hidden&&f.id('form').tabIndex===0&&!f.id('refresh').disabled);
 assert.equal(reads,3);
 assert.equal(f.count('getWorkpaperAccess'),2);
 assert.equal(f.count('saveWorkpaperEntries'),0);
 assert.equal(f.count('confirmWorkpaperImport'),0);
});
test('dirty draft blocks project, version and file switch until explicit discard',async t=>{const f=fixture(t);await f.open();await f.select();f.edit('A1','尚未保存');const n=f.count('openWorkpaperView');f.d.querySelectorAll('#workpaper-projects button')[1].click();assert.equal(f.count('openWorkpaperView'),n);f.d.querySelectorAll('#workpaper-history button')[1].click();assert.equal(f.id('data-title').textContent,'底稿保存版本 2');f.d.querySelectorAll('#workpaper-files button')[1].click();assert.equal(f.count('getWorkpaperForm'),1);f.click('draft-discard');f.d.querySelectorAll('#workpaper-projects button')[1].click();await until(()=>f.id('title').textContent==='第二个底稿项目'&&!f.id('refresh').disabled);const opens=f.calls.filter(c=>c.name==='openWorkpaperView');assert.equal(opens.at(-1).input.projectId,P2);assert.notEqual(f.calls.filter(c=>c.name==='getWorkpaperRecord').at(-1).input.viewId,f.calls.find(c=>c.name==='getWorkpaperRecord').input.viewId);});
test('unknown save keeps one original request and 404 never permits a duplicate save',async t=>{const f=fixture(t,{overrides:{saveWorkpaperEntries:async v=>ok({status:'unknown',requestId:v.requestId}),getWorkpaperReceipt:async()=>fail('HTTP_404')}});await f.open();await f.select();f.edit('A1','一次提交');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1&&!f.id('refresh').disabled);const id=f.id('operation-id').value;assert.ok(id);assert.equal(f.id('save').disabled,true);f.click('receipt');await until(()=>f.count('getWorkpaperReceipt')===1&&!f.id('refresh').disabled);assert.match(f.id('message').textContent,/不证明取消或失败/);assert.equal(f.id('operation-id').value,id);assert.equal(f.id('save').disabled,true);f.click('save');assert.equal(f.count('saveWorkpaperEntries'),1);});
test('permission polling immediately clears form, password and source, and stale form cannot return',async t=>{const gate=deferred(),entered=deferred();let hold=false;const f=fixture(t,{overrides:{getWorkpaperForm:async v=>{if(hold){entered.resolve();await gate.promise;}return ok({form:excel(),version:v.version,recordSha256:'c'.repeat(64),projectRevision:7,grantRevision:1});}}});await f.open();await f.select();f.field('grant-password','private');f.state.read=false;f.state.grantRevision++;f.poll();await until(()=>f.id('form').textContent==='');assert.equal(f.id('grant-password').value,'');assert.equal(f.id('viewer').hidden,true);f.state.read=true;f.state.grantRevision=1;hold=true;f.click('refresh');await entered.promise;f.state.ready=false;f.state.epoch++;f.view.sync();gate.resolve();await tick();await tick();assert.equal(f.id('form').textContent,'');assert.equal(f.id('panel').hidden,true);});
test('real Word renderer uses only admitted paragraph IDs and saved document answers',async t=>{const f=fixture(t);await f.open();await f.select();f.d.querySelectorAll('#workpaper-files button')[1].click();await until(()=>f.id('form').querySelector('.pw-original-word')&&!f.id('refresh').disabled);assert.equal(f.id('form').querySelector('[data-native-word-id=p0]').textContent,'已保存段落');assert.equal(f.id('form').querySelector('[data-native-word-id=p1]').getAttribute('contenteditable'),'false');f.edit('p0','Word修改');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1);const v=f.calls.find(c=>c.name==='saveWorkpaperEntries').input;assert.equal(v.sha256,DOC);assert.deepEqual(v.changes,[{sheet:'$document',field:'native:p0',value:'Word修改'}]);});
test('no-layout sheet uses bounded real-address pages and frozen answers stay readonly',async t=>{const f=fixture(t,{form:excel({layout:false,range:{s:{r:0,c:0},e:{r:100,c:30}}})});await f.open();await f.select();assert.ok(f.id('form').querySelector('.workpaper-grid'));assert.ok(f.id('form').querySelectorAll('[data-cell]').length<=480);assert.match(f.id('page-status').textContent,/A1–L40/);f.click('page-next');assert.match(f.id('page-status').textContent,/M1–X40/);const frozen=fixture(t,{form:excel({frozen:true})});await frozen.open();await frozen.select();assert.equal(frozen.id('form').querySelectorAll('[contenteditable=true]').length,0);assert.match(frozen.id('form-note').textContent,/既有冻结/);});
test('import summary, paused resume and unknown commit use the same original ID',async t=>{const f=fixture(t,{empty:true,overrides:{confirmWorkpaperImport:async v=>ok({status:'paused',requestId:v.handle,phase:'upload'}),resumeWorkpaperImport:async v=>ok({status:'unknown',requestId:v.handle,phase:'commit'})}});await f.open();await f.select();f.click('source-open');await until(()=>!f.id('source-discard').disabled);const id=f.state.selected.handle;assert.match(f.id('source-summary').textContent,/完整包 SHA-256/);for(const pass of ['first','resume']){f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password',pass);if(pass==='first')await f.submit('import-form');else f.click('import-resume');await until(()=>!f.id('refresh').disabled);}assert.equal(f.calls.find(c=>c.name==='confirmWorkpaperImport').input.handle,id);assert.equal(f.calls.find(c=>c.name==='resumeWorkpaperImport').input.handle,id);assert.equal(f.id('import-resume').hidden,true);f.click('receipt');await until(()=>!f.id('refresh').disabled);assert.equal(f.id('import-resume').hidden,true);assert.equal(f.count('confirmWorkpaperImport'),1);assert.equal(f.count('resumeWorkpaperImport'),1);});
test('explicit export pins selected version and export alone does not reveal data',async t=>{const f=fixture(t);await f.open();await f.select();f.d.querySelectorAll('#workpaper-history button')[1].click();await until(()=>f.id('data-title').textContent.endsWith('1')&&!f.id('refresh').disabled);f.field('export-confirmed',true);f.click('export');await until(()=>f.count('exportWorkpapers')===1&&!f.id('refresh').disabled);const v=f.calls.find(c=>c.name==='exportWorkpapers').input;assert.equal(v.version,1);assert.equal(v.headRevision,2);assert.equal(v.recordSha256,'c'.repeat(64));assert.equal(Object.hasOwn(v,'path'),false);const noRead=fixture(t,{read:false,exportable:true});await noRead.open();await noRead.select();assert.equal(noRead.id('export-controls').hidden,true);assert.equal(noRead.count('getWorkpaperData'),0);});
test('three grant bits are explicit and a grant unknown response requires a fresh view',async t=>{const f=fixture(t,{read:false,write:false,exportable:false});await f.open();await f.select();f.d.querySelector('#workpaper-members button').click();f.field('grant-write',true);f.field('grant-password','Synthetic proof');f.field('grant-confirmed',true);await f.submit('grant-form');await until(()=>f.count('changeWorkpaperAccess')===1&&!f.id('refresh').disabled);const v=f.calls.find(c=>c.name==='changeWorkpaperAccess').input;assert.equal(v.read,false);assert.equal(v.write,true);assert.equal(v.export,false);assert.equal(f.count('getWorkpaperData'),0);assert.equal(f.id('grant-password').value,'');const unknown=fixture(t,{overrides:{changeWorkpaperAccess:async()=>fail('WORKPAPER_ACCESS_UNKNOWN')}});await unknown.open();await unknown.select();unknown.d.querySelector('#workpaper-members button').click();unknown.field('grant-password','Unknown proof');unknown.field('grant-confirmed',true);await unknown.submit('grant-form');await until(()=>!unknown.id('refresh').disabled);assert.equal(unknown.id('form').textContent,'');assert.equal(unknown.id('grant-fields').disabled,true);});
test('an access poll failure closes sensitive content even when revisions were not returned',async t=>{let deny=false;const f=fixture(t,{overrides:{getWorkpaperAccess:async(v,s)=>deny?fail('HTTP_403'):ok({teamId:'team-a',projectId:v.projectId,projectRevision:7,grantRevision:1,read:true,write:true,export:true,canWrite:true,canExport:true,canManageAccess:true})}});await f.open();await f.select();f.field('grant-password','Unsent proof');deny=true;f.poll();await until(()=>f.id('viewer').hidden);assert.equal(f.id('form').textContent,'');assert.equal(f.id('grant-password').value,'');assert.equal(f.id('import').hidden,true);});
test('form 404 is never mistaken for an empty project eligible for migration',async t=>{const f=fixture(t,{overrides:{getWorkpaperForm:async()=>fail('HTTP_404')}});await f.open();await f.select();assert.equal(f.id('viewer').hidden,true);assert.equal(f.id('import').hidden,true);assert.equal(f.id('form').textContent,'');});
test('a confirmed save rejection does not impersonate an unknown dispatched result',async t=>{const f=fixture(t,{overrides:{saveWorkpaperEntries:async()=>fail('HTTP_422')}});await f.open();await f.select();f.edit('A1','Rejected input');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1&&!f.id('refresh').disabled);assert.equal(f.id('save').disabled,false);assert.match(f.id('attempts').textContent,/rejected/);});

function concurrentDraft(t,recheckError=()=>null){
 let saved=false;
 const f=fixture(t,{overrides:{
  getWorkpaperRecord:async(v,state)=>{
   const error=recheckError();if(v.version>2&&error)return fail(error);
   const record=f.record(),metadata={...f.access(v),sourceProjectId:Q,version:v.version,headRevision:state.headRevision,recordSha256:RECORD};
   if(v.version>=3)record.answers[HASH].Sheet1.A1='另一位编辑已保存';
   return ok({record,metadata});
  },
  saveWorkpaperEntries:async(v,state)=>{
   if(!saved){saved=true;state.headRevision++;return fail('WORKPAPER_HEAD_CHANGED');}
   state.headRevision++;return ok({status:'saved',receipt:f.receipt(v.requestId)});
  },
 }});
 return f;
}

test('authorized stale draft exposes latest values, requires selection for overlap and only saves on a new click',async t=>{
 const f=concurrentDraft(t);await f.open();await f.select();
 f.edit('A1','保留我的重叠填写');f.edit('A3','带入我的其他填写');f.click('save');
 await until(()=>!f.id('conflict').hidden&&!f.id('conflict-load').disabled);
 assert.match(f.id('version-note').textContent,/草稿所用版本/);
 assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'保留我的重叠填写');
 assert.equal(f.id('save').disabled,true);f.click('save');assert.equal(f.count('saveWorkpaperEntries'),1);
 f.click('conflict-load');
 await until(()=>f.id('conflict-values').querySelectorAll('input').length===2&&!f.id('conflict-apply').disabled);
 const [overlap,other]=f.id('conflict-values').querySelectorAll('input');
 assert.equal(overlap.checked,false);assert.equal(other.checked,true);
 assert.match(overlap.closest('li').textContent,/另一位编辑已保存.*保留我的重叠填写/);
 overlap.click();f.click('conflict-apply');
 await until(()=>f.id('conflict').hidden&&!f.id('save').disabled);
 assert.equal(f.id('data-title').textContent,'底稿保存版本 3');
 assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'保留我的重叠填写');
 assert.equal(f.count('saveWorkpaperEntries'),1);
 f.click('save');await until(()=>f.count('saveWorkpaperEntries')===2&&!f.id('refresh').disabled);
 const [old,current]=f.calls.filter(call=>call.name==='saveWorkpaperEntries').map(call=>call.input);
 assert.notEqual(old.requestId,current.requestId);assert.equal(current.headRevision,3);
 assert.deepEqual(current.changes,[{sheet:'Sheet1',field:'A1',value:'保留我的重叠填写'},{sheet:'Sheet1',field:'A3',value:'带入我的其他填写'}]);
});

test('new version during comparison requires recheck and revocation then clears the retained draft',async t=>{
 const f=concurrentDraft(t);await f.open();await f.select();f.edit('A1','仍保留当前草稿');f.click('save');
 await until(()=>!f.id('conflict').hidden&&!f.id('conflict-load').disabled);
 f.click('conflict-load');await until(()=>!!f.id('conflict-values').querySelector('input')&&!f.id('conflict-load').disabled);
 f.id('conflict-values').querySelector('input').click();f.state.headRevision++;
 f.click('conflict-apply');await until(()=>f.id('message').textContent.includes('核对期间又有新版本'));
 assert.equal(f.id('conflict-values').textContent,'');assert.equal(f.id('save').disabled,true);
 assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'仍保留当前草稿');
 f.click('conflict-load');await until(()=>!!f.id('conflict-values').querySelector('input')&&!f.id('conflict-load').disabled);
 f.state.write=false;f.state.grantRevision++;f.poll();
 await until(()=>f.id('viewer').hidden);assert.equal(f.id('form').textContent,'');
 assert.equal(f.id('conflict-values').textContent,'');assert.equal(f.id('conflict').hidden,true);
 assert.equal(f.count('saveWorkpaperEntries'),1);
});
test('comparison preserves an authorized draft on a transient failure and clears it when the server rejects the scope',async t=>{
 let error='HTTP_429';
 const f=concurrentDraft(t,()=>error);await f.open();await f.select();f.edit('A1','限流时保留草稿');f.click('save');
 await until(()=>!f.id('conflict').hidden&&!f.id('conflict-load').disabled);
 f.click('conflict-load');await until(()=>f.count('getWorkpaperRecord')===2&&!f.id('conflict-load').disabled);
 assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'限流时保留草稿');
 assert.equal(f.id('save').disabled,true);
 error='HTTP_409';f.click('conflict-load');await until(()=>f.id('viewer').hidden);
 assert.equal(f.id('form').textContent,'');assert.equal(f.id('conflict').hidden,true);
 assert.equal(f.count('saveWorkpaperEntries'),1);
});
test('querying an unrelated receipt preserves an unsent draft',async t=>{const f=fixture(t);await f.open();await f.select();f.edit('A1','Keep this unsent');f.field('operation-id','dddddddd-dddd-4ddd-8ddd-dddddddddddd');f.field('operation-kind','entries');f.click('receipt');await until(()=>f.count('getWorkpaperReceipt')===1&&!f.id('refresh').disabled);assert.equal(f.id('form').querySelector('[data-cell=A1]').textContent,'Keep this unsent');assert.equal(f.id('save').disabled,false);assert.equal(f.count('getWorkpaperRecord'),1);});
test('closing the real summary clears sources, passwords, data and remote scope',async t=>{const f=fixture(t);await f.open();await f.select();f.field('grant-password','Pending password');f.id('panel').querySelector('summary').click();assert.equal(f.id('panel').open,false);assert.equal(f.id('form').textContent,'');assert.equal(f.id('title').textContent,'');assert.equal(f.id('grant-password').value,'');await f.open();await f.select();assert.equal(f.id('viewer').hidden,false);});
test('an unknown save locks additional edits until its original receipt is reconciled',async t=>{const f=fixture(t,{overrides:{saveWorkpaperEntries:async v=>ok({status:'unknown',requestId:v.requestId})}});await f.open();await f.select();f.edit('A1','Submitted once');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1&&!f.id('refresh').disabled);assert.equal(f.id('form').querySelectorAll('[contenteditable=true]').length,0);f.click('receipt');await until(()=>f.count('getWorkpaperReceipt')===1&&!f.id('refresh').disabled);assert.match(f.id('message').textContent,/已核实/);assert.equal(f.id('form').querySelector('[data-cell=A1]').getAttribute('contenteditable'),'true');});
test('saved original manifests expand lazily and clear with the view',async t=>{const f=fixture(t);await f.open();await f.select();assert.equal(f.id('originals').textContent,'');f.id('originals-panel').open=true;await until(()=>f.id('originals').textContent.includes('SHA-256'));assert.match(f.id('originals').textContent,/原业务底稿.zip/);assert.match(f.id('originals').textContent,/风险原件.zip/);assert.match(f.id('originals').textContent,/业务底稿.xlsx/);f.id('panel').querySelector('summary').click();assert.equal(f.id('originals').textContent,'');});
test('legacy document blocks preserve literal text and submit only admitted paragraphs',async t=>{const f=fixture(t,{overrides:{getWorkpaperForm:async v=>ok({form:v.sha256===HASH?excel():{kind:'word',sha256:DOC,path:'旧版原件.doc',mode:'legacy-text',editable:['p0'],frozen:false,readOnly:false,blocks:[{type:'paragraph',id:'p0',text:'<img src=x onerror=alert(1)>'},{type:'paragraph',id:'p1',text:'锁定原文'}]},version:v.version,recordSha256:'c'.repeat(64),projectRevision:7,grantRevision:1})}});await f.open();await f.select();f.d.querySelectorAll('#workpaper-files button')[1].click();await until(()=>f.id('form').querySelector('.workpaper-legacy-doc')&&!f.id('refresh').disabled);assert.equal(f.id('form').querySelector('img'),null);assert.match(f.id('form').textContent,/<img src=x/);assert.equal(f.id('form').querySelector('[data-word-field=p1]').getAttribute('contenteditable'),'false');f.edit('p0','旧DOC修改');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1);const v=f.calls.find(c=>c.name==='saveWorkpaperEntries').input;assert.equal(v.sha256,DOC);assert.deepEqual(v.changes,[{sheet:'$document',field:'p0',value:'旧DOC修改'}]);});
test('missing any new IPC capability hides only the new panel',async t=>{const f=fixture(t);delete f.api.getWorkpaperForm;f.view.sync();assert.equal(f.id('panel').hidden,true);assert.equal(f.id('panel').open,false);assert.equal(f.d.getElementById('login-form')!==null,true);assert.equal(f.count('getWorkpaperData'),0);});
test('settled history truncation cannot forget an unresolved save or unlock another request',async t=>{const f=fixture(t,{overrides:{saveWorkpaperEntries:async v=>ok({status:'unknown',requestId:v.requestId})}});await f.open();await f.select();f.edit('A1','One unresolved save');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1&&!f.id('refresh').disabled);const original=f.id('operation-id').value;for(let i=0;i<22;i++){f.field('operation-id','dddddddd-dddd-4ddd-8ddd-'+String(i).padStart(12,'0'));f.field('operation-kind','entries');f.click('receipt');await until(()=>f.count('getWorkpaperReceipt')===i+1&&!f.id('refresh').disabled);}assert.match(f.id('attempts').textContent,new RegExp(original));assert.equal(f.id('save').disabled,true);assert.equal(f.id('form').querySelector('[data-cell=A1]').getAttribute('contenteditable'),'false');f.click('save');assert.equal(f.count('saveWorkpaperEntries'),1);});
test('known saved receipt stays saved when subsequent details refresh is rate limited',async t=>{const f=fixture(t);await f.open();await f.select();const read=f.api.getWorkpaperRecord;f.api.getWorkpaperRecord=async v=>f.state.headRevision>2?fail('HTTP_429','Refresh budget exhausted'):read(v);f.edit('A1','Known saved');f.click('save');await until(()=>f.count('saveWorkpaperEntries')===1&&!f.id('refresh').disabled);assert.match(f.id('attempts').textContent,/saved/);assert.doesNotMatch(f.id('attempts').textContent,/rejected|unknown/);assert.match(f.id('message').textContent,/已保存.*刷新未完成/);assert.equal(f.id('draft-status').textContent,'当前没有未保存填写。');assert.equal(f.id('viewer').hidden,true);assert.equal(f.count('saveWorkpaperEntries'),1);});
test('known imported receipt stays imported when subsequent details refresh is rate limited',async t=>{const f=fixture(t,{empty:true});await f.open();await f.select();f.api.getWorkpaperRecord=async()=>fail('HTTP_429','Refresh budget exhausted');f.click('source-open');await until(()=>!f.id('source-discard').disabled);f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic proof');await f.submit('import-form');await until(()=>f.count('confirmWorkpaperImport')===1&&!f.id('refresh').disabled);assert.match(f.id('attempts').textContent,/imported/);assert.doesNotMatch(f.id('attempts').textContent,/unknown/);assert.match(f.id('message').textContent,/已迁入.*刷新未完成/);assert.equal(f.id('viewer').hidden,true);assert.equal(f.count('confirmWorkpaperImport'),1);assert.equal(f.id('import-password').value,'');});
test('native sheet retains application viewport class and Word or cleared views reset native class',async t=>{const f=fixture(t);await f.open();await f.select();assert.ok(f.id('form').querySelector('.pw-original-sheet'));assert.equal(f.id('form').classList.contains('workpaper-form'),true);assert.equal(f.id('form').classList.contains('pw-original-wrap'),true);f.d.querySelectorAll('#workpaper-files button')[1].click();await until(()=>f.id('form').querySelector('.pw-original-word')&&!f.id('refresh').disabled);assert.equal(f.id('form').className,'workpaper-form');f.d.querySelectorAll('#workpaper-files button')[0].click();await until(()=>f.id('form').querySelector('.pw-original-sheet')&&!f.id('refresh').disabled);assert.equal(f.id('form').classList.contains('workpaper-form'),true);f.id('panel').querySelector('summary').click();assert.equal(f.id('form').className,'workpaper-form');assert.equal(f.id('form').textContent,'');});
