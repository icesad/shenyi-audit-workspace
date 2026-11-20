import {createPrivateKey, X509Certificate} from 'node:crypto';
import {createServer} from 'node:https';
import {isIP} from 'node:net';
import {createSecureContext} from 'node:tls';
import {handleTeamApplicationRequest} from './application-api.mjs';
import {json} from './http-utils.mjs';
import {assertDatabaseIdentity, assertManagedDatabaseReady} from './managed-database-readiness.mjs';
import {isWechatConfigured} from './wechat-api.mjs';
import {serviceUnavailable, startLoopbackTeamListener} from './team-http-listener.mjs';
import {handleWechatNativeCallback, WECHAT_NATIVE_NOTIFY_PATH} from './wechat-native-callback.mjs';
import {assertWechatNativeBillingReady, createWechatNativeBilling, createWechatNativePaymentReceiver, withWechatNativeCallbackLockBudget} from './wechat-native-billing.mjs';
import {validateWechatNativeCatalog} from './wechat-native-checkout-pricing.mjs';
import {createWechatNativeWebsite, isNativeWebsitePath} from './wechat-native-website.mjs';
import {isWechatNativeNotifyUrl} from './wechat-native-orders.mjs';

export {assertManagedDatabaseReady};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const messages = {
  MANAGED_SERVICE_CONFIGURATION_INVALID: '本机团队服务启动配置无效。',
  MANAGED_TLS_INVALID: '本机团队服务 TLS 配置无效。',
  MANAGED_SERVICE_LISTEN_FAILED: '本机团队服务无法监听指定端口。',
  MANAGED_WECHAT_NATIVE_CALLBACK_NOT_READY: '微信支付通知配置或账本未就绪。',
  MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY: '微信支付官网订单页配置未就绪。',
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

function checkedTlsOptions(origin, key, cert) {
  try {
    const leaf = new X509Certificate(cert);
    const hostname = origin.hostname.replace(/^\[|\]$/g, '');
    const hostMatch = isIP(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname, {subject:'never'});
    const at = Date.now();
    if (!hostMatch || !leaf.checkPrivateKey(createPrivateKey(key)) ||
        !(leaf.validFromDate.getTime() <= at && at <= leaf.validToDate.getTime())) fail('MANAGED_TLS_INVALID');
    return {key, cert, minVersion:'TLSv1.2'};
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

function validateManagedServiceOptions({apiBase, port = 0, serverId, sms, phonePepper, reviewedRecovery = false, wechat}) {
  const origin = managedOrigin(apiBase, port, serverId);
  const hasSms = sms !== undefined || phonePepper !== undefined;
  const validSms = typeof sms?.send === 'function' && Buffer.isBuffer(phonePepper) && phonePepper.length === 32;
  if (typeof reviewedRecovery !== 'boolean' || ((hasSms || reviewedRecovery) && !validSms)) {
    fail('MANAGED_SERVICE_CONFIGURATION_INVALID');
  }
  const wechatEnabled = wechat !== undefined;
  if (wechatEnabled && (!isWechatConfigured({wechat}) || !/^wx[a-zA-Z0-9]{16}$/.test(wechat.appId) ||
    origin.port || isIP(origin.hostname.replace(/^\[|\]$/g, '')) || !origin.hostname.includes('.') ||
    wechat.redirectUri !== origin.origin + '/api/auth/wechat/callback')) fail('MANAGED_SERVICE_CONFIGURATION_INVALID');
  return {origin, hasSms, wechatEnabled, readinessOptions:{reviewedRecovery,wechatEnabled}};
}

function websiteNotifyUrl(origin, website, callback) {
  if (!website || !callback) fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY');
  const {fetchImpl, notifyUrl} = website;
  const callbackUrl = origin.origin + WECHAT_NATIVE_NOTIFY_PATH;
  // Only the isolated, injected transport uses an example callback domain.
  if (origin.hostname === 'localhost' && typeof fetchImpl === 'function' &&
      notifyUrl === 'https://shenyi.example.invalid' + WECHAT_NATIVE_NOTIFY_PATH) return notifyUrl;
  if ((notifyUrl !== undefined && notifyUrl !== callbackUrl) || !isWechatNativeNotifyUrl(callbackUrl)) fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY');
  return callbackUrl;
}

/** Validate the same provider settings and TLS context without creating a listener. */
export function checkManagedServiceStartup(options) {
  const {origin} = validateManagedServiceOptions(options);
  if (options.wechatNativeWebsite !== undefined) {
    websiteNotifyUrl(origin,options.wechatNativeWebsite,options.wechatNativeCallback);
    try { validateWechatNativeCatalog(options.wechatNativeWebsite.catalog); }
    catch { fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY'); }
  }
  try { createSecureContext(checkedTlsOptions(origin, options.key, options.cert)); }
  catch { fail('MANAGED_TLS_INVALID'); }
}

/** Loopback-only HTTPS listener for a separately provisioned non-demo database. */
export async function startManagedTeamServer({db, apiBase, port = 0, serverId, key, cert, sms, phonePepper,
  reviewedRecovery = false, wechat, wechatNativeCallback, wechatNativeWebsite} = {}) {
  const {origin, hasSms, wechatEnabled, readinessOptions} = validateManagedServiceOptions({apiBase, port, serverId, sms, phonePepper, reviewedRecovery, wechat});
  assertManagedDatabaseReady(db, serverId, readinessOptions);
  let receiveWechatNativeNotification;
  if (wechatNativeCallback !== undefined) {
    try {
      const {appId, merchantId, apiV3Key, keys} = wechatNativeCallback;
      receiveWechatNativeNotification = createWechatNativePaymentReceiver({db, appId, merchantId, apiV3Key, keys});
    } catch { fail('MANAGED_WECHAT_NATIVE_CALLBACK_NOT_READY'); }
  }
  const tlsOptions = checkedTlsOptions(origin, key, cert);
  let nativeWebsitePayment;
  if (wechatNativeWebsite !== undefined) {
    try {
      if (!receiveWechatNativeNotification) fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY');
      const {certificateSerial, merchantPrivateKey, fetchImpl, catalog} = wechatNativeWebsite;
      const notifyUrl = websiteNotifyUrl(origin,wechatNativeWebsite,wechatNativeCallback);
      const billing = createWechatNativeBilling({...wechatNativeCallback, db,
        certificateSerial, merchantPrivateKey, fetchImpl, notifyUrl});
      nativeWebsitePayment = await createWechatNativeWebsite({db,origin:origin.origin,billing,catalog});
    } catch { fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY'); }
  }
  const pepper = hasSms ? Buffer.from(phonePepper) : undefined;
  const identityProviders = Object.freeze({deviceProofRequired:true, reviewedRecovery,
    ...(hasSms ? {sms:Object.freeze({send:sms.send.bind(sms)}), phonePepper:pepper} : {}),
    ...(wechatEnabled ? {wechat:Object.freeze({appId:wechat.appId,redirectUri:wechat.redirectUri,
      createAuthorizationUrl:wechat.createAuthorizationUrl.bind(wechat),exchangeCode:wechat.exchangeCode.bind(wechat)}),
      wechatLinkRequiresDevice:true} : {}),
  });
  const settings = Object.freeze({
    db, serviceMode:'managed-service', identityProviders,
    subscriptionEnforcement:'team-management-v1', seatCapacityEnforcement:'invitation-reservations-v1',
    billingSimulation:null, nativeWebsitePayment,
  });
  try {
    const service = await startLoopbackTeamListener({
      createServer(listener) {
        try { return createServer(tlsOptions, listener); }
        catch { fail('MANAGED_TLS_INVALID'); }
      },
      protocol:'https', port,
      resolveTarget:incoming => resolveManagedTarget(incoming, origin),
      async dispatch(request, incoming) {
        if (incoming.method === 'GET' && incoming.url === '/health') return json({status:'ok'});
        if (incoming.method === 'GET' && incoming.url === '/ready') {
          try {
            assertManagedDatabaseReady(db, serverId, readinessOptions);
            if (receiveWechatNativeNotification) assertWechatNativeBillingReady(db);
          }
          catch { return json({status:'not-ready'}, 503); }
          return json({status:'ready'});
        }
        if (new URL(request.url).pathname === WECHAT_NATIVE_NOTIFY_PATH) {
          const finish = response => {
            response.headers.set('X-Shenyi-Server-Id', serverId);
            return response;
          };
          if (!receiveWechatNativeNotification || incoming.url !== WECHAT_NATIVE_NOTIFY_PATH) {
            return finish(json({error:{code:'NOT_FOUND',message:'无法访问此资源。'}}, 404));
          }
          try {
            withWechatNativeCallbackLockBudget(db, () => {
              assertDatabaseIdentity(db, serverId);
              assertWechatNativeBillingReady(db);
            });
          }
          catch { return finish(json({code:'FAIL',message:'支付账本暂不可用。'}, 503)); }
          return finish(await handleWechatNativeCallback(request, receiveWechatNativeNotification));
        }
        assertDatabaseIdentity(db, serverId);
        if (isNativeWebsitePath(new URL(request.url).pathname)) {
          if (!nativeWebsitePayment) return json({error:{code:'NOT_FOUND',message:'无法访问此资源。'}},404);
          try { assertWechatNativeBillingReady(db); }
          catch { return serviceUnavailable(); }
          return await nativeWebsitePayment.serve(request);
        }
        if (reviewedRecovery || wechatEnabled) {
          const pathname = new URL(request.url).pathname;
          if ((reviewedRecovery && (recoveryRoutes.has(pathname) || recoveryDecisionRoute.test(pathname))) ||
            (wechatEnabled && pathname.startsWith('/api/auth/wechat/'))) {
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
