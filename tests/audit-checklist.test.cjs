'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const A=require('../dist/audit-checklist.js');
const ids=['4a502e25-69a2-4ff6-b37f-d06a1598eb12','c462f459-ded1-4615-8785-fde6daf79058'];
const project=(id=ids[0])=>({quoteId:id,projectName:'虚构审计项目',firmName:'虚构事务所'});
const importText='\ufeff审计资料上传\r\n一、基础资料\r\n9. 营业执照\r\n14. 财务报表\r\n二、专项资料\r\n003、合同清单';
const create=()=>A.create(project(),A.parse(importText),'虚构导入人');
const update=(r,id,status,fields={})=>A.apply(r,{type:'item',id,status,evidence:'',reason:'',reviewer:'虚构核对人',...fields});

test('line import retains sections, renumbers only material items, and does not merge duplicates',()=>{
  const xs=A.parse(importText);
  assert.deepEqual(xs,[
    {id:'i1',number:1,section:'一、基础资料',text:'营业执照'},
    {id:'i2',number:2,section:'一、基础资料',text:'财务报表'},
    {id:'i3',number:3,section:'二、专项资料',text:'合同清单'}
  ]);
  assert.deepEqual(A.parse('资料清单2026\n1. 同名资料\n5. 同名资料').map(x=>[x.number,x.text]),[[1,'同名资料'],[2,'同名资料']]);
  assert.throws(()=>A.parse('资料清单\n一、基础资料'),/没有识别/);
  assert.throws(()=>A.parse('1.\n2. 正文'),/空行/);
  assert.throws(()=>A.parse('x'.repeat(2001)),/过长/);
  assert.throws(()=>A.parse(Array(501).fill('合成资料').join('\n')),/500/);
  assert.equal(A.parse(Array(500).fill('合成资料').join('\n')).at(-1).number,500);
  assert.equal(A.parse('2025 年度财务报表')[0].text,'2025 年度财务报表','a four-digit year is data, not an old serial prefix');
  assert.deepEqual(A.parse('一、基础资料\n① 资料甲\n②资料乙（正文①保留）').map(x=>[x.number,x.text]),[[1,'资料甲'],[2,'资料乙（正文①保留）']]);
  assert.throws(()=>A.parse('资料\u0000项'),/字符/);
});

test('new project checklist is pending, explicitly imported, and independent from caller-owned data',()=>{
  const xs=A.parse(importText),p=project(),r=A.create(p,xs,'虚构导入人');
  xs[0].text='不得改变保存值';p.projectName='不得改变项目名';
  assert.equal(r.schema,1);assert.equal(r.revision,1);assert.equal(r.closed,null);
  assert.equal(r.items[0].text,'营业执照');assert.equal(r.events[0].items[0].text,'营业执照');
  assert.equal(r.project.projectName,'虚构审计项目');
  assert.deepEqual(A.gate(r),{ready:false,total:3,confirmed:0,excluded:0,blockers:[1,2,3],closed:false});
  assert.equal(r.events[0].type,'import');
  assert.throws(()=>A.create(project(),[],''),/结构|字段/);
  assert.throws(()=>A.create({...project(),quoteId:'not-project'},A.parse('一份资料'),'核对人'),/立项/);
});

test('receipt and unresolved problems cannot open the close gate; evidence and exclusion reasons are mandatory',()=>{
  const r=create(),before=JSON.stringify(r);
  const received=update(r,'i1','received');
  const problem=update(received,'i2','problem',{reason:'待补明细'});
  assert.deepEqual(A.gate(problem).blockers,[1,2,3]);
  for(const status of ['confirmed','na'])assert.throws(()=>update(r,'i1',status),status==='confirmed'?/证据索引/:/理由/);
  assert.throws(()=>update(r,'i1','problem'),/待解决/);
  assert.throws(()=>update(r,'i1','confirmed',{evidence:'WP-01',reviewer:''}),/字段|核对人/);
  assert.throws(()=>update(r,'i1','na',{reason:'本项目不适用',reviewer:''}),/字段|核对人/);
  const confirmed=update(problem,'i1','confirmed',{evidence:'WP-01'});
  const excluded=update(confirmed,'i2','na',{reason:'本项目无此业务'});
  assert.deepEqual(A.gate(excluded),{ready:false,total:3,confirmed:1,excluded:1,blockers:[3],closed:false});
  assert.throws(()=>A.apply(excluded,{type:'close',reviewer:'虚构复核人'}),/不能关门/);
  assert.equal(JSON.stringify(r),before,'failed or successful transitions never mutate their input snapshot');
});

