import {createHash} from 'node:crypto';
import {canOperateTeam,restrictedBusinessIdentity} from './administration-policy.mjs';
import {ID,deny,invalid} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function memberIdentityRevision(db,userId){
  const value=Number(db.prepare('SELECT CAST(version AS TEXT) AS version FROM team_recovery_identity_epochs WHERE user_id=?').get(userId)?.version??0);
  if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid trusted identity revision');
  return value;
}
export function memberAccessOwner(db,userId){
  if(restrictedBusinessIdentity(db,userId))return null;
  const grant=db.prepare(`SELECT owner.permission,owner.status,owner.revision FROM team_access_reviewers AS owner
    JOIN team_users AS account ON account.user_id=owner.user_id WHERE owner.user_id=?
    AND owner.permission='member.disable' AND owner.status='active' AND account.status='active'`).get(userId);
  return grant&&Number.isSafeInteger(grant.revision)&&grant.revision>=1?grant:null;
}
export function memberAccessAuthority(db,userId,kind,teamId){
  const credential=db.prepare(`SELECT credential.password_hash,credential.revision FROM team_credentials AS credential
    JOIN team_users AS account ON account.user_id=credential.user_id WHERE credential.user_id=? AND account.status='active'`).get(userId);
  if(!credential||!Number.isSafeInteger(credential.revision)||credential.revision<1)return null;
  let grant;
  if(kind==='business'){
    if(!canOperateTeam(db,userId,teamId))return null;
    grant=db.prepare('SELECT team_id,role,status FROM team_operators WHERE team_id=? AND user_id=?').get(teamId,userId);
  }else{grant=memberAccessOwner(db,userId);if(!grant)return null;}
  return {credential,stamp:digest(JSON.stringify({userId,kind,teamId,grant,epoch:memberIdentityRevision(db,userId),credentialRevision:credential.revision,credentialHash:digest(credential.password_hash)}))};
}
export function memberAccessOverview(db,userId){
  const rows=restrictedBusinessIdentity(db,userId)?[]:db.prepare(`SELECT operator.team_id,profile.name FROM team_operators AS operator
    JOIN teams AS team ON team.team_id=operator.team_id LEFT JOIN team_profiles AS profile ON profile.team_id=team.team_id
    JOIN team_users AS account ON account.user_id=operator.user_id
    WHERE operator.user_id=? AND operator.role='administrator' AND operator.status='active' AND team.status='active' AND account.status='active'
    ORDER BY operator.team_id COLLATE BINARY LIMIT 50`).all(userId);
  return {teams:rows.map(row=>({teamId:row.team_id,teamName:safeMemberText(row.name,row.team_id)})),canReviewAdministrators:!!memberAccessOwner(db,userId)};
}
export function safeMemberText(value,fallback){return [...String(value??'').toWellFormed().replace(/[\p{Cc}\p{Cf}]/gu,'').trim()].slice(0,80).join('')||[...fallback].slice(0,80).join('');}
export function memberListQuery(params){
  for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
  const q=params.get('q')??'',after=params.get('after')??'',limit=params.get('limit');
  if(q.length>80||q!==q.toWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||(params.has('after')&&!ID.test(after))||(limit!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)))invalid();
  return {q,after,limit:limit===null?20:Number(limit)};
}
// Every historic affiliation and privileged identity counts, including revoked
// rows. This predicate is applied before projection, search, cursor and paging.
function memberScope(kind,actorId,teamId){
  const protectedIdentity=`NOT EXISTS (SELECT 1 FROM team_platform_reviewers WHERE user_id=account.user_id)
    AND NOT EXISTS (SELECT 1 FROM team_recovery_reviewers WHERE user_id=account.user_id)
    AND NOT EXISTS (SELECT 1 FROM team_access_reviewers WHERE user_id=account.user_id)
    AND NOT EXISTS (SELECT 1 FROM team_device_replacement_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_administrator_business_role_reviewers WHERE user_id=account.user_id)`;
  const common=`account.user_id<>? AND ${protectedIdentity}`;
  if(kind==='business')return {from:`FROM team_memberships AS member JOIN team_users AS account ON account.user_id=member.user_id
    JOIN team_credentials AS credential ON credential.user_id=account.user_id
    LEFT JOIN team_recovery_identity_epochs AS epoch ON epoch.user_id=account.user_id`,
    where:`${common} AND member.team_id=? AND member.role IN ('intern','assistant','manager','partner')
      AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=account.user_id)=1
      AND NOT EXISTS (SELECT 1 FROM team_operators WHERE user_id=account.user_id)`,parameters:[actorId,teamId],
    fields:'member.role,member.team_id',teamName:''};
  return {from:`FROM team_operators AS member JOIN team_users AS account ON account.user_id=member.user_id
    JOIN team_credentials AS credential ON credential.user_id=account.user_id
    JOIN teams AS team ON team.team_id=member.team_id LEFT JOIN team_profiles AS profile ON profile.team_id=team.team_id
    LEFT JOIN team_recovery_identity_epochs AS epoch ON epoch.user_id=account.user_id`,
    where:`${common} AND member.role='administrator' AND (SELECT COUNT(*) FROM team_operators WHERE user_id=account.user_id)=1
      AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=account.user_id)<=1
      AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE user_id=account.user_id AND team_id<>member.team_id)`,
    parameters:[actorId],fields:'member.role,member.team_id,profile.name AS team_name'};
}
function memberView(row,kind){
  const revision=Number(row.identity_revision);if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid trusted identity revision');
  return {id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,status:row.status,revision,
    ...(kind==='administrator'?{teamId:row.team_id,teamName:safeMemberText(row.team_name,row.team_id)}:{})};
}
const FIELDS='account.user_id,credential.display_name,account.status,CAST(COALESCE(epoch.version,0) AS TEXT) AS identity_revision';
export function memberAccessTarget(db,actorId,kind,teamId,userId){
  const scope=memberScope(kind,actorId,teamId);
  const row=db.prepare(`SELECT ${FIELDS},${scope.fields} ${scope.from} WHERE ${scope.where} AND account.user_id=?${kind==='administrator'?' AND member.team_id=?':''}`)
    .get(...scope.parameters,userId,...(kind==='administrator'?[teamId]:[]));
  return row?memberView(row,kind):null;
}
export function listMemberAccessTargets(db,actorId,kind,teamId,{q,after,limit}){
  const scope=memberScope(kind,actorId,teamId),search=q?" AND credential.display_name LIKE ? ESCAPE '\\'":'',escaped=q.replace(/[\\%_]/g,value=>'\\'+value);
  const parameters=[...scope.parameters,...(q?['%'+escaped+'%']:[])];
  if(after&&!db.prepare(`SELECT 1 ${scope.from} WHERE ${scope.where}${search} AND account.user_id=?`).get(...parameters,after))deny();
  const rows=db.prepare(`SELECT ${FIELDS},${scope.fields} ${scope.from} WHERE ${scope.where}${search}
    AND account.user_id>? ORDER BY account.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
  return {members:rows.slice(0,limit).map(row=>memberView(row,kind)),hasMore:rows.length>limit};
}
