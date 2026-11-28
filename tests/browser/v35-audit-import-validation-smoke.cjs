/* Synthetic audit import validation regression. No original or private checklist is used. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {buildLegacyDoc}=require('../fixtures/legacy-doc-builder.cjs');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html')),TRIAL='00000000-0000-4000-8000-000000000033';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true}),requests=[],errors=[],steps=[];
 try{
  const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
  ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/,r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));let agree=true,confirmations=0;
  p.on('dialog',d=>{confirmations++;return agree?d.accept():d.dismiss();});await p.goto(pathToFileURL(entry).href);
  const q=s=>p.locator(s),wait=(s,n)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[s,n]);
  const idle=()=>p.waitForFunction(()=>document.querySelector('#ac-import')?.disabled===false);
  const get=()=>p.evaluate(async id=>{const db=await AuditChecklist.openTrial();try{return await db.get(id);}finally{db.close();}},TRIAL);
  const pending=()=>q('#ac-import-pending'),resume=()=>q('#ac-import-continue');
  const uploadTxt=async(name,text)=>{await q('#ac-import').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});await idle();};
  await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await q('#ac-import-mode').selectOption('legacy');await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await wait('#ac-status','已进入独立试用');
  const initial=await get();assert.equal(initial.items.length,3);assert.equal(await q('#ac-reviewer').inputValue(),'');assert.equal(await q('#ac-reason').inputValue(),'');
  const text='资料清单2026\r一、虚构基础资料\r'+Array.from({length:105},(_,i)=>`${i+9}. 虚构资料${i+1}\r`).join('');
  await q('#ac-import').setInputFiles({name:'synthetic-105.doc',mimeType:'application/msword',buffer:buildLegacyDoc({pieces:[{text}]})});await idle();
  assert.equal(await pending().isVisible(),true);assert.match(await pending().textContent(),/105/);assert.match(await pending().textContent(),/synthetic-105\.doc/);
  assert.match(await q('#ac-status').textContent(),/核对人/);assert.match((await pending().textContent())+(await q('#ac-status').textContent()),/操作理由|替换理由/);
  assert.equal(await p.evaluate(()=>document.activeElement?.id),'ac-reviewer');
  assert.deepEqual(await get(),initial);assert.equal(confirmations,0,'missing mandatory fields are explained before any destructive confirmation');
  assert.equal(await q('#ac-import').inputValue(),'','parsed file is held only in the pending import, not reselected');
  steps.push('105-item legacy DOC is parsed successfully; missing reviewer/replacement reason are named, reviewer receives focus and the existing three-item trial is unchanged');

  assert.equal(await q('#ac-reviewer').getAttribute('aria-invalid'),'true');
  await q('#ac-reviewer').fill('虚构核对人');assert.equal(await q('#ac-reviewer').getAttribute('aria-invalid'),null);await resume().click();await idle();
  assert.match(await q('#ac-status').textContent(),/操作理由|替换理由/);assert.equal(await p.evaluate(()=>document.activeElement?.id),'ac-reason');assert.deepEqual(await get(),initial);assert.equal(confirmations,0);
  assert.equal(await q('#ac-reason').getAttribute('aria-invalid'),'true');
  await q('#ac-reason').fill('采用虚构105项资料清单');assert.equal(await q('#ac-reason').getAttribute('aria-invalid'),null);agree=false;await resume().click();await idle();assert.equal(confirmations,1);assert.deepEqual(await get(),initial);assert.equal(await pending().isVisible(),true);
  agree=true;await resume().click();await wait('#ac-status','已导入 105 项');await idle();
  const imported=await get();assert.equal(imported.items.length,105);assert.equal(imported.items.at(-1).number,105);assert.equal(imported.revision,initial.revision+1);
  assert.equal(imported.events.at(-1).reason,'采用虚构105项资料清单');assert.equal(imported.events.at(-1).reviewer,'虚构核对人');assert.ok(Object.values(imported.states).every(s=>s.status==='pending'));
  assert.equal(await pending().isVisible(),false);assert.equal(confirmations,2);assert.equal(await q('#ac-close').isDisabled(),true);
  steps.push('补齐后导入 revalidates each missing field, retains parsed items after cancellation and commits the same 105 items without reselecting the file');

  await q('#ac-reviewer').fill('');await q('[data-item-status=i1]').selectOption('na');await q('[data-save-item=i1]').click();await idle();
  assert.match(await q('#ac-status').textContent(),/核对人/);assert.equal(await p.evaluate(()=>document.activeElement?.id),'ac-reviewer');assert.deepEqual(await get(),imported);
  await q('#ac-reviewer').fill('虚构核对人');await q('#ac-reason').fill('');await uploadTxt('synthetic-pending.txt','一、修订资料\n88. 待导入甲\n99. 待导入乙');
  assert.equal(await pending().isVisible(),true);assert.match(await pending().textContent(),/2/);assert.deepEqual(await get(),imported);
  let concurrent=await p.evaluate(async id=>{const a=await AuditChecklist.openTrial();try{const r=await a.get(id);return await a.change(id,r.revision,{type:'item',id:'i1',status:'received',reviewer:'其他窗口虚构核对人'});}finally{a.close();}},TRIAL);
  await q('#ac-reason').fill('修订资料不能覆盖其他窗口');await resume().click();await idle();assert.match(await q('#ac-status').textContent(),/其他窗口|已更新|发生变化/);assert.deepEqual(await get(),concurrent);
  await q('#ac-refresh').click();await idle();assert.equal(await pending().isVisible(),false);assert.deepEqual(await get(),concurrent);
  steps.push('blank reviewer feedback is explicit for row saves too; a pending replacement cannot overwrite a newer revision created by another window');

  await q('#ac-reason').fill('');await uploadTxt('synthetic-locally-stale.txt','一、修订资料\n77. 不得覆盖本页刚保存的核对');assert.equal(await pending().isVisible(),true);
  await q('[data-item-status=i2]').selectOption('na');await q('#ac-item-reason-i2').fill('本页明确选择不适用以触发真实修订');await q('[data-save-item=i2]').click();await wait('#ac-status','已保存本项选择');await idle();concurrent=await get();
  const confirmationBeforeLocalConflict=confirmations;await q('#ac-reason').fill('状态变更后不得套用旧待导入文件');await resume().click();await idle();
  assert.match(await q('#ac-status').textContent(),/发生变化/);assert.equal(confirmations,confirmationBeforeLocalConflict);assert.equal(await pending().isVisible(),false);assert.deepEqual(await get(),concurrent);
  await q('#ac-reason').fill('');await uploadTxt('synthetic-cancel.txt','一、修订资料\n77. 取消后不可导入');assert.equal(await pending().isVisible(),true);
  await q('#ac-import-cancel').click();assert.equal(await pending().isVisible(),false);assert.deepEqual(await get(),concurrent);
  steps.push('same-page saved review invalidates older pending revisions before confirmation; explicit pending cancellation clears the file without changing records');


  await q('#ac-reviewer').fill('');await uploadTxt('synthetic-switched.txt','一、修订资料\n77. 不应跨项目写入');assert.equal(await pending().isVisible(),true);
  await q('#ac-project').selectOption('');assert.equal(await pending().isVisible(),false);assert.equal(await q('#ac-import').isDisabled(),true);
  await q('#ac-project').selectOption('00000000-0000-4000-8000-000000000033');await wait('#ac-status','已进入独立试用');await idle();assert.equal(await pending().isVisible(),false);assert.deepEqual(await get(),concurrent);
  const counts=await p.evaluate(async()=>{const l=await QuoteLedger.open();try{return {quotes:(await l.list()).length,projects:(await ProjectInitiation.listSaved()).length};}finally{l.close();}});
  assert.deepEqual(counts,{quotes:0,projects:0});assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  steps.push('switching context discards pending import without applying it elsewhere or creating procurement/initiation data');
  console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
 }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
 finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
