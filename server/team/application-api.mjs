import {handleAuthRequest} from './auth-api.mjs';
import {handleCollectionWriteRequest} from './collection-write-api.mjs';
import {handleInvitationRequest} from './invitations-api.mjs';
import {handleTeamCollectionRequest} from './collection-api.mjs';
import {ApiError, json} from './http-utils.mjs';

/** Local M2 application boundary. No fake registration/phone verification. */
export async function handleTeamApplicationRequest(request, {db, now = Date.now} = {}) {
  try {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid clock');
    const origin = request.headers.get('Origin');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && ![new URL(request.url).origin,'shenyi://app'].includes(origin))) {
      return json({error:{code:'CROSS_SITE_DENIED',message:'请在审易客户端中操作。'}},403);
    }
    const options = {db,now};
    return await handleAuthRequest(request,options)
      || await handleInvitationRequest(request,options)
      || await handleCollectionWriteRequest(request,options)
      || await handleTeamCollectionRequest(request,options);
  } catch (error) {
    if (error instanceof ApiError) return json({error:{code:error.code,message:error.message}},error.status,error.status===429?{'Retry-After':'60'}:{});
    return json({error:{code:'SERVICE_UNAVAILABLE',message:'团队服务暂不可用。'}},503);
  }
}
