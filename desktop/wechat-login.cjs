'use strict';
// Main-process-only browser transaction. Public results contain no provider URL,
// bearer token, poll secret, transaction ID or initiating verifier.
const {randomBytes,createHash}=require('node:crypto');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
function validWechatPolicy(policy){
  if(!policy||typeof policy.appId!=='string'||!/^wx[a-zA-Z0-9]{16}$/.test(policy.appId)||typeof policy.redirectUri!=='string')return false;
  try{const u=new URL(policy.redirectUri);return u.href===policy.redirectUri&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/api/auth/wechat/callback';}catch{return false;}
}
function validWechatAuthorization(value,policy){
  if(!validWechatPolicy(policy)||typeof value!=='string'||value.length>2081||/[\x00-\x20\x7f]/.test(value))return false;
  try{
    const u=new URL(value),expected={appid:policy.appId,redirect_uri:policy.redirectUri,response_type:'code',scope:'snsapi_login'};
    return u.href===value&&u.origin==='https://open.weixin.qq.com'&&!u.username&&!u.password&&!u.port&&u.pathname==='/connect/qrconnect'
      &&Object.entries(expected).every(([key,content])=>u.searchParams.getAll(key).length===1&&u.searchParams.get(key)===content)
      &&u.searchParams.getAll('state').length===1&&opaque(u.searchParams.get('state'))
      &&[...u.searchParams.keys()].every(key=>Object.hasOwn(expected,key)||key==='state')&&['','#wechat_redirect'].includes(u.hash);
  }catch{return false;}
}
function createWechatLogin({policy,openAuthorization,request,cancelRemote,revokeTemporary,adoptSession,getGeneration,isSignedIn,error,now=Date.now}){
  policy=validWechatPolicy(policy)?Object.freeze({appId:policy.appId,redirectUri:policy.redirectUri}):null;
  const configured=!!policy&&typeof openAuthorization==='function';
  let active=null,epoch=0,busy=false;
  const route=row=>'/api/auth/wechat/transactions/'+row.id;
  const cancel=row=>row?cancelRemote(route(row)+'/cancel',{pollToken:row.pollToken}).catch(()=>{}):Promise.resolve();
  function reset(){const row=active;active=null;epoch++;void cancel(row);}
  function changed(at,generation){if(at!==epoch||generation!==getGeneration())throw error('SESSION_CHANGED','账号或扫码状态已改变，请重新操作。');}
  async function locked(action){if(busy)throw error('WECHAT_BUSY','扫码操作正在进行，请稍候。');busy=true;try{return await action();}finally{busy=false;}}
  const pending=row=>({status:row.status,expiresAt:row.expiresAt});
  function requireActive(){if(!active)return null;if(active.expiresAt<=now()){reset();return {status:'expired'};}return active;}
  function finish(data,at,generation){changed(at,generation);active=null;epoch++;return {status:'signed_in',session:adoptSession(data)};}
  async function receiveExchange(row){return request(route(row)+'/exchange',{method:'POST',authenticated:false,discardSessionOnChange:true,body:{pollToken:row.pollToken,codeVerifier:row.verifier}});}
  async function adoptExchange(data,at,generation){
    try{return finish(data,at,generation);}catch(e){if(opaque(data?.token))await revokeTemporary(data.token).catch(()=>{});throw e;}
  }
  return Object.freeze({
    configured,reset,
    async start(){return locked(async()=>{
      if(!configured)throw error('WECHAT_UNAVAILABLE','微信桌面授权尚未配置，当前不能扫码。');
      if(isSignedIn())throw error('WECHAT_SESSION_ACTIVE','请先退出当前账号再使用微信登录。');
      reset();const at=epoch,generation=getGeneration(),verifier=randomBytes(32).toString('base64url');let row;
      try{
        const value=await request('/api/auth/wechat/transactions',{method:'POST',authenticated:false,body:{codeChallenge:createHash('sha256').update(verifier).digest('base64url')}});
        if(typeof value?.transactionId==='string'&&ID.test(value.transactionId)&&opaque(value.pollToken))row={id:value.transactionId,pollToken:value.pollToken,verifier,expiresAt:value.expiresAt,status:'pending'};
        changed(at,generation);
        if(!row||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=now()||row.expiresAt>now()+10*60000||!validWechatAuthorization(value.authorizationUrl,policy))throw error('INVALID_RESPONSE','微信授权信息无效，未打开浏览器。');
        active=row;changed(at,generation);
        try{await openAuthorization(new URL(value.authorizationUrl).href);}catch{throw error('BROWSER_UNAVAILABLE','未能打开系统浏览器，请重新开始扫码。');}
        changed(at,generation);return pending(row);
      }catch(e){if(active===row)active=null;await cancel(row);throw e;}
    });},
    async poll(){return locked(async()=>{
      const row=requireActive();if(!row)return {status:'idle'};if(!row.id)return row;
      const at=epoch,generation=getGeneration();
      const value=await request(route(row)+'/status',{method:'POST',authenticated:false,body:{pollToken:row.pollToken}});
      changed(at,generation);
      if(!value||!['pending','binding_required','ready','expired','canceled','failed','consumed'].includes(value.status)||value.expiresAt!==row.expiresAt)throw error('INVALID_RESPONSE','扫码状态格式无效，请取消后重试。');
      if(row.expiresAt<=now()){reset();return {status:'expired'};}
      if(value.status==='ready')return adoptExchange(await receiveExchange(row),at,generation);
      if(['expired','canceled','failed','consumed'].includes(value.status)){active=null;epoch++;return {status:value.status==='consumed'?'failed':value.status};}
      row.status=value.status;return pending(row);
    });},
    async cancel(){const row=active;active=null;epoch++;await cancel(row);return {canceled:true};},
    async link(input){return locked(async()=>{
      const row=requireActive();if(!row?.id||row.status!=='binding_required')throw error('WECHAT_NOT_LINKABLE','请先扫码并确认当前账号需要关联。');
      const at=epoch,generation=getGeneration();let temporary,finalSession;
      try{
        const value=await request('/api/auth/phone/login',{method:'POST',authenticated:false,discardSessionOnChange:true,body:input});
        if(!opaque(value?.token))throw error('INVALID_RESPONSE','账号服务返回格式无效。');
        temporary=value.token;changed(at,generation);
        await request(route(row)+'/link',{method:'POST',temporaryBearer:temporary,body:{pollToken:row.pollToken,codeVerifier:row.verifier,currentPassword:input.password}});
        changed(at,generation);finalSession=await receiveExchange(row);
      }finally{if(temporary)await revokeTemporary(temporary).catch(()=>{});}
      // Do not install the final session while temporary-session cleanup is
      // pending: cancel must still win throughout that asynchronous interval.
      return adoptExchange(finalSession,at,generation);
    });},
  });
}
module.exports={createWechatLogin,validWechatPolicy,validWechatAuthorization};
