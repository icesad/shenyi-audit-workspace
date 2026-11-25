'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {source}=require('./helpers/project-access-fixture.cjs');
test('large import permits bound per-user and per-database work through idempotent release',async()=>{
 const {acquireLedgerImportPermit:take}=await source('ledger-check-import-budget.mjs'),db={},other={};
 const a=take(db,'a');assert.throws(()=>take(db,'a'),e=>e.status===429&&e.code==='LEDGER_IMPORT_BUSY');const b=take(db,'b');assert.throws(()=>take(db,'c'),e=>e.status===429);
 const independent=take(other,'c');a();a();const c=take(db,'c');assert.throws(()=>take(db,'d'),e=>e.status===429);b();c();independent();const again=take(db,'a');again();
});
