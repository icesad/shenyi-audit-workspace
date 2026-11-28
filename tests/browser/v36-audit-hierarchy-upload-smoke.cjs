/* Native file chooser and local file persistence regression. Fictional Word/materials only. */
'use strict';
const readRetainedFile=require('./read-retained-checklist-file.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html')),TRIAL='00000000-0000-4000-8000-000000000033',W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function crc(b){let n=0xffffffff;for(const x of b){n^=x;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;}
function wordFixture(){
 const lines=['一、基础资料','1. 企业证照','企业证照分组的说明，不成为上传项','1.1 营业执照','营业执照正文说明甲','营业执照正文说明乙','1.2 执业证明','执业证明正文说明','2. 银行资料','银行资料正文说明'];
 const parts=[['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
 ['word/document.xml','<w:document xmlns:w="'+W+'"><w:body>'+lines.map(t=>'<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>'+t+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>'],
 ['word/styles.xml','<w:styles xmlns:w="'+W+'"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>']];
 const locals=[],central=[];let offset=0;
 for(const [name,raw]of parts){const n=Buffer.from(name),b=Buffer.from(raw),l=Buffer.alloc(30),c=Buffer.alloc(46),hash=crc(b);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(2048,6);l.writeUInt32LE(hash,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(2048,8);c.writeUInt32LE(hash,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);locals.push(l,n,b);central.push(c,n);offset+=30+n.length+b.length;}
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true}),steps=[],requests=[],errors=[];
 try{
  const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1360,height:1000}});ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/,r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(pathToFileURL(entry).href);
  const q=s=>p.locator(s),wait=(s,n)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[s,n]),idle=()=>p.waitForFunction(()=>document.querySelector('#ac-import')?.disabled===false);
  const get=()=>p.evaluate(async id=>{const db=await AuditChecklist.openTrial();try{return await db.get(id);}finally{db.close();}},TRIAL);
  const enter=async()=>{await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await q('#ac-import-mode').selectOption('legacy');await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await wait('#ac-status','已进入独立试用');await idle();};
  const review=async(id,status,reason='')=>{await q('[data-item-status='+id+']').selectOption(status==='confirmed'?'pending':status);await q('#ac-item-reason-'+id).fill(reason);await q('['+(status==='confirmed'?'data-confirm-item':'data-save-item')+'='+id+']').click();await idle();await wait('#ac-status',status==='confirmed'?'已保存本项核对':'已保存本项选择');};
  const choose=async(id,files)=>{const [chooser]=await Promise.all([p.waitForEvent('filechooser'),q('[data-upload-node='+id+']').click()]);assert.equal(await chooser.element().getAttribute('id'),'ac-file-'+id);assert.equal(chooser.isMultiple(),true);await chooser.setFiles(files);await idle();};
  const downloaded=async id=>{const [d]=await Promise.all([p.waitForEvent('download'),q('[data-material-download="'+id+'"]').click()]);assert.equal(await d.failure(),null);return fs.readFileSync(await d.path());};
  await enter();await q('#ac-import-mode').selectOption('numbered');assert.equal(await q('#ac-import-mode').inputValue(),'numbered');const legacy=await get();assert.equal(legacy.schema,1);
  await q('#ac-reviewer').fill('虚构核对人');await q('#ac-reason').fill('按编号预览后整理为标题资料');
  await q('#ac-import').setInputFiles({name:'synthetic-hierarchy.docx',mimeType:MIME,buffer:wordFixture()});await idle();
  assert.equal(await q('#ac-outline-preview').isVisible(),true);assert.equal(await q('[data-outline-level]').count(),10);
  assert.match(await q('.ac-outline-warning').textContent(),/按编号.*建议/);assert.deepEqual(await get(),legacy,'reading Word alone cannot overwrite existing confirmations');
  assert.equal(await q('#ac-import-continue').isDisabled(),true);assert.equal(await q('#ac-outline-confirm').isChecked(),false);
  assert.deepEqual(await q('[data-outline-level]').evaluateAll(xs=>xs.map(x=>x.value)),['1','2','0','3','0','0','3','0','2','0']);
  await q('#ac-outline-confirm').check();assert.equal(await q('#ac-import-continue').isEnabled(),true);await q('[data-outline-level="3"]').selectOption('2');assert.equal(await q('#ac-outline-confirm').isChecked(),false);assert.equal(await q('#ac-import-continue').isDisabled(),true);
  await q('[data-outline-level="3"]').selectOption('3');await q('#ac-outline-confirm').check();await q('#ac-import-continue').click();await wait('#ac-status','已导入 3 项');await idle();
  let r=await get();assert.equal(r.schema,2);assert.equal(r.nodes.length,5);assert.equal(Object.keys(r.states).length,3);assert.deepEqual(r.legacy,legacy);
  assert.deepEqual(r.nodes.map(n=>[n.id,n.parentId,n.level]),[['n1','',1],['n2','n1',2],['n3','n2',3],['n4','n2',3],['n5','n1',2]]);
  assert.equal(r.nodes[2].description,'营业执照正文说明甲\n营业执照正文说明乙');assert.equal(await q('[data-tree-group=n1] [data-tree-group=n2] [data-material-id=n3]').count(),1);
  assert.equal(await q('[data-save-item=n1],[data-save-item=n2],[data-upload-node=n1],[data-upload-node=n2]').count(),0,'parents are groups, not independent confirmations');
  assert.equal(await q('[data-upload-node]').count(),3);assert.equal(await q('#ac-close').isDisabled(),true);
  steps.push('Word remains a preview until explicit acknowledgement; numbered fallback warning is honest, manual level edits clear acknowledgement, descriptions stay under nested leaf titles');

  const pdf=Buffer.from(await p.evaluate(async()=>{const d=await PDFLib.PDFDocument.create(),pg=d.addPage([300,300]);pg.drawText('Fictional material PDF');return Array.from(await d.save());}));
  await q('#ac-reviewer').fill('');const beforeUpload=await get();await choose('n3',[{name:'synthetic-license.pdf',mimeType:'application/pdf',buffer:pdf}]);
  assert.equal(await q('[data-material-id=n3] .ac-material-pending').isVisible(),true);assert.match(await q('[data-material-id=n3] .ac-material-pending').textContent(),/synthetic-license\.pdf/);assert.deepEqual(await get(),beforeUpload);
  await q('#ac-reviewer').fill('虚构核对人');await q('[data-material-id=n3] .ac-material-pending').getByRole('button',{name:'保存所选资料',exact:true}).click();await idle();r=await get();assert.equal(r.states.n3.status,'received');assert.equal(r.states.n4.status,'pending');assert.equal(r.attachments.n3.length,1);const pdfId=r.attachments.n3[0].id;assert.deepEqual(await downloaded(pdfId),pdf);
  const txt=Buffer.from('SYNTHETIC_BODY_ONLY_NOT_IN_JSON_36\n虚构执业证明说明');await choose('n4',[{name:'synthetic-practice.txt',mimeType:'text/plain',buffer:txt}]);r=await get();assert.equal(r.states.n4.status,'received');const txtId=r.attachments.n4[0].id;assert.deepEqual(await downloaded(txtId),txt);
  await review('n3','confirmed');await review('n4','confirmed');assert.equal(await q('#ac-close').isDisabled(),true,'one unreviewed leaf blocks the whole hierarchy');
  steps.push('native leaf-title chooser targets the correct node; missing reviewer stages files without writing; saved PDF/TXT bytes download unchanged and upload alone is only received');

  await choose('n3',[{name:'synthetic-updated.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional update')}]);r=await get();assert.equal(r.states.n3.status,'received');assert.equal(r.attachments.n3.length,2);const updatedId=r.attachments.n3[1].id;
  await q('#ac-search').fill('营业执照');assert.equal(await q('[data-material-id]').count(),1);assert.equal(await q('#ac-close').isDisabled(),true);await q('#ac-search').fill('');
  await review('n3','confirmed');await q('#ac-reason').fill('更新资料须重新核对');await q('[data-material-remove="'+updatedId+'"]').click();await idle();r=await get();assert.equal(r.states.n3.status,'received');assert.equal(r.attachments.n3.length,1);
  const beforeMissingReason=await get();await q('#ac-reason').fill('');await q('[data-material-remove="'+pdfId+'"]').click();await idle();assert.match(await q('#ac-status').textContent(),/操作理由/);assert.deepEqual(await get(),beforeMissingReason);
  await q('#ac-reason').fill('解除当前营业执照关联，保留历史');await q('[data-material-remove="'+pdfId+'"]').click();await idle();r=await get();assert.equal(r.states.n3.status,'pending');assert.deepEqual(r.attachments.n3,[]);assert.equal(r.events.filter(e=>e.type==='attachment-add'&&e.nodeId==='n3').length,2);
  await review('n3','na','证照由其他资料索引核对，本项不适用');await review('n5','na','虚构试用无银行资料');assert.equal(await q('#ac-close').isEnabled(),true);assert.equal((await get()).closed,null);
  steps.push('new files and removals invalidate previous leaf confirmation, missing removal reason cannot mutate data, filters cannot bypass unfinished leaves and history retains detached versions');

  await q('#ac-close').click();await wait('#ac-status','已明确执行资料关门');r=await get();assert.ok(r.closed);
  assert.equal(await q('[data-upload-node=n4]').isDisabled(),true);assert.equal(await q('#ac-file-n4').isDisabled(),true);assert.equal(await q('[data-material-remove="'+txtId+'"]').isDisabled(),true);assert.equal(await q('[data-material-download="'+txtId+'"]').isEnabled(),true);assert.deepEqual(await downloaded(txtId),txt);
  assert.equal(await q('.ac-history,[data-history-download]').count(),0);
  assert.deepEqual(await readRetainedFile(p,TRIAL,pdfId,true),pdf,'detached PDF is preserved while closed');
  await q('#ac-reason').fill('');await q('#ac-reopen').click();await wait('#ac-status','操作理由');assert.ok((await get()).closed);await q('#ac-reason').fill('收到新版资料后继续核对');await q('#ac-reopen').click();await wait('#ac-status','已重新开门');const reopened=await get();assert.equal(reopened.closed,null);assert.equal(await q('[data-upload-node=n4]').isEnabled(),true);
  await p.reload();await enter();assert.deepEqual(await get(),reopened);assert.deepEqual(await downloaded(txtId),txt);
  const [json]=await Promise.all([p.waitForEvent('download'),q('#ac-export').click()]);const raw=fs.readFileSync(await json.path(),'utf8'),exported=JSON.parse(raw);assert.deepEqual(exported.record,reopened);assert.ok(!raw.includes('SYNTHETIC_BODY_ONLY_NOT_IN_JSON_36'));assert.ok(!/"blob"|data:application\//u.test(raw));await wait('#ac-status','JSON 不含文件正文');
  const counts=await p.evaluate(async id=>{const l=await QuoteLedger.open(),m=await AuditChecklist.open();try{return {quotes:(await l.list()).length,projects:(await ProjectInitiation.listSaved()).length,main:await m.get(id)};}finally{l.close();m.close();}},TRIAL);
  assert.deepEqual(counts,{quotes:0,projects:0,main:null});assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  steps.push('closed records lock uploads/removals while retaining current and detached historical downloads; reasoned reopen, reload and metadata-only JSON preserve the tree/files without generating formal procurement or initiation records');
  console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
 }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
 finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
