/* Reproducible generic audit headings only; no source documents or Office metadata. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../dist/audit-template.js');
const TITLES=[
  [
    1,
    "一、综合类"
  ],
  [
    2,
    "1、营业执照"
  ],
  [
    2,
    "2、特殊行业资格相关证照"
  ],
  [
    2,
    "3、公司章程（工商备案及变更记录）"
  ],
  [
    2,
    "4、历次实收资本（股本）、资本公积变更的验资报告"
  ],
  [
    2,
    "5、享受的税收等优惠政策的相关文件"
  ],
  [
    2,
    "6、企业基本情况简介"
  ],
  [
    2,
    "7、公司董事、监事、高级管理人员、人力资源情况（公司花名册）"
  ],
  [
    2,
    "8、公司股权结构图"
  ],
  [
    2,
    "9、组织机构（管理体系）图"
  ],
  [
    2,
    "10、股东大会、董事会会议及其他重要会议记录"
  ],
  [
    2,
    "11、合同台账"
  ],
  [
    2,
    "12、涉及股权等重大事项的文件决定"
  ],
  [
    2,
    "13、以前年度的其他审计检查结论（如内审，税务查核，财产清查，汇算清缴等）"
  ],
  [
    2,
    "14、损失和潜亏证据资料参考清单"
  ],
  [
    2,
    "15、住房补贴政策及会计处理资料"
  ],
  [
    2,
    "16、被审计年度12月增值税、所得税纳税申报表"
  ],
  [
    3,
    "16.1 增值税"
  ],
  [
    3,
    "16.2 所得税"
  ],
  [
    3,
    "16.3 印花税（按季度）"
  ],
  [
    2,
    "17、近两年科目余额表（一级到末级）"
  ],
  [
    2,
    "18、序时账"
  ],
  [
    2,
    "19、全年全量开具、取得发票清单"
  ],
  [
    3,
    "19.1 全年开具发票清单"
  ],
  [
    3,
    "19.2 全年取得发票清单"
  ],
  [
    1,
    "二、业务类"
  ],
  [
    2,
    "20、货币资金"
  ],
  [
    3,
    "20.1 现金盘点表"
  ],
  [
    3,
    "20.2 全年银行对账单和余额调节表"
  ],
  [
    3,
    "20.3 已开立银行账户清单"
  ],
  [
    3,
    "20.4 征信报告（银行版）"
  ],
  [
    3,
    "20.5 注销账户销户证明资料"
  ],
  [
    3,
    "20.6 其他货币资金"
  ],
  [
    2,
    "21、应收票据"
  ],
  [
    2,
    "22、账龄分析表"
  ],
  [
    3,
    "22.1 应收账款"
  ],
  [
    3,
    "22.2 其他应收款"
  ],
  [
    3,
    "22.3 应付账款"
  ],
  [
    3,
    "22.4 其他应付款"
  ],
  [
    3,
    "22.5 预收账款"
  ],
  [
    3,
    "22.6 预付账款"
  ],
  [
    3,
    "22.7 被审计年度往来款对帐单"
  ],
  [
    2,
    "23、存货"
  ],
  [
    3,
    "23.1 进销存明细表"
  ],
  [
    3,
    "23.2 存货盘点及盘点报告--库龄表（盘点照片）"
  ],
  [
    2,
    "24、长期投资"
  ],
  [
    3,
    "24.1 投资合同协议"
  ],
  [
    3,
    "24.2 银行划款单"
  ],
  [
    3,
    "24.3 被投资单位的章程"
  ],
  [
    3,
    "24.4 验资报告"
  ],
  [
    2,
    "25、投资性房地产权属证明（发票等）"
  ],
  [
    2,
    "26、固定资产"
  ],
  [
    3,
    "26.1 房屋建筑物（房产证、购进付款发票复印件、自建房屋预决算报告、竣工验收报告书）"
  ],
  [
    3,
    "26.2 设备（行驶证、购进付款发票复印件、购进安装合同）"
  ],
  [
    3,
    "26.3 工程建设（投产文件、转资凭证、结算/决算报告）"
  ],
  [
    3,
    "26.4 固定资产台账及折旧表"
  ],
  [
    3,
    "26.5 盘点照片及报告"
  ],
  [
    2,
    "27、无形资产"
  ],
  [
    3,
    "27.1 无形资产原始金额形成的文件（权属证明、购进合同及发票）"
  ],
  [
    3,
    "27.2 无形资产明细表（含购入日期、原值、摊销表）"
  ],
  [
    2,
    "28、在建工程"
  ],
  [
    3,
    "28.1 台账"
  ],
  [
    3,
    "28.2 施工合同"
  ],
  [
    3,
    "28.3 大额采购合同"
  ],
  [
    2,
    "29、租赁合同和租赁准则的计算"
  ],
  [
    3,
    "29.1 租赁合同"
  ],
  [
    3,
    "29.2 使用权资产明细表"
  ],
  [
    3,
    "29.3 租赁负债明细表"
  ],
  [
    2,
    "30、长期待摊费用"
  ],
  [
    3,
    "30.1 初始形成相关资料"
  ],
  [
    3,
    "30.2 摊销表"
  ],
  [
    2,
    "31、待摊费用原始金额形成的文件"
  ],
  [
    2,
    "32、递延收益相关政府补助文件、摊销计算表"
  ],
  [
    2,
    "33、短、长期借款"
  ],
  [
    3,
    "33.1 借款合同"
  ],
  [
    3,
    "33.2 银行进账单"
  ],
  [
    3,
    "33.3 抵押物"
  ],
  [
    2,
    "34、应付票据明细表（应付票据存根复印件）"
  ],
  [
    2,
    "35、应付工资（3-4个月的工资表）"
  ],
  [
    2,
    "36、预提费用（重要项目的计提依据）"
  ],
  [
    2,
    "37、长期应付款（合同/协议）"
  ],
  [
    2,
    "38、资本公积（接受捐赠的实物清单或发票）"
  ],
  [
    2,
    "39、产品销售收入（合同及对账单5份）"
  ],
  [
    2,
    "40、产品销售成本（合同及对账单5份）"
  ],
  [
    2,
    "41、其他业务收支"
  ],
  [
    3,
    "41.1 其他业务成本"
  ],
  [
    4,
    "41.1.1 合同抽样"
  ],
  [
    4,
    "41.1.2 辅助核算"
  ],
  [
    3,
    "41.2 其他业务收入"
  ],
  [
    4,
    "41.2.1 合同抽样"
  ],
  [
    4,
    "41.2.2 辅助核算"
  ],
  [
    2,
    "42、费用类合同抽样"
  ],
  [
    3,
    "42.1 管理费用合同3份"
  ],
  [
    3,
    "42.2 销售费用合同3份"
  ],
  [
    2,
    "43、营业外收支（固定资产盘亏或变卖清单及处理的批准文件、罚款收据、捐赠物资清单）"
  ],
  [
    3,
    "43.1 营业外支出"
  ],
  [
    3,
    "43.2 营业外收入"
  ],
  [
    2,
    "44、关联方明细及关联方交易明细"
  ],
  [
    2,
    "45、受限资产明细表"
  ],
  [
    2,
    "46、对外担保、未决诉讼等或有事项明细"
  ],
  [
    3,
    "46.1 企查查结果"
  ],
  [
    3,
    "46.2 其他"
  ],
  [
    1,
    "三、审计中需要的其他资料"
  ],
  [
    2,
    "47、帐项调整汇总表"
  ],
  [
    3,
    "47.1 调整分录汇总表"
  ],
  [
    3,
    "47.2 总结会议纪要（签字盖章）"
  ],
  [
    2,
    "48、业务约定书（双方盖章）"
  ],
  [
    2,
    "49、与管理层和治理层的沟通（事前、事中、事后）"
  ],
  [
    2,
    "50、管理层声明书（盖章）"
  ],
  [
    2,
    "51、上一年度审计报告及试算平衡表"
  ],
  [
    2,
    "52、被审计年度未审会计报表（盖章）"
  ],
  [
    1,
    "四、审计中取得的其他资料"
  ]
];
function fixture(){
  const out=[],stack=[];
  for(const [level,title]of TITLES){stack.length=level-1;const n={id:'n'+(out.length+1),parentId:level>1?stack[level-2].id:'',level,title,description:''};out.push(n);stack.push(n);}
  const parents=new Set(out.map(n=>n.parentId));
  return out.map(n=>({...n,kind:n.level===1||parents.has(n.id)?'group':'material'}));
}
const untyped=()=>fixture().map(({kind,...n})=>n);

test('template matches every generic heading, corrected number and parent in the reproducible fixture',()=>{
 assert.equal(T.id,'audit-materials-2026-v1');assert.equal(T.label,'2026审计资料清单 · 修正版');
 assert.deepEqual(T.get(),fixture());
 assert.deepEqual(T.get().filter(n=>n.level===2).map(n=>Number(/^(\d+)、/u.exec(n.title)[1])),Array.from({length:52},(_,i)=>i+1));
 assert.equal(T.get().find(n=>n.id==='n42').title,'22.7 被审计年度往来款对帐单');
 for(const [id,title]of [['n32','20.5 注销账户销户证明资料'],['n44','23.1 进销存明细表'],['n56','26.4 固定资产台账及折旧表'],['n64','28.3 大额采购合同'],['n67','29.2 使用权资产明细表'],['n86','41.1 其他业务成本']])assert.equal(T.get().find(n=>n.id===id).title,title);
});

test('stats distinguish parent groups from materials, including the empty fourth category',()=>{
 assert.deepEqual(T.stats(),{headings:112,groups:23,materials:89,maxLevel:4,categories:[
  {id:'n1',title:'一、综合类',materials:22},{id:'n26',title:'二、业务类',materials:60},
  {id:'n103',title:'三、审计中需要的其他资料',materials:7},{id:'n112',title:'四、审计中取得的其他资料',materials:0}
 ]});
 const ns=T.get(),parents=new Set(ns.map(n=>n.parentId));
 for(const n of ns)assert.equal(n.kind,n.level===1||parents.has(n.id)?'group':'material');
 assert.equal(ns.at(-1).kind,'group');assert.equal(ns.filter(n=>n.kind==='material').length,89);
 assert.equal(ns.filter(n=>n.kind==='material'&&parents.has(n.id)).length,0);
});

test('frozen internal template and stats cannot be polluted through caller clones',()=>{
 assert.ok(Object.isFrozen(T));const before=T.get(),a=T.get(),stats=T.stats();
 assert.notEqual(a,before);assert.notEqual(a[0],before[0]);a[0].title='Changed';a[1].kind='group';a.push({});stats.categories[0].materials=-1;
 assert.deepEqual(T.get(),before);assert.equal(T.stats().categories[0].materials,22);
 const r=T.recognize(untyped());r[0].description='Caller note';assert.deepEqual(T.get(),before);
});

test('recognition accepts exact untyped or typed imports and preserves the single permitted leading note',()=>{
 assert.deepEqual(T.recognize(untyped()),fixture());assert.deepEqual(T.recognize(fixture()),fixture());
 const xs=untyped(),leading='文档前置说明（不作为资料项）\n审计资料上传';xs[0].description=leading;
 const typed=T.recognize(xs);assert.equal(typed[0].description,leading);assert.equal(typed[0].kind,'group');
 assert.deepEqual(typed.slice(1),fixture().slice(1));assert.deepEqual(T.recognize(typed),typed);assert.notEqual(typed,xs);assert.notEqual(typed[0],xs[0]);
});

test('recognition never drops custom notes, tolerates near matches, or silently changes kind/shape',()=>{
 const mutate=[
  x=>x[0].title+=' ',x=>x[1].title=x[1].title.replace('营业执照','营业执照副本'),x=>x[1].level=3,x=>x[1].parentId='n26',x=>x[1].id='custom',
  x=>[x[1],x[2]]=[x[2],x[1]],x=>x.pop(),x=>x.push({...x[0]}),x=>x[0].description='自定义备注',x=>x[1].description=' ',
  x=>x[1].description='文档前置说明（不作为资料项）\n审计资料上传',x=>x[0].description='文档前置说明（不作为资料项）\n审计资料上传\n额外备注',
  x=>x[0].note='不可丢失',x=>x[0].kind='group',x=>x.extra='不可丢失'
 ];
 for(const change of mutate){const xs=untyped();change(xs);const saved=JSON.stringify(xs);assert.equal(T.recognize(xs),null);assert.equal(JSON.stringify(xs),saved);}
 const wrong=fixture();wrong.at(-1).kind='material';assert.equal(T.recognize(wrong),null);
 for(const v of [null,undefined,{},'template',[],Array(112)])assert.equal(T.recognize(v),null);
});

test('recognition rejects accessors and extra symbols without invoking their values',()=>{
 let called=0;const x=untyped();Object.defineProperty(x[0],'title',{enumerable:true,get(){called++;return '一、综合类';}});assert.equal(T.recognize(x),null);assert.equal(called,0);
 const y=untyped();Object.defineProperty(y,'0',{enumerable:true,get(){called++;return {};}});assert.equal(T.recognize(y),null);assert.equal(called,0);
 const z=untyped();z[0][Symbol('note')]='不可丢失';assert.equal(T.recognize(z),null);
 const hidden=untyped();Object.defineProperty(hidden[0],'note',{value:'不可丢失'});assert.equal(T.recognize(hidden),null);
});

test('browser global exposes the same template without network or filesystem dependencies',()=>{
 const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/audit-template.js'),'utf8'),context);
 assert.equal(context.AuditMaterialTemplate.id,T.id);assert.deepEqual(JSON.parse(JSON.stringify(context.AuditMaterialTemplate.get())),T.get());
 assert.deepEqual(JSON.parse(JSON.stringify(context.AuditMaterialTemplate.stats())),T.stats());
});
