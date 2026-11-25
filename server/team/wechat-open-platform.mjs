import {isIP} from 'node:net';

const authorizationEndpoint='https://open.weixin.qq.com/connect/qrconnect';
const exchangeEndpoint='https://api.weixin.qq.com/sns/oauth2/access_token';
const callbackPath='/api/auth/wechat/callback';
const loginScope='snsapi_login';
const responseLimit=16*1024;
const exchangeDeadline=5000;
const messages={
  WECHAT_OPEN_PLATFORM_CONFIG_INVALID:'微信开放平台服务配置无效。',
  WECHAT_OPEN_PLATFORM_INPUT_INVALID:'微信授权请求无效。',
  WECHAT_OPEN_PLATFORM_EXCHANGE_FAILED:'未能验证微信授权。',
};

function fail(code){throw Object.assign(new Error(messages[code]),{code});}

function exactRecord(value,fields,optional=[]){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const allowed=fields.concat(optional);
  return fields.every(name=>Object.hasOwn(descriptors,name))&&Reflect.ownKeys(descriptors).every(name=>
    allowed.includes(name)&&descriptors[name].enumerable&&Object.hasOwn(descriptors[name],'value'));
}

const matches=(value,pattern)=>typeof value==='string'&&pattern.test(value);
const stateValue=value=>matches(value,/^[A-Za-z0-9_-]{43}$/)&&Buffer.from(value,'base64url').toString('base64url')===value;

function validRedirect(value){
  if(typeof value!=='string'||value.length>512)return false;
  try{
    const target=new URL(value);
    const {hostname}=target;
    return value===target.origin+callbackPath&&target.protocol==='https:'&&!target.port&&!isIP(hostname)&&hostname.length<=253&&
      hostname.includes('.')&&hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }catch{return false;}
}

function verifiedIdentity(bytes,appId){
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!value||Object.hasOwn(value,'errcode')||!['openid','access_token','scope'].every(name=>Object.hasOwn(value,name))||
     !matches(value.openid,/^[A-Za-z0-9_-]{1,128}$/)||!matches(value.access_token,/^[\x21-\x7e]{1,4096}$/)||
     typeof value.scope!=='string'||value.scope.length>128||/[\x00-\x1f\x7f]/.test(value.scope))throw new Error();
  const scopes=value.scope.split(',').map(scope=>scope.trim());
  if(!scopes.includes(loginScope)||!scopes.every(scope=>[loginScope,'snsapi_base'].includes(scope))||
     new Set(scopes).size!==scopes.length)throw new Error();
  return Object.freeze({appId,openId:value.openid});
}

async function readIdentity(response,expectedUrl,signal,appId){
  const advertised=response.headers.get('content-length');
  if(signal.aborted||!response.ok||response.redirected||(response.url&&response.url!==expectedUrl)||
     (advertised!==null&&(!/^\d+$/.test(advertised)||Number(advertised)>responseLimit))){
    void response.body?.cancel().catch(()=>{});
    throw new Error();
  }
  const reader=response.body?.getReader();
  if(!reader)throw new Error();
  const bytes=new Uint8Array(responseLimit);
  const abort=()=>{void reader.cancel().catch(()=>{});};
  let length=0,complete=false;
  signal.addEventListener('abort',abort,{once:true});
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(signal.aborted)throw new Error();
      if(done)break;
      if(value.byteLength+length>responseLimit)throw new Error();
      bytes.set(value,length);
      length+=value.byteLength;
    }
    complete=true;
    return verifiedIdentity(bytes.subarray(0,length),appId);
  }finally{
    signal.removeEventListener('abort',abort);
    if(!complete)abort();
    reader.releaseLock();
    bytes.fill(0);
  }
}

/** Website authorization adapter for WeChat Open Platform, used only by the server. */
export function createWechatOpenPlatform(configuration,dependencies={}){
  if(!exactRecord(configuration,['appId','appSecret','redirectUri'])||!exactRecord(dependencies,[],['transport'])){
    fail('WECHAT_OPEN_PLATFORM_CONFIG_INVALID');
  }
  const {appId,appSecret,redirectUri}=configuration;
  const {transport=globalThis.fetch}=dependencies;
  if(!matches(appId,/^wx[A-Za-z0-9]{1,126}$/)||!matches(appSecret,/^[\x21-\x7e]{1,512}$/)||
     !validRedirect(redirectUri)||typeof transport!=='function')fail('WECHAT_OPEN_PLATFORM_CONFIG_INVALID');
  return Object.freeze({
    appId,redirectUri,
    createAuthorizationUrl(input){
      if(!exactRecord(input,['state','redirectUri'])||input.redirectUri!==redirectUri||!stateValue(input.state)){
        fail('WECHAT_OPEN_PLATFORM_INPUT_INVALID');
      }
      const params=new URLSearchParams({appid:appId,redirect_uri:redirectUri,response_type:'code',scope:loginScope,state:input.state});
      return `${authorizationEndpoint}?${params}#wechat_redirect`;
    },
    async exchangeCode(input){
      if(!exactRecord(input,['code','redirectUri'])||input.redirectUri!==redirectUri||!matches(input.code,/^[\x21-\x7e]{1,512}$/)){
        fail('WECHAT_OPEN_PLATFORM_INPUT_INVALID');
      }
      const params=new URLSearchParams({appid:appId,secret:appSecret,code:input.code,grant_type:'authorization_code'});
      const url=`${exchangeEndpoint}?${params}`;
      let timer;
      try{
        const controller=new AbortController();
        const deadline=new Promise((_,reject)=>{
          timer=setTimeout(()=>{controller.abort();reject(new Error());},exchangeDeadline);
        });
        const signal=controller.signal;
        const request=async()=>{
          const response=await transport(url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
            referrerPolicy:'no-referrer',headers:{accept:'application/json'},signal});
          return readIdentity(response,url,signal,appId);
        };
        return await Promise.race([request(),deadline]);
      }catch{fail('WECHAT_OPEN_PLATFORM_EXCHANGE_FAILED');}
      finally{clearTimeout(timer);}
    },
  });
}
