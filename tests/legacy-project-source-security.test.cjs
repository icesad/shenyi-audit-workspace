'use strict';
// Portable independent M4F source-format adversarial checks. Source fixtures
// are manually constructed; production create/summary/hash are not the oracle.
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const codec=require('../dist/legacy-project-source.js');
const ID='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const CREATED='2025-01-01T00:00:00.000Z',FIRST='2025-12-31T15:59:59.999Z',INITIAL='2026-03-01T00:00:00.000Z',LATEST='2026-05-01T00:00:00.000Z';
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
function fixture(){
 const snapshot={projectName:'合成来源名称',issuer:'合成委托方',customerName:'合成被审计方',firmName:'合成事务所',auditYear:2024,quoteDate:'2025-01-01',totalCents:123456,projectType:'原始项目分类'};
 const initiation={schemaVersion:1,quoteId:ID,revision:3,source:{quoteId:ID,wonEventNo:3,wonAt:INITIAL,...snapshot},form:{projectName:'合成已存立项名称',initiationDate:'2026-03-02',manager:'旧立项表经理',notes:'合成已存说明'},createdAt:'2026-03-02T00:00:00.000Z',updatedAt:'2026-03-03T00:00:00.000Z'};
 const events=[{eventNo:1,recordedAt:FIRST,outcome:'won'},{eventNo:2,recordedAt:'2026-02-01T00:00:00.000Z',outcome:'lost'},{eventNo:3,recordedAt:INITIAL,outcome:'won'},{eventNo:4,recordedAt:'2026-04-01T00:00:00.000Z',outcome:'cancelled'},{eventNo:5,recordedAt:LATEST,outcome:'won'}];
 const identity={schemaVersion:1,projectId:ID,year:2025,sequence:42,firstWonAt:FIRST};
 const source={format:'shenyi-legacy-project-source',schemaVersion:1,initiation,quote:{id:ID,createdAt:CREATED,snapshot,events,lastEventNo:5},numbering:{identity,riskLevel:'B类',projectType:'专项审计',businessNumber:'2025-B-专项审计-0042',workspaceRevision:9,legacyManagerName:'当前已存登记表经理'},policy:{governanceRegistrationOnly:true,includesCustomerOriginals:false,identityAuthenticated:false,originalCreatorKnown:false,professionalApprovalClaimed:false}};
 const workspace={id:ID,rev:9,projectIdentity:structuredClone(identity),projectRegister:{schemaVersion:1,riskLevel:'B类',manager:source.numbering.legacyManagerName,siteTime:'',workpaperReportTime:'',preparationTime:'',preparer:'',reviewer:'',financialStatementDate:''},projectClassification:{schemaVersion:1,projectType:'专项审计'}};
 const input={initiation:structuredClone(initiation),currentQuote:{schemaVersion:2,...structuredClone(source.quote),snapshot:{...snapshot,contactName:'MUST-NOT-EXPORT',contactInfo:'MUST-NOT-EXPORT'},events:events.map(event=>({...event,note:'MUST-NOT-EXPORT'})),attachmentRefs:[{name:'MUST-NOT-EXPORT',sha256:'a'.repeat(64)}]},identity:structuredClone(identity),workspace};
 return {source,input};
}
test('three distinct won times and original form manager remain separate from saved register manager',async()=>{
 const {source}=fixture(),before=structuredClone(source),actual=codec.validate(source);assert.deepEqual(actual,before);assert.notEqual(actual,source);assert.notEqual(actual.quote.events,source.quote.events);
 const bytes=codec.encode(source);assert.deepEqual(Buffer.from(bytes),Buffer.from(canonical(source)));const result=await codec.inspect(bytes);assert.equal(result.sha256,digest(bytes));assert.deepEqual(result.source,source);
 assert.deepEqual(result.summary,{projectId:ID,title:'合成已存立项名称',businessNumber:'2025-B-专项审计-0042',legacyManagerName:'当前已存登记表经理',initiationRevision:3,workspaceRevision:9,firstWonAt:FIRST,initiationWonAt:INITIAL,latestWonAt:LATEST});assert.equal(result.source.initiation.form.manager,'旧立项表经理');assert.deepEqual(source,before);
});
test('create projects only approved quote/register fields and never touches omitted original/workpaper fields',()=>{
 const {source,input}=fixture(),before=structuredClone(input);let reads=0;for(const name of ['contract','signedContract','answers','workpaperLocks','reportDraft','archive'])Object.defineProperty(input.workspace,name,{enumerable:true,get(){reads++;throw Error('Unapproved original field read');}});
 assert.deepEqual(codec.create(input),source);assert.equal(reads,0);assert.equal(JSON.stringify(codec.create(input)).includes('MUST-NOT-EXPORT'),false);assert.deepEqual(input.initiation,before.initiation);assert.deepEqual(input.currentQuote,before.currentQuote);assert.deepEqual(input.identity,before.identity);
});
test('validation and encoding return owned copies and deterministic canonical bytes',()=>{
 const {source}=fixture(),result=codec.validate(source),expected=Buffer.from(codec.encode(source));result.initiation.form.manager='mutation';result.quote.events[0].outcome='lost';result.numbering.identity.sequence=99;assert.equal(source.initiation.form.manager,'旧立项表经理');assert.equal(source.quote.events[0].outcome,'won');assert.equal(source.numbering.identity.sequence,42);
 const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])])):value;assert.deepEqual(Buffer.from(codec.encode(reverse(source))),expected);
});
for(const [name,mutate]of [
 ['wrong format',v=>v.format='unrelated'],['wrong schema',v=>v.schemaVersion=2],['extra top-level role',v=>v.role='partner'],
 ['unknown provenance creator',v=>v.policy.originalCreatorKnown=true],['identity authentication claim',v=>v.policy.identityAuthenticated=true],['professional approval claim',v=>v.policy.professionalApprovalClaimed=true],['customer originals inclusion',v=>v.policy.includesCustomerOriginals=true],['non-governance policy',v=>v.policy.governanceRegistrationOnly=false],
 ['extra policy',v=>v.policy.approved=true],['quote UUID mismatch',v=>v.quote.id=OTHER],['initiation UUID mismatch',v=>v.initiation.quoteId=OTHER],['numbering UUID mismatch',v=>v.numbering.identity.projectId=OTHER],
 ['snapshot differs from stored initiation',v=>v.quote.snapshot.customerName='other'],['snapshot extra contact',v=>v.quote.snapshot.contactName='private'],['quote extra original references',v=>v.quote.attachmentRefs=[]],['event extra private note',v=>v.quote.events[0].note='private'],
 ['missing original manager',v=>delete v.numbering.legacyManagerName],['manager null',v=>v.numbering.legacyManagerName=null],['manager control',v=>v.numbering.legacyManagerName='bad\0manager'],['manager too long',v=>v.numbering.legacyManagerName='x'.repeat(101)],
 ['unsafe workspace revision',v=>v.numbering.workspaceRevision=Number.MAX_SAFE_INTEGER+1],['missing workspace revision',v=>delete v.numbering.workspaceRevision],['unpersisted workspace revision',v=>v.numbering.workspaceRevision=0],
 ['identity unknown claim',v=>v.numbering.identity.confirmed=true],['fixed sequence zero',v=>v.numbering.identity.sequence=0],['fixed sequence over four digits',v=>v.numbering.identity.sequence=10000],['risk missing',v=>v.numbering.riskLevel=''],['classification missing',v=>v.numbering.projectType=''],['classification unapproved',v=>v.numbering.projectType='年度审计'],
 ['display business number changed',v=>v.numbering.businessNumber='2025-A-专项审计-0042'],['Beijing-year identity mismatch',v=>v.numbering.identity.year=2026],['first won changed to latest',v=>v.numbering.identity.firstWonAt=LATEST],
 ['initiation points to lost event',v=>{v.initiation.source.wonEventNo=2;v.initiation.source.wonAt=v.quote.events[1].recordedAt;}],['initiation event time mismatch',v=>v.initiation.source.wonAt=LATEST],['latest outcome lost',v=>v.quote.events[4].outcome='lost'],['latest outcome cancelled',v=>v.quote.events[4].outcome='cancelled'],
 ['event numbering gap',v=>v.quote.events[2].eventNo=4],['event duplicate sequence',v=>v.quote.events[2].eventNo=2],['missing final event',v=>v.quote.events.pop()],['inconsistent last event number',v=>v.quote.lastEventNo=4],['empty event history',v=>{v.quote.events=[];v.quote.lastEventNo=0;}],
 ['backward event time',v=>v.quote.events[2].recordedAt=CREATED],['event before quote creation',v=>v.quote.createdAt=LATEST],['unsupported event outcome',v=>v.quote.events[0].outcome='approved'],
 ['unpaired surrogate',v=>v.initiation.form.notes='\ud800'],['unknown source field',v=>v.initiation.source.ownerUserId='manager-a'],['unpersisted initiation revision',v=>v.initiation.revision=0],
])test('source rejects '+name+' without altering input',()=>{const {source}=fixture();mutate(source);const before=structuredClone(source);assert.throws(()=>codec.validate(source));assert.deepEqual(source,before);});
test('Beijing year boundary is independent of audit year and UTC calendar year',()=>{
 const {source}=fixture();source.quote.events[0].recordedAt='2025-12-31T16:00:00.000Z';source.numbering.identity.firstWonAt=source.quote.events[0].recordedAt;source.numbering.identity.year=2026;source.numbering.businessNumber='2026-B-专项审计-0042';assert.equal(codec.validate(source).numbering.identity.year,2026);assert.equal(source.quote.snapshot.auditYear,2024);
});
test('single won event can validly be first, stored-initiation and latest without requiring three different timestamps',()=>{
 const {source}=fixture();source.quote.events=[{eventNo:1,recordedAt:INITIAL,outcome:'won'}];source.quote.lastEventNo=1;source.initiation.source.wonEventNo=1;source.numbering.identity.firstWonAt=INITIAL;source.numbering.identity.year=2026;source.numbering.businessNumber='2026-B-专项审计-0042';assert.equal(codec.validate(source).quote.events.length,1);
});
test('event history accepts exact 1000 and rejects 1001 completely without truncation',()=>{
 const {source}=fixture();for(let n=6;n<=1000;n++)source.quote.events.push({eventNo:n,recordedAt:LATEST,outcome:n===1000?'won':'cancelled'});source.quote.lastEventNo=1000;assert.equal(codec.validate(source).quote.events.length,1000);source.quote.events.push({eventNo:1001,recordedAt:LATEST,outcome:'won'});source.quote.lastEventNo=1001;assert.throws(()=>codec.validate(source));assert.equal(source.quote.events.length,1001);
});
test('inspect rejects invalid UTF8, extra whitespace, BOM, duplicate keys and bytes beyond cap',async()=>{
 const {source}=fixture(),bytes=Buffer.from(canonical(source));for(const malformed of [Buffer.from([255]),Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from(JSON.stringify(source,null,2)),Buffer.concat([Buffer.from([239,187,191]),bytes]),Buffer.from('{"format":"discarded",'+bytes.toString().slice(1)),Buffer.alloc(128*1024+1,32)])await assert.rejects(codec.inspect(malformed));
});
test('object accessors and unexpected prototypes are rejected without executing caller code',()=>{
 for(const target of ['source','policy','events']){const {source}=fixture();let called=0;if(target==='source')Object.defineProperty(source,'quote',{enumerable:true,get(){called++;return {};}});if(target==='policy')Object.setPrototypeOf(source.policy,{inherited:true});if(target==='events')Object.defineProperty(source.quote.events,'0',{enumerable:true,get(){called++;return {};}});assert.throws(()=>codec.validate(source));assert.equal(called,0);}
});
test('validation rejects inherited array method hijacking rather than returning a caller-owned event array',()=>{
 const {source}=fixture();let calls=0;const hostile=Object.create(Array.prototype);hostile.map=function(){calls++;return this;};Object.setPrototypeOf(source.quote.events,hostile);assert.throws(()=>codec.validate(source));assert.equal(calls,0);
});
test('source event timestamps follow the original quote-ledger four-digit ISO year format',()=>{
 const {source}=fixture();source.quote.events.at(-1).recordedAt='+010000-01-01T00:00:00.000Z';assert.throws(()=>codec.validate(source));
});
