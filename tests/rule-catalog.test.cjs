const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../dist/rule-catalog.js');
// Synthetic fixtures only, not actual fees or policy.
const sample=(change={})=>({schemaVersion:'1.0',ruleId:'DEMO',version:'1',firmId:'TEST-FIRM',region:{code:'450000',name:'广西',level:'province'},auditType:'annual',status:'custom_unverified',source:{type:'example',title:'虚构示例',url:null},effectiveFrom:'2025-01-01',effectiveTo:null,review:{reviewer:'',reviewedAt:null},calculation:{mode:'fixed',basis:'assets',fixedYuan:123},notes:'仅测试',...change});
const query={firmId:'TEST-FIRM',regionCode:'450000',auditType:'annual',onDate:'2025-06-01',allowedStatuses:['custom_unverified']};
test('append takes immutable rule snapshots; mutation of input and later version cannot change historical version',()=>{
 const input=sample(),c1=R.append(R.emptyCatalog(),input);input.calculation.fixedYuan=999;
 assert.equal(R.snapshot(c1,{firmId:'TEST-FIRM',ruleId:'DEMO',version:'1'}).calculation.fixedYuan,123);
 const c2=R.append(c1,sample({version:'2',calculation:{mode:'fixed',basis:'assets',fixedYuan:456}}));
 assert.equal(c1.entries.length,1);assert.equal(c2.entries.length,2);
 assert.equal(R.snapshot(c2,{firmId:'TEST-FIRM',ruleId:'DEMO',version:'1'}).calculation.fixedYuan,123);
 assert.ok(Object.isFrozen(c2.entries[0].calculation));
 assert.throws(()=>R.append(c2,sample()),/不可覆盖/);
});
test('metadata source and applicability, validity dates, reviewer safeguards',()=>{
 assert.throws(()=>R.normalize(sample({source:{type:'example',title:''}})),/来源标题/);
 assert.throws(()=>R.normalize(sample({source:{type:'official',title:'x',url:'javascript:alert(1)'}})),/HTTP/);
 assert.throws(()=>R.normalize(sample({status:'approved'})),/审核人/);
 assert.throws(()=>R.normalize(sample({status:'approved',review:{reviewer:'A',reviewedAt:'2025-02-01'}})),/示例来源/);
 assert.throws(()=>R.normalize(sample({effectiveFrom:'2025-02-29'})),/有效日期/);
 assert.throws(()=>R.normalize(sample({effectiveTo:'2024-12-31'})),/结束日期/);
 assert.throws(()=>R.normalize(sample({status:'magic'})),/状态/);
 assert.throws(()=>R.normalize(sample({region:{code:'450100',name:'某市',level:'city'}})),/层级/);
});
test('lookup is exact, defaults to approved only, missing not zero and no cross-firm or cross-region fallback',()=>{
 const c=R.append(R.emptyCatalog(),sample());
 assert.equal(R.lookup(c,query).status,'matched');
 assert.equal(R.lookup(c,{...query,allowedStatuses:['approved']}).status,'missing');
 assert.equal(R.lookup(c,{...query,regionCode:'130000'}).status,'missing');
 assert.equal(R.lookup(c,{...query,regionCode:'810000'}).status,'missing');
 assert.equal(R.lookup(c,{...query,firmId:'OTHER'}).status,'missing');
 assert.equal(R.lookup(c,{...query,onDate:'2024-12-31'}).status,'missing');
 assert.throws(()=>R.lookup(c,{...query,regionCode:'450100'}),/省级/);
 assert.equal('rule' in R.lookup(c,{...query,regionCode:'130000'}),false);
});
test('overlapping applicable versions are ambiguous, never silently select latest',()=>{
 let c=R.append(R.emptyCatalog(),sample());c=R.append(c,sample({version:'2'}));
 const result=R.lookup(c,query);assert.equal(result.status,'ambiguous');assert.equal(result.candidates.length,2);
 assert.throws(()=>R.append(c,sample({version:'3',auditType:'different'})),/不可改变/);
});
test('pure JSON only, non-finite and executable config is rejected',()=>{
 assert.throws(()=>R.normalize(sample({calculation:{mode:'fixed',basis:'assets',fixedYuan:Infinity}})),/非有限数/);
 assert.throws(()=>R.normalize(sample({calculation:{mode:'fixed',basis:'assets',compute:()=>1}})),/JSON/);
});
test('nationwide picker has 34 province-level options; all are missing in empty catalog',()=>{
 assert.equal(R.PROVINCES.length,34);assert.equal(new Set(R.PROVINCES.map(p=>p.code)).size,34);
 for(const p of R.PROVINCES)assert.equal(R.lookup(R.emptyCatalog(),{...query,regionCode:p.code}).status,'missing');
 assert.deepEqual(R.PROVINCES.filter(p=>p.scopePending).map(p=>p.code),['710000','810000','820000']);
 assert.throws(()=>R.lookup(R.emptyCatalog(),{...query,regionCode:'990000'}),/34 个/);
});


