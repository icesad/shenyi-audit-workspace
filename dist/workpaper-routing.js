/* Pure, hash-verified directory routing and saved-input progress. No document is executed. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkpaperRouting=api;})(globalThis,function(root){'use strict';
 const own=(o,k)=>o&&typeof o==='object'&&Object.hasOwn(o,k),catalog=()=>root.WorkpaperRouteCatalog||{archives:[],rows:{}};
 function archives(){return catalog().archives||[];}
 function identifyArchive(hash){return typeof hash==='string'?archives().find(a=>a.sha256===hash.toLowerCase())||null:null;}
 function row(number){return catalog().rows?.[String(number)]||{mode:'unmapped',targets:[],reason:'未识别对应的原模板'};}
 function targets(number){return row(number).targets||[];}
 function sourceArray(sources){if(Array.isArray(sources))return sources;if(Array.isArray(sources?.files))return sources.files;return [];}
 function sourceMatch(target,sources){return sourceArray(sources).find(s=>s&&s.available!==false&&(s.path||s.name)===target.path&&typeof s.sha256==='string'&&s.sha256.toLowerCase()===target.sha256)||null;}
 function resolve(number,sources,selectedId){const route=row(number),all=targets(number).map(t=>{const location=sourceMatch(t,sources);return {...t,available:!!location,location};}),chosen=typeof selectedId==='string'?all.find(t=>t.id===selectedId&&t.available):null;
  if(route.mode==='group')return {state:'group',mode:'group',targets:all,selected:null};
  if(!all.length)return {state:'unmapped',mode:route.mode||'unmapped',targets:[],selected:null,reason:route.reason||'未识别对应的原模板'};
  if(chosen)return {state:'ready',mode:'targets',targets:all,selected:chosen};
  if(!all.some(t=>t.available))return {state:'missing',mode:'targets',targets:all,selected:null};
  if(all.length===1&&!route.requiresSelection)return {state:'ready',mode:'targets',targets:all,selected:all[0]};
  return {state:'ambiguous',mode:'targets',targets:all,selected:null};
 }
 function fingerprint(value){let hash=2166136261;const text=String(value).trim().replace(/[\u200b-\u200d\ufeff]/g,'');for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;return hash.toString(16).padStart(8,'0');}
 function validSaved(value,field){if(typeof value==='number')return Number.isFinite(value);if(typeof value!=='string'||value.length>150000||typeof value.isWellFormed==='function'&&!value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))return false;
  const text=value.trim().replace(/[\u200b-\u200d\ufeff]/g,'');if(!text||/^\s*=/.test(text)||/^(?:待填写|未填写|待填|请输入|请选择|请填写)$/i.test(text)||!/[^\s_＿—–\-·.、…:：()（）\[\]【】]/u.test(text))return false;
  if(typeof field?.baselineFingerprint==='string'&&fingerprint(text)===field.baselineFingerprint)return false;if(Array.isArray(field?.emptyValues)&&field.emptyValues.some(v=>String(v).trim()===text))return false;return true;
 }
 function fields(target){if(!target||target.hidden||target.visibility||target.fieldPolicy==='unknown'||!Array.isArray(target.fields))return [];const seen=new Set(),out=[];for(const f of target.fields){const key=typeof f==='string'?f:f?.key;if(typeof key!=='string'||!key||seen.has(key)||f?.locked||f?.hidden)continue;seen.add(key);out.push(typeof f==='string'?{key:f}:f);}return out;}
 function progress(target,savedFileEdits,options={}){if(options.notApplicable)return {state:'na',filled:0,total:0,percent:null};const blocked=target?.incompleteLayout||target?.progressPolicy?.kind==='partial'||catalog().incompleteLayouts?.[target?.sha256];if(blocked)return {state:'unknown',filled:0,total:null,percent:null,reason:'原件包含尚未在线展开的嵌入对象，不能认定填写完整'};const declared=fields(target);if(!declared.length)return {state:'unknown',filled:0,total:null,percent:null};const values=target.kind==='excel'?(own(savedFileEdits,target.sheet)?savedFileEdits[target.sheet]:null):savedFileEdits;let filled=0;for(const f of declared){const keys=Array.isArray(f.answerKeys)&&f.answerKeys.length?f.answerKeys:[f.key];const fieldValues=target.kind==='excel'&&typeof f.sheet==='string'?(own(savedFileEdits,f.sheet)?savedFileEdits[f.sheet]:null):values;if(keys.some(k=>typeof k==='string'&&own(fieldValues,k)&&validSaved(fieldValues[k],f)))filled++;}return {state:filled===declared.length?'complete':filled?'partial':'empty',filled,total:declared.length,percent:Math.floor(filled/declared.length*1000)/10};}
 return Object.freeze({archives,identifyArchive,row,targets,resolve,progress,fields,validSaved,fingerprint});
});
