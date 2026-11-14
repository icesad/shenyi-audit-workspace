'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const base=path.join(__dirname,'../dist'),source=fs.readFileSync(path.join(base,'bid-documents.js'),'utf8');
const docx=Buffer.from('UEsDBBQAAAAIAAi5Zl2sbhJanQAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PMQ7CMAxFr1JlRdSIgQG1XdiBgQtYqdtGxHaUGCi3RwWpA/PXe0+/ub0TlWrmKKV1k1k6AhQ/EWOpNZHMHAfNjFZqzSMk9HccCfa73QG8ipHY1haH65rLk3IOPVVXzHZGptbBS3MPvfoHk1g9c3TV6Yct5dZhSjF4tKACT+n/mlsdhuBp5RdbyuqplCAjx3pdGINsFj10DXxPdR9QSwMEFAAAAAgACLlmXUzXYcNbAAAAaQAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEXMwQ2AIAwAwFWMA1jjwwdBdkFAIKEtoRh0e5/eAKeH8uxuDNSnBwuJGseceq8KQFwKaGXhGujBcnFD22XhFmFw87WxCyKZIhbY1nUHtJlmo4c62b9gNPy5+QBQSwECFAAUAAAACAAIuWZdrG4SWp0AAADcAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUABQAAAAIAAi5Zl1M12HDWwAAAGkAAAARAAAAAAAAAAAAAACAAc4AAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAABYAQAAAAA=','base64'),docMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdf=name=>({name:name+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% synthetic '+name+'\n%%EOF\n')});
test('five independent bid uploads: old slot recovery, scoped original bytes, and asynchronous isolation',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed playwright');}
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executablePath))return t.skip('no installed chromium');
  const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true});
  try{
    const c=await browser.newContext({acceptDownloads:true}),p=await c.newPage();p.setDefaultTimeout(4000);let allowConfirmation=true;p.on('dialog',d=>allowConfirmation?d.accept():d.dismiss());
    const A={issuer:'合成发标单位',projectName:'甲项目',firmName:'合成审计所',bidderId:'synthetic-A'}, B={...A,projectName:'乙项目'};
    const l=s=>p.locator(s),isOn=(s,on)=>l(s).isEnabled().then(ok=>assert.equal(ok,on,s));
    async function boot(project){
      await p.goto(pathToFileURL(path.join(base,'rule-catalog.js')).href);
      await p.evaluate(()=>{document.body.replaceChildren(document.createElement('main'));});
      await p.addScriptTag({content:source});await p.evaluate(async obj=>{
        window.now=obj;window.api=BidDocuments.mount(document.querySelector('main'),{project:()=>now});await api.ready;
      },project);
    }
    const move=async obj=>p.evaluate(async o=>{window.now=o;await api.refresh();},obj);
    const status=async text=>p.waitForFunction(s=>document.querySelector('.bd-msg').textContent.includes(s),text);
    async function original(sel,name,bytes){
      const download=p.waitForEvent('download');await l(sel).click();const dl=await download;
      assert.equal(dl.suggestedFilename(),name);assert.deepEqual(fs.readFileSync(await dl.path()),bytes);
    }
    const five=async()=>{
      assert.equal(await l('main input[type=file]').count(),5);assert.equal(await l('#bd-template-file').count(),0);
      assert.deepEqual(await l('[data-bid-slot]').evaluateAll(x=>x.map(y=>y.dataset.bidSlot)),['1','2','3','4','5']);
    };
    await boot({...A,firmName:''});await five();
    for(const slot of [1,2,3,4,5])await isOn('#bd-slot-'+slot+'-file',false);
    assert.equal(await l('.bd-legacy').isVisible(),false);
    await move(A);await isOn('#bd-slot-1-file',true);await isOn('#bd-slot-1-download',false);
    const oldSlot1=pdf('旧版主标书'),oldTemplate={name:'旧版合成通用模板.docx',mimeType:docMime,buffer:docx},oldSlot2=pdf('旧版技术部分'),oldSlot5=pdf('旧版价格部分');
    const scope='project:'+JSON.stringify(['',A.issuer,A.projectName,['library',A.bidderId]]);
    // Seed the exact old v14 IndexedDB schema without publishing any real documents.
    await p.evaluate(({rows})=>new Promise((resolve,reject)=>{
      const req=indexedDB.open('hengdu.quote.bidDocs.v1',1);
      req.onerror=()=>reject(req.error);req.onsuccess=()=>{
        const db=req.result,tr=db.transaction(['metadata','originals'],'readwrite');
        tr.oncomplete=()=>{db.close();resolve();};tr.onabort=()=>{db.close();reject(tr.error);};
        for(const {recordScope,slot,label,name,mimeType,bytes} of rows){
          const id=JSON.stringify([recordScope,slot]),blob=new Blob([Uint8Array.from(bytes)],{type:mimeType});
          tr.objectStore('metadata').put({id,scope:recordScope,slot,version:1,label,file:{name,size:blob.size,mime:mimeType}});
          tr.objectStore('originals').put(blob,id);
        }
      };
    }),{rows:[[scope,1,'旧版主文档',oldSlot1],['template',0,'',oldTemplate],[scope,2,'技术部分',oldSlot2],[scope,5,'价格部分',oldSlot5]].map(([recordScope,slot,label,f])=>({recordScope,slot,label,name:f.name,mimeType:f.mimeType,bytes:[...f.buffer]}))});
    await p.evaluate(()=>api.refresh(true));await five();
    assert.match(await l('#bd-slot-1-title').innerText(),/旧版主文档/);
    assert.match(await l('#bd-slot-2-title').innerText(),/技术部分/);
    assert.match(await l('#bd-slot-5-title').innerText(),/价格部分/);
    await original('#bd-slot-1-download',oldSlot1.name,oldSlot1.buffer);
    for(const [sel,f] of [['#bd-slot-2-download',oldSlot2],['#bd-slot-5-download',oldSlot5]])await original(sel,f.name,f.buffer);
    assert.equal(await l('.bd-legacy').getAttribute('open'),null);
    await l('.bd-legacy summary').click();
    assert.doesNotMatch(await l('.bd-legacy').innerText(),/技术部分/);
    await original('#bd-template-download',oldTemplate.name,oldTemplate.buffer);
    await l('#bd-slot-2-name').fill('新技术册');await l('#bd-slot-2-rename').click();await status('名称已保存');
    assert.match(await l('#bd-slot-2-title').innerText(),/新技术册/);
    await original('#bd-slot-2-download',oldSlot2.name,oldSlot2.buffer);
    const uploaded=[pdf('测试第三册'),pdf('测试第四册')];
    for(const [i,f] of uploaded.entries()){
      const slot=i+3;await l('#bd-slot-'+slot+'-file').setInputFiles(f);await status(f.name);
      await original('#bd-slot-'+slot+'-download',f.name,f.buffer);
    }
    const final={name:'完成编辑的合成标书.docx',mimeType:docMime,buffer:docx};
    allowConfirmation=false;await l('#bd-slot-1-file').setInputFiles(final);
    await original('#bd-slot-1-download',oldSlot1.name,oldSlot1.buffer);
    allowConfirmation=true;await l('#bd-slot-1-file').setInputFiles(final);await status(final.name);
    await p.reload();await boot(A);await five();await original('#bd-slot-1-download',final.name,final.buffer);
    assert.match(await l('#bd-slot-2-title').innerText(),/新技术册/);
    for(const [i,f] of uploaded.entries())await original('#bd-slot-'+(i+3)+'-download',f.name,f.buffer);
    // Separate same-name libraries by stable identity; manual typing the same name grants no access.
    await move({...A,firmName:'更名的合成审计所'});await original('#bd-slot-1-download',final.name,final.buffer);assert.match(await l('.bd-context').innerText(),/更名/);
    for(const x of [B,{...A,issuer:'不同发标单位'},{...A,bidderId:'synthetic-other'},{...A,bidderId:''},{...A,firmName:'另一手工事务所',bidderId:''}]){
      await move(x);await five();
      for(const slot of [1,2,3,4,5])await isOn('#bd-slot-'+slot+'-download',false);
    }
    await move(A);
    for(const [bad,reason] of [
      [{name:'伪.docx',mimeType:docMime,buffer:Buffer.from('PK\x03\x04not an OOXML document')},'文件内容'],
      [{name:'伪.pdf',mimeType:'application/pdf',buffer:Buffer.from('<script>NO EXECUTION</script>')},'文件内容'],
      [{name:'不支持.docm',mimeType:'application/octet-stream',buffer:Buffer.from('opaque')},'仅支持'],
      [{name:'空.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(0)},'文件为空']
    ]){
      await l('#bd-slot-1-file').setInputFiles(bad);await status(reason);
    }
    await p.evaluate(()=>{const f=new File([new Uint8Array(12*1024*1024+1)],'large.pdf',{type:'application/pdf'}),dt=new DataTransfer();dt.items.add(f);
      const e=document.querySelector('#bd-slot-1-file');e.files=dt.files;e.dispatchEvent(new Event('change'));});
    await status('12 MB');await original('#bd-slot-1-download',final.name,final.buffer);
    // The user switches projects before the selected File finishes reading.
    await p.evaluate(()=>{const f=new File(['%PDF-1.4\n% parked\n%%EOF\n'],'parked.pdf',{type:'application/pdf'}),read=f.arrayBuffer.bind(f);
      f.arrayBuffer=async()=>{await new Promise(r=>window.resumeRead=r);return read();};const dt=new DataTransfer();dt.items.add(f);
      const input=document.querySelector('#bd-slot-1-file');Object.defineProperty(input,'files',{configurable:true,value:dt.files});input.dispatchEvent(new Event('change'));});
    await p.waitForFunction(()=>typeof window.resumeRead==='function');await move(B);await p.evaluate(()=>{resumeRead();});
    await isOn('#bd-slot-1-download',false);await move(A);await original('#bd-slot-1-download',final.name,final.buffer);
    allowConfirmation=false;await l('#bd-slot-1-remove').click();await original('#bd-slot-1-download',final.name,final.buffer);
    allowConfirmation=true;await l('#bd-slot-1-remove').click();await status('已移除');await isOn('#bd-slot-1-download',false);
    for(const [sel,f] of [['#bd-slot-2-download',oldSlot2],['#bd-slot-5-download',oldSlot5]])await original(sel,f.name,f.buffer);
    for(const [i,f] of uploaded.entries())await original('#bd-slot-'+(i+3)+'-download',f.name,f.buffer);
    await l('.bd-legacy summary').click();
    await original('#bd-template-download',oldTemplate.name,oldTemplate.buffer);
    await five();await c.close();
  }finally{await browser.close();}
});
