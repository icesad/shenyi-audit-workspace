/** Phone identity boundary. SMS and recovery adapters are server-only injected
 * capabilities; absent configuration is an explicit failure, never fake delivery.
 * No signup, role elevation, phone replacement or automatic account merging.
 */
import {createHash, createHmac, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {
  authenticated, consume, limitedPasswordWork, issueSession,
} from './auth-api.mjs';
import {hashPassword, validPassword, verifyPassword} from './passwords.mjs';
import {ApiError, ID, invalid, json, readJson, transaction} from './http-utils.mjs';
import {reviewedRecovery,validateReviewedRecovery,consumeReviewedRecovery} from './recovery-review-policy.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const DUMMY_HASH = 'scrypt$32768$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(64);
const genericChallengeError = () => { throw new ApiError(400, 'INVALID_CHALLENGE', '验证请求无效或已失效，请重新验证。'); };
const signInError = () => { throw new ApiError(401, 'SIGN_IN_REQUIRED', '账号或密码无效，请重新登录。'); };
const credentialConflict = () => { throw new ApiError(409, 'CREDENTIAL_CHANGED', '账号状态已改变，请重新验证。'); };
const maskedPhone = phone => phone.slice(0, 5) + '****' + phone.slice(-4);

export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 64) invalid();
  let phone = value.normalize('NFKC').trim().replace(/[\s()-]/g, '');
  if (phone.startsWith('0086')) phone = phone.slice(4);
  else if (phone.startsWith('+86')) phone = phone.slice(3);
  if (!/^1[3-9]\d{9}$/.test(phone)) invalid();
  return '+86' + phone;
}

function providersForSms(identityProviders) {
  if (typeof identityProviders.sms?.send !== 'function' || !Buffer.isBuffer(identityProviders.phonePepper) || identityProviders.phonePepper.length < 32) {
    throw new ApiError(503, 'SMS_UNAVAILABLE', '手机号验证服务尚未开通。');
  }
  return {sms: identityProviders.sms, pepper: identityProviders.phonePepper};
}
function recoveryProvider(identityProviders) {
  if(reviewedRecovery(identityProviders))return null;
  if (typeof identityProviders.recovery?.authorize !== 'function') throw new ApiError(503, 'RECOVERY_NOT_CONFIGURED', '账号恢复流程尚未开通。');
  return identityProviders.recovery;
}
function credential(db, userId) {
  return db.prepare(`SELECT account.status,credential.password_hash,credential.revision
    FROM team_users AS account JOIN team_credentials AS credential ON credential.user_id=account.user_id
    WHERE account.user_id=?`).get(userId);
}
function codeMac(row, code, pepper) {
  const fields=[
    row.challenge_id, row.purpose, row.user_id, row.phone, row.session_hash,
    row.credential_revision, row.expires_at, code,
  ];
  // Keep the original bind contract, but make recovery ownership snapshots
  // authenticated. Editing snapshot metadata cannot revive a stale code.
  if(row.purpose==='reset')fields.push('phone-binding.v1',row.phone_revision??null,row.phone_verified_at??null);
  return createHmac('sha256', pepper).update(JSON.stringify(fields)).digest('hex');
}
function validMac(row, code, pepper) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(row.code_mac || '')) return false;
  return timingSafeEqual(Buffer.from(row.code_mac, 'hex'), Buffer.from(codeMac(row, code, pepper), 'hex'));
}
function liveChallenge(db, challengeId, purpose, at) {
  const row = db.prepare(`SELECT * FROM team_phone_challenges WHERE challenge_id=? AND purpose=?
    AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<=5`).get(challengeId, purpose, at);
  if (!row) genericChallengeError();
  return withPhoneBinding(db,row);
}
function reserveAttempt(db, challengeId, purpose, at, identity) {
  // The attempt counter is committed before asynchronous KDF/recovery work, and
  // is deliberately NOT rolled back on a bad code/password or later conflict.
  const row = db.prepare(`UPDATE team_phone_challenges SET attempts=attempts+1
    WHERE challenge_id=? AND purpose=? AND delivery_state='sent'
    AND consumed_at IS NULL AND expires_at>? AND attempts<5
    ${identity ? 'AND user_id=? AND session_hash=?' : ''} RETURNING *`)
    .get(challengeId, purpose, at, ...(identity ? [identity.userId, digest(identity.token)] : []));
  if (!row) genericChallengeError();
  return withPhoneBinding(db,row);
}
function sameCredential(row, current) {
  return current?.status === 'active' && current.revision === row.credential_revision;
}
function validPhoneMapping(mapping,at){return !!mapping&&Number.isSafeInteger(mapping.revision)&&mapping.revision>=1&&Number.isSafeInteger(mapping.verified_at)&&mapping.verified_at>0&&mapping.verified_at<=at;}
function withPhoneBinding(db,row){
  if(row.purpose!=='reset')return row;
  const binding=db.prepare('SELECT phone_revision,verified_at FROM team_phone_challenge_bindings WHERE challenge_id=?').get(row.challenge_id);
  return {...row,phone_revision:binding?.phone_revision??null,phone_verified_at:binding?.verified_at??null};
}
function samePhoneOwner(db, row,at) {
  const mapping=row.user_id&&db.prepare('SELECT revision,verified_at FROM team_phone_credentials WHERE user_id=? AND phone=?').get(row.user_id, row.phone);
  return validPhoneMapping(mapping,at)&&mapping.revision===row.phone_revision&&mapping.verified_at===row.phone_verified_at;
}
function consumeChallenge(db, row, at) {
  const changed = db.prepare(`UPDATE team_phone_challenges SET consumed_at=?
    WHERE challenge_id=? AND consumed_at IS NULL AND delivery_state='sent'
    AND expires_at>? AND attempts<=5`).run(at, row.challenge_id, at);
  if (changed.changes !== 1) genericChallengeError();
}
function currentChallengeForBind(db, request, row, now) {
  const identity = authenticated(db, request, now());
  const fresh = liveChallenge(db, row.challenge_id, 'bind', now());
  if (fresh.user_id !== identity.userId || fresh.session_hash !== digest(identity.token) || !sameCredential(fresh, credential(db, identity.userId))) genericChallengeError();
  return {fresh, identity};
}

