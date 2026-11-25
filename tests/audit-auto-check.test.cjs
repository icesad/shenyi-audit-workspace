'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const A=require('../dist/audit-auto-check.js'),D=path.resolve(__dirname,'../dist');
function sheet(name,cells,endR=12,endC=10){return{name,cells:Object.fromEntries(Object.entries(cells).map(([a,v])=>[a,{v,w:v===0?'':String(v),t:typeof v==='number'?'n':'s'}])),range:{s:{r:0,c:0},e:{r:endR,c:endC}}};}
const wrap=(name,sheets,sha)=>({name,sha256:sha,model:{sheets}});
function fixtures(){
 const entity='合成甲有限公司',headers={A1:'凭证查询',J1:'金额单位:元',K1:'币种:CNY',A2:'会计期间',B2:'凭证编号',C2:'凭证日期',D2:'方向',E2:'责任中心名称',F2:'科目编号',G2:'科目名称',H2:'借方金额',I2:'贷方金额'},lc={...headers};
 for(let i=0;i<4;i++){const r=i+3,p=i<2?'2026-01':'2026-02',borrow=i%2===0;Object.assign(lc,{['A'+r]:p,['B'+r]:'V001',['C'+r]:p+'-15',['D'+r]:borrow?'借':'贷',['E'+r]:entity+'本部',['F'+r]:borrow?'100101':'200101',['G'+r]:borrow?'现金明细':'应付明细',['H'+r]:borrow?20.10:0,['I'+r]:borrow?0:20.10});}
 Object.assign(lc,{A7:'合计',H7:40.20,I7:40.20});
 const tc={A1:'科 目 余 额 表',A2:'责任中心:123  合成集团／'+entity+'本部',E2:'会计期间:2026-02',J2:'金额单位:元',K2:'币种:CNY',A3:'科目编号',B3:'科目名称',C3:'方向',D3:'上年结转',E3:'累计发生',G3:'方向',H3:'当前余额',E4:'借方',F4:'贷方'};
 for(const [r,code,name,dir,d,c]of [[5,'1001','现金','借',40.20,0],[6,'100101','  现金明细','借',40.20,0],[7,'2001','应付','贷',0,40.20],[8,'200101','  应付明细','贷',0,40.20]])Object.assign(tc,{['A'+r]:code,['B'+r]:name,['C'+r]:'平',['D'+r]:0,['E'+r]:d,['F'+r]:c,['G'+r]:dir,['H'+r]:40.20});
 Object.assign(tc,{A9:'合计',E9:40.20,F9:40.20});
 const bs=sheet('实际报表页',{A1:'资产负债表',A3:'单位:'+entity,D3:'2026年02月',H3:'金额单位:元',A4:'资产',B4:'行次',C4:'年初数',D4:'期末数',E4:'负债',F4:'行次',G4:'年初数',H4:'期末数',A5:'资产总计',C5:0,D5:40.20,E5:'负债合计',G5:0,H5:40.20,E6:'所有者权益（或股东权益）合计',G6:0,H6:0},5,7);
 const pl=sheet('实际利润页',{A1:'利润表',A3:'单位:'+entity,B3:'2026年02月',E3:'金额单位:元',A4:'项目',B4:'行次',C4:'本月数',D4:'本年累计',A5:'四、净利润（净亏损以“-”号填列）',C5:10,D5:100},4,4);
 const cf=sheet('实际现金页',{A1:'现金流量表',A2:'2026年02月',A3:'单位:'+entity,J3:'金额单位:元',F4:'项目',G4:'行次',H4:'本月实际',I4:'本年实际',F5:'净利润',H5:8.90,I5:98.90,F6:'加：期初现金及现金等价物余额',I6:10,F7:'五、现金及现金等价物净增加额',I7:30.20,F8:'六、期末现金及现金等价物余额',I8:40.20},7,9);
 return[wrap('synthetic-ledger.xls',[sheet('流水',lc,6,10)],'1'.repeat(64)),wrap('synthetic-trial.xlsx',[sheet('余额',tc,8,10)],'2'.repeat(64)),wrap('synthetic-statements.xlsx',[bs,pl,cf],'3'.repeat(64))];
}
test('BigInt source values: blanks never become zero; no floating rounding or cached display sign',()=>{
 assert.equal(A.cents(0),0n);assert.equal(A.cents(''),null);assert.equal(A.cents(null),null);assert.equal(A.cents('1,234.56'),123456n);assert.equal(A.cents(-1.07),-107n);assert.equal(A.cents(.1+.2),null);assert.equal(A.money(-107n),'-1.07');
});
test('actual headers, monthly voucher IDs, explicit direction balances and parent/leaf sums',()=>{
 const input=fixtures(),before=JSON.stringify(input),r=A.analyze(input);
 assert.equal(JSON.stringify(input),before);assert.equal(r.models[0].vouchers,2);assert.equal(r.models[1].rootCount,2);assert.equal(r.models[1].leafCount,2);
 assert.equal(r.checks.filter(c=>c.id==='ledger.voucher'&&c.status==='pass').length,2);
 assert.equal(r.checks.find(c=>c.id==='trial.declared.debit').actual,'40.20');
 assert.equal(r.checks.filter(c=>c.id==='profit.cash'&&c.status==='difference').length,2);
 assert.ok(r.checks.filter(c=>c.id==='profit.cash').every(c=>c.difference==='1.10'));
 assert.ok(r.checks.filter(c=>c.id==='profit.cash').flatMap(c=>c.refs).some(r=>r.cells.includes('I5')));
 assert.equal(r.checks.filter(c=>c.id==='statement.balance'&&c.status==='pass').length,2);assert.ok(r.checks.some(c=>c.id==='statement.trial.mapping'&&c.status==='pending'));
});
test('missing amounts, inconsistent hierarchy, unknown source and changed source all stay explicit',()=>{
 const input=fixtures();input[0].model.sheets[0].cells.H3={v:'',w:'0.00'};
 const r=A.analyze(input);assert.ok(r.checks.some(c=>c.id==='ledger.row'&&c.status==='pending'));assert.equal(r.checks.find(c=>c.id==='ledger.total').status,'pending');
 const hierarchy=fixtures();hierarchy[1].model.sheets[0].cells.B6.v='现金明细';hierarchy[1].model.sheets[0].cells.B8.v='应付明细';assert.ok(A.analyze(hierarchy).checks.some(c=>c.id==='trial.hierarchy'&&c.status==='pending'));
 const bad=fixtures();bad[1].model.sheets[0].cells.H6.v=99;assert.ok(A.analyze(bad).checks.some(c=>c.id==='trial.rollforward'&&c.status==='difference'&&c.refs[0].cells.includes('H6')));
 const unknown=A.analyze([wrap('unknown.xlsx',[sheet('Sheet1',{A1:'未知内容'})],'a'.repeat(64))]);assert.equal(unknown.summary.pass,0);assert.ok(unknown.summary.pending>0);
});
test('duplicate hashes deduplicate; ambiguous versions, entities and periods do not silently select',()=>{
 const f=fixtures(),r=A.analyze([f[0],structuredClone(f[0]),f[1]]);assert.equal(r.models.filter(m=>m.type==='ledger').length,1);assert.ok(r.checks.some(c=>c.id==='duplicate'));
 const changed=structuredClone(f[0]);changed.sha256='b'.repeat(64);assert.ok(A.analyze([f[0],changed,f[1]]).checks.some(c=>c.id==='same-name'));assert.ok(A.analyze([f[0],changed,f[1]]).checks.some(c=>c.id==='ledger.trial.scope'&&c.status==='pending'));
 const foreign=fixtures();foreign[1].model.sheets[0].cells.A2.v='责任中心:123 合成乙有限公司本部';const grouped=A.analyze(foreign);assert.equal(grouped.checks.filter(c=>c.id==='ledger.trial.debit').length,0);assert.ok(grouped.checks.some(c=>c.id==='scope.groups'));
 const dates=fixtures();dates[2].model.sheets[2].cells.B2={v:'2014年01月'};assert.ok(A.analyze(dates).checks.some(c=>c.id==='scope.dates'&&c.status==='pending'));
});
test('a batch over 24 account ledgers checks original amounts and skips brought-forward and total rows',()=>{
 const ledger=sheet('明细账',{
  A1:'年',B1:'月',C1:'日',D1:'公司代码',E1:'凭证编号',F1:'摘要',G1:'借方',I1:'贷方',K1:'方向',L1:'余额',
  G2:'数量',H2:'金额',I2:'数量',J2:'金额',L2:'数量',M2:'单价',N2:'金额',
  D3:'合成公司',F3:'上期结转',K3:'贷',N3:100,
  A4:2026,B4:1,C4:5,D4:'合成公司',E4:1,F4:'事项',H4:120,J4:0,K4:'借',N4:20,
  F5:'本期合计',H5:120,J5:0,K5:'借',N5:20,
  A6:2026,B6:2,C6:8,D6:'合成公司',E6:2,F6:'事项',H6:0,J6:20,K6:'平',N6:0,
  A7:2026,B7:2,C7:9,D7:'合成公司',E7:3,F7:'事项',H7:50,K7:'借',N7:53,
  A8:2026,B8:2,C8:10,D8:'合成公司',E8:4,F8:'事项',H8:0,J8:4,K8:'借',N8:50
 },7,13);
 const batch=Array.from({length:25},(_,i)=>wrap('明细账-'+i+'.xlsx',[ledger],String(i).padStart(64,'0')));
 const result=A.analyze(batch);
 assert.equal(result.sources.length,25);
 assert.equal(result.models.filter(m=>m.type==='accountDetail'&&m.rowCount===4&&m.consistentRows===2).length,25);
 assert.equal(result.checks.filter(c=>c.id==='detail.rollforward'&&c.status==='pending').length,25);
 assert.equal(result.checks.filter(c=>c.id==='detail.rollforward'&&c.status==='difference'&&c.refs[0].cells.includes('N8')).length,25);
});