test('meeting the gate does not automatically close; close/reopen are explicit, audited operations',()=>{
  let r=create();
  r=update(r,'i1','confirmed',{evidence:'WP-01'});r=update(r,'i2','na',{reason:'本项目不适用'});
  r=update(r,'i3','confirmed',{evidence:'WP-03'});
  assert.equal(A.gate(r).ready,true);assert.equal(r.closed,null);
  const open=JSON.stringify(r),closed=A.apply(r,{type:'close',reviewer:'虚构复核人'});
  assert.ok(closed.closed);assert.equal(closed.closed.revision,closed.revision);
  assert.equal(closed.revision,r.revision+1);assert.equal(closed.events.at(-1).type,'close');
  assert.equal(JSON.stringify(r),open);
  for(const cmd of [
    {type:'item',id:'i1',status:'pending'},
    {type:'replace',items:A.parse('替换资料'),reason:'替换'},
    {type:'close'}
  ])assert.throws(()=>A.apply(closed,{...cmd,reviewer:'虚构复核人'}),/已关门/);
  assert.throws(()=>A.apply(closed,{type:'reopen',reason:' ',reviewer:'虚构复核人'}),/字段|理由/);
  const reopened=A.apply(closed,{type:'reopen',reason:'收到更新资料，须重新核对',reviewer:'虚构复核人'});
  assert.equal(reopened.closed,null);assert.equal(reopened.revision,closed.revision+1);
  assert.deepEqual(reopened.events.at(-1).priorClose,closed.closed);
  assert.equal(reopened.events.at(-1).reason,'收到更新资料，须重新核对');
  assert.throws(()=>A.apply(reopened,{type:'reopen',reason:'再次',reviewer:'虚构复核人'}),/尚未关门/);
  assert.equal(update(reopened,'i1','pending').states.i1.status,'pending');
});

test('corrected replacement requires a reason, resets all statuses and keeps prior items/states in history',()=>{
  const old=update(create(),'i1','confirmed',{evidence:'WP-01'}),items=A.parse('四、修订资料\n88. 替换甲\n90. 替换乙');
  assert.throws(()=>A.apply(old,{type:'replace',items,reviewer:'虚构导入人',reason:''}),/字段|理由/);
  const next=A.apply(old,{type:'replace',items,reviewer:'虚构导入人',reason:'采用核对后的修订清单'});
  items[0].text='不得影响历史';
  assert.deepEqual(next.items.map(x=>[x.number,x.section,x.text]),[[1,'四、修订资料','替换甲'],[2,'四、修订资料','替换乙']]);
  assert.deepEqual(A.gate(next).blockers,[1,2]);
  assert.deepEqual(next.events.at(-1).oldItems,old.items);
  assert.deepEqual(next.events.at(-1).oldStates,old.states);
  assert.equal(next.events.at(-1).items[0].text,'替换甲');
  assert.equal(old.items.length,3);assert.equal(old.states.i1.status,'confirmed');
});

test('unsupported states, bad item ids and mismatched saved-state shape cannot be trusted',()=>{
  const r=create();
  assert.throws(()=>update(r,'i1','approved'),/状态/);
  assert.throws(()=>update(r,'i99','pending'),/不存在/);
  assert.throws(()=>A.apply(r,{type:'unknown',reviewer:'虚构人员'}),/操作类型/);
  for(const change of [
    r=>r.schema=2,r=>r.revision=0,r=>delete r.states.i1,
    r=>r.items[1].number=99,r=>r.items[1].id='i1',
    r=>r.states.i2.status='approved',r=>r.project.quoteId='unrelated',
    r=>r.states.i1={...r.states.i1,status:'confirmed'}
  ]){
    const bad=structuredClone(r);change(bad);assert.throws(()=>A.validate(bad));
  }
});

test('malformed UUIDs, timestamps, event shapes and forged closed/current snapshots fail closed',()=>{
  for(const quoteId of ['-'.repeat(36),'0'.repeat(36),'4a502e25-69a2-1ff6-b37f-d06a1598eb12','4a502e25-69a2-4ff6-737f-d06a1598eb12'])
    assert.throws(()=>A.create({...project(),quoteId},A.parse('资料'),'核对人'),/立项/);
  let completed=create();
  for(const item of completed.items)completed=update(completed,item.id,'confirmed',{evidence:'WP-'+item.number});
  const closed=A.apply(completed,{type:'close',reviewer:'虚构复核人'});
  const invalids=[
    r=>r.events[0].at='2026-02-30T00:00:00.000Z',
    r=>r.events[0].at='2026-11-11',
    r=>r.events[0].type='unrecognized',
    r=>r.events[0].extra='unknown',
    r=>r.events[0].reviewer='',
    r=>r.events.push({...r.events[0]}),
    r=>r.states.i1.evidence='被篡改但未留痕',
    r=>r.events[1].before.status='received',
    r=>r.events[1].after.at='garbage',
    r=>r.events[1].reviewer='伪造不同核对人',
    r=>r.closed.at='not-a-date',
    r=>r.closed.reviewer='',
    r=>r.closed.revision--,
    r=>r.states.i2.status='pending',
    r=>r.events[r.events.length-1].revision--,
    r=>r.project.extra='unexpected',
  ];
  for(const change of invalids){const r=structuredClone(closed);change(r);assert.throws(()=>A.validate(r));}
  const mutable=update(create(),'i1','received');
  mutable.states.i1.at='';assert.throws(()=>A.validate(mutable),/时间/);
  assert.equal(A.validate(closed),closed,'valid history remains readable, not silently normalized or rewritten');
});

