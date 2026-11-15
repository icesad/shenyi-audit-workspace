/** Server-only M1 policy. These are collection reads, not all business permissions.
 * Inputs are authoritative database state, never values from request JSON/headers.
 * Manager/partner project grants are explicit experimental scopes, not a default
 * product decision granting either role access to all projects or audit sign-off.
 */
export const COLLECTION_ROLES = Object.freeze(['intern', 'assistant', 'manager', 'partner']);
export function isCollectionRole(role) {
  return COLLECTION_ROLES.includes(role);
}

/** Single predicate used BEFORE projection, search, counts, paging and downloads.
 * Alias `task` is fixed by the repository. All user-controlled values are bound.
 */
export function collectionTaskScope(context) {
  if (!context || !isCollectionRole(context.role)) throw new Error('Invalid trusted collection context');
  return {
    sql: `task.team_id = ? AND (
      EXISTS (SELECT 1 FROM team_task_assignments AS assignment
        WHERE assignment.team_id = task.team_id AND assignment.task_id = task.task_id
        AND assignment.user_id = ? AND assignment.status = 'active')
      OR (? IN ('manager', 'partner') AND EXISTS (
        SELECT 1 FROM team_project_grants AS project_grant
        WHERE project_grant.team_id = task.team_id AND project_grant.project_id = task.project_id
        AND project_grant.user_id = ? AND project_grant.permission = 'collection.read'
        AND project_grant.status = 'active'))
    )`,
    parameters: [context.teamId, context.userId, context.role, context.userId],
  };
}

/** Explicit response allowlist: no project/tenant/client/financial/tree fields. */
export function collectionTaskView(row) {
  return {id: row.task_id, title: row.title, instructions: row.instructions, status: row.status};
}
