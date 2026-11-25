/** Personal account security, not device binding or team administration. */
import {createHash} from 'node:crypto';
import {authenticated,consume,ensureSessionMetadata,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {ApiError,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const MANAGEMENT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const scope=`FROM team_sessions AS session
  JOIN team_session_metadata AS metadata ON metadata.token_hash=session.token_hash
  JOIN team_users AS account ON account.user_id=session.user_id
  WHERE session.user_id=? AND session.revoked_at IS NULL AND session.expires_at>?
    AND account.status='active'`;
function ownedSession(db,userId,id,at){
  if(!MANAGEMENT_ID.test(id))deny();
  const row=db.prepare('SELECT metadata.session_id,session.token_hash,session.expires_at '+scope+' AND metadata.session_id=?').get(userId,at,id);
  if(!row)deny();return row;
}
function methodError(expected){return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:expected});}
function pagination(url){
  if([...url.searchParams.keys()].some(key=>!['limit','after'].includes(key)||url.searchParams.getAll(key).length!==1))invalid();
  const limit=url.searchParams.get('limit')??'20',after=url.searchParams.get('after');
  if(!/^[1-9]\d{0,1}$/.test(limit)||Number(limit)>50)invalid();
  if(after!==null&&!MANAGEMENT_ID.test(after))deny();
  return {limit:Number(limit),after};
}
export async function handleAccountSessionsRequest(request,{db,now=Date.now}={}){
  const url=new URL(request.url),path=url.pathname;
  const root=path==='/api/auth/sessions',others=path==='/api/auth/sessions/revoke-others',all=path==='/api/auth/sessions/revoke-all';
  const single=/^\/api\/auth\/sessions\/([^/]+)\/revoke$/.exec(path);
  if(!root&&!others&&!all&&!single)return null;
  const identity=authenticated(db,request,now());
  if(root){
    if(request.method!=='GET')return methodError('GET');
    const {limit,after}=pagination(url);
    return transaction(db,()=>{
      const at=now(),actor=authenticated(db,request,at);ensureSessionMetadata(db,actor.userId);
      const anchor=after?ownedSession(db,actor.userId,after,at):null;
      const rows=db.prepare(`SELECT metadata.session_id,metadata.created_at,session.token_hash,session.expires_at ${scope}
        ${anchor?'AND (session.expires_at<? OR (session.expires_at=? AND metadata.session_id<?))':''}
        ORDER BY session.expires_at DESC,metadata.session_id DESC LIMIT ?`)
        .all(actor.userId,at,...(anchor?[anchor.expires_at,anchor.expires_at,anchor.session_id]:[]),limit+1);
      const tokenHash=digest(actor.token);
      return json({sessions:rows.slice(0,limit).map(row=>({id:row.session_id,isCurrent:row.token_hash===tokenHash,createdAt:row.created_at,expiresAt:row.expires_at})),hasMore:rows.length>limit});
    });
  }
  if(url.search)invalid();
  if(request.method!=='POST')return methodError('POST');
  const body=await readJson(request,['currentPassword']);
  if(typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
  // Streamed bodies can finish after the initiating session was revoked.
  const actor=authenticated(db,request,now());
  if(actor.userId!==identity.userId)deny();
  consume(db,'session-revoke:'+digest(actor.userId),now(),15*60000,10);
  const target=single?ownedSession(db,actor.userId,single[1],now()):null;
  const credential=db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(actor.userId);
  if(!credential)throw new ApiError(409,'CREDENTIAL_CHANGED','账号状态已改变，请重新登录。');
  return limitedPasswordWork(db,async()=>{
    if(!await verifyPassword(body.currentPassword,credential.password_hash))throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
    return transaction(db,()=>{
      const at=now(),freshActor=authenticated(db,request,at);
      if(freshActor.userId!==actor.userId)deny();
      const fresh=db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(actor.userId);
      if(fresh?.password_hash!==credential.password_hash||fresh?.revision!==credential.revision)throw new ApiError(409,'CREDENTIAL_CHANGED','账号状态已改变，请重新登录。');
      const actorHash=digest(actor.token);
      if(target){
        const currentTarget=ownedSession(db,actor.userId,target.session_id,at);
        if(currentTarget.token_hash!==target.token_hash)deny();
        const result=db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND expires_at>?').run(at,target.token_hash,actor.userId,at);
        if(result.changes!==1)deny();
        return json({revoked:true,signedOut:target.token_hash===actorHash});
      }
      const result=db.prepare(`UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND expires_at>?
        ${others?'AND token_hash<>?':''}`).run(at,actor.userId,at,...(others?[actorHash]:[]));
      return json({revokedCount:result.changes,signedOut:all});
    });
  });
}
