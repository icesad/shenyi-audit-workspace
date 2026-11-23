'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const R=require('../dist/report-workspace.js'),Q=require('../dist/quote-layouts.js');
const P='4a502e25-69a2-4ff6-b37f-d06a1598eb12',OTHER='c462f459-ded1-4615-8785-fde6daf79058',TRIAL='00000000-0000-4000-8000-000000000033',GEN='11111111-1111-4111-8111-111111111111',FILE='22222222-2222-4222-8222-222222222222',HASH='a'.repeat(64);
function record(projectId=P,status='confirmed'){return {schema:2,project:{quoteId:projectId},revision:3,generationId:GEN,nodes:[{id:'n1',parentId:'',title:'上年审计报告',kind:'material'}],states:{n1:{status,reviewer:'合成核对人',at:'2026-11-12T00:00:00.000Z'}},attachments:{n1:[{id:FILE,nodeId:'n1',generationId:GEN,name:'合成上年审计报告.docx',sha256:HASH,size:100,type:R.MIME}]}};}
function draft(rec=record()){return {projectId:P,projectName:'合成项目<&>',source:R.sourceChoices(rec,P)[0],year:'2025',currency:'CNY',unit:'unit',reviewer:'合成核对人',sourceConfirmed:true,dimensionsConfirmed:true,reviewConfirmed:true,rows:[{item:'合成科目<&>',priorClosing:'123.4',priorEvidence:'上年报表第1页A1',currentClosing:'-12.50',currentEvidence:'本项目9200已核对工作表!B2',confirmed:true}]};}
test('amounts preserve exact decimals; absent, formula, commas, NaN or extra decimals never become zero',()=>{assert.equal(R.amount('0'),'0.00');assert.equal(R.amount('-0.00'),'0.00');assert.equal(R.amount('-123456789012345678.9'),'-123456789012345678.90');for(const value of ['',null,undefined,'=1+1','1,000','NaN','1.001',' 0','+0','00'])assert.throws(()=>R.amount(value));});
test('sources are current report-leaf attachments of exact project, not removed, wrong generation, group or other material',()=>{const r=record();assert.equal(R.sourceChoices(r,P).length,1);assert.throws(()=>R.sourceChoices(r,OTHER));r.attachments.n1.push({...r.attachments.n1[0],id:'33333333-3333-4333-8333-333333333333',generationId:'wrong'});assert.equal(R.sourceChoices(r,P).length,1);r.nodes[0].kind='group';assert.equal(R.sourceChoices(r,P).length,0);r.nodes[0].kind='material';r.nodes[0].title='银行对账单';assert.equal(R.sourceChoices(r,P).length,0);});
test('source freshness rejects project, current attachment, generation, hash and full checklist revision mismatch',()=>{const r=record(),s=R.sourceChoices(r,P)[0];for(const patch of [{projectId:OTHER},{recordRevision:2},{generationId:'wrong'},{file:{...s.file,sha256:'b'.repeat(64)}}])assert.throws(()=>R.verifySource(r,P,{...s,...patch}));const removed=record();removed.attachments.n1=[];assert.throws(()=>R.verifySource(removed,P,s));});
test('received is not confirmed; explicit source/dimensions/row/reviewer gates precede the equal opening projection',()=>{const r=record(),d=draft(r);const checked=R.validateDraft(d,r);assert.equal(checked.rows[0].currentOpening,'123.40');assert.equal(checked.rows[0].currentClosing,'-12.50');for(const field of ['sourceConfirmed','dimensionsConfirmed','reviewConfirmed'])assert.throws(()=>R.validateDraft({...d,[field]:false},r));for(const patch of [{reviewer:''},{year:''},{currency:''},{unit:''},{rows:[{...d.rows[0],confirmed:false}]},{rows:[{...d.rows[0],currentClosing:''}]},{rows:[{...d.rows[0],currentEvidence:''}]}])assert.throws(()=>R.validateDraft({...d,...patch},r));const pending=record(P,'received');assert.throws(()=>R.validateDraft(draft(pending),pending),/尚未核对通过/);});
test('Word draft is real OOXML ZIP of a handoff table, escapes source text, no stamp/opinion/date fabrication or active relationships',()=>{const checked=R.validateDraft(draft(),record()),parts=R.wordParts(checked),xml=new TextDecoder().decode(parts['word/document.xml']);assert.match(xml,/数据衔接核对表/);assert.match(xml,/不是正式审计报告/);assert.match(xml,/未生成审计意见、报告日期、签字或印章/);assert.match(xml,/合成科目&lt;&amp;&gt;/);assert.match(xml,/123\.40/);assert.match(xml,/-12\.50/);assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);assert.doesNotMatch(xml,/<w:drawing|<w:object|<w:fldChar|<w:instrText|无保留意见|于\d{4}年/);assert.deepEqual(Object.keys(parts).sort(),['[Content_Types].xml','_rels/.rels','word/document.xml'].sort());const zip=Q.packOfficeParts(parts);assert.equal(Buffer.from(zip).readUInt32LE(0),0x04034b50);});

