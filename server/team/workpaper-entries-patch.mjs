import governance from '../../dist/workpaper-governance.js';
import {workpaperGovernanceView} from './workpaper-governance-view.mjs';
import codec from '../../dist/workpaper-package.js';
import {assertFormChanges} from './workpaper-form-policy.mjs';
import {dataConflict,dataDigest,SHA} from './workpaper-data-policy.mjs';
import {ApiError} from './http-utils.mjs';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,configurable:true,enumerable:true});
function map(object,key){if(!Object.hasOwn(object,key))own(object,key,{});if(!plain(object[key]))dataConflict();return object[key];}
export function applyWorkpaperEntries(previous,hash,form,changes,{at,actorName,verifiedOriginals}={}){
 if(!SHA.test(hash??'')||hash.length!==64||form.sha256!==hash)dataConflict();
 try{assertFormChanges(form,changes);}catch{throw new ApiError(422,'WORKPAPER_ENTRY_INVALID','填写位置、内容或原表保护校验未通过，未保存。');}
 if(!Number.isSafeInteger(previous.rev)||previous.rev<1||previous.rev>=Number.MAX_SAFE_INTEGER)dataConflict();
 const next=JSON.parse(JSON.stringify(previous)),storage=form.kind==='excel'?'answers':'docAnswers';let changed=0;
 for(const change of changes){const sheet=form.kind==='excel'?change.sheet:undefined;if(governance.isLocked(previous,hash,sheet))throw new ApiError(409,'WORKPAPER_FROZEN','底稿已核对冻结，未保存修改。');const files=map(next,storage),answers=map(files,hash),target=form.kind==='excel'?map(answers,change.sheet):answers;
  if(Object.hasOwn(target,change.field)&&target[change.field]===change.value)continue;
  Object.assign(next,governance.noteManualEdit(next,hash,sheet,change.field,actorName));own(target,change.field,change.value);changed++;
 }
 if(!changed)throw new ApiError(409,'WORKPAPER_NO_CHANGE','填写与当前已保存内容一致，未新增版本。');
 next.rev=previous.rev+1;next.updatedAt=new Date(at).toISOString();try{governance.assertTransition(workpaperGovernanceView(previous,verifiedOriginals),workpaperGovernanceView(next,verifiedOriginals));}catch{throw new ApiError(409,'WORKPAPER_FROZEN','既有冻结快照或来源必须保持，未保存修改。');}
 const recordJson=JSON.stringify(next);if(Buffer.byteLength(recordJson)>codec.LIMITS.recordBytes)throw new ApiError(413,'WORKPAPER_RECORD_TOO_LARGE','保存后的底稿记录超过大小限制，未新增版本。');return{record:next,recordJson,recordSha256:dataDigest(recordJson),changed};
}