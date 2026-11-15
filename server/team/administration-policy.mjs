/** Trusted technical permissions are independent from all audit data grants. */
export function hasAffiliation(db,userId){
  return !!db.prepare('SELECT 1 FROM team_memberships WHERE user_id=? UNION ALL SELECT 1 FROM team_operators WHERE user_id=? LIMIT 1').get(userId,userId);
}
export function restrictedBusinessIdentity(db,userId){
  // A mistaken technical grant cannot turn a junior/disabled employee into an
  // administrator. Cross-team affiliation policy remains deliberately narrow.
  return !!db.prepare("SELECT 1 FROM team_memberships WHERE user_id=? AND (status<>'active' OR role IN ('intern','assistant')) LIMIT 1").get(userId);
}
export function platformReviewer(db,userId){
  if(restrictedBusinessIdentity(db,userId))return null;
  return db.prepare(`SELECT grant.revision,credential.revision AS credential_revision,credential.password_hash
    FROM team_platform_reviewers AS grant JOIN team_users AS account ON account.user_id=grant.user_id
    JOIN team_credentials AS credential ON credential.user_id=grant.user_id
    WHERE grant.user_id=? AND grant.permission='team.provision' AND grant.status='active' AND account.status='active'`).get(userId)||null;
}
export function canOperateTeam(db,userId,teamId){
  if(restrictedBusinessIdentity(db,userId))return false;
  return !!db.prepare(`SELECT 1 FROM team_operators AS operator JOIN teams AS team ON team.team_id=operator.team_id
    JOIN team_users AS account ON account.user_id=operator.user_id
    WHERE operator.team_id=? AND operator.user_id=? AND operator.role='administrator' AND operator.status='active'
      AND team.status='active' AND account.status='active'`).get(teamId,userId);
}
