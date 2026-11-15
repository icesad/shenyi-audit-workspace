'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {generateKeyPairSync,sign,verify,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path');
const base=require('../shared/device-proof.cjs'),replacement=require('../shared/device-replacement-proof.cjs');
const {createDeviceKeyVault}=require('../desktop/device-key-vault.cjs');
const UUIDS=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const TOKEN=Buffer.alloc(32,5).toString('base64url');
const fields=(purpose='request')=>({purpose,serverId:UUIDS[0],userId:'intern-a',sessionBinding:base.sessionBinding(TOKEN),keyFingerprint:'a'.repeat(64),identityEpoch:7,oldDeviceId:UUIDS[1],oldBindingRevision:2,oldBindingStatus:'revoked',requestId:UUIDS[2],requestRevision:purpose==='request'?0:2,challengeId:UUIDS[3],nonce:Buffer.alloc(32,3).toString('base64url'),issuedAt:1000000,expiresAt:1120000});
test('replacement protocol has independently specified bytes with actual NUL domain and fixed field order',()=>{
  const f=fields(),ordered=['request',UUIDS[0],'intern-a',base.sessionBinding(TOKEN),'a'.repeat(64),7,UUIDS[1],2,'revoked',UUIDS[2],0,UUIDS[3],Buffer.alloc(32,3).toString('base64url'),1000000,1120000];
  const expected=Buffer.concat([Buffer.from('SHENYI-DEVICE-REPLACEMENT','ascii'),Buffer.from([0]),Buffer.from('v1','ascii'),Buffer.from([0]),Buffer.from(JSON.stringify(ordered))]);
  assert.deepEqual(replacement.replacementChallengeBytes(f),expected);assert.equal(replacement.REPLACEMENT_FIELDS.length,15);assert.ok(Object.isFrozen(replacement.REPLACEMENT_FIELDS));assert.ok(Object.isFrozen(replacement));
  assert.deepEqual(replacement.replacementChallengeBytes(Object.fromEntries(Object.entries(f).reverse())),expected);
});
test('replacement protocol rejects alternate shapes, malformed IDs/nonces and invalid purpose/version/time states',()=>{
  const f=fields();for(const key of Object.keys(f)){const missing={...f};delete missing[key];assert.throws(()=>replacement.replacementChallengeBytes(missing));}
  for(const broken of [{...f,role:'partner'},Object.assign(Object.create({}),f),{...f,purpose:'enroll'},{...f,oldBindingStatus:'pending'},{...f,requestRevision:1},{...fields('activate'),requestRevision:0},{...f,oldBindingRevision:0},{...f,identityEpoch:Number.MAX_SAFE_INTEGER+1},{...f,userId:'../user'},{...f,serverId:'11111111-1111-1111-8111-111111111111'},{...f,nonce:f.nonce+'='},{...f,nonce:'A'.repeat(42)+'B'},{...f,keyFingerprint:'A'.repeat(64)},{...f,expiresAt:f.expiresAt+1},{...f,issuedAt:-1},{...f,sessionBinding:TOKEN}])assert.throws(()=>replacement.replacementChallengeBytes(broken));
  for(const purpose of ['request','withdraw','activate'])assert.ok(replacement.replacementChallengeBytes(fields(purpose)).length>0);
});
test('replacement signatures bind every context field and cannot authorize original enrollment or a business request',()=>{
  const pair=generateKeyPairSync('ed25519'),f=fields('activate'),bytes=replacement.replacementChallengeBytes(f),signature=sign(null,bytes,pair.privateKey);assert.equal(verify(null,bytes,pair.publicKey,signature),true);
  const changes={purpose:'withdraw',serverId:UUIDS[1],userId:'assistant-a',sessionBinding:'b'.repeat(64),keyFingerprint:'b'.repeat(64),identityEpoch:8,oldDeviceId:UUIDS[0],oldBindingRevision:3,oldBindingStatus:'active',requestId:UUIDS[1],requestRevision:3,challengeId:UUIDS[0],nonce:Buffer.alloc(32,4).toString('base64url'),issuedAt:f.issuedAt+1,expiresAt:f.expiresAt+1};
  for(const [name,value] of Object.entries(changes)){const changed={...f,[name]:value};if(['issuedAt','expiresAt'].includes(name)){assert.throws(()=>replacement.replacementChallengeBytes(changed));continue;}assert.equal(verify(null,replacement.replacementChallengeBytes(changed),pair.publicKey,signature),false,name);}
  const original={purpose:'prove',serverId:f.serverId,userId:f.userId,sessionBinding:f.sessionBinding,keyFingerprint:f.keyFingerprint,identityEpoch:f.identityEpoch,bindingRevision:f.oldBindingRevision,approvalRequestId:'',challengeId:f.challengeId,nonce:f.nonce,issuedAt:f.issuedAt,expiresAt:f.expiresAt};
  assert.equal(verify(null,base.challengeBytes(original),pair.publicKey,signature),false);
  assert.equal(verify(null,base.requestProofBytes({serverId:f.serverId,userId:f.userId,sessionBinding:f.sessionBinding,deviceId:f.oldDeviceId,bindingRevision:f.oldBindingRevision,leaseId:f.requestId,method:'POST',pathAndQuery:'/api/auth/device-replacements/activate',bodySha256:'0'.repeat(64),nonce:f.nonce}),pair.publicKey,signature),false);
  assert.throws(()=>base.challengeBytes({...original,approvalRequestId:f.requestId}));
});
test('vault signs only a fixed replacement context and persists encrypted synthetic keys without a generic signer',async t=>{
  const root=path.resolve('D:/codex-temp/shenyi-device-replacement-20261115/vault-tests');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'case-'));
  t.after(async()=>{const target=path.resolve(directory);assert.ok(target.startsWith(root+path.sep));await fs.rm(target,{recursive:true,force:true});});
  // Synthetic authenticated encryption tests the vault contract, not an OS claim.
  const wrappingKey=randomBytes(32),storage={async isAsyncEncryptionAvailable(){return true;},async encryptStringAsync(value){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',wrappingKey,nonce),body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]);},async decryptStringAsync(value){const decipher=createDecipheriv('aes-256-gcm',wrappingKey,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return {result:Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8'),shouldReEncrypt:false};}};
  const vault=createDeviceKeyVault({directory,safeStorage:storage,platform:'win32'}),identity=await vault.getPublicIdentity(),f={...fields('activate'),keyFingerprint:identity.fingerprint};
  const context={purpose:f.purpose,serverId:f.serverId,userId:f.userId,sessionToken:TOKEN,oldDeviceId:f.oldDeviceId,oldBindingRevision:f.oldBindingRevision,oldBindingStatus:f.oldBindingStatus,requestId:f.requestId,requestRevision:f.requestRevision};
  const signature=await vault.signReplacementChallenge(f,context);assert.equal(verify(null,replacement.replacementChallengeBytes(f),base.parsePublicKey(identity.publicKey).key,base.signatureBytes(signature)),true);
  for(const [name,value] of Object.entries({purpose:'withdraw',serverId:UUIDS[1],userId:'assistant-a',sessionToken:Buffer.alloc(32,6).toString('base64url'),oldDeviceId:UUIDS[0],oldBindingRevision:3,oldBindingStatus:'active',requestId:UUIDS[1],requestRevision:3}))await assert.rejects(()=>vault.signReplacementChallenge(f,{...context,[name]:value}),error=>error.code==='PROOF_CONTEXT_INVALID');
  await assert.rejects(()=>vault.signReplacementChallenge(f,{...context,rawPayload:'forbidden'}));await assert.rejects(()=>vault.signReplacementChallenge({...f,keyFingerprint:'0'.repeat(64)},context));
  assert.equal(vault.sign,undefined);assert.equal(vault.privateKey,undefined);assert.equal(vault.exportKey,undefined);
  const stored=JSON.parse(await fs.readFile(path.join(directory,'device-identity-v1.json'),'utf8'));assert.deepEqual(Object.keys(stored).sort(),['version','publicKey','fingerprint','encryptedPrivateKey'].sort());assert.equal(stored.privateKey,undefined);
  vault.dispose();await assert.rejects(()=>vault.signReplacementChallenge(f,context));
  const reopened=createDeviceKeyVault({directory,safeStorage:storage,platform:'win32'});assert.deepEqual(await reopened.getPublicIdentity(),identity);reopened.dispose();
});
