// Local operator tools for offline SQLite snapshots and restore rehearsals.
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {sqliteExistingFileUri} from './sqlite-existing-file.mjs';
import {SealedEnvelopeError,decryptBackupEnvelope,encryptBackupEnvelope,readBackupEnvelope,writeEnvelopeBytes} from './sealed-backup-envelope.mjs';
import {assertManagedDatabaseReady,MANAGED_REHEARSAL_MARKER} from './managed-database-readiness.mjs';

const REPOSITORY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const IDENTIFIER=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MANIFEST_MAX=1024*1024;
const BACKUP_KIND='shenyi-offline-synthetic-backup';
const REHEARSAL_KIND='shenyi-offline-synthetic-rehearsal';
const SEALED_KIND='shenyi-offline-synthetic-sealed-backup';
const MANAGED_BACKUP_KIND='shenyi-offline-managed-backup';
const MANAGED_SEALED_KIND='shenyi-offline-managed-sealed-backup';
const MANAGED_REHEARSAL_KIND='shenyi-offline-managed-rehearsal';
const SEALED_ARCHIVE='snapshot.sealed';
const MESSAGES={INVALID_INPUT:'离线备份参数无效。',RUNTIME_UNSUPPORTED:'请使用Node.js 24.15以上24.x。',SOURCE_INVALID:'源数据库的结构、服务身份或离线状态不符合本命令要求。',BUNDLE_INVALID:'离线备份工件不完整、已变化或不匹配。',BACKUP_FAILED:'离线备份未完成；已创建的本次目录保留。',RESTORE_FAILED:'离线恢复核验未完成；已创建的本次目录保留。',INVALID_BACKUP_KEY:'请使用独立保管的32字节原始备份密钥文件。',SEALED_BUNDLE_INVALID:'加密备份无法完成完整性及身份核验。'};
export class OfflineBackupError extends Error{
 constructor(code){super(MESSAGES[code]??MESSAGES.BUNDLE_INVALID);this.name='OfflineBackupError';this.code=code;}
}
const fail=code=>{throw new OfflineBackupError(code);};
export function assertOfflineBackupRuntime(version=process.versions.node){
 if(typeof version!=='string'||!/^24\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)||Number(version.split('.')[1])<15)fail('RUNTIME_UNSUPPORTED');
}
function exact(object,keys,code='BUNDLE_INVALID'){
 if(!object||Object.getPrototypeOf(object)!==Object.prototype)fail(code);
 const ds=Object.getOwnPropertyDescriptors(object),names=Reflect.ownKeys(ds);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k))||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail(code);
 return object;
}
function input(value,required,optional=[]){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail('INVALID_INPUT');
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds),allowed=[...required,...optional];
 if(keys.some(k=>typeof k!=='string'||!allowed.includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable)||required.some(k=>!Object.hasOwn(ds,k)))fail('INVALID_INPUT');
 return value;
}
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function inside(candidate,parent){const rel=path.relative(parent,candidate);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
function absolute(value,code='INVALID_INPUT'){
 if(typeof value!=='string'||!value||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value)||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||value.split(/[\\/]/).some(p=>p==='.'||p==='..'))fail(code);
 const full=path.resolve(value);
 if(process.platform==='win32'&&full.slice(path.parse(full).root.length).split(path.sep).some(p=>/[. ]$/.test(p)||p.includes(':')))fail(code);
 return full;
}
async function noLinks(directory,{allowMissing=false,code='INVALID_INPUT'}={}){
 const full=absolute(directory,code),root=path.parse(full).root;let current=root;
 for(const part of full.slice(root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);let s;
  try{s=await fs.lstat(current);}catch(error){if(error.code==='ENOENT'&&allowMissing)return;fail(code);}
  if(!s.isDirectory()||s.isSymbolicLink())fail(code);
 }
}
function state(stat){return {dev:stat.dev,ino:stat.ino,size:stat.size,mtimeNs:stat.mtimeNs,ctimeNs:stat.ctimeNs};}
const sameState=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
async function regular(filename,code){
 await noLinks(path.dirname(filename),{code});const s=await fs.lstat(filename,{bigint:true});
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size<1n||s.size>BigInt(Number.MAX_SAFE_INTEGER))fail(code);
 return s;
}
async function readManifest(filename){
 let handle;
 try{
  const entry=await regular(filename,'BUNDLE_INVALID');if(entry.size>BigInt(MANIFEST_MAX))fail('BUNDLE_INVALID');
  handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await handle.stat({bigint:true});if(!sameState(state(entry),state(before)))fail('BUNDLE_INVALID');
  const bytes=Buffer.alloc(MANIFEST_MAX+1);let length=0;
  while(length<bytes.length){const r=await handle.read(bytes,length,bytes.length-length,null);if(!r.bytesRead)break;length+=r.bytesRead;}
  if(length>MANIFEST_MAX||BigInt(length)!==before.size||length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail('BUNDLE_INVALID');
  const after=await handle.stat({bigint:true}),current=await regular(filename,'BUNDLE_INVALID');if(!sameState(state(before),state(after))||!sameState(state(before),state(current)))fail('BUNDLE_INVALID');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)),value=JSON.parse(text);
  if(text!==canonical(value))fail('BUNDLE_INVALID');return value;
 }catch(error){if(error instanceof OfflineBackupError)throw error;fail('BUNDLE_INVALID');}finally{await handle?.close();}
}
async function hashFile(filename,code='BUNDLE_INVALID'){
 let handle;
 try{
  const entry=await regular(filename,code);handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await handle.stat({bigint:true});
  if(!sameState(state(entry),state(before)))fail(code);
  const hash=createHash('sha256'),bytes=Buffer.alloc(128*1024);let length=0;
  while(true){const r=await handle.read(bytes,0,bytes.length,null);if(!r.bytesRead)break;hash.update(bytes.subarray(0,r.bytesRead));length+=r.bytesRead;if(length>Number.MAX_SAFE_INTEGER)fail(code);}
  const after=await handle.stat({bigint:true}),current=await regular(filename,code);
  if(BigInt(length)!==before.size||!sameState(state(before),state(after))||!sameState(state(before),state(current)))fail(code);
  return {byteLength:length,sha256:hash.digest('hex'),state:state(before)};
 }catch(error){if(error instanceof OfflineBackupError)throw error;fail(code);}finally{await handle?.close();}
}
function readDatabase(filename,{immutable=false}={}){
 const source=sqliteExistingFileUri(filename,'ro',{immutable});
 const db=new DatabaseSync(source,{readOnly:true,enableForeignKeyConstraints:true,allowExtension:false,timeout:5000});
 try{db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');return db;}catch(error){db.close();throw error;}
}
function identity(db,{serverId,rehearsal=false}={}){
 if(serverId!==undefined){
  try{
   if(rehearsal){
    const marker=db.prepare('SELECT value FROM main.team_database_metadata WHERE name=?').get(MANAGED_REHEARSAL_MARKER);
    const stored=db.prepare("SELECT value FROM main.team_database_metadata WHERE name='device-server-id'").get();
    if(marker?.value!=='1'||stored?.value!==serverId)fail('SOURCE_INVALID');
   }else assertManagedDatabaseReady(db,serverId);
  }catch{fail('SOURCE_INVALID');}
  return {prototypeVersion:'2',syntheticDemo:false,serverId};
 }
 const rows=db.prepare("SELECT name,value FROM team_database_metadata WHERE name IN ('prototype-version','demo','device-server-id') ORDER BY name").all();
 const values=Object.fromEntries(rows.map(row=>[row.name,row.value]));
 if(rows.length!==3||values['prototype-version']!=='2'||values.demo!=='true'||(typeof values['device-server-id']!=='string'||!UUID.test(values['device-server-id'])))fail('SOURCE_INVALID');
 return {prototypeVersion:'2',syntheticDemo:true,serverId:values['device-server-id']};
}
const canonical=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function frame(hash,tag,bytes){const size=Buffer.allocUnsafe(8);size.writeBigUInt64BE(BigInt(bytes.length));hash.update(tag);hash.update(size);hash.update(bytes);}
function typed(hash,value){
 if(value===null){frame(hash,'N',Buffer.alloc(0));return;}
 if(typeof value==='bigint'){frame(hash,'I',Buffer.from(value.toString(),'ascii'));return;}
 if(typeof value==='number'){const bytes=Buffer.allocUnsafe(8);bytes.writeDoubleBE(value);frame(hash,'R',bytes);return;}
 if(typeof value==='string'){frame(hash,'T',Buffer.from(value,'utf8'));return;}
 if(value instanceof Uint8Array){frame(hash,'B',Buffer.from(value.buffer,value.byteOffset,value.byteLength));return;}
 fail('SOURCE_INVALID');
}
function inventory(db,mode){
 const identity_=identity(db,mode),checks=db.prepare('PRAGMA integrity_check').all();
 if(checks.length!==1||checks[0].integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)fail('SOURCE_INVALID');
 const objects=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type COLLATE BINARY,name COLLATE BINARY').all();
 if(objects.some(row=>!['table','index','view','trigger'].includes(row.type)))fail('SOURCE_INVALID');
 const tableList=db.prepare('PRAGMA main.table_list').all();
 if(tableList.some(row=>row.type==='virtual'||row.type==='shadow'))fail('SOURCE_INVALID');
 const tables=tableList.filter(row=>row.type==='table'&&row.name!=='sqlite_schema').sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),digests=[];let totalRows=0;
 for(const table of tables){
  if(!IDENTIFIER.test(table.name))fail('SOURCE_INVALID');
  const columns=db.prepare('PRAGMA main.table_xinfo('+quote(table.name)+')').all(),keys=columns.filter(c=>c.pk>0).sort((a,b)=>a.pk-b.pk).map(c=>quote(c.name));
  const order=keys.length?keys.join(','):table.wr===0?'rowid':null;if(!order)fail('SOURCE_INVALID');
  const statement=db.prepare('SELECT * FROM main.'+quote(table.name)+' ORDER BY '+order);statement.setReadBigInts(true);statement.setReturnArrays(true);
  const hash=createHash('sha256');frame(hash,'C',Buffer.from(JSON.stringify(statement.columns().map(c=>c.name))));let rowCount=0;
  for(const row of statement.iterate()){
   frame(hash,'[',Buffer.alloc(0));for(const value of row)typed(hash,value);frame(hash,']',Buffer.alloc(0));rowCount++;
   if(!Number.isSafeInteger(rowCount))fail('SOURCE_INVALID');
  }
  totalRows+=rowCount;if(!Number.isSafeInteger(totalRows))fail('SOURCE_INVALID');
  digests.push({name:table.name,rowCount,rowSha256:hash.digest('hex')});
 }
 return {identity:identity_,schemaSha256:sha(JSON.stringify(objects)),tables:digests,totalRows};
}
async function noSidecars(filename){
 for(const suffix of ['-wal','-shm','-journal']){try{await fs.lstat(filename+suffix);fail('BUNDLE_INVALID');}catch(error){if(error.code!=='ENOENT')throw error;}}
}
async function standaloneSnapshot(filename){
 // A ready bundle is a single rollback-journal-format database, not a WAL set.
 // Check the header before opening SQLite so readonly verification cannot create
 // fresh WAL shared-memory sidecars for an old/nonconforming bundle.
 await noSidecars(filename);const entry=await regular(filename,'BUNDLE_INVALID');let handle;
 try{
  handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await handle.stat({bigint:true});if(!sameState(state(entry),state(before)))fail('BUNDLE_INVALID');
  const bytes=Buffer.alloc(2),read=await handle.read(bytes,0,2,18);const after=await handle.stat({bigint:true}),current=await regular(filename,'BUNDLE_INVALID');
  if(read.bytesRead!==2||bytes[0]!==1||bytes[1]!==1||!sameState(state(before),state(after))||!sameState(state(before),state(current)))fail('BUNDLE_INVALID');
 }finally{await handle?.close();}
}
async function normalizeOwnedSnapshot(filename){
 // Only a freshly allocated backup target reaches this writable connection.
 // SQLite itself checkpoints/transitions its WAL; no source pragma, initializer
 // or manual sidecar deletion participates in this operation.
 const entry=await regular(filename,'BUNDLE_INVALID');let db;
 try{
  db=new DatabaseSync(sqliteExistingFileUri(filename,'rw'),{enableForeignKeyConstraints:true,allowExtension:false,timeout:5000});db.exec('PRAGMA trusted_schema=OFF;');
  const previous=db.prepare('PRAGMA journal_mode').get().journal_mode;
  const before=previous==='delete'?null:inventory(db);
  if(db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode!=='delete')fail('BUNDLE_INVALID');
  if(before&&JSON.stringify(inventory(db))!==JSON.stringify(before))fail('BUNDLE_INVALID');
 }finally{db?.close();}
 const current=await regular(filename,'BUNDLE_INVALID');if(current.dev!==entry.dev||current.ino!==entry.ino)fail('BUNDLE_INVALID');
 await standaloneSnapshot(filename);
}
async function inspect(filename,mode,readOptions){
 const first=await hashFile(filename);let db;let value;
 try{db=readDatabase(filename,readOptions);value=inventory(db,mode);}finally{db?.close();}
 const final=await hashFile(filename);
 if(!sameState(first.state,final.state)||first.sha256!==final.sha256||first.byteLength!==final.byteLength)fail('BUNDLE_INVALID');
 return {...value,databaseBytes:first.byteLength,databaseSha256:first.sha256,_fileState:first.state};
}
async function assertInspectedFile(filename,expected){
 const actual=await hashFile(filename);
 if(actual.byteLength!==expected.databaseBytes||actual.sha256!==expected.databaseSha256||!sameState(actual.state,expected._fileState))fail('BUNDLE_INVALID');
 await standaloneSnapshot(filename);
}
async function syncRegularFile(filename){
 const entry=await regular(filename,'BUNDLE_INVALID');let handle;
 try{
  handle=await fs.open(filename,'r+');const before=await handle.stat({bigint:true});if(!sameState(state(entry),state(before)))fail('BUNDLE_INVALID');
  await handle.sync();const after=await handle.stat({bigint:true}),current=await regular(filename,'BUNDLE_INVALID');
  if(!sameState(state(before),state(after))||!sameState(state(before),state(current)))fail('BUNDLE_INVALID');
 }finally{await handle?.close();}
}
export function defaultOfflineBackupRoot({platform=process.platform,home=os.homedir()}={}){
 if(platform==='win32')return path.win32.resolve('D:/codex-temp/shenyi-team-backups');
 if(platform==='darwin')return path.posix.join(home,'Library','Application Support','ShenyiTeamOfflineBackups');
 return path.join(home,'.local','share','shenyi-team-offline-backups');
}
async function freshDirectory(outputRoot,prefix){
 const root=absolute(outputRoot??defaultOfflineBackupRoot());if(inside(root,REPOSITORY))fail('INVALID_INPUT');
 await noLinks(root,{allowMissing:true});await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root);
 const id=randomUUID(),directory=path.join(root,prefix+'-'+id);await fs.mkdir(directory,{mode:0o700});await noLinks(directory);
 return {id,directory};
}
async function publish(directory,name,value,assertReady){
 const text=canonical(value);if(Buffer.byteLength(text)>MANIFEST_MAX)fail('BUNDLE_INVALID');
 // Write, fsync and close our private temporary inode before publishing a name.
 // link is exclusive: it fails rather than replacing any pre-existing final file.
 const temporary=path.join(directory,'.'+name+'.pending-'+randomUUID()),final=path.join(directory,name);let handle;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle?.close();}
 const before=await regular(temporary,'BUNDLE_INVALID');await noLinks(directory,{code:'BUNDLE_INVALID'});await assertReady?.();await fs.link(temporary,final);
 const current=await fs.lstat(temporary,{bigint:true}),published=await fs.lstat(final,{bigint:true});
 if(!current.isFile()||current.isSymbolicLink()||!published.isFile()||published.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino||published.dev!==before.dev||published.ino!==before.ino||current.nlink!==2n||published.nlink!==2n)fail('BUNDLE_INVALID');
 // Only the exact temporary name and inode created above is removed, never a tree.
 if(!samePath(path.dirname(temporary),directory))fail('BUNDLE_INVALID');await fs.unlink(temporary);
 await regular(final,'BUNDLE_INVALID');
}
async function failure(directory,code){if(!directory)return;try{await publish(directory,'failure.json',{schemaVersion:1,kind:'shenyi-offline-operation-failed',code,failedAt:new Date().toISOString(),offlineOnly:true});}catch{}}
function manifestFor(snapshotId,value){return {schemaVersion:1,kind:value.identity.syntheticDemo?BACKUP_KIND:MANAGED_BACKUP_KIND,snapshotId,createdAt:new Date().toISOString(),identity:value.identity,database:{filename:'snapshot.sqlite',byteLength:value.databaseBytes,sha256:value.databaseSha256},inventory:{schemaSha256:value.schemaSha256,totalRows:value.totalRows,tables:value.tables},offlineOnly:true,onlineCutoverSupported:false,containsCredentials:true};}
function validateManifest(value,{serverId}={}){
 exact(value,['schemaVersion','kind','snapshotId','createdAt','identity','database','inventory','offlineOnly','onlineCutoverSupported','containsCredentials']);
 const synthetic=serverId===undefined;
 if(value.schemaVersion!==1||value.kind!==(synthetic?BACKUP_KIND:MANAGED_BACKUP_KIND)||(typeof value.snapshotId!=='string'||!UUID.test(value.snapshotId))||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||new Date(value.createdAt).toISOString()!==value.createdAt||value.offlineOnly!==true||value.onlineCutoverSupported!==false||value.containsCredentials!==true)fail('BUNDLE_INVALID');
 exact(value.identity,['prototypeVersion','syntheticDemo','serverId']);if(value.identity.prototypeVersion!=='2'||value.identity.syntheticDemo!==synthetic||(typeof value.identity.serverId!=='string'||!UUID.test(value.identity.serverId))||(!synthetic&&value.identity.serverId!==serverId))fail('BUNDLE_INVALID');
 exact(value.database,['filename','byteLength','sha256']);if(value.database.filename!=='snapshot.sqlite'||!Number.isSafeInteger(value.database.byteLength)||value.database.byteLength<1||(typeof value.database.sha256!=='string'||!SHA.test(value.database.sha256)))fail('BUNDLE_INVALID');
 exact(value.inventory,['schemaSha256','totalRows','tables']);if((typeof value.inventory.schemaSha256!=='string'||!SHA.test(value.inventory.schemaSha256))||!Number.isSafeInteger(value.inventory.totalRows)||value.inventory.totalRows<0||!Array.isArray(value.inventory.tables)||value.inventory.tables.length<1)fail('BUNDLE_INVALID');
 let previous='',rows=0;
 for(const table of value.inventory.tables){exact(table,['name','rowCount','rowSha256']);if(typeof table.name!=='string'||!IDENTIFIER.test(table.name)||table.name<=previous||!Number.isSafeInteger(table.rowCount)||table.rowCount<0||(typeof table.rowSha256!=='string'||!SHA.test(table.rowSha256)))fail('BUNDLE_INVALID');previous=table.name;rows+=table.rowCount;if(!Number.isSafeInteger(rows))fail('BUNDLE_INVALID');}
 if(rows!==value.inventory.totalRows)fail('BUNDLE_INVALID');return value;
}
function matches(value,manifest){return value.databaseBytes===manifest.database.byteLength&&value.databaseSha256===manifest.database.sha256&&JSON.stringify(value.identity)===JSON.stringify(manifest.identity)&&value.schemaSha256===manifest.inventory.schemaSha256&&value.totalRows===manifest.inventory.totalRows&&JSON.stringify(value.tables)===JSON.stringify(manifest.inventory.tables);}
function summary(kind,directory,snapshotId,value){return Object.freeze({kind,directory,databasePath:path.join(directory,'snapshot.sqlite'),snapshotId,serverId:value.identity.serverId,databaseSha256:value.databaseSha256,databaseBytes:value.databaseBytes,schemaSha256:value.schemaSha256,tableCount:value.tables.length,totalRows:value.totalRows,offlineOnly:true,onlineCutoverSupported:false,containsCredentials:true});}
async function verifyBundle(bundleDirectory){
 const directory=absolute(bundleDirectory,'BUNDLE_INVALID');await noLinks(directory,{code:'BUNDLE_INVALID'});
 try{await fs.lstat(path.join(directory,'failure.json'));fail('BUNDLE_INVALID');}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifest=validateManifest(await readManifest(path.join(directory,'manifest.json')));
 if(path.basename(directory)!=='backup-'+manifest.snapshotId)fail('BUNDLE_INVALID');
 const databasePath=path.join(directory,manifest.database.filename);await standaloneSnapshot(databasePath);
 const value=await inspect(databasePath);if(!matches(value,manifest))fail('BUNDLE_INVALID');await standaloneSnapshot(databasePath);
 // Re-read the envelope after the complete database inspection.
 if(canonical(await readManifest(path.join(directory,'manifest.json')))!==canonical(manifest))fail('BUNDLE_INVALID');
 return {directory,manifest,value};
}
async function copySnapshot(sourceDb,target,onProgress){
  let progressFailed=false;
  const reportProgress=({remainingPages,totalPages})=>{
   if(progressFailed)return;
   try{
    if(!Number.isSafeInteger(remainingPages)||!Number.isSafeInteger(totalPages)||remainingPages<0||totalPages<remainingPages)throw Error();
    const result=onProgress?.(Object.freeze({remainingPages,totalPages}));
    // SQLite's native progress callback cannot await asynchronous observers.
    // Refuse them and consume rejection rather than publishing an uncertain run.
    if(result&&typeof result.then==='function'){progressFailed=true;void Promise.resolve(result).catch(()=>{});}
   }catch{progressFailed=true;}
  };
  const copiedPages=await backup(sourceDb,sqliteExistingFileUri(target,'rw'),{progress:reportProgress});
  // Node reports intermediate batches but may omit a final native callback.
  // Completion is observed from its resolved total-page count, never a timer.
  reportProgress({remainingPages:0,totalPages:copiedPages});
  if(progressFailed)fail('BACKUP_FAILED');
}
export async function createOfflineBackup(options){
 assertOfflineBackupRuntime();const {sourceDatabase,outputRoot,onProgress}=input(options,['sourceDatabase'],['outputRoot','onProgress']);if(onProgress!==undefined&&typeof onProgress!=='function')fail('INVALID_INPUT');let directory,sourceDb;
 try{
  const source=absolute(sourceDatabase);if(inside(source,REPOSITORY))fail('INVALID_INPUT');const before=await regular(source,'SOURCE_INVALID');
  sourceDb=readDatabase(source);const sourceIdentity=identity(sourceDb);const created=await freshDirectory(outputRoot,'backup');directory=created.directory;
  const target=path.join(directory,'snapshot.sqlite');let reservation;try{reservation=await fs.open(target,'wx',0o600);await reservation.sync();}finally{await reservation?.close();}
  const reserved=await fs.lstat(target,{bigint:true});
  await copySnapshot(sourceDb,target,onProgress);sourceDb.close();sourceDb=undefined;
  const current=await regular(source,'SOURCE_INVALID'),targetStat=await regular(target,'BUNDLE_INVALID');
  if(current.dev!==before.dev||current.ino!==before.ino||targetStat.dev!==reserved.dev||targetStat.ino!==reserved.ino)fail('BUNDLE_INVALID');
  await fs.chmod(target,0o600);await normalizeOwnedSnapshot(target);await syncRegularFile(target);const value=await inspect(target);if(JSON.stringify(value.identity)!==JSON.stringify(sourceIdentity))fail('SOURCE_INVALID');
  await publish(directory,'manifest.json',manifestFor(created.id,value),()=>assertInspectedFile(target,value));return summary(BACKUP_KIND,directory,created.id,value);
 }catch(error){await failure(directory,error instanceof OfflineBackupError?error.code:'BACKUP_FAILED');if(error instanceof OfflineBackupError)throw error;fail('BACKUP_FAILED');}finally{try{sourceDb?.close();}catch{}}
}
export async function verifyOfflineBackup(options){
 assertOfflineBackupRuntime();const {bundleDirectory}=input(options,['bundleDirectory']);
 try{const {directory,manifest,value}=await verifyBundle(bundleDirectory);return summary(BACKUP_KIND,directory,manifest.snapshotId,value);}catch(error){if(error instanceof OfflineBackupError&&error.code==='INVALID_INPUT')throw error;fail('BUNDLE_INVALID');}
}
export async function rehearseOfflineRestore(options){
 assertOfflineBackupRuntime();const {bundleDirectory,outputRoot}=input(options,['bundleDirectory'],['outputRoot']);let directory;
 try{
  const checked=await verifyBundle(bundleDirectory),created=await freshDirectory(outputRoot,'rehearsal');directory=created.directory;const target=path.join(directory,'snapshot.sqlite');
  await fs.copyFile(path.join(checked.directory,'snapshot.sqlite'),target,constants.COPYFILE_EXCL);await fs.chmod(target,0o600);
  // Every writable target handle is closed before the final complete inspection.
  await syncRegularFile(target);
  const checkedAgain=await verifyBundle(checked.directory);if(canonical(checkedAgain.manifest)!==canonical(checked.manifest))fail('BUNDLE_INVALID');
  const value=await inspect(target);if(!matches(value,checked.manifest))fail('BUNDLE_INVALID');
  await publish(directory,'rehearsal.json',{schemaVersion:1,kind:REHEARSAL_KIND,rehearsalId:created.id,snapshotId:checked.manifest.snapshotId,verifiedAt:new Date().toISOString(),database:{filename:'snapshot.sqlite',byteLength:value.databaseBytes,sha256:value.databaseSha256},identity:value.identity,inventory:{schemaSha256:value.schemaSha256,totalRows:value.totalRows,tables:value.tables},offlineOnly:true,onlineCutoverSupported:false,containsCredentials:true},()=>assertInspectedFile(target,value));
  return summary(REHEARSAL_KIND,directory,checked.manifest.snapshotId,value);
 }catch(error){await failure(directory,error instanceof OfflineBackupError?error.code:'RESTORE_FAILED');if(error instanceof OfflineBackupError)throw error;fail('RESTORE_FAILED');}
}

