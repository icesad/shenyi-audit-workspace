// Low-level, history-preserving identity exclusion. No auth/policy imports.
export const REVIEWER_TABLES=Object.freeze(['team_platform_reviewers','team_recovery_reviewers','team_access_reviewers','team_device_replacement_reviewers','team_administrator_business_role_reviewers','team_project_migration_reviewers']);
export function noReviewerHistorySql(userExpression){
 if(!/^(?:account|member|membership|operator|ab_approval)\.user_id$/.test(userExpression))throw Error('Untrusted reviewer SQL expression');
 return REVIEWER_TABLES.map(table=>`NOT EXISTS (SELECT 1 FROM ${table} WHERE user_id=${userExpression})`).join(' AND ');
}
export function hasProtectedReviewerHistory(db,userId){
 return !!db.prepare(REVIEWER_TABLES.map(table=>`SELECT 1 FROM ${table} WHERE user_id=?`).join(' UNION ALL ')+' LIMIT 1').get(...REVIEWER_TABLES.map(()=>userId));
}
