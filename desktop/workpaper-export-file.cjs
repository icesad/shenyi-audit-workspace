'use strict';
// Verify an already-open private export file. This module never opens, writes,
// closes or publishes a path and never materializes a whole package/original.
const {createHash}=require('node:crypto');
const codec=require('../dist/workpaper-package.js');
const governance=require('../dist/workpaper-governance.js');
const supplemental=require('../dist/supplemental-workpapers.js');
const BLOCK=64*1024,MAX=532*1024*1024,SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const POLICY=Object.freeze({singleSavedVersion:true,teamStoredVersion:true,originalArchivesPreserved:true,supplementalOriginalsPreserved:true,savedEntriesPreserved:true,existingFreezeSnapshotsPreserved:true,completeVersionHistory:false,teamImportSupported:false,includesOtherModuleData:false,identityAuthenticatedByPackage:false,professionalApprovalClaimed:false});
const TARGET=['teamId','projectId','sourceProjectId','version','headRevision','projectRevision','grantRevision','recordSha256'];
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{const error=new Error('底稿导出文件未通过完整性校验，未发布。');error.code='WORKPAPER_EXPORT_FILE_INVALID';throw error;};
const match=(re,value)=>typeof value==='string'&&re.exec(value)?.[0]===value;
const integer=(value,min=1)=>Number.isSafeInteger(value)&&value>=min;
const plain=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
function exact(value,keys){if(!plain(value))fail();const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();}
function iso(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail();}
function canonicalJson(bytes){
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail();}
 const stack=[{value,depth:0}];let nodes=0;
 while(stack.length){const {value:v,depth}=stack.pop();if(++nodes>codec.LIMITS.nodes||depth>codec.LIMITS.depth)fail();if(v===null||typeof v==='boolean')continue;if(typeof v==='string'){if(!v.isWellFormed())fail();continue;}if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail();continue;}if(!Array.isArray(v)&&!plain(v))fail();const keys=Object.keys(v);if(Array.isArray(v)&&keys.length!==v.length||nodes+stack.length+keys.length*2>codec.LIMITS.nodes)fail();for(const key of keys){stack.push({value:key,depth:depth+1},{value:v[key],depth:depth+1});}}
 let encoded;try{encoded=Buffer.from(JSON.stringify(value));}catch{fail();}if(!encoded.equals(bytes))fail();return value;
}
function policy(value,expected){exact(value,Object.keys(expected));if(Object.keys(expected).some(k=>value[k]!==expected[k]))fail();}
function files(value){if(!Array.isArray(value)||value.length>codec.LIMITS.archives+codec.LIMITS.supplements)fail();const found=new Map();let prior='',total=0;for(const item of value){exact(item,['entry','bytes','sha256']);if(!match(SHA,item.sha256)||item.entry!=='originals/'+item.sha256+'.bin'||item.entry<=prior||!integer(item.bytes)||item.bytes>codec.LIMITS.archiveBytes)fail();prior=item.entry;total+=item.bytes;if(total>codec.LIMITS.originalBytes)fail();found.set(item.sha256,item);}return{found,total};}
// These persisted-metadata predicates correspond exactly to the original
// supplemental-workpapers.js validateShape (lines6-8). Native Blob branding
// cannot be reused without allocating binary copies. Actual bytes are instead
// proven below, then all original shape constraints are checked explicitly.
// The dedicated tests pin the original function and compare positive/negative
// fixtures, so a later original-rule change requires reviewing this adapter.
function supplementalShape(list){
 if(!Array.isArray(list)||list.length>supplemental.MAX_ROWS)fail();const ids=new Set();let total=0;
 const text=(v,max,blank=false)=>typeof v==='string'&&v.length<=max&&(blank||!!v.trim())&&v.isWellFormed()&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
 for(const row of list){exact(row,['id','subjectCode','subjectName','file','createdAt']);if(typeof row.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)||ids.has(row.id)||!text(row.subjectCode,30)||!text(row.subjectName,100)||row.subjectCode!==row.subjectCode.trim()||row.subjectName!==row.subjectName.trim())fail();ids.add(row.id);iso(row.createdAt);const file=row.file;exact(file,['name','mime','size','sha256','blob']);if(!text(file.name,240)||/[\/\\]/u.test(file.name)||!text(file.mime,150,true)||!integer(file.size)||file.size>supplemental.MAX_FILE_BYTES||!match(SHA,file.sha256)||file.size!==file.blob.bytes||file.mime!==file.blob.mime)fail();total+=file.size;if(total>supplemental.MAX_TOTAL_BYTES)fail();}
}
function recordReferences(record,declared,proof){
 if(!plain(record)||Object.keys(record).some(k=>!codec.FIELDS.includes(k))||!match(UUID,record.id)||record.id===codec.TRIAL_ID||!integer(record.rev))fail();if(Object.hasOwn(record,'updatedAt'))iso(record.updatedAt);
 for(const key of ['choices','directoryRevisions','workpaperSources','workpaperRouteSelections','answers','docAnswers','workpaperLocks','workpaperReuseProvenance','autoFillProvenance','workpaperReuseTemplates'])if(record[key]!==undefined&&!plain(record[key]))fail();
 for(const key of ['index','riskIndex'])if(record[key]!==undefined&&(!Array.isArray(record[key])||record[key].length>512))fail();
 if(record.industryTag!==undefined&&(typeof record.industryTag!=='string'||record.industryTag.length>80||/[\u0000-\u001f]/.test(record.industryTag)))fail();
 if(record.workpaperSources!==undefined&&Object.keys(record.workpaperSources).length>16||record.workpaperLocks!==undefined&&Object.keys(record.workpaperLocks).length>512)fail();
 const used=new Set();let archives=0;
 function reference(file,max,archive=false){
  if(!plain(file))fail();const ref=file.blob;exact(ref,['entry','bytes','sha256','mime']);const hash=archive?file.hash:file.sha256,item=declared.get(hash),verified=proof.get(hash);
  if(!match(SHA,hash)||ref.sha256!==hash||ref.entry!=='originals/'+hash+'.bin'||!integer(ref.bytes)||ref.bytes>max||typeof ref.mime!=='string'||ref.mime.length>150||new Blob([],{type:ref.mime}).type!==ref.mime||!item||item.bytes!==ref.bytes||verified?.bytes!==ref.bytes||verified.sha256!==hash||file.size!==undefined&&file.size!==ref.bytes||file.mime!==undefined&&file.mime!==ref.mime)fail();used.add(hash);
 }
 function archive(value){if(value===undefined||value===null)return;if(++archives>codec.LIMITS.archives||!plain(value)||typeof value.name!=='string'||!value.name||value.name.length>500)fail();reference(value,codec.LIMITS.archiveBytes,true);}
 archive(record.archive);archive(record.riskArchive);
 for(const [key,value]of Object.entries(record.workpaperSources||{})){if(!match(SHA,key)||!plain(value)||value.archive?.hash!==key||!Array.isArray(value.index)||value.index.length>512)fail();archive(value.archive);}
 if(record.supplementalWorkpapers!==undefined){if(!Array.isArray(record.supplementalWorkpapers))fail();for(const row of record.supplementalWorkpapers)reference(row?.file,codec.LIMITS.supplementBytes);supplementalShape(record.supplementalWorkpapers);}
 if(used.size!==declared.size)fail();
 // Original Governance only requests Blob metadata. These are explicit
 // non-readable views backed by the verified bytes, never replacement bytes.
 const viewArchive=value=>{if(value===undefined||value===null)return value;const ref=value.blob;return{...value,blob:Object.freeze({size:ref.bytes,type:ref.mime,arrayBuffer(){throw Error('Verified metadata view has no binary reader');}})};};
 const view={...record,archive:viewArchive(record.archive),riskArchive:viewArchive(record.riskArchive),...(record.workpaperSources!==undefined?{workpaperSources:Object.fromEntries(Object.entries(record.workpaperSources).map(([key,value])=>[key,{...value,archive:viewArchive(value.archive)}]))}:{})};
 try{governance.assertTransition({id:record.id},view);}catch{fail();}
}
function validateMetadata(manifest,source,record,metadata,declared,proof,expected){
 // The three live revisions are not serialized into this format: the manager
 // must perform its own fresh CAS before/after inspection. The original package
 // is also not reconstructed; its SHA remains provenance, not a signature.
 exact(manifest,['format','schemaVersion','createdAt','scope','source','record','files','policy']);if(manifest.format!=='shenyi-team-workpaper-export'||manifest.schemaVersion!==1)fail();iso(manifest.createdAt);policy(manifest.policy,POLICY);
 exact(manifest.scope,['teamId','projectId','sourceProjectId','version','recordRevision','recordSha256']);const scope=manifest.scope;if(['teamId','projectId','sourceProjectId','version','recordSha256'].some(k=>scope[k]!==expected[k])||!integer(scope.recordRevision))fail();
 exact(manifest.record,['entry','bytes','sha256']);if(manifest.record.entry!=='record.json'||manifest.record.bytes!==metadata.get('record.json').length||manifest.record.sha256!==expected.recordSha256||digest(metadata.get('record.json'))!==expected.recordSha256)fail();
 exact(manifest.source,['packageSha256','recordSha256','manifestSha256','importedAt','manifestEntry']);const origin=manifest.source;if(!['packageSha256','recordSha256','manifestSha256'].every(k=>match(SHA,origin[k]))||!integer(origin.importedAt,0)||origin.manifestEntry!=='source-manifest.json'||digest(metadata.get('source-manifest.json'))!==origin.manifestSha256)fail();
 exact(source,['format','schemaVersion','packageId','createdAt','sourceProjectId','workspaceRevision','record','files','policy']);if(source.format!==codec.FORMAT||source.schemaVersion!==codec.VERSION||!match(UUID,source.packageId)||source.sourceProjectId!==expected.sourceProjectId||!integer(source.workspaceRevision))fail();iso(source.createdAt);policy(source.policy,codec.POLICY);
 exact(source.record,['entry','bytes','sha256']);if(source.record.entry!=='record.json'||!integer(source.record.bytes)||source.record.bytes>codec.LIMITS.recordBytes||source.record.sha256!==origin.recordSha256||!match(SHA,source.record.sha256)||scope.recordRevision-(scope.version-1)!==source.workspaceRevision)fail();
 if(scope.version===1&&(source.record.sha256!==scope.recordSha256||source.record.bytes!==manifest.record.bytes))fail();const initial=files(source.files).found;if(initial.size!==declared.size||[...declared].some(([hash,item])=>initial.get(hash)?.bytes!==item.bytes))fail();
 if(!plain(record)||record.id!==expected.sourceProjectId||record.rev!==scope.recordRevision)fail();recordReferences(record,declared,proof);
 return{sourceProjectId:record.id,version:scope.version,recordRevision:record.rev,recordSha256:scope.recordSha256,originalCount:declared.size,originalBytes:[...declared.values()].reduce((n,x)=>n+x.bytes,0),freezeCount:Object.keys(record.workpaperLocks||{}).length};
}
async function inspectWorkpaperExportFile({handle,byteLength,sha256,expected,assertCurrent}={}){
 if(!handle||typeof handle.read!=='function'||typeof handle.stat!=='function'||!integer(byteLength)||byteLength>MAX||!match(SHA,sha256)||typeof assertCurrent!=='function')fail();exact(expected,TARGET);expected=Object.freeze({...expected});if(!match(ID,expected.teamId)||!match(ID,expected.projectId)||!match(UUID,expected.sourceProjectId)||expected.sourceProjectId===codec.TRIAL_ID||!match(SHA,expected.recordSha256)||!['version','headRevision','projectRevision','grantRevision'].every(k=>integer(expected[k]))||expected.version>expected.headRevision)fail();
 const check=async()=>{await assertCurrent();};await check();
 async function stat(){await check();let value;try{value=await handle.stat({bigint:true});}catch{fail();}await check();if(!value?.isFile?.()||value.size!==BigInt(byteLength)||!['dev','ino','mtimeNs','ctimeNs'].every(k=>typeof value[k]==='bigint'))fail();return value;}
 const initialStat=await stat();
 async function read(position,length){if(!integer(position,0)||!integer(length,0)||length>BLOCK||position+length>byteLength)fail();const buffer=Buffer.allocUnsafe(length);let at=0;while(at<length){await check();let result;try{result=await handle.read(buffer,at,length-at,position+at);}catch{fail();}await check();if(!integer(result?.bytesRead)||result.bytesRead>length-at)fail();at+=result.bytesRead;}return buffer;}
 if(byteLength<22)fail();const end=await read(byteLength-22,22);if(end.readUInt32LE(0)!==0x06054b50||end.readUInt16LE(4)||end.readUInt16LE(6)||end.readUInt16LE(20))fail();const count=end.readUInt16LE(8),centralSize=end.readUInt32LE(12),centralOffset=end.readUInt32LE(16);if(count<3||count>codec.LIMITS.archives+codec.LIMITS.supplements+3||end.readUInt16LE(10)!==count||centralSize>count*(46+88)||centralOffset+centralSize!==byteLength-22)fail();
 const central=await read(centralOffset,centralSize),entries=[];let cursor=0,offset=0,prior='';
 for(let i=0;i<count;i++){
  if(cursor+46>central.length||central.readUInt32LE(cursor)!==0x02014b50)fail();const size=central.readUInt32LE(cursor+24),nameLength=central.readUInt16LE(cursor+28),start=central.readUInt32LE(cursor+42);
  if(central.readUInt16LE(cursor+4)!==20||central.readUInt16LE(cursor+6)!==20||central.readUInt16LE(cursor+8)!==0x800||central.readUInt16LE(cursor+10)||central.readUInt32LE(cursor+20)!==size||central.readUInt16LE(cursor+30)||central.readUInt16LE(cursor+32)||central.readUInt16LE(cursor+34)||central.readUInt16LE(cursor+36)||central.readUInt32LE(cursor+38)||nameLength<1||nameLength>88||cursor+46+nameLength>central.length||start!==offset)fail();
  const nameBytes=central.subarray(cursor+46,cursor+46+nameLength),name=nameBytes.toString('utf8'),fixed=['manifest.json','record.json','source-manifest.json'];if(!Buffer.from(name).equals(nameBytes)||i<3&&name!==fixed[i]||i>=3&&(!/^originals\/[a-f0-9]{64}\.bin$/.test(name)||name<=prior))fail();
  const maximum=name==='record.json'?codec.LIMITS.recordBytes:i<3?codec.LIMITS.manifestBytes:codec.LIMITS.archiveBytes;if(!size||size>maximum)fail();if(i>=3)prior=name;
  entries.push({name,nameBytes,size,offset:start,crc:central.readUInt32LE(cursor+16),time:central.readUInt16LE(cursor+12),date:central.readUInt16LE(cursor+14)});offset+=30+nameLength+size;if(offset>centralOffset)fail();cursor+=46+nameLength;
 }
 if(cursor!==central.length||offset!==centralOffset)fail();
 const whole=createHash('sha256'),metadata=new Map(),proof=new Map();
 for(const entry of entries){const local=await read(entry.offset,30+entry.nameBytes.length);if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(4)!==20||local.readUInt16LE(6)!==0x800||local.readUInt16LE(8)||local.readUInt16LE(10)!==entry.time||local.readUInt16LE(12)!==entry.date||local.readUInt32LE(14)!==entry.crc||local.readUInt32LE(18)!==entry.size||local.readUInt32LE(22)!==entry.size||local.readUInt16LE(26)!==entry.nameBytes.length||local.readUInt16LE(28)||!local.subarray(30).equals(entry.nameBytes))fail();whole.update(local);const hash=createHash('sha256'),saved=entry.name.startsWith('originals/')?null:Buffer.allocUnsafe(entry.size);let crc=0xffffffff;
  for(let at=0;at<entry.size;at+=BLOCK){const chunk=await read(entry.offset+local.length+at,Math.min(BLOCK,entry.size-at));whole.update(chunk);hash.update(chunk);for(const b of chunk)crc=(crc>>>8)^crcTable[(crc^b)&255];if(saved)chunk.copy(saved,at);}
  const memberSha=hash.digest('hex');if(((crc^0xffffffff)>>>0)!==entry.crc)fail();if(saved)metadata.set(entry.name,saved);else{const nameSha=entry.name.slice(10,-4);if(memberSha!==nameSha)fail();proof.set(nameSha,{bytes:entry.size,sha256:memberSha});}
 }
 const finalCentral=await read(centralOffset,centralSize),finalEnd=await read(byteLength-22,22);if(!central.equals(finalCentral)||!end.equals(finalEnd))fail();whole.update(finalCentral);whole.update(finalEnd);if(whole.digest('hex')!==sha256)fail();
 const manifest=canonicalJson(metadata.get('manifest.json')),source=canonicalJson(metadata.get('source-manifest.json')),record=canonicalJson(metadata.get('record.json'));if(!plain(manifest))fail();const declared=files(manifest.files).found;if(proof.size!==declared.size||[...declared].some(([hash,item])=>proof.get(hash)?.bytes!==item.bytes))fail();
 const summary=validateMetadata(manifest,source,record,metadata,declared,proof,expected);
 // Recheck persisted content after parsing. A short in-place write can retain
 // identical filesystem timestamps while changing bytes already read above.
 const persisted=createHash('sha256');for(let at=0;at<byteLength;at+=BLOCK)persisted.update(await read(at,Math.min(BLOCK,byteLength-at)));
 if(persisted.digest('hex')!==sha256)fail();
 const finalStat=await stat();if(['dev','ino','size','mtimeNs','ctimeNs'].some(k=>finalStat[k]!==initialStat[k]))fail();await check();return{byteLength,sha256,...summary};
}
module.exports={inspectWorkpaperExportFile};
