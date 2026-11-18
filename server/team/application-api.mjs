import {handleAuthRequest} from './auth-api.mjs';
import {handleCollectionWriteRequest} from './collection-write-api.mjs';
import {handleInvitationRequest} from './invitations-api.mjs';
import {handleTeamCollectionRequest} from './collection-api.mjs';
import {handlePhoneRequest} from './phone-api.mjs';
import {handleWechatRequest,isWechatConfigured} from './wechat-api.mjs';
import {handleEmployeeInvitationRequest} from './employee-invitations-api.mjs';
import {handleAccountSessionsRequest} from './sessions-api.mjs';
import {handleTeamProvisioningRequest} from './provisioning-api.mjs';
import {handleRecoveryReviewRequest} from './recovery-review-api.mjs';
import {handleMemberAccessRequest} from './member-access-api.mjs';
import {handleBusinessRoleRequest} from './business-role-api.mjs';
import {handleProjectAccessRequest} from './project-access-api.mjs';
import {handleProjectReviewRequest} from './project-review-api.mjs';
import {handleTaskOriginalsExportRequest} from './task-originals-export-api.mjs';
import {handleProjectMigrationRequest} from './migration-api.mjs';
import {handleCollectionWorkspaceCreationRequest} from './workspace-creation-api.mjs';
import {handleWorkspaceFormalizationRequest} from './workspace-formalization-api.mjs';
import {handleWorkspaceSourceRequest} from './workspace-source-api.mjs';
import {handleLedgerCheckRequest} from './ledger-check-api.mjs';
import {handleWorkpaperAccessRequest} from './workpaper-access-api.mjs';
import {handleWorkpaperDataRequest} from './workpaper-data-api.mjs';
import {handleWorkpaperFormRequest} from './workpaper-form-api.mjs';
import {handleWorkpaperEntriesRequest} from './workpaper-entries-api.mjs';
import {handleWorkpaperExportRequest} from './workpaper-export-api.mjs';
import {handleTeamMaterialsRequest} from './materials-api.mjs';
import {handleMaterialPreservationRequest} from './materials-preservation-api.mjs';
import {handleAdministratorBusinessRoleRequest} from './administrator-business-role-api.mjs';
import {handleDeviceIdentityRequest} from './device-api.mjs';
import {handleDeviceReplacementRequest} from './device-replacement-api.mjs';
import {authorizeDeviceRequest} from './device-gate.mjs';
import {deviceServerId} from './device-policy.mjs';
import {handleMyDeviceRequest} from './my-device-api.mjs';
import {recoveryConfigured} from './recovery-review-policy.mjs';
import {ApiError, json} from './http-utils.mjs';
import {handleSubscriptionRequest} from './subscription-api.mjs';
import {subscriptionEnforcementMode} from './subscription-configuration.mjs';
import {seatCapacityMode} from './seat-capacity-policy.mjs';
import {billingSimulationConfiguration} from './billing-simulation.mjs';
import {handleBillingRequest,handleBillingSimulationNotification,SIMULATION_NOTIFICATION_PATH,SIMULATION_PAYMENT_EXCEPTION_PATH,SIMULATION_ORDER_CLOSURE_PATH} from './billing-api.mjs';
import {handleBillingRefundIntakeRequest} from './billing-refund-intake-api.mjs';