function sealedInputPaths(bundleDirectory,keyFile,sealedInput) {
 const code=sealedInput?'SEALED_BUNDLE_INVALID':'BUNDLE_INVALID';
 const bundle=absolute(bundleDirectory,code);
 if(inside(bundle,REPOSITORY))fail(code);
 const keyPath=absolute(keyFile,'INVALID_BACKUP_KEY');
 if(inside(keyPath,REPOSITORY)||inside(keyPath,bundle))fail('INVALID_BACKUP_KEY');
 return {bundle,keyPath};
}

function sealedPaths(bundleDirectory,keyFile,outputRoot,sealedInput) {
 const {bundle,keyPath}=sealedInputPaths(bundleDirectory,keyFile,sealedInput);
 const root=absolute(outputRoot??defaultOfflineBackupRoot());
 if(inside(root,REPOSITORY)||inside(root,bundle))fail('INVALID_INPUT');
 return {bundle,keyPath,root};
}

async function openCheckedFile(filename,code) {
 let handle;
 try{
  const expected=await regular(filename,code);
  handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  const before=state(await handle.stat({bigint:true}));
  if(!sameState(state(expected),before))fail(code);
  return {handle,filename,before};
 }catch{
  await handle?.close().catch(()=>{});
  fail(code);
 }
}

