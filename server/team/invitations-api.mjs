import {createHash, randomBytes} from 'node:crypto';
import {authenticated, normalizeUsername} from './auth-api.mjs';
import {readTeamContext} from './repository.mjs';
import {ID, deny, invalid, json, readJson, transaction, conflict} from './http-utils.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
function canInvite(db, identity, teamId) {
  return readTeamContext(db, identity, teamId) && db.prepare("SELECT 1 FROM team_admin_grants WHERE team_id=? AND user_id=? AND permission='member.invite' AND status='active'").get(teamId, identity.userId);
}
export async function handleInvitationRequest(request, {db, now}) {
  const url = new URL(request.url), match = /^\/api\/teams\/([^/]+)\/invitations$/.exec(url.pathname);
  const accept = url.pathname === '/api/auth/invitations/accept';
  if (!match && !accept) return null;
  if (url.search) invalid();
  const identity = authenticated(db, request, now());
  if (request.method !== 'POST') return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
  if (accept) {
    const body = await readJson(request, ['invitationToken']);
    if (typeof body.invitationToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.invitationToken)) invalid();
    return transaction(db, () => {
      authenticated(db, request, now());
      const invitation = db.prepare('SELECT * FROM team_invitations WHERE token_hash=?').get(digest(body.invitationToken));
      const credential = db.prepare('SELECT username FROM team_credentials WHERE user_id=?').get(identity.userId);
      if (!invitation || invitation.accepted_at !== null || invitation.expires_at <= now() || invitation.username !== credential?.username) deny();
      const inviter = db.prepare("SELECT 1 FROM team_users WHERE user_id=? AND status='active'").get(invitation.invited_by);
      if (!inviter || !canInvite(db, {userId: invitation.invited_by}, invitation.team_id)) deny();
      if (db.prepare('SELECT 1 FROM team_memberships WHERE team_id=? AND user_id=?').get(invitation.team_id, identity.userId)) conflict();
      db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run(invitation.team_id, identity.userId, invitation.role);
      db.prepare('UPDATE team_invitations SET accepted_at=? WHERE token_hash=?').run(now(), invitation.token_hash);
      return json({joined:true,teamId:invitation.team_id,role:invitation.role});
    });
  }
  const teamId = match[1];
  if (!ID.test(teamId) || !canInvite(db, identity, teamId)) deny();
  const body = await readJson(request, ['username','role']);
  if (!normalizeUsername(body.username) || !['intern','assistant'].includes(body.role)) invalid();
  return transaction(db, () => {
    authenticated(db, request, now());
    if (!canInvite(db, identity, teamId)) deny();
    const invitationToken = randomBytes(32).toString('base64url'), expiresAt = now()+24*60*60_000;
    db.prepare('INSERT INTO team_invitations VALUES (?,?,?,?,?,?,NULL)').run(digest(invitationToken),teamId,body.username,body.role,identity.userId,expiresAt);
    return json({invitationToken,expiresAt},201);
  });
}
