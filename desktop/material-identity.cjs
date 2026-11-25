'use strict';

const FIELDS=Object.freeze(['projectId','projectRevision','materialRevision','recordSha256','record','packageSha256','importedAt','importedBy']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const plain=value=>!!value&&Object.getPrototypeOf(value)===Object.prototype;
function invalid(){const error=new Error('资料的团队目标与原业务身份无法确认，请刷新核对。');error.code='INVALID_RESPONSE';throw error;}

function resolveMaterialIdentity(view,targetW,{requiresMapping}={}){
 if(requiresMapping!==undefined&&typeof requiresMapping!=='boolean'||!ID.test(targetW??'')||!plain(view))invalid();
 const mapped=Object.hasOwn(view,'sourceProjectId'),keys=mapped?[...FIELDS,'sourceProjectId']:FIELDS;
 if(Object.keys(view).length!==keys.length||!keys.every(key=>Object.hasOwn(view,key))||view.projectId!==targetW||requiresMapping!==undefined&&requiresMapping!==mapped||!Number.isSafeInteger(view.projectRevision)||view.projectRevision<1||!Number.isSafeInteger(view.materialRevision)||view.materialRevision<0)invalid();
 const sourceProjectId=mapped?view.sourceProjectId:targetW;
 if(mapped&&!UUID.test(sourceProjectId??''))invalid();
 if(view.materialRevision===0){if(['recordSha256','record','packageSha256','importedAt','importedBy'].some(key=>view[key]!==null))invalid();}
 else if(!plain(view.record)||!plain(view.record.project)||view.record.project.quoteId!==sourceProjectId||!HASH.test(view.recordSha256??'')||!HASH.test(view.packageSha256??''))invalid();
 return Object.freeze({projectId:targetW,sourceProjectId,requiresMapping:mapped,projectRevision:view.projectRevision,materialRevision:view.materialRevision,recordSha256:view.recordSha256,packageSha256:view.packageSha256});
}

function assertSameMaterialIdentity(snapshot,view){
 if(!plain(snapshot))invalid();
 const fresh=resolveMaterialIdentity(view,snapshot.projectId,{requiresMapping:snapshot.requiresMapping});
 if(Object.keys(fresh).some(key=>fresh[key]!==snapshot[key])){const error=new Error('资料身份、记录或权限版本已变化，请重新核对。');error.code='MATERIAL_CHANGED';throw error;}
 return fresh;
}

module.exports=Object.freeze({resolveMaterialIdentity,assertSameMaterialIdentity});
