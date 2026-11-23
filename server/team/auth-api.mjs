import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {hashPassword, verifyPassword, validPassword} from './passwords.mjs';
import {readSession} from './repository.mjs';
import {ApiError, json, readJson, invalid, getBearer, transaction} from './http-utils.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const DUMMY_HASH = 'scrypt$32768$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(64);
const work = new WeakMap();
export const normalizeUsername = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value) ? value : null;
const signInRequired = () => { throw new ApiError(401, 'SIGN_IN_REQUIRED', '账号或密码无效，请重新登录。'); };
const tooMany = () => { throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '操作过于频繁，请稍后重试。'); };

export function consume(db, bucket, now, window, maximum) {
  const row = db.prepare('SELECT window_start,attempts FROM team_auth_limits WHERE bucket=?').get(bucket);
  const start = !row || now < row.window_start || now - row.window_start >= window ? now : row.window_start;
  const attempts = start === row?.window_start ? row.attempts : 0;
  if (attempts >= maximum) tooMany();
  db.prepare('INSERT INTO team_auth_limits VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts').run(bucket, start, attempts + 1);
}
/** Keep anonymous per-source onboarding buckets bounded and reclaim expired windows. */
export function consumeBounded(db, prefix, bucket, now, window, maximum, capacity = 10_000) {
  if (typeof prefix !== 'string' || !prefix || !bucket.startsWith(prefix) ||
      !Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError('Invalid bounded rate-limit bucket');
  return transaction(db, () => {
    db.prepare('DELETE FROM team_auth_limits WHERE substr(bucket,1,length(?))=? AND window_start<?')
      .run(prefix, prefix, now - window);
    const count = db.prepare('SELECT COUNT(*) AS count FROM team_auth_limits WHERE substr(bucket,1,length(?))=?')
      .get(prefix, prefix).count;
    if (count >= capacity) {
      db.prepare(`DELETE FROM team_auth_limits WHERE bucket IN (
        SELECT bucket FROM team_auth_limits
        WHERE substr(bucket,1,length(?))=? AND bucket<>?
        ORDER BY window_start ASC,bucket ASC LIMIT ?
      )`).run(prefix, prefix, bucket, count - capacity + 1);
    }
    consume(db, bucket, now, window, maximum);
  });
}
export function accountView(db, identity, expiresAt) {
  const row = db.prepare('SELECT display_name FROM team_credentials WHERE user_id=?').get(identity.userId);
  const memberships = db.prepare(`SELECT membership.team_id,membership.role FROM team_memberships AS membership
    JOIN teams AS team ON team.team_id=membership.team_id
    WHERE membership.user_id=? AND membership.status='active' AND team.status='active'
    AND membership.role IN ('intern','assistant','manager','partner') AND ${administratorBusinessEligibilitySql('membership')} ORDER BY membership.team_id`).all(identity.userId);
  return {account: {id: identity.userId, displayName: row.display_name}, memberships: memberships.map(value => ({teamId: value.team_id, role: value.role})), expiresAt};
}
export function authenticated(db, request, at) {
  const token = getBearer(request), identity = token && readSession(db, token, at);
  if (!identity) signInRequired();
  return {...identity, token};
}
export async function limitedPasswordWork(db, action) {
  const busy = work.get(db) || 0;
  if (busy >= 2) tooMany();
  work.set(db, busy + 1);
  try { return await action(); } finally { work.set(db, work.get(db) - 1); }
}
/** Stable, non-credential management IDs; never invent legacy creation times. */
export function ensureSessionMetadata(db, userId) {
  const rows=db.prepare(`SELECT session.token_hash FROM team_sessions AS session
    LEFT JOIN team_session_metadata AS metadata ON metadata.token_hash=session.token_hash
    WHERE metadata.token_hash IS NULL${userId===undefined?'':' AND session.user_id=?'}`)
    .all(...(userId===undefined?[]:[userId]));
  const insert=db.prepare('INSERT INTO team_session_metadata(session_id,token_hash,created_at) VALUES (?,?,NULL) ON CONFLICT(token_hash) DO NOTHING');
  for(const row of rows)insert.run(randomUUID(),row.token_hash);
}
/** Must be called after authoritative identity checks, within a transaction. */
export function issueSession(db, userId, at) {
  if (!db.prepare("SELECT 1 FROM team_users WHERE user_id=? AND status='active'").get(userId)) signInRequired();
  const token=randomBytes(32).toString('base64url'),expiresAt=at+8*60*60_000;
  const tokenHash=digest(token);
  db.prepare('INSERT INTO team_sessions VALUES (?,?,?,NULL)').run(tokenHash,userId,expiresAt);
  db.prepare('INSERT INTO team_session_metadata(session_id,token_hash,created_at) VALUES (?,?,?)').run(randomUUID(),tokenHash,at);
  return {token,...accountView(db,{userId},expiresAt)};
}

export async function handleAuthRequest(request, {db, now = Date.now}) {
  const url = new URL(request.url), path = url.pathname;
  if (!['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/auth/password'].includes(path)) return null;
  if (url.search) invalid();
  const expected = path === '/api/auth/session' ? 'GET' : 'POST';
  if (request.method !== expected) return json({error: {code: 'METHOD_NOT_ALLOWED', message: '不支持此操作。'}}, 405, {Allow: expected});
  const at = now();
  if (path === '/api/auth/login') {
    consume(db, 'login:global', at, 60_000, 60);
    const body = await readJson(request, ['username', 'password']);
    const username = normalizeUsername(body.username);
    if (!username || typeof body.password !== 'string' || Buffer.byteLength(body.password) > 512) invalid();
    consume(db, 'login:' + digest(username), now(), 15 * 60_000, 10);
    return limitedPasswordWork(db, async () => {
      const row = db.prepare(`SELECT credential.user_id,credential.password_hash,credential.revision,account.status
        FROM team_credentials AS credential JOIN team_users AS account ON account.user_id=credential.user_id
        WHERE credential.username=?`).get(username);
      const valid = await verifyPassword(body.password, row?.password_hash || DUMMY_HASH);
      if (!valid || !row || row.status !== 'active') signInRequired();
      return transaction(db, () => {
        const fresh = db.prepare(`SELECT credential.password_hash,credential.revision,account.status FROM team_credentials AS credential
          JOIN team_users AS account ON account.user_id=credential.user_id WHERE credential.user_id=?`).get(row.user_id);
        if (fresh?.password_hash !== row.password_hash || fresh?.revision !== row.revision || fresh?.status !== 'active') signInRequired();
        const session=issueSession(db,row.user_id,now());
        db.prepare('DELETE FROM team_auth_limits WHERE bucket=?').run('login:' + digest(username));
        return json(session);
      });
    });
  }
  const identity = authenticated(db, request, at);
  if (path === '/api/auth/session') {
    const session = db.prepare('SELECT expires_at FROM team_sessions WHERE token_hash=?').get(digest(identity.token));
    return json(accountView(db, identity, session.expires_at));
  }
  if (path === '/api/auth/logout') {
    await readJson(request, []);
    db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(now(), digest(identity.token));
    return json({signedOut: true});
  }
  consume(db, 'password:' + digest(identity.userId), at, 15 * 60_000, 10);
  const body = await readJson(request, ['currentPassword', 'newPassword']);
  if (typeof body.currentPassword !== 'string' || Buffer.byteLength(body.currentPassword) > 512 || !validPassword(body.newPassword)) invalid();
  // Streamed bodies may finish after the original login or its owner changed.
  const actor = authenticated(db, request, now());
  if (actor.userId !== identity.userId) signInRequired();
  return limitedPasswordWork(db, async () => {
    const previous = db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(identity.userId);
    if (!previous) throw new ApiError(409, 'CREDENTIAL_CHANGED', '账号状态已改变，请重新登录。');
    if (!await verifyPassword(body.currentPassword, previous.password_hash)) throw new ApiError(403, 'VERIFICATION_FAILED', '当前密码验证未通过，请核对后重试。');
    const encoded = await hashPassword(body.newPassword);
    return transaction(db, () => {
      const freshActor = authenticated(db, request, now());
      if (freshActor.userId !== identity.userId) signInRequired();
      const changed = db.prepare('UPDATE team_credentials SET password_hash=?,revision=revision+1 WHERE user_id=? AND password_hash=? AND revision=?').run(encoded, identity.userId, previous.password_hash, previous.revision);
      if (changed.changes !== 1) throw new ApiError(409, 'CREDENTIAL_CHANGED', '账号状态已改变，请重新登录。');
      db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), identity.userId);
      return json({signedOut: true});
    });
  });
}
