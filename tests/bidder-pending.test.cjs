'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const script=n=>fs.readFileSync(path.join(__dirname,'../dist',n),'utf8');
async function setup(t){
 const dom=new JSDOM('<div id="bidder-library-editor"></div><div id="bidder-picker"></div>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window;t.after(()=>dom.window.close());w.confirm=()=>true;
 const saved=new Map(),calls=[],applied=[];let id=0,paused=null;
 const make=(fields,assets,k,v)=>{const row={...fields,id:k,version:v,attachments:assets.filter(x=>['business_license','practice_certificate'].includes(x.kind)),signingAssets:assets.filter(x=>!['business_license','practice_certificate'].includes(x.kind))};row.credentialKinds=row.attachments.map(x=>x.kind);row.signingKinds=row.signingAssets.map(x=>x.kind);saved.set(k,row);return structuredClone(row);};
 const db={list:async()=>[...saved.values()],get:async k=>{if(paused)await paused;return structuredClone(saved.get(k));},create:async(f,a)=>{calls.push('create');return make(f,a,'firm-'+(++id),1);},update:async(k,v,f,a)=>{calls.push('update');return make(f,a,k,v+1);}};
 w.BidderLibrary={open:async()=>db,readProfileFile:async(f,kind)=>({kind,name:f.name,mime:'image/png',bytes:new Uint8Array([1,2,3])})};
 for(const n of ['rule-catalog.js','bidder-ui.js'])w.eval(script(n));const ui=w.BidderUI.connect({apply:(r,o)=>applied.push({r,o}),detach:()=>{}});await ui.ready;
 const $=s=>w.document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,0)),set=(k,v)=>$('#bidder-edit-'+k).value=v,click=async s=>{$(s).click();await tick();},json=v=>w.JSON.parse(JSON.stringify(v));
 return {w,ui,saved,db,calls,applied,$,tick,set,click,json,pause(){let resume;paused=new Promise(r=>{resume=r;});return()=>{paused=null;resume();};}};
}
test('new editor snapshots contain exactly six text fields, restore stays dirty and never selects/saves',async t=>{
 const x=await setup(t);x.set('name','合成未保存事务所');x.set('phone','010-00000000');
 const scope=x.ui.draftScope(),snapshot=x.ui.capturePending(),values=snapshot.values;assert.deepEqual({...scope},{kind:'bidder-editor',firmId:'new-editor',recordId:'version:0'});assert.deepEqual(Object.keys(values.fields),['kind','name','team','contactName','phone','email']);assert.equal(values.schemaVersion,1);assert.equal(values.version,0);assert.ok(Object.isFrozen(values));assert.equal(x.calls.length,0);
 x.set('name','');await x.ui.restorePending(values,{scope});assert.equal(x.$('#bidder-edit-name').value,'合成未保存事务所');assert.equal(x.$('#bidder-picker-select').value,'');assert.equal(x.calls.length,0);assert.equal(x.applied.length,0);
 assert.match(x.$('#bidder-editor-status').textContent,/尚未正式保存或选用/);
 // A restored field remains dirty: an automatic candidate import cannot replace it.
 x.w.BidderArchive={open:async()=>({close(){}})};x.w.BidderIntake={read:async()=>({profiles:[{fields:{name:'新导入候选事务所'},files:{},notes:[]}],inventory:[],warnings:[]})};
 const input=x.$('#bidder-archive-file');input.disabled=false;Object.defineProperty(input,'files',{value:[new x.w.File(['fixture'],'synthetic.zip')],configurable:true});input.dispatchEvent(new x.w.Event('change'));await x.tick();await x.tick();
 assert.equal(x.$('#bidder-edit-name').value,'合成未保存事务所');assert.match(x.$('#bidder-import-status').textContent,/未保存修改/);
});
test('firm ID and exact source version bind restore; other firms and stale DB updates cannot overwrite',async t=>{
 const x=await setup(t);x.set('name','合成甲事务所');await x.click('#bidder-save');const scope=x.ui.draftScope(),values=x.ui.capturePending().values;assert.deepEqual({...scope},{kind:'bidder-editor',firmId:'firm-1',recordId:'version:1'});
 await x.click('#bidder-new');x.set('name','合成乙事务所');await x.click('#bidder-save');assert.equal(x.ui.draftScope().firmId,'firm-2');
 await assert.rejects(()=>x.ui.restorePending(values,{scope}),e=>e.code==='BIDDER_PENDING_SCOPE'&&e.preserveDOM);assert.equal(x.$('#bidder-edit-name').value,'合成乙事务所');
 await x.click('[data-bidder-edit="firm-1"]');x.saved.get('firm-1').version=2;
 await assert.rejects(()=>x.ui.restorePending(values,{scope}),e=>e.code==='BIDDER_PENDING_VERSION');assert.equal(x.$('#bidder-edit-name').value,'合成甲事务所');assert.equal(x.calls.length,2);assert.equal(x.applied.length,0);
});
test('unsaved certificate bytes require actual save, never a filename-only temporary success',async t=>{
 const x=await setup(t);x.set('name','合成附件事务所');
 const input=x.$('#bidder-edit-business_license');Object.defineProperty(input,'files',{value:[new x.w.File(['SYNTHETIC'],'synthetic-certificate.png')],configurable:true});input.dispatchEvent(new x.w.Event('change'));await x.tick();
 assert.throws(()=>x.ui.capturePending(),e=>e.code==='BIDDER_PENDING_FILES'&&e.preserveDOM===true&&/保存资料/.test(e.message));
 assert.match(x.$('#bidder-file-business_license').textContent,/synthetic-certificate.png/);assert.equal(x.saved.size,0);assert.ok(input.isConnected);
 await x.click('#bidder-save');assert.equal(x.saved.get('firm-1').attachments[0].name,'synthetic-certificate.png');assert.equal(x.ui.capturePending().values.fields.name,'合成附件事务所');
});
test('restoration waits for fresh identity and does not overwrite edits made during the await',async t=>{
 const x=await setup(t);x.set('name','合成异步事务所');await x.click('#bidder-save');const values=x.ui.capturePending().values,scope=x.ui.draftScope(),resume=x.pause();
 const pending=x.ui.restorePending(values,{scope});x.set('phone','新手工电话');resume();await assert.rejects(()=>pending,e=>e.code==='BIDDER_PENDING_CHANGED');assert.equal(x.$('#bidder-edit-phone').value,'新手工电话');
 const resume2=x.pause(),pending2=x.ui.restorePending(values,{scope});await x.click('#bidder-new');resume2();await assert.rejects(()=>pending2,e=>e.code==='BIDDER_PENDING_CHANGED');assert.equal(x.$('#bidder-edit-name').value,'');
});
test('historical opaque signing records remain untouched, and invalid payloads do not touch fields',async t=>{
 const x=await setup(t);const old={id:'legacy',version:3,kind:'own',name:'合成历史事务所',team:'河北',contactName:'',phone:'',email:'',attachments:[],credentialKinds:[],signingKinds:['company_seal'],signingAssets:[{kind:'company_seal',name:'historical-private.png',bytes:new Uint8Array([2,3,4])}]};x.saved.set('legacy',old);await x.click('#bidder-refresh');await x.click('[data-bidder-edit="legacy"]');
 const scope=x.ui.draftScope(),values=x.ui.capturePending().values,next=x.json({...values,fields:{...values.fields,phone:'010-00000001'}});await x.ui.restorePending(next,{scope});assert.equal(x.calls.length,0);assert.equal(x.saved.get('legacy').signingAssets[0].name,'historical-private.png');assert.doesNotMatch(x.$('#bidder-library-editor').textContent,/公司公章|historical-private/);
 const bad=x.json({...values,fields:{...values.fields,email:'x'.repeat(121)}});await assert.rejects(()=>x.ui.restorePending(bad,{scope}));assert.equal(x.$('#bidder-edit-phone').value,'010-00000001');
 const extra=x.json({...values,fields:{...values.fields,files:['fake.png']}});await assert.rejects(()=>x.ui.restorePending(extra,{scope}));assert.equal(x.calls.length,0);
 const dynamic=x.json(values);Object.defineProperty(dynamic.fields,'name',{enumerable:true,get(){throw Error('must not invoke');}});await assert.rejects(()=>x.ui.restorePending(dynamic,{scope}),/动态取值/);assert.equal(x.saved.get('legacy').version,3);
});
test('owner snapshots round-trip through real PageDrafts IndexedDB without cross-firm restore or business writes',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Playwright unavailable');}
 const exe=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(exe))return t.skip('Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:exe});
 try{const context=await browser.newContext(),p=await context.newPage(),errors=[],remote=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
  await p.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../dist/rule-catalog.js')).href);
  for(const name of ['rule-catalog.js','page-drafts.js','bidder-ui.js'])await p.addScriptTag({content:script(name)});
  const out=await p.evaluate(async()=>{
   document.body.innerHTML='<div id="bidder-library-editor"></div><div id="bidder-picker"></div>';let writes=0,applied=0;const row={id:'synthetic-firm',version:5,kind:'own',name:'合成暂存事务所',team:'河北',contactName:'',phone:'',email:'',attachments:[],credentialKinds:[],signingAssets:[],signingKinds:[]};
   globalThis.BidderLibrary={open:async()=>({list:async()=>[row],get:async()=>structuredClone(row),update:async()=>{writes++;throw Error('no business write allowed');}})};
   const ui=BidderUI.connect({apply:()=>{applied++;},detach:()=>{}});await ui.ready;document.querySelector('[data-bidder-edit]').click();await new Promise(r=>setTimeout(r,0));
   const manager=PageDrafts.create();manager.registerAdapter('bidders',{scope:ui.draftScope,capture:ui.capturePending,restore:ui.restorePending});
   await manager.restore('bidders');document.querySelector('#bidder-edit-phone').value='010-00000009';const stored=await manager.checkpoint('bidders');document.querySelector('#bidder-edit-phone').value='';const restored=await manager.restore('bidders');
   const phone=document.querySelector('#bidder-edit-phone').value,scope=ui.draftScope(),saved=manager.peek('bidders',{scope});
   document.querySelector('#bidder-new').click();const wrong=await manager.restore('bidders'),newName=document.querySelector('#bidder-edit-name').value;
   const list=await manager.list('bidders');manager.close();return {stored,restored,phone,scope,saved,wrong,newName,writes,applied,list};
  });
  assert.equal(out.stored.saved,true);assert.equal(out.restored.restored,true);assert.equal(out.phone,'010-00000009');assert.equal(out.scope.recordId,'version:5');assert.equal(out.saved.values.version,5);assert.equal(out.saved.values.fields.name,'合成暂存事务所');assert.equal(out.wrong.restored,false);assert.equal(out.newName,'');assert.equal(out.writes,0);assert.equal(out.applied,0);assert.equal(out.list.length,1);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 }finally{await browser.close();}
});