async function recheckOpenFile(open,code) {
 try{
  if(!sameState(open.before,state(await open.handle.stat({bigint:true})))||
      !sameState(open.before,state(await regular(open.filename,code))))fail(code);
 }catch{fail(code);}
}

async function readKeyFile(filename) {
 let open,key;
 try{
  open=await openCheckedFile(filename,'INVALID_BACKUP_KEY');
  if(open.before.size!==32n)fail('INVALID_BACKUP_KEY');
  key=Buffer.alloc(32);
  for(let offset=0;offset<key.length;){
   const {bytesRead}=await open.handle.read(key,offset,key.length-offset,offset);
   if(!bytesRead)fail('INVALID_BACKUP_KEY');
   offset+=bytesRead;
  }
  await recheckOpenFile(open,'INVALID_BACKUP_KEY');
  return key;
 }catch{
  key?.fill(0);
  fail('INVALID_BACKUP_KEY');
 }finally{await open?.handle.close().catch(()=>{});}
}

async function openPendingFile(directory,kind) {
 await noLinks(directory,{code:kind});
 const filename=path.join(directory,'.snapshot.pending-'+randomUUID());
 const handle=await fs.open(filename,'wx',0o600);
 try{
  const stat=await handle.stat({bigint:true});
  return {directory,filename,handle,dev:stat.dev,ino:stat.ino};
 }catch(error){await handle.close().catch(()=>{});throw error;}
}

