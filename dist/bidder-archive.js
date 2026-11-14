/* 本机 RAR 5 / ZIP 清单预检与定向读取。文件只进内存，不上传、运行或落盘。 */
(function(root){
  'use strict';
  const LIMITS=Object.freeze({inputBytes:160*1024*1024,expandedBytes:512*1024*1024,entryBytes:32*1024*1024,readBytes:64*1024*1024,entries:512,readCount:64,timeMs:45000});
  function archiveWorker(){
    'use strict';
    let data, view, directory, format;
    class ArchiveReadError extends Error {}
    const fail=(message='压缩包结构损坏或格式不受支持。')=>{throw new ArchiveReadError(message);};
    const utf8=new TextDecoder('utf-8',{fatal:true});
    const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
    function crc(bytes,start=0,end=bytes.length){let c=0xffffffff;for(let i=start;i<end;i++)c=(c>>>8)^crcTable[(c^bytes[i])&255];return (c^0xffffffff)>>>0;}
    function u16(i){return view.getUint16(i,true);}
    function u32(i){return view.getUint32(i,true);}
    function pathName(raw,dir){
      const n=raw.replace(/\\/g,'/').normalize('NFC').replace(dir?/\/$/:/$^/,'');
      if(!n||n.length>600||/[:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff]/u.test(n)||n.split('/').some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)))
        fail('压缩包含不安全路径，请重新打包。');
      return n;
    }
    function add(out,unique,entry){
      const name=pathName(entry.raw,entry.dir),id=name.toLowerCase();
      if(unique.has(id))fail('压缩包含同名或冲突路径，请整理后重新打包。');
      unique.add(id);if(unique.size>LIMITS.entries)fail('压缩包条目过多（最多 512 项）。');
      if(!entry.dir){if(!Number.isSafeInteger(entry.size)||entry.size<0)fail();out.set(name,{...entry,name});}
    }
    function checkDirectory(out){
      let sum=0;for(const e of out.values()){sum+=e.size;if(sum>LIMITS.expandedBytes)fail('压缩包声明解压体积过大（最多 512 MiB）。');}
      if(!out.size)fail('压缩包里没有可读取的文件。');
      return out;
    }
    function parseZip(){
      if(data.length<22)fail();
      let e=data.length-22;const min=Math.max(0,e-65535);
      for(;e>=min;e--)if(u32(e)===0x06054b50&&e+22+u16(e+20)===data.length)break;
      if(e<min||u16(e+4)||u16(e+6)||u16(e+8)!==u16(e+10))fail('暂不支持分卷或损坏的 ZIP。');
      const count=u16(e+10),start=u32(e+16),len=u32(e+12);
      if(!count||count>LIMITS.entries||start+len!==e||start<30)fail();
      const out=new Map(),unique=new Set(),ranges=[];let p=start;
      for(let i=0;i<count;i++){
        if(p+46>e||u32(p)!==0x02014b50||u16(p+34))fail();
        const flags=u16(p+8),method=u16(p+10),checksum=u32(p+16),packed=u32(p+20),size=u32(p+24);
        if(flags&0x2041)fail('暂不支持加密 ZIP。');
        if(![0,8].includes(method)||(flags&~0x80e)||(method===0&&packed!==size))fail('ZIP 压缩方法或标记不受支持。');
        const n=u16(p+28),ex=u16(p+30),next=p+46+n+ex+u16(p+32),local=u32(p+42);
        if(!n||next>e||local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==n)fail();
        const unixType=u16(p+40)&0xf000;
        if(unixType!==0&&unixType!==0x8000&&unixType!==0x4000)fail('压缩包含链接或非普通文件，请重新打包。');
        const dataStart=local+30+n+u16(local+28),stop=dataStart+packed;
        if(stop>start)fail();
        for(let j=0;j<n;j++)if(data[local+30+j]!==data[p+46+j])fail();
        if(!(flags&8)&&(u32(local+14)!==checksum||u32(local+18)!==packed||u32(local+22)!==size))fail();
        let raw;try{raw=utf8.decode(data.subarray(p+46,p+46+n));}catch{fail('ZIP 文件名不是 UTF-8，请用支持 UTF-8 文件名的工具重新打包。');}
        const dir=raw.endsWith('/')||raw.endsWith('\\')||unixType===0x4000||(u32(p+38)&16)!==0;
        if(dir&&(size||packed>16||checksum))fail();
        ranges.push([local,stop]);add(out,unique,{raw,dir,size,method,checksum,dataStart,stop});p=next;
      }
      ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])fail();
      if(p!==e)fail();
      return checkDirectory(out);
    }
    function parseRar(){
      // RARLAB RAR 5.0 format: only structural headers are interpreted here.
      // Payload extraction/CRC is delegated to the isolated UnRAR worker.
      const out=new Map(),unique=new Set();let p=8,blocks=0,main=false,ended=false,expanded=0;
      while(p<data.length){
        if(++blocks>LIMITS.entries*4||p+7>data.length)fail();
        const start=p;let cursor=p+4,end=data.length;
        const v=()=>{let n=0,scale=1;for(let i=0;i<10;i++){if(cursor>=end)fail();const b=data[cursor++];n+=(b&127)*scale;if(!Number.isSafeInteger(n))fail();if(!(b&128))return n;scale*=128;}fail();};
        const headerSize=v();end=cursor+headerSize;
        if(headerSize<2||headerSize>2*1024*1024||end>data.length||u32(start)!==crc(data,start+4,end))fail();
        const type=v(),flags=v();if(flags>127||flags&0x18)fail('暂不支持分卷 RAR。');
        const extra=flags&1?v():0,packed=flags&2?v():0,extraStart=end-extra;
        if(extraStart<cursor||end+packed>data.length)fail();
        if(type===4)fail('暂不支持加密 RAR。');
        if(type===1){
          const arcFlags=v();if(main||start!==8||packed||cursor!==extraStart)fail();main=true;
          if(arcFlags&3)fail('暂不支持分卷 RAR。');
          // Do not let a secondary Quick Open table shadow the validated headers.
          // Ignore its Locator record in the isolated in-memory image only.
          let strippedLocator=false;
          while(cursor<end){
            const record=v(),typeAt=cursor,stop=cursor+record;if(!record||stop>end)fail();
            const kind=v();if(cursor>stop)fail();
            if(kind===1){if(cursor!==typeAt+1)fail();data[typeAt]=0x7e;strippedLocator=true;}
            cursor=stop;
          }
          if(strippedLocator)view.setUint32(start,crc(data,start+4,end),true);
        }else if(type===2||type===3){
          if(!main)fail();
          const f=v(),size=v(),attributes=v();
          if(f&8)fail('RAR 文件大小未知，不能安全导入。');
          if(f&2)cursor+=4;
          if(f&4)cursor+=4;
          const comp=v(),host=v(),n=v();
          if(cursor+n!==extraStart||n<1||comp>0x7fff||(comp&63)!==0)fail('RAR 压缩参数不受支持，请转为普通 ZIP。');
          const dict=128*1024*2**((comp>>>10)&31),method=(comp>>>7)&7;
          if(method>5||dict>64*1024*1024)fail('RAR 字典超过安全限制（64 MiB），请转为普通 ZIP。');
          const dir=!!(f&1);
          if(host===1&&((attributes&0xf000)===0xa000))fail('压缩包含链接，请重新打包。');
          if((dir&&size)||(method===0&&size!==packed))fail();
          expanded+=size;if(expanded>LIMITS.expandedBytes)fail('压缩包声明解压体积过大（最多 512 MiB）。');
          if(type===2){
            let raw;try{raw=utf8.decode(data.subarray(cursor,cursor+n));}catch{fail('RAR 文件名格式不受支持。');}
            add(out,unique,{raw,dir,size});
          }
          cursor=extraStart;
          while(cursor<end){
            const record=v(),stop=cursor+record;if(!record||stop>end)fail();
            const kind=v();if(cursor>stop)fail();
            if(kind===1)fail('暂不支持加密 RAR。');
            if(kind===5)fail('压缩包含链接或重定向，请重新打包。');
            cursor=stop;
          }
        }else if(type===5){
          if(!main||packed||end!==data.length||v()&1)fail();ended=true;
        }else fail();
        p=end+packed;
      }
      if(!ended||p!==data.length)fail();
      return checkDirectory(out);
    }
    async function zipPayload(e){
      const packed=data.subarray(e.dataStart,e.stop);let output;
      if(e.method===0)output=packed.slice();
      else{
        let decoder;try{decoder=new DecompressionStream('deflate-raw');}catch{fail('当前浏览器不支持本机 ZIP 解压，请用新版 Chrome 或 Edge。');}
        const stream=new Blob([packed]).stream().pipeThrough(decoder),reader=stream.getReader();
        output=new Uint8Array(e.size);let n=0;
        try{for(;;){const r=await reader.read();if(r.done)break;if(r.value.length+n>output.length){await reader.cancel();fail('ZIP 实际解压体积与清单不一致。');}output.set(r.value,n);n+=r.value.length;}}finally{reader.releaseLock();}
        if(n!==output.length)fail('ZIP 实际解压体积与清单不一致。');
      }
      if(output.length!==e.size||crc(output)!==e.checksum)fail('ZIP 文件内容校验失败。');
      return output;
    }
    async function picked(names){
      const out=[];let total=0;
      if(!Array.isArray(names)||names.length>LIMITS.readCount||new Set(names).size!==names.length)fail('文件选择无效。');
      for(const n of names){
        const f=directory.get(n);
        if(!f)fail('所选文件不在压缩包清单内。');
        if(f.size>LIMITS.entryBytes||(total+=f.size)>LIMITS.readBytes)fail('选中文件超出解压限制（单个 32 MiB，合计 64 MiB）。');
      }
      if(!names.length)return out;
      if(format==='zip'){for(const n of names)out.push([n,await zipPayload(directory.get(n))]);return out;}
      const remaining=new Set(names),extractor=await __hengduUnrar(data.buffer),rawNames=[];
      const list=extractor.getFileList();
      if(list.arcHeader.flags.headerEncrypted||list.arcHeader.flags.volume)fail();
      // Compare the decoder's listing to our independently parsed names and sizes
      // before allowing any decoder output. Use its exact raw name for selection.
      const seen=new Set();
      for(const item of list.fileHeaders){
        if(item.flags.encrypted)fail('暂不支持加密 RAR。');
        if(item.flags.directory)continue;
        const n=pathName(item.name,false),expected=directory.get(n);
        if(!expected||seen.has(n)||item.unpSize!==expected.size)fail('RAR 文件清单不一致。');
        seen.add(n);if(remaining.has(n))rawNames.push(item.name);
      }
      if(seen.size!==directory.size||rawNames.length!==names.length)fail('RAR 文件清单不一致。');
      for(const item of extractor.extract({files:rawNames}).files){
        const n=pathName(item.fileHeader.name,false);
        if(!remaining.delete(n)||!(item.extraction instanceof Uint8Array)||item.extraction.length!==directory.get(n).size)fail('RAR 文件内容校验失败。');
        out.push([n,item.extraction]);
      }
      if(remaining.size)fail('RAR 缺少已选择的文件。');
      return out;
    }
    self.onmessage=async ({data:message})=>{
      const {id,op}=message;
      try{
        let value,transfer;
        if(op==='open'){
          const file=message.file;
          if(!(file instanceof Blob)||!file.size||file.size>LIMITS.inputBytes)fail('只接受不超过 160 MiB 的资料压缩包。');
          data=new Uint8Array(await file.arrayBuffer());view=new DataView(data.buffer);
          if(data.length>=8&&[82,97,114,33,26,7,1,0].every((x,i)=>data[i]===x)){format='rar';directory=parseRar();}
          else if(data.length>=4&&u32(0)===0x04034b50){format='zip';directory=parseZip();}
          else if(data.length>=7&&[82,97,114,33,26,7,0].every((x,i)=>data[i]===x))fail('旧版 RAR 4 暂不支持，请转换为 ZIP。');
          else fail('请选择完整的 RAR 5 或 ZIP 文件。');
          value={format,entries:[...directory.values()].map(({name,size})=>({name,size}))};
        }else if(op==='read'&&directory){value=await picked(message.names);transfer=value.map(e=>e[1].buffer);}
        else fail();
        self.postMessage({id,ok:true,value},transfer||[]);
      }catch(e){
        // Do not leak SDK error text: it may include a private file name or path.
        const m=e instanceof ArchiveReadError?e.message:'未能读取压缩包：文件损坏、格式不兼容或超出浏览器资源限制。';
        self.postMessage({id,ok:false,message:m});
      }
    };
  }
  async function open(file,{signal,entryLimit=512}={}){
    if(!(file instanceof Blob)||!file.size||file.size>LIMITS.inputBytes)throw Error('请选择不超过 160 MiB 的 RAR 或 ZIP 文件。');
    if(typeof root.Worker!=='function'||typeof root.URL?.createObjectURL!=='function'||typeof root.BidderArchiveWorkerVendor!=='string')throw Error('本机解压组件未加载，请刷新或使用新版 Chrome / Edge。');
    if(signal?.aborted)throw Error('已取消读取压缩包。');
    if(![512,2048].includes(entryLimit))throw Error('压缩包条目上限无效。');
    const code='const LIMITS='+JSON.stringify({...LIMITS,entries:entryLimit})+';\n'+root.BidderArchiveWorkerVendor+'\n;('+archiveWorker.toString()+')();';
    const url=root.URL.createObjectURL(new Blob([code],{type:'text/javascript'}));let worker,pending=null,closed=false,seq=0;
    function close(message='压缩包读取已关闭。'){
      if(closed)return;closed=true;signal?.removeEventListener('abort',abort);
      if(pending){clearTimeout(pending.timer);pending.reject(Error(message));pending=null;}
      worker?.terminate();root.URL.revokeObjectURL(url);
    }
    const abort=()=>close('已取消读取压缩包。');
    try{worker=new root.Worker(url);}catch{close();throw Error('无法启动本机解压，请使用新版 Chrome 或 Edge 打开完整页面。');}
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=(e)=>{e.preventDefault();close('本机解压组件未能启动，请使用新版 Chrome 或 Edge。');};
    worker.onmessageerror=()=>close('压缩包读取消息无效。');
    worker.onmessage=({data:m})=>{
      if(!pending||m?.id!==pending.id)return;
      const p=pending;pending=null;clearTimeout(p.timer);
      if(m.ok)p.resolve(m.value);else{close();p.reject(Error(m.message));}
    };
    function ask(op,fields){
      if(closed)return Promise.reject(Error('压缩包读取已关闭。'));
      if(pending)return Promise.reject(Error('压缩包仍在读取，请稍候。'));
      return new Promise((resolve,reject)=>{
        const id=++seq,timer=setTimeout(()=>close('压缩包读取超时，已停止。请缩小资料包或逐个上传。'),LIMITS.timeMs);
        pending={id,timer,resolve,reject};
        try{worker.postMessage({id,op,...fields});}catch{close('无法读取所选压缩包。');}
      });
    }
    try{
      const result=await ask('open',{file}),entries=Object.freeze(result.entries.map(e=>Object.freeze(e)));
      return Object.freeze({format:result.format,entries,close,async read(names){
        if(!Array.isArray(names)||names.length>LIMITS.readCount||names.some(n=>typeof n!=='string')||new Set(names).size!==names.length)throw Error('压缩包文件选择无效。');
        const lookup=new Map(entries.map(e=>[e.name,e.size]));let total=0;
        for(const n of names){if(!lookup.has(n))throw Error('所选文件不在压缩包清单内。');
          if(lookup.get(n)>LIMITS.entryBytes||(total+=lookup.get(n))>LIMITS.readBytes)throw Error('选中文件超出解压限制（单个 32 MiB，合计 64 MiB）。');}
        return new Map(await ask('read',{names:[...names]}));
      }});
    }catch(e){close();throw e;}
  }
  root.BidderArchive=Object.freeze({open,LIMITS});
})(globalThis);

