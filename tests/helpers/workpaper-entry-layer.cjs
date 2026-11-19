'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const RPC=Object.freeze([
 ['openWorkpaperView','workpaper-view-open'],['closeWorkpaperView','workpaper-view-close'],['listWorkpaperProjects','workpaper-projects'],['getWorkpaperAccess','workpaper-access'],['listWorkpaperMembers','workpaper-members'],['changeWorkpaperAccess','workpaper-access-change'],['getWorkpaperData','workpaper-data'],['listWorkpaperVersions','workpaper-versions'],['getWorkpaperRecord','workpaper-record'],['getWorkpaperForm','workpaper-form'],['saveWorkpaperEntries','workpaper-entries-save'],['getWorkpaperReceipt','workpaper-receipt'],['chooseWorkpaperSource','workpaper-source-open'],['confirmWorkpaperImport','workpaper-source-confirm'],['resumeWorkpaperImport','workpaper-source-resume'],['queryWorkpaperImport','workpaper-import-query'],['cancelWorkpaperSourceImport','workpaper-import-cancel'],['discardWorkpaperSource','workpaper-source-discard'],['exportWorkpapers','workpaper-export'],['cancelWorkpaperExport','workpaper-export-cancel']
]);
const BILLING_RPC=Object.freeze([
 ['getBillingAccess','billing-access'],['getBillingOverview','billing-overview'],['listBillingOrders','billing-orders'],['getBillingOrder','billing-order-read'],
 ['createBillingOrder','billing-order-create'],['reconcileBillingOrder','billing-order-reconcile']
]);
const BILLING_BATCH_RPC=Object.freeze([['reconcileBillingPage','billing-page-reconcile']]);
const REFUND_INTAKE_RPC=Object.freeze([['getRefundIntakeAccess','refund-intake-access'],['getRefundIntake','refund-intake-read'],
 ['recordRefundIntake','refund-intake-record']]);
const WEBSITE_CHECKOUT_RPC=Object.freeze([['openWebsiteCheckout','website-checkout-open']]);
const ADDED_RPC=Object.freeze([...RPC,...BILLING_RPC,...BILLING_BATCH_RPC,...REFUND_INTAKE_RPC,...WEBSITE_CHECKOUT_RPC]);
const digest=names=>createHash('sha256').update(names.join('\n')).digest('hex');
function oldNames(names,suffix,baseline,{allowHistorical=false}={}){
 assert.equal(names.length,allowHistorical&&names.length===135?135:135+suffix.length);
 assert.equal(digest(names.slice(0,135)),baseline,'The full original 135 operations must retain their exact names and order');
 assert.deepEqual(names.slice(135),names.length===135?[]:suffix);
 return names.slice(0,135);
}
function workpaperOldApiNames(api,options){return oldNames(Object.keys(api),ADDED_RPC.map(x=>x[0]),'bf32a639b6956ae133c8879f774d2fe40c9ffcf5a30216c7b56c0c75c01a5fd9',options);}
function workpaperOldApi(api){return Object.freeze(Object.fromEntries(workpaperOldApiNames(api).map(name=>[name,api[name]])));}
function workpaperOldChannelNames(handlers,options){return oldNames([...handlers.keys()],ADDED_RPC.map(x=>'shenyi:'+x[1]),'5ea6cae22b7b5ef71d3c844dd3851a20a1638fccbca566d42bc91c71300eff38',options);}
function workpaperDomLayer(doc,{allowAbsent=false}={}){
 const assets=['workpaper-sheets.js','workpaper-original-sheet.js','workpaper-original-word.js','workpapers.js'];
 const signatures=doc.querySelectorAll('[id^="workpaper-"],script[src^="workpaper"],link[href="workpapers.css"]');
 if(allowAbsent&&signatures.length===0)return {forms:0,passwords:0};
 const panel=doc.getElementById('workpaper-panel');assert.ok(panel,'The new workpaper layer must be complete');
 const ids=[...doc.querySelectorAll('[id^="workpaper-"]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length,'Workpaper IDs must be globally unique');
 assert.deepEqual([...doc.querySelectorAll('form[id^="workpaper-"]')].map(n=>n.id),['workpaper-grant-form','workpaper-import-form']);
 assert.deepEqual([...panel.querySelectorAll('form')].map(n=>n.id),['workpaper-grant-form','workpaper-import-form']);
 assert.deepEqual([...panel.querySelectorAll('input[type=password]')].map(n=>n.id),['workpaper-grant-password','workpaper-import-password']);
 for(const node of panel.querySelectorAll('input[type=password]')){assert.equal(node.autocomplete,'current-password');assert.equal(node.maxLength,512);}
 for(const kind of ['grant','import']){const input=doc.getElementById('workpaper-'+kind+'-password');assert.equal(input.form,doc.getElementById('workpaper-'+kind+'-form'));}
 assert.deepEqual([...doc.querySelectorAll('script[src^="workpaper"]')].map(n=>n.getAttribute('src')),assets);
 for(const src of assets)assert.equal(doc.querySelectorAll('script[src="'+src+'"]').length,1);
 assert.equal(doc.querySelectorAll('link[rel=stylesheet][href="workpapers.css"]').length,1);
 return {forms:2,passwords:2};
}
function refundIntakeDomLayer(doc,{allowAbsent=false}={}){
 const required=doc.querySelectorAll('[id^="refund-intake-"],script[src="refund-intake.js"]');
 if(allowAbsent&&!required.length)return 0;
 const panel=doc.getElementById('refund-intake-panel');assert.ok(panel);
 assert.equal(doc.querySelectorAll('script[src="refund-intake.js"]').length,1);
 assert.equal(new Set([...doc.querySelectorAll('[id^="refund-intake-"]')].map(node=>node.id)).size,required.length-1);
 const passwords=[...panel.querySelectorAll('input[type=password]')];
 assert.deepEqual(passwords.map(node=>node.id),['refund-intake-password']);
 assert.equal(passwords[0].autocomplete,'current-password');assert.equal(passwords[0].maxLength,512);
 assert.equal(panel.querySelectorAll('form').length,0);
 return 1;
}
module.exports={RPC,BILLING_RPC,BILLING_BATCH_RPC,REFUND_INTAKE_RPC,WEBSITE_CHECKOUT_RPC,ADDED_RPC,workpaperOldApiNames,workpaperOldApi,workpaperOldChannelNames,workpaperDomLayer,refundIntakeDomLayer};