function ownsFile(owned,stat) {
 return stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===owned.dev&&stat.ino===owned.ino;
}

async function closePendingFile(owned) {
 if(!owned?.handle)return;
 const handle=owned.handle;
 owned.handle=null;
 await handle.close();
}

async function discardOwnedFile(owned,filename=owned?.filename) {
 if(!filename||!samePath(path.dirname(filename),owned.directory))return;
 try{
  await noLinks(owned.directory,{code:'BUNDLE_INVALID'});
  const stat=await fs.lstat(filename,{bigint:true});
  if(ownsFile(owned,stat))await fs.unlink(filename);
 }catch{}
}

async function publishOwnedFile(owned,name,expected) {
 const target=path.join(owned.directory,name);
 const before=await regular(owned.filename,'BUNDLE_INVALID');
 if(owned.handle||!ownsFile(owned,before)||!sameState(state(before),expected))fail('BUNDLE_INVALID');
 let linked=false;
 try{
  await fs.link(owned.filename,target);
  linked=true;
  const a=await fs.lstat(owned.filename,{bigint:true}),b=await fs.lstat(target,{bigint:true});
  if(!ownsFile(owned,a)||!ownsFile(owned,b)||a.nlink!==2n||b.nlink!==2n)fail('BUNDLE_INVALID');
  await fs.unlink(owned.filename);
  if(!ownsFile(owned,await regular(target,'BUNDLE_INVALID')))fail('BUNDLE_INVALID');
  return target;
 }catch(error){
  if(linked)await discardOwnedFile(owned,target);
  throw error;
 }
}

