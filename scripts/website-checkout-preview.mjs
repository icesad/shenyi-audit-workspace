import {createServer} from 'node:https';
import {X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {handleTeamApplicationRequest} from '../server/team/application-api.mjs';
import {billingSimulationConfiguration} from '../server/team/billing-simulation.mjs';
import {deviceServerId} from '../server/team/device-policy.mjs';
import {startLoopbackTeamListener} from '../server/team/team-http-listener.mjs';
import {createWebsiteCheckoutCandidate, initializeWebsiteCheckoutStore, isWebsiteCheckoutBrowserPath} from '../server/team/website-checkout.mjs';

const pages = new Map([
  ['/', ['website/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['website/styles.css', 'text/css; charset=utf-8']],
  ['/assets/brand-shenyi.png', ['dist/brand-shenyi.png', 'image/png']],
  ['/checkout/', ['website/checkout.html', 'text/html; charset=utf-8']],
  ['/checkout/checkout.css', ['website/checkout.css', 'text/css; charset=utf-8']],
  ['/checkout/checkout.js', ['website/checkout.js', 'text/javascript; charset=utf-8']],
  ['/checkout/seats/', ['website/checkout-seats.html', 'text/html; charset=utf-8']],
  ['/checkout/checkout-seats.js', ['website/checkout-seats.js', 'text/javascript; charset=utf-8']],
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

function listen(tls, dispatch) {
  return startLoopbackTeamListener({
    createServer: handle => createServer({...tls,minVersion:'TLSv1.2'},handle),
    protocol:'https', port:0, resolveTarget:target, dispatch,
  });
}

function closeListener(listener) {
  const closed = listener.close();
  listener.server.closeAllConnections();
  return closed;
}

const missing = () => new Response(null,{status:404,headers:staticHeaders});

/** Serve a synthetic checkout. Separate TLS listeners are used by the portable review launcher. */
export async function startWebsiteCheckoutPreview({db, key, cert, checkoutTLS, billingSimulation, now = Date.now} = {}) {
  if (db?.prepare("SELECT value FROM team_database_metadata WHERE name='website-checkout-demo'").get()?.value !== 'true') {
    throw new Error('Website checkout requires its own explicitly marked synthetic database.');
  }
  const options = {db, now, identityProviders:{deviceProofRequired:true},
    subscriptionEnforcement:'team-management-v1', seatCapacityEnforcement:'invitation-reservations-v1'};
  options.billingSimulation = billingSimulationConfiguration(billingSimulation,options);
  if (options.billingSimulation?.offers.length !== 1 || options.billingSimulation.annualSeatUnitAmountMinor === undefined) {
    throw new Error('A trusted synthetic annual offer and synthetic seat amount are required.');
  }
  initializeWebsiteCheckoutStore(db);
  const files = new Map(await Promise.all([...pages].map(async ([route,[file,type]]) => [
    route, {bytes:await readFile(new URL('../'+file,import.meta.url)),type},
  ])));
  function asset(request, url) {
    const file = files.get(url.pathname);
    if (!file || url.search || url.href.endsWith('?')) return missing();
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{...staticHeaders,Allow:'GET, HEAD'}});
    return new Response(request.method==='GET'?file.bytes:null,{headers:{...staticHeaders,'Content-Type':file.type}});
  }
  const application = request => handleTeamApplicationRequest(request,options);
  const serverId = deviceServerId(db);
  const profile = (apiBase,checkoutOrigin) => Object.freeze({schemaVersion:3,apiBase,serverId,checkoutOrigin});

  if (checkoutTLS === undefined) {
    const listener = await listen({key,cert},request => {
      const url = new URL(request.url);
      return url.pathname.startsWith('/api/') ? application(request) : asset(request,url);
    });
    const origin = listener.address.url;
    options.websiteCheckout = createWebsiteCheckoutCandidate({origin});
    return {...listener,profile:profile(origin,origin)};
  }

  if (!checkoutTLS?.key || !checkoutTLS.cert ||
      new X509Certificate(checkoutTLS.cert).fingerprint256 === new X509Certificate(cert).fingerprint256) {
    throw new Error('Separate checkout TLS credentials are required.');
  }
  const storefront = await listen({key:checkoutTLS.key,cert:checkoutTLS.cert},async request => {
    const url = new URL(request.url);
    if (!isWebsiteCheckoutBrowserPath(url.pathname)) return asset(request,url);
    if (request.headers.has('authorization') || request.headers.has('cookie') ||
        [...request.headers.keys()].some(name => name.startsWith('x-shenyi-'))) {
      return new Response(null,{status:403,headers:staticHeaders});
    }
    const response = await application(request);
    response.headers.delete('X-Shenyi-Server-Id');
    return response;
  });
  let api;
  try {
    options.websiteCheckout = createWebsiteCheckoutCandidate({origin:storefront.address.url});
    api = await listen({key,cert},request => {
      const {pathname} = new URL(request.url);
      return pathname.startsWith('/api/') && !pathname.startsWith('/api/website-checkout/') &&
        pathname !== '/api/website-checkout' ? application(request) : missing();
    });
    let closing;
    return {...api,checkoutAddress:storefront.address,profile:profile(api.address.url,storefront.address.url),
      close:() => closing ??= Promise.all([closeListener(api),closeListener(storefront)]).then(() => {})};
  } catch (error) {
    await Promise.allSettled([closeListener(storefront),...(api ? [closeListener(api)] : [])]);
    throw error;
  }
}
