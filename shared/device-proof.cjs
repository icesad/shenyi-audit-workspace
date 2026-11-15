'use strict';
// Pure Node codec shared by the trusted server and Electron main process.
// Nothing in this module is exposed to a renderer.
const {createHash,createPublicKey}=require('node:crypto');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const CHALLENGE_FIELDS=Object.freeze(['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','bindingRevision','approvalRequestId','challengeId','nonce','issuedAt','expiresAt']);
const REQUEST_FIELDS=Object.freeze(['serverId','userId','sessionBinding','deviceId','bindingRevision','leaseId','method','pathAndQuery','bodySha256','nonce']);
const CHALLENGE_DOMAIN=Buffer.from('SHENYI-DEVICE-PROOF\0v1\0','ascii');
const REQUEST_DOMAIN=Buffer.from('SHENYI-DEVICE-REQUEST\0v1\0','ascii');
class DeviceProofError extends Error{constructor(){super('设备证明资料无效。');this.code='INVALID_DEVICE_PROOF';}}
const bad=()=>{throw new DeviceProofError();};
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))bad();}
function bytes(value,length){
 if(typeof value!=='string'||value.length!==Math.ceil(length*8/6)||!/^[A-Za-z0-9_-]+$/.test(value))bad();
 const decoded=Buffer.from(value,'base64url');if(decoded.length!==length||decoded.toString('base64url')!==value)bad();return decoded;
}
function safe(value){if(!Number.isSafeInteger(value)||value<0)bad();return value;}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))bad();}
function identifier(value){if(typeof value!=='string'||!ID.test(value))bad();}
function hex(value){if(typeof value!=='string'||!HEX.test(value))bad();}
function parsePublicKey(value){
 const der=bytes(value,44);let key;
 try{key=createPublicKey({key:der,format:'der',type:'spki'});if(key.asymmetricKeyType!=='ed25519'||!Buffer.from(key.export({format:'der',type:'spki'})).equals(der))bad();}
 catch{bad();}
 return {key,der,fingerprint:createHash('sha256').update(der).digest('hex'),encoded:value};
}
function sessionBinding(token){bytes(token,32);return createHash('sha256').update(token,'ascii').digest('hex');}
function challengeBytes(value){
 exact(value,CHALLENGE_FIELDS);
 if(!['enroll','prove','revoke'].includes(value.purpose)||value.approvalRequestId!=='')bad();
 uuid(value.serverId);identifier(value.userId);hex(value.sessionBinding);hex(value.keyFingerprint);safe(value.identityEpoch);safe(value.bindingRevision);uuid(value.challengeId);bytes(value.nonce,32);safe(value.issuedAt);safe(value.expiresAt);
 if(value.expiresAt-value.issuedAt!==120000||value.purpose==='enroll'&&value.bindingRevision!==0||value.purpose!=='enroll'&&value.bindingRevision<1)bad();
 return Buffer.concat([CHALLENGE_DOMAIN,Buffer.from(JSON.stringify(CHALLENGE_FIELDS.map(key=>value[key])),'utf8')]);
}
function requestProofBytes(value){
 exact(value,REQUEST_FIELDS);uuid(value.serverId);identifier(value.userId);hex(value.sessionBinding);uuid(value.deviceId);safe(value.bindingRevision);if(value.bindingRevision<1)bad();uuid(value.leaseId);
 if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(value.method)||typeof value.pathAndQuery!=='string'||value.pathAndQuery.length>4096||!value.pathAndQuery.startsWith('/')||value.pathAndQuery.startsWith('//')||/[^\x21-\x7e]|#/.test(value.pathAndQuery))bad();
 const parsed=new URL(value.pathAndQuery,'https://device-proof.invalid');if(parsed.origin!=='https://device-proof.invalid'||parsed.pathname+parsed.search!==value.pathAndQuery)bad();
 hex(value.bodySha256);bytes(value.nonce,32);
 return Buffer.concat([REQUEST_DOMAIN,Buffer.from(JSON.stringify(REQUEST_FIELDS.map(key=>value[key])),'utf8')]);
}
module.exports=Object.freeze({DeviceProofError,parsePublicKey,sessionBinding,challengeBytes,requestProofBytes,signatureBytes:value=>bytes(value,64),nonceBytes:value=>bytes(value,32),CHALLENGE_FIELDS,REQUEST_FIELDS});
