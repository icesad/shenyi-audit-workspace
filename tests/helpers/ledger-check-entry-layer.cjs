'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {workpaperOldApiNames,workpaperOldChannelNames,workpaperDomLayer,refundIntakeDomLayer}=require('./workpaper-entry-layer.cjs');
const RPC=Object.freeze([
 ['openLedgerCheckView','ledger-check-view-open'],['closeLedgerCheckView','ledger-check-view-close'],['listLedgerCheckProjects','ledger-check-projects'],['getLedgerCheckAccess','ledger-check-access'],['listLedgerCheckMembers','ledger-check-members'],['changeLedgerCheckAccess','ledger-check-access-change'],['listLedgerCheckSnapshots','ledger-check-history'],['getLedgerCheckSnapshot','ledger-check-snapshot'],['getLedgerCheckImportReceipt','ledger-check-import-receipt'],['chooseLedgerCheckSource','ledger-check-source-open'],['confirmLedgerCheckImport','ledger-check-source-confirm'],['discardLedgerCheckSource','ledger-check-source-discard']
]);
const digest=names=>createHash('sha256').update(names.join('\n')).digest('hex');
function ledgerOldApiNames(api){const names=workpaperOldApiNames(api,{allowHistorical:true});assert.equal(names.length,135);assert.equal(digest(names.slice(0,123)),'da5fa600726b5049c0bb366189517a7b487a62fbe15c66935238c5df68394346');assert.deepEqual(names.slice(123),RPC.map(x=>x[0]));return names.slice(0,123);}
function ledgerRpcLayer(api){ledgerOldApiNames(api);return 12;}
function ledgerOldChannelNames(handlers){const names=workpaperOldChannelNames(handlers,{allowHistorical:true});assert.equal(names.length,135);assert.equal(digest(names.slice(0,123)),'fc64b1658c6c2cd759d750e52091d08a73d1d4386b489b70ba4656e70a9b4411');assert.deepEqual(names.slice(123),RPC.map(x=>'shenyi:'+x[1]));return names.slice(0,123);}
function ledgerChannelLayer(handlers){ledgerOldChannelNames(handlers);return 12;}
function ledgerDomLayer(doc){
 const panel=doc.getElementById('ledger-check-panel');assert.ok(panel,'The only allowed extra UI layer is the explicit ledger panel');
 assert.deepEqual([...panel.querySelectorAll('form')].map(n=>n.id),['ledger-check-grant-form','ledger-check-import-form']);
 assert.deepEqual([...panel.querySelectorAll('input[type=password]')].map(n=>n.id),['ledger-check-grant-password','ledger-check-import-password']);
 for(const node of panel.querySelectorAll('input[type=password]')){assert.equal(node.autocomplete,'current-password');assert.equal(node.maxLength,512);}
 assert.equal(doc.querySelectorAll('script[src="ledger-checks.js"]').length,1);return {forms:2,passwords:2};
}
function ledgerHtmlLayer(html){const {JSDOM}=require('jsdom'),dom=new JSDOM(html);try{return ledgerDomLayer(dom.window.document);}finally{dom.window.close();}}
function ledgerLegacyFormCount(doc){return doc.querySelectorAll('form').length-ledgerDomLayer(doc).forms-workpaperDomLayer(doc,{allowAbsent:true}).forms;}
function ledgerLegacySecretCount(doc){return doc.querySelectorAll('input[type=password]').length-ledgerDomLayer(doc).passwords-workpaperDomLayer(doc,{allowAbsent:true}).passwords-refundIntakeDomLayer(doc,{allowAbsent:true});}
function ledgerLegacyHtmlFormCount(html){const {JSDOM}=require('jsdom'),dom=new JSDOM(html);try{return ledgerLegacyFormCount(dom.window.document);}finally{dom.window.close();}}
function ledgerLegacyHtmlSecretCount(html){const {JSDOM}=require('jsdom'),dom=new JSDOM(html);try{return ledgerLegacySecretCount(dom.window.document);}finally{dom.window.close();}}
module.exports={RPC,ledgerOldApiNames,ledgerRpcLayer,ledgerOldChannelNames,ledgerChannelLayer,ledgerDomLayer,ledgerHtmlLayer,ledgerLegacyFormCount,ledgerLegacySecretCount,ledgerLegacyHtmlFormCount,ledgerLegacyHtmlSecretCount};
