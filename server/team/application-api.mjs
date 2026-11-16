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
import {handleTeamMaterialsRequest} from './materials-api.mjs';
import {handleAdministratorBusinessRoleRequest} from './administrator-business-role-api.mjs';
import {handleDeviceIdentityRequest} from './device-api.mjs';
import {handleDeviceReplacementRequest} from './device-replacement-api.mjs';
import {authorizeDeviceRequest} from './device-gate.mjs';
import {deviceServerId} from './device-policy.mjs';
import {recoveryConfigured} from './recovery-review-policy.mjs';
import {ApiError, json} from './http-utils.mjs';

/** Local M2 application boundary. No fake registration/phone verification. */
export async function handleTeamApplicationRequest(request, options = {}) {
  const response=await applicationResponse(request,options);
  // HEAD never carries a body, including origin/auth/method/clock errors
  // produced before the collection handler is reached.
  return request.method==='HEAD'?new Response(null,{status:response.status,statusText:response.statusText,headers:response.headers}):response;
}
async function applicationResponse(request, {db, now = Date.now,identityProviders={}} = {}) {
  try {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid clock');
    const url=new URL(request.url),options={db,now,identityProviders};
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
      return json({mode:'local-preview',methods:{demoUsername:true,phonePassword:true,phoneVerification:sms,wechat:isWechatConfigured(identityProviders),recovery:sms&&recoveryConfigured(identityProviders)},
        ...(identityProviders.deviceProofRequired===true?{deviceBinding:{required:true,serverId:deviceServerId(db),protocolVersion:1}}:{})});
    }
    const deviceAuthorization=await authorizeDeviceRequest(request,options);
    request=deviceAuthorization.request;options.deviceContext=deviceAuthorization.context;
    return await handleDeviceReplacementRequest(request,options)
      || await handleDeviceIdentityRequest(request,options)
      || await handleAccountSessionsRequest(request,options)
      || await handleMemberAccessRequest(request,options)
      || await handleAdministratorBusinessRoleRequest(request,options)
      || await handleBusinessRoleRequest(request,options)
      || await handleProjectMigrationRequest(request,options)
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
    if(error?.message?.includes('MATERIAL_REVISION_MAX'))return json({error:{code:'MATERIALS_CONFLICT',message:'资料授权版本已达上限，未更改业务资料。'}},409);
    if (error instanceof ApiError) return json({error:{code:error.code,message:error.message}},error.status,error.status===429?{'Retry-After':'60'}:{});
    return json({error:{code:'SERVICE_UNAVAILABLE',message:'团队服务暂不可用。'}},503);
  }
}
