'use strict';
// Main-process-only OS protected device identity. Never expose this object by IPC.
const fs=require('node:fs/promises'),{constants}=require('node:fs'),path=require('node:path');
const {generateKeyPairSync,createPrivateKey,createPublicKey,randomUUID,sign,timingSafeEqual}=require('node:crypto');
const proof=require('../shared/device-proof.cjs');
const replacementProof=require('../shared/device-replacement-proof.cjs');
const KEY_FILE='device-identity-v1.json',MAX_FILE_BYTES=64*1024;
const messages={VAULT_UNAVAILABLE:'系统密钥保护暂不可用，无法读取设备身份。',VAULT_INVALID:'设备密钥文件无效，请保留原文件并联系管理员。',VAULT_STORAGE_FAILED:'设备密钥无法安全保存，原设备身份未被替换。',VAULT_DISPOSED:'设备密钥库已关闭。',PROOF_CONTEXT_INVALID:'设备证明上下文无效。'};
function fail(code){const error=new Error(messages[code]);error.code=code;return error;}
function exact(value,keys){return !!value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));}
function canonicalBase64(value,maximum){if(typeof value!=='string'||!value||value.length>maximum||!/^[A-Za-z0-9_-]+$/.test(value))throw fail('VAULT_INVALID');const bytes=Buffer.from(value,'base64url');if(!bytes.length||bytes.toString('base64url')!==value)throw fail('VAULT_INVALID');return bytes;}
function createDeviceKeyVault({directory,safeStorage,platform=process.platform}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||!['win32','darwin'].includes(platform))throw fail('VAULT_UNAVAILABLE');
 const root=path.resolve(directory),filename=path.join(root,KEY_FILE);let pending=null,loaded=null,disposed=false;
 function alive(){if(disposed)throw fail('VAULT_DISPOSED');}
 async function protectedStorage(){alive();if(!safeStorage||!['isAsyncEncryptionAvailable','encryptStringAsync','decryptStringAsync'].every(name=>typeof safeStorage[name]==='function'))throw fail('VAULT_UNAVAILABLE');try{if(await safeStorage.isAsyncEncryptionAvailable()!==true)throw fail('VAULT_UNAVAILABLE');}catch{throw fail('VAULT_UNAVAILABLE');}alive();}
 function publicIdentity(record){return {publicKey:record.publicKey,fingerprint:record.fingerprint};}
 function privateIdentity(encoded,publicKey,fingerprint){
  const der=canonicalBase64(encoded,64);try{if(der.length!==48)throw fail('VAULT_INVALID');const key=createPrivateKey({key:der,format:'der',type:'pkcs8'});if(key.asymmetricKeyType!=='ed25519')throw fail('VAULT_INVALID');const exported=key.export({format:'der',type:'pkcs8'});try{if(exported.length!==der.length||!timingSafeEqual(exported,der))throw fail('VAULT_INVALID');}finally{exported.fill(0);}const derived=proof.parsePublicKey(createPublicKey(key).export({format:'der',type:'spki'}).toString('base64url'));if(derived.encoded!==publicKey||derived.fingerprint!==fingerprint)throw fail('VAULT_INVALID');return {key,publicKey,fingerprint};}catch{throw fail('VAULT_INVALID');}finally{der.fill(0);}
 }
 async function readFile(){
  let entry;try{entry=await fs.lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw fail('VAULT_STORAGE_FAILED');}if(!entry.isFile()||entry.isSymbolicLink()||entry.size<1||entry.size>MAX_FILE_BYTES)throw fail('VAULT_INVALID');
  let handle;try{handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>MAX_FILE_BYTES||stat.dev!==entry.dev||stat.ino!==entry.ino)throw fail('VAULT_INVALID');const buffer=Buffer.alloc(MAX_FILE_BYTES+1);let offset=0;while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}const after=await handle.stat();if(offset>MAX_FILE_BYTES||offset!==after.size)throw fail('VAULT_INVALID');const bytes=buffer.subarray(0,offset);let file;try{file=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('VAULT_INVALID');}if(!exact(file,['version','publicKey','fingerprint','encryptedPrivateKey'])||file.version!==1)throw fail('VAULT_INVALID');const publicPart=proof.parsePublicKey(file.publicKey);if(file.fingerprint!==publicPart.fingerprint)throw fail('VAULT_INVALID');const encrypted=canonicalBase64(file.encryptedPrivateKey,MAX_FILE_BYTES);let decrypted;try{decrypted=await safeStorage.decryptStringAsync(encrypted);}catch{throw fail('VAULT_UNAVAILABLE');}finally{encrypted.fill(0);}alive();if(!decrypted||typeof decrypted.result!=='string'||typeof decrypted.shouldReEncrypt!=='boolean')throw fail('VAULT_INVALID');const identity=privateIdentity(decrypted.result,file.publicKey,file.fingerprint);return {...identity,privateEncoded:decrypted.result,shouldReEncrypt:decrypted.shouldReEncrypt,bytes:Buffer.from(bytes)};
  }catch(error){if(Object.hasOwn(messages,error?.code))throw error;throw fail('VAULT_INVALID');}finally{if(handle)try{await handle.close();}catch{throw fail('VAULT_STORAGE_FAILED');}}
 }
 async function encryptedFile(record,privateEncoded){
  let encrypted;try{encrypted=await safeStorage.encryptStringAsync(privateEncoded);alive();if(!Buffer.isBuffer(encrypted)||encrypted.length<1)throw fail('VAULT_UNAVAILABLE');const bytes=Buffer.from(JSON.stringify({version:1,publicKey:record.publicKey,fingerprint:record.fingerprint,encryptedPrivateKey:encrypted.toString('base64url')})+'\n','utf8');if(bytes.length>MAX_FILE_BYTES)throw fail('VAULT_STORAGE_FAILED');return bytes;}catch(error){if(Object.hasOwn(messages,error?.code))throw error;throw fail('VAULT_UNAVAILABLE');}finally{if(Buffer.isBuffer(encrypted))encrypted.fill(0);}
 }
 async function temporary(bytes,action){
  const temp=path.join(root,KEY_FILE+'.tmp-'+randomUUID());let handle,created=false;try{handle=await fs.open(temp,'wx',0o600);created=true;await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;alive();return await action(temp);}finally{await handle?.close();if(created)try{await fs.unlink(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 async function createNew(){
  const pair=generateKeyPairSync('ed25519'),publicPart=proof.parsePublicKey(pair.publicKey.export({format:'der',type:'spki'}).toString('base64url')),record={key:pair.privateKey,publicKey:publicPart.encoded,fingerprint:publicPart.fingerprint},der=pair.privateKey.export({format:'der',type:'pkcs8'});let privateEncoded;try{privateEncoded=der.toString('base64url');}finally{der.fill(0);}const bytes=await encryptedFile(record,privateEncoded);let published;
  try{published=await temporary(bytes,async temp=>{try{await fs.link(temp,filename);return true;}catch(error){if(error.code==='EEXIST')return false;throw error;}});}catch(error){if(Object.hasOwn(messages,error?.code))throw error;throw fail('VAULT_STORAGE_FAILED');}alive();if(published)return record;const existing=await readFile();if(!existing)throw fail('VAULT_STORAGE_FAILED');return refreshEncryption(existing);
 }
 async function refreshEncryption(existing){
  if(!existing.shouldReEncrypt)return {key:existing.key,...publicIdentity(existing)};
  const bytes=await encryptedFile(existing,existing.privateEncoded);
  try{await temporary(bytes,async temp=>{const current=await readFile();if(!current||current.publicKey!==existing.publicKey||current.fingerprint!==existing.fingerprint||!current.bytes.equals(existing.bytes))throw fail('VAULT_STORAGE_FAILED');alive();await fs.rename(temp,filename);});}catch(error){if(Object.hasOwn(messages,error?.code))throw error;throw fail('VAULT_STORAGE_FAILED');}
  return {key:existing.key,...publicIdentity(existing)};
 }
 async function initialize(){
  alive();if(loaded)return loaded;if(!pending){const operation=(async()=>{await protectedStorage();try{await fs.mkdir(root,{recursive:true,mode:0o700});const entry=await fs.lstat(root);if(!entry.isDirectory()||entry.isSymbolicLink())throw fail('VAULT_STORAGE_FAILED');}catch{throw fail('VAULT_STORAGE_FAILED');}const existing=await readFile(),record=existing?await refreshEncryption(existing):await createNew();alive();loaded=record;return record;})();pending=operation;void operation.finally(()=>{if(pending===operation)pending=null;}).catch(()=>{});}return pending;
 }
 function contextMatches(fields,context,keys,record){
  if(!exact(context,keys)||!fields||Object.getPrototypeOf(fields)!==Object.prototype)throw fail('PROOF_CONTEXT_INVALID');let binding;try{binding=proof.sessionBinding(context.sessionToken);}catch{throw fail('PROOF_CONTEXT_INVALID');}for(const name of keys.filter(value=>value!=='sessionToken'&&value!=='keyFingerprint'))if(fields[name]!==context[name])throw fail('PROOF_CONTEXT_INVALID');if(fields.sessionBinding!==binding||context.keyFingerprint!==undefined&&context.keyFingerprint!==record.fingerprint||fields.keyFingerprint!==undefined&&fields.keyFingerprint!==record.fingerprint)throw fail('PROOF_CONTEXT_INVALID');
 }
 async function signChallenge(fields,context){const record=await initialize();alive();try{contextMatches(fields,context,['purpose','serverId','userId','sessionToken','bindingRevision'],record);if(fields.keyFingerprint!==record.fingerprint)throw fail('PROOF_CONTEXT_INVALID');const bytes=proof.challengeBytes(fields);return sign(null,bytes,record.key).toString('base64url');}catch{throw fail('PROOF_CONTEXT_INVALID');}}
 async function signRequest(fields,context){const record=await initialize();alive();try{contextMatches(fields,context,['serverId','userId','sessionToken','deviceId','bindingRevision','leaseId','keyFingerprint'],record);const bytes=proof.requestProofBytes(fields);return sign(null,bytes,record.key).toString('base64url');}catch{throw fail('PROOF_CONTEXT_INVALID');}}
 async function signReplacementChallenge(fields,context){const record=await initialize();alive();try{contextMatches(fields,context,['purpose','serverId','userId','sessionToken','oldDeviceId','oldBindingRevision','oldBindingStatus','requestId','requestRevision'],record);if(fields.keyFingerprint!==record.fingerprint)throw fail('PROOF_CONTEXT_INVALID');const bytes=replacementProof.replacementChallengeBytes(fields);return sign(null,bytes,record.key).toString('base64url');}catch{throw fail('PROOF_CONTEXT_INVALID');}}
 return Object.freeze({async getPublicIdentity(){const record=await initialize();alive();return publicIdentity(record);},signChallenge,signRequest,signReplacementChallenge,dispose(){disposed=true;loaded=null;}});
}
module.exports={createDeviceKeyVault};
