import {subscriptionEnforcementMode} from './subscription-configuration.mjs';
import {captureSubscriptionWriteGuard} from './subscription-store.mjs';

// Original authority, target identity and operation validation must run first.
// Only callers that establish effective new authority capture this guard.
export function captureManagementSubscriptionGuard(db,teamId,{now=Date.now,identityProviders={},subscriptionEnforcement='disabled'}={}) {
  const mode=subscriptionEnforcementMode(subscriptionEnforcement,identityProviders);
  return mode==='team-management-v1'?captureSubscriptionWriteGuard(db,teamId,{now}):null;
}

// Compare eligible assigned authority atoms, including independent write/export
// flags whose read prerequisite is absent. An ineligible retained SQL bit is not
// current authority. New dormant flags and mixed increase/revocation need a term.
// Strict booleans reject missing flags/accessors instead of granting free access.
export function addsEffectiveAuthority(current,desired,keys) {
  if(!current||!desired||!Array.isArray(keys)||keys.length===0||new Set(keys).size!==keys.length)throw new TypeError('Invalid effective permission vector');
  let added=false;
  for(const key of keys) {
    if(typeof key!=='string')throw new TypeError('Invalid effective permission key');
    const before=Object.getOwnPropertyDescriptor(current,key),after=Object.getOwnPropertyDescriptor(desired,key);
    if(!before||!after||!Object.hasOwn(before,'value')||!Object.hasOwn(after,'value')||typeof before.value!=='boolean'||typeof after.value!=='boolean')throw new TypeError('Invalid effective permission flag');
    if(after.value&&!before.value)added=true;
  }
  return added;
}
