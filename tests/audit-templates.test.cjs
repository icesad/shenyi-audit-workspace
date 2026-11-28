'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const T=require('../dist/audit-templates.js'),SHA='a'.repeat(64),OTHER='b'.repeat(64),P='11111111-1111-4111-8111-111111111111',known={name:'已知原包.zip',sha256:SHA,files:1},routing={identifyArchive:s=>s===SHA?known:null,archives:()=>[known]};
function row(i=0,size=10){return {schema:1,sha256:i.toString(16).padStart(64,'0'),name:'合成模板'+i+'.pdf',size,type:'application/pdf',createdAt:'2026-11-12T00:00:00.000Z',blob:{size,arrayBuffer:async()=>new ArrayBuffer(size)}};}
test('template file allowlist and immutable safety limits reject bad names, paths, controls, unsupported formats and oversize/empty input',()=>{assert.deepEqual(T.limits,{maxFileBytes:1_000_000_000,maxRecords:200});for(const name of ['原件.zip','原件.XLS','原件.xlsx','原件.doc','原件.docx','原件.pdf'])assert.doesNotThrow(()=>T.validateFile(new File(['synthetic'],name)));for(const name of ['../x.pdf','/x.pdf','a\\x.pdf','CON.pdf','x.pdf ','a.exe','x\u0000.pdf','\ud800.pdf','a\u202e.pdf','a:b.pdf'])assert.throws(()=>T.validateFile({name,size:1,arrayBuffer(){}}));assert.doesNotThrow(()=>T.validateFile({name:'a.zip',size:999_999_999,arrayBuffer(){}}));for(const size of [0,-1,NaN,1_000_000_000,1_000_000_001])assert.throws(()=>T.validateFile({name:'a.pdf',size,arrayBuffer(){}}));});
test('stored metadata validation and inventory reject malformed identity, inconsistent bytes, the record cap and duplicate hash',()=>{assert.doesNotThrow(()=>T.validateRecord(row()));for(const patch of [{schema:2},{sha256:'X'.repeat(64)},{blob:null},{blob:{size:11,arrayBuffer(){}}},{createdAt:'notdate'},{type:'text/\0bad'}])assert.throws(()=>T.validateRecord({...row(),...patch}));assert.deepEqual(T.inventory([row(0),row(1)]),{count:2,total:20});assert.throws(()=>T.inventory([row(0),row(0)]));assert.throws(()=>T.inventory(Array.from({length:201},(_,i)=>row(i))));assert.deepEqual(T.inventory([row(1,999_999_999),row(2,99_000_000)]),{count:2,total:1_098_999_999});assert.equal(Object.hasOwn(T.metadata(row()),'blob'),false);});
function applyArgs(){const calls=[],record={id:P,rev:4,answers:{kept:'original'},archive:{kept:true},riskArchive:{kept:true},workpaperSources:{old:{retained:true}}},patch={workpaperSources:{old:record.workpaperSources.old,[SHA]:{new:true}}};return {calls,record,patch,args:{sha256:SHA,projectId:P,expectedRevision:4,routing,store:{read:async sha=>{calls.push(['read',sha]);return {sha256:sha,blob:new Blob(['original']),type:'application/zip'};}},workspaceStore:{get:async id=>{calls.push(['get',id]);return record;},save:async(id,rev,p)=>{calls.push(['save',id,rev,p]);return {...record,...p,rev:rev+1};}},library:{importFiles:async(files,r)=>{calls.push(['import',files[0].name,r.id]);assert.equal(await files[0].text(),'original');return {patch};}},projectList:async()=>[{quoteId:P,form:{projectName:'合成已保存项目'}}]}};}
test('exact known ZIP application preserves other fields and merges only workpaperSources with chosen project revision CAS',async()=>{const x=applyArgs(),before=JSON.stringify(x.record),next=await T.applyToProject(x.args);assert.equal(JSON.stringify(x.record),before);assert.equal(next.answers,x.record.answers);assert.equal(next.archive,x.record.archive);assert.equal(next.riskArchive,x.record.riskArchive);assert.deepEqual(x.calls.map(x=>x[0]),['read','get','import','save']);assert.equal(x.calls[2][1],known.name);assert.equal(x.calls[3][1],P);assert.equal(x.calls[3][2],4);assert.deepEqual(Object.keys(x.calls[3][3]),['workpaperSources']);});
test('unknown/removed/foreign/stale projects and broadened patches cannot write; trial remains explicit and no formal auto-pick',async()=>{for(const mode of ['unknown','removed','foreign','stale','broadened','blank']){const x=applyArgs();if(mode==='unknown')x.args.sha256=OTHER;if(mode==='removed')x.args.projectList=async()=>[];if(mode==='foreign')x.record.id=T.TRIAL;if(mode==='stale')x.record.rev=5;if(mode==='broadened')x.args.library.importFiles=async()=>({patch:{workpaperSources:{},answers:{}}});if(mode==='blank')x.args.projectId='';await assert.rejects(T.applyToProject(x.args));assert.equal(x.calls.filter(x=>x[0]==='save').length,0);}const x=applyArgs();x.args.projectId=T.TRIAL;x.record.id=T.TRIAL;x.args.projectList=async()=>{throw Error('trial must not read formal list');};await T.applyToProject(x.args);assert.equal(x.calls.find(x=>x[0]==='save')[1],T.TRIAL);});
test('unknown metadata is never a substitute for exact current read hash identity and source CAS failure is not retried/fallback',async()=>{const x=applyArgs();x.args.store.read=async()=>({sha256:OTHER,blob:new Blob(['wrong'])});await assert.rejects(T.applyToProject(x.args));assert.equal(x.calls.length,0);const y=applyArgs();y.args.workspaceStore.save=async()=>{throw Error('CAS synthetic conflict');};await assert.rejects(T.applyToProject(y.args),/CAS synthetic conflict/);assert.equal(y.calls.filter(x=>x[0]==='import').length,1);});
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,0));}assert.fail('template UI did not settle');}
function ui(){const dom=new JSDOM('<main id="templates"></main>',{url:'https://synthetic.example/',runScripts:'outside-only'}),w=dom.window,calls=[],downloads=[],rows=[{...T.metadata(row()),sha256:SHA,name:'已知原包.zip',firm:'合成事务所',uploader:'合成上传人'},{...T.metadata(row(1)),sha256:OTHER,name:'自定义.pdf'}];w.Blob=Blob;w.File=File;w.confirm=()=>false;w.WorkpaperRouting=routing;w.ProjectInitiation={listSaved:async()=>[{quoteId:P,form:{projectName:'合成项目'}}]};w.ProjectWorkspaceStore={get:async id=>{calls.push(['get',id]);return {id,rev:1,workpaperSources:id===P?{[SHA]:{}}:{}};},save:async()=>{calls.push(['save']);return {rev:2};},download:(blob,name)=>downloads.push({blob,name})};w.WorkpaperLibrary={importFiles:async()=>({patch:{workpaperSources:{}}})};const store={list:async()=>({records:rows,count:rows.length,total:20}),read:async sha=>{calls.push(['read',sha]);return {...rows.find(x=>x.sha256===sha),blob:new Blob(['original'])};},put:async file=>{calls.push(['put',file.name]);return {duplicate:false};},close:()=>calls.push(['close'])};w.eval(fs.readFileSync(path.join(__dirname,'../dist/audit-templates.js'),'utf8'));const controller=w.AuditTemplates.mount(w.document.querySelector('#templates'),{store});return {w,dom,calls,downloads,store,controller};}
test('library lists provenance and use count, with no project application controls',async()=>{const f=ui();try{await until(()=>!f.w.document.querySelector('.at-root').inert);const d=f.w.document;assert.deepEqual([...d.querySelectorAll('thead th')].map(x=>x.textContent),['序号','所属事务所','上传时间','上传人','使用次数']);assert.equal(d.querySelectorAll('.at-catalog,#audit-template-project,#audit-template-apply,[data-template-select]').length,0);assert.deepEqual([...d.querySelector('tbody tr').cells].slice(1).map(cell=>cell.textContent),['合成事务所','2026-11-12 08:00:00','合成上传人','1']);d.querySelector('[data-template-download="'+OTHER+'"]').click();await until(()=>f.downloads.length===1);assert.deepEqual(f.calls.find(x=>x[0]==='read'),['read',OTHER]);assert.equal(f.downloads[0].name,'自定义.pdf');}finally{f.controller.destroy();f.dom.window.close();}});
test('UI selecting unsaved upload is dirty, busy work blocks leaving, and explicit saved originals alone clear pending state',async()=>{const f=ui();try{await until(()=>!f.w.document.querySelector('.at-root').inert);const input=f.w.document.querySelector('#audit-template-upload');Object.defineProperty(input,'files',{value:[new File(['synthetic'],'新模板.pdf')],configurable:true});input.dispatchEvent(new f.w.Event('change'));assert.equal(f.controller.canLeave(),false);let release;f.store.put=async file=>new Promise(ok=>{release=()=>ok({record:{name:file.name},duplicate:false});});f.w.document.querySelector('#audit-template-save').click();assert.equal(f.controller.canLeave(),false);assert.equal(f.w.document.querySelector('.at-root').inert,true);release();await until(()=>!f.w.document.querySelector('.at-root').inert);assert.equal(f.controller.canLeave(),true);}finally{f.controller.destroy();f.dom.window.close();}});
test('a failed template read never calls download or changes a project',async()=>{const f=ui();try{await until(()=>!f.w.document.querySelector('.at-root').inert);f.store.read=async()=>{throw Error('synthetic SHA mismatch');};f.w.document.querySelector('[data-template-download="'+OTHER+'"]').click();await until(()=>!f.w.document.querySelector('.at-root').inert);assert.equal(f.downloads.length,0);assert.match(f.w.document.querySelector('#audit-template-status').textContent,/SHA mismatch/);assert.equal(f.calls.filter(x=>x[0]==='save').length,0);}finally{f.controller.destroy();f.dom.window.close();}});

