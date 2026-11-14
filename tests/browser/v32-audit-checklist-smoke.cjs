'use strict';
// Synthetic full-workspace browser regression. No private checklist or credentials.
// node tests/browser/v32-audit-checklist-smoke.cjs [dist/index.html or offline.html]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html'));
const text='审计资料上传\n一、基础资料\n9. 营业执照\n14. 财务报表\n二、专项资料\n99. 合同清单';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function crc(b){let n=0xffffffff;for(const x of b){n^=x;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;}
function docx(){
  const paragraphs=['一、修订资料','88. 修订甲','90. 修订乙'].map(t=>'<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>').join('');
  const parts=[
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['word/document.xml','<w:document xmlns:w="'+W+'"><w:body>'+paragraphs+'</w:body></w:document>']
  ];
  const locals=[],central=[];let offset=0;
  for(const [name,raw]of parts){
    const n=Buffer.from(name),b=Buffer.from(raw),l=Buffer.alloc(30),c=Buffer.alloc(46),hash=crc(b);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(2048,6);l.writeUInt32LE(hash,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(2048,8);c.writeUInt32LE(hash,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,end]);
}
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  const requests=[],errors=[],steps=[];
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
    ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/,r=>r.abort());
    let agree=true;
    const setup=async()=>{
      const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>agree?d.accept():d.dismiss());
      await p.goto(pathToFileURL(entry).href);return p;
    };
    const p=await setup(),q=s=>p.locator(s);
    const wait=(selector,needle,page=p)=>page.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[selector,needle]);
    const audit=async(page=p)=>{
      await page.locator('[data-view=home]').click();await page.locator('[data-home-view=audit]').click();
      await page.locator('#audit-program').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#ac-project').disabled);await page.locator('#ac-import-mode').selectOption('legacy');
    };
    await audit();
    assert.deepEqual(await q('#ac-project option').evaluateAll(options=>options.map(x=>x.value)),['','00000000-0000-4000-8000-000000000033']);
    assert.equal(await q('#ac-project').inputValue(),'','neither trial nor formal context is auto-selected');
    assert.equal(await q('#ac-trial-note').isVisible(),false);
    assert.equal(await q('#ac-import').isDisabled(),true);
    assert.equal(await q('#ac-close').isDisabled(),true);
    steps.push('audit entry is live with an explicit independent trial option, but auto-selects and creates no checklist');

    const ids=await p.evaluate(async()=>{
      const c=document.createElement('canvas');c.width=c.height=20;c.getContext('2d').fillText('QA',1,10);
      const png=await new Promise(ok=>c.toBlob(ok,'image/png'));
      const pair=await Promise.all(['business_license','practice_certificate'].map((kind,i)=>QuotePacket.readAttachment(new File([png],'synthetic-'+i+'.png',{type:'image/png'}),kind)));
      const l=await QuoteLedger.open(),ids=[];
      try{
        for(const suffix of ['甲','乙','未立项']){
          const e=await l.register({firmName:'虚构事务所',customerName:'虚构审计单位',auditYear:2026,location:'河北',service:'年度财务报表审计',
            quoteDate:'2026-11-11',issuer:'虚构采购方',projectName:'虚构项目'+suffix,projectType:'年度财务报表审计',contactName:'',contactInfo:'',
            subtotalCents:1234500,taxCents:0,totalCents:1234500,taxRateText:'0%'},pair);
          await l.appendResult(e.id,{outcome:'won',expectedEventNo:0,note:'虚构测试中标'});ids.push(e.id);
        }
      }finally{l.close();}
      return ids;
    });
    for(const [i,id] of ids.slice(0,2).entries()){
      await q('[data-view=ledger]').click();await q('[data-initiation-id="'+id+'"]').click();await q('#project-init-save').waitFor({state:'visible'});
      await q('#project-init-manager').fill('虚构负责人'+i);await q('#project-init-save').click();await wait('#project-init-status','立项信息已保存');
    }
    await audit();
    assert.deepEqual(await q('#ac-project option').evaluateAll(options=>options.map(x=>x.value).filter(Boolean).sort()),['00000000-0000-4000-8000-000000000033',...ids.slice(0,2)].sort());
    assert.ok(!await q('#ac-project option[value="'+ids[2]+'"]').count());
    await q('#ac-project').selectOption(ids[0]);await wait('#ac-status','尚未导入');
    const get=async(id=ids[0],page=p)=>page.evaluate(async id=>{const db=await AuditChecklist.open();try{return await db.get(id);}finally{db.close();}},id);
    const importTxt=()=>q('#ac-import').setInputFiles({name:'synthetic-materials.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
    agree=false;await importTxt();await p.waitForTimeout(100);assert.equal(await get(),null);
    agree=true;await importTxt();await p.waitForFunction(()=>/字段|核对人/.test(document.querySelector('#ac-status')?.textContent||''));assert.equal(await get(),null);
    await q('#ac-reviewer').fill('虚构核对人甲');await importTxt();await wait('#ac-status','已导入 3 项');
    assert.deepEqual(await q('[data-material-id] strong').allTextContents(),['1、营业执照','2、财务报表','3、合同清单']);
    assert.deepEqual(await q('#ac-rows h3').allTextContents(),['一、基础资料','二、专项资料']);
    assert.equal(await q('#ac-close').isDisabled(),true);assert.equal((await get()).revision,1);
    steps.push('only saved formal project quoteIds plus explicit trial selectable; cancelled/missing-reviewer import has no side effect; TXT keeps headings with new continuous numbering');

    const stale=await setup();await audit(stale);await stale.locator('#ac-project').selectOption(ids[0]);await wait('#ac-status','已载入',stale);
    await stale.locator('#ac-reviewer').fill('旧页面核对人');
    const save=async(id,status,evidence='',reason='')=>{
      if(['received','problem'].includes(status)){
        await p.evaluate(async({key,id,status,evidence,reason})=>{const db=await AuditChecklist.open();try{const r=await db.get(key);await db.change(key,r.revision,{type:'item',id,status,evidence,reason,reviewer:document.querySelector('#ac-reviewer').value});}finally{db.close();}},{key:ids[0],id,status,evidence,reason});
        await q('#ac-refresh').click();await p.waitForFunction(()=>document.querySelector('#ac-project')?.disabled===false);assert.match(await q('[data-record-state="'+id+'"]').textContent(),status==='received'?/已收到/:/存在问题/);return;
      }
      await q('[data-item-status="'+id+'"]').selectOption(status==='confirmed'?'pending':status);
      await q('#ac-evidence-'+id).fill(evidence);await q('#ac-item-reason-'+id).fill(reason);
      await q('['+(status==='confirmed'?'data-confirm-item':'data-save-item')+'="'+id+'"]').click();
      await p.waitForFunction(id=>document.querySelector('[data-save-item="'+id+'"]')?.disabled===false,id);
    };
    await save('i1','received');
    assert.equal(await q('#ac-close').isDisabled(),true);
    await stale.locator('[data-item-status=i1]').selectOption('na');await stale.locator('#ac-item-reason-i1').fill('旧页不得覆盖');
    await stale.locator('[data-save-item=i1]').click();await wait('#ac-status','其他窗口',stale);
    assert.equal((await get()).states.i1.status,'received');await stale.close();
    await save('i2','confirmed');await wait('#ac-status','证据索引');assert.equal((await get()).states.i2.status,'pending');
    await save('i1','confirmed','WP-01');await wait('#ac-status','已保存本项核对');
    await save('i2','na');await wait('#ac-status','理由');assert.equal((await get()).states.i2.status,'pending');
    await save('i2','na','','本项目无此业务');await wait('#ac-status','已保存本项选择');
    await save('i3','problem','','等待补充合同明细');
    assert.equal(await q('#ac-close').isDisabled(),true);
    await save('i3','confirmed','WP-03');await wait('#ac-status','已保存本项核对');
    assert.equal(await q('#ac-close').isEnabled(),true);assert.equal((await get()).closed,null);
    await q('#ac-filter').selectOption('na');assert.equal(await q('[data-material-id]').count(),1);
    await q('#ac-filter').selectOption('all');await q('#ac-search').fill('合同');assert.equal(await q('[data-material-id]').count(),1);await q('#ac-search').fill('');
    steps.push('received/problem stay blocked; evidence and exclusion reason required; row-by-row confirmation and filtering work; stale tab cannot overwrite');

    agree=false;await q('#ac-close').click();await p.waitForTimeout(100);assert.equal((await get()).closed,null);
    agree=true;await q('#ac-close').click();await wait('#ac-status','已明确执行资料关门');
    assert.ok((await get()).closed);assert.equal(await q('#ac-import').isDisabled(),true);assert.equal(await q('[data-item-status=i1]').isDisabled(),true);assert.equal(await q('[data-save-item=i1]').isDisabled(),true);
    assert.equal(await q('#ac-reopen').isEnabled(),true);
    const [download]=await Promise.all([p.waitForEvent('download'),q('#ac-export').click()]);
    assert.equal(await download.failure(),null);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.record.project.quoteId,ids[0]);assert.ok(exported.record.closed);assert.equal(exported.record.events.at(-1).type,'close');
    assert.deepEqual(exported.record,await get());
    await p.reload();await audit();await q('#ac-project').selectOption(ids[0]);await wait('#ac-status','已载入');await q('#ac-reviewer').fill('虚构复核人');
    await q('#ac-reopen').click();await p.waitForFunction(()=>/字段|理由/.test(document.querySelector('#ac-status')?.textContent||''));assert.ok((await get()).closed);
    await q('#ac-reason').fill('收到修订材料，需要重新核对');await q('#ac-reopen').click();await wait('#ac-status','已重新开门');
    assert.equal((await get()).closed,null);
    assert.equal((await get()).events.at(-1).reason,'收到修订材料，需要重新核对');
    steps.push('close is explicit and cancellable, persists across reload, freezes edits/import, exports exact history; reopening requires and records a reason');

    await q('#ac-reason').fill('');
    const corrected={name:'synthetic-corrected.docx',mimeType:MIME,buffer:docx()};
    await q('#ac-import').setInputFiles(corrected);await p.waitForFunction(()=>/字段|理由/.test(document.querySelector('#ac-status')?.textContent||''));assert.equal((await get()).items.length,3);
    await q('#ac-reason').fill('采用修订后的逐行清单');await q('#ac-import').setInputFiles(corrected);await wait('#ac-status','已导入 2 项');
    const a=await get();assert.deepEqual(a.items.map(x=>[x.number,x.text]),[[1,'修订甲'],[2,'修订乙']]);assert.ok(Object.values(a.states).every(s=>s.status==='pending'));
    assert.equal(a.events.at(-1).oldItems.length,3);
    await q('#ac-project').selectOption(ids[1]);await wait('#ac-status','尚未导入');await q('#ac-reviewer').fill('虚构核对人乙');
    await q('#ac-import').setInputFiles({name:'synthetic-b-only.txt',mimeType:'text/plain',buffer:Buffer.from('一、乙项目资料\n91. 专属乙资料')});await wait('#ac-status','已导入 1 项');
    const b=await get(ids[1]);assert.equal(b.project.quoteId,ids[1]);assert.equal(b.items[0].text,'专属乙资料');
    await q('#ac-project').selectOption(ids[0]);await wait('#ac-status','已载入');assert.deepEqual(await get(),a);
    assert.equal(await q('#audit-program img').count(),0);
    steps.push('corrected DOCX resets only this project after a reason; old items/states remain audited; same browser projects stay isolated by quoteId');
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
  }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
  finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
