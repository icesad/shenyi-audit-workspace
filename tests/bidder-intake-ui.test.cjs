'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const script=n=>fs.readFileSync(path.join(__dirname,'../dist',n),'utf8');
const kinds=['business_license','practice_certificate','company_seal','legal_representative_seal','bidder_signature'];
async function fixture(t){
 const dom=new JSDOM('<div id="bidder-library-editor"></div><div id="bidder-picker"></div>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window;
 t.after(()=>dom.window.close());w.confirm=()=>true;
 let next=0,answer=null,closed=0,raw=null;
 const logs=[],db=new Map(),b=async(v,as,id,version)=>{const r={...v,id,version,attachments:as.filter(a=>kinds.indexOf(a.kind)<2),signingAssets:as.filter(a=>kinds.indexOf(a.kind)>=2)};r.credentialKinds=r.attachments.map(x=>x.kind);r.signingKinds=r.signingAssets.map(x=>x.kind);db.set(id,r);return structuredClone(r);};
 w.BidderLibrary={
   async readProfileFile(f,kind){if(f.name.startsWith('bad'))throw Error('bad shape');return {name:f.name,kind,mime:'image/png',bytes:new Uint8Array([1,2,3])};},
   open:async()=>({list:async()=>[...db.values()],get:async id=>structuredClone(db.get(id)),
     create:async(v,as)=>b(v,as,String(++next),1),update:async(id,v,v2,as)=>{assert.equal(v,db.get(id).version);return b(v2,as,id,v+1);},
     remove:async id=>db.delete(id)})
 };
 w.BidderArchive={open:async file=>{raw=file.name;return {async close(){closed++;}};}};
 w.BidderIntake={read:async()=>{if(answer instanceof Error)throw answer;return structuredClone(answer);}};
 for(const f of ['rule-catalog.js','bidder-ui.js'])w.eval(script(f));
 const ui=w.BidderUI.connect({apply:x=>logs.push(x),detach:()=>{}});await ui.ready;
 const $=s=>w.document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,0)),change=e=>e.dispatchEvent(new w.Event('change',{bubbles:true}));
 const click=async s=>{$(s).click();await tick();},set=(k,v)=>$('#bidder-edit-'+k).value=v;
 const scan=async result=>{answer=result;const e=$('#bidder-archive-file');assert.equal(e.disabled,false);Object.defineProperty(e,'files',{configurable:true,value:[new w.File(['fake bytes'],'SYNTHETIC.zip')]});change(e);await tick();};
 return {$,db,w,logs,click,set,scan,tick,change,closed:()=>closed,raw:()=>raw};
}
const prof=(name,files={},fields={})=>({fields:{name,...fields},notes:['文件名或文本识别，待核对'],files:Object.fromEntries(Object.entries(files).map(([k,n])=>[k,{name:n,bytes:new Uint8Array([1,2,3])}]))});
const summary=(...profiles)=>({profiles,warnings:['请核对识别结果'],inventory:['模拟资料/TEST.png','<img src=x onerror=alert(1)>']});
test('single detected bidder fills one unsaved editor; only two certificate slots remain visible and applied',async t=>{
 const x=await fixture(t),{$}=x;await x.scan(summary(prof('模拟甲事务所',Object.fromEntries(kinds.map(k=>[k,k+'.png'])),{team:'广西',contactName:'模拟联系人'})));
 assert.equal(x.closed(),1);assert.equal(x.raw(),'SYNTHETIC.zip');assert.equal(x.db.size,0);
 assert.equal($('#bidder-edit-name').value,'模拟甲事务所');assert.equal($('#bidder-edit-kind').value,'');assert.equal($('#bidder-edit-team').value,'广西');
 assert.equal($('#bidder-edit-contactName').value,'模拟联系人');assert.match($('#bidder-editor-status').textContent,/待核对/);
 assert.equal($('#bidder-import-rows img'),null); // Filename HTML is never interpreted.
 for(const k of kinds.slice(0,2))assert.match($('#bidder-file-'+k).textContent,new RegExp(k));
 for(const k of kinds.slice(2))assert.equal($('#bidder-file-'+k),null);
 x.set('kind','own');await x.click('#bidder-save');assert.equal(x.db.size,1);
 const e=$('#bidder-picker-select');e.value='1';x.change(e);await x.tick();
 assert.deepEqual(Array.from(x.logs[0].attachments.map(a=>a.kind)),kinds.slice(0,2));
 assert.equal(Object.hasOwn(x.logs[0],'signingAssets'),false);assert.equal(Object.hasOwn(x.logs[0],'signingKinds'),false);
 assert.equal(x.db.get('1').signingAssets.length,0);
});
test('scan never replaces an existing draft or creates multiple rows; choose explicitly and reject invalid image',async t=>{
 const x=await fixture(t),{$}=x;x.set('name','人工编辑中');await x.scan(summary(prof('模拟甲事务所'),prof('模拟乙事务所',{business_license:'bad.png'})));
 assert.equal($('#bidder-edit-name').value,'人工编辑中');assert.equal(x.db.size,0);
 x.w.confirm=()=>false;await x.click('[data-bidder-intake="1"]');assert.equal($('#bidder-edit-name').value,'人工编辑中');
 x.w.confirm=()=>true;await x.click('[data-bidder-intake="1"]');assert.equal($('#bidder-edit-name').value,'模拟乙事务所');
 assert.match($('#bidder-editor-status').textContent,/文件校验未通过.*营业执照/);assert.match($('#bidder-file-business_license').textContent,/暂未添加/);
 await x.scan(Error('不支持的压缩包'));assert.equal(x.closed(),2);assert.equal($('#bidder-edit-name').value,'模拟乙事务所');assert.equal(x.db.size,0);
 assert.match($('#bidder-import-status').textContent,/资料库未改动/);
});
test('same-name archive auto-fills a review draft without replacing the saved record or losing unknown fields',async t=>{
 const x=await fixture(t),{$}=x;x.set('name','模拟事务所');x.set('phone','未覆盖电话');await x.click('#bidder-save');assert.equal(x.db.size,1);
 await x.click('#bidder-new');await x.scan(summary(prof('模拟事务所',{practice_certificate:'仅测试.jpg'},{contactName:'新联系人'})));
 assert.equal($('#bidder-edit-name').value,'模拟事务所');assert.equal(x.db.get('1').version,1);
 assert.equal($('#bidder-edit-phone').value,'未覆盖电话');assert.equal(x.db.get('1').signingAssets.length,0);
 assert.match($('#bidder-file-practice_certificate').textContent,/已从资料读入/);
 assert.match($('#bidder-import-status').textContent,/同名档案的待核对编辑稿/);
 await x.click('#bidder-save');assert.equal(x.db.size,1);assert.equal(x.db.get('1').version,2);assert.equal(x.db.get('1').contactName,'新联系人');assert.equal(x.db.get('1').attachments[0].name,'仅测试.jpg');
});
test('conflicting labelled choices are not auto-selected; an explicit choice fills the corresponding field',async t=>{
 const x=await fixture(t),{$}=x;
 await x.scan(summary({...prof('模拟事务所'),alternatives:{phone:['010-00000001','010-00000002'],email:['one@example.invalid','two@example.invalid']}}));
 assert.equal($('#bidder-edit-phone').value,'');assert.equal($('#bidder-edit-email').value,'');
 const phone=$('#bidder-candidate-phone');assert.equal(phone.value,'');phone.value='010-00000002';x.change(phone);
 assert.equal($('#bidder-edit-phone').value,'010-00000002');assert.equal(x.db.size,0);
 await x.click('#bidder-new');assert.equal($('#bidder-candidate-phone'),null);
});

