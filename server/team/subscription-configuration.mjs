// Trusted server configuration. This bounded candidate is not global billing.
export function subscriptionEnforcementMode(value='disabled',identityProviders={}) {
  if(value!=='disabled'&&value!=='workspace-create-v1')throw new TypeError('Invalid subscription enforcement scope');
  if(value!=='disabled'&&identityProviders?.deviceProofRequired!==true)throw new TypeError('Subscription scope requires strict device proof');
  return value;
}
