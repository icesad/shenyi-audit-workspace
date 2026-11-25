import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {createHash} from 'node:crypto';
import {collectionTaskScope, collectionTaskView, isCollectionRole} from './access-policy.mjs';

// M1 uses the DatabaseSync prepared-statement interface in an isolated database.
// A production repository must preserve these scope/transaction invariants.
export function readSession(db, bearerToken, now) {
  const digest = createHash('sha256').update(bearerToken).digest('hex');
  const row = db.prepare(`SELECT session.user_id FROM team_sessions AS session
    JOIN team_users AS account ON account.user_id = session.user_id
    WHERE session.token_hash = ? AND session.expires_at > ?
    AND session.revoked_at IS NULL AND account.status = 'active'`).get(digest, now);
  return row ? {userId: row.user_id} : null;
}

export function readTeamContext(db, identity, teamId) {
  // The standalone M1 schema has no technical identity tables; normal runtime
  // always initializes the full additive schema before serving any request.
  const eligibility=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='team_operators'").get()?administratorBusinessEligibilitySql('membership'):'1';
  const row = db.prepare(`SELECT membership.role FROM team_memberships AS membership
    JOIN teams AS team ON team.team_id = membership.team_id
    WHERE membership.team_id = ? AND membership.user_id = ?
    AND membership.status = 'active' AND team.status = 'active' AND ${eligibility}`).get(teamId, identity.userId);
  return row && isCollectionRole(row.role) ? {userId: identity.userId, teamId, role: row.role} : null;
}

// No unscoped SELECT * or full-project read/then-filter is allowed here.
const FROM_TASKS = `FROM team_collection_tasks AS task
  JOIN team_projects AS project ON project.team_id = task.team_id
  AND project.project_id = task.project_id AND project.status IN ('active', 'frozen')`;
const TASK_FIELDS = 'task.task_id, task.title, task.instructions, task.status';

function searchCondition(q) {
  if (!q) return {sql: '', parameters: []};
  // LIKE metacharacters are literals, not an implicit wildcard query language.
  const escaped = q.replace(/[\\%_]/g, value => `\\${value}`);
  return {sql: " AND (task.title LIKE ? ESCAPE '\\' OR task.instructions LIKE ? ESCAPE '\\')", parameters: [`%${escaped}%`, `%${escaped}%`]};
}

export function listCollectionTasks(db, context, {q = '', after = '', limit = 100} = {}) {
  const scope = collectionTaskScope(context), search = searchCondition(q);
  const rows = db.prepare(`SELECT ${TASK_FIELDS} ${FROM_TASKS}
    WHERE ${scope.sql}${search.sql} AND task.task_id > ?
    ORDER BY task.task_id COLLATE BINARY LIMIT ?`)
    .all(...scope.parameters, ...search.parameters, after, limit + 1);
  return {tasks: rows.slice(0, limit).map(collectionTaskView), hasMore: rows.length > limit};
}

export function getCollectionTask(db, context, taskId) {
  const scope = collectionTaskScope(context);
  const row = db.prepare(`SELECT ${TASK_FIELDS} ${FROM_TASKS}
    WHERE ${scope.sql} AND task.task_id = ?`).get(...scope.parameters, taskId);
  return row ? collectionTaskView(row) : null;
}

export function getCollectionSummary(db, context) {
  const scope = collectionTaskScope(context);
  return {taskCount: db.prepare(`SELECT COUNT(*) AS count ${FROM_TASKS}
    WHERE ${scope.sql}`).get(...scope.parameters).count};
}

function readCollectionAttachment(db, context, taskId, attachmentId, fields) {
  const scope = collectionTaskScope(context);
  return db.prepare(`SELECT ${fields} ${FROM_TASKS}
    JOIN team_collection_attachments AS attachment ON attachment.team_id = task.team_id
    AND attachment.task_id = task.task_id
    WHERE ${scope.sql} AND task.task_id = ? AND attachment.attachment_id = ?
    AND EXISTS (SELECT 1 FROM team_attachment_grants AS attachment_grant
      WHERE attachment_grant.team_id = attachment.team_id
      AND attachment_grant.attachment_id = attachment.attachment_id
      AND attachment_grant.user_id = ? AND attachment_grant.status = 'active')`)
    .get(...scope.parameters, taskId, attachmentId, context.userId) || null;
}

export function getCollectionAttachment(db, context, taskId, attachmentId) {
  return readCollectionAttachment(db, context, taskId, attachmentId, 'attachment.display_name, attachment.bytes');
}

// HEAD authorizes the same attachment without materializing its blob in JS.
export function getCollectionAttachmentMetadata(db, context, taskId, attachmentId) {
  return readCollectionAttachment(db, context, taskId, attachmentId, 'attachment.display_name');
}
