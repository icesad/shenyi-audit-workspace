/* Synthetic browser acceptance of the built-in material directory. No private Word/evidence. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html')),TRIAL='00000000-0000-4000-8000-000000000033';
const project={quoteId:TRIAL,projectName:'独立试用项目（不关联立项）',firmName:''};
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  const steps=[],requests=[],errors=[];
  try{
    async function setup(){
      const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});let agree=true;
      ctx.on('request',r=>{if(/^(?:https?|wss?):/u.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/u,r=>r.abort());
      const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>agree?d.accept():d.dismiss());
      await p.goto(pathToFileURL(entry).href);const q=s=>p.locator(s),wait=(s,n)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[s,n]);
      const audit=async()=>{await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await p.waitForFunction(()=>document.querySelector('#ac-project')?.disabled===false);};
      const idle=()=>p.waitForFunction(()=>document.querySelector('#ac-project')?.disabled===false&&document.querySelector('#ac-trial')?.disabled===false);
      const get=()=>p.evaluate(async id=>{const d=await AuditChecklist.openTrial();try{return await d.get(id);}finally{d.close();}},TRIAL);
      const counts=()=>p.evaluate(async id=>{const l=await QuoteLedger.open(),m=await AuditChecklist.open();try{return{quotes:(await l.list()).length,projects:(await ProjectInitiation.listSaved()).length,main:await m.get(id)};}finally{l.close();m.close();}},TRIAL);
      return {ctx,p,q,wait,audit,idle,get,counts,agree:v=>{agree=v;}};
    }
    const fresh=await setup(),{p,q,wait,audit,idle,get}=fresh;
    await audit();assert.equal(await q('#ac-import-mode').inputValue(),'outline');assert.equal(await get(),null,'opening audit alone does not initialize a trial');
    assert.ok(await q('#ac-use-template').isVisible());assert.equal(await q('#ac-import').inputValue(),'');
    const height=await q('#ac-import-mode').evaluate(e=>e.getBoundingClientRect().height);assert.ok(height>=40&&height<=44,'mode control uses the same 40px input rhythm');
    await q('#ac-trial').click();await wait('#ac-status','已进入独立试用');await idle();
    let r=await get();const template=await p.evaluate(()=>AuditMaterialTemplate.get()),stats=await p.evaluate(()=>AuditMaterialTemplate.stats());
    assert.equal(r.schema,2);assert.equal(r.nodes.length,112);assert.deepEqual(r.nodes,template);
    assert.deepEqual({headings:stats.headings,groups:stats.groups,materials:stats.materials,maxLevel:stats.maxLevel},{headings:112,groups:23,materials:89,maxLevel:4});
    assert.deepEqual(stats.categories.map(c=>[c.id,c.materials]),[['n1',22],['n26',60],['n103',7],['n112',0]]);
    assert.equal(Object.keys(r.states).length,89);assert.ok(Object.values(r.states).every(s=>s.status==='pending'));assert.ok(Object.values(r.attachments).every(xs=>xs.length===0));assert.equal(r.closed,null);
    assert.match(r.events[0].reviewer,/系统/);assert.equal(await q('#ac-outline-preview').isVisible(),false);assert.equal(await q('[data-audit-category]').count(),4);
    assert.equal(await q('[data-tree-group=n1]').evaluate(e=>e.open),true);for(const id of ['n26','n103','n112'])assert.equal(await q('[data-tree-group='+id+']').evaluate(e=>e.open),false);
    assert.equal(await q('[data-upload-node]').count(),89);assert.equal(await q('#ac-close').isDisabled(),true);assert.deepEqual(await fresh.counts(),{quotes:0,projects:0,main:null});
    steps.push('default outline mode and explicit fresh trial initialize the typed 112-node template with four categories and exactly 89 pending materials, without uploading Word or creating business records');

    const nestedSearch=template.find(n=>n.id==='n105');await q('#ac-search').fill(nestedSearch.title);
    assert.equal(await q('[data-tree-group=n103]').evaluate(e=>e.open),true);assert.equal(await q('[data-tree-group=n104]').evaluate(e=>e.open),true);
    assert.equal(await q('[data-upload-node=n105]').isVisible(),true);assert.equal(await q('#ac-close').isDisabled(),true,'searching a branch cannot reduce the global gate');
    await q('[data-audit-category=n112]').click();assert.equal(await q('#ac-search').inputValue(),'');assert.equal(await q('[data-tree-group=n112]').evaluate(e=>e.open),true);
    assert.match(await q('[data-tree-group=n112]').textContent(),/暂无预设资料项/);assert.equal(await q('[data-tree-group=n112] [data-upload-node],[data-save-item=n112],[data-item-status=n112]').count(),0);
    const beforeGroup=await get();const groupErrors=await p.evaluate(async id=>{const d=await AuditChecklist.openTrial(),messages=[];try{let r=await d.get(id);for(const run of [()=>d.change(id,r.revision,{type:'item',id:'n112',status:'na',reason:'虚构理由',evidence:'',reviewer:'虚构核对人'}),()=>d.attach(id,r.revision,'n112',new File(['synthetic'],'group-forbidden.txt',{type:'text/plain'}),'虚构核对人')]){try{await run();messages.push('');}catch(e){messages.push(e.message);}}return messages;}finally{d.close();}},TRIAL);
    assert.ok(groupErrors.every(Boolean));assert.deepEqual(await get(),beforeGroup);assert.equal(await q('#ac-close').isDisabled(),true,'scrolling to an empty category cannot narrow the global gate');
    await q('[data-audit-category=n1]').click();await q('#ac-reviewer').fill('虚构模板核对人');
    const material=template.find(n=>n.kind==='material'),bytes=Buffer.from('SYNTHETIC_V37_MATERIAL_NOT_A_REAL_LICENSE\n测试资料字节保留','utf8');
    const [chooser]=await Promise.all([p.waitForEvent('filechooser'),q('[data-upload-node='+material.id+']').click()]);assert.equal(await chooser.element().getAttribute('id'),'ac-file-'+material.id);assert.equal(chooser.isMultiple(),true);
    await chooser.setFiles({name:'synthetic-v37-material.txt',mimeType:'text/plain',buffer:bytes});await wait('#ac-status','资料已保存');await idle();r=await get();
    assert.equal(r.states[material.id].status,'received');assert.equal(r.attachments[material.id].length,1);const file=r.attachments[material.id][0];assert.equal(file.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
    const [download]=await Promise.all([p.waitForEvent('download'),q('[data-material-download="'+file.id+'"]').click()]);assert.equal(await download.failure(),null);assert.deepEqual(fs.readFileSync(await download.path()),bytes);
    const saved=r;await p.reload();await audit();assert.equal(await q('#ac-import-mode').inputValue(),'outline');await q('#ac-trial').click();await idle();assert.deepEqual(await get(),saved,'an existing v2 record/files never auto-reset to the template');
    steps.push('empty fourth category is a nonrequired group with no upload or review controls; native material title opens its own picker, saves received-only bytes and reload retains the exact v2 record/files');

    await q('#ac-use-template').click();await q('#ac-import-pending').waitFor({state:'visible'});assert.deepEqual(await get(),saved);assert.equal(await q('[data-outline-level]').count(),0,'built-in template preview is read-only');
    assert.equal(await q('#ac-outline-confirm').isChecked(),false);assert.equal(await q('#ac-import-continue').isDisabled(),true);
    await q('#ac-outline-confirm').check();await q('#ac-import-continue').click();await p.waitForFunction(()=>document.activeElement?.id==='ac-reviewer');assert.deepEqual(await get(),saved);
    await q('#ac-reviewer').fill('虚构模板替换人');await q('#ac-import-continue').click();await p.waitForFunction(()=>document.activeElement?.id==='ac-reason');assert.deepEqual(await get(),saved);
    await q('#ac-reason').fill('明确采用新版内置模板');fresh.agree(false);await q('#ac-import-continue').click();await idle();assert.deepEqual(await get(),saved);assert.equal(await q('#ac-import-pending').isVisible(),true);
    fresh.agree(true);await q('#ac-import-continue').click();await wait('#ac-status','已导入 89 项');await idle();r=await get();
    assert.equal(r.schema,2);assert.notEqual(r.generationId,saved.generationId);assert.deepEqual(r.nodes,template);assert.ok(Object.values(r.states).every(s=>s.status==='pending'));assert.ok(Object.values(r.attachments).every(xs=>xs.length===0));
    const replaced=r.events.at(-1);assert.equal(replaced.type,'tree-replace');assert.deepEqual(replaced.oldNodes,saved.nodes);assert.deepEqual(replaced.oldStates,saved.states);assert.deepEqual(replaced.oldAttachments,saved.attachments);
    await q('.ac-history').evaluate(e=>e.open=true);const [oldFile]=await Promise.all([p.waitForEvent('download'),q('[data-history-download="'+file.id+'"]').click()]);assert.equal(await oldFile.failure(),null);assert.deepEqual(fs.readFileSync(await oldFile.path()),bytes);
    await p.evaluate(async id=>{const db=await AuditChecklist.openTrial();try{let r=await db.get(id);for(const n of r.nodes.filter(n=>n.kind==='material'))r=await db.change(id,r.revision,{type:'item',id:n.id,status:'na',evidence:'',reason:'虚构模板验收，本项不适用',reviewer:'虚构模板核对人'});}finally{db.close();}},TRIAL);
    await q('#ac-refresh').click();await idle();assert.equal((await get()).nodes.find(n=>n.id==='n112').kind,'group');assert.equal(await q('#ac-close').isEnabled(),true,'all 89 materials done is sufficient: the empty fourth group cannot block closing');
    await q('#ac-close').click();await wait('#ac-status','已明确执行资料关门');assert.ok((await get()).closed);
    steps.push('template replacement requires read-only preview, acknowledgement, reviewer, reason and final confirmation; new generation resets current review while retaining old file history; empty group does not block an otherwise completed 89-material gate');
    await fresh.ctx.close();

    const old=await setup();await old.audit();await old.q('#ac-import-mode').selectOption('legacy');await old.q('#ac-trial').click();await old.wait('#ac-status','已进入独立试用');await old.idle();const v1=await old.get();assert.equal(v1.schema,1);assert.equal(v1.items.length,3);
    await old.p.reload();await old.audit();assert.equal(await old.q('#ac-import-mode').inputValue(),'outline');await old.q('#ac-trial').click();await old.idle();assert.deepEqual(await old.get(),v1,'existing v1 must not be silently migrated');
    await old.q('#ac-use-template').click();await old.q('#ac-outline-confirm').check();await old.q('#ac-reviewer').fill('虚构旧记录升级人');await old.q('#ac-reason').fill('核对后改用2026模板');await old.q('#ac-import-continue').click();await old.wait('#ac-status','已导入 89 项');const migrated=await old.get();assert.equal(migrated.schema,2);assert.equal(migrated.nodes.length,112);assert.deepEqual(migrated.legacy,v1);
    steps.push('explicit legacy option still creates old three-item fixtures; ordinary re-entry leaves v1 untouched; only reviewed template adoption migrates while preserving the complete legacy record');await old.ctx.close();

    const custom=await setup(),customBytes=Buffer.from('SYNTHETIC_OLD_CUSTOM_TEMPLATE_FILE');
    const customRecord=await custom.p.evaluate(async({pr,values})=>{const d=await AuditChecklist.openTrial();try{const nodes=[{id:'n1',parentId:'',level:1,title:'虚构自定义旧目录',description:'自定义备注不得丢失',kind:'group'},{id:'n2',parentId:'n1',level:2,title:'虚构旧资料项',description:'本条不是内置模板',kind:'material'}];let r=await d.importTree(pr,nodes,'虚构旧导入人');return await d.attach(pr.quoteId,r.revision,'n2',new File([Uint8Array.from(values)],'synthetic-old-custom.txt',{type:'text/plain'}),'虚构旧核对人');}finally{d.close();}},{pr:project,values:Array.from(customBytes)});
    await custom.audit();await custom.q('#ac-trial').click();await custom.idle();assert.deepEqual(await custom.get(),customRecord,'custom v2 descriptions and attachment references are not recognized or replaced as the built-in template');
    await custom.q('#ac-use-template').click();await custom.q('#ac-import-cancel').click();assert.deepEqual(await custom.get(),customRecord);assert.equal(await custom.q('#ac-import-pending').isVisible(),false);
    const formalId=await custom.p.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=20;c.getContext('2d').fillText('QA',1,10);const png=await new Promise(ok=>c.toBlob(ok,'image/png')),pair=await Promise.all(['business_license','practice_certificate'].map((kind,i)=>QuotePacket.readAttachment(new File([png],'synthetic-v37-'+i+'.png',{type:'image/png'}),kind)));const l=await QuoteLedger.open();try{const e=await l.register({firmName:'虚构正式所V37',customerName:'虚构审计单位V37',auditYear:2026,location:'河北',service:'年度财务报表审计',quoteDate:'2026-11-11',issuer:'虚构采购方',projectName:'虚构正式立项V37',projectType:'年度财务报表审计',contactName:'',contactInfo:'',subtotalCents:1000000,taxCents:0,totalCents:1000000,taxRateText:'0%'},pair);await l.appendResult(e.id,{outcome:'won',expectedEventNo:0,note:'虚构测试'});return e.id;}finally{l.close();}});
    await custom.q('[data-view=ledger]').click();await custom.q('[data-initiation-id="'+formalId+'"]').click();await custom.q('#project-init-save').click();await custom.wait('#project-init-status','立项信息已保存');
    await custom.audit();await custom.q('#ac-project').selectOption(formalId);await custom.wait('#ac-status','尚未导入');
    assert.equal(await custom.p.evaluate(async id=>{const d=await AuditChecklist.open();try{return await d.get(id);}finally{d.close();}},formalId),null);
    await custom.q('#ac-use-template').click();await custom.q('#ac-import-pending').waitFor({state:'visible'});assert.equal(await custom.p.evaluate(async id=>{const d=await AuditChecklist.open();try{return await d.get(id);}finally{d.close();}},formalId),null,'even staging a formal template cannot initialize the formal checklist');assert.deepEqual(await custom.get(),customRecord);
    await custom.q('#ac-import-cancel').click();assert.deepEqual(await custom.get(),customRecord);steps.push('custom v2 files survive default trial entry and cancelled staging; saved formal projects never auto-initialize or change trial records');await custom.ctx.close();
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
  }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors,error:String(e.stack||e)}));throw e;}
  finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