test('same-project attachment loading, hashes, stale revisions, cancellation and automatic UI',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Playwright unavailable');}const exe=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(exe))return t.skip('Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:exe});
 try{const context=await browser.newContext(),remote=[],errors=[];context.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))remote.push(r.url());});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(pathToFileURL(path.join(D,'rule-catalog.js')).href);
 for(const name of ['workpaper-xlsx-source.js','workpaper-sheets.js','audit-checklist.js','project-workspace-store.js','audit-auto-check.js','audit-preparation.js'])await p.addScriptTag({content:fs.readFileSync(path.join(D,name),'utf8')});
 const result=await p.evaluate(async input=>{
  document.body.innerHTML='<main id="host"></main>';const A=AuditAutoCheck,C=AuditChecklist,S=ProjectWorkspaceStore,key=C.TRIAL_ID,X=new Function(WorkpaperXlsxSource+';return XLSX;')(),db=await C.openTrial(),checks=[],ok=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
  const nodes=['n1','n2','n3'].map(id=>({id,parentId:'',level:1,title:'合成账表'+id,description:''}));let material=await db.importTree({quoteId:key,projectName:'合成账表试用',firmName:'合成所'},nodes,'合成导入人');
  for(const [i,source]of input.entries()){
   const w=X.utils.book_new();for(const s of source.model.sheets){const cells={...s.cells,'!ref':'A1:'+WorkpaperSheets.ref(s.range.e.r,s.range.e.c)};X.utils.book_append_sheet(w,cells,s.name);}
   const file=new File([X.write(w,{type:'array',bookType:i?'xlsx':'biff8'})],source.name,{type:i?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.ms-excel'});material=await db.attach(key,material.revision,nodes[i].id,file,'合成上传人');
  }
  const before=material.revision,r=await A.collect(key);ok(r.models[0].rowCount===4,'actual XLS read');ok(r.checks.filter(c=>c.id==='profit.cash'&&c.status==='difference').length===2,'auto-loaded statement differences');ok((await db.get(key)).revision===before,'arithmetic never writes material state');
  const oldStore=S;globalThis.ProjectWorkspaceStore={...S,hash:async()=> '0'.repeat(64)};let hashError=false;try{await A.collect(key);}catch(e){hashError=/SHA256/.test(e.message);}globalThis.ProjectWorkspaceStore=oldStore;ok(hashError,'hash mismatch blocks parsing');
  const oldReader=WorkpaperSheets;let changed=false;globalThis.WorkpaperSheets={...oldReader,read:async(...args)=>{const result=await oldReader.read(...args);if(!changed){changed=true;const latest=await db.get(key);await db.change(key,latest.revision,{type:'item',id:'n1',status:'confirmed',evidence:'合成核对',reviewer:'合成核对人'});}return result;}};
  let stale=false;try{await A.collect(key);}catch(e){stale=/已更新/.test(e.message);}globalThis.WorkpaperSheets=oldReader;ok(stale,'source revision changes invalidate in-flight results');
  let active=true;globalThis.WorkpaperSheets={...oldReader,read:async(...args)=>{const result=await oldReader.read(...args);active=false;return result;}};let aborted=false;try{await A.collect(key,{isCurrent:()=>active});}catch(e){aborted=e.name==='AbortError';}globalThis.WorkpaperSheets=oldReader;ok(aborted,'switching project cancels old source work');
  const existing={id:key,rev:0,reconciliation:{savedMappingMarker:'KEEP'}},saves=[];globalThis.WorkpaperDirectory={rows:[]};globalThis.WorkpaperRouting={fields:()=>[],targets:()=>[]};const ui=AuditPreparation.mount(document.querySelector('#host'),{key,getRecord:()=>existing,isCurrent:()=>true,run:f=>f(),save:patch=>saves.push(patch)});
  for(let i=0;i<200&&document.querySelector('[data-audit-auto-check] [role=status]').textContent.includes('正在');i++)await new Promise(r=>setTimeout(r,25));
  const box=document.querySelector('[data-audit-auto-check]');ok(box.textContent.includes('差额 1.10')&&box.textContent.includes('I5'),'entry automatically displays issue and source cell');ok(!document.querySelector('#host > div > details').open,'manual mappings retained in folded advanced controls');ok(saves.length===0&&existing.reconciliation.savedMappingMarker==='KEEP','saved manual mapping untouched and no automatic confirmations');ok(!document.querySelector('input[type=checkbox]:checked'),'no reviewer checkbox auto-approved');
  ui.destroy();db.close();ok(!document.querySelector('[data-audit-auto-check]'),'auto monitor disposed');return checks.length;
 },fixtures());assert.ok(result>=10);assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

