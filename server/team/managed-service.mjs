import {createPrivateKey, X509Certificate} from 'node:crypto';
import {createServer} from 'node:https';
import {isIP} from 'node:net';
import {handleTeamApplicationRequest} from './application-api.mjs';
import {json} from './http-utils.mjs';
import {serviceUnavailable, startLoopbackTeamListener} from './team-http-listener.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const messages = {
  MANAGED_SERVICE_CONFIGURATION_INVALID: '本机团队服务启动配置无效。',
  MANAGED_DATABASE_NOT_READY: '所选团队库无法用于受管服务。',
  MANAGED_TLS_INVALID: '本机团队服务 TLS 配置无效。',
  MANAGED_SERVICE_LISTEN_FAILED: '本机团队服务无法监听指定端口。',
};
const essentialColumns = {
  team_database_metadata: 'name, value',
  team_users: 'user_id, status',
  team_credentials: 'user_id, username, password_hash, revision',
  team_phone_credentials: 'user_id, phone, verified_at, revision',
  team_auth_limits: 'bucket, window_start, attempts',
  team_sessions: 'token_hash, user_id, expires_at, revoked_at',
  team_session_metadata: 'session_id, token_hash, created_at',
  team_device_bindings: 'device_id, user_id, public_key, key_fingerprint, revision, status',
  team_device_challenges: 'challenge_id, purpose, server_id, session_binding',
  team_device_leases: 'lease_id, device_id, auth_session_hash, token_hash',
  team_device_request_replays: 'lease_id, nonce_hash',
  team_device_events: 'event_id, device_id, action',
  team_device_usage: 'device_id, user_id, last_used_at',
  team_recovery_identity_epochs: 'user_id, version',
  teams: 'team_id, status',
  team_memberships: 'team_id, user_id, role, status',
  team_operators: 'team_id, user_id, role, status',
  team_administrator_business_roles: 'team_id, user_id, role, status',
  team_invitations: 'token_hash, team_id, expires_at, accepted_at',
  team_employee_invitations: 'invitation_id, team_id, expires_at, revoked_at, accepted_at',
  team_operator_employee_invitations: 'invitation_id, team_id, expires_at, revoked_at, accepted_at',
  team_subscription_heads: 'team_id, revision',
  team_subscription_events: 'team_id, revision, starts_at, ends_at',
  team_seat_capacity_grants: 'team_id, seats, starts_at, ends_at',
  team_projects: 'team_id, project_id, status',
  team_project_grants: 'team_id, project_id, user_id',
  team_collection_tasks: 'team_id, project_id, task_id, status',
  team_task_assignments: 'team_id, task_id, user_id, status',
  team_collection_workspace_creations: 'team_id, project_id, kind',
  team_workspace_formalizations: 'team_id, project_id, business_number',
  team_material_records: 'team_id, project_id, material_revision',
  team_ledger_check_heads: 'team_id, project_id, revision',
  team_workpaper_data_heads: 'team_id, project_id, revision',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), {code});
}

function assertDatabaseIdentity(db, serverId) {
  const metadata = db.prepare(`SELECT name, value FROM main.team_database_metadata
    WHERE name IN ('prototype-version', 'device-server-id', 'demo') OR name GLOB '*-demo'`).all();
  if (metadata.length !== 2 || !metadata.some(row => row.name === 'prototype-version' && row.value === '2') ||
      !metadata.some(row => row.name === 'device-server-id' && row.value === serverId)) {
    fail('MANAGED_DATABASE_NOT_READY');
  }
}

/** Check an already provisioned database without initializing or mutating it. */
export function assertManagedDatabaseReady(db, serverId) {
  try {
    if (typeof serverId !== 'string' || !uuid.test(serverId) || db.isTransaction ||
        db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) fail('MANAGED_DATABASE_NOT_READY');
    assertDatabaseIdentity(db, serverId);
    const tables = new Set(db.prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table'").all().map(row => row.name));
    for (const [table, columns] of Object.entries(essentialColumns)) {
      if (!tables.has(table)) fail('MANAGED_DATABASE_NOT_READY');
      db.prepare(`SELECT ${columns} FROM main.${table} LIMIT 0`).get();
    }
  } catch { fail('MANAGED_DATABASE_NOT_READY'); }
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
export async function startManagedTeamServer({db, apiBase, port = 0, serverId, key, cert, sms, phonePepper} = {}) {
  const origin = managedOrigin(apiBase, port, serverId);
  assertManagedDatabaseReady(db, serverId);
  checkTlsConfiguration(origin, key, cert);
  const hasSms = sms !== undefined || phonePepper !== undefined;
  if (hasSms && (typeof sms?.send !== 'function' || !Buffer.isBuffer(phonePepper) || phonePepper.length !== 32)) {
    fail('MANAGED_SERVICE_CONFIGURATION_INVALID');
  }
  const pepper = hasSms ? Buffer.from(phonePepper) : undefined;
  const identityProviders = Object.freeze({deviceProofRequired:true,
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
          try { assertManagedDatabaseReady(db, serverId); }
          catch { return json({status:'not-ready'}, 503); }
          return json({status:'ready'});
        }
        assertDatabaseIdentity(db, serverId);
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