test('province code accepts only matching canonical name or unambiguous short name',()=>{
 for(const p of R.PROVINCES){
  const short=p.name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/,'');
  for(const name of [p.name,short]){
   const normalized=R.normalize(sample({region:{code:p.code,name,level:'province'}}));
   assert.equal(normalized.region.name,p.name,'canonical display for '+name);
  }
  const other=R.PROVINCES.find(x=>x.code!==p.code);
  assert.throws(()=>R.normalize(sample({region:{code:p.code,name:other.name,level:'province'}})),/名称与编码不一致/);
 }
 assert.throws(()=>R.normalize(sample({region:{code:'450000',name:'上海市',level:'province'}})),/名称与编码不一致/);
 assert.throws(()=>R.normalize(sample({region:{code:'310000',name:'广西',level:'province'}})),/名称与编码不一致/);
 const catalog=R.append(R.emptyCatalog(),sample({region:{code:'450000',name:'广西',level:'province'}}));
 assert.equal(R.lookup(catalog,query).rule.region.name,'广西壮族自治区');
});


test('all 34 runtime defaults have distinct ids, provenance, and usable parameters, without altering the approved catalog',()=>{
 require('../dist/regions.js');
 const calc=require('../dist/calc.js'),legacy=globalThis.REGION_REFERENCE;
 const ids={'130000':'hb','310000':'sh','450000':'gx'},hb=R.defaultRule('hb');
 const defaults=R.PROVINCES.map(p=>[p,R.defaultRule(p.code)]);
 assert.equal(new Set(defaults.map(([,d])=>d?.id)).size,34);
 for(const [p,d] of defaults){
  assert.equal(d.id,ids[p.code]||p.code,p.name);
  assert.ok(d.name&&d.document&&d.version,p.name+' needs provenance');
  assert.ok(['assets','revenue','max','average'].includes(d.basis),p.name+' needs a calculation basis');
  assert.ok(d.minimumYuan>=0,p.name+' needs a minimum');
  assert.ok(Array.isArray(d.tiers),p.name+' tiers must be explicitly defined');
  if(p.scopePending||d.status==='fallback_historical'){
   assert.equal(d.status,p.scopePending?'scope_reference':'fallback_historical',p.name);
   assert.equal(d.sourceRegionId,'hb',p.name);
   assert.match(d.document,/河北/,p.name+' cannot mislabel the borrowed table as local');
   assert.equal(d.sourceUrl,hb.sourceUrl,p.name);
   assert.equal(d.basis,hb.basis,p.name);assert.equal(d.mode,hb.mode,p.name);
   assert.deepEqual(d.tiers,hb.tiers,p.name);assert.notStrictEqual(d.tiers,hb.tiers,p.name+' tiers must not share mutable state');
  }
  if(!p.scopePending&&d.mode!=='budget'){
   const sampleFee=calc.calculateScale({...d,baseYuan:'30000000'});
   assert.ok(sampleFee.totalCents>0,p.name+' default should produce a nonzero amount for the synthetic supported example');
  }
  assert.equal(R.lookup(R.emptyCatalog(),{...query,regionCode:p.code}).status,'missing',p.name+' does not become an approved exact quote');
 }
 for(const [code,id] of Object.entries(ids)){
  const d=R.defaultRule(id);
  assert.deepEqual(R.defaultRule(code),d);
  assert.deepEqual(d,legacy.find(r=>r.id===id),id+' preserves existing local source');
 }
 assert.equal(R.defaultRule('sh').mode,'budget');
 assert.equal(R.defaultRule('210000').status,'fallback_historical');
 for(const id of [undefined,null,'','990000','210100','__proto__',210000])assert.equal(R.defaultRule(id),null,String(id));
});

test('a supplied province-specific default takes precedence over a fallback and is copied deeply',()=>{
 require('../dist/regions.js');
 const fixture={id:'220000',name:'吉林省',document:'虚构本地来源',version:'demo',mode:'flat',basis:'revenue',minimumYuan:0,tiers:[{upToYuan:50000000,feeYuan:1234}]};
 const rules=[...globalThis.REGION_REFERENCE,fixture];
 const a=R.defaultRule('220000',rules),b=R.defaultRule('220000',rules);
 assert.deepEqual(a,fixture);assert.deepEqual(b,fixture);assert.notStrictEqual(a.tiers[0],b.tiers[0]);
 a.tiers[0].feeYuan=4321;
 assert.equal(b.tiers[0].feeYuan,1234);assert.equal(fixture.tiers[0].feeYuan,1234);
 assert.equal(R.defaultRule('820000',[...rules,{...fixture,id:'820000'}]).status,'scope_reference','read-only scope cannot be bypassed by injecting an exact rule');
});
