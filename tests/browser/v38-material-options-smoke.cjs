/* Two user choices do not collapse the five persisted audit states. Synthetic records only. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html')),TRIAL='00000000-0000-4000-8000-000000000033';
const pr={quoteId:TRIAL,projectName:'独立试用项目（不关联立项）',firmName:''};
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true}),requests=[],errors=[],steps=[];
 try{
  async function setup(schema){
   const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1400,height:1000}});ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/,r=>r.abort());
   const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(pathToFileURL(entry).href);
   const snapshot=await p.evaluate(async({schema,pr})=>{
    const db=await AuditChecklist.openTrial();try{
     const states=['pending','received','confirmed','na','problem'];let r;
     if(schema===2){const nodes=[{id:'n1',parentId:'',level:1,title:'虚构状态兼容目录',description:'',kind:'group'},...states.map((s,i)=>({id:'n'+(i+2),parentId:'n1',level:2,title:'虚构资料-'+s,description:'仅测试状态，不是真实资料',kind:'material'}))];r=await db.importTree(pr,nodes,'旧导入人');}
     else r=await db.create(pr,AuditChecklist.parse(states.map((s,i)=>(i+1)+'. 虚构旧资料-'+s).join('\n')),'旧导入人');
     for(let i=1;i<states.length;i++){
      const id=schema===2?'n'+(i+2):'i'+(i+1),status=states[i];
      if(schema===2&&['received','confirmed'].includes(status))r=await db.attach(pr.quoteId,r.revision,id,new File(['SYNTHETIC_KEEP_'+status],status+'.txt',{type:'text/plain'}),'旧上传人');
      if(status==='received'&&schema===2)continue;
      r=await db.change(pr.quoteId,r.revision,{type:'item',id,status,evidence:status==='confirmed'?'ORIGINAL_CONFIRMED_EVIDENCE':status==='received'?'ORIGINAL_RECEIVED_EVIDENCE':'',reason:status==='na'?'ORIGINAL_NA_REASON':status==='problem'?'ORIGINAL_PROBLEM_REASON':'',reviewer:'旧核对人'});
     }return r;
    }finally{db.close();}
   },{schema,pr});
   const q=s=>p.locator(s),wait=(s,n)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[s,n]),idle=()=>p.waitForFunction(()=>document.querySelector('#ac-project')?.disabled===false);
   const get=()=>p.evaluate(async id=>{const d=await AuditChecklist.openTrial();try{return await d.get(id);}finally{d.close();}},TRIAL);
   const enter=async()=>{await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await wait('#ac-status','已进入独立试用');await idle();};await enter();
   const click=async selector=>{await q(selector).click();await idle();},save=id=>click('[data-save-item='+id+']'),confirm=id=>click('[data-confirm-item='+id+']');
   return {ctx,p,q,get,wait,idle,enter,click,save,confirm,snapshot};
  }
  async function optionsAndPreserved(t,schema){
   const {q,get,p,snapshot}=t;assert.deepEqual(await get(),snapshot);
   const ids=schema===2?['n2','n3','n4','n5','n6']:['i1','i2','i3','i4','i5'],statuses=['pending','received','confirmed','na','problem'],badges=[/待提供/,/已收到/,/核对通过/,/不适用/,/存在问题/];
   assert.equal(await q('[data-item-status]').count(),5);
   for(let i=0;i<ids.length;i++){
    const id=ids[i];assert.deepEqual(await q('[data-item-status='+id+'] option').evaluateAll(xs=>xs.map(x=>[x.value,x.textContent])),[['pending','待提供'],['na','不适用']]);assert.equal(await q('[data-item-status='+id+']').inputValue(),statuses[i]==='na'?'na':'pending');assert.match(await q('[data-record-state='+id+']').textContent(),badges[i]);
   }
   await q('#ac-reviewer').fill('不同人员不应覆盖旧留痕');
   for(const id of [ids[1],ids[2],ids[4]]){await t.save(id);await t.wait('#ac-status','选择与记录未改变');assert.deepEqual(await get(),snapshot,'unchanged visible choice cannot rewrite '+snapshot.states[id].status+' or its actor/time');}
   await q('#ac-refresh').click();await t.idle();assert.deepEqual(await get(),snapshot);
   return ids;
  }
  const t=await setup(2),{p,q,get,wait,idle,save,confirm}=t;await optionsAndPreserved(t,2);
  await p.reload();await t.enter();assert.deepEqual(await get(),t.snapshot);assert.equal(await q('[data-item-status=n4]').inputValue(),'pending');assert.match(await q('[data-record-state=n4]').textContent(),/核对通过/);assert.equal(await q('#ac-close').isDisabled(),true);
  steps.push('schema2 renders exactly two choices while real badges retain pending/received/confirmed/NA/problem; render, reload, refresh and unchanged saves never rewrite five-state history, revision or actor');

  await q('#ac-reviewer').fill('');await q('[data-item-status=n2]').selectOption('na');assert.equal(await q('[data-confirm-item=n2]').isDisabled(),true);await save('n2');await wait('#ac-status','核对人');assert.deepEqual(await get(),t.snapshot);
  await q('#ac-reviewer').fill('虚构新核对人');await save('n2');await wait('#ac-status','理由');assert.deepEqual(await get(),t.snapshot);await q('#ac-item-reason-n2').fill('虚构本项不适用');await save('n2');await wait('#ac-status','已保存本项选择');let r=await get();assert.equal(r.states.n2.status,'na');assert.equal(await q('[data-confirm-item=n2]').isDisabled(),true);
  await q('[data-item-status=n2]').selectOption('pending');assert.equal(await q('[data-confirm-item=n2]').isDisabled(),true,'NA must first be explicitly restored, not merely changed in an unsaved dropdown');const naBefore=await get();assert.equal(naBefore.states.n2.status,'na');await save('n2');r=await get();assert.equal(r.states.n2.status,'pending');assert.equal(await q('[data-confirm-item=n2]').isEnabled(),true);
  await q('#ac-evidence-n2').fill('');await confirm('n2');await wait('#ac-status','证据索引');assert.equal((await get()).states.n2.status,'pending');await q('#ac-evidence-n2').fill('EXTERNAL-WP-2');await confirm('n2');await wait('#ac-status','已保存本项核对');assert.equal((await get()).states.n2.status,'confirmed');
  await q('#ac-item-reason-n2').fill('更改核对说明必须使旧确认失效');await save('n2');r=await get();assert.equal(r.states.n2.status,'pending','edited confirmed record without a file returns to pending');assert.equal(r.states.n2.evidence,'EXTERNAL-WP-2');await confirm('n2');assert.equal((await get()).states.n2.status,'confirmed');
  const [chooser]=await Promise.all([p.waitForEvent('filechooser'),q('[data-upload-node=n2]').click()]);await chooser.setFiles({name:'new-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('SYNTHETIC_NEW_RECEIPT')});await idle();r=await get();assert.equal(r.states.n2.status,'received');assert.match(await q('[data-record-state=n2]').textContent(),/已收到/);assert.equal(await q('[data-item-status=n2]').inputValue(),'pending');const receiptSnapshot=await get();await save('n2');await wait('#ac-status','选择与记录未改变');assert.deepEqual(await get(),receiptSnapshot);
  const n3file=r.attachments.n3[0].id;await q('[data-item-status=n3]').selectOption('na');await q('#ac-item-reason-n3').fill('先不适用以测试有资料的恢复');await save('n3');assert.equal((await get()).states.n3.status,'na');await q('[data-item-status=n3]').selectOption('pending');assert.equal(await q('[data-confirm-item=n3]').isDisabled(),true);await save('n3');r=await get();assert.equal(r.states.n3.status,'received','restoring a material with existing files retains received semantics');assert.equal(r.attachments.n3[0].id,n3file);await confirm('n3');assert.equal((await get()).states.n3.status,'confirmed');
  steps.push('NA requires actor and reason, unsaved NA/restoration cannot confirm, explicit confirmation still requires evidence; editing no-file confirmation invalidates it and uploading remains received; restoring NA with files is received, not an artificial empty receipt');

  await q('#ac-evidence-n4').fill('UPDATED_CONFIRMED_EVIDENCE');await save('n4');r=await get();assert.equal(r.states.n4.status,'received');assert.equal(r.states.n4.evidence,'UPDATED_CONFIRMED_EVIDENCE');assert.equal(r.attachments.n4.length,1);await confirm('n4');assert.equal((await get()).states.n4.status,'confirmed');await q('#ac-item-reason-n4').fill('更新说明再次使确认失效');await save('n4');assert.equal((await get()).states.n4.status,'received');await confirm('n4');assert.equal((await get()).states.n4.status,'confirmed');
  assert.equal((await get()).states.n6.status,'problem');assert.match(await q('[data-record-state=n6]').textContent(),/存在问题/);assert.equal(await q('#ac-close').isDisabled(),true,'project gate still sees real received/problem states, not two-option projections');
  await q('#ac-evidence-n6').fill('RESOLVED-PROBLEM-WP');await confirm('n6');assert.equal((await get()).states.n6.status,'confirmed');await confirm('n2');r=await get();assert.equal(AvoidAutoClose(r),true);assert.equal(await q('#ac-close').isEnabled(),true);
  await q('#ac-close').click();await wait('#ac-status','已明确执行资料关门');r=await get();assert.ok(r.closed);for(const attr of ['data-item-status','data-save-item','data-confirm-item'])for(const e of await q('['+attr+']').all())assert.equal(await e.isDisabled(),true);
  const file=r.attachments.n4[0];assert.equal(await q('[data-material-download="'+file.id+'"]').isEnabled(),true);const [d]=await Promise.all([p.waitForEvent('download'),q('[data-material-download="'+file.id+'"]').click()]);assert.equal(await d.failure(),null);assert.equal(fs.readFileSync(await d.path(),'utf8'),'SYNTHETIC_KEEP_confirmed');
  steps.push('edits to file-backed confirmation demote to received; unresolved received/problem still block the unchanged global gate; explicit close locks both choice and confirmation actions while downloads preserve original evidence');await t.ctx.close();

  const legacy=await setup(1);await optionsAndPreserved(legacy,1);assert.equal((await legacy.get()).schema,1);assert.equal((await legacy.get()).states.i3.evidence,'ORIGINAL_CONFIRMED_EVIDENCE');await legacy.q('#ac-reviewer').fill('虚构旧记录新核对人');await legacy.q('#ac-evidence-i3').fill('EDITED_LEGACY_PROOF');await legacy.save('i3');let old=await legacy.get();assert.equal(old.schema,1);assert.equal(old.states.i3.status,'pending');assert.equal(old.states.i3.evidence,'EDITED_LEGACY_PROOF');assert.equal(old.events.at(-1).before.status,'confirmed');await legacy.confirm('i3');old=await legacy.get();assert.equal(old.states.i3.status,'confirmed');assert.equal(old.states.i3.evidence,'EDITED_LEGACY_PROOF');assert.equal(old.states.i2.status,'received');assert.equal(old.states.i5.status,'problem');assert.equal(await legacy.q('#ac-close').isDisabled(),true);
  const counts=await legacy.p.evaluate(async id=>{const l=await QuoteLedger.open(),m=await AuditChecklist.open();try{return {quotes:(await l.list()).length,projects:(await ProjectInitiation.listSaved()).length,main:await m.get(id)};}finally{l.close();m.close();}},TRIAL);assert.deepEqual(counts,{quotes:0,projects:0,main:null});await legacy.ctx.close();
  steps.push('schema1 receives the same safe projection/no-op behavior without migration; old evidence, received/problem states and exact before/after audit remain intact, and edited confirmation needs a fresh explicit confirmation');
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
 }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
 finally{await browser.close();}
}
function AvoidAutoClose(r){return r.closed===null&&Object.values(r.states).every(s=>['confirmed','na'].includes(s.status));}
main().catch(e=>{console.error(e);process.exitCode=1;});