/** Server-only SMS proof, including unknown-owner challenges. Public approval
 * requests return an indistinguishable receipt for unroutable verified phones. */
export function verifyRecoveryRequestChallenge(db,challengeId,code,pepper,at,{reserve=true}={}){
  const row=reserve?reserveAttempt(db,challengeId,'reset',at):liveChallenge(db,challengeId,'reset',at);if(!validMac(row,code,pepper))genericChallengeError();
  return {row,eligible:!!row.user_id&&samePhoneOwner(db,row,at)&&sameCredential(row,credential(db,row.user_id))};
}

export async function handlePhoneRequest(request, {db, now = Date.now, identityProviders = {}}) {
  const url = new URL(request.url), pathname = url.pathname;
  const routes = ['/api/auth/phone/challenges', '/api/auth/phone/bind', '/api/auth/phone/login', '/api/auth/phone/reset'];
  if (!routes.includes(pathname)) return null;
  if (url.search) invalid();
  if (request.method !== 'POST') return json({error: {code: 'METHOD_NOT_ALLOWED', message: '不支持此操作。'}}, 405, {Allow: 'POST'});

  if (pathname === '/api/auth/phone/login') {
    // Validate the request before spending any authentication budget. The
    // trusted edge proxy overwrites this header with its observed client IP.
    const body = await readJson(request, ['phone', 'password']);
    const phone = normalizePhone(body.phone);
    if (typeof body.password !== 'string' || Buffer.byteLength(body.password) > 512) invalid();
    const suppliedAddress = request.headers.get('x-shenyi-client-ip') || 'local';
    const clientAddress = isIP(suppliedAddress) ? suppliedAddress.toLowerCase() : 'local';
    consume(db, 'phone-login-ip:' + digest(clientAddress), now(), 60_000, 60);
    consume(db, 'phone-login:' + digest(phone), now(), 15 * 60_000, 10);
    return limitedPasswordWork(db, async () => {
      const mapping = db.prepare('SELECT user_id,revision FROM team_phone_credentials WHERE phone=?').get(phone);
      const previous = mapping && credential(db, mapping.user_id);
      const valid = await verifyPassword(body.password, previous?.password_hash || DUMMY_HASH);
      if (!mapping || !previous || !valid || previous.status !== 'active') signInError();
      return transaction(db, () => {
        const freshMapping = db.prepare('SELECT user_id,revision FROM team_phone_credentials WHERE phone=?').get(phone);
        const fresh = credential(db, mapping.user_id);
        if (freshMapping?.user_id !== mapping.user_id || freshMapping.revision !== mapping.revision || fresh?.status !== 'active' || fresh.revision !== previous.revision || fresh.password_hash !== previous.password_hash) signInError();
        db.prepare('DELETE FROM team_auth_limits WHERE bucket=?').run('phone-login:' + digest(phone));
        return json(issueSession(db, mapping.user_id, now()));
      });
    });
  }

  if (pathname === '/api/auth/phone/challenges') {
    const body = await readJson(request, ['phone', 'purpose']);
    const phone = normalizePhone(body.phone);
    if (!['bind', 'reset'].includes(body.purpose)) invalid();
    if (body.purpose === 'reset') recoveryProvider(identityProviders);
    const {sms, pepper} = providersForSms(identityProviders);
    const identity = body.purpose === 'bind' ? authenticated(db, request, now()) : null;
    const mapping=body.purpose==='reset'?db.prepare('SELECT user_id,revision,verified_at FROM team_phone_credentials WHERE phone=?').get(phone):null;
    const owner = body.purpose === 'reset' ? validPhoneMapping(mapping,now())?mapping.user_id:null : identity.userId;
    const previous = owner ? credential(db, owner) : null;
    if (identity && previous?.status !== 'active') signInError();
    consume(db, 'sms:global', now(), 60_000, 60);
    consume(db, 'sms:phone:' + digest(phone), now(), 10 * 60_000, 3);
    if (identity) consume(db, 'sms:user:' + digest(identity.userId), now(), 10 * 60_000, 10);
    const at = now(), row = {
      challenge_id: randomUUID(), purpose: body.purpose, phone, user_id: owner,
      session_hash: identity ? digest(identity.token) : null,
      credential_revision: previous?.revision ?? null, expires_at: at + 5 * 60_000,
      ...(body.purpose==='reset'?{phone_revision:owner?mapping.revision:null,phone_verified_at:owner?mapping.verified_at:null}:{}),
    };
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    transaction(db,()=>{
      db.prepare(`INSERT INTO team_phone_challenges
        (challenge_id,purpose,phone,user_id,session_hash,credential_revision,code_mac,expires_at,delivery_state)
        VALUES (?,?,?,?,?,?,?,?,'sending')`).run(row.challenge_id, row.purpose, row.phone, row.user_id,
          row.session_hash, row.credential_revision, codeMac(row, code, pepper), row.expires_at);
      if(row.purpose==='reset'&&owner)db.prepare('INSERT INTO team_phone_challenge_bindings VALUES (?,?,?)').run(row.challenge_id,row.phone_revision,row.phone_verified_at);
    });
    // Unknown reset phone follows the same provider path and response contract.
    // Its null owner cannot reset an account; no existence bit is returned.
    try { await sms.send({phone, code, purpose: row.purpose, challengeId: row.challenge_id}); }
    catch {
      db.prepare("UPDATE team_phone_challenges SET delivery_state='failed' WHERE challenge_id=?").run(row.challenge_id);
      throw new ApiError(503, 'SMS_UNAVAILABLE', '手机号验证服务暂不可用。');
    }
    try {
      transaction(db, () => {
        if (identity) {
          const active = authenticated(db, request, now());
          if (active.userId !== row.user_id || digest(active.token) !== row.session_hash || !sameCredential(row, credential(db, active.userId))) genericChallengeError();
        }
        if(row.purpose==='reset'&&row.user_id&&!samePhoneOwner(db,row,now()))genericChallengeError();
        if (now() >= row.expires_at) genericChallengeError();
        db.prepare("UPDATE team_phone_challenges SET delivery_state='sent' WHERE challenge_id=? AND delivery_state='sending'").run(row.challenge_id);
      });
    } catch (error) {
      db.prepare("UPDATE team_phone_challenges SET delivery_state='failed' WHERE challenge_id=?").run(row.challenge_id);
      throw error;
    }
    return json({challengeId: row.challenge_id, expiresAt: row.expires_at}, 202);
  }

  if (pathname === '/api/auth/phone/bind') {
    const {pepper} = providersForSms(identityProviders);
    const identity = authenticated(db, request, now());
    const body = await readJson(request, ['challengeId', 'code', 'currentPassword']);
    if (typeof body.challengeId !== 'string' || !ID.test(body.challengeId) || typeof body.currentPassword !== 'string' || Buffer.byteLength(body.currentPassword) > 512) invalid();
    const row = reserveAttempt(db, body.challengeId, 'bind', now(), identity);
    if (!validMac(row, body.code, pepper)) genericChallengeError();
    consume(db, 'phone-bind:' + digest(identity.userId), now(), 15 * 60_000, 10);
    return limitedPasswordWork(db, async () => {
      const previous = credential(db, identity.userId);
      if (!sameCredential(row, previous) || !await verifyPassword(body.currentPassword, previous.password_hash)) signInError();
      return transaction(db, () => {
        const {fresh} = currentChallengeForBind(db, request, row, now);
        const current = credential(db, identity.userId);
        if (current.password_hash !== previous.password_hash || current.revision !== previous.revision) credentialConflict();
        if (db.prepare('SELECT 1 FROM team_phone_credentials WHERE user_id=? OR phone=?').get(identity.userId, fresh.phone)) throw new ApiError(409, 'PHONE_ALREADY_BOUND', '手机号或账号已有关联，请使用已确认的账号恢复流程。');
        consumeChallenge(db, fresh, now());
        db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(identity.userId, fresh.phone, now());
        return json({phoneVerified: true, phoneMasked: maskedPhone(fresh.phone)});
      });
    });
  }

  const recovery = recoveryProvider(identityProviders), {pepper} = providersForSms(identityProviders);
  const body = await readJson(request, ['challengeId', 'code', 'newPassword', 'recoveryProof']);
  if (typeof body.challengeId !== 'string' || !ID.test(body.challengeId) || !validPassword(body.newPassword) || typeof body.recoveryProof !== 'string' || !body.recoveryProof || body.recoveryProof.length > 1024) invalid();
  const row = reserveAttempt(db, body.challengeId, 'reset', now());
  if (!validMac(row, body.code, pepper) || !row.user_id || !samePhoneOwner(db, row,now()) || !sameCredential(row, credential(db, row.user_id))) genericChallengeError();
  const previous = credential(db, row.user_id);
  if(reviewedRecovery(identityProviders))validateReviewedRecovery(db,row.user_id,row.challenge_id,body.recoveryProof,now());
  else{
    let approved;
    try { approved = await recovery.authorize({userId: row.user_id, challengeId: row.challenge_id, recoveryProof: body.recoveryProof}); }
    catch { genericChallengeError(); }
    if (approved !== true) genericChallengeError();
  }
  return limitedPasswordWork(db, async () => {
    const encoded = await hashPassword(body.newPassword);
    return transaction(db, () => {
      const fresh = liveChallenge(db, row.challenge_id, 'reset', now()), current = credential(db, row.user_id);
      if (!validMac(fresh,body.code,pepper)||!samePhoneOwner(db, fresh,now()) || !sameCredential(fresh, current) || current.password_hash !== previous.password_hash || current.revision !== previous.revision) genericChallengeError();
      if(reviewedRecovery(identityProviders))consumeReviewedRecovery(db,row.user_id,row.challenge_id,body.recoveryProof,now());
      consumeChallenge(db, fresh, now());
      const changed = db.prepare('UPDATE team_credentials SET password_hash=?,revision=revision+1 WHERE user_id=? AND password_hash=? AND revision=?').run(encoded, row.user_id, previous.password_hash, previous.revision);
      if (changed.changes !== 1) credentialConflict();
      db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(), row.user_id);
      db.prepare('UPDATE team_phone_challenges SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(now(), row.user_id);
      return json({signedOut: true});
    });
  });
}
