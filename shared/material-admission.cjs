'use strict';
// Same legacy body gate on the server, with a DOM parser supplied explicitly.
// JSDOM parses inert XML only. No script execution, URL or resource loading.
const {JSDOM}=require('jsdom');
const {createHash}=require('node:crypto');
const Checklist=require('../dist/audit-checklist.js');
const Preservation=require('../dist/material-preservation.js');
const parserWindow=new JSDOM('').window;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inspectMaterialPackage(input,{assertCurrent=()=>{}}={}){
 if(typeof assertCurrent!=='function')throw Error('Material context guard is required');
 assertCurrent();const result=await Preservation.inspect(input,{assertCurrent});assertCurrent();
 if(result.manifest.format!=='shenyi-material-preservation'||result.manifest.schemaVersion!==1||result.manifest.policy.teamImported!==false)throw Error('团队迁入目前仅支持本机v1资料保全包；团队v2保全包仅供显式本机恢复。');
 if(result.summary.sourceNamespace!=='hengdu.audit.materials.v1'||result.record.project.quoteId===Checklist.TRIAL_ID)throw Error('独立试用包不能迁入正式团队项目。');
 for(const file of result.files){
  assertCurrent();const meta=file.metadata,body=file.blob;
  const admitted=await Checklist.prepareFile({name:meta.name,type:meta.type,size:body.size,arrayBuffer:()=>body.arrayBuffer()},{DOMParser:parserWindow.DOMParser});
  assertCurrent();if(admitted.name!==meta.name||admitted.type!==meta.type||admitted.size!==meta.size||admitted.sha256!==meta.sha256)throw Error('历史原件正文准入与来源元数据不一致，未迁入。');
 }
 const recordJson=JSON.stringify(result.record),recordSha256=digest(Buffer.from(recordJson,'utf8'));
 if(recordSha256!==result.manifest.record.sha256||Buffer.byteLength(recordJson,'utf8')!==result.manifest.record.bytes)throw Error('原始清单字节不一致，未迁入。');
 assertCurrent();return {...result,recordJson,recordSha256};
}
async function prepareMaterialFile(input,{assertCurrent=()=>{}}={}){
 if(typeof assertCurrent!=='function')throw Error('Material context guard is required');
 assertCurrent();const result=await Checklist.prepareFile(input,{DOMParser:parserWindow.DOMParser});assertCurrent();return result;
}
module.exports={inspectMaterialPackage,prepareMaterialFile};
