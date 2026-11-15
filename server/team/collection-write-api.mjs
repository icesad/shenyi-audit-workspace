import {randomUUID, createHash} from 'node:crypto';
import {authenticated} from './auth-api.mjs';
import {getCollectionTask, readTeamContext} from './repository.mjs';
import {ApiError, ID, deny, invalid, conflict, json, readJson, transaction} from './http-utils.mjs';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
// User-confirmed collection assignees: active interns or assistants in this team.
const ASSIGNEE_ROLES = Object.freeze(['intern','assistant']);
function sameActor(db,request,identity,at){
  const current=authenticated(db,request,at);if(current.userId!==identity.userId)deny();return current;
}
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
function canManage(db, identity, teamId, state) {
  const context = readTeamContext(db, identity, teamId);
  return ['manager', 'partner'].includes(context?.role) && !!db.prepare(`SELECT 1 FROM team_project_grants
    WHERE team_id=? AND project_id=? AND user_id=? AND permission='collection.manage' AND status='active'`).get(teamId, state.project_id, identity.userId);
}
function assertManager(db, identity, teamId, state) {
  if(!canManage(db,identity,teamId,state))deny();
}
function memberView(row){
  const displayName=[...String(row.display_name).toWellFormed().replace(/[\p{Cc}\p{Cf}]/gu,'').trim()].slice(0,80).join('')||row.user_id.slice(0,80);
  return {id:row.user_id,displayName,role:row.role};
}
function currentAssignees(db,teamId,taskId){
  const rows=db.prepare(`SELECT account.user_id,credential.display_name,member.role
    FROM team_task_assignments AS assignment
    JOIN team_users AS account ON account.user_id=assignment.user_id AND account.status='active'
    JOIN team_credentials AS credential ON credential.user_id=account.user_id
    JOIN team_memberships AS member ON member.team_id=assignment.team_id AND member.user_id=account.user_id
      AND member.status='active' AND member.role IN ('intern','assistant','manager','partner')
    WHERE assignment.team_id=? AND assignment.task_id=? AND assignment.status='active'
    ORDER BY account.user_id COLLATE BINARY LIMIT 51`).all(teamId,taskId);
  return {assignees:rows.slice(0,50).map(memberView),hasMoreAssignees:rows.length>50};
}
function candidateQuery(params){
  for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
  const q=params.get('q')??'',after=params.get('after')??'',rawLimit=params.get('limit');
  if(q.length>80||q!==q.toWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||(params.has('after')&&!ID.test(after))||(rawLimit!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)))invalid();
  return {q,after,limit:rawLimit===null?20:Number(rawLimit)};
}
function candidateMembers(db,teamId,{q,after,limit}){
  const where=`member.team_id=? AND member.status='active' AND member.role IN ('intern','assistant')
    AND account.status='active'`;
  const from=`FROM team_memberships AS member JOIN team_users AS account ON account.user_id=member.user_id
    JOIN team_credentials AS credential ON credential.user_id=member.user_id`;
  const escaped=q.replace(/[\\%_]/g,value=>'\\'+value),search=q?" AND credential.display_name LIKE ? ESCAPE '\\'":'',parameters=[teamId,...(q?['%'+escaped+'%']:[])];
  if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where}${search} AND member.user_id=?`).get(...parameters,after))deny();
  const rows=db.prepare(`SELECT member.user_id,credential.display_name,member.role ${from}
    WHERE ${where}${search} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
  return {members:rows.slice(0,limit).map(memberView),hasMore:rows.length>limit};
}
export async function handleCollectionWriteRequest(request, {db, now = Date.now}) {
  const url = new URL(request.url);
  const match = /^\/api\/teams\/([^/]+)\/collection\/tasks\/([^/]+)\/(submissions|assignment|return|management|assignees)$/.exec(url.pathname);
  if (!match) return null;
  const [,teamId, taskId, action] = match;
  if (!ID.test(teamId) || !ID.test(taskId)) deny();
  if (action!=='assignees'&&url.search) invalid();
  const identity = authenticated(db, request, now());
  const state = taskState(db, identity, teamId, taskId);
  if(action==='management'){
    if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
    if(!canManage(db,identity,teamId,state)||state.project_status!=='active'||state.status==='closed')return json({canManage:false});
    return json({canManage:true,revision:state.revision,status:state.status,...currentAssignees(db,teamId,taskId)});
  }
  if(action==='assignees'){
    if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
    assertManager(db,identity,teamId,state);if(state.project_status!=='active'||state.status==='closed')conflict();
    return json(candidateMembers(db,teamId,candidateQuery(url.searchParams)));
  }
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
    const body = await readJson(request, action === 'assignment' ? ['userId','revision'] : ['revision']);
    if(!Number.isSafeInteger(body.revision)||body.revision<0||body.revision>=Number.MAX_SAFE_INTEGER)invalid();
    if (action === 'assignment' && (typeof body.userId !== 'string' || !ID.test(body.userId))) invalid();
    sameActor(db,request,identity,now());
    return transaction(db, () => {
      const freshIdentity = sameActor(db, request,identity,now()), fresh = taskState(db, freshIdentity, teamId, taskId);
      assertManager(db, freshIdentity, teamId, fresh);
      if (fresh.project_status !== 'active'||fresh.status==='closed'||fresh.revision!==body.revision) conflict();
      if (action === 'assignment') {
        const assignee=readTeamContext(db, {userId: body.userId}, teamId);
        if (!assignee || !ASSIGNEE_ROLES.includes(assignee.role) || !db.prepare("SELECT 1 FROM team_users WHERE user_id=? AND status='active'").get(body.userId)) deny();
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
    const freshIdentity = sameActor(db, request,identity,now()), fresh = taskState(db, freshIdentity, teamId, taskId);
    if (!db.prepare("SELECT 1 FROM team_task_assignments WHERE team_id=? AND task_id=? AND user_id=? AND status='active'").get(teamId, taskId, freshIdentity.userId)) deny();
    if (fresh.project_status !== 'active' || !['open', 'returned'].includes(fresh.status) || fresh.revision !== body.revision||!Number.isSafeInteger(fresh.revision)||fresh.revision>=Number.MAX_SAFE_INTEGER) conflict();
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
