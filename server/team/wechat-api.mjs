/** Supplier-independent transaction core. No real WeChat credentials or network
 * calls are bundled. The trusted server adapter is deliberately absent by default.
 * S256 here protects Shenyi's desktop exchange, not a claim of WeChat PKCE support.
 */
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {authenticated,consume,limitedPasswordWork,issueSession} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {currentDeviceLease,deviceServerId,deviceRequired} from './device-policy.mjs';
import {ApiError,ID,json,readJson,deny,invalid,transaction,PRIVATE_HEADERS} from './http-utils.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
const unavailable=()=>{throw new ApiError(503,'WECHAT_UNAVAILABLE','微信扫码登录尚未开通。');};
const conflict=()=>{throw new ApiError(409,'IDENTITY_CONFLICT','账号关联状态已改变，请重新核对。');};
const goodId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\x00-\x20\x7f]/.test(value);
const callbackMessage=()=>new Response('授权结果已接收，请返回审易客户端。',{headers:{...PRIVATE_HEADERS,'Content-Type':'text/plain; charset=utf-8','Content-Security-Policy':"default-src 'none'"}});

export function isWechatConfigured(identityProviders={}) {
  const provider=identityProviders.wechat;
  if(!provider||!goodId(provider.appId)||typeof provider.createAuthorizationUrl!=='function'||typeof provider.exchangeCode!=='function')return false;
  try{const uri=new URL(provider.redirectUri);return uri.protocol==='https:'&&!uri.username&&!uri.password&&!uri.search&&!uri.hash&&uri.pathname==='/api/auth/wechat/callback';}catch{return false;}
}
function providerFor(identityProviders){if(!isWechatConfigured(identityProviders))unavailable();return identityProviders.wechat;}
function validAuthorizationUrl(value,provider,state){
  if(typeof value!=='string'||value.length>4096)return false;
  try{
    const url=new URL(value),expected={appid:provider.appId,redirect_uri:provider.redirectUri,response_type:'code',scope:'snsapi_login',state};
    return url.origin==='https://open.weixin.qq.com'&&url.pathname==='/connect/qrconnect'&&!url.username&&!url.password
      &&Object.entries(expected).every(([key,content])=>url.searchParams.getAll(key).length===1&&url.searchParams.get(key)===content)
      &&[...url.searchParams.keys()].every(key=>Object.hasOwn(expected,key))&&['','#wechat_redirect'].includes(url.hash);
  }catch{return false;}
}
function proof(row,body){
  if(!opaque(body.pollToken)||hash(body.pollToken)!==row.poll_hash)return false;
  if(typeof body.codeVerifier!=='string'||!/^[-._~A-Za-z0-9]{43,128}$/.test(body.codeVerifier))return false;
  const challenge=createHash('sha256').update(body.codeVerifier).digest('base64url');
  return timingSafeEqual(Buffer.from(challenge),Buffer.from(row.code_challenge));
}
function readTransaction(db,id,body,now,allowExpired=false){
  const row=db.prepare('SELECT * FROM team_wechat_transactions WHERE transaction_id=?').get(id);
  if(!row||!opaque(body.pollToken)||hash(body.pollToken)!==row.poll_hash)deny();
  if(!allowExpired&&row.expires_at<=now)throw new ApiError(410,'TRANSACTION_EXPIRED','扫码事务已过期，请重新开始。');
  return row;
}
function currentLinkedUser(db,row){
  return db.prepare(`SELECT credential.revision,account.status,identity.user_id FROM team_wechat_identities AS identity
    JOIN team_users AS account ON account.user_id=identity.user_id
    JOIN team_credentials AS credential ON credential.user_id=identity.user_id
    WHERE identity.app_id=? AND identity.open_id=?`).get(row.app_id,row.open_id);
}

function assertLinkDevice(db,request,actor,at,deviceContext){
  if(!deviceContext||deviceContext.userId!==actor.userId)deviceRequired();
  const lease=currentDeviceLease(db,request,at);
  if(lease.userId!==actor.userId||lease.stamp!==deviceContext.stamp||lease.leaseId!==deviceContext.leaseId||
    lease.deviceId!==deviceContext.deviceId||lease.bindingRevision!==deviceContext.bindingRevision||
    deviceServerId(db)!==deviceContext.serverId)deviceRequired();
}