test('通用模板按行删除，刷新与翻页后保留同名的其他模板',async t=>{
  const {chromium}=require('playwright');
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executablePath))return t.skip('Existing browser unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const page=await browser.newPage(),entry=process.env.SHENYI_APP_TEST_DIST||path.resolve(__dirname,'../dist');
  await page.goto(require('node:url').pathToFileURL(path.join(entry,'index.html')).href);
  const common='hengdu.general.templates.v1';
  const hashes=await page.evaluate(async dbName=>{
    const store=await AuditTemplates.open({dbName}),ids=[];
    try{
      for(let i=0;i<12;i++){
        const file=new File(['synthetic-'+i],i>=10?'同名模板.docx':'测试模板'+i+'.docx');
        ids.push((await store.put(file)).record.sha256);
      }
    }finally{store.close();}
    return ids;
  },common);
  const panel=page.locator('#general-templates');
  async function openLibrary(){
    const nav=page.locator('.sidebar button[data-view="general-templates"]');
    if(!await nav.isVisible())await nav.locator('xpath=ancestor::details[1]/summary').click();
    await nav.click();
    await panel.locator('tbody tr[data-template-sha]').first().waitFor();
  }
  await openLibrary();
  await panel.getByRole('button',{name:'下一页'}).click();
  const target=panel.locator('tr[data-template-sha="'+hashes[10]+'"]');
  const trash=target.locator('td:last-child').getByRole('button',{name:'删除模板 同名模板.docx'});
  assert.equal(await trash.locator('svg').count(),1);
  page.once('dialog',dialog=>dialog.dismiss());
  await trash.click();
  assert.equal(await target.isVisible(),true);
  page.once('dialog',dialog=>dialog.accept());
  await trash.click();
  await panel.getByRole('status').getByText('已删除模板「同名模板.docx」。',{exact:true}).waitFor();
  assert.equal(await target.count(),0);
  assert.equal(await panel.locator('tfoot').innerText().then(s=>s.includes('11 条')),true);
  assert.equal(await panel.locator('[aria-current=page]').innerText(),'2');
  assert.equal(await panel.locator('tr[data-template-sha="'+hashes[11]+'"]').isVisible(),true);
  await page.reload();
  await openLibrary();
  assert.equal(await target.count(),0);
  await panel.getByRole('button',{name:'下一页'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await panel.getByRole('button',{name:'删除模板 同名模板.docx'}).click();
  await panel.locator('tfoot').getByText('（10 条）',{exact:true}).waitFor();
  assert.equal(await panel.locator('[aria-current=page]').innerText(),'1');
  assert.equal(await panel.getByRole('button',{name:'下一页'}).isDisabled(),true);
});