/** Team application boundary shared by the local preview and managed service. */
export async function handleTeamApplicationRequest(request, options = {}) {
  // Read existing metadata before dispatch, never initialize identity here.
  // Even early errors share this public identity boundary in strict mode.
  let serverId,response;
  if(options.identityProviders?.deviceProofRequired===true){
    try{const value=deviceServerId(options.db);if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw Error();serverId=value;}
    catch{response=json({error:{code:'SERVICE_UNAVAILABLE',message:'团队服务暂不可用。'}},503);}
  }
  response??=await applicationResponse(request,options);
  const headers=new Headers(response.headers);
  if(serverId!==undefined)headers.set('X-Shenyi-Server-Id',serverId);
  // HEAD never carries a body, including metadata/origin/auth/clock errors.
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers});
}
async function applicationResponse(request, {db, now = Date.now,identityProviders={},subscriptionEnforcement='disabled',billingSimulation=null,seatCapacityEnforcement='disabled',serviceMode='local-preview'} = {}) {
  let releaseDeviceBody;
  try {
    const managedService=serviceMode==='managed-service';
    if((!managedService&&serviceMode!=='local-preview')||(managedService&&(identityProviders.deviceProofRequired!==true||billingSimulation!==null))){
      throw new Error('Invalid team service mode configuration');
    }
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid clock');
    const url=new URL(request.url),options={db,now,identityProviders,subscriptionEnforcement:subscriptionEnforcementMode(subscriptionEnforcement,identityProviders)};
    options.seatCapacityEnforcement=seatCapacityMode(seatCapacityEnforcement,options);
    options.billingSimulation=billingSimulationConfiguration(billingSimulation,options);
    // A provider's top-level browser callback is cross-site by design. Only this
    // exact GET endpoint uses state/code checks instead of the data API origin gate.
    if(url.pathname==='/api/auth/wechat/callback'&&request.method==='GET')return await handleWechatRequest(request,options);
    const origin = request.headers.get('Origin');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && ![new URL(request.url).origin,'shenyi://app'].includes(origin))) {
      return json({error:{code:'CROSS_SITE_DENIED',message:'请在审易客户端中操作。'}},403);
    }
    if(url.pathname==='/api/auth/methods'){
      if(url.search)return json({error:{code:'INVALID_QUERY',message:'查询参数无效。'}},400);
      if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
      const sms=typeof identityProviders.sms?.send==='function'&&Buffer.isBuffer(identityProviders.phonePepper)&&identityProviders.phonePepper.length>=32;
      return json({mode:serviceMode,methods:{demoUsername:!managedService,phonePassword:true,phoneVerification:sms,wechat:isWechatConfigured(identityProviders),recovery:sms&&recoveryConfigured(identityProviders)},
        ...(identityProviders.deviceProofRequired===true?{deviceBinding:{required:true,serverId:deviceServerId(db),protocolVersion:1}}:{})});
    }
    if(managedService&&url.pathname==='/api/auth/login'){
      return json({error:{code:'DEMO_LOGIN_DISABLED',message:'此团队服务仅支持手机号登录。'}},403);
    }
    if([SIMULATION_NOTIFICATION_PATH,SIMULATION_PAYMENT_EXCEPTION_PATH,SIMULATION_ORDER_CLOSURE_PATH].includes(url.pathname))return await handleBillingSimulationNotification(request,options);
    const deviceAuthorization=await authorizeDeviceRequest(request,options);
    releaseDeviceBody=deviceAuthorization.release;
    request=deviceAuthorization.request;options.deviceContext=deviceAuthorization.context;
    return await handleBillingRefundIntakeRequest(request,options)
      || await handleBillingRequest(request,options)
      || await handleSubscriptionRequest(request,options)
      || await handleMyDeviceRequest(request,options)
      || await handleDeviceReplacementRequest(request,options)
      || await handleDeviceIdentityRequest(request,options)
      || await handleAccountSessionsRequest(request,options)
      || await handleMemberAccessRequest(request,options)
      || await handleAdministratorBusinessRoleRequest(request,options)
      || await handleBusinessRoleRequest(request,options)
      || await handleProjectMigrationRequest(request,options)
      || await handleCollectionWorkspaceCreationRequest(request,options)
      || await handleWorkpaperExportRequest(request,options)
      || await handleWorkpaperEntriesRequest(request,options)
      || await handleWorkpaperFormRequest(request,options)
      || await handleWorkpaperDataRequest(request,options)
      || await handleWorkpaperAccessRequest(request,options)
      || await handleLedgerCheckRequest(request,options)
      || await handleWorkspaceSourceRequest(request,options)
      || await handleWorkspaceFormalizationRequest(request,options)
      || await handleMaterialPreservationRequest(request,options)
      || await handleTeamMaterialsRequest(request,options)
      || await handleTaskOriginalsExportRequest(request,options)
      || await handleProjectAccessRequest(request,options)
      || await handleProjectReviewRequest(request,options)
      || await handleRecoveryReviewRequest(request,options)
      || await handleTeamProvisioningRequest(request,options)
      || await handleEmployeeInvitationRequest(request,options)
      || await handlePhoneRequest(request,options)
      || await handleWechatRequest(request,options)
      || await handleAuthRequest(request,options)
      || await handleInvitationRequest(request,options)
      || await handleCollectionWriteRequest(request,options)
      || await handleTeamCollectionRequest(request,options);
  } catch (error) {
    if(error?.message?.includes('WORKPAPER_DATA_CONFLICT'))return json({error:{code:'WORKPAPER_DATA_CONFLICT',message:'底稿版本、来源或导入状态冲突，请刷新或查询原回执。'}},409);
    if(error?.message?.includes('WORKPAPER_ACCESS_CONFLICT'))return json({error:{code:'WORKPAPER_ACCESS_CONFLICT',message:'底稿授权状态冲突，请刷新核对。'}},409);
    if(error?.message?.includes('LEDGER_CHECK_CONFLICT'))return json({error:{code:'LEDGER_CHECK_CONFLICT',message:'账表来源、授权或版本冲突，请刷新或查询原回执。'}},409);
    if(error?.message?.includes('SOURCE_REVISION_CONFLICT'))return json({error:{code:'WORKSPACE_SOURCE_CONFLICT',message:'来源授权状态冲突，请刷新核对。'}},409);
    if(error?.message?.includes('WORKSPACE_FORMALIZATION_CONFLICT'))return json({error:{code:'WORKSPACE_FORMALIZATION_CONFLICT',message:'来源、工作区或业务确认状态冲突，请只读核对原回执。'}},409);
    if(error?.message?.includes('WORKSPACE_CREATION_CONFLICT')||error?.message?.includes('UNIQUE constraint failed: team_project_access_projects.team_id, team_project_access_projects.created_by, team_project_access_projects.request_id'))return json({error:{code:'WORKSPACE_CREATION_CONFLICT',message:'创建标识或工作区来源冲突，请只读查询原回执。'}},409);
    if(error?.message?.includes('MATERIAL_REQUEST_USED'))return json({error:{code:'MATERIALS_CONFLICT',message:'此操作标识已使用，请只读查询原回执。'}},409);
    if(error?.message?.includes('MATERIAL_REVISION_MAX'))return json({error:{code:'MATERIALS_CONFLICT',message:'资料授权版本已达上限，未更改业务资料。'}},409);
    if (error instanceof ApiError) return json({error:{code:error.code,message:error.message}},error.status,error.status===429?{'Retry-After':'60'}:{});
    return json({error:{code:'SERVICE_UNAVAILABLE',message:'团队服务暂不可用。'}},503);
  } finally { releaseDeviceBody?.(); }
}
