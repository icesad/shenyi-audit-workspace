import {ID,deny,invalid,json,transaction} from './http-utils.mjs';
import {projectActor,currentActor,projectTime} from './project-access-policy.mjs';
import {readTeamContext} from './repository.mjs';
import {administratorTechnicalEligible} from './administrator-business-role-policy.mjs';
import {readSubscriptionState} from './subscription-store.mjs';
import {subscriptionEnforcementMode} from './subscription-configuration.mjs';

// Expose only the caller's own team's term status. Seat totals, other
// employees, evidence references and financial records stay server-side.
export async function handleSubscriptionRequest(request,options={}) {
  const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/subscription-status$/.exec(url.pathname);
  if(!match)return null;
  const teamId=match[1];if(!ID.test(teamId))deny();if(url.search)invalid();
  if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
  const {db,now=Date.now,subscriptionEnforcement='disabled'}=options,scope=subscriptionEnforcementMode(subscriptionEnforcement,options.identityProviders);
  const actor=projectActor(db,request,options,projectTime(now()));
  return transaction(db,()=>{
    const current=currentActor(db,request,actor,options,projectTime(now()));
    const business=readTeamContext(db,current,teamId),technical=administratorTechnicalEligible(db,current.userId,teamId);
    if(!business&&!technical)deny();
    const state=readSubscriptionState(db,teamId,projectTime(now()));
    currentActor(db,request,actor,options,projectTime(now()));
    return json({subscription:{teamId,state:state.state,revision:state.revision,startsAt:state.startsAt,endsAt:state.endsAt,
      occupiesBusinessSeat:!!business,enforcementScope:scope}});
  });
}
