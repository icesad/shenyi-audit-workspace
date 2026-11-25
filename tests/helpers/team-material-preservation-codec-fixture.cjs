'use strict';
const {createHash,randomUUID}=require('node:crypto');
const F=require('./material-preservation-security-fixture.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ORIGIN=['teamId','projectId','sourceProjectId','resourceKind','projectStatus','projectRevision','materialRevision','recordSha256','recordByteLength','filesSha256','serverId','planSha256'];
function source(record,changes={}){
 const raw=Buffer.from(JSON.stringify(record)),files=F.M.filesFor(record);
 const plan={teamId:'synthetic_team',projectId:F.OTHER,sourceProjectId:record.project.quoteId,resourceKind:'collection-workspace',projectStatus:'frozen',projectRevision:Number.MAX_SAFE_INTEGER,materialRevision:Number.MAX_SAFE_INTEGER,recordSha256:sha(raw),recordSchema:record.schema,recordRevision:record.revision,generationId:record.generationId??null,recordByteLength:raw.length,fileCount:files.length,originalByteLength:files.reduce((sum,file)=>sum+file.size,0),filesSha256:sha(Buffer.from(F.canonical(files))),packageByteLimit:180*1024*1024,serverId:'bd636309-29a2-44c5-94bd-779ea5e29705',...changes};
 plan.planSha256=sha(Buffer.from(F.canonical(plan)));
 return {plan,origin:Object.fromEntries(ORIGIN.map(key=>[key,plan[key]]))};
}
async function createTeam(f=F.fixture(),overrides={}){
 const {origin}=source(f.record);return F.M.createTeam({record:f.record,origin,readFile:f.readFile,readCurrent:async()=>({record:f.record,origin}),assertCurrent(){},createdAt:F.NOW,...overrides});
}
async function rewrite(made,change){const entries=F.unzip(await F.bytes(made.blob));change(entries);return F.zip(entries);}
// The old professional model caps all events, including its initial import, at
// 5000. Spread history over leaves to retain its ten-current-files constraint.
function many(count=4999){
 const nodes=Array.from({length:Math.ceil(count/10)},(_,i)=>({id:'n'+(i+1),parentId:'',level:1,title:'合成资料 '+i,description:'',kind:'material'}));
 const record=F.A.createTree(F.project(F.P),nodes,'历史录入人'),data=Buffer.from('x'),hash=sha(data),originals=[];
 for(let i=0;i<count;i++){
  const nodeId='n'+(Math.floor(i/10)+1),metadata={id:randomUUID(),nodeId,generationId:record.generationId,name:'合成-'+i+'.txt',size:1,type:'text/plain',sha256:hash,at:F.NOW,reviewer:'历史录入人'},before=structuredClone(record.states[nodeId]);
  record.attachments[nodeId].push(metadata);
  const after={status:'received',evidence:'附件：'+record.attachments[nodeId].map(file=>file.id).join('、'),reason:'',reviewer:metadata.reviewer,at:F.NOW};
  record.states[nodeId]=after;record.events.push({type:'attachment-add',nodeId,at:F.NOW,reviewer:metadata.reviewer,file:metadata,before,after});originals.push({metadata,data});
 }
 record.revision=record.events.length;const map=new Map(originals.map(file=>[file.metadata.id,file]));
 return {record,originals,readFile:async meta=>{const file=map.get(meta.id);return {metadata:file.metadata,blob:new Blob([file.data],{type:meta.type})};}};
}
module.exports={...F,ORIGIN,source,createTeam,rewrite,many};