async function publishSealedRehearsalReceipt(directory,receipt,assertReady) {
 const bytes=Buffer.from(canonical(receipt),'utf8');
 if(bytes.length>MANIFEST_MAX)fail('RESTORE_FAILED');
 let owned;
 try{
  owned=await openPendingFile(directory,'RESTORE_FAILED');
  await writeEnvelopeBytes(owned.handle,bytes);
  await owned.handle.sync();
  await closePendingFile(owned);
  const facts=await hashFile(owned.filename);
  if(facts.sha256!==sha(bytes)||facts.byteLength!==bytes.length)fail('RESTORE_FAILED');
  await assertReady();
  await publishOwnedFile(owned,'rehearsal.json',facts.state);
 }catch(error){
  await closePendingFile(owned).catch(()=>{});
  await discardOwnedFile(owned);
  throw error;
 }
}

async function writeSealedSnapshot(owned,open,manifest,value,key) {
 const plaintext=Buffer.from(canonical(manifest),'utf8');
 try{
  if(!sameState(open.before,value._fileState))fail('BUNDLE_INVALID');
  await encryptBackupEnvelope({database:open.handle,manifest:plaintext,databaseBytes:value.databaseBytes,databaseSha256:value.databaseSha256,key,output:owned.handle});
  await owned.handle.sync();
  await closePendingFile(owned);
  await recheckOpenFile(open,'BUNDLE_INVALID');
 }finally{plaintext.fill(0);}
}

