/* Explicit complete workpaper package. No database, calculation or write-back. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(root,require('./workpaper-governance.js'),require('./supplemental-workpapers.js'));
 else root.WorkpaperPackage=factory(root,root.WorkpaperGovernance,root.SupplementalWorkpapers);
})(globalThis,function(root,G,Supplemental){'use strict';
 const TRIAL_ID='00000000-0000-4000-8000-000000000033',FORMAT='shenyi-workpaper-package',VERSION=1;
 const LIMITS=Object.freeze({archiveBytes:24*1024*1024,supplementBytes:12*1024*1024,supplementTotalBytes:64*1024*1024,originalBytes:496*1024*1024,recordBytes:32*1024*1024,manifestBytes:1024*1024,packageBytes:530*1024*1024,archives:18,supplements:200,nodes:1000000,depth:40});
 const FILE_MAX=LIMITS.archiveBytes,FILES_MAX=LIMITS.originalBytes,RECORD_MAX=LIMITS.recordBytes,MANIFEST_MAX=LIMITS.manifestBytes,PACKAGE_MAX=LIMITS.packageBytes,COUNT_MAX=LIMITS.archives+LIMITS.supplements;
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
 const FIELDS=Object.freeze(['id','rev','updatedAt','choices','directoryRevisions','archive','index','riskArchive','riskIndex','workpaperSources','workpaperRouteSelections','answers','docAnswers','workpaperLocks','industryTag','workpaperReuseProvenance','autoFillProvenance','workpaperReuseTemplates','supplementalWorkpapers']);
 const POLICY=Object.freeze({scope:'single-project-saved-workpapers',originalArchivesPreserved:true,supplementalOriginalsPreserved:true,savedEntriesPreserved:true,existingFreezeSnapshotsPreserved:true,includesQuoteContractInvoiceReportData:false,includesMaterialOriginals:false,teamImported:false,identityAuthenticated:false,professionalApprovalClaimed:false});
 const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true}),cryptoLib=typeof module==='object'&&module.exports?require('node:crypto').webcrypto:root.crypto;
 const fail=message=>{throw Error('完整底稿包：'+message);};
 const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
 const plain=x=>x!==null&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype;
 const define=(o,k,value)=>Object.defineProperty(o,k,{value,enumerable:true,configurable:true,writable:true});
 function exact(value,keys){if(!plain(value))fail('对象结构无效。');const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail('字段缺失、额外或包含活动属性。');return ds;}
 function copy(value,{blobs=false}={}){
  let nodes=0,total=0;const seen=new Set();
  function walk(v,depth){
   if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail('数据层级或数量超限。');
   if(v===null||typeof v==='boolean')return v;
   if(typeof v==='string'){if(!v.isWellFormed())fail('文字编码无效。');total+=enc.encode(v).length;if(total>RECORD_MAX)fail('填写数据过大。');return v;}
   if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail('数字无效。');return v;}
   if(blobs&&typeof root.Blob==='function'&&v instanceof root.Blob)return root.Blob.prototype.slice.call(v,0,undefined,Object.getOwnPropertyDescriptor(root.Blob.prototype,'type').get.call(v));
   if(typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&!plain(v))fail('只能保存被动数据。');
   seen.add(v);const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds),array=Array.isArray(v),out=array?[]:{};
   if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(?:0|[1-9]\d*)$/.test(k)||Number(k)>=v.length))))fail('数组存在空洞或额外属性。');
   for(const k of keys){if(array&&k==='length')continue;if(typeof k!=='string'||!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))fail('字段包含活动属性。');walk(k,depth+1);define(out,k,walk(ds[k].value,depth+1));}
   seen.delete(v);return out;
  }return walk(value,0);
 }
 function jsonBytes(value,max){const bytes=enc.encode(JSON.stringify(copy(value)));if(bytes.length>max)fail('JSON字节超过限制。');return bytes;}
 function parseJson(bytes,max){if(!(bytes instanceof Uint8Array)||bytes.length>max)fail('JSON大小无效。');let text,value;try{text=dec.decode(bytes);value=JSON.parse(text);}catch{fail('JSON编码无效。');}if(!equal(jsonBytes(value,max),bytes))fail('JSON不是原规范编码或含重复字段。');return value;}
 function iso(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('保存时间无效。');return v;}
 async function sha(bytes){if(!cryptoLib?.subtle)fail('缺少SHA256组件。');return Array.from(new Uint8Array(await cryptoLib.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
 async function ownBytes(input,max){if(input instanceof Uint8Array){if(input.byteLength>max)fail('文件超过限制。');return Uint8Array.from(input);}if(!(input instanceof root.Blob))fail('请选择完整底稿包文件。');const size=Object.getOwnPropertyDescriptor(root.Blob.prototype,'size').get.call(input);if(size>max)fail('文件超过限制。');const bytes=new Uint8Array(await root.Blob.prototype.arrayBuffer.call(input));if(bytes.length!==size)fail('读取长度变化。');return bytes;}
 function project(record,{projecting=false}={}){
  if(!plain(record))fail('项目记录无效。');let out;
  if(projecting){const ds=Object.getOwnPropertyDescriptors(record);out={};for(const key of FIELDS)if(Object.hasOwn(ds,key)){if(!Object.hasOwn(ds[key],'value')||!ds[key].enumerable)fail('底稿字段包含活动属性。');define(out,key,ds[key].value);}}else{if(Reflect.ownKeys(record).some(k=>!FIELDS.includes(k)))fail('混入非底稿模块数据。');out=record;}
  out=copy(out,{blobs:true});if(out.id===TRIAL_ID||!UUID.test(out.id??'')||typeof out.id!=='string'||!Number.isSafeInteger(out.rev)||out.rev<1)fail('只接收已保存正式项目底稿。');if(Object.hasOwn(out,'updatedAt'))iso(out.updatedAt);
  for(const key of ['choices','directoryRevisions','workpaperSources','workpaperRouteSelections','answers','docAnswers','workpaperLocks','workpaperReuseProvenance','autoFillProvenance','workpaperReuseTemplates'])if(out[key]!==undefined&&!plain(out[key]))fail('底稿映射字段结构无效。');
  for(const key of ['index','riskIndex'])if(out[key]!==undefined&&(!Array.isArray(out[key])||out[key].length>512))fail('原ZIP索引结构无效。');
  if(out.industryTag!==undefined&&(typeof out.industryTag!=='string'||out.industryTag.length>80||/[\u0000-\u001f]/.test(out.industryTag)))fail('行业标签无效。');
  if(out.workpaperSources!==undefined&&(!plain(out.workpaperSources)||Object.keys(out.workpaperSources).length>16))fail('原包来源数量无效。');
  if(out.workpaperLocks!==undefined&&(!plain(out.workpaperLocks)||Object.keys(out.workpaperLocks).length>512))fail('冻结快照数量无效。');return out;
 }
 function originals(record){
  const out=[];function archive(value){if(value===undefined||value===null)return;if(!plain(value)||typeof value.name!=='string'||!value.name||value.name.length>500||typeof value.hash!=='string'||!HASH.test(value.hash))fail('原ZIP元数据无效。');out.push({parent:value,key:'blob',sha256:value.hash,max:LIMITS.archiveBytes,kind:'archive'});}
  archive(record.archive);archive(record.riskArchive);
  for(const [key,value]of Object.entries(record.workpaperSources||{})){if(!HASH.test(key)||!plain(value)||value.archive?.hash!==key||!Array.isArray(value.index)||value.index.length>512)fail('来源原包身份或索引无效。');archive(value.archive);}
  if(out.length>LIMITS.archives)fail('原ZIP数量超限。');
  const supplements=record.supplementalWorkpapers;if(supplements!==undefined&&(!Array.isArray(supplements)||supplements.length>LIMITS.supplements))fail('补充底稿数量无效。');
  for(const value of supplements||[]){if(!plain(value)||!plain(value.file)||!HASH.test(value.file.sha256??''))fail('补充底稿元数据无效。');out.push({parent:value.file,key:'blob',sha256:value.file.sha256,max:LIMITS.supplementBytes,kind:'supplement'});}return out;
 }
 function assertRecord(record){if(!G?.assertTransition||!Supplemental?.validateShape)fail('原冻结或补充底稿校验组件未加载。');G.assertTransition({id:record.id},record);if(record.supplementalWorkpapers!==undefined)Supplemental.validateShape(record.supplementalWorkpapers);}
 async function encodeRecord(input,check){
  const record=project(input,{projecting:true}),references=originals(record),files=new Map();let logicalSupplementBytes=0;
  for(const ref of references){check();if(!(ref.parent[ref.key] instanceof root.Blob))fail('原件字节缺失。');const blob=ref.parent[ref.key],size=blob.size;if(size<1||size>ref.max)fail('单份原件大小无效。');if(ref.kind==='supplement')logicalSupplementBytes+=size;if(logicalSupplementBytes>LIMITS.supplementTotalBytes)fail('补充原件总量超限。');
   const bytes=await ownBytes(blob,ref.max);check();const digest=await sha(bytes);check();if(digest!==ref.sha256)fail('原件SHA256不一致。');const entry='originals/'+digest+'.bin';if(!files.has(entry))files.set(entry,{name:entry,bytes});
  }
  if([...files.values()].reduce((n,x)=>n+x.bytes.length,0)>FILES_MAX)fail('原件总量超限。');assertRecord(record);
  const stored=copy(record,{blobs:true}),storedRefs=originals(stored);
  for(const ref of storedRefs){const blob=ref.parent[ref.key];ref.parent[ref.key]={entry:'originals/'+ref.sha256+'.bin',bytes:blob.size,sha256:ref.sha256,mime:blob.type};}
  const bytes=jsonBytes(stored,RECORD_MAX);return{record,bytes,files:[...files.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)};
 }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{let value=n;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
  function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=(value>>>8)^crcTable[(value^byte)&255];return (value^0xffffffff)>>>0;}
  function memberName(name){if(name!=='manifest.json'&&name!=='record.json'&&!/^originals\/[0-9a-f]{64}\.bin$/u.test(name))fail('ZIP含未知成员或不安全路径。');return name;}
  function memberMaximum(name){return name==='manifest.json'?MANIFEST_MAX:name==='record.json'?RECORD_MAX:FILE_MAX;}
  function zip(entries){
    const seen=new Set();let localSize=0,centralSize=0;
    const rows=entries.map(({name,bytes})=>{memberName(name);if(seen.has(name.toLowerCase()))fail('ZIP成员重复。');seen.add(name.toLowerCase());if(bytes.length>memberMaximum(name))fail('ZIP成员超过大小限制。');const encoded=enc.encode(name),offset=localSize;localSize+=30+encoded.length+bytes.length;centralSize+=46+encoded.length;return {name,bytes,encoded,offset,crc:crc32(bytes)};});
    const total=localSize+centralSize+22;if(rows.length>COUNT_MAX+2||total>PACKAGE_MAX)fail('ZIP超过底稿包大小或成员数量限制。');
    const out=new Uint8Array(total),view=new DataView(out.buffer);let at=0;
    for(const row of rows){view.setUint32(at,0x04034b50,true);view.setUint16(at+4,20,true);view.setUint16(at+6,0x800,true);view.setUint16(at+8,0,true);view.setUint16(at+10,0,true);view.setUint16(at+12,0x21,true);view.setUint32(at+14,row.crc,true);view.setUint32(at+18,row.bytes.length,true);view.setUint32(at+22,row.bytes.length,true);view.setUint16(at+26,row.encoded.length,true);out.set(row.encoded,at+30);out.set(row.bytes,at+30+row.encoded.length);at+=30+row.encoded.length+row.bytes.length;}
    for(const row of rows){view.setUint32(at,0x02014b50,true);view.setUint16(at+4,20,true);view.setUint16(at+6,20,true);view.setUint16(at+8,0x800,true);view.setUint16(at+10,0,true);view.setUint16(at+12,0,true);view.setUint16(at+14,0x21,true);view.setUint32(at+16,row.crc,true);view.setUint32(at+20,row.bytes.length,true);view.setUint32(at+24,row.bytes.length,true);view.setUint16(at+28,row.encoded.length,true);view.setUint32(at+42,row.offset,true);out.set(row.encoded,at+46);at+=46+row.encoded.length;}
    view.setUint32(at,0x06054b50,true);view.setUint16(at+8,rows.length,true);view.setUint16(at+10,rows.length,true);view.setUint32(at+12,centralSize,true);view.setUint32(at+16,localSize,true);return out;
  }
  function unzip(bytes){
    if(bytes.length<22||bytes.length>PACKAGE_MAX)fail('ZIP大小无效。');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
    if(view.getUint32(end,true)!==0x06054b50||view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+20,true))fail('ZIP结束记录、卷或注释无效。');
    const count=view.getUint16(end+8,true),centralSize=view.getUint32(end+12,true),centralOffset=view.getUint32(end+16,true);
    if(count<2||count>COUNT_MAX+2||view.getUint16(end+10,true)!==count||centralOffset+centralSize!==end)fail('ZIP目录数量或边界无效。');
    let at=centralOffset,totalOriginals=0;const rows=[],names=new Set();
    for(let i=0;i<count;i++){
      if(at+46>end||view.getUint32(at,true)!==0x02014b50)fail('ZIP中央目录不完整。');
      const size=view.getUint32(at+24,true),nameLength=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),offset=view.getUint32(at+42,true);
      if(view.getUint16(at+4,true)!==20||view.getUint16(at+6,true)!==20||view.getUint16(at+8,true)!==0x800||view.getUint16(at+10,true)!==0||view.getUint32(at+20,true)!==size||extra||comment||view.getUint16(at+34,true)||view.getUint16(at+36,true)||view.getUint32(at+38,true)||nameLength<1||nameLength>88||at+46+nameLength>end)fail('ZIP版本、压缩、属性、名称或附加字段不受支持。');
      let name;try{name=dec.decode(bytes.subarray(at+46,at+46+nameLength));}catch{fail('ZIP名称不是有效UTF8。');}memberName(name);
      if(names.has(name.toLowerCase())||size>memberMaximum(name)||offset+30>centralOffset)fail('ZIP成员重复、超限或偏移无效。');names.add(name.toLowerCase());
      if(name.startsWith('originals/')){if(size<1)fail('原件不能为空。');totalOriginals+=size;if(totalOriginals>FILES_MAX)fail('底稿原件总量超过限制。');}
      rows.push({name,size,offset,crc:view.getUint32(at+16,true),time:view.getUint16(at+12,true),date:view.getUint16(at+14,true),nameBytes:bytes.subarray(at+46,at+46+nameLength)});at+=46+nameLength;
    }
    if(at!==end)fail('ZIP目录边界或尾随数据无效。');
    let next=0;const members=new Map();
    for(const row of rows.sort((a,b)=>a.offset-b.offset)){
      const pos=row.offset;
      if(pos!==next||pos+30>centralOffset||view.getUint32(pos,true)!==0x04034b50||view.getUint16(pos+4,true)!==20||view.getUint16(pos+6,true)!==0x800||view.getUint16(pos+8,true)!==0||view.getUint16(pos+10,true)!==row.time||view.getUint16(pos+12,true)!==row.date||view.getUint32(pos+14,true)!==row.crc||view.getUint32(pos+18,true)!==row.size||view.getUint32(pos+22,true)!==row.size||view.getUint16(pos+26,true)!==row.nameBytes.length||view.getUint16(pos+28,true))fail('ZIP本地头与中央目录不一致或区域重叠。');
      const start=pos+30+row.nameBytes.length,stop=start+row.size;
      if(stop>centralOffset||!equal(bytes.subarray(pos+30,start),row.nameBytes))fail('ZIP名称或成员范围不一致。');
      const value=bytes.subarray(start,stop);if(crc32(value)!==row.crc)fail('ZIP成员CRC32不一致。');members.set(row.name,value);next=stop;
    }
    if(next!==centralOffset||!members.has('manifest.json')||!members.has('record.json'))fail('ZIP缺少清单、记录或存在额外区域。');return members;
  }

 async function decodeRecord(stored,members,check){
  const record=project(stored),refs=originals(record),used=new Set();let supplementalBytes=0;
  for(const ref of refs){const value=ref.parent[ref.key];exact(value,['entry','bytes','sha256','mime']);const entry='originals/'+ref.sha256+'.bin';if(value.entry!==entry||value.sha256!==ref.sha256||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>ref.max||typeof value.mime!=='string'||value.mime.length>150)fail('原件引用无效。');const bytes=members.get(entry);if(!bytes||bytes.length!==value.bytes)fail('原件缺失或长度不符。');if(ref.kind==='supplement')supplementalBytes+=value.bytes;if(supplementalBytes>LIMITS.supplementTotalBytes)fail('补充原件总量超限。');check();if(await sha(bytes)!==value.sha256)fail('原件SHA256不一致。');check();used.add(entry);ref.parent[ref.key]=new root.Blob([bytes],{type:value.mime});if(ref.parent[ref.key].type!==value.mime)fail('原件MIME不是规范编码。');}
  if(members.size!==used.size+2)fail('包内存在未声明原件或额外成员。');assertRecord(record);return record;
 }
 async function create(options){
  const keys=['record','readCurrent',...(Object.hasOwn(options??{},'assertCurrent')?['assertCurrent']:[]),...(Object.hasOwn(options??{},'createdAt')?['createdAt']:[])],fields=exact(options,keys),check=fields.assertCurrent?.value??(()=>{}),readCurrent=fields.readCurrent.value;
  if(typeof check!=='function'||typeof readCurrent!=='function')fail('当前项目核验接口无效。');check();const first=await encodeRecord(fields.record.value,check);check();
  const manifest={format:FORMAT,schemaVersion:VERSION,packageId:cryptoLib.randomUUID(),createdAt:iso(fields.createdAt?.value??new Date().toISOString()),sourceProjectId:first.record.id,workspaceRevision:first.record.rev,record:{entry:'record.json',bytes:first.bytes.length,sha256:await sha(first.bytes)},files:[],policy:{...POLICY}};check();
  for(const file of first.files)manifest.files.push({entry:file.name,bytes:file.bytes.length,sha256:file.name.slice(10,-4)});
  const bytes=zip([{name:'manifest.json',bytes:jsonBytes(manifest,MANIFEST_MAX)},{name:'record.json',bytes:first.bytes},...first.files]),digest=await sha(bytes);check();
  const current=await readCurrent();check();const final=await encodeRecord(current,check);check();if(!equal(first.bytes,final.bytes))fail('项目底稿在导出期间已改变，未发布旧包。');
  return{blob:new root.Blob([bytes],{type:'application/zip'}),bytes,manifest,sha256:digest,summary:{projectId:first.record.id,workspaceRevision:first.record.rev,originalCount:first.files.length,originalBytes:first.files.reduce((n,x)=>n+x.bytes.length,0),freezeCount:Object.keys(first.record.workpaperLocks||{}).length}};
 }
 async function inspect(input,options={}){
  const fields=exact(options,Object.hasOwn(options,'assertCurrent')?['assertCurrent']:[]),check=fields.assertCurrent?.value??(()=>{});if(typeof check!=='function')fail('当前项目核验接口无效。');check();const bytes=await ownBytes(input,PACKAGE_MAX);check();const members=unzip(bytes),manifest=parseJson(members.get('manifest.json'),MANIFEST_MAX),stored=parseJson(members.get('record.json'),RECORD_MAX);
  exact(manifest,['format','schemaVersion','packageId','createdAt','sourceProjectId','workspaceRevision','record','files','policy']);exact(manifest.record,['entry','bytes','sha256']);exact(manifest.policy,Object.keys(POLICY));
  if(manifest.format!==FORMAT||manifest.schemaVersion!==VERSION||!UUID.test(manifest.packageId??'')||Object.keys(POLICY).some(k=>manifest.policy[k]!==POLICY[k])||manifest.sourceProjectId!==stored.id||manifest.workspaceRevision!==stored.rev||manifest.record.entry!=='record.json'||manifest.record.bytes!==members.get('record.json').length||!HASH.test(manifest.record.sha256??'')||!Array.isArray(manifest.files)||manifest.files.length>COUNT_MAX)fail('清单身份、版本或策略无效。');iso(manifest.createdAt);check();if(await sha(members.get('record.json'))!==manifest.record.sha256)fail('填写记录SHA256不一致。');check();
  const declared=new Set();let previous='';for(const file of manifest.files){exact(file,['entry','bytes','sha256']);if(typeof file.sha256!=='string'||!HASH.test(file.sha256)||file.entry!=='originals/'+file.sha256+'.bin'||file.entry<=previous||declared.has(file.entry)||!Number.isSafeInteger(file.bytes)||file.bytes<1||members.get(file.entry)?.length!==file.bytes)fail('原件清单重复、缺失或不一致。');previous=file.entry;declared.add(file.entry);}
  if(members.size!==declared.size+2)fail('存在清单外原件。');const record=await decodeRecord(stored,members,check);check();const digest=await sha(bytes);check();return{manifest,record,sha256:digest,summary:{projectId:record.id,workspaceRevision:record.rev,originalCount:declared.size,originalBytes:manifest.files.reduce((n,x)=>n+x.bytes,0),freezeCount:Object.keys(record.workpaperLocks||{}).length}};
 }
 return Object.freeze({FORMAT,VERSION,TRIAL_ID,LIMITS,FIELDS,POLICY,create,inspect});
});
