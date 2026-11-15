import {createHash, randomBytes} from 'node:crypto';
import {hashPassword, verifyPassword, validPassword} from './passwords.mjs';
import {readSession} from './repository.mjs';
import {ApiError, json, readJson, invalid, getBearer, transaction} from './http-utils.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const DUMMY_HASH = 'scrypt$32768$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(64);
const work = new WeakMap();
export const normalizeUsername = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value) ? value : null;
const signInRequired = () => { throw new ApiError(401, 'SIGN_IN_REQUIRED', '账号或密码无效，请重新登录。'); };
const tooMany = () => { throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '操作过于频繁，请稍后重试。'); };

function consume(db, bucket, now, window, maximum) {
  const row = db.prepare('SELECT window_start,attempts FROM team_auth_limits WHERE bucket=?').get(bucket);
  const start = !row || now < row.window_start || now - row.window_start >= window ? now : row.window_start;
  const attempts = start === row?.window_start ? row.attempts : 0;
  if (attempts >= maximum) tooMany();
  db.prepare('INSERT INTO team_auth_limits VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts').run(bucket, start, attempts + 1);
}
function accountView(db, identity, expiresAt) {
  const row = db.prepare('SELECT display_name FROM team_credentials WHERE user_id=?').get(identity.userId);
  const memberships = db.prepare(`SELECT membership.team_id,membership.role FROM team_memberships AS membership
    JOIN teams AS team ON team.team_id=membership.team_id
    WHERE membership.user_id=? AND membership.status='active' AND team.status='active'
    AND membership.role IN ('intern','assistant','manager','partner') ORDER BY membership.team_id`).all(identity.userId);
  return {account: {id: identity.userId, displayName: row.display_name}, memberships: memberships.map(value => ({teamId: value.team_id, role: value.role})), expiresAt};
}
export function authenticated(db, request, at) {
  const token = getBearer(request), identity = token && readSession(db, token, at);
  if (!identity) signInRequired();
  return {...identity, token};
}
async function limitedPasswordWork(db, action) {
  const busy = work.get(db) || 0;
  if (busy >= 2) tooMany();
  work.set(db, busy + 1);
  try { return await action(); } finally { work.set(db, work.get(db) - 1); }
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
        const token = randomBytes(32).toString('base64url'), expiresAt = now() + 8 * 60 * 60_000;
        db.prepare('INSERT INTO team_sessions VALUES (?,?,?,NULL)').run(digest(token), row.user_id, expiresAt);
        db.prepare('DELETE FROM team_auth_limits WHERE bucket=?').run('login:' + digest(username));
        return json({token, ...accountView(db, {userId: row.user_id}, expiresAt)});
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
  return limitedPasswordWork(db, async () => {
    const previous = db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(identity.userId);
    if (!previous || !await verifyPassword(body.currentPassword, previous.password_hash)) signInRequired();
    const encoded = await hashPassword(body.newPassword);
    return transaction(db, () => {
      authenticated(db, request, now());
      const changed = db.prepare('UPDATE team_credentials SET password_hash=?,revision=revision+1 WHERE user_id=? AND password_hash=? AND revision=?').run(encoded, identity.userId, previous.password_hash, previous.revision);
      if (changed.changes !== 1) throw new ApiError(409, 'CREDENTIAL_CHANGED', '账号状态已改变，请重新登录。');
      db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), identity.userId);
      return json({signedOut: true});
    });
  });
}
