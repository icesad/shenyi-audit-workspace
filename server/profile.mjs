/* Account contact profiles only. Authentication belongs to Sites, not this module.
 * The existing device-local business databases are neither read nor migrated here. */
const MAX_BYTES=4096;
const headers={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'Vary':'Cookie',
};
const reply=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
const problem=(status,code,message)=>reply({error:{code,message}},status);
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=240&&!/[\x00-\x20\x7f]/.test(id);
export function normalizeProfilePhone(value){
  if(typeof value!=='string'||value.length>64)throw Error('PHONE');
  let phone=value.normalize('NFKC').trim().replace(/[\s()-]/g,'');
  if(!phone)return '';
  if(phone.startsWith('0086'))phone=phone.slice(4);
  else if(phone.startsWith('+86'))phone=phone.slice(3);
  if(!/^1[3-9]\d{9}$/.test(phone))throw Error('PHONE');
  return '+86'+phone;
}
function values(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype)throw Error('BODY');
  if(Object.keys(body).some(k=>!['phone','displayName','revision'].includes(k)))throw Error('FIELDS');
  const phone=normalizeProfilePhone(body.phone);
  if(typeof body.displayName!=='string'||/[\x00-\x1f\x7f]/.test(body.displayName))throw Error('NAME');
  const displayName=body.displayName.normalize('NFC').trim();
  if([...displayName].length>60)throw Error('NAME');
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('REVISION');
  return {phone,displayName,revision:body.revision};
}
async function profileContext(userId){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('shenyi.profile.v1\0'+userId))),n=>n.toString(16).padStart(2,'0')).join('');}
function envelope(row,context){
  return {status:'signed-in',account:{phone:row?.phone||'',displayName:row?.display_name||'',phoneVerified:false},revision:row?.revision||0,storage:{profile:'server',business:'device-shared'},authentication:'platform',phoneLoginEnabled:false,profileContext:context};
}
export async function handleAccountRequest(request,user,db){
  // `user` must come from the server-only platform helper, never request JSON.
  if(!validId(user?.userId))return problem(401,'SIGN_IN_REQUIRED','请先通过平台登录，再查看或修改账号资料。');
  if(!['GET','PUT'].includes(request.method))return reply({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET, PUT'});
  const url=new URL(request.url);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return problem(403,'SAME_ORIGIN_REQUIRED','请在审迹页面内操作。');
  const context=await profileContext(user.userId);
  let body;
  if(request.method==='PUT'){
    if(request.headers.get('Origin')!==url.origin)return problem(403,'SAME_ORIGIN_REQUIRED','请在审迹页面内保存资料。');
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return problem(415,'JSON_REQUIRED','请使用JSON资料格式。');
    const declared=request.headers.get('Content-Length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))return problem(413,'PROFILE_TOO_LARGE','资料超过大小限制。');
    try{
      // Stream into a bounded buffer. A missing Content-Length never removes the limit.
      const reader=request.body?.getReader();if(!reader)return problem(400,'INVALID_PROFILE','资料内容为空。');
      const chunks=[];let length=0;
      for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_BYTES){await reader.cancel();return problem(413,'PROFILE_TOO_LARGE','资料超过大小限制。');}chunks.push(part.value);}
      const bytes=new Uint8Array(length);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
      body=values(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    }catch(e){
      const codes={PHONE:['INVALID_PHONE','请填写有效的中国大陆11位手机号，可带+86；手机号尚未经过短信验证。'],NAME:['INVALID_NAME','昵称最多60字，不能包含控制字符。'],REVISION:['INVALID_REVISION','资料版本无效，请刷新后重试。'],FIELDS:['UNEXPECTED_FIELDS','资料包含不支持的字段。']};
      const [code,message]=codes[e?.message]||['INVALID_PROFILE','资料格式无效，请重新填写。'];return problem(400,code,message);
    }
  }
  if(request.method==='PUT'&&request.headers.get('X-Shenyi-Profile-Context')!==context)return problem(409,'PROFILE_CONTEXT_CHANGED','平台账号已切换或账号上下文未载入。请重新读取账号资料并核对，未写入其他账号。');
  if(!db?.prepare)return problem(503,'ACCOUNT_UNAVAILABLE','账号资料服务暂不可用；原本机业务数据未改变。');
  try{
    if(request.method==='GET'){
      const row=await db.prepare('SELECT phone, display_name, revision FROM account_profiles WHERE user_id = ?').bind(user.userId).first();
      return reply(envelope(row,context));
    }
    const {phone,displayName,revision}=body,now=new Date().toISOString();
    const row=revision===0?
      await db.prepare('INSERT INTO account_profiles (user_id, phone, display_name, revision, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING RETURNING phone, display_name, revision').bind(user.userId,phone,displayName,now).first():
      await db.prepare('UPDATE account_profiles SET phone = ?, display_name = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ? RETURNING phone, display_name, revision').bind(phone,displayName,now,user.userId,revision).first();
    if(!row)return problem(409,'PROFILE_CONFLICT','账号资料已在其他页面更新。请刷新后核对，未覆盖其他页面的修改。');
    return reply(envelope(row,context));
  }catch{
    // Do not expose SQL, user identifiers, phone values, or provider details.
    return problem(503,'ACCOUNT_UNAVAILABLE','账号资料暂时无法保存或读取，请稍后重试；原业务数据未改变。');
  }
}