export async function sealOfflineBackup(options) {
 assertOfflineBackupRuntime();
 const {bundleDirectory,keyFile,outputRoot}=input(options,['bundleDirectory','keyFile'],['outputRoot']);
 const locations=sealedPaths(bundleDirectory,keyFile,outputRoot,false);
 let key,open,owned,directory,published;
 try{
  key=await readKeyFile(locations.keyPath);
  const checked=await verifyBundle(locations.bundle);
  const snapshot=path.join(checked.directory,'snapshot.sqlite');
  open=await openCheckedFile(snapshot,'BUNDLE_INVALID');
  directory=(await freshDirectory(locations.root,'sealed')).directory;
  owned=await openPendingFile(directory,'BACKUP_FAILED');
  await writeSealedSnapshot(owned,open,checked.manifest,checked.value,key);
  await standaloneSnapshot(snapshot);
  if(canonical(await readManifest(path.join(checked.directory,'manifest.json')))!==canonical(checked.manifest))fail('BUNDLE_INVALID');
  const facts=await hashFile(owned.filename);
  published=await publishOwnedFile(owned,SEALED_ARCHIVE,facts.state);
  const final=await hashFile(published);
  if(final.sha256!==facts.sha256||final.byteLength!==facts.byteLength||final.state.dev!==owned.dev||final.state.ino!==owned.ino)fail('BUNDLE_INVALID');
  return Object.freeze({kind:SEALED_KIND,directory,archivePath:published,archiveSha256:final.sha256,archiveBytes:final.byteLength,offlineOnly:true,onlineCutoverSupported:false,containsCredentials:true});
 }catch(error){
  await closePendingFile(owned).catch(()=>{});
  await discardOwnedFile(owned);
  if(published)await discardOwnedFile(owned,published);
  const code=error instanceof OfflineBackupError?error.code:error instanceof SealedEnvelopeError?'BUNDLE_INVALID':'BACKUP_FAILED';
  await failure(directory,code);
  fail(code);
 }finally{
  key?.fill(0);
  await open?.handle.close().catch(()=>{});
 }
}

function authenticatedManifest({manifest:bytes,databaseSha256},databaseBytes,mode) {
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),manifest=validateManifest(JSON.parse(text),mode);
  if(Buffer.byteLength(text)!==bytes.length||text!==canonical(manifest)||
     manifest.database.byteLength!==databaseBytes||manifest.database.sha256!==databaseSha256)fail('SEALED_BUNDLE_INVALID');
  return manifest;
 }catch{fail('SEALED_BUNDLE_INVALID');}
}

function managedMode(serverId){
 if(typeof serverId!=='string'||!UUID.test(serverId))fail('INVALID_INPUT');
 return {serverId};
}

async function managedSourceState(filename){
 try{
  await standaloneSnapshot(filename);
  return state(await regular(filename,'SOURCE_INVALID'));
 }catch{fail('SOURCE_INVALID');}
}

