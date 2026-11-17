'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,until,deferred,fail,Q}=require('./helpers/ledger-check-ui-fixture.cjs');
const saved=()=>({id:randomUUID(),version:1,sourceProjectId:Q,sourceSha256:'a'.repeat(64),workspaceRevision:3,calculatedAt:'2026-11-17T00:00:00.000Z',confirmedBy:'Synthetic owner',importedAt:1000});
test('a fresh revoked read status never leaves the previous granted claim visible',async t=>{
 const f=fixture(t,{read:true,owner:false,records:[saved()]});await f.open();await f.select();
 f.d.querySelector('#ledger-check-history button').click();await until(()=>!f.id('viewer').hidden&&!f.id('refresh').disabled);
 assert.match(f.id('permission').textContent,/已获得/);f.state.read=false;f.state.grantRevision++;f.poll();
 await until(()=>f.id('viewer').hidden&&!f.id('refresh').disabled);assert.equal(f.id('data').textContent,'');assert.equal(f.id('records').hidden,true);
 assert.doesNotMatch(f.id('permission').textContent,/已获得/);assert.match(f.id('permission').textContent,/尚未获得/);
});
test('a failed held body clears both saved data and the previous granted claim',async t=>{
 const entered=deferred(),release=deferred();const f=fixture(t,{read:true,owner:false,records:[saved()],overrides:{getLedgerCheckSnapshot:async()=>{entered.resolve();await release.promise;return fail('HTTP_404','Current record is inaccessible');}}});
 await f.open();await f.select();assert.match(f.id('permission').textContent,/已获得/);f.d.querySelector('#ledger-check-history button').click();await entered.promise;release.resolve();
 await until(()=>!f.id('refresh').disabled);assert.equal(f.id('data').textContent,'');assert.equal(f.id('records').hidden,true);assert.equal(f.id('viewer').hidden,true);
 assert.doesNotMatch(f.id('permission').textContent,/已获得/);assert.match(f.id('permission').textContent,/尚未确认/);
});
