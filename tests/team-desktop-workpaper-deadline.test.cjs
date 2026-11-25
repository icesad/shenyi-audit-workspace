const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {workpaperTimeoutMilliseconds:budget}=require('../desktop/workpaper-transport.cjs');
const {fixture,restorePasswordWork}=require('./helpers/workpaper-desktop-root-fixture.cjs');
const {holdOfficeResult}=require('./helpers/workpaper-form-fixture.cjs');
after(restorePasswordWork);
const base='/api/teams/team-a/projects/project-a/workpapers',hash='a'.repeat(64),id='11111111-1111-4111-8111-111111111111',query='?version=1&projectRevision=2&grantRevision=3';
test('only exact heavy workpaper operations get a longer response budget',()=>{
 for(const [kind,suffix]of [['record','/record'],['original','/originals/'+hash],['form','/forms/'+hash]])assert.equal(budget(base+suffix+query,{kind}),90000);
 assert.equal(budget(base+'/entries/'+hash,{kind:'json',method:'POST'}),90000);assert.equal(budget(base+'/imports/'+id+'/commit',{kind:'json',method:'POST'}),180000);assert.equal(budget(base+'/export'+query,{kind:'export'}),1800000);
 for(const [route,options]of [[base+'/access',{kind:'json'}],['/api/auth/session',{kind:'form'}],[base+'/forms/'+hash+query+'&extra=1',{kind:'form'}],[base+'/record'+query+'\n',{kind:'record'}],[base+'/record'+query,{kind:'record',method:'POST'}],[base+'/imports/'+id+'/chunks/0',{kind:'json',method:'PUT'}],[base+'/imports/'+id+'/commit',{kind:'form',method:'POST'}]])assert.equal(budget(route,options),15000);
});
test('a genuine admitted Office result held beyond the old15s cap still reaches the actual signed main client',{timeout:35000},async t=>{
 const f=await fixture(t,{originalForm:true}),before=f.dataRows(),hold=holdOfficeResult(t);let settled=false;const pending=f.client.getWorkpaperForm({...f.query(),sha256:f.document.sha256});pending.then(()=>{settled=true;},()=>{settled=true;});assert.equal(await hold.entered,f.document.sha256);await new Promise(resolve=>setTimeout(resolve,16000));assert.equal(settled,false,'valid Office work must not be canceled at the old15s limit');hold.release();const response=await pending;assert.equal(response.form.sha256,f.document.sha256);assert.deepEqual(f.dataRows(),before);
});
test('the longer Office budget still honors an explicit abort while the real worker result is held',{timeout:20000},async t=>{
 const f=await fixture(t,{originalForm:true}),hold=holdOfficeResult(t),controller=new AbortController(),pending=f.client.getWorkpaperForm({...f.query(),sha256:f.document.sha256},{signal:controller.signal});pending.catch(()=>{});assert.equal(await hold.entered,f.document.sha256);controller.abort();await assert.rejects(pending,{code:'WORKPAPER_CANCELED'});hold.release();
});
