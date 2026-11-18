import {createHash, createHmac, randomUUID} from 'node:crypto';

const endpoint='https://dysmsapi.aliyuncs.com/';
const algorithm='ACS3-HMAC-SHA256';
const purposes=['bind','reset','activate','first-admin'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const responseLimit=16*1024;
const sendDeadline=5000;
const messages={
  ALIYUN_SMS_CONFIG_INVALID:'短信服务配置无效。',
  ALIYUN_SMS_INPUT_INVALID:'短信发送请求无效。',
  ALIYUN_SMS_SEND_FAILED:'短信服务未确认受理。',
};

function fail(code){throw Object.assign(new Error(messages[code]),{code});}
const sha256=value=>createHash('sha256').update(value).digest('hex');
const payloadHash=sha256('');

function record(value,required,optional=[]){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const allowed=required.concat(optional);
  return required.every(name=>Object.hasOwn(descriptors,name))&&Reflect.ownKeys(descriptors).every(name=>
    allowed.includes(name)&&descriptors[name].enumerable&&Object.hasOwn(descriptors[name],'value'));
}

const matches=(value,pattern)=>typeof value==='string'&&pattern.test(value);

function validateConfiguration(config){
  if(!record(config,['accessKeyId','accessKeySecret','signName','templates'],['securityToken']))fail('ALIYUN_SMS_CONFIG_INVALID');
  const {accessKeyId,accessKeySecret,signName,securityToken,templates}=config;
  if(!matches(accessKeyId,/^[A-Za-z0-9_-]{1,128}$/)||!matches(accessKeySecret,/^[\x21-\x7e]{1,512}$/)||
     (securityToken!==undefined&&!matches(securityToken,/^[\x21-\x7e]{1,8192}$/))||typeof signName!=='string'||
     !signName||signName.length>128||signName!==signName.trim()||!signName.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(signName)||
     !record(templates,purposes)||!purposes.every(purpose=>matches(templates[purpose],/^SMS_[0-9]{1,32}$/)))fail('ALIYUN_SMS_CONFIG_INVALID');
  return {accessKeyId,accessKeySecret,signName,securityToken,templates:{...templates}};
}

function validateMessage(message){
  if(!record(message,['phone','code','purpose','challengeId']))fail('ALIYUN_SMS_INPUT_INVALID');
  const {phone,code,purpose,challengeId}=message;
  if(!matches(phone,/^\+861[3-9][0-9]{9}$/)||!matches(code,/^[0-9]{6}$/)||!purposes.includes(purpose)||!matches(challengeId,uuid)){
    fail('ALIYUN_SMS_INPUT_INVALID');
  }
  return {phone,code,purpose};
}

function percentEncode(value){
  return encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
}

function signedRequest(config, message, now, nonce){
  const {phone,code,purpose}=message;
  const fields={PhoneNumbers:phone.slice(3),SignName:config.signName,TemplateCode:config.templates[purpose],TemplateParam:JSON.stringify({code})};
  const query=Object.keys(fields).sort().map(name=>percentEncode(name)+'='+percentEncode(fields[name])).join('&');
  const at=now(), unique=nonce();
  if(!Number.isSafeInteger(at)||at<0||at>253402300799999||!matches(unique,/^[A-Za-z0-9-]{1,128}$/))throw new Error();
  const headers={
    host:'dysmsapi.aliyuncs.com',
    'x-acs-action':'SendSms',
    'x-acs-content-sha256':payloadHash,
    'x-acs-date':new Date(at).toISOString().replace(/\.\d{3}Z$/,'Z'),
    'x-acs-signature-nonce':unique,
    'x-acs-version':'2017-05-25',
  };
  if(config.securityToken!==undefined)headers['x-acs-security-token']=config.securityToken;
  const names=Object.keys(headers).sort();
  const canonicalHeaders=names.map(name=>`${name}:${headers[name]}\n`).join('');
  const signedHeaders=names.join(';');
  const canonicalRequest=['POST','/',query,canonicalHeaders,signedHeaders,payloadHash].join('\n');
  const signature=createHmac('sha256',config.accessKeySecret).update(`${algorithm}\n${sha256(canonicalRequest)}`).digest('hex');
  headers.authorization=`${algorithm} Credential=${config.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  headers.accept='application/json';
  return {url:endpoint+'?'+query,headers};
}

async function acceptedResponse(response,url,signal){
  const advertised=response.headers.get('content-length');
  if(signal.aborted||!response.ok||response.redirected||(response.url&&response.url!==url)||
     (advertised!==null&&(!/^\d+$/.test(advertised)||Number(advertised)>responseLimit))){
    void response.body?.cancel().catch(()=>{});
    throw new Error();
  }
  const reader=response.body?.getReader();
  if(!reader)throw new Error();
  const bytes=new Uint8Array(responseLimit);
  let length=0,complete=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};
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
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
    if(!decoded||!Object.hasOwn(decoded,'Code')||decoded.Code!=='OK')throw new Error();
  }finally{
    signal.removeEventListener('abort',abort);
    if(!complete)abort();
    reader.releaseLock();
    bytes.fill(0);
  }
}

/** Adapter for the server-only Aliyun SendSms capability. */
export function createAliyunSms(configuration,dependencies={}){
  const config=validateConfiguration(configuration);
  if(!record(dependencies,[],['transport','now','nonce']))fail('ALIYUN_SMS_CONFIG_INVALID');
  const {transport=globalThis.fetch,now=Date.now,nonce=randomUUID}=dependencies;
  if([transport,now,nonce].some(value=>typeof value!=='function'))fail('ALIYUN_SMS_CONFIG_INVALID');
  return Object.freeze({
    async send(input){
      const message=validateMessage(input);
      let timer;
      try{
        const {url,headers}=signedRequest(config,message,now,nonce);
        const controller=new AbortController();
        const deadline=new Promise((_,reject)=>{
          timer=setTimeout(()=>{controller.abort();reject(new Error());},sendDeadline);
        });
        const signal=controller.signal;
        const request=async()=>{
          const response=await transport(url,{method:'POST',headers,redirect:'error',signal});
          await acceptedResponse(response,url,signal);
        };
        await Promise.race([request(),deadline]);
      }catch{fail('ALIYUN_SMS_SEND_FAILED');}
      finally{clearTimeout(timer);}
    },
  });
}
