import {subscriptionEnforcementMode} from './subscription-configuration.mjs';
import {captureSubscriptionWriteGuard} from './subscription-store.mjs';

// Call only after the original operation's team and resource authorization.
// Read/export and cancellation paths never capture a business write guard.
export function captureBusinessSubscriptionGuard(db,teamId,{now=Date.now,identityProviders={},subscriptionEnforcement='disabled'}={}) {
  const mode=subscriptionEnforcementMode(subscriptionEnforcement,identityProviders);
  return mode==='business-data-v1'?captureSubscriptionWriteGuard(db,teamId,{now}):null;
}
