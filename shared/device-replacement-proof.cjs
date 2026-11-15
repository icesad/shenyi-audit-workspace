'use strict';
// Replacement is a separate domain; never expand first-enrollment authority.
const proof=require('./device-proof.cjs');
const REPLACEMENT_FIELDS=Object.freeze(['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','oldDeviceId','oldBindingRevision','oldBindingStatus','requestId','requestRevision','challengeId','nonce','issuedAt','expiresAt']);
const DOMAIN=Buffer.from('SHENYI-DEVICE-REPLACEMENT\0v1\0','ascii');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,HEX=/^[a-f0-9]{64}$/;
function bad(){const error=new Error('换机设备证明资料无效。');error.code='INVALID_DEVICE_REPLACEMENT_PROOF';throw error;}
const matches=(value,pattern)=>{if(typeof value!=='string'||!pattern.test(value))bad();};
const integer=(value,minimum=0)=>{if(!Number.isSafeInteger(value)||value<minimum)bad();};
function replacementChallengeBytes(fields){
  if(!fields||Object.getPrototypeOf(fields)!==Object.prototype||Object.keys(fields).length!==REPLACEMENT_FIELDS.length||REPLACEMENT_FIELDS.some(key=>!Object.hasOwn(fields,key)))bad();
  if(!['request','withdraw','activate'].includes(fields.purpose)||!['active','revoked'].includes(fields.oldBindingStatus))bad();
  for(const key of ['serverId','oldDeviceId','requestId','challengeId'])matches(fields[key],UUID);
  matches(fields.userId,ID);matches(fields.sessionBinding,HEX);matches(fields.keyFingerprint,HEX);
  integer(fields.identityEpoch);integer(fields.oldBindingRevision,1);integer(fields.requestRevision);integer(fields.issuedAt);integer(fields.expiresAt);
  if(fields.purpose==='request'?fields.requestRevision!==0:fields.requestRevision<1)bad();
  if(fields.expiresAt-fields.issuedAt!==120000)bad();
  try{proof.nonceBytes(fields.nonce);}catch{bad();}
  return Buffer.concat([DOMAIN,Buffer.from(JSON.stringify(REPLACEMENT_FIELDS.map(key=>fields[key])),'utf8')]);
}
module.exports=Object.freeze({replacementChallengeBytes,REPLACEMENT_FIELDS});
