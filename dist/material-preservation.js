/* Single-project material preservation. No team ownership or audit approval. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root,require('./audit-checklist.js'));
  else root.MaterialPreservation=factory(root,root.AuditChecklist);
})(globalThis,function(root,checklist){
  'use strict';
  const FORMAT='shenyi-material-preservation',VERSION=1,FORMAL='hengdu.audit.materials.v1',TRIAL='hengdu.audit.materials.trial.v1';
  const FILE_MAX=100*1024*1024,FILES_MAX=150*1024*1024,RECORD_MAX=24*1024*1024,MANIFEST_MAX=4*1024*1024,PACKAGE_MAX=180*1024*1024,COUNT_MAX=5000;
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,HASH=/^[a-f0-9]{64}$/u;
  const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
  const POLICY=Object.freeze({scope:'single-project-material-record-and-all-referenced-originals',completeAttachmentHistory:true,includesRemovedAttachments:true,includesPriorGenerations:true,includesOriginalChecklistDocument:false,includesWorkpaperArchives:false,includesOtherDatabases:false,teamImported:false,identityAuthenticated:false,professionalApprovalClaimed:false});
  const TEAM_POLICY=Object.freeze({...POLICY,teamImported:true});
  const ORIGIN_KEYS=Object.freeze(['teamId','projectId','sourceProjectId','resourceKind','projectStatus','projectRevision','materialRevision','recordSha256','recordByteLength','filesSha256','serverId','planSha256']);
  const fail=message=>{throw Error('资料保全包：'+message);};
  function exact(value,keys){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('对象结构无效。');
    const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
    if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value')))fail('存在缺失或未知字段。');
    return descriptors;
  }
  function plainCopy(input,{sort=false,max=RECORD_MAX}={}){
    let nodes=0,characters=0;const ancestors=new WeakSet();
    function walk(value,depth){
      if(++nodes>2000000||depth>64)fail('JSON结构过大或过深。');
      if(value===null||typeof value==='boolean')return value;
      if(typeof value==='number'){if(!Number.isSafeInteger(value))fail('JSON数字不是安全整数。');return value;}
      if(typeof value==='string'){characters+=value.length;if(!value.isWellFormed()||characters>max)fail('JSON文字无效或超限。');return value;}
      if(!value||typeof value!=='object'||ancestors.has(value))fail('JSON含不支持的数据或循环引用。');
      const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
      if(!array&&prototype!==Object.prototype&&prototype!==null)fail('JSON不是普通数据对象。');
      const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
      if(keys.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)||key!=='length'&&(!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value'))))fail('JSON含非数据字段。');
      ancestors.add(value);
      try{
        if(array){
          if(keys.length!==value.length+1||keys.some(key=>key!=='length'&&!/^(?:0|[1-9]\d*)$/u.test(key)))fail('JSON数组含空位或额外字段。');
          return Array.from({length:value.length},(_,i)=>{if(!Object.hasOwn(descriptors,String(i)))fail('JSON数组存在空位。');return walk(descriptors[i].value,depth+1);});
        }
        const out={};for(const key of sort?keys.sort():keys)out[key]=walk(descriptors[key].value,depth+1);return out;
      }finally{ancestors.delete(value);}
    }
    return walk(input,0);
  }
  function jsonBytes(value,maximum,sort=false){const bytes=enc.encode(JSON.stringify(plainCopy(value,{sort,max:maximum})));if(bytes.length>maximum)fail('JSON字节超过范围。');return bytes;}
  function parseJson(bytes,maximum,sort=false){
    if(bytes.length>maximum||bytes.length>=3&&bytes[0]===239&&bytes[1]===187&&bytes[2]===191)fail('JSON大小或UTF8 BOM无效。');
    let text,value;try{text=dec.decode(bytes);value=JSON.parse(text);}catch{fail('JSON不是有效UTF8或格式错误。');}
    const canonical=jsonBytes(value,maximum,sort);
    if(!equal(bytes,canonical))fail('JSON不是规范紧凑格式，或存在重复键。');return value;
  }
  function equal(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
  async function sha(bytes){if(!root.crypto?.subtle)fail('当前环境缺少SHA256校验。');return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}
  function checkedRecord(value){
    if(typeof checklist?.validate!=='function'||typeof checklist?.leafNodes!=='function')fail('原资料校验组件未载入。');
    const record=plainCopy(value),bytes=jsonBytes(record,RECORD_MAX);
    checklist.validate(record);return {record,bytes,signature:JSON.stringify(record)};
  }
  function history(record){
    const files=record.schema===2?record.events.filter(event=>event.type==='attachment-add').map(event=>plainCopy(event.file)):[];
    if(files.length>COUNT_MAX)fail('原件数量超过5000份。');
    const seen=new Set();let total=0;
    for(const file of files){const id=file.id.toLowerCase();if(seen.has(id))fail('原件UUID重复。');seen.add(id);total+=file.size;if(total>FILES_MAX)fail('历史原件总量超过150MiB。');}
    return files;
  }
  function filesFor(record){return history(checkedRecord(record).record);}
  function namespace(record){return record.project.quoteId===checklist.TRIAL_ID?TRIAL:FORMAL;}
  function summary(record,files,packageSha256){
    const current=record.schema===2?checklist.leafNodes(record).reduce((count,node)=>count+record.attachments[node.id].length,0):0;
    return {projectId:record.project.quoteId,projectName:record.project.projectName,firmName:record.project.firmName,sourceNamespace:namespace(record),recordSchema:record.schema,revision:record.revision,generationId:record.schema===2?record.generationId:null,closed:record.closed!==null,nodeCount:record.schema===2?record.nodes.length:record.items.length,fileCount:files.length,currentFileCount:current,historicalFileCount:files.length-current,totalBytes:files.reduce((sum,file)=>sum+file.size,0),packageSha256};
  }
  function iso(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('导出时间无效。');return value;}
  function originCopy(value){exact(value,ORIGIN_KEYS);return plainCopy(value,{max:MANIFEST_MAX});}
  async function checkOrigin(origin,record,recordBytes,metadata,recordHash,check){
    if(namespace(record)!==FORMAL||origin.sourceProjectId!==record.project.quoteId||typeof origin.projectId!=='string'||!UUID.test(origin.projectId)||typeof origin.serverId!=='string'||!UUID.test(origin.serverId)||typeof origin.teamId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(origin.teamId)||!['legacy','collection-workspace'].includes(origin.resourceKind)||origin.resourceKind==='legacy'&&origin.projectId!==origin.sourceProjectId||!['active','frozen'].includes(origin.projectStatus)||!['projectRevision','materialRevision'].every(key=>Number.isSafeInteger(origin[key])&&origin[key]>=1)||origin.recordByteLength!==recordBytes.length||origin.recordSha256!==recordHash||!HASH.test(origin.filesSha256)||!HASH.test(origin.planSha256))fail('团队来源、W/Q绑定或记录摘要无效。');
    check();const filesHash=await sha(jsonBytes(metadata,RECORD_MAX,true));check();
    if(filesHash!==origin.filesSha256)fail('团队历史原件元数据摘要不一致。');
    const {planSha256,...fields}=origin,plan={...fields,recordSchema:record.schema,recordRevision:record.revision,generationId:record.schema===2?record.generationId:null,fileCount:metadata.length,originalByteLength:metadata.reduce((sum,file)=>sum+file.size,0),packageByteLimit:PACKAGE_MAX};
    check();const planHash=await sha(jsonBytes(plan,MANIFEST_MAX,true));check();
    if(planHash!==planSha256)fail('团队导出计划摘要不一致。');
  }
  async function ownBytes(input,maximum){
    if(input instanceof Uint8Array){if(input.byteLength>maximum)fail('输入文件超过大小限制。');return Uint8Array.from(input);}
    if(typeof root.Blob!=='function'||!(input instanceof root.Blob)||!Number.isSafeInteger(input.size)||input.size>maximum)fail('请选择大小符合限制的Blob或Uint8Array文件。');
    const result=Uint8Array.from(new Uint8Array(await input.arrayBuffer()));if(result.length>maximum||result.length!==input.size)fail('输入文件大小已改变或超过限制。');return result;
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{let value=n;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
  function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=(value>>>8)^crcTable[(value^byte)&255];return (value^0xffffffff)>>>0;}
  function memberName(name){if(name!=='manifest.json'&&name!=='record.json'&&!/^originals\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/iu.test(name))fail('ZIP含未知成员或不安全路径。');return name;}
  function memberMaximum(name){return name==='manifest.json'?MANIFEST_MAX:name==='record.json'?RECORD_MAX:FILE_MAX;}
  function zip(entries){
    const seen=new Set();let localSize=0,centralSize=0;
    const rows=entries.map(({name,bytes})=>{memberName(name);if(seen.has(name.toLowerCase()))fail('ZIP成员重复。');seen.add(name.toLowerCase());if(bytes.length>memberMaximum(name))fail('ZIP成员超过大小限制。');const encoded=enc.encode(name),offset=localSize;localSize+=30+encoded.length+bytes.length;centralSize+=46+encoded.length;return {name,bytes,encoded,offset,crc:crc32(bytes)};});
    const total=localSize+centralSize+22;if(rows.length>COUNT_MAX+2||total>PACKAGE_MAX)fail('ZIP超过180MiB或5002成员限制。');
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
      if(view.getUint16(at+4,true)!==20||view.getUint16(at+6,true)!==20||view.getUint16(at+8,true)!==0x800||view.getUint16(at+10,true)!==0||view.getUint32(at+20,true)!==size||extra||comment||view.getUint16(at+34,true)||view.getUint16(at+36,true)||view.getUint32(at+38,true)||nameLength<1||nameLength>64||at+46+nameLength>end)fail('ZIP版本、压缩、属性、名称或附加字段不受支持。');
      let name;try{name=dec.decode(bytes.subarray(at+46,at+46+nameLength));}catch{fail('ZIP名称不是有效UTF8。');}memberName(name);
      if(names.has(name.toLowerCase())||size>memberMaximum(name)||offset+30>centralOffset)fail('ZIP成员重复、超限或偏移无效。');names.add(name.toLowerCase());
      if(name.startsWith('originals/')){if(size<1)fail('原件不能为空。');totalOriginals+=size;if(totalOriginals>FILES_MAX)fail('历史原件超过150MiB。');}
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
  async function create(options){
    const fields=exact(options,['record','readFile','readCurrent',...(Object.hasOwn(options,'createdAt')?['createdAt']:[])]),readFile=fields.readFile.value,readCurrent=fields.readCurrent.value;
    if(typeof readFile!=='function'||typeof readCurrent!=='function')fail('缺少原件读取或最终源记录复查。');
    const {record,bytes:recordBytes,signature}=checkedRecord(fields.record.value),metadata=history(record),createdAt=iso(fields.createdAt?.value??new Date().toISOString());
    if(typeof root.crypto?.randomUUID!=='function')fail('当前环境缺少安全包ID生成。');
    const manifest={format:FORMAT,schemaVersion:VERSION,packageId:root.crypto.randomUUID(),createdAt,sourceNamespace:namespace(record),projectId:record.project.quoteId,
      record:{entry:'record.json',schema:record.schema,revision:record.revision,generationId:record.schema===2?record.generationId:null,bytes:recordBytes.length,sha256:await sha(recordBytes)},files:[],policy:{...POLICY}},originals=[];
    for(const meta of metadata){
      const result=await readFile(plainCopy(meta)),data=exact(result,['blob','metadata']),returned=plainCopy(data.metadata.value);
      if(JSON.stringify(returned)!==JSON.stringify(meta)||typeof root.Blob!=='function'||!(data.blob.value instanceof root.Blob)||data.blob.value.size!==meta.size||data.blob.value.type!==meta.type)fail('历史原件元数据、归属、类型或大小不一致。');
      const bytes=await ownBytes(data.blob.value,FILE_MAX);if(bytes.length!==meta.size||await sha(bytes)!==meta.sha256)fail('历史原件字节或SHA256不一致。');
      const entry='originals/'+meta.id+'.bin';manifest.files.push({id:meta.id,entry,bytes:bytes.length,sha256:meta.sha256});originals.push({name:entry,bytes});
    }
    const manifestBytes=jsonBytes(manifest,MANIFEST_MAX,true),bytes=zip([{name:'manifest.json',bytes:manifestBytes},{name:'record.json',bytes:recordBytes},...originals]),packageSha256=await sha(bytes);
    // The last awaited source read occurs after all file reads and hashing.
    if(checkedRecord(await readCurrent()).signature!==signature)fail('导出期间完整源记录已改变，请刷新后重新保全。');
    return {blob:new root.Blob([bytes],{type:'application/zip'}),manifest,sha256:packageSha256,summary:summary(record,metadata,packageSha256)};
  }
  async function createTeam(options){
    const fields=exact(options,['record','origin','readFile','readCurrent','assertCurrent',...(Object.hasOwn(options,'createdAt')?['createdAt']:[])]),readFile=fields.readFile.value,readCurrent=fields.readCurrent.value,check=fields.assertCurrent.value;
    if(typeof readFile!=='function'||typeof readCurrent!=='function'||typeof check!=='function')fail('缺少团队原件读取、最终复查或当前资格校验。');
    check();const {record,bytes:recordBytes,signature}=checkedRecord(fields.record.value),metadata=history(record),origin=originCopy(fields.origin.value),originSignature=JSON.stringify(plainCopy(origin,{sort:true})),createdAt=iso(fields.createdAt?.value??new Date().toISOString());
    if(typeof root.crypto?.randomUUID!=='function')fail('当前环境缺少安全包ID生成。');
    check();const recordHash=await sha(recordBytes);check();
    check();await checkOrigin(origin,record,recordBytes,metadata,recordHash,check);check();
    const manifest={format:FORMAT,schemaVersion:2,packageId:root.crypto.randomUUID(),createdAt,sourceNamespace:FORMAL,projectId:record.project.quoteId,record:{entry:'record.json',schema:record.schema,revision:record.revision,generationId:record.schema===2?record.generationId:null,bytes:recordBytes.length,sha256:recordHash},files:[],policy:{...TEAM_POLICY},origin},originals=[];
    for(const meta of metadata){
      check();const result=await readFile(plainCopy(meta));check();const data=exact(result,['blob','metadata']),returned=plainCopy(data.metadata.value);
      if(JSON.stringify(returned)!==JSON.stringify(meta)||typeof root.Blob!=='function'||!(data.blob.value instanceof root.Blob)||data.blob.value.size!==meta.size||data.blob.value.type!==meta.type)fail('历史原件元数据、归属、类型或大小不一致。');
      check();const bytes=await ownBytes(data.blob.value,FILE_MAX);check();
      check();const hash=await sha(bytes);check();if(bytes.length!==meta.size||hash!==meta.sha256)fail('历史原件字节或SHA256不一致。');
      const entry='originals/'+meta.id+'.bin';manifest.files.push({id:meta.id,entry,bytes:bytes.length,sha256:meta.sha256});originals.push({name:entry,bytes});
    }
    check();const bytes=zip([{name:'manifest.json',bytes:jsonBytes(manifest,MANIFEST_MAX,true)},{name:'record.json',bytes:recordBytes},...originals]);
    check();const packageSha256=await sha(bytes);check();
    // Recheck the whole joint snapshot once, after all I/O and hashes, not for every original.
    check();const current=await readCurrent();check();const joint=exact(current,['record','origin']);
    if(checkedRecord(joint.record.value).signature!==signature||JSON.stringify(plainCopy(originCopy(joint.origin.value),{sort:true}))!==originSignature)fail('导出期间完整源记录或团队来源已改变，请刷新后重新保全。');
    check();return {blob:new root.Blob([bytes],{type:'application/zip'}),manifest,sha256:packageSha256,summary:summary(record,metadata,packageSha256)};
  }
  async function inspect(input,options){
    const fields=options===undefined?null:exact(options,Object.hasOwn(options,'assertCurrent')?['assertCurrent']:[]),check=fields&&Object.hasOwn(fields,'assertCurrent')?fields.assertCurrent.value:()=>{};
    if(typeof check!=='function')fail('当前资格校验无效。');
    check();const bytes=await ownBytes(input,PACKAGE_MAX);check();const members=unzip(bytes),manifest=parseJson(members.get('manifest.json'),MANIFEST_MAX,true),parsed=parseJson(members.get('record.json'),RECORD_MAX),{record,bytes:recordBytes}=checkedRecord(parsed),metadata=history(record);
    if(![VERSION,2].includes(manifest.schemaVersion))fail('保全包版本不受支持。');
    const team=manifest.schemaVersion===2,policy=team?TEAM_POLICY:POLICY;
    exact(manifest,['format','schemaVersion','packageId','createdAt','sourceNamespace','projectId','record','files','policy',...(team?['origin']:[])]);exact(manifest.record,['entry','schema','revision','generationId','bytes','sha256']);exact(manifest.policy,Object.keys(POLICY));
    if(manifest.format!==FORMAT||!UUID.test(manifest.packageId)||manifest.sourceNamespace!==namespace(record)||manifest.projectId!==record.project.quoteId||Object.keys(policy).some(key=>manifest.policy[key]!==policy[key]))fail('格式、项目、namespace或范围政策不匹配。');iso(manifest.createdAt);
    const reference=manifest.record;check();const recordHash=await sha(recordBytes);check();
    if(reference.entry!=='record.json'||reference.schema!==record.schema||reference.revision!==record.revision||reference.generationId!==(record.schema===2?record.generationId:null)||reference.bytes!==recordBytes.length||!HASH.test(reference.sha256)||recordHash!==reference.sha256||!Array.isArray(manifest.files)||manifest.files.length!==metadata.length||members.size!==metadata.length+2)fail('记录身份、哈希或原件数量不一致。');
    if(team){const origin=originCopy(manifest.origin);check();await checkOrigin(origin,record,recordBytes,metadata,recordHash,check);check();}
    const files=[];
    for(let i=0;i<metadata.length;i++){
      const meta=metadata[i],item=manifest.files[i];exact(item,['id','entry','bytes','sha256']);
      const entry='originals/'+meta.id+'.bin',original=members.get(entry);
      if(item.id!==meta.id||item.entry!==entry||item.bytes!==meta.size||item.sha256!==meta.sha256||!original||original.length!==meta.size)fail('历史原件缺失、额外或元数据/SHA256不一致。');
      check();const hash=await sha(original);check();if(hash!==meta.sha256)fail('历史原件缺失、额外或元数据/SHA256不一致。');
      files.push({metadata:plainCopy(meta),blob:new root.Blob([original],{type:meta.type})});
    }
    check();const packageSha256=await sha(bytes);check();return {manifest,record,files,sha256:packageSha256,summary:summary(record,metadata,packageSha256)};
  }
  return Object.freeze({create,createTeam,inspect,filesFor});
});
