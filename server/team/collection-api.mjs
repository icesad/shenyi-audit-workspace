/** Isolated, read-only M1 API; not connected to the shipped app or public server.
 * Preseeded opaque sessions are test fixtures, not an independent login system.
 * Passwords, writes, devices, subscription enforcement and live file storage
 * belong to later milestones. Do not publish this prototype as production auth.
 */
import {
  readSession, readTeamContext, listCollectionTasks, getCollectionTask,
  getCollectionSummary, getCollectionAttachment, getCollectionAttachmentMetadata,
} from './repository.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Authorization',
});
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: {...PRIVATE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers},
});
const problem = (status, code, message, headers) => json({error: {code, message}}, status, headers);
const notFound = () => problem(404, 'NOT_FOUND', '无法访问此资源。');

function sessionToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('Authorization') || '');
  if (!match || Buffer.from(match[1], 'base64url').toString('base64url') !== match[1]) return null;
  return match[1];
}

function readRoute(url) {
  // Decode once; encoded separators or unexpected path components are rejected.
  const segments = url.pathname.split('/').slice(1).map(segment => decodeURIComponent(segment));
  if (segments.some(segment => !ID.test(segment))) return null;
  const [api, teams, teamId, collection, resource, taskId, attachments, attachmentId] = segments;
  if (api !== 'api' || teams !== 'teams' || collection !== 'collection') return null;
  if (segments.length === 5 && resource === 'summary') return {kind: 'summary', teamId};
  if (resource !== 'tasks') return null;
  if (segments.length === 5) return {kind: 'list', teamId};
  if (segments.length === 6) return {kind: 'task', teamId, taskId};
  if (segments.length === 8 && attachments === 'attachments') return {kind: 'attachment', teamId, taskId, attachmentId};
  return null;
}

function listOptions(params, kind) {
  const supported = kind === 'list' ? ['q', 'limit', 'after'] : [];
  for (const key of params.keys()) {
    if (!supported.includes(key) || params.getAll(key).length !== 1) throw new Error('QUERY');
  }
  const q = params.get('q') || '', after = params.get('after') || '';
  if (q.length > 100 || /[\x00-\x1f\x7f]/.test(q) || (after && !ID.test(after))) throw new Error('QUERY');
  const rawLimit = params.get('limit');
  if (rawLimit !== null && !/^(?:[1-9][0-9]?|100)$/.test(rawLimit)) throw new Error('QUERY');
  return {q, after, limit: rawLimit === null ? 100 : Number(rawLimit)};
}

function downloadName(name) {
  const safe = Array.from(String(name).toWellFormed().replace(/[\x00-\x1f\x7f/\\]/g, '_')).slice(0, 180).join('');
  return encodeURIComponent(safe).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function handleCollectionRequest(request, {db, now = Date.now} = {}) {
  try {
    const token = sessionToken(request);
    if (!token) return problem(401, 'SIGN_IN_REQUIRED', '请登录后重试。');
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid server clock');
    const identity = readSession(db, token, at);
    if (!identity) return problem(401, 'SIGN_IN_REQUIRED', '请登录后重试。');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return problem(403, 'CROSS_SITE_DENIED', '请在审迹客户端中操作。');
    const url = new URL(request.url);
    let route;
    try { route = readRoute(url); } catch {}
    const allow = route?.kind === 'attachment' ? 'GET, HEAD' : 'GET';
    if (request.method !== 'GET' && !(request.method === 'HEAD' && route?.kind === 'attachment')) {
      return problem(405, 'METHOD_NOT_ALLOWED', '不支持此操作。', {Allow: allow});
    }
    if (!route) return notFound();
    let options;
    try { options = listOptions(url.searchParams, route.kind); }
    catch { return problem(400, 'INVALID_QUERY', '查询参数无效。'); }
    const context = readTeamContext(db, identity, route.teamId);
    if (!context) return notFound();
    // Every call reads authoritative membership/grants afresh. Nothing is cached
    // in the client or session role, so revoked access applies next request.
    if (route.kind === 'list') return json(listCollectionTasks(db, context, options));
    if (route.kind === 'summary') return json(getCollectionSummary(db, context));
    if (route.kind === 'task') {
      const task = getCollectionTask(db, context, route.taskId);
      return task ? json({task}) : notFound();
    }
    const attachment = (request.method === 'HEAD' ? getCollectionAttachmentMetadata : getCollectionAttachment)(db, context, route.taskId, route.attachmentId);
    if (!attachment) return notFound();
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(attachment.bytes), {headers: {
      ...PRIVATE_HEADERS, 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="download.bin"; filename*=UTF-8''${downloadName(attachment.display_name)}`,
    }});
  } catch {
    // Never echo SQL, user/team identifiers, credentials or underlying errors.
    return problem(503, 'COLLECTION_UNAVAILABLE', '采集任务服务暂不可用。');
  }
}

export async function handleTeamCollectionRequest(request, options) {
  const response = await handleCollectionRequest(request, options);
  // Direct API callers, not just HTTP transports, must receive bodyless HEADs.
  if(request.method!=='HEAD')return response;
  const headers=new Headers(response.headers);
  if(response.status!==200)headers.delete('Content-Type');
  return new Response(null,{status:response.status,headers});
}
