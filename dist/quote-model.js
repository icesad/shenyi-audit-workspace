/* Quote domain model v1. Pure data only: no storage, authentication or project creation. */
(function(root){
  'use strict';
  const SCHEMA = 1;
  const statuses = ['draft','pending_review','reviewed','sent','accepted','declined'];
  const transitions = {
    draft:['pending_review'], pending_review:['draft','reviewed'], reviewed:['draft','sent'],
    sent:['accepted','declined'], accepted:[], declined:[]
  };
  function text(v,label,max=200){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'不能为空或过长');return v.trim();}
  function optionalText(v,label,max=200){return v==null||v===''?null:text(v,label,max);}
  function ident(v,label){v=text(v,label,100);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v))throw Error(label+'格式无效');return v;}
  function cents(v,label,signed=false){if(!Number.isSafeInteger(v)||(!signed&&v<0))throw Error(label+'须为安全整数分');return v;}
  function timestamp(v){v=text(v,'操作时间',40);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('操作时间须为 UTC ISO 时间');const canonical=new Date(v).toISOString();if(canonical!==(v.includes('.')?v:v.replace('Z','.000Z')))throw Error('操作时间无效');return v;}
  function jsonCopy(v,label){
    function check(x,depth){
      if(depth>30)throw Error(label+'嵌套过深');
      if(x===null||typeof x==='string'||typeof x==='boolean')return;
      if(typeof x==='number'&&Number.isFinite(x))return;
      if(Array.isArray(x)){for(const y of x)check(y,depth+1);return;}
      if(typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
        for(const k of Object.keys(x)){if(['__proto__','constructor','prototype'].includes(k))throw Error(label+'含禁止的字段');check(x[k],depth+1);}return;
      }
      throw Error(label+'包含不可保存的值');
    }
    check(v,0);return JSON.parse(JSON.stringify(v));
  }
  function deepFreeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);Object.values(x).forEach(deepFreeze);}return x;}
  function details(input){
    if(!input||typeof input!=='object')throw Error('报价内容无效');
    const f=input.financial||{}, client=input.client||{}, rules=input.rules, adj=input.adjustment||{}, result=input.result||{};
    if(!Number.isInteger(input.auditYear)||input.auditYear<2000||input.auditYear>2100)throw Error('审计年度无效');
    if(!Array.isArray(rules)||!rules.length)throw Error('至少需要一个计费规则快照');
    const seen=new Set();
    const normalizedRules=rules.map(r=>{const ruleId=ident(r.id,'规则编号'),version=text(r.version,'规则版本',100);const key=ruleId+'|'+version;if(seen.has(key))throw Error('规则版本重复');seen.add(key);if(!r.snapshot||typeof r.snapshot!=='object'||Array.isArray(r.snapshot))throw Error('规则快照无效');return {id:ruleId,version,snapshot:jsonCopy(r.snapshot,'规则快照')};});
    if(!Number.isInteger(adj.discountBasisPoints)||adj.discountBasisPoints<0||adj.discountBasisPoints>10000)throw Error('优惠幅度无效');
    if(!Number.isInteger(adj.taxBasisPoints)||adj.taxBasisPoints<0||adj.taxBasisPoints>10000)throw Error('税率无效');
    const base=cents(result.baseCents,'基准金额'),discount=cents(result.discountCents,'优惠金额'),extra=cents(adj.extraCents,'附加费用'),subtotal=cents(result.subtotalCents,'小计'),tax=cents(result.taxCents,'税额'),total=cents(result.totalCents,'合计');
    if(discount>base||!Number.isSafeInteger(base-discount+extra)||subtotal!==base-discount+extra||!Number.isSafeInteger(subtotal+tax)||total!==subtotal+tax)throw Error('金额组成不一致');
    const calc=(amount,bp)=>Number((BigInt(amount)*BigInt(bp)+5000n)/10000n);
    if(discount!==calc(base,adj.discountBasisPoints)||tax!==calc(subtotal,adj.taxBasisPoints))throw Error('优惠或税额与比例不一致');
    const created={client:{id:optionalText(client.id,'客户编号',100),name:text(client.name,'客户名称'),location:text(client.location,'客户所在地',100)},auditYear:input.auditYear,serviceType:text(input.serviceType,'服务类型',200),financial:{assetsCents:cents(f.assetsCents,'资产总额'),revenueCents:cents(f.revenueCents,'营业收入'),netProfitCents:cents(f.netProfitCents,'净利润',true)},rules:normalizedRules,adjustment:{basis:text(adj.basis,'报价基础',100),discountBasisPoints:adj.discountBasisPoints,extraCents:extra,taxBasisPoints:adj.taxBasisPoints,reason:optionalText(adj.reason,'调整原因',2000)},result:{baseCents:base,discountCents:discount,subtotalCents:subtotal,taxCents:tax,totalCents:total,lines:jsonCopy(result.lines||[],'计算明细')},projectId:input.projectId==null?null:ident(input.projectId,'项目编号')};
    if(!Array.isArray(created.result.lines))throw Error('计算明细须为数组');
    return created;
  }
  function revision(input,n,status,actor,at){return {revisionNo:n,status,createdAt:timestamp(at),createdBy:ident(actor,'操作人'),details:details(input)};}
  function validateRecord(record){
    if(!record||record.schemaVersion!==SCHEMA)throw Error('不支持的报价模型版本');
    ident(record.id,'报价编号');ident(record.firmId,'事务所编号');
    if(!Array.isArray(record.revisions)||!record.revisions.length)throw Error('缺少报价修订');
    let previous=null;
    for(let i=0;i<record.revisions.length;i++){
      const r=record.revisions[i];if(!r||r.revisionNo!==i+1||!statuses.includes(r.status))throw Error('修订序号或状态无效');
      timestamp(r.createdAt);ident(r.createdBy,'操作人');details(r.details);
      if(i===0&&r.status!=='draft')throw Error('初始修订必须为草稿');
      if(previous){if(Date.parse(r.createdAt)<Date.parse(previous.createdAt))throw Error('修订时间不得倒退');if(r.status!=='draft'&&!transitions[previous.status].includes(r.status))throw Error('状态流转无效');if(r.status!=='draft'&&JSON.stringify(details(r.details))!==JSON.stringify(details(previous.details)))throw Error('状态变更不可修改报价内容');}
      previous=r;
    }
    return true;
  }
  function create({id,firmId,actor,at,content}){const record={schemaVersion:SCHEMA,id:ident(id,'报价编号'),firmId:ident(firmId,'事务所编号'),revisions:[revision(content,1,'draft',actor,at)]};validateRecord(record);return deepFreeze(record);}
  function append(record,{expectedRevision,actor,at,content,status}){
    validateRecord(record);const last=record.revisions.at(-1);
    if(expectedRevision!==last.revisionNo)throw Error('报价已更新，请重新读取后重试');
    if(!statuses.includes(status))throw Error('报价状态无效');
    if(status!=='draft'&&!transitions[last.status].includes(status))throw Error('状态流转无效');
    // Status changes retain the exact previous business snapshot. Editing always creates a draft.
    if(status!=='draft'&&content!==undefined)throw Error('状态变更不可同时修改报价内容');
    if(status==='draft'&&content===undefined)throw Error('新草稿必须提供报价内容');
    const next=jsonCopy(record,'报价记录');next.revisions.push(revision(status==='draft'?content:last.details,last.revisionNo+1,status,actor,at));
    validateRecord(next);return deepFreeze(next);
  }
  // This provides optimistic checking only; persistent repositories must enforce it atomically.
  function restore(value){const v=jsonCopy(value,'报价记录');validateRecord(v);return deepFreeze(v);}
  const api={SCHEMA,statuses:Object.freeze([...statuses]),create,append,restore,validateRecord};
  root.QuoteModel=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
