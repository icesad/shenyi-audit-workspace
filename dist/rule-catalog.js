(function(root){
  'use strict';
  // Pure data model, not a persistence, authorization, signature or calculator service.
  // A region code is an externally verified six-digit administrative code, not a claim
  // that this application contains or has validated an official nationwide directory.
  const STATUSES=['draft','historical_unverified','custom_unverified','approved'];
  const LEVELS=['province'];
  // Enumerates areas, not their legal scope, licensed services, fee schedules or availability.
  const PROVINCES=Object.freeze([
    ['110000','北京市'],['120000','天津市'],['130000','河北省'],['140000','山西省'],['150000','内蒙古自治区'],
    ['210000','辽宁省'],['220000','吉林省'],['230000','黑龙江省'],['310000','上海市'],['320000','江苏省'],
    ['330000','浙江省'],['340000','安徽省'],['350000','福建省'],['360000','江西省'],['370000','山东省'],
    ['410000','河南省'],['420000','湖北省'],['430000','湖南省'],['440000','广东省'],['450000','广西壮族自治区'],
    ['460000','海南省'],['500000','重庆市'],['510000','四川省'],['520000','贵州省'],['530000','云南省'],
    ['540000','西藏自治区'],['610000','陕西省'],['620000','甘肃省'],['630000','青海省'],['640000','宁夏回族自治区'],
    ['650000','新疆维吾尔自治区'],['710000','台湾省'],['810000','香港特别行政区'],['820000','澳门特别行政区']
  ].map(([code,name])=>Object.freeze({code,name,level:'province',scopePending:['710000','810000','820000'].includes(code)})));
  function check(condition,message){if(!condition)throw Error(message);}
  function text(v,label,max=500){check(typeof v==='string'&&v.trim()!==''&&v.length<=max,label+'不能为空或过长');return v.trim();}
  function date(v,label){check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v),label+'须为 YYYY-MM-DD');const d=new Date(v+'T00:00:00Z');check(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v,label+'不是有效日期');return v;}
  function jsonClone(v){
    function walk(x){if(x===null||typeof x==='string'||typeof x==='boolean')return;
      if(typeof x==='number'){check(Number.isFinite(x),'配置不得包含非有限数');return;}
      check(typeof x==='object','配置只能包含 JSON 数据');
      if(Array.isArray(x)){for(const y of x)walk(y);return;}
      check(Object.getPrototypeOf(x)===Object.prototype,'配置须为普通 JSON 对象');
      for(const [k,y] of Object.entries(x)){check(!['__proto__','constructor','prototype'].includes(k),'配置含不安全字段');walk(y);}}
    walk(v);return JSON.parse(JSON.stringify(v));
  }
  function freeze(o){if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;}
  function normalize(input){
    check(input&&typeof input==='object'&&!Array.isArray(input),'规则包必须是对象');
    const v=jsonClone(input);
    check(v.schemaVersion==='1.0','不支持的规则包结构版本');
    const id=text(v.ruleId,'规则编号',100),version=text(v.version,'版本',100),firmId=text(v.firmId,'事务所编号',100);
    check(v.region&&typeof v.region==='object','缺少地区');
    const code=text(v.region.code,'地区编码',6),name=text(v.region.name,'地区名称',100),level=v.region.level;
    check(/^\d{6}$/.test(code)&&code!=='000000','地区编码须为非零六位数字');check(LEVELS.includes(level),'地区层级无效');
    const province=PROVINCES.find(p=>p.code===code);
    check(!!province,'仅支持已列出的 34 个省级地区编码');
    // Only the official name or its ordinary suffix-stripped short name may accompany a code.
    const shortName=province.name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/,'');
    check(name===province.name||name===shortName,'地区名称与编码不一致');
    
    const auditType=text(v.auditType,'审计类型',100);check(STATUSES.includes(v.status),'规则状态无效');
    check(v.source&&typeof v.source==='object','缺少来源');const sourceTitle=text(v.source.title,'来源标题',300);
    const sourceType=v.source.type;check(['official','third_party','firm_internal','example'].includes(sourceType),'来源类型无效');
    let url=null;if(v.source.url!==null&&v.source.url!==undefined&&v.source.url!==''){url=text(v.source.url,'来源链接',2048);let u;try{u=new URL(url)}catch(_){throw Error('来源链接无效')};check(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'来源链接须为无凭据的 HTTP(S) 地址');}
    const start=date(v.effectiveFrom,'起始日期');const end=v.effectiveTo==null?null:date(v.effectiveTo,'结束日期');check(end===null||end>=start,'结束日期早于起始日期');
    check(v.review&&typeof v.review==='object','缺少审核信息');
    const reviewer=v.review.reviewer==null?'':String(v.review.reviewer).trim();const reviewedAt=v.review.reviewedAt==null?null:date(v.review.reviewedAt,'审核日期');
    if(v.status==='approved'){text(reviewer,'审核人',100);check(reviewedAt!==null,'已核定规则必须填写审核日期');check(sourceType!=='example','示例来源不能标记为已核定');}
    check(v.calculation&&typeof v.calculation==='object'&&!Array.isArray(v.calculation),'缺少计算配置');
    check(['fixed','flat','progressive','budget'].includes(v.calculation.mode),'计算模式无效');
    check(['assets','revenue','max','average','manual'].includes(v.calculation.basis),'计费基数无效');
    const notes=v.notes==null?'':String(v.notes);check(notes.length<=5000,'备注过长');
    return freeze({schemaVersion:'1.0',ruleId:id,version,firmId,region:{code,name:province.name,level},auditType,status:v.status,
      source:{type:sourceType,title:sourceTitle,url},effectiveFrom:start,effectiveTo:end,
      review:{reviewer,reviewedAt},calculation:v.calculation,notes});
  }
  function emptyCatalog(){return freeze({schemaVersion:'1.0',entries:[]});}
  function append(catalog,input){
    check(catalog&&catalog.schemaVersion==='1.0'&&Array.isArray(catalog.entries),'规则库格式无效');
    // Revalidation rejects malformed imported catalogs; no shared references are retained.
    const entries=catalog.entries.map(normalize),next=normalize(input);
    const seen=new Set();for(const e of entries){const key=JSON.stringify([e.firmId,e.ruleId,e.version]);check(!seen.has(key),'规则库存在重复版本');seen.add(key);}
    const key=JSON.stringify([next.firmId,next.ruleId,next.version]);check(!seen.has(key),'规则版本已存在，不可覆盖');
    for(const e of entries.filter(x=>x.firmId===next.firmId&&x.ruleId===next.ruleId)){
      check(e.region.code===next.region.code&&e.region.level===next.region.level&&e.auditType===next.auditType,'同一规则编号的地区或业务类型不可改变');
    }
    return freeze({schemaVersion:'1.0',entries:[...entries,next]});
  }
  function snapshot(catalog,{firmId,ruleId,version}){
    check(catalog&&catalog.schemaVersion==='1.0'&&Array.isArray(catalog.entries),'规则库格式无效');
    const hits=catalog.entries.filter(x=>x.firmId===firmId&&x.ruleId===ruleId&&x.version===version);check(hits.length===1,'规则版本不存在或不唯一');
    return normalize(hits[0]);
  }
  function lookup(catalog,{firmId,regionCode,auditType,onDate,allowedStatuses=['approved']}){
    check(catalog&&catalog.schemaVersion==='1.0'&&Array.isArray(catalog.entries),'规则库格式无效');
    text(firmId,'事务所编号',100);check(PROVINCES.some(p=>p.code===regionCode),'只支持已列出的 34 个省级地区编码');text(auditType,'审计类型',100);date(onDate,'查询日期');
    check(Array.isArray(allowedStatuses)&&allowedStatuses.length>0&&allowedStatuses.every(s=>STATUSES.includes(s)),'规则状态过滤无效');
    const matches=catalog.entries.map(normalize).filter(e=>e.firmId===firmId&&e.auditType===auditType&&allowedStatuses.includes(e.status)&&e.effectiveFrom<=onDate&&(e.effectiveTo===null||e.effectiveTo>=onDate));
    let hits=matches.filter(e=>e.region.code===regionCode),matchType='exact';

    if(!hits.length)return freeze({status:'missing',message:'该地区、事务所、业务类型和日期没有可用规则，请人工核定。',candidates:[]});
    if(hits.length>1)return freeze({status:'ambiguous',message:'存在多条适用规则，须人工选择，不自动推断最新版本。',candidates:hits});
    return freeze({status:'matched',matchType,rule:hits[0]});
  }
  // Runtime suggestions for the workbench, not the approved rules catalog above.
  const DEFAULT_ALIASES=Object.freeze({'130000':'hb','310000':'sh','450000':'gx'});
  function defaultRule(codeOrAlias,localRules=root.REGION_REFERENCE){
    if(typeof codeOrAlias!=='string'||!codeOrAlias)return null;
    const p=PROVINCES.find(x=>x.code===codeOrAlias||DEFAULT_ALIASES[x.code]===codeOrAlias);
    if(!p||!Array.isArray(localRules))return null;
    const id=DEFAULT_ALIASES[p.code]||p.code;
    const exact=localRules.find(r=>r.id===id);
    if(exact&&!p.scopePending)return jsonClone(exact);
    const hb=localRules.find(r=>r.id==='hb');
    if(!hb)return null;
    const fallback=jsonClone(hb);
    return {...fallback,id,name:p.name,...(p.code==='110000'?{
      localPolicyUrl:'https://fgw.beijing.gov.cn/fgwzwgk/2024zcwj/bwqtwj/201912/t20191226_3725998.htm',
      localPolicyNote:'京发改〔2015〕2617号将北京原收费文件列入废止目录。此处没有采用原北京费率。'
    }:{}),sourceRegionId:'hb',status:p.scopePending?'scope_reference':'fallback_historical',
      document:'借用河北 · '+hb.document,version:'借用河北 · '+hb.version,
      notes:p.scopePending
        ?'下方仅展示内地人民币测算模板；未核定当地执业范围、计价依据及币种，不计算或换算为当地报价。'
        :'尚无可核实、可直接计算的本地收费表。这里预填河北历史口径，仅供内部测算，不代表'+p.name+'收费标准。'+hb.notes};
  }
  const api={defaultRule,STATUSES:Object.freeze(STATUSES),PROVINCES,normalize,emptyCatalog,append,snapshot,lookup};root.RuleCatalog=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
