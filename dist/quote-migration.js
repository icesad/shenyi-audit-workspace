/* Pure v0.1 snapshot migration preview; never writes storage or creates projects. */
(function(root){
  'use strict';
  const Q = typeof module!=='undefined' && module.exports ? require('./quote-model.js') : root.QuoteModel;
  const C = typeof module!=='undefined' && module.exports ? require('./calc.js') : root.QuoteCalc;
  const R = typeof module!=='undefined' && module.exports ? require('./rule-catalog.js') : root.RuleCatalog;
  function json(v){
    function check(x,d){
      if(d>40)throw Error('快照嵌套过深');
      if(x===null||typeof x==='string'||typeof x==='boolean'||(typeof x==='number'&&Number.isFinite(x)))return;
      if(Array.isArray(x)){x.forEach(y=>check(y,d+1));return;}
      if(typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
        for(const k of Object.keys(x)){if(['__proto__','constructor','prototype'].includes(k))throw Error('快照含禁止字段');check(x[k],d+1);}return;
      }
      throw Error('快照含非 JSON 值');
    }
    check(v,0);return JSON.parse(JSON.stringify(v));
  }
  function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}return v;}
  function required(x,label){if(typeof x!=='string'||!x.trim())throw Error(label+'缺失');return x;}
  function wanCents(v,signed){
    if(typeof v!=='string'||!(signed?/^-?\d+(?:\.\d{1,6})?$/:/^\d+(?:\.\d{1,6})?$/).test(v))throw Error('财务快照金额无效');
    const negative=v.startsWith('-');const [a,b='']=(negative?v.slice(1):v).split('.');let n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));if(negative)n=-n;
    if(n>BigInt(Number.MAX_SAFE_INTEGER)||n< -BigInt(Number.MAX_SAFE_INTEGER))throw Error('财务金额超出安全范围');return Number(n);
  }
  function bp(v){if(typeof v!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('比例无效');const [a,b='']=v.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(n>10000n)throw Error('比例超出范围');return Number(n);}
  function yuanFromCents(cents){const n=BigInt(cents);return (n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');}
  function assertProvinceRule(rule){
    if(!R || !Array.isArray(R.PROVINCES))throw Error('缺少地区目录，无法核验历史地区');
    const aliases={gx:'450000',hb:'130000',sh:'310000'};
    const p=R.PROVINCES.find(v=>v.code===(aliases[rule.id]||rule.id));
    if(!p || typeof rule.name!=='string')throw Error('历史地区编号或名称无效');
    const shortName=p.name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/,'');
    if(rule.name!==p.name && rule.name!==shortName)throw Error('历史地区编号与名称不一致');
  }
  function validateCalculation(s,calc,financial){
    let budget;try{budget=C.calculateHours(s.budget);}catch{throw Error('原工时预算无法复算');}
    function compare(expected,saved,label){
      if(!saved||typeof saved!=='object'||saved.error||saved.totalCents!==expected.totalCents||JSON.stringify(saved.lines)!==JSON.stringify(expected.lines))throw Error(label+'金额或计算明细不一致');
      if(Object.prototype.hasOwnProperty.call(expected,'baseCents')&&saved.baseCents!==expected.baseCents)throw Error(label+'计费基数不一致');
    }
    compare(budget,calc.budget,'工时预算');
    if(!calc.regions||typeof calc.regions!=='object'||Array.isArray(calc.regions))throw Error('地区计算快照无效');
    const names=new Set();for(const rule of s.rules){
      if(!rule||typeof rule.id!=='string'||names.has(rule.id))throw Error('地区规则编号无效或重复');assertProvinceRule(rule);names.add(rule.id);
      const saved=calc.regions[rule.id];if(!saved||typeof saved!=='object')throw Error('缺少地区计算快照');
      if(['710000','810000','820000'].includes(rule.id)){if(!saved.error)throw Error('港澳台规则适用性未确认');continue;}
      if(rule.mode==='budget'){
        if(rule.id!=='sh')throw Error('非上海预算模式无法安全复算');
        compare(budget,saved,'上海工时预算');continue;
      }
      let expected;
      try{
        if(!['assets','revenue','max','average'].includes(rule.basis))throw Error('无效计费基数');
        let base=rule.basis==='revenue'?financial.revenueCents:financial.assetsCents;
        if(rule.basis==='max')base=Math.max(financial.assetsCents,financial.revenueCents);
        if(rule.basis==='average')base=Number((BigInt(financial.assetsCents)+BigInt(financial.revenueCents)+1n)/2n);
        expected=C.calculateScale({...rule,baseYuan:yuanFromCents(base)});
      }catch(e){
        if(!saved.error||typeof saved.error!=='string'||saved.totalCents!==undefined||saved.lines!==undefined)throw Error('地区规则无法复算或结果不一致');
        continue;
      }
      compare(expected,saved,'地区 '+rule.id);
    }
    for(const key of Object.keys(calc.regions))if(!names.has(key))throw Error('地区快照缺少对应规则');
    const basis=s.quote.basis;let expectedBase;
    if(basis==='budget')expectedBase=budget.totalCents;
    else if(basis==='manual')expectedBase=C.money(s.quote.manual);
    else{if(!names.has(basis)||!calc.regions[basis]||calc.regions[basis].error)throw Error('所选地区无法验证');expectedBase=calc.regions[basis].totalCents;}
    if(calc.quote.baseCents!==expectedBase)throw Error('报价基准与所选输入或计算快照不一致');
  }
  function toOne(raw,firmId,actor,migratedAt){
    const original=json(raw),s=original?.snapshot,calc=original?.calculation,client=s?.client,q=s?.quote,result=calc?.quote;
    if(original?.appVersion!=='0.1'||s?.schema!==1)throw Error('未知原记录版本');
    if(Object.hasOwn(s,'auditeeRegister')&&!(typeof module==='object'&&module.exports?require('./auditee-rows.js'):root.AuditeeRows)?.valid(s.auditeeRegister))throw Error('被审计方名单无效');
    if(Object.hasOwn(s,'comparisonProvinceIds')){const ids=s.comparisonProvinceIds,codes=R.PROVINCES.map(p=>({'450000':'gx','130000':'hb','310000':'sh'}[p.code]||p.code));if(!Array.isArray(ids)||ids.length!==3||!ids.every((id,i)=>typeof id==='string'&&(codes.includes(id)||(id===''&&(i===0||(i===1&&s.client?.team==='')))))||(s.selectedProvince!==undefined&&s.selectedProvince!==ids[0]))throw Error('参考地区选择无效');}
    required(original.id,'原记录编号');required(original.savedAt,'保存时间');required(firmId,'事务所编号');required(actor,'迁移操作人');
    if(!client||!q||!result||!calc.regions||!calc.budget||!Array.isArray(s.rules)||!Array.isArray(s.budget))throw Error('原记录快照不完整');
    const date=new Date(original.savedAt);if(!Number.isFinite(date.getTime()))throw Error('保存时间无效');
    const financial={assetsCents:wanCents(client.assets,false),revenueCents:wanCents(client.revenue,false),netProfitCents:wanCents(client.profit,true)};
    validateCalculation(s,calc,financial);
    const rules=s.rules.map(r=>({id:required(r?.id,'规则编号'),version:required(r?.version,'规则版本'),snapshot:r}));
    if(q.rounding&&q.rounding!=='none')throw Error('取整报价尚不支持迁入旧报价模型，请保留原备份');
    const discountBasisPoints=bp(q.discount),taxBasisPoints=bp(q.tax),extraCents=C.money(q.extra);
    const expected=C.applyAdjustment({baseCents:result.baseCents,discountPercent:q.discount,extraYuan:q.extra,taxPercent:q.tax});
    for(const key of ['discountCents','subtotalCents','taxCents','totalCents'])if(result[key]!==expected[key])throw Error('原报价明细不一致');
    if(original.totalCents!==result.totalCents)throw Error('记录总额与原报价不一致');
    const content={client:{id:null,name:required(client.clientName,'客户名称'),location:required(client.location,'所在地')},auditYear:Number(client.year),serviceType:required(client.service,'业务类型'),financial,rules,
      adjustment:{basis:required(q.basis,'报价依据'),discountBasisPoints,extraCents,taxBasisPoints,reason:q.reason||null},
      result:{baseCents:result.baseCents,discountCents:result.discountCents,subtotalCents:result.subtotalCents,taxCents:result.taxCents,totalCents:result.totalCents,lines:[]},projectId:null};
    const quote=Q.create({id:original.id,firmId,actor,at:migratedAt,content});
    return freeze({migrationVersion:1,sourceApp:'hengdu-audit-quote',sourceId:original.id,firmId,original,quote});
  }
  // Existing entries are migration envelopes, not arbitrary records. Preserve revisions on a repeat.
  function preview({legacyRecords,existing=[],firmId,actor,migratedAt}){
    if(!Array.isArray(legacyRecords)||!Array.isArray(existing))throw Error('迁移输入必须是记录数组');
    required(firmId,'事务所编号');required(actor,'迁移操作人');required(migratedAt,'迁移时间');
    const seen=new Set(),existingById=new Map();
    for(const e of existing){
      if(!e||e.migrationVersion!==1||e.firmId!==firmId||e.sourceId!==e.quote?.id||e.firmId!==e.quote?.firmId||existingById.has(e.sourceId))throw Error('既有迁移记录或事务所不匹配');
      const rebuilt=toOne(e.original,firmId,e.quote.revisions?.[0]?.createdBy,e.quote.revisions?.[0]?.createdAt);
      Q.validateRecord(e.quote);
      if(JSON.stringify(rebuilt.quote.revisions[0])!==JSON.stringify(e.quote.revisions[0]))throw Error('既有迁移记录的首版与原始记录不一致');
      existingById.set(e.sourceId,json(e));
    }
    const added=[],unchanged=[],errors=[];
    for(const raw of legacyRecords){
      try{
        const entry=toOne(raw,firmId,actor,migratedAt);
        if(seen.has(entry.sourceId))throw Error('原记录编号重复');seen.add(entry.sourceId);
        const prior=existingById.get(entry.sourceId);
        if(prior){if(JSON.stringify(prior.original)!==JSON.stringify(entry.original))throw Error('报价编号冲突，原始内容不同');unchanged.push(prior);}
        else added.push(entry);
      }catch(e){errors.push({sourceId:typeof raw?.id==='string'?raw.id:null,reason:String(e.message)});}
    }
    // Any conflict blocks the entire batch. Unconvertible originals remain with the caller.
    return freeze({ok:errors.length===0,added:errors.length?[]:added,unchanged:errors.length?[]:unchanged,errors,sourceRetainedByCaller:true});
  }
  const api={preview};root.QuoteMigration=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