export async function createManagedSealedBackup(options) {
 assertOfflineBackupRuntime();
 const {sourceDatabase,outputRoot,keyFile,serverId,onProgress}=input(options,['sourceDatabase','outputRoot','keyFile','serverId'],['onProgress']);
 const mode=managedMode(serverId);
 if(onProgress!==undefined&&typeof onProgress!=='function')fail('INVALID_INPUT');
 const source=absolute(sourceDatabase),root=absolute(outputRoot),keyPath=absolute(keyFile,'INVALID_BACKUP_KEY');
 if(inside(source,REPOSITORY)||inside(root,REPOSITORY))fail('INVALID_INPUT');
 if(inside(keyPath,REPOSITORY)||samePath(source,keyPath))fail('INVALID_BACKUP_KEY');
 let key,sourceDb,directory,staged,open,owned,published;
 try{
  const before=await managedSourceState(source);
  sourceDb=readDatabase(source);
  identity(sourceDb,mode);
  key=await readKeyFile(keyPath);
  const created=await freshDirectory(root,'sealed');
  directory=created.directory;
  staged=await openPendingFile(directory,'BACKUP_FAILED');
  await closePendingFile(staged);
  await copySnapshot(sourceDb,staged.filename,onProgress);
  sourceDb.close();
  sourceDb=undefined;
  if(!sameState(before,await managedSourceState(source)))fail('SOURCE_INVALID');
  if(!ownsFile(staged,await regular(staged.filename,'BUNDLE_INVALID')))fail('BUNDLE_INVALID');
  await standaloneSnapshot(staged.filename);
  await syncRegularFile(staged.filename);
  const value=await inspect(staged.filename,mode);
  open=await openCheckedFile(staged.filename,'BUNDLE_INVALID');
  owned=await openPendingFile(directory,'BACKUP_FAILED');
  await writeSealedSnapshot(owned,open,manifestFor(created.id,value),value,key);
  await open.handle.close();
  open=undefined;
  await discardOwnedFile(staged);
  const entries=await fs.readdir(directory);
  if(entries.length!==1||entries[0]!==path.basename(owned.filename))fail('BACKUP_FAILED');
  const facts=await hashFile(owned.filename);
  published=await publishOwnedFile(owned,SEALED_ARCHIVE,facts.state);
  const final=await hashFile(published);
  if(final.sha256!==facts.sha256||final.byteLength!==facts.byteLength||final.state.dev!==owned.dev||final.state.ino!==owned.ino)fail('BUNDLE_INVALID');
  await checkSealedDirectory(directory);
  return Object.freeze({kind:MANAGED_SEALED_KIND,directory,archivePath:published,archiveSha256:final.sha256,archiveBytes:final.byteLength,
    serverId,snapshotId:created.id,authenticatedSnapshotSha256:value.databaseSha256,offlineOnly:true,onlineCutoverSupported:false,containsCredentials:true});
 }catch(error){
  await open?.handle.close().catch(()=>{});
  await closePendingFile(staged).catch(()=>{});
  await discardOwnedFile(staged);
  await closePendingFile(owned).catch(()=>{});
  await discardOwnedFile(owned);
  if(published)await discardOwnedFile(owned,published);
  const code=error instanceof OfflineBackupError?error.code:'BACKUP_FAILED';
  await failure(directory,code);
  fail(code);
 }finally{
  key?.fill(0);
  try{sourceDb?.close();}catch{}
 }
}

async function checkSealedDirectory(directory) {
 await noLinks(directory,{code:'SEALED_BUNDLE_INVALID'});
 if(!path.basename(directory).startsWith('sealed-')||!UUID.test(path.basename(directory).slice(7)))fail('SEALED_BUNDLE_INVALID');
 try{
  const entries=await fs.readdir(directory);
  if(entries.length!==1||entries[0]!==SEALED_ARCHIVE)fail('SEALED_BUNDLE_INVALID');
 }catch{fail('SEALED_BUNDLE_INVALID');}
}

async function markManagedRehearsal(owned,original,mode){
 await assertInspectedFile(owned.filename,original);
 const db=new DatabaseSync(sqliteExistingFileUri(owned.filename,'rw'),{enableForeignKeyConstraints:true,allowExtension:false,timeout:5000});
 try{
  db.exec('PRAGMA trusted_schema=OFF;');
  identity(db,mode);
  db.exec('BEGIN IMMEDIATE;');
  const before=db.prepare('SELECT name,value FROM main.team_database_metadata ORDER BY name').all();
  db.prepare('INSERT INTO main.team_database_metadata (name,value) VALUES (?,?)').run(MANAGED_REHEARSAL_MARKER,'1');
  const after=db.prepare('SELECT name,value FROM main.team_database_metadata WHERE name<>? ORDER BY name').all(MANAGED_REHEARSAL_MARKER);
  if(JSON.stringify(before)!==JSON.stringify(after))fail('RESTORE_FAILED');
  db.exec('COMMIT;');
 }finally{db.close();}
 if(!ownsFile(owned,await regular(owned.filename,'RESTORE_FAILED')))fail('RESTORE_FAILED');
 await syncRegularFile(owned.filename);
 await standaloneSnapshot(owned.filename);
 const marked=await inspect(owned.filename,{...mode,rehearsal:true});
 const unchangedTables=tables=>tables.filter(table=>table.name!=='team_database_metadata');
 if(marked.schemaSha256!==original.schemaSha256||marked.totalRows!==original.totalRows+1||
    JSON.stringify(unchangedTables(marked.tables))!==JSON.stringify(unchangedTables(original.tables)))fail('RESTORE_FAILED');
 return marked;
}

async function rehearseSealedRestore({bundleDirectory,keyFile,outputRoot},mode) {
 const locations=sealedPaths(bundleDirectory,keyFile,outputRoot,true);
 let key,open,first,second,owned,directory,published;
 try{
  key=await readKeyFile(locations.keyPath);
  await checkSealedDirectory(locations.bundle);
  open=await openCheckedFile(path.join(locations.bundle,SEALED_ARCHIVE),'SEALED_BUNDLE_INVALID');
  const envelope=await readBackupEnvelope(open.handle,Number(open.before.size));
  first=await decryptBackupEnvelope(open.handle,envelope,key);
  await recheckOpenFile(open,'SEALED_BUNDLE_INVALID');
  const manifest=authenticatedManifest(first,envelope.databaseBytes,mode);
  const created=await freshDirectory(locations.root,'rehearsal');
  directory=created.directory;
  owned=await openPendingFile(directory,'RESTORE_FAILED');
  second=await decryptBackupEnvelope(open.handle,envelope,key,{authenticatedFrames:first.frames,writeDatabase:bytes=>writeEnvelopeBytes(owned.handle,bytes)});
  if(!first.manifest.equals(second.manifest))fail('SEALED_BUNDLE_INVALID');
  await recheckOpenFile(open,'SEALED_BUNDLE_INVALID');
  await checkSealedDirectory(locations.bundle);
  await owned.handle.sync();
  await closePendingFile(owned);
  await standaloneSnapshot(owned.filename);
  const original=await inspect(owned.filename,mode);
  if(!matches(original,manifest))fail('SEALED_BUNDLE_INVALID');
  const value=mode?await markManagedRehearsal(owned,original,mode):original;
  const kind=mode?MANAGED_REHEARSAL_KIND:REHEARSAL_KIND;
  const authenticated=mode?{authenticatedSnapshotSha256:original.databaseSha256,authenticatedSnapshotBytes:original.databaseBytes}:{};
  published=await publishOwnedFile(owned,'snapshot.sqlite',value._fileState);
  const final=await hashFile(published);
  if(final.sha256!==value.databaseSha256||final.byteLength!==value.databaseBytes)fail('BUNDLE_INVALID');
  value._fileState=final.state;
  await publishSealedRehearsalReceipt(directory,{schemaVersion:1,kind,rehearsalId:created.id,snapshotId:manifest.snapshotId,verifiedAt:new Date().toISOString(),database:{filename:'snapshot.sqlite',byteLength:value.databaseBytes,sha256:value.databaseSha256},identity:value.identity,inventory:{schemaSha256:value.schemaSha256,totalRows:value.totalRows,tables:value.tables},offlineOnly:true,onlineCutoverSupported:false,containsCredentials:true,...authenticated},()=>assertInspectedFile(published,value));
  return Object.freeze({...summary(kind,directory,manifest.snapshotId,value),...authenticated});
 }catch(error){
  await closePendingFile(owned).catch(()=>{});
  await discardOwnedFile(owned);
  if(published)await discardOwnedFile(owned,published);
  const code=error instanceof OfflineBackupError?error.code==='BUNDLE_INVALID'?'SEALED_BUNDLE_INVALID':error.code:error instanceof SealedEnvelopeError?'SEALED_BUNDLE_INVALID':'RESTORE_FAILED';
  await failure(directory,code);
  fail(code);
 }finally{
  key?.fill(0);first?.manifest.fill(0);second?.manifest.fill(0);first?.frames.fill(0);
  await open?.handle.close().catch(()=>{});
 }
}

