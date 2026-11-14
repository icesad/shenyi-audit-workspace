'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync(path.join(__dirname,'../dist',n),'utf8');
async function setup(t){
 const dom=new JSDOM('<div id="bidder-library-editor"></div><div id="bidder-picker"></div>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window,d=w.document;
 t.after(()=>dom.window.close());w.confirm=()=>true;const rows=new Map();let n=0;const logs=[];
 const save=(id,version,fields,attachments)=>{const r={...fields,id,version,credentialKinds:attachments.map(a=>a.kind),attachments};rows.set(id,r);return structuredClone(r);};
 const db={async create(fields,as){return save('row-'+ ++n,1,fields,as);},async get(id){if(!rows.has(id))throw Error('此记录不存在');return structuredClone(rows.get(id));},async list(){return [...rows.values()].map(({attachments,...r})=>r);},async update(id,v,fields,as){assert.equal(v,rows.get(id).version);return save(id,v+1,fields,as);},async remove(id,v){assert.equal(v,rows.get(id).version);rows.delete(id);}};
 w.QuotePacket={readAttachment:async(f,kind)=>{if(!f.name.endsWith('.pdf'))throw Error('只支持证照文件');return {kind,name:f.name};}};w.BidderLibrary={open:async()=>db};w.eval(read('rule-catalog.js'));w.eval(read('bidder-ui.js'));
 const ui=w.BidderUI.connect({apply:async r=>logs.push(['apply',r]),detach:async()=>logs.push(['detach'])});await ui.ready;
 const $=s=>d.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,0)),change=selector=>$(selector).dispatchEvent(new w.Event('change',{bubbles:true})),click=async s=>{$(s).click();await tick();};
 const set=(k,v)=>$('#bidder-edit-'+k).value=v,file=async(kind,name)=>{const e=$('#bidder-edit-'+kind);Object.defineProperty(e,'files',{configurable:true,value:[new w.File(['SYNTHETIC'],name)]});change('#bidder-edit-'+kind);await tick();};
 const pick=async id=>{$('#bidder-picker-select').value=id;change('#bidder-picker-select');await tick();};
 return {dom,w,d,rows,logs,db,ui,$,tick,click,set,file,pick};
}
test('own and partner firms, team aliases, missing certificates, editing files and deliberate selection',async t=>{
 const x=await setup(t),{rows,$,logs}=x;assert.equal($('#bidder-edit-team').options.length,35);assert.equal($('#bidder-picker-select').value,'');
 x.set('name','合成自有事务所');x.set('team','广西');x.set('contactName','合成联系人');await x.file('business_license','SYNTH-A.pdf');await x.click('#bidder-save');
 assert.equal(rows.size,1);assert.equal(rows.get('row-1').kind,'own');assert.equal(rows.get('row-1').team,'广西');assert.equal(rows.get('row-1').attachments.length,1);assert.equal(logs.length,0);
 await x.click('#bidder-new');x.set('kind','partner');x.set('name','<img src=x onerror=test>');x.set('team','河北');await x.click('#bidder-save');assert.equal(rows.size,2);assert.equal(rows.get('row-2').attachments.length,0);assert.equal($('#bidder-directory img'),null);
 await x.pick('row-1');assert.deepEqual(logs.map(a=>a[0]),['detach','apply']);assert.equal(logs.at(-1)[1].attachments[0].name,'SYNTH-A.pdf');
 await x.click('[data-bidder-edit="row-1"]');assert.equal($('#bidder-edit-name').value,'合成自有事务所');
 await x.file('business_license','SYNTH-B.pdf');await x.file('business_license','bad.bin');assert.match($('#bidder-editor-status').textContent,/未替换/);await x.file('practice_certificate','SYNTH-C.pdf');await x.click('#bidder-save');assert.equal(rows.get('row-1').version,2);assert.deepEqual(Array.from(rows.get('row-1').attachments,f=>f.name),['SYNTH-B.pdf','SYNTH-C.pdf']);assert.equal(logs.length,2);assert.equal(logs.at(-1)[1].attachments[0].name,'SYNTH-A.pdf');assert.match($('#bidder-picker-status').textContent,/更新/);
 await x.click('#bidder-clear-business_license');await x.click('#bidder-save');assert.deepEqual(Array.from(rows.get('row-1').attachments,f=>f.kind),['practice_certificate']);
 await x.click('#bidder-apply');assert.deepEqual(logs.at(-1)[1].attachments.map(a=>a.name),['SYNTH-C.pdf']);
 await x.click('[data-bidder-remove="row-1"]');assert.equal(rows.size,1);assert.equal(logs.length,4);assert.equal($('#bidder-picker-select').selectedOptions[0].disabled,true);assert.match($('#bidder-picker-status').textContent,/原资料已删除/);
 await x.pick('row-2');assert.equal(logs.at(-1)[1].kind,'partner');assert.equal(logs.at(-1)[1].attachments.length,0);
 await x.click('#bidder-unlink');assert.equal(logs.at(-1)[0],'detach');assert.equal($('#bidder-picker-select').value,'');
});
test('nonexistent firm lookup cannot apply prior identity or files and external reset cancels a pending read',async t=>{
 const x=await setup(t);x.set('name','A');await x.click('#bidder-save');await x.pick('row-1');x.db.get=async()=>{throw Error('无法读取');};await x.click('#bidder-apply');
 assert.equal(x.$('#bidder-picker-select').value,'');assert.match(x.$('#bidder-picker-status').textContent,/未带入/);assert.equal(x.logs.at(-1)[0],'detach');
 let resolve;x.db.get=()=>new Promise(r=>{resolve=r;});await x.pick('row-1');assert.equal(x.$('#bidder-picker-select').disabled,true);x.ui.clearPicker();resolve(x.rows.get('row-1'));await x.tick();assert.equal(x.logs.filter(a=>a[0]==='apply').length,1);assert.equal(x.$('#bidder-picker-select').value,'');
});
test('failed storage open leaves a usable manual mode',async t=>{
 const dom=new JSDOM('<div id="bidder-library-editor"></div><div id="bidder-picker"></div>',{runScripts:'outside-only'}),w=dom.window;t.after(()=>dom.window.close());w.eval(read('bidder-ui.js'));w.BidderLibrary={open:async()=>{throw Error('存储不可用');}};let detaches=0;const ui=w.BidderUI.connect({apply:()=>{},detach:()=>{detaches++;}});await ui.ready;
 assert.match(w.document.querySelector('#bidder-picker-status').textContent,/手工录入/);assert.equal(w.document.querySelector('#bidder-picker-select').disabled,true);w.document.querySelector('#bidder-unlink').click();assert.equal(detaches,1);
});