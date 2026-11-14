/* Bounded, local-only Word 97-2003 DOC text import; no Office/macros/network. */
(function(root){
  'use strict';
  const MAX=2*1024*1024,LIMIT=150000,END=0xfffffffe,FREE=0xffffffff;
  const error=s=>{throw Error(s);};
  const invalid=()=>error('DOC 内容损坏、加密或格式不受支持；请在 Word 中另存为 DOCX 后导入。');
  function strict(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<512||bytes.length>MAX)error('DOC 为空或超过 2 MB。');
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=(x)=>d.getUint16(x,true),u32=x=>d.getUint32(x,true);
    if(![0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>bytes[i]===v))error('请选择真正的 Word 97–2003 二进制 DOC；不支持改后缀的 RTF、HTML 或文本。');
    const major=u16(26),shift=u16(30);
    if(u16(28)!==0xfffe||!(major===3&&shift===9||major===4&&shift===12)||u16(32)!==6||u32(56)!==4096)invalid();
    const size=2**shift,n=bytes.length/size-1;if(!Number.isInteger(n)||n<1)invalid();
    const fats=u32(44),difats=u32(72),miniCount=u32(64);
    if(!fats||fats>n||difats>n||miniCount>n)invalid();
    const offset=id=>{if(!Number.isInteger(id)||id<0||id>=n)invalid();return (id+1)*size;};
    const fatIds=[],seenFat=new Set();
    const add=id=>{if(id===FREE)return;offset(id);if(seenFat.has(id)||fatIds.length>=fats)invalid();seenFat.add(id);fatIds.push(id);};
    for(let i=0;i<109;i++)add(u32(76+i*4));
    let did=u32(68);const seenD=new Set();
    for(let i=0;i<difats;i++){
      if(seenD.has(did))invalid();seenD.add(did);const off=offset(did);
      for(let j=0;j<size/4-1;j++)add(u32(off+j*4));
      did=u32(off+size-4);
    }
    if(difats&&did!==END||!difats&&![END,FREE].includes(did)||fatIds.length!==fats)invalid();
    const fat=new Uint32Array(fats*size/4);
    for(let i=0;i<fatIds.length;i++){const off=offset(fatIds[i]);for(let j=0;j<size/4;j++)fat[i*size/4+j]=u32(off+j*4);}
    function chain(start,expected,table=fat,unit=size,buffer=bytes,mini=false){
      const limit=mini?Math.floor(buffer.length/unit):n,used=new Set(),chunks=[];let id=start;
      if(expected===0){if(![END,FREE].includes(id))invalid();return new Uint8Array(0);}
      while(id!==END){
        if(id===FREE||!Number.isInteger(id)||id<0||id>=limit||id>=table.length||used.has(id)||used.size>=limit)invalid();
        used.add(id);const off=mini?id*unit:offset(id);if(off+unit>buffer.length)invalid();
        chunks.push(buffer.subarray(off,off+unit));id=table[id];
      }
      const len=expected==null?chunks.length*unit:expected;
      if(!Number.isSafeInteger(len)||len<0||len>MAX||chunks.length!==Math.ceil(len/unit))invalid();
      const out=new Uint8Array(len);let at=0;for(const c of chunks){out.set(c.subarray(0,Math.min(c.length,len-at)),at);at+=Math.min(c.length,len-at);}return out;
    }
    const dirs=chain(u32(48),null),dd=new DataView(dirs.buffer),entries=[];
    for(let i=0;i+128<=dirs.length;i+=128){
      const type=dirs[i+66];if(!type){entries.push(null);continue;}if(![1,2,5].includes(type))invalid();
      const nl=dd.getUint16(i+64,true);
      if(nl<2||nl>64||nl%2||dd.getUint16(i+nl-2,true)!==0)invalid();
      let name='';for(let j=0;j<nl-2;j+=2)name+=String.fromCharCode(dd.getUint16(i+j,true));
      const lo=dd.getUint32(i+120,true),hi=dd.getUint32(i+124,true);
      if(hi||lo>MAX)invalid();
      entries.push({name,type,size:lo,start:dd.getUint32(i+116,true),left:dd.getUint32(i+68,true),right:dd.getUint32(i+72,true),child:dd.getUint32(i+76,true)});
    }
    const rootEntry=entries[0];if(!rootEntry||rootEntry.type!==5||entries.slice(1).some(x=>x?.type===5))invalid();
    const names=new Map(),seenDir=new Set(),queue=[rootEntry.child];
    while(queue.length){
      const id=queue.pop();if(id===FREE)continue;
      if(id>=entries.length||!entries[id]||seenDir.has(id))invalid();seenDir.add(id);
      const e=entries[id];if(names.has(e.name))invalid();names.set(e.name,e);queue.push(e.left,e.right);
    }
    for(const name of ['WordDocument','0Table','1Table'])if(entries.filter(e=>e?.name===name).length>1)invalid();
    const miniStream=chain(rootEntry.start,rootEntry.size);
    const mbytes=miniCount?chain(u32(60),miniCount*size):new Uint8Array(0),md=new DataView(mbytes.buffer),miniFat=new Uint32Array(mbytes.length/4);
    for(let i=0;i<miniFat.length;i++)miniFat[i]=md.getUint32(i*4,true);
    function stream(e){
      if(!e||e.type!==2||!e.size)invalid();
      return e.size>=4096?chain(e.start,e.size):chain(e.start,e.size,miniFat,64,miniStream,true);
    }
    const wd=stream(names.get('WordDocument')),wv=new DataView(wd.buffer),w16=x=>wv.getUint16(x,true),w32=x=>wv.getUint32(x,true);
    if(wd.length<0x9a||w16(0)!==0xa5ec||w16(2)<0xc1||w16(2)>0x112||w16(10)&0x8100)invalid();
    let p=0x20,csw=w16(p);p+=2+csw*2;if(p+2>wd.length)invalid();
    const cslw=w16(p),rgLw=p+2;p+=2+cslw*4;if(cslw<11||p+2>wd.length)invalid();
    const pairs=w16(p),fcStart=p+2;if(pairs<34||fcStart+pairs*8>wd.length)invalid();
    const ccp=w32(rgLw+12);if(!ccp||ccp>LIMIT)error('DOC 正文为空或超出 150,000 字符限制。');
    const total=[3,4,5,7,8,9,10].reduce((v,i)=>v+w32(rgLw+i*4),0);if(total>500000)invalid();
    const tb=stream(names.get(w16(10)&0x200?'1Table':'0Table')),tv=new DataView(tb.buffer);
    let q=w32(fcStart+33*8),end=q+w32(fcStart+33*8+4);if(q>=end||end>tb.length)invalid();
    while(q<end&&tb[q]===1){
      if(q+3>end)invalid();const len=tv.getInt16(q+1,true);if(len<0||q+3+len>end)invalid();q+=3+len;
    }
    if(q+5>end||tb[q]!==2)invalid();
    const plcLen=tv.getUint32(q+1,true),plc=q+5;
    if(plc+plcLen!==end||plcLen<16||(plcLen-4)%12)invalid();
    const pc=(plcLen-4)/12;if(pc>30000||tv.getUint32(plc,true)!==0)invalid();
    const last=tv.getUint32(plc+pc*4,true);if(last<ccp||last>total+1)invalid();
    const pcs=plc+(pc+1)*4;
    for(let i=0;i<pc;i++){
      const a=tv.getUint32(plc+i*4,true),b=tv.getUint32(plc+(i+1)*4,true),fc=tv.getUint32(pcs+i*8+2,true);
      if(b<=a||fc&0x80000000)invalid();
      const compressed=!!(fc&0x40000000),raw=fc&0x3fffffff,at=compressed?raw/2:raw,len=(b-a)*(compressed?1:2);
      if(!Number.isInteger(at)||at+len>wd.length)invalid();
    }
    // Formatting is read only to recognize deleted text and list labels. Bound its
    // FKP index before the vendor can allocate duplicate run objects.
    for(const index of [12,13]){
      const fc=w32(fcStart+index*8),len=w32(fcStart+index*8+4);if(!len)continue;
      if(len<4||(len-4)%8||fc+len>tb.length)invalid();
      const count=(len-4)/8;if(count>Math.floor(wd.length/512))invalid();
      const seen=new Set();let totalRuns=0;
      for(let i=0;i<count;i++){
        const pn=tv.getUint32(fc+(count+1)*4+i*4,true)&0x003fffff,off=pn*512;
        if(seen.has(pn)||off+512>wd.length)invalid();seen.add(pn);
        const runs=wd[off+511];
        if(4*(runs+1)+runs*(index===12?1:13)>511||(totalRuns+=runs)>30000)invalid();
      }
    }
    const st=w32(fcStart+8),sl=w32(fcStart+12);
    if(sl&&(sl<6||st+sl>tb.length||tv.getUint16(st+2,true)>4096))invalid();
    return bytes;
  }
  function clean(text){
    if(typeof text!=='string'||!text.trim()||text.length>LIMIT||!text.isWellFormed())error('DOC 未读到完整有效正文；请另存为 DOCX 后导入。');
    // A DOC table cannot safely be reinterpreted as a one-line checklist.
    if(text.includes('\t'))error('DOC 含表格或制表符，请先整理为每行一项的 TXT／DOCX。');
    const lines=text.replace(/\r\n|[\r\u000b\u000c]/gu,'\n').split('\n').map(s=>s.trim()).filter(Boolean);
    if(!lines.length)invalid();return {lines};
  }
  function extract(input){
    const b=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
    if(!b)invalid();strict(b);
    const reader=typeof module==='object'&&module.exports?require('./vendor-legacy-doc.js'):root.LegacyDocFactory();
    const text=reader(b);clean(text);return text;
  }
  function cleanStructure(value){
    if(!value||value.source!=='word-outline'||!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.length>20000)error('DOC 未读到有效大纲结构；请另存为 DOCX。');
    let total=0,nonempty=false;
    const paragraphs=value.paragraphs.map(p=>{
      if(!p||typeof p.text!=='string'||typeof p.styleName!=='string'||p.styleName.length>255||!p.text.isWellFormed()||!p.styleName.isWellFormed()||p.level!==null&&(!Number.isInteger(p.level)||p.level<1||p.level>9))error('DOC 大纲结构无效；请另存为 DOCX。');
      if((total+=p.text.length)>LIMIT||/[\r\u0000-\u0008\u000e-\u001f]/u.test(p.text)||/[\u0000-\u001f]/u.test(p.styleName))error('DOC 大纲超限或包含不支持的控制字符。');
      if(p.text.trim())nonempty=true;
      return {text:p.text,level:p.level,styleName:p.styleName};
    });
    if(!nonempty)error('DOC 正文为空；请核对文件。');
    return {paragraphs,source:'word-outline'};
  }
  function extractStructure(input){
    const b=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
    if(!b)invalid();strict(b);
    const reader=typeof module==='object'&&module.exports?require('./vendor-legacy-doc.js'):root.LegacyDocFactory();
    return cleanStructure(reader.structure(b));
  }
  async function readIsolated(file,structure){
    if(!file||!/\.doc$/iu.test(file.name)||!Number.isSafeInteger(file.size)||file.size<512||file.size>MAX)error('请选择不超过 2 MB 的旧版 DOC 文件。');
    const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)invalid();strict(bytes);
    if(typeof root.Worker!=='function'||!root.LegacyDocFactory)error('当前浏览器不支持隔离读取 DOC，请升级浏览器或另存为 DOCX。');
    // Include the audited plain reader directly. No importScripts/fetch, including file://.
    const script='const reader=('+root.LegacyDocFactory.toString()+')();const structure='+JSON.stringify(structure)+';self.onmessage=e=>{try{const bytes=new Uint8Array(e.data);const t=structure?reader.structure(bytes):reader(bytes);if(structure){if(!t||t.source!=="word-outline"||!Array.isArray(t.paragraphs)||t.paragraphs.length>20000)throw Error();}else if(typeof t!=="string"||t.length>150000)throw Error();self.postMessage({value:t});}catch(_){self.postMessage({failed:true});}};';
    const url=URL.createObjectURL(new Blob([script],{type:'application/javascript'}));let worker;
    try{
      const value=await new Promise((resolve,reject)=>{
        let done=false,timer;
        const finish=(err,t)=>{if(done)return;done=true;clearTimeout(timer);if(err)reject(err);else resolve(t);};
        try{
          worker=new Worker(url);timer=setTimeout(()=>finish(Error('DOC 读取超时，未改动原清单；请另存为 DOCX。')),5000);
          worker.onmessage=e=>e.data?.failed?finish(Error(structure?'DOC 大纲格式不受支持或无法完整读取，请另存为 DOCX；未推测标题层级。':'DOC 内容不受支持或无法完整读取，请另存为 DOCX。')):finish(null,e.data?.value);
          worker.onerror=()=>finish(Error('DOC 隔离读取失败，请升级浏览器或另存为 DOCX。'));
          worker.postMessage(bytes.buffer,[bytes.buffer]);
        }catch(e){finish(Error('浏览器无法启动本机 DOC 读取，请另存为 DOCX。'));}
      });
      return structure?cleanStructure(value):clean(value);
    }finally{worker?.terminate();URL.revokeObjectURL(url);}
  }
  async function read(file){return readIsolated(file,false);}
  async function readStructure(file){return readIsolated(file,true);}
  const api=Object.freeze({read,extract,readStructure,extractStructure});if(typeof module==='object'&&module.exports)module.exports=api;else root.LegacyDoc=api;
})(globalThis);
