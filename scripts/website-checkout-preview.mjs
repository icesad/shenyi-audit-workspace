import {createServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {handleTeamApplicationRequest} from '../server/team/application-api.mjs';
import {billingSimulationConfiguration} from '../server/team/billing-simulation.mjs';
import {deviceServerId} from '../server/team/device-policy.mjs';
import {startLoopbackTeamListener} from '../server/team/team-http-listener.mjs';
import {createWebsiteCheckoutCandidate} from '../server/team/website-checkout.mjs';

const pages = new Map([
  ['/', ['website/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['website/styles.css', 'text/css; charset=utf-8']],
  ['/assets/brand-shenyi.png', ['dist/brand-shenyi.png', 'image/png']],
  ['/checkout/', ['website/checkout.html', 'text/html; charset=utf-8']],
  ['/checkout/checkout.css', ['website/checkout.css', 'text/css; charset=utf-8']],
  ['/checkout/checkout.js', ['website/checkout.js', 'text/javascript; charset=utf-8']],
]);
const staticPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const staticHeaders = Object.freeze({
  'Cache-Control': 'no-store', 'Content-Security-Policy': staticPolicy,
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
});

function target(incoming, origin) {
  if (incoming.headersDistinct.host?.length !== 1 || incoming.headers.host !== new URL(origin).host ||
      !incoming.url?.startsWith('/') || incoming.url.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(incoming.url)) return;
  const url = new URL(incoming.url, origin);
  if (url.origin === origin && url.href === origin + incoming.url) return url;
}

/** Serve a dedicated synthetic checkout and team API over the same loopback TLS origin. */
export async function startWebsiteCheckoutPreview({db, key, cert, billingSimulation, now = Date.now} = {}) {
  if (db?.prepare("SELECT value FROM team_database_metadata WHERE name='website-checkout-demo'").get()?.value !== 'true') {
    throw new Error('Website checkout requires its own explicitly marked synthetic database.');
  }
  const options = {db, now, identityProviders:{deviceProofRequired:true},
    subscriptionEnforcement:'team-management-v1', seatCapacityEnforcement:'invitation-reservations-v1'};
  options.billingSimulation = billingSimulationConfiguration(billingSimulation,options);
  if (options.billingSimulation?.offers.length !== 1 || options.billingSimulation.annualSeatUnitAmountMinor === undefined) {
    throw new Error('A trusted synthetic annual offer and synthetic seat amount are required.');
  }
  const files = new Map(await Promise.all([...pages].map(async ([route,[file,type]]) => [
    route, {bytes:await readFile(new URL('../'+file,import.meta.url)),type},
  ])));
  const serverId = deviceServerId(db);
  const listener = await startLoopbackTeamListener({
    createServer: handle => createServer({key,cert,minVersion:'TLSv1.2'},handle),
    protocol:'https', port:0, resolveTarget:target,
    async dispatch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return handleTeamApplicationRequest(request,options);
      const file = files.get(url.pathname);
      if (!file || url.search || url.href.endsWith('?')) return new Response(null,{status:404,headers:staticHeaders});
      if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{...staticHeaders,Allow:'GET, HEAD'}});
      return new Response(request.method==='GET'?file.bytes:null,{headers:{...staticHeaders,'Content-Type':file.type}});
    },
  });
  const origin = listener.address.url;
  options.websiteCheckout = createWebsiteCheckoutCandidate({origin});
  return {...listener, profile:Object.freeze({schemaVersion:3,apiBase:origin,serverId,checkoutOrigin:origin})};
}