test('reserved independent trial identity uses exactly the same review and close invariants',()=>{
  const trial={quoteId:'00000000-0000-4000-8000-000000000033',projectName:'独立试用项目（不关联立项）',firmName:''};
  const r=A.create(trial,A.parse('一、合成试用资料\n9. 资料甲\n27. 资料乙'),'试用核对人');
  assert.equal(r.project.firmName,'');assert.deepEqual(A.gate(r).blockers,[1,2]);
  assert.throws(()=>update(r,'i1','confirmed'),/证据索引/);
  assert.throws(()=>A.apply(r,{type:'close',reviewer:'试用核对人'}),/不能关门/);
  const confirmed=update(r,'i1','confirmed',{evidence:'TRIAL-WP-01'});
  const done=update(confirmed,'i2','na',{reason:'合成试用不适用'});
  assert.equal(done.closed,null,'trial does not auto-close either');
  const closed=A.apply(done,{type:'close',reviewer:'试用核对人'});
  assert.equal(closed.project.quoteId,trial.quoteId);
  assert.throws(()=>update(closed,'i1','received'),/已关门/);
  const opened=A.apply(closed,{type:'reopen',reason:'继续合成试用核对',reviewer:'试用核对人'});
  assert.equal(opened.closed,null);assert.equal(opened.events.at(-1).reason,'继续合成试用核对');
  assert.equal(create().project.quoteId,ids[0],'trial never modifies real project constructor or identity');
});

test('real IndexedDB isolates by saved-project quoteId and uses atomic compare-and-swap revisions',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('existing Playwright unavailable');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executable))return t.skip('existing Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage(),errors=[],requests=[];
    p.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});
    await p.goto(pathToFileURL(path.join(__dirname,'../dist/rule-catalog.js')).href);
    await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../dist/audit-checklist.js'),'utf8')});
    const result=await p.evaluate(async({ids,importText})=>{
      const A=AuditChecklist,a=await A.open(),b=await A.open(),project=id=>({quoteId:id,projectName:'同名虚构项目',firmName:'虚构所'});
      const error=async work=>{try{await work;return '';}catch(e){return e.message;}};
      try{
        const x=await a.create(project(ids[0]),A.parse(importText),'虚构导入人'),y=await b.create(project(ids[1]),A.parse('独立项目资料'),'虚构导入人');
        const duplicate=await error(a.create(project(ids[0]),A.parse('不得覆盖'),'虚构导入人'));
        const races=await Promise.allSettled([
          a.change(ids[0],1,{type:'item',id:'i1',status:'received',reviewer:'甲'}),
          b.change(ids[0],1,{type:'item',id:'i1',status:'na',reason:'本项目不适用',reviewer:'乙'})
        ]);
        const current=await a.get(ids[0]),before=JSON.stringify(current);
        const blockedClose=await error(a.change(ids[0],current.revision,{type:'close',reviewer:'复核人'}));
        const unchanged=JSON.stringify(await b.get(ids[0]))===before,other=await b.get(ids[1]);
        current.items[0].text='调用方改变的副本';
        const afterRead=await a.get(ids[0]);
        return {duplicate,races:races.map(x=>({status:x.status,error:x.reason?.message||''})),revision:afterRead.revision,
          blockedClose,unchanged,otherUnchanged:JSON.stringify(other)===JSON.stringify(y),copied:afterRead.items[0].text!=='调用方改变的副本',
          xId:x.project.quoteId,yId:y.project.quoteId};
      }finally{a.close();b.close();}
    },{ids,importText});
    assert.match(result.duplicate,/其他窗口|未覆盖/);
    assert.equal(result.races.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(result.races.filter(x=>/其他窗口/.test(x.error)).length,1);
    assert.equal(result.revision,2);assert.match(result.blockedClose,/不能关门/);
    assert.equal(result.unchanged,true);assert.equal(result.otherUnchanged,true);assert.equal(result.copied,true);
    assert.notEqual(result.xId,result.yId);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});

