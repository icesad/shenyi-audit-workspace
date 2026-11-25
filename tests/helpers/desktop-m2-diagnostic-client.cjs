'use strict';
// Legacy M2 native regression harness only. Normal main never imports this.
// M3 required:true acceptance uses the real vault and strict server instead.
function createM2DiagnosticClient(factory,options){
  const client=factory({...options,deviceIdentity:undefined}),result={...client};
  result.getDeviceReplacementStatus=async()=>({canRequest:false,request:null});result.getDeviceReplacementReviewAccess=async()=>({canReview:false});result.listDeviceReplacementReviews=async()=>({requests:[],hasMore:false});
  result.getBusinessRoleManagementAccess=async()=>({teams:[]});result.listBusinessRoleMembers=async()=>({members:[],hasMore:false});result.changeBusinessRole=async()=>{throw Error('M2 diagnostic fixtures cannot change business roles');};
  result.getAdministratorBusinessRoleAccess=async()=>({canReview:false});result.listAdministratorBusinessRoles=async()=>({members:[],hasMore:false});result.changeAdministratorBusinessRole=async()=>{throw Error('M2 diagnostic fixtures cannot approve administrator business roles');};
  result.getProjectAccess=async()=>({teams:[]});result.listProjects=async()=>({projects:[],hasMore:false});result.listProjectMembers=async()=>({members:[],hasMore:false});result.listProjectTasks=async()=>({tasks:[],hasMore:false});result.listProjectSubmissions=async()=>({submissions:[],hasMore:false});
  for(const name of ['getProject','changeProjectAccess','createProjectTask','getProjectSubmissionFile','authorizeProjectSubmissionDownload'])result[name]=async()=>{throw Error('M2 diagnostic fixtures cannot access managed projects');};
  for(const name of ['requestDeviceReplacement','withdrawDeviceReplacement','activateDeviceReplacement','reviewDeviceReplacement'])result[name]=async()=>{throw Error('M2 diagnostic fixtures cannot replace devices');};
  const session=async value=>value&&value.account&&Array.isArray(value.memberships)?{...value,device:await client.getDeviceStatus()}:value;
  for(const name of ['login','loginPhone','getSession','pollWechatLogin','linkWechatAccount'])if(typeof client[name]==='function')result[name]=async(...args)=>{const value=await client[name](...args);return value?.status==='signed_in'?{...value,session:await session(value.session)}:await session(value);};
  return Object.freeze(result);
}
module.exports={createM2DiagnosticClient};
