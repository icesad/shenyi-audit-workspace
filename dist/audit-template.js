/* General audit-material template. Categories and upload materials are explicit, not inferred by the UI. */
(function(root){
  'use strict';
  const ID='audit-materials-2026-v1',LABEL='2026审计资料清单 · 修正版';
  const LEADING='文档前置说明（不作为资料项）\n审计资料上传';
  const clone=x=>JSON.parse(JSON.stringify(x));
  function freeze(value){
    if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;
  }
  const NODES=freeze([
  {
    "id":"n1",
    "parentId":"",
    "level":1,
    "title":"一、综合类",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n2",
    "parentId":"n1",
    "level":2,
    "title":"1、营业执照",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n3",
    "parentId":"n1",
    "level":2,
    "title":"2、特殊行业资格相关证照",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n4",
    "parentId":"n1",
    "level":2,
    "title":"3、公司章程（工商备案及变更记录）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n5",
    "parentId":"n1",
    "level":2,
    "title":"4、历次实收资本（股本）、资本公积变更的验资报告",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n6",
    "parentId":"n1",
    "level":2,
    "title":"5、享受的税收等优惠政策的相关文件",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n7",
    "parentId":"n1",
    "level":2,
    "title":"6、企业基本情况简介",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n8",
    "parentId":"n1",
    "level":2,
    "title":"7、公司董事、监事、高级管理人员、人力资源情况（公司花名册）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n9",
    "parentId":"n1",
    "level":2,
    "title":"8、公司股权结构图",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n10",
    "parentId":"n1",
    "level":2,
    "title":"9、组织机构（管理体系）图",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n11",
    "parentId":"n1",
    "level":2,
    "title":"10、股东大会、董事会会议及其他重要会议记录",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n12",
    "parentId":"n1",
    "level":2,
    "title":"11、合同台账",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n13",
    "parentId":"n1",
    "level":2,
    "title":"12、涉及股权等重大事项的文件决定",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n14",
    "parentId":"n1",
    "level":2,
    "title":"13、以前年度的其他审计检查结论（如内审，税务查核，财产清查，汇算清缴等）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n15",
    "parentId":"n1",
    "level":2,
    "title":"14、损失和潜亏证据资料参考清单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n16",
    "parentId":"n1",
    "level":2,
    "title":"15、住房补贴政策及会计处理资料",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n17",
    "parentId":"n1",
    "level":2,
    "title":"16、被审计年度12月增值税、所得税纳税申报表",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n18",
    "parentId":"n17",
    "level":3,
    "title":"16.1 增值税",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n19",
    "parentId":"n17",
    "level":3,
    "title":"16.2 所得税",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n20",
    "parentId":"n17",
    "level":3,
    "title":"16.3 印花税（按季度）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n21",
    "parentId":"n1",
    "level":2,
    "title":"17、近两年科目余额表（一级到末级）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n22",
    "parentId":"n1",
    "level":2,
    "title":"18、序时账",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n23",
    "parentId":"n1",
    "level":2,
    "title":"19、全年全量开具、取得发票清单",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n24",
    "parentId":"n23",
    "level":3,
    "title":"19.1 全年开具发票清单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n25",
    "parentId":"n23",
    "level":3,
    "title":"19.2 全年取得发票清单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n26",
    "parentId":"",
    "level":1,
    "title":"二、业务类",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n27",
    "parentId":"n26",
    "level":2,
    "title":"20、货币资金",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n28",
    "parentId":"n27",
    "level":3,
    "title":"20.1 现金盘点表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n29",
    "parentId":"n27",
    "level":3,
    "title":"20.2 全年银行对账单和余额调节表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n30",
    "parentId":"n27",
    "level":3,
    "title":"20.3 已开立银行账户清单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n31",
    "parentId":"n27",
    "level":3,
    "title":"20.4 征信报告（银行版）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n32",
    "parentId":"n27",
    "level":3,
    "title":"20.5 注销账户销户证明资料",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n33",
    "parentId":"n27",
    "level":3,
    "title":"20.6 其他货币资金",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n34",
    "parentId":"n26",
    "level":2,
    "title":"21、应收票据",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n35",
    "parentId":"n26",
    "level":2,
    "title":"22、账龄分析表",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n36",
    "parentId":"n35",
    "level":3,
    "title":"22.1 应收账款",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n37",
    "parentId":"n35",
    "level":3,
    "title":"22.2 其他应收款",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n38",
    "parentId":"n35",
    "level":3,
    "title":"22.3 应付账款",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n39",
    "parentId":"n35",
    "level":3,
    "title":"22.4 其他应付款",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n40",
    "parentId":"n35",
    "level":3,
    "title":"22.5 预收账款",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n41",
    "parentId":"n35",
    "level":3,
    "title":"22.6 预付账款",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n42",
    "parentId":"n35",
    "level":3,
    "title":"22.7 被审计年度往来款对帐单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n43",
    "parentId":"n26",
    "level":2,
    "title":"23、存货",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n44",
    "parentId":"n43",
    "level":3,
    "title":"23.1 进销存明细表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n45",
    "parentId":"n43",
    "level":3,
    "title":"23.2 存货盘点及盘点报告--库龄表（盘点照片）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n46",
    "parentId":"n26",
    "level":2,
    "title":"24、长期投资",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n47",
    "parentId":"n46",
    "level":3,
    "title":"24.1 投资合同协议",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n48",
    "parentId":"n46",
    "level":3,
    "title":"24.2 银行划款单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n49",
    "parentId":"n46",
    "level":3,
    "title":"24.3 被投资单位的章程",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n50",
    "parentId":"n46",
    "level":3,
    "title":"24.4 验资报告",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n51",
    "parentId":"n26",
    "level":2,
    "title":"25、投资性房地产权属证明（发票等）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n52",
    "parentId":"n26",
    "level":2,
    "title":"26、固定资产",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n53",
    "parentId":"n52",
    "level":3,
    "title":"26.1 房屋建筑物（房产证、购进付款发票复印件、自建房屋预决算报告、竣工验收报告书）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n54",
    "parentId":"n52",
    "level":3,
    "title":"26.2 设备（行驶证、购进付款发票复印件、购进安装合同）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n55",
    "parentId":"n52",
    "level":3,
    "title":"26.3 工程建设（投产文件、转资凭证、结算/决算报告）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n56",
    "parentId":"n52",
    "level":3,
    "title":"26.4 固定资产台账及折旧表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n57",
    "parentId":"n52",
    "level":3,
    "title":"26.5 盘点照片及报告",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n58",
    "parentId":"n26",
    "level":2,
    "title":"27、无形资产",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n59",
    "parentId":"n58",
    "level":3,
    "title":"27.1 无形资产原始金额形成的文件（权属证明、购进合同及发票）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n60",
    "parentId":"n58",
    "level":3,
    "title":"27.2 无形资产明细表（含购入日期、原值、摊销表）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n61",
    "parentId":"n26",
    "level":2,
    "title":"28、在建工程",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n62",
    "parentId":"n61",
    "level":3,
    "title":"28.1 台账",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n63",
    "parentId":"n61",
    "level":3,
    "title":"28.2 施工合同",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n64",
    "parentId":"n61",
    "level":3,
    "title":"28.3 大额采购合同",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n65",
    "parentId":"n26",
    "level":2,
    "title":"29、租赁合同和租赁准则的计算",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n66",
    "parentId":"n65",
    "level":3,
    "title":"29.1 租赁合同",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n67",
    "parentId":"n65",
    "level":3,
    "title":"29.2 使用权资产明细表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n68",
    "parentId":"n65",
    "level":3,
    "title":"29.3 租赁负债明细表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n69",
    "parentId":"n26",
    "level":2,
    "title":"30、长期待摊费用",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n70",
    "parentId":"n69",
    "level":3,
    "title":"30.1 初始形成相关资料",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n71",
    "parentId":"n69",
    "level":3,
    "title":"30.2 摊销表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n72",
    "parentId":"n26",
    "level":2,
    "title":"31、待摊费用原始金额形成的文件",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n73",
    "parentId":"n26",
    "level":2,
    "title":"32、递延收益相关政府补助文件、摊销计算表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n74",
    "parentId":"n26",
    "level":2,
    "title":"33、短、长期借款",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n75",
    "parentId":"n74",
    "level":3,
    "title":"33.1 借款合同",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n76",
    "parentId":"n74",
    "level":3,
    "title":"33.2 银行进账单",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n77",
    "parentId":"n74",
    "level":3,
    "title":"33.3 抵押物",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n78",
    "parentId":"n26",
    "level":2,
    "title":"34、应付票据明细表（应付票据存根复印件）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n79",
    "parentId":"n26",
    "level":2,
    "title":"35、应付工资（3-4个月的工资表）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n80",
    "parentId":"n26",
    "level":2,
    "title":"36、预提费用（重要项目的计提依据）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n81",
    "parentId":"n26",
    "level":2,
    "title":"37、长期应付款（合同/协议）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n82",
    "parentId":"n26",
    "level":2,
    "title":"38、资本公积（接受捐赠的实物清单或发票）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n83",
    "parentId":"n26",
    "level":2,
    "title":"39、产品销售收入（合同及对账单5份）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n84",
    "parentId":"n26",
    "level":2,
    "title":"40、产品销售成本（合同及对账单5份）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n85",
    "parentId":"n26",
    "level":2,
    "title":"41、其他业务收支",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n86",
    "parentId":"n85",
    "level":3,
    "title":"41.1 其他业务成本",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n87",
    "parentId":"n86",
    "level":4,
    "title":"41.1.1 合同抽样",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n88",
    "parentId":"n86",
    "level":4,
    "title":"41.1.2 辅助核算",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n89",
    "parentId":"n85",
    "level":3,
    "title":"41.2 其他业务收入",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n90",
    "parentId":"n89",
    "level":4,
    "title":"41.2.1 合同抽样",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n91",
    "parentId":"n89",
    "level":4,
    "title":"41.2.2 辅助核算",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n92",
    "parentId":"n26",
    "level":2,
    "title":"42、费用类合同抽样",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n93",
    "parentId":"n92",
    "level":3,
    "title":"42.1 管理费用合同3份",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n94",
    "parentId":"n92",
    "level":3,
    "title":"42.2 销售费用合同3份",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n95",
    "parentId":"n26",
    "level":2,
    "title":"43、营业外收支（固定资产盘亏或变卖清单及处理的批准文件、罚款收据、捐赠物资清单）",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n96",
    "parentId":"n95",
    "level":3,
    "title":"43.1 营业外支出",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n97",
    "parentId":"n95",
    "level":3,
    "title":"43.2 营业外收入",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n98",
    "parentId":"n26",
    "level":2,
    "title":"44、关联方明细及关联方交易明细",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n99",
    "parentId":"n26",
    "level":2,
    "title":"45、受限资产明细表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n100",
    "parentId":"n26",
    "level":2,
    "title":"46、对外担保、未决诉讼等或有事项明细",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n101",
    "parentId":"n100",
    "level":3,
    "title":"46.1 企查查结果",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n102",
    "parentId":"n100",
    "level":3,
    "title":"46.2 其他",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n103",
    "parentId":"",
    "level":1,
    "title":"三、审计中需要的其他资料",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n104",
    "parentId":"n103",
    "level":2,
    "title":"47、帐项调整汇总表",
    "description":"",
    "kind":"group"
  },
  {
    "id":"n105",
    "parentId":"n104",
    "level":3,
    "title":"47.1 调整分录汇总表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n106",
    "parentId":"n104",
    "level":3,
    "title":"47.2 总结会议纪要（签字盖章）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n107",
    "parentId":"n103",
    "level":2,
    "title":"48、业务约定书（双方盖章）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n108",
    "parentId":"n103",
    "level":2,
    "title":"49、与管理层和治理层的沟通（事前、事中、事后）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n109",
    "parentId":"n103",
    "level":2,
    "title":"50、管理层声明书（盖章）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n110",
    "parentId":"n103",
    "level":2,
    "title":"51、上一年度审计报告及试算平衡表",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n111",
    "parentId":"n103",
    "level":2,
    "title":"52、被审计年度未审会计报表（盖章）",
    "description":"",
    "kind":"material"
  },
  {
    "id":"n112",
    "parentId":"",
    "level":1,
    "title":"四、审计中取得的其他资料",
    "description":"",
    "kind":"group"
  }
]);
  const PLAIN_KEYS=['id','parentId','level','title','description'];
  function dataObject(value,keys){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
    const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);
    if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))return null;
    return ds;
  }
  const STATS=freeze((()=>{
    const byId=new Map(NODES.map(n=>[n.id,n]));
    const categories=NODES.filter(n=>n.level===1).map(n=>({id:n.id,title:n.title,materials:0}));
    const cats=new Map(categories.map(c=>[c.id,c]));
    for(const n of NODES){if(n.kind!=='material')continue;let ancestor=n;while(ancestor.parentId)ancestor=byId.get(ancestor.parentId);cats.get(ancestor.id).materials++;}
    return {headings:NODES.length,groups:NODES.filter(n=>n.kind==='group').length,materials:NODES.filter(n=>n.kind==='material').length,
      maxLevel:Math.max(...NODES.map(n=>n.level)),categories};
  })());
  function recognize(input){
    // Only exact template imports can gain typed semantics. Extra annotations,
    // reordered headings, near matches and malformed objects stay custom data.
    if(!Array.isArray(input)||input.length!==NODES.length)return null;
    const arrayFields=Object.getOwnPropertyDescriptors(input),arrayNames=Reflect.ownKeys(arrayFields);
    if(arrayNames.length!==NODES.length+1||arrayNames.some(k=>typeof k!=='string'||k!=='length'&&!/^(?:0|[1-9]\d*)$/u.test(k)))return null;
    let typed=null;const out=[];
    for(let i=0;i<NODES.length;i++){
      const at=arrayFields[String(i)];if(!at||!at.enumerable||!Object.hasOwn(at,'value'))return null;
      const value=at.value;if(!value||typeof value!=='object')return null;
      const hasKind=Object.hasOwn(value,'kind');if(typed===null)typed=hasKind;if(typed!==hasKind)return null;
      const ds=dataObject(value,hasKind?PLAIN_KEYS.concat('kind'):PLAIN_KEYS);if(!ds)return null;
      const expected=NODES[i];
      for(const key of ['id','parentId','level','title'])if(ds[key].value!==expected[key])return null;
      if(hasKind&&ds.kind.value!==expected.kind)return null;
      const description=ds.description.value;
      if(description!==''&&!(i===0&&description===LEADING))return null;
      out.push({...expected,description});
    }
    return out;
  }
  const api=Object.freeze({id:ID,label:LABEL,get:()=>clone(NODES),stats:()=>clone(STATS),recognize});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AuditMaterialTemplate=api;
})(globalThis);
