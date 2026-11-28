'use strict';
// Synthetic independent audit trial regression. No project or quote is required for the trial.
// node tests/browser/v33-audit-trial-smoke.cjs [dist/index.html or packaged offline.html]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html'));
const trialId='00000000-0000-4000-8000-000000000033',trialName='独立试用项目（不关联立项）';
const trialText='资料清单2026\n一、基础资料\n9. 执业证书\n29. 银行函证';
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  const requests=[],errors=[],steps=[];
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
    ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});
    await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto(pathToFileURL(entry).href);
    const q=s=>p.locator(s),wait=(selector,needle)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[selector,needle]);
    const audit=async()=>{await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await q('#ac-trial').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#ac-project')?.disabled);await q('#ac-import-mode').selectOption('legacy');};
    const get=id=>p.evaluate(async id=>{const a=await (id==='00000000-0000-4000-8000-000000000033'?AuditChecklist.openTrial():AuditChecklist.open());try{return await a.get(id);}finally{a.close();}},id);
    const noTrialInMain=()=>p.evaluate(async id=>{const a=await AuditChecklist.open();try{return await a.get(id);}finally{a.close();}},trialId);
    const businessCounts=()=>p.evaluate(async()=>{
      const projects=await ProjectInitiation.listSaved(),l=await QuoteLedger.open();
      try{return {projects:projects.length,quotes:(await l.list()).length};}finally{l.close();}
    });
    const importFile=(name,txt)=>q('#ac-import').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(txt)});
    const save=async(id,status,evidence='',reason='')=>{
      if(status==='received'){
        await p.evaluate(async({key,id,evidence,reason})=>{const db=await AuditChecklist.openTrial();try{const r=await db.get(key);await db.change(key,r.revision,{type:'item',id,status:'received',evidence,reason,reviewer:document.querySelector('#ac-reviewer').value});}finally{db.close();}},{key:trialId,id,evidence,reason});
        await q('#ac-refresh').click();await wait('#ac-status','已载入');assert.match(await q('[data-record-state="'+id+'"]').textContent(),/已收到/);return;
      }
      await q('[data-item-status="'+id+'"]').selectOption(status==='confirmed'?'pending':status);
      await q('#ac-evidence-'+id).fill(evidence);await q('#ac-item-reason-'+id).fill(reason);
      await q('['+(status==='confirmed'?'data-confirm-item':'data-save-item')+'="'+id+'"]').click();
      await p.waitForFunction(id=>document.querySelector('[data-save-item="'+id+'"]')?.disabled===false,id);
    };

    await audit();
    assert.deepEqual(await businessCounts(),{projects:0,quotes:0});
    assert.equal(await q('#ac-import').isDisabled(),true);
    await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await p.waitForFunction(()=>document.querySelector('#ac-import')?.disabled===false);
    assert.match(await q('#ac-project option:checked').textContent(),/独立试用.*不关联立项/u);
    assert.equal(await q('#ac-trial-note').isVisible(),true);
    assert.equal(await q('#ac-project').inputValue(),trialId);
    const initialized=await get(trialId);
    assert.equal(initialized.items.length,3,'explicit trial creates only three fictional example items');
    assert.ok(Object.values(initialized.states).every(s=>s.status==='pending'));
    assert.equal(initialized.events.length,1);assert.equal(initialized.events[0].type,'import');
    assert.equal(initialized.events[0].reviewer,'系统（独立试用初始化）');
    assert.equal(initialized.closed,null);
    assert.equal(await noTrialInMain(),null,'trial initialization never writes into main materials storage');
    await q('#ac-reviewer').fill('虚构试用核对人');
    await q('#ac-reason').fill('采用虚构的试用资料清单');
    await importFile('synthetic-trial.txt',trialText);await wait('#ac-status','已导入 2 项');
    assert.deepEqual(await q('[data-material-id] strong').allTextContents(),['1、执业证书','2、银行函证']);
    const imported=await get(trialId);
    assert.deepEqual(imported.project,{quoteId:trialId,projectName:trialName,firmName:''});
    assert.equal(imported.closed,null);assert.equal(await q('#ac-close').isDisabled(),true);
    assert.deepEqual(await businessCounts(),{projects:0,quotes:0});
    steps.push('explicit independent entry creates three fictional pending items in a separate trial database; reasoned import does not create procurement or initiation records');

    await save('i1','received');await wait('#ac-status','已载入');
    assert.equal(await q('#ac-close').isDisabled(),true);
    await save('i1','confirmed');await wait('#ac-status','证据索引');assert.equal((await get(trialId)).states.i1.status,'received');
    await save('i1','confirmed','TRIAL-WP-01');await wait('#ac-status','已保存本项核对');
    await save('i2','na');await wait('#ac-status','理由');assert.equal((await get(trialId)).states.i2.status,'pending');
    await save('i2','na','','合成试用不适用');await wait('#ac-status','已保存本项选择');
    assert.equal(await q('#ac-close').isEnabled(),true);assert.equal((await get(trialId)).closed,null);
    await q('#ac-close').click();await wait('#ac-status','已明确执行资料关门');
    assert.ok((await get(trialId)).closed);assert.equal(await q('#ac-import').isDisabled(),true);
    assert.equal(await q('[data-save-item=i1]').isDisabled(),true);
    await q('#ac-reason').fill('');await q('#ac-reopen').click();await p.waitForFunction(()=>/字段|理由/.test(document.querySelector('#ac-status')?.textContent||''));
    assert.ok((await get(trialId)).closed);
    await q('#ac-reason').fill('继续独立试用核对');await q('#ac-reopen').click();await wait('#ac-status','已重新开门');
    const trialSnapshot=await get(trialId);assert.equal(trialSnapshot.closed,null);
    assert.equal(trialSnapshot.events.at(-1).reason,'继续独立试用核对');
    const [exported]=await Promise.all([p.waitForEvent('download'),q('#ac-export').click()]);
    assert.equal(await exported.failure(),null);
    const record=JSON.parse(fs.readFileSync(await exported.path(),'utf8')).record;
    assert.deepEqual(record,trialSnapshot);
    assert.deepEqual(await businessCounts(),{projects:0,quotes:0},'reviewing a trial does not silently register a quote or project');
    assert.equal(await noTrialInMain(),null);
    steps.push('trial obeys the same evidence/exclusion gate, explicit close, frozen closed state and reasoned reopen; JSON identifies only the trial');

    await p.reload();await audit();await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await wait('#ac-status','已进入独立试用');
    assert.deepEqual(await get(trialId),trialSnapshot);
    assert.equal(await q('[data-item-status=i1]').inputValue(),'pending');assert.match(await q('[data-record-state=i1]').textContent(),/核对通过/);
    assert.equal(await q('#ac-evidence-i1').inputValue(),'TRIAL-WP-01');
    assert.match(await q('#ac-project option:checked').textContent(),/独立试用.*不关联立项/u);
    assert.equal(await q('#ac-trial-note').isVisible(),true);
    await q('#ac-refresh').click();await p.waitForFunction(()=>document.querySelector('#ac-project')?.disabled===false);
    assert.equal(await q('#ac-project').inputValue(),trialId,'refresh keeps the explicit trial context');
    assert.deepEqual(await get(trialId),trialSnapshot);
    assert.deepEqual(await businessCounts(),{projects:0,quotes:0});
    assert.equal(await noTrialInMain(),null);
    steps.push('reload and refresh recover only the prior trial through the explicit independent-entry button');

    const projectId=await p.evaluate(async()=>{
      const c=document.createElement('canvas');c.width=c.height=20;c.getContext('2d').fillText('QA',1,10);
      const png=await new Promise(ok=>c.toBlob(ok,'image/png')),pair=await Promise.all(['business_license','practice_certificate'].map((kind,i)=>QuotePacket.readAttachment(new File([png],'synthetic-'+i+'.png',{type:'image/png'}),kind)));
      const l=await QuoteLedger.open();
      try{
        const e=await l.register({firmName:'虚构正式所',customerName:'虚构审计单位',auditYear:2026,location:'河北',service:'年度财务报表审计',
          quoteDate:'2026-11-11',issuer:'虚构采购方',projectName:'虚构正式立项',projectType:'年度财务报表审计',contactName:'',contactInfo:'',
          subtotalCents:1000000,taxCents:0,totalCents:1000000,taxRateText:'0%'},pair);
        await l.appendResult(e.id,{outcome:'won',expectedEventNo:0,note:'虚构测试'});return e.id;
      }finally{l.close();}
    });
    await q('[data-view=ledger]').click();await q('[data-initiation-id="'+projectId+'"]').click();
    await q('#project-init-save').click();await wait('#project-init-status','立项信息已保存');
    await audit();await q('#ac-project').selectOption(projectId);await wait('#ac-status','尚未导入');
    assert.equal(await q('#ac-trial-note').isVisible(),false,'formal-project screen cannot be mislabeled as trial');
    assert.equal(await get(projectId),null);
    await q('#ac-reviewer').fill('虚构正式核对人');await importFile('synthetic-real.txt','二、正式项目资料\n88. 只属于正式项目');
    await wait('#ac-status','已导入 1 项');
    const real=await get(projectId);assert.equal(real.items[0].text,'只属于正式项目');assert.equal(real.project.quoteId,projectId);
    assert.deepEqual(await get(trialId),trialSnapshot);
    await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await wait('#ac-status','已进入独立试用');
    assert.equal(await q('#ac-trial-note').isVisible(),true);
    assert.deepEqual(await get(trialId),trialSnapshot);
    assert.deepEqual(await q('[data-material-id] strong').allTextContents(),['1、执业证书','2、银行函证']);
    assert.deepEqual(await get(projectId),real);
    assert.deepEqual(await businessCounts(),{projects:1,quotes:1});
    assert.equal(await noTrialInMain(),null);
    steps.push('a saved real project and the reserved trial keep physically separate items, states and events while switching contexts');
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
  }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
  finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