async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,0));}assert.fail('UI did not settle');}
function fixture({status='confirmed',delayed=false,savedProjects,savedWorkspaces}={}){const dom=new JSDOM('<main id="report"></main>',{url:'https://report.example/',runScripts:'outside-only'}),w=dom.window;w.TextEncoder=TextEncoder;w.confirm=()=>false;let current=record(P,status),trial=record(TRIAL,status),release,reads=[],downloads=[],previews=[],calls=[];const projects=savedProjects||[{quoteId:P,form:{projectName:'甲项目'},source:{auditYear:2025}},{quoteId:OTHER,form:{projectName:'乙项目'},source:{auditYear:2024}}];
 const api={get:key=>{reads.push(key);if(delayed&&key===P)return new Promise(ok=>{release=()=>ok(current);});return Promise.resolve(key===P?current:key===TRIAL?trial:record(key,status));},downloadAttachment:async(key,nodeId,fileId)=>{calls.push({key,nodeId,fileId});return {blob:new w.Blob(['unchanged-source']),metadata:(key===TRIAL?trial:current).attachments.n1[0]};},close(){}};
 w.ProjectInitiation={listSaved:async()=>projects};w.AuditChecklist={open:async()=>{calls.push('main');return api;},openTrial:async()=>{calls.push('trial');return api;},validate(){}};w.AuditAttachmentPreview={open:x=>{previews.push(x);return {close(){}};}};w.ProjectWorkspaceStore={download:(blob,name)=>downloads.push({blob,name})};if(savedWorkspaces)w.ProjectWorkspaceStore.get=async key=>savedWorkspaces[key]||{rev:0};w.QuoteLayouts=Q;w.eval(fs.readFileSync(path.join(__dirname,'../dist/report-workspace.js'),'utf8'));const controller=w.ReportWorkspace.mount(w.document.querySelector('#report'),{openTrialBalance:async x=>{calls.push(x);return {state:'missing',index:'9200',row:246};}});return {w,dom,controller,reads,downloads,previews,calls,setCurrent:x=>{current=x;},release:()=>release?.()};}
