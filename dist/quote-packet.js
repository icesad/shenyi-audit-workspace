/* Quote packet v1. Local browser data only; no network, authenticity certification or PDF merging. */
(function (root) {
  'use strict';
  const MAX_ATTACHMENT_BYTES=3*1024*1024,MAX_PAIR_BYTES=6*1024*1024,MAX_PACKET_BYTES=16*1024*1024;
  const KINDS=Object.freeze(['business_license','practice_certificate']);
  const LABELS=Object.freeze({business_license:'营业执照',practice_certificate:'执业证书'});
  const MIME=Object.freeze({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'});
  const PRINT_NOTICE='打印正文PDF不等于完整附件，PDF附件请随报价包提交';
  const FIELDS=Object.freeze(['firmName','customerName','auditYear','location','service','quoteDate','issuer','projectName','projectType','contactName','contactInfo','subtotalCents','taxCents','totalCents','taxRateText']);
  const ATTACHMENT_FIELDS=Object.freeze(['kind','name','mime','size','sha256','bytes']);
  const CONTROL=/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
  class QuotePacketError extends Error {constructor(message){super(message||'报价包数据无效，请重新核对。');this.name='QuotePacketError';this.code='QUOTE_PACKET_INVALID';}}
  const reject=message=>{throw new QuotePacketError(message);};
  function wellFormed(value){for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=value.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;}
  function exact(input,fields){
    if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))reject();
    const ds=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(ds);
    if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))reject();
    const out={};for(const k of fields){if(!Object.hasOwn(ds,k))reject();out[k]=ds[k].value;}return out;
  }
  function text(value,label,max,optional){if(typeof value!=='string'||!wellFormed(value)||CONTROL.test(value)||value.length>max*2||[...value].length>max)reject(label+'格式无效或过长。');value=value.trim();if(!optional&&!value)reject('请填写'+label+'。');return value;}
  function filename(value,allowed=MIME){
    if(typeof value!=='string'||!wellFormed(value)||CONTROL.test(value)||value.length>240||[...value].length<1||[...value].length>120||value!==value.trim()||/[\\/:<>"|?*]/.test(value)||/^[. ]|[. ]$/.test(value)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value))reject('附件文件名不安全或超过120字。');
    const m=/\.([A-Za-z0-9]+)$/.exec(value);if(!m||!Object.hasOwn(allowed,m[1].toLowerCase()))reject(allowed===MIME?'附件只支持PDF、PNG或JPEG。':'其他附件只支持 PDF、PNG、JPEG、DOCX、XLSX。');return {name:value,extension:m[1].toLowerCase()};
  }
  function kind(value){if(!KINDS.includes(value))reject('附件种类无效。');return value;}
  function size(value){if(!Number.isSafeInteger(value)||value<1||value>MAX_ATTACHMENT_BYTES)reject('每份附件须非空且不超过3MiB。');return value;}
  function byteCopy(value){try{if(!(value instanceof Uint8Array))reject('附件字节必须为Uint8Array。');size(value.byteLength);return new Uint8Array(value);}catch(e){if(e instanceof QuotePacketError)throw e;reject('附件字节不可读取。');}}
  function dimensions(w,h){if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>12000||h>12000||w*h>40000000)reject('图片尺寸超过12000像素或4000万像素限制。');}
  const CRC_TABLE=Object.freeze(Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;}));
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=CRC_TABLE[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function ascii(bytes,start,end){let out='';for(let i=start;i<end;i++)out+=String.fromCharCode(bytes[i]);return out;}
  function png(bytes){
    const sig=[137,80,78,71,13,10,26,10];if(bytes.length<57||!sig.every((b,i)=>bytes[i]===b))reject('PNG格式不完整。');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=8,first=true,seenData=false,ended=false;
    while(at<bytes.length){
      if(at+12>bytes.length)reject('PNG格式不完整。');const n=view.getUint32(at),type=ascii(bytes,at+4,at+8),end=at+12+n;
      if(end>bytes.length||!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(at+4,at+8+n))!==view.getUint32(at+8+n))reject('PNG格式或校验无效。');
      if(first){if(type!=='IHDR'||n!==13)reject('PNG缺少图像头。');dimensions(view.getUint32(at+8),view.getUint32(at+12));const depth=bytes[at+16],color=bytes[at+17],depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};if(!depths[color]?.includes(depth)||bytes[at+18]!==0||bytes[at+19]!==0||bytes[at+20]>1)reject('PNG图像头无效。');first=false;}
      else if(type==='IHDR')reject('PNG图像头重复。');
      if(type==='IDAT'){if(n)seenData=true;}
      if(type==='IEND'){if(n!==0||!seenData||end!==bytes.length)reject('PNG结束信息无效。');ended=true;break;}at=end;
    }
    if(!ended)reject('PNG格式不完整。');
  }
  function jpeg(bytes){
    if(bytes.length<16||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)reject('JPEG格式不完整。');
    let at=2,frame=false,scan=false;const frames=[192,193,194,195,197,198,199,201,202,203,205,206,207];
    while(at<bytes.length-2){if(bytes[at++]!==255)reject('JPEG标记无效。');while(bytes[at]===255)at++;const marker=bytes[at++];if(marker===1||marker>=208&&marker<=215)continue;if(marker===0||marker===216||marker===217||at+2>bytes.length)reject('JPEG标记无效。');const n=bytes[at]*256+bytes[at+1];if(n<2||at+n>bytes.length-2)reject('JPEG片段不完整。');
      if(frames.includes(marker)){if(n<11||![8,12].includes(bytes[at+2]))reject('JPEG图像头无效。');const components=bytes[at+7];if(components<1||components>4||n!==8+3*components)reject('JPEG图像头无效。');dimensions(bytes[at+5]*256+bytes[at+6],bytes[at+3]*256+bytes[at+4]);frame=true;}
      if(marker===218){const components=bytes[at+2];if(!frame||components<1||components>4||n!==6+2*components||at+n>=bytes.length-2)reject('JPEG扫描信息无效。');scan=true;break;}at+=n;
    }if(!frame||!scan)reject('JPEG缺少图像尺寸或扫描信息。');
  }
  function format(bytes,ext,mime){
    if(typeof mime!=='string'||mime!==MIME[ext])reject('附件MIME类型、扩展名不一致。');
    if(ext==='pdf'){if(bytes.length<14||!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\n|\r)/.test(ascii(bytes,0,Math.min(12,bytes.length)))||!/%%EOF[ \t\r\n]*$/.test(ascii(bytes,Math.max(0,bytes.length-1024),bytes.length)))reject('PDF格式特征或结束信息无效。');}
    else if(ext==='png')png(bytes);else jpeg(bytes);
  }
  // Real SHA-256 fallback supports offline/file browser use without non-browser dependencies.
  const SHA_K=Object.freeze([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256Blocks(constants){
    const state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const words=new Uint32Array(64),rotate=(x,n)=>(x>>>n)|(x<<(32-n));
    let count=0;
    function blocks(bytes){
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      for(let offset=0;offset<bytes.length;offset+=64){
        for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
        for(let i=16;i<64;i++){
          const x=words[i-15],y=words[i-2];
          words[i]=words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10));
        }
        let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
        for(let i=0;i<64;i++){
          const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])>>>0;
          const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
          h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
        }
        state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;state[4]+=e;state[5]+=f;state[6]+=g;state[7]+=h;
      }
      count+=bytes.length;
    }
    function finish(rest){
      const length=count+rest.length;
      const padded=new Uint8Array(rest.length<56?64:128);
      padded.set(rest);padded[rest.length]=128;
      const view=new DataView(padded.buffer);
      view.setUint32(padded.length-8,Math.floor(length/0x20000000));
      view.setUint32(padded.length-4,length*8);
      blocks(padded);
      return Array.from(state,x=>x.toString(16).padStart(8,'0')).join('');
    }
    return {blocks,finish};
  }
  function shaFallback(bytes){
    const state=sha256Blocks(SHA_K),whole=bytes.length-bytes.length%64;
    state.blocks(bytes.subarray(0,whole));
    return state.finish(bytes.subarray(whole));
  }
  async function hashBlobInChunks(blob,makeState,constants){
    const state=makeState(constants),step=2*1024*1024;
    let rest=new Uint8Array();
    for(let offset=0;offset<blob.size;offset+=step){
      const end=Math.min(offset+step,blob.size);
      const bytes=new Uint8Array(await blob.slice(offset,end).arrayBuffer());
      if(bytes.length!==end-offset)throw Error('文件读取不完整。');
      const whole=bytes.length-bytes.length%64;
      state.blocks(bytes.subarray(0,whole));
      rest=bytes.subarray(whole);
    }
    return state.finish(rest);
  }
  async function sha256Blob(blob){
    if(blob.size<=16*1024*1024)return sha256(new Uint8Array(await blob.arrayBuffer()));
    if(!root.Worker||!root.URL?.createObjectURL)return hashBlobInChunks(blob,sha256Blocks,SHA_K);
    const source='onmessage=async ({data})=>{try{postMessage({hash:await ('+hashBlobInChunks.toString()+')(data,('+sha256Blocks.toString()+'),'+JSON.stringify(SHA_K)+')});}catch(error){postMessage({error:error.message});}};';
    const url=root.URL.createObjectURL(new root.Blob([source],{type:'text/javascript'}));
    let worker;
    try{
      worker=new root.Worker(url);
      return await new Promise((resolve,reject)=>{
        worker.onmessage=event=>event.data.error?reject(Error(event.data.error)):resolve(event.data.hash);
        worker.onerror=event=>{event.preventDefault();reject(Error('本机文件校验组件未能运行。'));};
        worker.onmessageerror=()=>reject(Error('未能将文件交给本机校验组件。'));
        worker.postMessage(blob);
      });
    }finally{worker?.terminate();root.URL.revokeObjectURL(url);}
  }
  async function sha256(bytes){try{if(root.crypto?.subtle&&typeof root.crypto.subtle.digest==='function'){const result=await root.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(result)].map(b=>b.toString(16).padStart(2,'0')).join('');}return shaFallback(bytes);}catch{reject('无法完成附件SHA-256校验。');}}
  function captureAttachment(input){const a=exact(input,ATTACHMENT_FIELDS),file=filename(a.name);kind(a.kind);size(a.size);if(typeof a.sha256!=='string'||!/^[0-9a-f]{64}$/.test(a.sha256))reject('附件SHA-256格式无效。');const bytes=byteCopy(a.bytes);if(bytes.length!==a.size)reject('附件实际大小与登记不一致。');format(bytes,file.extension,a.mime);return {kind:a.kind,name:file.name,mime:a.mime,size:bytes.length,sha256:a.sha256,bytes};}
  async function verifyAttachment(input){const a=captureAttachment(input),actual=await sha256(a.bytes);if(actual!==a.sha256)reject('附件内容与SHA-256不一致，请重新选择。');return Object.freeze(a);}
  async function readAttachment(file,requestedKind){
    kind(requestedKind);if(!file||typeof file!=='object')reject('请选择证照附件。');let name,mime,declared,arrayBuffer;
    try{name=file.name;mime=file.type;declared=file.size;arrayBuffer=file.arrayBuffer;}catch{reject('附件不可读取。');}const f=filename(name);size(declared);if(typeof arrayBuffer!=='function')reject('附件不可读取。');if(mime!==MIME[f.extension])reject('附件MIME类型、扩展名不一致。');let buffer;
    try{buffer=await arrayBuffer.call(file);}catch{reject('附件读取失败。');}if(!(buffer instanceof ArrayBuffer))reject('附件读取结果无效。');const bytes=byteCopy(new Uint8Array(buffer));if(bytes.length!==declared)reject('附件实际大小与声明不一致。');format(bytes,f.extension,mime);const digest=await sha256(bytes);return Object.freeze({kind:requestedKind,name:f.name,mime,size:bytes.length,sha256:digest,bytes});
  }
  const EXTRA_MIME=Object.freeze({...MIME,docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const MAX_EXTRAS=10;
  // Office files are carried as opaque attachments. Check the ZIP directory without
  // extracting or rendering untrusted XML. This is a format check, not a virus scan.
  function officeDirectory(bytes,extension){
    const bad=()=>reject('Office附件须为完整、非加密、非宏的 DOCX 或 XLSX。');
    const n=bytes.length,v=new DataView(bytes.buffer,bytes.byteOffset,n),u16=i=>v.getUint16(i,true),u32=i=>v.getUint32(i,true);
    if(n<22||u32(0)!==0x04034b50)bad();
    let end=n-22;for(;end>=Math.max(0,n-65557);end--)if(u32(end)===0x06054b50&&end+22+u16(end+20)===n)break;
    if(end<Math.max(0,n-65557)||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))bad();
    const count=u16(end+10),start=u32(end+16),len=u32(end+12);if(!count||count>4096||start+len!==end)bad();
    const seen=new Set();let at=start,expanded=0;
    for(let i=0;i<count;i++){
      if(at+46>end||u32(at)!==0x02014b50||u16(at+8)&1||![0,8].includes(u16(at+10))||u16(at+34))bad();
      const nameLen=u16(at+28),next=at+46+nameLen+u16(at+30)+u16(at+32),local=u32(at+42),compressed=u32(at+20);
      if(!nameLen||next>end||local+30>start||u32(local)!==0x04034b50||u16(local+6)!==u16(at+8)||u16(local+8)!==u16(at+10)||u16(local+26)!==nameLen||local+30+nameLen+u16(local+28)+compressed>start)bad();
      const name=ascii(bytes,at+46,at+46+nameLen);if(name!==ascii(bytes,local+30,local+30+nameLen)||seen.has(name)||name.startsWith('/')||/[\\:\x00-\x1f]/.test(name)||name.split('/').includes('..')||/(?:^|\/)(?:vbaproject(?:signature)?\.bin|activex)(?:\/|$)/i.test(name))bad();
      expanded+=u32(at+24);if(expanded>64*1024*1024)bad();seen.add(name);at=next;
    }
    if(at!==end||!seen.has('[Content_Types].xml')||!seen.has(extension==='docx'?'word/document.xml':'xl/workbook.xml'))bad();
  }
  function extraFormat(bytes,f,mime){
    if(mime!==EXTRA_MIME[f.extension])reject('其他附件的扩展名与文件类型不匹配。');
    if(f.extension==='docx'||f.extension==='xlsx')officeDirectory(bytes,f.extension);else format(bytes,f.extension,mime);
  }
  async function readExtra(file){
    if(!file||typeof file.arrayBuffer!=='function')reject('请选择其他附件。');
    const f=filename(file.name,EXTRA_MIME),mime=file.type||EXTRA_MIME[f.extension],declared=size(file.size);let buffer;
    try{buffer=await file.arrayBuffer();}catch{reject('其他附件读取失败，请重试。');}
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==declared)reject('其他附件读取不完整。');
    const bytes=byteCopy(new Uint8Array(buffer));extraFormat(bytes,f,mime);
    return Object.freeze({kind:'extra',name:f.name,mime,size:declared,sha256:await sha256(bytes),bytes});
  }
  async function verifyExtra(input){
    const a=exact(input,ATTACHMENT_FIELDS),f=filename(a.name,EXTRA_MIME);
    if(a.kind!=='extra'||size(a.size)!==a.bytes?.byteLength||typeof a.sha256!=='string'||!/^[0-9a-f]{64}$/.test(a.sha256))reject('其他附件记录无效。');
    const bytes=byteCopy(a.bytes);extraFormat(bytes,f,a.mime);if(await sha256(bytes)!==a.sha256)reject('其他附件内容与摘要不一致。');
    return Object.freeze({...a,bytes});
  }
  async function verifyExtras(input){
    if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length>MAX_EXTRAS)reject('其他附件最多10份（不含两证）。');
    const ds=Object.getOwnPropertyDescriptors(input);
    if(Reflect.ownKeys(ds).length!==input.length+1)reject('其他附件列表无效。');
    const records=[];for(let i=0;i<input.length;i++){if(!ds[i]?.enumerable||!Object.hasOwn(ds[i],'value'))reject('其他附件列表无效。');records.push(ds[i].value);}
    return Object.freeze(await Promise.all(records.map(verifyExtra)));
  }
  async function verifyPair(input){
    if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length!==2)reject('报价须同时提供营业执照和执业证书。');const ds=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(ds).length!==3||![0,1].every(i=>ds[i]?.enumerable&&Object.hasOwn(ds[i],'value')))reject('附件组合无效。');
    // Both private byte snapshots are captured synchronously, before the first hash awaits.
    const pair=await Promise.all([verifyAttachment(ds[0].value),verifyAttachment(ds[1].value)]);if(pair[0].kind===pair[1].kind||!KINDS.every(k=>pair.some(a=>a.kind===k))||pair.reduce((n,a)=>n+a.size,0)>MAX_PAIR_BYTES)reject('须各提供一份证照，总大小不超过6MiB。');return Object.freeze(KINDS.map(k=>pair.find(a=>a.kind===k)));
  }
  function normalizeSnapshot(input){
    const withBidder=input&&Object.hasOwn(input,'bidderContact'),withRows=input&&Object.hasOwn(input,'quoteRows'),withRisk=input&&Object.hasOwn(input,'riskLevel');const s=exact(input,[...FIELDS,...(withBidder?['bidderContact']:[]),...(withRows?['quoteRows']:[]),...(withRisk?['riskLevel']:[])]),out={firmName:text(s.firmName,'事务所名称',200,true),customerName:text(s.customerName,'客户名称',200),auditYear:s.auditYear,location:text(s.location,'客户所在地',100),service:text(s.service,'服务类型',200),quoteDate:s.quoteDate,issuer:text(s.issuer,'发标单位',200),projectName:text(s.projectName,'项目名称',300),projectType:text(s.projectType,'项目类型',100),contactName:text(s.contactName,'联系人',100,true),contactInfo:text(s.contactInfo,'联系方式',300,true),subtotalCents:s.subtotalCents,taxCents:s.taxCents,totalCents:s.totalCents,taxRateText:text(s.taxRateText,'税率说明',80)};
    if(withRisk){
      if(!['A类','B类','C类'].includes(s.riskLevel))reject('风险等级须为 A 类、B 类或 C 类。');
      out.riskLevel=s.riskLevel;
    }
    if(withBidder){const bc=exact(s.bidderContact,['name','phone','email']);out.bidderContact=Object.freeze({name:text(bc.name,'投标方联系人',100,true),phone:text(bc.phone,'投标方电话',80,true),email:text(bc.email,'投标方邮箱',150,true)});}
    if(!Number.isInteger(out.auditYear)||out.auditYear<2000||out.auditYear>2100)reject('审计年度无效。');if(typeof out.quoteDate!=='string'||out.quoteDate.startsWith('0000')||!/^\d{4}-\d{2}-\d{2}$/.test(out.quoteDate)||!Number.isFinite(Date.parse(out.quoteDate+'T00:00:00.000Z'))||new Date(out.quoteDate+'T00:00:00.000Z').toISOString().slice(0,10)!==out.quoteDate)reject('报价日期须为有效的yyyy-mm-dd日期。');
    for(const k of ['subtotalCents','taxCents','totalCents'])if(!Number.isSafeInteger(out[k])||out[k]<0||Object.is(out[k],-0))reject('报价金额须为非负安全整数分。');if(!Number.isSafeInteger(out.subtotalCents+out.taxCents)||out.subtotalCents+out.taxCents!==out.totalCents)reject('报价金额合计不一致。');
    if(withRows){
      const rows=s.quoteRows;if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length<2||rows.length>50||Reflect.ownKeys(rows).length!==rows.length+1)reject('逐户报价明细无效（2–50 家）。');
      const seen=new Set(),items=[];let sum=0n;
      for(let i=0;i<rows.length;i++){
        const d=Object.getOwnPropertyDescriptor(rows,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))reject('逐户报价明细无效。');
        const row=exact(d.value,['name','assets','revenue','profit','period','totalCents']),name=text(row.name,'被审计方名称',100);
        const key=name.normalize('NFKC').trim();if(seen.has(key))reject('逐户报价明细的单位名称重复。');seen.add(key);
        const period=text(row.period,'财务数据期间',100,true),metrics={};
        for(const k of ['assets','revenue','profit']){
          const v=text(row[k],'财务金额',48,true);
          if(v&&!(k==='profit'?/^-?\d{1,9}(?:\.\d{1,6})?$/:/^\d{1,9}(?:\.\d{1,6})?$/).test(v))reject('逐户财务数据无效。');
          metrics[k]=v;
        }
        if(!Number.isSafeInteger(row.totalCents)||row.totalCents<0||Object.is(row.totalCents,-0))reject('逐户报价须为非负安全整数分。');
        sum+=BigInt(row.totalCents);items.push(Object.freeze({name,...metrics,period,totalCents:row.totalCents}));
      }
      if(sum!==BigInt(out.totalCents))reject('逐户报价与合计金额不一致。');
      out.quoteRows=Object.freeze(items);
    }
    return Object.freeze(out);
  }
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function base64(bytes){const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',parts=[];for(let offset=0;offset<bytes.length;offset+=8190){let text='',end=Math.min(offset+8190,bytes.length);for(let i=offset;i<end;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];text+=abc[a>>>2]+abc[((a&3)<<4)|(b===undefined?0:b>>>4)]+(b===undefined?'=':abc[((b&15)<<2)|(c===undefined?0:c>>>6)])+(c===undefined?'=':abc[c&63]);}parts.push(text);}return parts.join('');}
  function attachmentPath(a){const ext=filename(a.name).extension;return '附件/'+LABELS[a.kind]+'.'+(ext==='jpeg'?'jpg':ext);}
  function money(cents){const s=String(cents).padStart(3,'0');return s.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+s.slice(-2);}
  const STYLE='.quote-packet{font:14px/1.65 "Microsoft YaHei","PingFang SC",Arial,sans-serif;color:#20373a;max-width:960px;margin:auto}.quote-packet *{box-sizing:border-box}.quote-packet .document-header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:18px;border-bottom:3px solid #27685b;padding:0 0 24px;margin:0 0 26px}.quote-packet .qp-eyebrow{font-size:10px;letter-spacing:2px;font-weight:700;color:#27685b}.quote-packet .document-header h1{font-size:25px;line-height:1.35;margin:8px 0;color:#173a56}.quote-packet .qp-firm{font-size:13px;margin:0;color:#526862;overflow-wrap:anywhere}.quote-packet .qp-status{color:#986829;font-size:13px;font-weight:600;border:1px solid #d6bf97;padding:6px 10px;white-space:nowrap}.quote-packet .document-meta{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 24px;font-size:13px;margin:0 0 25px}.quote-packet .document-meta div{min-width:0;overflow-wrap:anywhere}.quote-packet .document-meta span{color:#63776d}.quote-packet .document-meta strong{font-weight:500}.quote-packet table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}.quote-packet th,.quote-packet td{padding:11px 9px;border-bottom:1px solid #e3e8e2;text-align:left;vertical-align:top;overflow-wrap:anywhere}.quote-packet th{font-weight:600;color:#27685b;background:#f2f6f1;white-space:normal}.quote-packet th:last-child,.quote-packet td:last-child{text-align:right}.quote-packet .document-total{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-top:1px solid #e3e8e2;padding:22px 0;color:#173a56}.quote-packet .document-total strong{font-size:27px;line-height:1.3;overflow-wrap:anywhere;min-width:0}.quote-packet .document-terms{font-size:13px;color:#586c61;line-height:1.9;margin:0 0 20px}.quote-packet .document-terms h2{font-size:16px;color:#173a56;margin:0 0 10px}.quote-packet .document-terms p{margin:8px 0}.quote-packet .document-note{font-size:11px;color:#788c7d;border-top:1px solid #e3e8e2;padding-top:14px;margin:22px 0}.quote-packet .qp-note{font-size:12px;padding:12px;border-left:3px solid #986829;background:#fff8e6;overflow-wrap:anywhere}.quote-packet .qp-attachments{margin-top:26px}.quote-packet .qp-attachments>h2{font-size:18px;color:#173a56;border-bottom:2px solid #27685b;padding-bottom:9px}.quote-packet .qp-attachment{break-inside:avoid;margin:24px 0}.quote-packet .qp-attachment h3{font-size:16px;color:#173a56;margin:0 0 10px}.quote-packet img{display:block;max-width:100%;height:auto;max-height:850px;object-fit:contain}.quote-packet code{overflow-wrap:anywhere;white-space:normal;font-size:11px}.quote-packet .qp-meta{overflow-wrap:anywhere;font-size:12px}.quote-packet a{color:#27685b}@media(max-width:600px){.quote-packet .document-meta{grid-template-columns:minmax(0,1fr)}.quote-packet .document-header h1{font-size:23px}.quote-packet .document-total strong{font-size:24px}.quote-packet th,.quote-packet td{padding:9px 6px;font-size:12px}}@media print{.quote-packet{color:#000;font-size:11pt;max-width:none}.quote-packet .document-header{break-inside:avoid}.quote-packet .document-meta{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.quote-packet table,.quote-packet .document-total,.quote-packet .document-terms{break-inside:avoid}.quote-packet .qp-note{background:none;border:1px solid #999}.quote-packet .qp-attachment{break-before:page}.quote-packet a{color:#000}}';
  function body(s,pair,relative,includeAttachments=true){
    const labels=[['委托单位',s.customerName],['编制日期',s.quoteDate],['审计年度',s.auditYear+' 年'],['客户所在地',s.location],['项目名称',s.projectName],['项目类型',s.projectType],['发标单位',s.issuer],['发标方联系人',s.contactName||'待填写'],['发标方联系方式',s.contactInfo||'待填写']];
    if(s.bidderContact){for(const [label,key] of [['投标方联系人','name'],['投标方电话','phone'],['投标方邮箱','email']])if(s.bidderContact[key])labels.push([label,s.bidderContact[key]]);}
    const attachments=(includeAttachments?pair:[]).map(a=>{const title=LABELS[a.kind],to=attachmentPath(a),isImage=a.mime!=='application/pdf',href=relative?'./'+to:'data:'+a.mime+';base64,'+base64(a.bytes);return '<section class="qp-attachment"><h3>'+title+'</h3><p class="qp-meta">原文件：'+escape(a.name)+'；类型：'+escape(a.mime)+'；大小：'+a.size+' 字节</p><p>SHA-256：<code>'+a.sha256+'</code></p><p><a href="'+escape(href)+'" download="'+escape(to.split('/').at(-1))+'">单独下载'+title+'附件</a></p>'+(isImage?'<img src="data:'+a.mime+';base64,'+base64(a.bytes)+'" alt="'+title+'（'+escape(a.name)+'）">':'<p>PDF附件仅作为单独文件提供，不自动打开、不自动合并到打印正文。</p>')+'</section>';}).join('');
    return '<style>'+STYLE+'</style><article class="quote-packet"><header class="document-header"><div><div class="qp-eyebrow">AUDIT SERVICE PROPOSAL</div><h1>审计服务报价单</h1><p class="qp-firm">事务所名称：<strong>'+escape(s.firmName||'待填写')+'</strong></p></div><span class="qp-status">草稿 · 待审核</span></header><div class="document-meta">'+labels.map(([k,v])=>'<div><span>'+k+'：</span><strong>'+escape(v)+'</strong></div>').join('')+'</div><table><colgroup><col style="width:40%"><col style="width:36%"><col style="width:24%"></colgroup><thead><tr><th>服务项目</th><th>范围</th><th>费用（元）</th></tr></thead><tbody><tr><td>'+escape(s.service)+'</td><td>'+escape(s.auditYear)+'年度 / 具体服务范围待书面确认</td><td>'+money(s.subtotalCents)+'</td></tr><tr><td>另计税额</td><td>'+escape(s.taxRateText)+'</td><td>'+money(s.taxCents)+'</td></tr></tbody></table><div class="document-total"><span>报价合计（含税）</span><strong>￥'+money(s.totalCents)+'</strong></div><section class="document-terms"><h2>服务与报价说明</h2><p>1. 本报价为初步沟通草稿，不构成承接或价格承诺。正式金额以事务所审核及双方签署的业务约定书为准。</p><p>2. 服务范围、资料清单、交付期限、税费口径、差旅及额外工作费用须另行书面确认。</p><p>3. 报价有效期：待双方确认。财务资料或服务范围发生变化时，应重新测算。</p><p>4. 本报价不对审计意见类型及其他审计结果作出保证。</p></section><p class="document-note">本文件由报价原型生成 · 未经事务所审核 · 不含内部预算与地区比较信息</p>'+(includeAttachments?'<p class="qp-note">'+PRINT_NOTICE+'。本工具仅校验附件格式特征、尺寸、大小及摘要，不验证证照真伪、有效期或执业资格。</p><section class="qp-attachments"><h2>报价附件</h2>'+attachments+'</section>':'')+'</article>';
  }
  async function renderDocument(snapshot,attachments,{includeAttachments=true}={}){const s=normalizeSnapshot(snapshot),pair=await verifyPair(attachments);return body(s,pair,false,includeAttachments);}
  function zipStore(entries,extraBytes=0){
    const encoder=new TextEncoder(),files=entries.map(e=>({name:encoder.encode(e.name),bytes:e.bytes,crc:crc32(e.bytes)}));let length=22;for(const f of files)length+=30+f.name.length+f.bytes.length+46+f.name.length;if(length>MAX_PACKET_BYTES+extraBytes)reject('报价包超过本机安全大小限制。');const out=new Uint8Array(length),v=new DataView(out.buffer),central=[];let at=0;
    for(const f of files){const start=at;v.setUint32(at,0x04034b50,true);v.setUint16(at+4,20,true);v.setUint16(at+6,0x800,true);v.setUint16(at+8,0,true);v.setUint16(at+12,0x21,true);v.setUint32(at+14,f.crc,true);v.setUint32(at+18,f.bytes.length,true);v.setUint32(at+22,f.bytes.length,true);v.setUint16(at+26,f.name.length,true);out.set(f.name,at+30);out.set(f.bytes,at+30+f.name.length);at+=30+f.name.length+f.bytes.length;central.push({f,start});}
    const centralAt=at;for(const {f,start}of central){v.setUint32(at,0x02014b50,true);v.setUint16(at+4,20,true);v.setUint16(at+6,20,true);v.setUint16(at+8,0x800,true);v.setUint16(at+10,0,true);v.setUint16(at+14,0x21,true);v.setUint32(at+16,f.crc,true);v.setUint32(at+20,f.bytes.length,true);v.setUint32(at+24,f.bytes.length,true);v.setUint16(at+28,f.name.length,true);v.setUint32(at+42,start,true);out.set(f.name,at+46);at+=46+f.name.length;}
    const centralLength=at-centralAt;v.setUint32(at,0x06054b50,true);v.setUint16(at+8,files.length,true);v.setUint16(at+10,files.length,true);v.setUint32(at+12,centralLength,true);v.setUint32(at+16,centralAt,true);return out;
  }
  async function buildPacket(snapshot,attachments,extras=[]){
    if(snapshot&&Object.hasOwn(snapshot,'quoteRows'))reject('多单位报价须使用报价明细版式导出。');
    const s=normalizeSnapshot(snapshot),[pair,more]=await Promise.all([verifyPair(attachments),verifyExtras(extras)]),encoder=new TextEncoder(),html=encoder.encode('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; img-src data:; style-src \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>审计服务报价单 · 草稿待审核</title></head><body>'+body(s,pair,true)+'</body></html>');
    const manifest={schemaVersion:1,status:'draft_pending_review',certificateAuthenticityVerified:false,pdfAttachmentsMerged:false,printingNotice:PRINT_NOTICE,snapshot:s,document:{path:'报价草稿.html',mime:'text/html',size:html.length,sha256:await sha256(html)},attachments:pair.map(a=>({kind:a.kind,path:attachmentPath(a),name:a.name,mime:a.mime,size:a.size,sha256:a.sha256}))};
    const extraEntries=more.map((a,i)=>({name:'其他附件/'+String(i+1).padStart(2,'0')+'-'+a.name,bytes:a.bytes}));
    if(more.length)manifest.extras=more.map((a,i)=>({kind:'extra',path:extraEntries[i].name,name:a.name,mime:a.mime,size:a.size,sha256:a.sha256}));
    return zipStore([{name:'报价草稿.html',bytes:html},...pair.map(a=>({name:attachmentPath(a),bytes:a.bytes})),...extraEntries,{name:'附件清单.json',bytes:encoder.encode(JSON.stringify(manifest,null,2)+'\n')}],more.reduce((n,a)=>n+a.size,0));
  }
  const PREPARED_MAX=96*1024*1024;
  const FORMAT_IDS=Object.freeze(['format1','format2','format3']);
  const SIGN_KINDS=Object.freeze(['company_seal','legal_representative_seal','bidder_signature']);
  function checkedKinds(value,nonempty=false){
    if(!Array.isArray(value)||value.length>3||nonempty&&!value.length||new Set(value).size!==value.length||Array.from(value).some(k=>!SIGN_KINDS.includes(k)))reject('章签项目不正确。');
    return [...value];
  }
  function boundedCopy(bytes,max){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>max)reject('文档副本体积超出限制。');
    return new Uint8Array(bytes);
  }
  function formatHtml(fragment,id){
    if(typeof fragment!=='string'||!fragment.trim()||fragment.length>16*1024*1024||!wellFormed(fragment)||/<(?:script|iframe|object|embed|form|link|base|meta)\b/i.test(fragment))reject('报价模板内容无效。');
    const style=root.QuoteLayouts?.styles||'';
    if(typeof style!=='string'||style.length>64000||/<\/style/i.test(style))reject('报价模板样式无效。');
    return new TextEncoder().encode('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;none&apos;; connect-src &apos;none&apos;; img-src data:; style-src &apos;unsafe-inline&apos;; object-src &apos;none&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;"><title>格式'+id.slice(-1)+' · 报价函草稿</title><style>'+style+'</style></head><body>'+fragment+'</body></html>');
  }
  // The legacy builder remains untouched for already registered packets.
  // The prepared builder packages generated copies, never raw signing-image files.
  async function buildPreparedPacket(snapshot,attachments,extras,prepared){
    const s=normalizeSnapshot(snapshot),p=exact(prepared,['documents','replacements']),encoder=new TextEncoder();
    if(!Array.isArray(p.documents)||!p.documents.length||p.documents.length>3||!Array.isArray(p.replacements)||p.replacements.length>12)reject('请至少选择一种报价格式。');
    const formats=new Set(),replacements=new Map(),files=[];
    const manifest={schemaVersion:2,status:'draft_pending_review',digitalSignatureApplied:false,certificateAuthenticityVerified:false,pdfAttachmentsMerged:false,printingNotice:PRINT_NOTICE,snapshot:s,documents:[],attachments:[],extras:[]};
    let sizeTotal=0;
    function add(name,bytes){
      sizeTotal+=bytes.length;
      if(sizeTotal>PREPARED_MAX-65536||files.some(f=>f.name===name))reject('报价文件包过大或文件名重复。');
      files.push({name,bytes});
    }
    const copyDocs=Array.from(p.documents,d=>{
      const x=exact(d,['formatId','html','docx','kinds']);
      if(!FORMAT_IDS.includes(x.formatId)||formats.has(x.formatId))reject('报价格式重复或无效。');formats.add(x.formatId);
      const docx=x.docx==null?null:boundedCopy(x.docx,12*1024*1024);
      if(docx)officeDirectory(docx,'docx');
      return {formatId:x.formatId,html:formatHtml(x.html,x.formatId),docx,kinds:checkedKinds(x.kinds)};
    });
    for(const value of p.replacements){
      const x=exact(value,['id','name','mime','bytes','kinds','page','position']);
      if(typeof x.id!=='string'||!/^cert:(?:business_license|practice_certificate)$|^extra:[0-9]$/.test(x.id)||replacements.has(x.id))reject('附件副本目标无效或重复。');
      const f=filename(x.name,EXTRA_MIME),extension=f.extension,bytes=boundedCopy(x.bytes,16*1024*1024),kinds=checkedKinds(x.kinds,true);
      if(!['application/pdf','image/png','image/jpeg',EXTRA_MIME.docx].includes(x.mime)||EXTRA_MIME[extension]!==x.mime)reject('附件副本类型无效。');
      if(x.mime===EXTRA_MIME.docx)officeDirectory(bytes,'docx');else format(bytes,extension,x.mime);
      if(!Number.isInteger(x.page)||x.page<1||x.page>300||!['bottom-right','bottom-left','top-right','top-left','placeholder'].includes(x.position))reject('附件副本位置无效。');
      replacements.set(x.id,{...x,bytes,kinds,extension});
    }
    const [pair,more]=await Promise.all([verifyPair(attachments),verifyExtras(extras)]);
    for(const d of copyDocs){
      const stem='报价单/格式'+d.formatId.slice(-1)+'-报价函-待审核';
      const info={formatId:d.formatId,appliedSigningKinds:d.kinds,html:{path:stem+'.html',mime:'text/html',size:d.html.length,sha256:await sha256(d.html)}};
      add(info.html.path,d.html);
      if(d.docx){
        info.docx={path:stem+'.docx',mime:EXTRA_MIME.docx,size:d.docx.length,sha256:await sha256(d.docx)};
        add(info.docx.path,d.docx);
      }
      manifest.documents.push(info);
    }
    const finish=async(a,id,base)=>{
      const x=replacements.get(id);
      if(x){
        replacements.delete(id);
        const ext=x.extension==='jpeg'?'jpg':x.extension,path=base.slice(0,base.lastIndexOf('.'))+'-章签待复核.'+ext;
        add(path,x.bytes);
        return {kind:a.kind,path,name:x.name,mime:x.mime,size:x.bytes.length,sha256:await sha256(x.bytes),appliedSigningKinds:x.kinds,placement:{page:x.page,position:x.position},source:{name:a.name,sha256:a.sha256}};
      }
      add(base,a.bytes);return {kind:a.kind,path:base,name:a.name,mime:a.mime,size:a.size,sha256:a.sha256,appliedSigningKinds:[]};
    };
    for(const a of pair)manifest.attachments.push(await finish(a,'cert:'+a.kind,attachmentPath(a)));
    for(const [i,a]of more.entries())manifest.extras.push(await finish(a,'extra:'+i,'其他附件/'+String(i+1).padStart(2,'0')+'-'+a.name));
    if(replacements.size)reject('无法匹配某个原附件，未生成报价包。');
    return zipStore([...files,{name:'附件清单.json',bytes:encoder.encode(JSON.stringify(manifest,null,2)+'\n')}],PREPARED_MAX-MAX_PACKET_BYTES);
  }
  const api=Object.freeze({readExtra,verifyExtras,readAttachment,verifyAttachment,verifyPair,normalizeSnapshot,renderDocument,buildPacket,buildPreparedPacket,sha256Blob,QuotePacketError,MAX_ATTACHMENT_BYTES,MAX_PAIR_BYTES});root.QuotePacket=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
