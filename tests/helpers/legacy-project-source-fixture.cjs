'use strict';
const C=require('../../dist/legacy-project-source.js');
function fixture(){
 const id='a3fc78ee-4052-4aa5-85d5-8b3f9ccf0471',snapshot={projectName:'合成旧正式项目',issuer:'合成委托单位',customerName:'合成被审单位',firmName:'合成事务所',auditYear:2026,quoteDate:'2026-01-01',totalCents:10600,projectType:'年度财务报表审计'},events=[['won','2026-01-01T01:00:00.000Z'],['lost','2026-01-02T01:00:00.000Z'],['won','2026-01-03T01:00:00.000Z'],['cancelled','2026-01-04T01:00:00.000Z'],['won','2026-01-05T01:00:00.000Z']].map(([outcome,recordedAt],i)=>({eventNo:i+1,outcome,recordedAt,note:'不导出报价事件备注'}));
 const currentQuote={id,createdAt:'2026-01-01T00:00:00.000Z',snapshot,events,lastEventNo:5},initiation={schemaVersion:1,quoteId:id,revision:2,source:{quoteId:id,wonEventNo:3,wonAt:events[2].recordedAt,...snapshot},form:{projectName:snapshot.projectName,initiationDate:'2026-01-03',manager:'原立项历史文字',notes:'合成旧说明保留'},createdAt:'2026-01-03T01:00:00.000Z',updatedAt:'2026-01-06T01:00:00.000Z'},identity={schemaVersion:1,projectId:id,year:2026,sequence:42,firstWonAt:events[0].recordedAt},workspace={id,rev:7,projectIdentity:identity,projectClassification:{schemaVersion:1,projectType:'专项审计'},projectRegister:{schemaVersion:1,riskLevel:'B类',manager:'登记表历史经理文字',siteTime:'',workpaperReportTime:'',preparationTime:'',preparer:'',reviewer:'',financialStatementDate:'2026-12-31'},workpaperLocks:{locked:true},archive:new Blob(['不应包含的客户原件'])};
 return {id,currentQuote,initiation,identity,workspace};
}
function source(){const {id,...input}=fixture();return C.create(input);}
module.exports={fixture,source};