const choose=(f,selector,value)=>{const n=f.w.document.querySelector(selector);n.value=value;n.dispatchEvent(new f.w.Event('change',{bubbles:true}));};
const input=(f,selector,value)=>{const n=f.w.document.querySelector(selector);n.value=value;n.dispatchEvent(new f.w.Event('input',{bubbles:true}));};
const check=(f,selector)=>{const n=f.w.document.querySelector(selector);n.checked=true;n.dispatchEvent(new f.w.Event('change',{bubbles:true}));};
async function project(f,key=P){await until(()=>f.w.document.querySelector('#report-project').options.length===4);choose(f,'#report-project',key);await until(()=>f.w.document.querySelector('#report-source').options.length===2);}
function complete(f){choose(f,'#report-source','0');choose(f,'#report-currency','CNY');choose(f,'#report-unit','unit');check(f,'#report-source-confirmed');check(f,'#report-dimensions-confirmed');input(f,'#report-reviewer','合成核对人');for(const [field,value]of Object.entries({item:'合成科目',priorClosing:'10',priorEvidence:'上年第1页',currentClosing:'20',currentEvidence:'9200!B2'}))input(f,'[data-field='+field+']',value);check(f,'[data-field=confirmed]');check(f,'#report-review-confirmed');}
test('mount has two cards, no project auto-selection/read or network login; TB delegates exact project and9200 and handles missing',async()=>{const f=fixture();try{await until(()=>f.w.document.querySelector('#report-project').options.length===4);assert.deepEqual(f.reads,[]);assert.equal(f.w.document.querySelector('#report-project').value,'');assert.ok(f.w.document.querySelector('#report-trial-balance'));assert.ok(f.w.document.querySelector('#report-audit-report'));assert.equal(f.w.document.querySelector('#report-open-9200').disabled,true);await project(f);f.w.document.querySelector('#report-open-9200').click();await until(()=>f.w.document.querySelector('#report-trial-balance').textContent.includes('未改开其他表'));assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(x=>x?.index))),{projectId:P,index:'9200'});assert.equal(f.downloads.length,0);}finally{f.controller.destroy();f.dom.window.close();}});
test('trial reads only the trial database; previews keep project/node/file identity and never confirm the received source',async()=>{const f=fixture({status:'received'});try{await project(f,TRIAL);assert.deepEqual(f.calls,['trial']);choose(f,'#report-source','0');f.w.document.querySelector('#report-preview-source').click();await until(()=>f.previews.length===1);assert.equal(f.calls.some(x=>x==='main'),false);assert.deepEqual(f.calls.find(x=>x?.fileId),{key:TRIAL,nodeId:'n1',fileId:FILE});assert.equal(f.w.document.querySelector('#report-export').disabled,true);assert.match(f.w.document.querySelector('#report-source-provenance').textContent,/已接收，尚未核对/);assert.equal(f.downloads.length,0);}finally{f.controller.destroy();f.dom.window.close();}});
test('manual data is blank initially, canLeave guards loss and export checks current source before true DOCX download',async()=>{const f=fixture();try{await project(f);choose(f,'#report-source','0');assert.equal(f.w.document.querySelector('[data-field=currentClosing]').value,'');assert.equal(f.w.document.querySelector('#report-export').disabled,true);complete(f);assert.equal(f.controller.canLeave(),false);choose(f,'#report-project',OTHER);assert.equal(f.w.document.querySelector('#report-project').value,P);assert.equal(f.w.document.querySelector('[data-field=currentClosing]').value,'20');assert.equal(f.w.document.querySelector('[data-opening]').textContent,'10.00');assert.equal(f.w.document.querySelector('#report-export').disabled,false);f.w.document.querySelector('#report-export').click();await until(()=>f.downloads.length===1);assert.equal(f.downloads[0].name,'审计报告数据衔接核对表-无章草稿.docx');assert.equal(f.downloads[0].blob.type,R.MIME);assert.equal(f.controller.canLeave(),true);}finally{f.controller.destroy();f.dom.window.close();}});
test('current source removed or revised after editing refuses export; no source fallback and no data overwrite',async()=>{const f=fixture();try{await project(f);complete(f);const changed=record();changed.revision=4;changed.attachments.n1=[];f.setCurrent(changed);f.w.document.querySelector('#report-export').click();await until(()=>f.w.document.querySelector('#report-status').textContent.includes('源附件或资料清单版本已改变'));assert.equal(f.downloads.length,0);assert.equal(f.controller.canLeave(),false);}finally{f.controller.destroy();f.dom.window.close();}});
test('returning to the report reloads the checklist status and retains the same source, input and confirmations',async()=>{
 const f=fixture({status:'received'}),d=f.w.document;
 try{
  await project(f);complete(f);
  assert.equal(d.querySelector('#report-export').disabled,true);
  f.controller.selectSection('audit-report');
  await until(()=>!d.querySelector('#report-preview-source').disabled);
  f.setCurrent({...record(),revision:4});
  f.controller.refreshActiveSection();
  const provenance=d.querySelector('#report-source-provenance');
  await until(()=>provenance.textContent.includes('状态：核对通过'));
  assert.equal(d.querySelector('#report-project').value,P);
  assert.equal(d.querySelector('#report-source').value,'0');
  assert.equal(d.querySelector('[data-field=currentClosing]').value,'20');
  assert.equal(d.querySelector('[data-field=confirmed]').checked,true);
  assert.equal(d.querySelector('#report-review-confirmed').checked,true);
  assert.equal(d.querySelector('#report-export').disabled,false);
  d.querySelector('#report-export').click();
  await until(()=>f.downloads.length===1);
  f.setCurrent({...record(P,'problem'),revision:5});
  f.controller.refreshActiveSection();
  await until(()=>provenance.textContent.includes('状态：存在问题'));
  assert.equal(d.querySelector('#report-export').disabled,true);
 }finally{f.controller.destroy();f.dom.window.close();}
});
test('returning after replacement clears the old source without automatically selecting the new attachment',async()=>{
 const f=fixture(),d=f.w.document;
 try{
  await project(f);complete(f);
  const replacement=record();
  replacement.revision++;
  replacement.attachments.n1[0]={...replacement.attachments.n1[0],id:'33333333-3333-4333-8333-333333333333',name:'另一个报告.docx'};
  f.setCurrent(replacement);
  f.controller.selectSection('audit-report');
  await until(()=>d.querySelector('#report-status').textContent.includes('已移除或更换'));
  assert.equal(d.querySelector('#report-source').value,'');
  assert.match(d.querySelector('#report-source').options[1].textContent,/另一个报告/);
  assert.equal(d.querySelector('#report-preview-source').disabled,true);
  assert.equal(d.querySelector('#report-generate').disabled,true);
  assert.equal(d.querySelector('[data-field=currentClosing]').value,'20');
 }finally{f.controller.destroy();f.dom.window.close();}
});
test('report picker filters audit projects by the saved audited company and keeps the project scope on navigation',async()=>{
 const another='33333333-3333-4333-8333-333333333333';
 const savedProjects=[[P,'甲项目','报价旧名称'],[another,'甲的第二个项目','甲单位'],[OTHER,'乙项目','乙单位']]
  .map(([quoteId,projectName,customerName])=>({quoteId,form:{projectName},source:{customerName,auditYear:2025}}));
 const f=fixture({savedProjects,savedWorkspaces:{[P]:{rev:1,projectInitiationDetails:{companyName:'甲单位'}}}});
 const d=f.w.document,company=d.querySelector('#report-company'),select=d.querySelector('#report-project');
 try{
  await until(()=>company.options.length===3);
  assert.deepEqual([...d.querySelectorAll('.rw-toolbar label')].map(node=>node.firstChild.textContent),['被审计单位','审计项目']);
  assert.equal(d.querySelector('.rw-boundary'),null);
  assert.doesNotMatch(d.querySelector('.rw-root').textContent,/报告工作台|本页业务资料仍为本设备浏览器共享/);
  assert.deepEqual(new Set([...company.options].map(node=>node.value)),new Set(['','甲单位','乙单位']));
  assert.equal(select.value,'');
  choose(f,'#report-company','甲单位');
  assert.deepEqual([...select.options].map(node=>[node.value,node.textContent]),[['','请选择已立项项目'],[P,'甲项目'],[another,'甲的第二个项目']]);
  assert.equal(select.value,'');
  choose(f,'#report-project',P);
  await until(()=>d.querySelector('#report-source').options.length===2);
  complete(f);
  choose(f,'#report-company','乙单位');
  assert.equal(company.value,'甲单位');
  assert.equal(select.value,P);
  assert.equal(d.querySelector('[data-field=currentClosing]').value,'20');
  f.w.confirm=()=>true;
  choose(f,'#report-company','乙单位');
  assert.equal(select.value,OTHER);
  await until(()=>d.querySelector('#report-source').options.length===2);
  await f.controller.selectProject(P);
  assert.equal(company.value,'甲单位');
  assert.equal(select.value,P);
  assert.deepEqual(f.reads,[P,OTHER,P]);
 }finally{f.controller.destroy();f.dom.window.close();}
});
test('late project reads cannot paint another selected project source',async()=>{const f=fixture({delayed:true});try{await until(()=>f.w.document.querySelector('#report-project').options.length===4);choose(f,'#report-project',P);await until(()=>f.reads.includes(P));choose(f,'#report-project',OTHER);await until(()=>f.w.document.querySelector('#report-source').options.length===2);f.release();await new Promise(r=>setTimeout(r,0));choose(f,'#report-source','0');assert.match(f.w.document.querySelector('#report-source-provenance').textContent,new RegExp(OTHER));assert.doesNotMatch(f.w.document.querySelector('#report-source-provenance').textContent,new RegExp(P));}finally{f.controller.destroy();f.dom.window.close();}});


test('report panes are selected by the sidebar and the report form displays four opinion types',async()=>{const f=fixture();try{await until(()=>f.w.document.querySelector('#report-project').options.length===4);const d=f.w.document;assert.equal(d.querySelector('#report-pane-audit'),null);assert.equal(d.querySelectorAll('.rw-pane-nav [role=tab]').length,0);assert.deepEqual([...d.querySelector('#report-type').options].filter(option=>!option.disabled).map(option=>option.textContent),['标准无保留意见','否定意见','保留意见','无法表示意见']);choose(f,'#report-type','保留意见');assert.match(d.querySelector('.rw-report-text').textContent,/报告类型：保留意见/);assert.equal(d.querySelector('#report-trial-balance').hidden,false);assert.equal(f.controller.selectSection('audit-report'),true);assert.equal(d.querySelector('#report-audit-report').hidden,false);assert.equal(d.querySelector('#report-trial-balance').hidden,true);assert.equal(f.controller.selectSection('trial-balance'),true);assert.equal(d.querySelector('#report-trial-balance').hidden,false);assert.deepEqual(f.reads,[]);}finally{f.controller.destroy();f.dom.window.close();}});
