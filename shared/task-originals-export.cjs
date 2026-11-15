'use strict';
const {createHash}=require('node:crypto');
const FORMAT='shenyi-task-originals-export',MAX_SELECTION=20,MAX_FILE_BYTES=12*1024*1024,MAX_TOTAL_BYTES=64*1024*1024,MAX_MANIFEST_BYTES=128*1024,MAX_PACKAGE_BYTES=66*1024*1024;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,HASH=/^[a-f0-9]{64}$/;
const POLICY=Object.freeze({selectionOnly:true,completeTaskHistory:false,restorableBackup:false,professionalApprovalClaimed:false});
function bad(message='所选资料导出格式或完整性无法确认。'){throw Error(message);}
function exact(value,keys){
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)bad();
  const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);
  if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)||!fields[key].enumerable||!Object.hasOwn(fields[key],'value')))bad();
}
function array(value,min,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<min||value.length>max)bad();
  const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);
  if(names.length!==value.length+1||names.some(key=>key!=='length'&&(!/^(?:0|[1-9]\d*)$/.test(String(key))||Number(key)>=value.length||!fields[key].enumerable||!Object.hasOwn(fields[key],'value'))))bad();
}
function identifier(value){if(typeof value!=='string'||!ID.test(value))bad();return value;}
function integer(value,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<min||value>max)bad();return value;}
function text(value,max,{empty=false,multiline=false}={}){
  if(typeof value!=='string'||value!==value.toWellFormed()||(!empty&&!value.length)||[...value].length>max||(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u:/[\x00-\x1f\x7f]/u).test(value))bad();return value;
}
function selectionIds(value){array(value,1,MAX_SELECTION);const result=value.map(identifier).sort();if(new Set(result).size!==result.length)bad('请选择1至20份不重复的提交记录。');return result;}
function scopeOf(value){
  if(!value||typeof value!=='object')bad();
  const kind=Object.getOwnPropertyDescriptor(value,'kind');if(!kind||!Object.hasOwn(kind,'value'))bad();
  if(kind.value==='own'){exact(value,['kind','teamId','taskId','userId']);return {kind:'own',teamId:identifier(value.teamId),taskId:identifier(value.taskId),userId:identifier(value.userId)};}
  if(kind.value==='project-review'){exact(value,['kind','teamId','projectId','projectRevision','taskId']);return {kind:'project-review',teamId:identifier(value.teamId),projectId:identifier(value.projectId),projectRevision:integer(value.projectRevision,1),taskId:identifier(value.taskId)};}
  bad();
}
function taskOf(value,scope){
  exact(value,['id','title','instructions','status','revision']);
  if(value.id!==scope.taskId||!['open','submitted','returned','closed'].includes(value.status))bad();
  return {id:identifier(value.id),title:text(value.title,160),instructions:text(value.instructions,4000,{empty:true,multiline:true}),status:value.status,revision:integer(value.revision)};
}
function fileOf(value,review){
  exact(value,['id','attachmentId','filename','sha256','byteLength','createdAt',...(review?['submittedBy']:[])]);
  const filename=text(value.filename,180);if(/[\\/]/u.test(filename)||typeof value.sha256!=='string'||!HASH.test(value.sha256))bad();
  const result={id:identifier(value.id),attachmentId:identifier(value.attachmentId),filename,sha256:value.sha256,byteLength:integer(value.byteLength,0,MAX_FILE_BYTES),createdAt:integer(value.createdAt)};
  if(review){exact(value.submittedBy,['id','displayName']);result.submittedBy={id:identifier(value.submittedBy.id),displayName:text(value.submittedBy.displayName,100)};}
  return result;
}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function manifestBytes(manifest){const bytes=Buffer.from(canonical(manifest),'utf8');if(bytes.length>MAX_MANIFEST_BYTES)bad('所选资料清单超过导出容量限制。');return bytes;}
function fields(scopeInput,taskInput,filesInput){
  const scope=scopeOf(scopeInput),task=taskOf(taskInput,scope);array(filesInput,1,MAX_SELECTION);
  const files=filesInput.map(file=>fileOf(file,scope.kind==='project-review')).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(new Set(files.map(file=>file.id)).size!==files.length)bad();
  if(files.reduce((total,file)=>total+file.byteLength,0)>MAX_TOTAL_BYTES)bad('所选原件总量超过64 MiB，请减少本次选择。');
  return {format:FORMAT,schemaVersion:1,scope,task,files,policy:{...POLICY}};
}
function makePlan(value){
  exact(value,['scope','task','files']);const manifest=fields(value.scope,value.task,value.files);return {manifest,sha256:sha(manifestBytes(manifest))};
}
function validatePlan(value){
  exact(value,['manifest','sha256']);exact(value.manifest,['format','schemaVersion','scope','task','files','policy']);
  const input=value.manifest;if(input.format!==FORMAT||input.schemaVersion!==1||typeof value.sha256!=='string'||!HASH.test(value.sha256))bad();
  exact(input.policy,Object.keys(POLICY));if(Object.keys(POLICY).some(key=>input.policy[key]!==POLICY[key]))bad();
  const manifest=fields(input.scope,input.task,input.files);
  if(input.files.some((file,index)=>file.id!==manifest.files[index].id)||sha(manifestBytes(manifest))!==value.sha256)bad();
  return {manifest,sha256:value.sha256};
}
const CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let i=0;i<8;i++)crc=crc>>>1^((crc&1)?0xedb88320:0);return crc>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crc>>>8^CRC_TABLE[(crc^byte)&255];return (crc^0xffffffff)>>>0;}
function zip(entries){
  let offset=0;const local=[],central=[];
  for(const entry of entries){
    const name=Buffer.from(entry.name,'utf8'),size=entry.bytes.length,crc=crc32(entry.bytes),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(size,18);header.writeUInt32LE(size,22);header.writeUInt16LE(name.length,26);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(size,20);directory.writeUInt32LE(size,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,name,entry.bytes);central.push(directory,name);offset+=header.length+name.length+size;
  }
  const directorySize=central.reduce((size,part)=>size+part.length,0),end=Buffer.alloc(22),length=offset+directorySize+end.length;
  if(length>MAX_PACKAGE_BYTES)bad('资料包超过导出容量限制。');
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directorySize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end],length);
}
function create(input,originals){
  const plan=validatePlan(input);array(originals,1,MAX_SELECTION);if(originals.length!==plan.manifest.files.length)bad('所选原件不完整，未生成资料包。');
  const byId=new Map();for(const original of originals){
    exact(original,['id','bytes']);identifier(original.id);
    if(byId.has(original.id)||!(original.bytes instanceof Uint8Array)||(typeof SharedArrayBuffer==='function'&&original.bytes.buffer instanceof SharedArrayBuffer)||original.bytes.byteLength>MAX_FILE_BYTES)bad();
    byId.set(original.id,original.bytes);
  }
  const entries=[{name:'manifest.json',bytes:manifestBytes(plan.manifest)}];
  for(const [index,file] of plan.manifest.files.entries()){
    const inputBytes=byId.get(file.id);if(!inputBytes||inputBytes.byteLength!==file.byteLength)bad('资料原件大小已改变，未生成资料包。');
    const bytes=Buffer.from(inputBytes);if(sha(bytes)!==file.sha256)bad('资料原件完整性校验失败，未生成资料包。');
    entries.push({name:'originals/'+String(index+1).padStart(4,'0')+'-'+file.id+'.bin',bytes});
  }
  const bytes=zip(entries);return {bytes,sha256:sha(bytes),filename:'shenyi-task-'+plan.manifest.task.id+'.zip',fileCount:plan.manifest.files.length,planSha256:plan.sha256};
}
module.exports=Object.freeze({FORMAT,MAX_SELECTION,MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_MANIFEST_BYTES,MAX_PACKAGE_BYTES,selectionIds,makePlan,validatePlan,create});
