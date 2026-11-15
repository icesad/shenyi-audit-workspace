'use strict';
// Explicit M2-only DOM fixture policy. Never import from the application or
// use for M3 required:true acceptance. Legacy clients have no OS vault.
const DIAGNOSTIC=Object.freeze({required:false,state:'diagnostic',epoch:0,device:null,localFingerprint:null,expiresAt:null});
function withDeviceDiagnostic(bridge){
  if(!bridge)return bridge;
  const result={...bridge,getDeviceStatus:bridge.getDeviceStatus||asyncFunction(()=>({ok:true,value:{...DIAGNOSTIC}})),enrollDevice:bridge.enrollDevice||asyncFunction(()=>({ok:false,error:{code:'DIAGNOSTIC_ONLY',message:'此M2夹具不提供设备绑定。'}})),reconnectDevice:bridge.reconnectDevice||asyncFunction(()=>({ok:false,error:{code:'DIAGNOSTIC_ONLY',message:'此M2夹具不提供设备重连。'}}))};
  for(const [name,value] of Object.entries({getDeviceReplacementStatus:{canRequest:false,request:null},getDeviceReplacementReviewAccess:{canReview:false},listDeviceReplacementReviews:{requests:[],hasMore:false}}))if(typeof result[name]!=='function')result[name]=asyncFunction(()=>({ok:true,value:structuredClone(value)}));
  for(const name of ['requestDeviceReplacement','withdrawDeviceReplacement','activateDeviceReplacement','reviewDeviceReplacement'])if(typeof result[name]!=='function')result[name]=asyncFunction(()=>({ok:false,error:{code:'DIAGNOSTIC_ONLY',message:'此M2夹具不提供换机授权。'}}));
  const session=value=>value&&value.account&&Array.isArray(value.memberships)?{...value,device:value.device??{...DIAGNOSTIC}}:value;
  for(const [name,value] of Object.entries({getBusinessRoleManagementAccess:{teams:[]},listBusinessRoleMembers:{members:[],hasMore:false}}))if(typeof result[name]!=='function')result[name]=asyncFunction(()=>({ok:true,value:structuredClone(value)}));
  if(typeof result.changeBusinessRole!=='function')result.changeBusinessRole=asyncFunction(()=>({ok:false,error:{code:'DIAGNOSTIC_ONLY',message:'此M2夹具不提供职级调整。'}}));
  for(const [name,value] of Object.entries({getProjectAccess:{teams:[]},listProjects:{projects:[],hasMore:false},listProjectMembers:{members:[],hasMore:false},listProjectTasks:{tasks:[],hasMore:false},listProjectSubmissions:{submissions:[],hasMore:false}}))if(typeof result[name]!=='function')result[name]=asyncFunction(()=>({ok:true,value:structuredClone(value)}));
  for(const name of ['getProject','changeProjectAccess','createProjectTask','downloadProjectSubmission'])if(typeof result[name]!=='function')result[name]=asyncFunction(()=>({ok:false,error:{code:'DIAGNOSTIC_ONLY',message:'此M2夹具不提供项目授权操作。'}}));
  for(const name of ['login','loginPhone','getSession','pollWechatLogin','linkWechatAccount'])if(typeof bridge[name]==='function')result[name]=async(...args)=>{const response=await bridge[name](...args);if(!response?.ok)return response;return {...response,value:response.value?.status==='signed_in'?{...response.value,session:session(response.value.session)}:session(response.value)};};
  return result;
}
const asyncFunction=action=>async()=>action();
module.exports={withDeviceDiagnostic};