test('corrupt stored audit history is neither read nor overwritten and its raw bytes remain available',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('existing Playwright unavailable');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executable))return t.skip('existing Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const ctx=await browser.newContext({serviceWorkers:'block'}),page=await ctx.newPage();
    await page.goto(pathToFileURL(path.join(__dirname,'../dist/rule-catalog.js')).href);
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../dist/audit-checklist.js'),'utf8')});
    const result=await page.evaluate(async({id})=>{
      const p={quoteId:id,projectName:'虚构项目',firmName:'虚构事务所'},api=await AuditChecklist.open();
      const original=await api.create(p,AuditChecklist.parse('测试资料'),'虚构导入人');
      const db=await new Promise((ok,no)=>{const q=indexedDB.open('hengdu.audit.materials.v1');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
      const read=()=>new Promise((ok,no)=>{const q=db.transaction('checklists').objectStore('checklists').get(id);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
      const write=value=>new Promise((ok,no)=>{const tx=db.transaction('checklists','readwrite');tx.objectStore('checklists').put(value);tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});
      const denied=async pending=>{try{await pending;return false;}catch{return true;}};
      try{
        const raw=await read();raw.record.events[0].type='unrecognized';await write(raw);
        const before=JSON.stringify(await read()),getDenied=await denied(api.get(id));
        const changeDenied=await denied(api.change(id,original.revision,{type:'item',id:'i1',status:'received',reviewer:'不得覆盖'}));
        return {getDenied,changeDenied,unchanged:before===JSON.stringify(await read())};
      }finally{db.close();api.close();}
    },{id:ids[0]});
    assert.deepEqual(result,{getDenied:true,changeDenied:true,unchanged:true});
  }finally{await browser.close();}
});

test('independent trial has a physically separate IndexedDB and cannot address real project identities',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('existing Playwright unavailable');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executable))return t.skip('existing Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const ctx=await browser.newContext({serviceWorkers:'block'}),page=await ctx.newPage();
    await page.goto(pathToFileURL(path.join(__dirname,'../dist/rule-catalog.js')).href);
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../dist/audit-checklist.js'),'utf8')});
    const result=await page.evaluate(async realId=>{
      const A=AuditChecklist,trialId='00000000-0000-4000-8000-000000000033',main=await A.open(),trial=await A.openTrial();
      const real={quoteId:realId,projectName:'虚构正式项目',firmName:'虚构事务所'},fake={quoteId:trialId,projectName:'独立试用项目（不关联立项）',firmName:''};
      const denied=async p=>{try{await p;return false;}catch{return true;}};
      async function rows(name){
        const db=await new Promise((ok,no)=>{const q=indexedDB.open(name);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
        try{return await new Promise((ok,no)=>{const q=db.transaction('checklists').objectStore('checklists').getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});}
        finally{db.close();}
      }
      try{
        const r=await main.create(real,A.parse('一、正式资料\n正式项目专有资料'),'虚构正式人员');
        const mainCreateDenied=await denied(main.create(fake,A.parse('不得混入正式库'),'虚构试用人员'));
        const mainChangeDenied=await denied(main.change(trialId,0,{type:'close',reviewer:'不得混入正式库'}));
        const s=await trial.create(fake,A.parse('一、试用资料\n试用专有资料'),'虚构试用人员');
        const getDenied=await denied(trial.get(realId)),createDenied=await denied(trial.create(real,A.parse('不得写入'),'虚构试用人员'));
        const changeDenied=await denied(trial.change(realId,r.revision,{type:'item',id:'i1',status:'received',reviewer:'不得修改'}));
        const updated=await trial.change(trialId,s.revision,{type:'item',id:'i1',status:'confirmed',evidence:'TRIAL-01',reviewer:'虚构试用人员'});
        const closed=await trial.change(trialId,updated.revision,{type:'close',reviewer:'虚构试用人员'});
        const mainRows=await rows('hengdu.audit.materials.v1'),trialRows=await rows('hengdu.audit.materials.trial.v1');
        return {getDenied,createDenied,changeDenied,mainCreateDenied,mainChangeDenied,mainUnchanged:JSON.stringify(await main.get(realId))===JSON.stringify(r),
          noMainTrial:await main.get(trialId)===null,mainIds:mainRows.map(x=>x.quoteId),trialIds:trialRows.map(x=>x.quoteId),
          trialClosed:!!closed.closed,trialRevision:closed.revision};
      }finally{main.close();trial.close();}
    },ids[0]);
    assert.deepEqual(result,{getDenied:true,createDenied:true,changeDenied:true,mainCreateDenied:true,mainChangeDenied:true,mainUnchanged:true,noMainTrial:true,
      mainIds:[ids[0]],trialIds:['00000000-0000-4000-8000-000000000033'],trialClosed:true,trialRevision:3});
  }finally{await browser.close();}
});
