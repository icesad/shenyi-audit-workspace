import {createHash} from 'node:crypto';
import {setImmediate as turn} from 'node:timers/promises';
import codec from '../../dist/workpaper-package.js';
export const EXPORT_FORMAT='shenyi-team-workpaper-export',EXPORT_MAX_BYTES=532*1024*1024;
export const EXPORT_POLICY=Object.freeze({singleSavedVersion:true,teamStoredVersion:true,originalArchivesPreserved:true,supplementalOriginalsPreserved:true,savedEntriesPreserved:true,existingFreezeSnapshotsPreserved:true,completeVersionHistory:false,teamImportSupported:false,includesOtherModuleData:false,identityAuthenticatedByPackage:false,professionalApprovalClaimed:false});
const HASH=/^[a-f0-9]{64}$/,BLOCK=64*1024;
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes)crc=(crc>>>8)^table[(crc^b)&255];return (crc^0xffffffff)>>>0;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('WORKPAPER_EXPORT_INVALID');};
const json=(value,max)=>{const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>max)fail();return bytes;};
function header(entry,central=false){
 const name=Buffer.from(entry.name),b=Buffer.alloc((central?46:30)+name.length);
 if(central){b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt16LE(0x800,8);b.writeUInt32LE(entry.crc,16);b.writeUInt32LE(entry.size,20);b.writeUInt32LE(entry.size,24);b.writeUInt16LE(name.length,28);b.writeUInt32LE(entry.offset,42);name.copy(b,46);}
 else{b.writeUInt32LE(0x04034b50);b.writeUInt16LE(20,4);b.writeUInt16LE(0x800,6);b.writeUInt32LE(entry.crc,14);b.writeUInt32LE(entry.size,18);b.writeUInt32LE(entry.size,22);b.writeUInt16LE(name.length,26);name.copy(b,30);}return b;
}

// Stored ZIP, bounded one-original-at-a-time. No whole-package Buffer or Blob.
// readOriginal returns a private, freshly validated copy for this project.
export async function planWorkpaperExport({scope,source,sourceManifestJson,recordJson,originals,readOriginal,assertCurrent,createdAt}){
 const check=()=>assertCurrent();check();
 if(!Array.isArray(originals)||originals.length>codec.LIMITS.archives+codec.LIMITS.supplements||typeof readOriginal!=='function'||!HASH.test(scope.recordSha256??'')||sha(recordJson)!==scope.recordSha256)fail();
 const recordBytes=Buffer.from(recordJson),sourceBytes=Buffer.from(sourceManifestJson);
 if(recordBytes.length>codec.LIMITS.recordBytes||sourceBytes.length>codec.LIMITS.manifestBytes||sha(sourceBytes)!==source.manifestSha256)fail();
 const files=[];let total=0,previous='';
 for(const original of originals){
  if(!HASH.test(original.sha256??'')||original.sha256<=previous||!Number.isSafeInteger(original.bytes)||original.bytes<1||original.bytes>codec.LIMITS.archiveBytes)fail();previous=original.sha256;total+=original.bytes;if(total>codec.LIMITS.originalBytes)fail();
  check();const bytes=readOriginal(original.sha256);if(!(bytes instanceof Uint8Array)||bytes.length!==original.bytes||sha(bytes)!==original.sha256)fail();
  files.push({name:'originals/'+original.sha256+'.bin',size:bytes.length,sha256:original.sha256,crc:crc32(bytes)});await turn();check();
 }
 const manifest={format:EXPORT_FORMAT,schemaVersion:1,createdAt,scope:{...scope},source:{...source,manifestEntry:'source-manifest.json'},record:{entry:'record.json',bytes:recordBytes.length,sha256:scope.recordSha256},files:files.map(x=>({entry:x.name,bytes:x.size,sha256:x.sha256})),policy:{...EXPORT_POLICY}};
 const manifestBytes=json(manifest,codec.LIMITS.manifestBytes),fixed=new Map([['manifest.json',manifestBytes],['record.json',recordBytes],['source-manifest.json',sourceBytes]]);
 const entries=[...fixed].map(([name,bytes])=>({name,size:bytes.length,sha256:sha(bytes),crc:crc32(bytes)})).concat(files);let offset=0;
 for(const entry of entries){entry.offset=offset;offset+=30+Buffer.byteLength(entry.name)+entry.size;}
 const centralOffset=offset,central=Buffer.concat(entries.map(e=>header(e,true)));offset+=central.length;const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(centralOffset,16);const byteLength=offset+end.length;if(byteLength>EXPORT_MAX_BYTES)fail();
 async function* chunks(){
  for(const entry of entries){
   check();const bytes=fixed.get(entry.name)??readOriginal(entry.sha256);if(!(bytes instanceof Uint8Array)||bytes.length!==entry.size||sha(bytes)!==entry.sha256||crc32(bytes)!==entry.crc)fail();
   yield header(entry);
   for(let at=0;at<bytes.length;at+=BLOCK){await turn();check();yield bytes.subarray(at,at+BLOCK);}
  }
  await turn();check();yield central;await turn();check();yield end;check();
 }
 const digest=createHash('sha256');let measured=0;for await(const bytes of chunks()){digest.update(bytes);measured+=bytes.length;}if(measured!==byteLength)fail();check();
 const packageSha256=digest.digest('hex');let started=false;
 return Object.freeze({byteLength,sha256:packageSha256,manifest:JSON.parse(manifestBytes.toString()),stream({signal,onClose}={}){
  if(started)fail();started=true;const iterator=chunks();let closed=false,controller,idle,deadline;
  const close=()=>{if(closed)return;closed=true;clearTimeout(idle);clearTimeout(deadline);signal?.removeEventListener('abort',abort);onClose?.();};
  const stop=()=>{if(closed)return;close();controller.error(Error('WORKPAPER_EXPORT_INTERRUPTED'));void iterator.return().catch(()=>{});};
  const abort=()=>stop(),touch=()=>{clearTimeout(idle);idle=setTimeout(stop,60000);idle.unref?.();};
  return new ReadableStream({start(c){controller=c;signal?.addEventListener('abort',abort,{once:true});deadline=setTimeout(stop,30*60000);deadline.unref?.();touch();if(signal?.aborted)stop();},async pull(c){try{touch();const next=await iterator.next();if(closed)return;if(next.done){close();c.close();}else c.enqueue(next.value);}catch{if(!closed){close();c.error(Error('WORKPAPER_EXPORT_INTERRUPTED'));}}},async cancel(){close();await iterator.return();}},{highWaterMark:0});
 }});
}
