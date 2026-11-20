'use strict';
const assert = require('node:assert/strict');
const {createCipheriv, generateKeyPairSync, randomBytes, sign} = require('node:crypto');
const test = require('node:test');

const moduleReady = import('../server/team/wechat-native-notification.mjs');
const keyPair = generateKeyPairSync('rsa', {modulusLength: 2048});
const otherPair = generateKeyPairSync('rsa', {modulusLength: 2048});
const keyId = 'PUB_KEY_ID_100';
const merchantId = '1000000000';
const appId = 'wxsynthetic12345';
const orderId = 'a021e743-4e2e-41a9-b606-2a8982505001';
const merchantOrderId = orderId.replaceAll('-', '');
const apiKey = randomBytes(32);
const now = Date.parse('2026-11-20T15:29:35+08:00');
const paidAt = '2026-11-19T15:20:01+08:00';
const locked = {id:orderId, appId, merchantId, merchantOrderId, amountMinor:288000, currency:'CNY', createdAt:Date.parse(paidAt)-60_000};

function packet({tradeChanges = {}, eventChanges = {}, signatureTime = now, signingKey = keyPair.privateKey,
  aesKey = apiKey, associatedData = 'transaction', includeAssociatedData = true} = {}) {
  const payload = {
    appid: appId, mchid: merchantId, out_trade_no: merchantOrderId, transaction_id: '12340001',
    trade_type: 'NATIVE', trade_state: 'SUCCESS', success_time: paidAt,
    amount: {total:288000, payer_total:280000, currency:'CNY', payer_currency:'CNY'},
    payer: {openid:'synthetic-payer'}, attach:'metadata-not-order-authority', ...tradeChanges,
  };
  const nonce = randomBytes(6).toString('hex');
  const cipher = createCipheriv('aes-256-gcm', aesKey, Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
  const body = Buffer.from(JSON.stringify({
    id:'EV-synthetic-1', event_type:'TRANSACTION.SUCCESS', resource_type:'encrypt-resource',
    create_time:'2026-11-19T15:20:02+08:00', summary:'合成通知',
    resource:{nonce, ciphertext:ciphertext.toString('base64'), original_type:'transaction',
      algorithm:'AEAD_AES_256_GCM', ...(includeAssociatedData ? {associated_data:associatedData} : {})}, ...eventChanges,
  }, null, 2));
  const timestamp = String(signatureTime / 1000), headerNonce = 'synthetic-header-nonce';
  const signed = Buffer.concat([Buffer.from(`${timestamp}\n${headerNonce}\n`), body, Buffer.from('\n')]);
  const headers = new Headers({
    'Wechatpay-Serial':keyId, 'Wechatpay-Timestamp':timestamp, 'Wechatpay-Nonce':headerNonce,
    'Wechatpay-Signature':sign('RSA-SHA256', signed, signingKey).toString('base64'),
  });
  return {headers, body};
}

async function verifier(options = {}) {
  const {createWechatNativeNotificationVerifier} = await moduleReady;
  const lookups=[];
  const verify = createWechatNativeNotificationVerifier({appId, merchantId, apiV3Key:apiKey,
    keys:[{id:keyId,key:keyPair.publicKey}], now:()=>now, readOrder:async key=>{lookups.push(key);return locked;}, ...options});
  return {verify,lookups};
}

const rejectsAs = (promise, status) => assert.rejects(promise, {status});

test('verified Native notice matches the original order total and returns limited payment facts', async () => {
  const {verify,lookups}=await verifier();
  const input=packet();
  const expected={channel:'wechat-pay-native-v3', orderId, eventId:'EV-synthetic-1', transactionId:'12340001',
    merchantOrderId, appId, merchantId, amountMinor:288000, currency:'CNY', paidAt:Date.parse(paidAt)};
  const result=await verify(input);
  assert.deepEqual(result,expected);
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(lookups,[{appId, merchantId, merchantOrderId}]);
  assert.deepEqual(await verify(input),expected);
});

test('optional empty associated data and the exact five-minute boundary verify', async () => {
  const {verify}=await verifier();
  const input=packet({associatedData:'', includeAssociatedData:false, signatureTime:now-300000});
  input.headers.set('Wechatpay-Signature-Type','WECHATPAY2-SHA256-RSA2048');
  assert.equal((await verify(input)).paidAt,Date.parse(paidAt));
});

test('body, key, signature type and timestamp rejection all happen before any order lookup', async () => {
  const {verify,lookups}=await verifier();
  const changed=packet();
  changed.body=Buffer.concat([changed.body,Buffer.from('\n')]);
  await rejectsAs(verify(changed),401);
  const wrongKey=packet({signingKey:otherPair.privateKey});
  await rejectsAs(verify(wrongKey),401);
  wrongKey.headers.set('Wechatpay-Serial','PUB_KEY_ID_200');
  await rejectsAs(verify(wrongKey),401);
  const wrongType=packet();
  wrongType.headers.set('Wechatpay-Signature-Type','unsupported');
  await rejectsAs(verify(wrongType),401);
  const signatureProbe = packet();
  signatureProbe.headers.set('Wechatpay-Signature','WECHATPAY/SIGNTEST/synthetic');
  await rejectsAs(verify(signatureProbe),401);
  const missingNonce=packet();
  missingNonce.headers.delete('Wechatpay-Nonce');
  await rejectsAs(verify(missingNonce),401);
  const duplicatedHeader=packet();
  duplicatedHeader.headers.append('Wechatpay-Timestamp',String(now/1000));
  await rejectsAs(verify(duplicatedHeader),401);
  await rejectsAs(verify(packet({signatureTime:now-301000})),401);
  await rejectsAs(verify(packet({signatureTime:now+301000})),401);
  assert.deepEqual(lookups,[]);
});

test('a previously configured second key remains usable during key rotation', async () => {
  const {verify}=await verifier({keys:[{id:keyId,key:keyPair.publicKey},
    {id:'PUB_KEY_ID_200',key:otherPair.publicKey.export({type:'spki',format:'pem'})}]});
  const rotated=packet({signingKey:otherPair.privateKey});
  rotated.headers.set('Wechatpay-Serial','PUB_KEY_ID_200');
  assert.equal((await verify(rotated)).orderId,orderId);
});

test('the authenticated envelope still requires AES integrity and expected transaction fields', async () => {
  const {verify,lookups}=await verifier();
  for(const input of [
    packet({aesKey:randomBytes(32)}),
    packet({eventChanges:{event_type:'REFUND.SUCCESS'}}),
    packet({tradeChanges:{trade_type:'JSAPI'}}),
    packet({tradeChanges:{trade_state:'NOTPAY'}}),
    packet({tradeChanges:{success_time:'2026-11-31T15:20:01+08:00'}}),
    packet({tradeChanges:{out_trade_no:orderId}}),
    packet({tradeChanges:{amount:{total:288000,payer_total:280000,currency:'USD',payer_currency:'USD'}}}),
  ]) await rejectsAs(verify(input),400);
  assert.deepEqual(lookups,[]);
});

test('money, merchant and app are bound to the original stored order', async () => {
  const {verify,lookups}=await verifier();
  await rejectsAs(verify(packet({tradeChanges:{appid:'wxunrelatedtest'}})),409);
  await rejectsAs(verify(packet({tradeChanges:{mchid:'2000000000'}})),409);
  assert.deepEqual(lookups,[]);
  await rejectsAs(verify(packet({tradeChanges:{amount:{total:280000,payer_total:280000,currency:'CNY',payer_currency:'CNY'}}})),409);
  assert.equal(lookups.length,1);
  for(const order of [null, {...locked,merchantOrderId:'wrong-order'}, {...locked,currency:'USD'}, {...locked,merchantId:'2000000000'}]) {
    const {verify}=await verifier({readOrder:()=>order});
    await rejectsAs(verify(packet()),409);
  }
});

test('order format supports WeChat merchant order characters and rejects payments before creation', async () => {
  const alternateOrderId = 'native-|*_0123';
  const input = packet({tradeChanges:{out_trade_no:alternateOrderId}});
  const original = {...locked, merchantOrderId:alternateOrderId, createdAt:Date.parse(paidAt)+750};
  const {verify} = await verifier({readOrder:()=>original});
  assert.equal((await verify(input)).merchantOrderId,alternateOrderId);

  const later = await verifier({readOrder:()=>({...original,createdAt:Date.parse(paidAt)+1000})});
  await rejectsAs(later.verify(input),409);
});

test('future signature and payment time tolerances do not stack', async () => {
  const {verify,lookups} = await verifier();
  const notificationTime = new Date(now+599_000).toISOString();
  await rejectsAs(verify(packet({signatureTime:now+300_000, eventChanges:{create_time:notificationTime},
    tradeChanges:{success_time:notificationTime}})),400);
  assert.deepEqual(lookups,[]);
});

test('configuration rejects unsuitable signing keys and copies the AES key', async () => {
  await assert.rejects(verifier({keys:[{id:keyId,key:keyPair.privateKey}]}),TypeError);
  await assert.rejects(verifier({keys:[{id:keyId,key:keyPair.publicKey},{id:keyId,key:otherPair.publicKey}]}),TypeError);
  await assert.rejects(verifier({apiV3Key:Buffer.alloc(31)}),TypeError);
  const copy=Buffer.from(apiKey);
  const {verify}=await verifier({apiV3Key:copy});
  copy.fill(0);
  assert.equal((await verify(packet())).amountMinor,locked.amountMinor);
});
