import {randomUUID, createHash} from 'node:crypto';
import {authenticated} from './auth-api.mjs';
import {getCollectionTask, readTeamContext} from './repository.mjs';
import {ApiError, ID, deny, invalid, conflict, json, readJson, transaction} from './http-utils.mjs';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
function taskState(db, identity, teamId, taskId) {
  const context = readTeamContext(db, identity, teamId);
  if (!context || !getCollectionTask(db, context, taskId)) deny();
  return db.prepare(`SELECT task.status,COALESCE(version.revision,0) AS revision,task.project_id,project.status AS project_status
    FROM team_collection_tasks AS task JOIN team_projects AS project
    ON project.team_id=task.team_id AND project.project_id=task.project_id
    LEFT JOIN team_task_versions AS version ON version.team_id=task.team_id AND version.task_id=task.task_id
    WHERE task.team_id=? AND task.task_id=?`).get(teamId, taskId);
}
function submissionView(row) {
  return {id: row.submission_id, attachmentId: row.attachment_id, filename: row.display_name,
    sha256: row.content_sha256, byteLength: row.byte_length, createdAt: row.created_at};
}
function audit(db, identity, teamId, taskId, action, now) {
  db.prepare('INSERT INTO team_activity VALUES (?,?,?,?,?,?)').run(randomUUID(), teamId, identity.userId, action, taskId, now);
}
function nextRevision(db, teamId, taskId) {
  db.prepare('INSERT INTO team_task_versions VALUES (?,?,1) ON CONFLICT(team_id,task_id) DO UPDATE SET revision=revision+1').run(teamId, taskId);
}
function assertManager(db, identity, teamId, state) {
  const context = readTeamContext(db, identity, teamId);
  if (!['manager', 'partner'].includes(context?.role) || !db.prepare(`SELECT 1 FROM team_project_grants
    WHERE team_id=? AND project_id=? AND user_id=? AND permission='collection.manage' AND status='active'`).get(teamId, state.project_id, identity.userId)) deny();
}
export async function handleCollectionWriteRequest(request, {db, now = Date.now}) {
  const url = new URL(request.url);
  const match = /^\/api\/teams\/([^/]+)\/collection\/tasks\/([^/]+)\/(submissions|assignment|return)$/.exec(url.pathname);
  if (!match) return null;
  const [,teamId, taskId, action] = match;
  if (!ID.test(teamId) || !ID.test(taskId)) deny();
  if (url.search) invalid();
  const identity = authenticated(db, request, now());
  const state = taskState(db, identity, teamId, taskId);
  if (action === 'submissions' && request.method === 'GET') {
    const rows = db.prepare(`SELECT submission.submission_id,submission.attachment_id,attachment.display_name,
      submission.content_sha256,submission.byte_length,submission.created_at FROM team_task_submissions AS submission
      JOIN team_collection_attachments AS attachment ON attachment.team_id=submission.team_id AND attachment.attachment_id=submission.attachment_id
      WHERE submission.team_id=? AND submission.task_id=? AND submission.submitted_by=?
      ORDER BY submission.created_at,submission.submission_id`).all(teamId, taskId, identity.userId);
    return json({revision: state.revision, submissions: rows.map(submissionView)});
  }
  if (request.method !== 'POST') return json({error: {code: 'METHOD_NOT_ALLOWED', message: '不支持此操作。'}}, 405, {Allow: action === 'submissions' ? 'GET, POST' : 'POST'});
  if (action !== 'submissions') {
    assertManager(db, identity, teamId, state);
    const body = await readJson(request, action === 'assignment' ? ['userId'] : []);
    if (action === 'assignment' && (typeof body.userId !== 'string' || !ID.test(body.userId))) invalid();
    return transaction(db, () => {
      const freshIdentity = authenticated(db, request, now()), fresh = taskState(db, freshIdentity, teamId, taskId);
      assertManager(db, freshIdentity, teamId, fresh);
      if (fresh.project_status !== 'active') conflict();
      if (action === 'assignment') {
        if (!readTeamContext(db, {userId: body.userId}, teamId) || !db.prepare("SELECT 1 FROM team_users WHERE user_id=? AND status='active'").get(body.userId)) deny();
        db.prepare("UPDATE team_task_assignments SET status='revoked' WHERE team_id=? AND task_id=?").run(teamId, taskId);
        db.prepare("INSERT INTO team_task_assignments VALUES (?,?,?,'active') ON CONFLICT(team_id,task_id,user_id) DO UPDATE SET status='active'").run(teamId, taskId, body.userId);
      } else if (fresh.status !== 'submitted') conflict();
      nextRevision(db, teamId, taskId);
      if (action === 'return') db.prepare("UPDATE team_collection_tasks SET status='returned' WHERE team_id=? AND task_id=?").run(teamId, taskId);
      audit(db, freshIdentity, teamId, taskId, action === 'return' ? 'task.returned' : 'task.assigned', now());
      return json({revision: fresh.revision + 1});
    });
  }
  if (!db.prepare("SELECT 1 FROM team_task_assignments WHERE team_id=? AND task_id=? AND user_id=? AND status='active'").get(teamId, taskId, identity.userId)) deny();
  if (state.project_status !== 'active' || !['open', 'returned'].includes(state.status)) conflict();
  const body = await readJson(request, ['filename', 'contentBase64', 'revision'], 17 * 1024 * 1024);
  if (!Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.filename !== 'string' || !body.filename || [...body.filename].length > 180 || /[\x00-\x1f\x7f/\\]/.test(body.filename) || body.filename !== body.filename.toWellFormed()) invalid();
  if (typeof body.contentBase64 !== 'string' || body.contentBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new ApiError(413, 'TOO_LARGE', '单份资料最多12MiB。');
  if (!body.contentBase64 || body.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.contentBase64)) invalid();
  const bytes = Buffer.from(body.contentBase64, 'base64');
  if (!bytes.length || bytes.toString('base64') !== body.contentBase64) invalid();
  if (bytes.length > MAX_FILE_BYTES) throw new ApiError(413, 'TOO_LARGE', '单份资料最多12MiB。');
  const sha256 = createHash('sha256').update(bytes).digest('hex'), id = randomUUID(), attachmentId = randomUUID();
  return transaction(db, () => {
    const freshIdentity = authenticated(db, request, now()), fresh = taskState(db, freshIdentity, teamId, taskId);
    if (!db.prepare("SELECT 1 FROM team_task_assignments WHERE team_id=? AND task_id=? AND user_id=? AND status='active'").get(teamId, taskId, freshIdentity.userId)) deny();
    if (fresh.project_status !== 'active' || !['open', 'returned'].includes(fresh.status) || fresh.revision !== body.revision) conflict();
    const at = now();
    db.prepare('INSERT INTO team_collection_attachments VALUES (?,?,?,?,?)').run(teamId, taskId, attachmentId, body.filename, bytes);
    db.prepare('INSERT INTO team_task_submissions VALUES (?,?,?,?,?,?,?,?)').run(teamId, id, taskId, attachmentId, freshIdentity.userId, sha256, bytes.length, at);
    db.prepare("INSERT INTO team_attachment_grants VALUES (?,?,?,'active')").run(teamId, attachmentId, freshIdentity.userId);
    db.prepare("UPDATE team_collection_tasks SET status='submitted' WHERE team_id=? AND task_id=?").run(teamId, taskId);
    nextRevision(db, teamId, taskId);
    audit(db, freshIdentity, teamId, taskId, 'task.submitted', at);
    return json({revision: fresh.revision + 1, submission: {id, attachmentId, filename: body.filename, sha256, byteLength: bytes.length, createdAt: at}}, 201);
  });
}