export async function handleWechatRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/auth/wechat/'))return null;
  const provider=providerFor(identityProviders);
  if(path==='/api/auth/wechat/callback'){
    if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
    const redirect=new URL(provider.redirectUri);
    if(url.origin!==redirect.origin||url.pathname!==redirect.pathname)deny();
    const keys=[...url.searchParams.keys()];
    if(keys.some(key=>!['state','code','error'].includes(key)||url.searchParams.getAll(key).length!==1))invalid();
    const state=url.searchParams.get('state'),code=url.searchParams.get('code'),error=url.searchParams.get('error');
    if(!opaque(state)||(code!==null&&error!==null))invalid();
    if(code!==null&&(!code||code.length>512||/[\x00-\x20\x7f]/.test(code)))invalid();
    const row=transaction(db,()=>{
      const candidate=db.prepare('SELECT * FROM team_wechat_transactions WHERE state_hash=?').get(hash(state));
      if(!candidate||candidate.app_id!==provider.appId||candidate.redirect_uri!==provider.redirectUri||candidate.expires_at<=now()||candidate.status!=='pending')deny();
      if(code===null){db.prepare("UPDATE team_wechat_transactions SET status='canceled' WHERE transaction_id=?").run(candidate.transaction_id);return null;}
      try{db.prepare('INSERT INTO team_wechat_codes VALUES (?,?)').run(provider.appId,hash(code));}catch{deny();}
      db.prepare("UPDATE team_wechat_transactions SET status='processing' WHERE transaction_id=?").run(candidate.transaction_id);
      return candidate;
    });
    if(!row)return callbackMessage();
    let identity;
    try{
      identity=await provider.exchangeCode({code,redirectUri:provider.redirectUri});
      if(identity?.appId!==provider.appId||!goodId(identity?.openId))throw new Error('Invalid supplier identity');
    }catch{
      db.prepare("UPDATE team_wechat_transactions SET status='failed' WHERE transaction_id=? AND status='processing'").run(row.transaction_id);
      return callbackMessage();
    }
    transaction(db,()=>{
      const fresh=db.prepare('SELECT * FROM team_wechat_transactions WHERE transaction_id=?').get(row.transaction_id);
      if(fresh.status!=='processing'||fresh.expires_at<=now())return;
      const linked=currentLinkedUser(db,{app_id:provider.appId,open_id:identity.openId});
      const state=linked?(linked.status==='active'?'ready':'failed'):'binding_required';
      db.prepare('UPDATE team_wechat_transactions SET status=?,open_id=?,user_id=?,credential_revision=? WHERE transaction_id=?')
        .run(state,identity.openId,linked?.user_id||null,linked?.revision||null,row.transaction_id);
    });
    return callbackMessage();
  }
  if(url.search)invalid();
  if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
  if(path==='/api/auth/wechat/transactions'){
    const body=await readJson(request,['codeChallenge']);if(!opaque(body.codeChallenge))invalid();
    // The trusted edge proxy overwrites this header with its observed client IP.
    // Spend only this source's budget, after validating the request.
    const suppliedAddress=request.headers.get('x-shenyi-client-ip')||'local';
    const clientAddress=isIP(suppliedAddress)?suppliedAddress.toLowerCase():'local';
    consume(db,'wechat:start:ip:'+hash(clientAddress),now(),60000,60);
    const id=randomUUID(),pollToken=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url'),expiresAt=now()+5*60000;
    let authorizationUrl;
    try{authorizationUrl=await provider.createAuthorizationUrl({state,redirectUri:provider.redirectUri});}catch{unavailable();}
    if(!validAuthorizationUrl(authorizationUrl,provider,state))unavailable();
    db.prepare(`INSERT INTO team_wechat_transactions(transaction_id,state_hash,poll_hash,code_challenge,app_id,redirect_uri,status,expires_at)
      VALUES (?,?,?,?,?,?,'pending',?)`).run(id,hash(state),hash(pollToken),body.codeChallenge,provider.appId,provider.redirectUri,expiresAt);
    return json({transactionId:id,pollToken,authorizationUrl,expiresAt},201);
  }
  const match=/^\/api\/auth\/wechat\/transactions\/([^/]+)\/(status|cancel|link|exchange)$/.exec(path);
  if(!match||!ID.test(match[1]))deny();
  const [,id,action]=match;
  const fields=action==='link'?['pollToken','codeVerifier','currentPassword']:action==='exchange'?['pollToken','codeVerifier']:['pollToken'];
  const body=await readJson(request,fields);
  const row=readTransaction(db,id,body,now(),action==='status');
  if(row.app_id!==provider.appId||row.redirect_uri!==provider.redirectUri)deny();
  consume(db,'wechat:'+id,now(),60000,60);
  if(action==='status')return json({status:row.expires_at<=now()?'expired':row.status==='processing'?'pending':row.status,expiresAt:row.expires_at});
  if(action==='cancel'){
    db.prepare("UPDATE team_wechat_transactions SET status='canceled' WHERE transaction_id=? AND status NOT IN ('consumed','failed')").run(id);
    return json({canceled:true});
  }
  if(!proof(row,body))deny();
  if(action==='exchange')return transaction(db,()=>{
    const fresh=readTransaction(db,id,body,now());
    if(fresh.status!=='ready'||!proof(fresh,body))deny();
    const user=currentLinkedUser(db,fresh);
    if(user?.status!=='active'||user.user_id!==fresh.user_id||user.revision!==fresh.credential_revision)deny();
    db.prepare("UPDATE team_wechat_transactions SET status='consumed' WHERE transaction_id=?").run(id);
    return json(issueSession(db,user.user_id,now()));
  });
  if(row.status!=='binding_required')conflict();
  const linkedAt=now(),actor=authenticated(db,request,linkedAt);
  if(identityProviders.wechatLinkRequiresDevice===true)assertLinkDevice(db,request,actor,linkedAt,deviceContext);
  const credential=db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(actor.userId);
  const phone=db.prepare('SELECT phone,revision,verified_at FROM team_phone_credentials WHERE user_id=?').get(actor.userId);
  if(!phone||phone.verified_at<=0||phone.verified_at>now()||!credential)deny();
  if(typeof body.currentPassword!=='string'||Buffer.byteLength(body.currentPassword)>512)invalid();
  consume(db,'wechat:link:'+actor.userId,now(),15*60000,10);
  return limitedPasswordWork(db,async()=>{
    if(!await verifyPassword(body.currentPassword,credential.password_hash))deny();
    return transaction(db,()=>{
      const at=now(),currentActor=authenticated(db,request,at);
      if(currentActor.userId!==actor.userId)deny();
      if(identityProviders.wechatLinkRequiresDevice===true)assertLinkDevice(db,request,actor,at,deviceContext);
      const fresh=readTransaction(db,id,body,at);
      if(fresh.status!=='binding_required'||!proof(fresh,body))conflict();
      const current=db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(actor.userId);
      const currentPhone=db.prepare('SELECT phone,revision,verified_at FROM team_phone_credentials WHERE user_id=?').get(actor.userId);
      if(current?.password_hash!==credential.password_hash||current?.revision!==credential.revision||currentPhone?.phone!==phone.phone||currentPhone?.revision!==phone.revision||currentPhone?.verified_at!==phone.verified_at)deny();
      if(db.prepare('SELECT 1 FROM team_wechat_identities WHERE app_id=? AND (open_id=? OR user_id=?)').get(fresh.app_id,fresh.open_id,actor.userId))conflict();
      db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(fresh.app_id,fresh.open_id,actor.userId,at);
      db.prepare("UPDATE team_wechat_transactions SET status='ready',user_id=?,credential_revision=? WHERE transaction_id=?").run(actor.userId,current.revision,id);
      return json({linked:true});
    });
  });
}