export async function rehearseSealedOfflineRestore(options) {
 assertOfflineBackupRuntime();
 return rehearseSealedRestore(input(options,['bundleDirectory','keyFile'],['outputRoot']));
}

export async function rehearseManagedSealedRestore(options) {
 assertOfflineBackupRuntime();
 const {serverId,...selected}=input(options,['bundleDirectory','keyFile','outputRoot','serverId']);
 return rehearseSealedRestore(selected,managedMode(serverId));
}

function reportArea(name) {
 if(/^team_(billing|annual|seat|subscription)_/.test(name))return 'billingAndEntitlements';
 if(/^team_(auth|credential|device|(?:operator_)?employee_activation|first_administrator|phone|recovery|session|user|wechat)(_|s?$)/.test(name))return 'identityAndDevices';
 if(name==='teams'||/^team_(profiles|memberships|operators|task_assignments|invitations|activity)$/.test(name)||
    /^team_(administrator_business_role|business_role|project_access|project_migration|member_access|provisioning)_/.test(name)||
    /(?:_grants|_reviewers|_invitations)$/.test(name))return 'teamAndProjectAccess';
 return 'other';
}

function compareSnapshotInventories(current,manifest) {
 const schemaMatches=current.schemaSha256===manifest.inventory.schemaSha256;
 const databaseBytesMatch=current.databaseBytes===manifest.database.byteLength&&current.databaseSha256===manifest.database.sha256;
 const snapshotTables=new Map(manifest.inventory.tables.map(table=>[table.name,table]));
 const tables={changed:0,added:0,removed:0};
 const changedAreas={identityAndDevices:0,teamAndProjectAccess:0,billingAndEntitlements:0,other:0};
 for(const currentTable of current.tables){
  const previous=snapshotTables.get(currentTable.name);
  if(!previous){
   tables.added++;
   changedAreas[reportArea(currentTable.name)]++;
  }else if(previous.rowCount!==currentTable.rowCount||previous.rowSha256!==currentTable.rowSha256){
   tables.changed++;
   changedAreas[reportArea(currentTable.name)]++;
  }
  snapshotTables.delete(currentTable.name);
 }
 tables.removed=snapshotTables.size;
 for(const name of snapshotTables.keys())changedAreas[reportArea(name)]++;
 const same=schemaMatches&&!tables.changed&&!tables.added&&!tables.removed;
 if(databaseBytesMatch&&!same)fail('SEALED_BUNDLE_INVALID');
 return {kind:'shenyi-offline-managed-restore-comparison',status:same?'match':'different',schemaMatches,databaseBytesMatch,
  tables,changedAreas,offlineOnly:true,onlineCutoverSupported:false};
}

export async function compareManagedSealedBackup(options) {
 assertOfflineBackupRuntime();
 const {sourceDatabase,bundleDirectory,keyFile,serverId}=input(options,['sourceDatabase','bundleDirectory','keyFile','serverId']);
 const mode=managedMode(serverId),source=absolute(sourceDatabase),{bundle,keyPath}=sealedInputPaths(bundleDirectory,keyFile,true);
 if(inside(source,REPOSITORY)||inside(source,bundle))fail('INVALID_INPUT');
 if(samePath(source,keyPath))fail('INVALID_BACKUP_KEY');
 const sourceBefore=await managedSourceState(source);
 let key,open,authenticated;
 try{
  key=await readKeyFile(keyPath);
  await checkSealedDirectory(bundle);
  open=await openCheckedFile(path.join(bundle,SEALED_ARCHIVE),'SEALED_BUNDLE_INVALID');
  const envelope=await readBackupEnvelope(open.handle,Number(open.before.size));
  authenticated=await decryptBackupEnvelope(open.handle,envelope,key);
  const manifest=authenticatedManifest(authenticated,envelope.databaseBytes,mode);
  let current;
  try{
   if(!sameState(sourceBefore,await managedSourceState(source)))fail('SOURCE_INVALID');
   // Skip SQLite journal handling even if the operator restarts a writer during comparison.
   current=await inspect(source,mode,{immutable:true});
   if(!sameState(sourceBefore,current._fileState))fail('SOURCE_INVALID');
  }catch{fail('SOURCE_INVALID');}
  await checkSealedDirectory(bundle);
  await recheckOpenFile(open,'SEALED_BUNDLE_INVALID');
  if(!sameState(sourceBefore,await managedSourceState(source)))fail('SOURCE_INVALID');
  return compareSnapshotInventories(current,manifest);
 }catch(error){
  if(error instanceof OfflineBackupError)throw error;
  fail('SEALED_BUNDLE_INVALID');
 }finally{
  key?.fill(0);
  authenticated?.manifest.fill(0);
  authenticated?.frames.fill(0);
  await open?.handle.close().catch(()=>{});
 }
}
