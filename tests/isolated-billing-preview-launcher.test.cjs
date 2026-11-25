'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
const {test}=require('node:test');

const root=path.resolve(__dirname,'..');
const launcher=path.join(root,'scripts','team-isolated-preview.mjs');
const moduleAt=file=>import(pathToFileURL(path.join(root,file)).href);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('billing and ordinary isolated launchers own separate ports, descriptors, credentials and storage',async t=>{
  const {createIsolatedPreviewService}=await import(pathToFileURL(launcher).href);
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'shenyi-billing-launch-'));
  const ordinary=await createIsolatedPreviewService({rootDirectory:path.join(parent,'ordinary')});
  t.after(ordinary.close);
  const billing=await createIsolatedPreviewService({rootDirectory:path.join(parent,'billing'),billingDemo:true});
  t.after(billing.close);
  assert.notEqual(ordinary.address.port,billing.address.port);
  assert.notEqual(ordinary.context.profile.serverId,billing.context.profile.serverId);
  assert.notEqual(ordinary.context.desktopDataDirectory,billing.context.desktopDataDirectory);
  assert.notEqual(ordinary.context.deviceVaultDirectory,billing.context.deviceVaultDirectory);
  assert.equal(ordinary.cases,undefined);
  for(const service of [ordinary,billing]){
    const methods=await fetch(service.address.url+'/api/auth/methods').then(r=>r.json());
    assert.equal(methods.deviceBinding.required,true);
    assert.equal(methods.deviceBinding.serverId,service.context.profile.serverId);
  }
  await assert.rejects(fs.access(path.join(ordinary.context.directory,'billing-demo-cases.json')),{code:'ENOENT'});
  const cases=JSON.parse(await fs.readFile(path.join(billing.context.directory,'billing-demo-cases.json'),'utf8'));
  assert.deepEqual(cases,billing.cases);
  assert.deepEqual(Object.keys(cases).sort(),['annualRenewal','recordedPaymentSeat','refundSeat','seatAddition','timedOutAnnual']);
  assert.equal(new Set(Object.values(cases).map(row=>row.orderId)).size,5);
  assert.ok(Object.values(cases).every(row=>UUID.test(row.orderId)));
  const ordinaryDb=new DatabaseSync(path.join(ordinary.context.directory,'team-demo.sqlite'),{readOnly:true});
  const billingDb=new DatabaseSync(path.join(billing.context.directory,'team-demo.sqlite'),{readOnly:true});
  try{
    assert.equal(ordinaryDb.prepare("SELECT COUNT(*) AS n FROM team_users WHERE user_id IN ('billing-admin-demo','refund-owner-demo')").get().n,0);
    const {readAnnualOrder}=await moduleAt('server/team/billing-store.mjs');
    const {readSeatOrder}=await moduleAt('server/team/seat-order-store.mjs');
    for(const name of ['annualRenewal','timedOutAnnual']){
      assert.equal(cases[name].kind,'annual');
      assert.equal(readAnnualOrder(billingDb,'team-a',cases[name].orderId).status,'pending');
    }
    for(const name of ['seatAddition','refundSeat','recordedPaymentSeat'])assert.equal(cases[name].kind,'seat');
    assert.equal(readSeatOrder(billingDb,'team-a',cases.seatAddition.orderId).status,'pending');
    assert.equal(readSeatOrder(billingDb,'team-a',cases.refundSeat.orderId).status,'paid');
    const recorded=readSeatOrder(billingDb,'team-a',cases.recordedPaymentSeat.orderId);
    assert.equal(recorded.status,'payment-verified');
    assert.equal(recorded.quantity,1);
    assert.equal(recorded.confirmedAt,recorded.createdAt+1000);
    assert.equal(recorded.grant,null);
    const {readSeatCapacity}=await moduleAt('server/team/seat-capacity-store.mjs');
    assert.equal(readSeatCapacity(billingDb,'team-a',recorded.confirmedAt).purchasedSeats,8);
    assert.equal(billingDb.prepare("SELECT COUNT(*) AS n FROM team_operators WHERE team_id='team-a' AND user_id='billing-admin-demo' AND status='active'").get().n,1);
    assert.equal(billingDb.prepare("SELECT COUNT(*) AS n FROM team_billing_refund_intake_reviewers WHERE user_id='refund-owner-demo' AND status='active'").get().n,1);
  }finally{ordinaryDb.close();billingDb.close();}
  await billing.close();
  await billing.close();
  const closed=JSON.parse(await fs.readFile(path.join(billing.context.directory,'closed.json'),'utf8'));
  assert.equal(closed.candidateId,billing.context.candidateId);
  assert.equal(billing.server.listening,false);
  assert.equal(ordinary.server.listening,true);
});

test('billing CLI rejects extra arguments without reading a caller data path',()=>{
  const result=spawnSync(process.execPath,[launcher,'--billing-demo','--data-dir','not-an-authorized-directory'],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/--billing-demo/);
  assert.equal(result.stdout,'');
});
