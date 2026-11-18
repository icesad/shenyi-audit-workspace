import {createPrivateKey, X509Certificate} from 'node:crypto';
import {createServer} from 'node:https';
import {isIP} from 'node:net';
import {handleTeamApplicationRequest} from './application-api.mjs';
import {json} from './http-utils.mjs';
import {assertDatabaseIdentity, assertManagedDatabaseReady} from './managed-database-readiness.mjs';
import {serviceUnavailable, startLoopbackTeamListener} from './team-http-listener.mjs';

export {assertManagedDatabaseReady};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const messages = {
  MANAGED_SERVICE_CONFIGURATION_INVALID: '本机团队服务启动配置无效。',
  MANAGED_TLS_INVALID: '本机团队服务 TLS 配置无效。',
  MANAGED_SERVICE_LISTEN_FAILED: '本机团队服务无法监听指定端口。',
};
const recoveryRoutes = new Set([
  '/api/auth/recovery-requests/capabilities', '/api/auth/recovery-requests',
  '/api/auth/phone/challenges', '/api/auth/phone/reset',
  '/api/account/recovery-reviews', '/api/account/recovery-reviews/access',
]);
const recoveryDecisionRoute = /^\/api\/account\/recovery-reviews\/[^/]+\/review$/;

function fail(code) {
  throw Object.assign(new Error(messages[code]), {code});
}

function managedOrigin(apiBase, port, serverId) {
  try {
    if (typeof apiBase !== 'string' || !Number.isInteger(port) || port < 0 || port > 65535 ||
        typeof serverId !== 'string' || !uuid.test(serverId)) fail('MANAGED_SERVICE_CONFIGURATION_INVALID');
    const url = new URL(apiBase);
    if (url.protocol !== 'https:' || !url.hostname || url.origin !== apiBase) fail('MANAGED_SERVICE_CONFIGURATION_INVALID');
    return url;
  } catch { fail('MANAGED_SERVICE_CONFIGURATION_INVALID'); }
}

function checkTlsConfiguration(origin, key, cert) {
  try {
    const leaf = new X509Certificate(cert);
    const hostname = origin.hostname.replace(/^\[|\]$/g, '');
    const hostMatch = isIP(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname, {subject:'never'});
    const at = Date.now();
    if (!hostMatch || !leaf.checkPrivateKey(createPrivateKey(key)) ||
        !(leaf.validFromDate.getTime() <= at && at <= leaf.validToDate.getTime())) fail('MANAGED_TLS_INVALID');
  } catch { fail('MANAGED_TLS_INVALID'); }
}

function resolveManagedTarget(incoming, origin) {
  const hosts = incoming.headersDistinct.host;
  const target = incoming.url;
  if (hosts?.length !== 1 || hosts[0] !== origin.host || typeof target !== 'string' ||
      !target.startsWith('/') || target.startsWith('//') || /[\x00-\x20\x7f-\uffff\\#]|%(?![0-9a-f]{2})/i.test(target)) return;
  const url = new URL(target, origin);
  // Do not route requests whose path was normalized by the WHATWG parser.
  if (url.origin === origin.origin && url.href === origin.origin + target) return url;
}

/** Loopback-only HTTPS listener for a separately provisioned non-demo database. */
export async function startManagedTeamServer({db, apiBase, port = 0, serverId, key, cert, sms, phonePepper, reviewedRecovery = false} = {}) {
  const origin = managedOrigin(apiBase, port, serverId);
  const hasSms = sms !== undefined || phonePepper !== undefined;
  const validSms = typeof sms?.send === 'function' && Buffer.isBuffer(phonePepper) && phonePepper.length === 32;
  if (typeof reviewedRecovery !== 'boolean' || ((hasSms || reviewedRecovery) && !validSms)) {
    fail('MANAGED_SERVICE_CONFIGURATION_INVALID');
  }
  const readinessOptions = {reviewedRecovery};
  assertManagedDatabaseReady(db, serverId, readinessOptions);
  checkTlsConfiguration(origin, key, cert);
  const pepper = hasSms ? Buffer.from(phonePepper) : undefined;
  const identityProviders = Object.freeze({deviceProofRequired:true, reviewedRecovery,
    ...(hasSms ? {sms:Object.freeze({send:sms.send.bind(sms)}), phonePepper:pepper} : {}),
  });
  const settings = Object.freeze({
    db, serviceMode:'managed-service', identityProviders,
    subscriptionEnforcement:'team-management-v1', seatCapacityEnforcement:'invitation-reservations-v1',
    billingSimulation:null,
  });
  try {
    const service = await startLoopbackTeamListener({
      createServer(listener) {
        try { return createServer({key, cert, minVersion:'TLSv1.2'}, listener); }
        catch { fail('MANAGED_TLS_INVALID'); }
      },
      protocol:'https', port,
      resolveTarget:incoming => resolveManagedTarget(incoming, origin),
      async dispatch(request, incoming) {
        if (incoming.method === 'GET' && incoming.url === '/health') return json({status:'ok'});
        if (incoming.method === 'GET' && incoming.url === '/ready') {
          try { assertManagedDatabaseReady(db, serverId, readinessOptions); }
          catch { return json({status:'not-ready'}, 503); }
          return json({status:'ready'});
        }
        assertDatabaseIdentity(db, serverId);
        if (reviewedRecovery) {
          const pathname = new URL(request.url).pathname;
          if (recoveryRoutes.has(pathname) || recoveryDecisionRoute.test(pathname)) {
            try { assertManagedDatabaseReady(db, serverId, readinessOptions); }
            catch {
              const denied = serviceUnavailable();
              denied.headers.set('X-Shenyi-Server-Id', serverId);
              return denied;
            }
          }
        }
        const response = await handleTeamApplicationRequest(request, settings);
        if (response.headers.get('X-Shenyi-Server-Id') === serverId) return response;
        await response.body?.cancel();
        return serviceUnavailable();
      },
    });
    let closing;
    return Object.freeze({
      ...service, address:Object.freeze(service.address), apiBase:origin.origin,
      close:() => closing ??= service.close().finally(() => pepper?.fill(0)),
    });
  } catch (error) {
    pepper?.fill(0);
    if (error?.code === 'MANAGED_TLS_INVALID') throw error;
    fail('MANAGED_SERVICE_LISTEN_FAILED');
  }
}
