/* Local bidder address book: metadata and per-firm files commit together.
 * Signing images are separate from quote credentials. Storage does not authorize their use.
 * A draft financial snapshot is not a firm identity. No synchronization or access control. */
(function(root){
  'use strict';
  const DATABASE='hengdu.quote.bidders.v1', STORE='firms', FILES='firmCredentials';
  const KINDS=Object.freeze(['business_license','practice_certificate']);
  const SIGNING_KINDS=Object.freeze(['company_seal','legal_representative_seal','bidder_signature']);
  const FILE_KINDS=Object.freeze([...KINDS,...SIGNING_KINDS]), MAX_FIRMS=100;
  const MAX_MATERIALS=200, MAX_MATERIAL_BYTES=160*1024*1024;
  const FILE_FIELDS=['kind','name','mime','size','sha256','bytes'];
  const IMAGE_MIME=['image/png','image/jpeg'];
  const codes={invalid:'投标方资料格式不正确。',missing:'此投标方已不存在，请重新选择。',conflict:'投标方资料已变更，请重读后再修改。',schema:'不支持当前投标方资料库结构，不会自动重置。',closed:'本机投标方资料库不可用。',limit:'本机投标方资料库容量已满。',storage:'本机保存失败，原有资料未更改。'};
  function err(code){return Object.assign(new Error(codes[code]),{code:'BIDDER_'+code.toUpperCase()});}
  function assert(ok,code='invalid'){if(!ok)throw err(code);}
  function safeText(value,max){
    assert(typeof value==='string'&&value.length<=2*max&&[...value].length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value));
    return value.trim();
  }
  function fields(value){
    assert(value&&typeof value==='object'&&['own','partner'].includes(value.kind));
    const out={kind:value.kind}; for(const [key,max] of Object.entries({name:150,team:64,contactName:100,phone:80,email:120})){
      out[key]=safeText(value[key]??'',max);
    }
    assert(out.name);
    if(out.team)assert(['广西','河北','上海'].includes(out.team)||root.RuleCatalog?.PROVINCES?.some(p=>p.name===out.team));
    return out;
  }
  const idOK=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
  function validateKinds(value,kinds){
    assert(Array.isArray(value)&&value.length<=kinds.length&&new Set(value).size===value.length&&value.every(k=>kinds.includes(k)),'schema');
    return [...value];
  }
  function summary(row){
    assert(row&&idOK(row.id)&&Number.isSafeInteger(row.version)&&row.version>0,'schema');
    const credentialKinds=validateKinds(row.credentialKinds,KINDS);
    const signingKinds=Object.hasOwn(row,'signingKinds')?validateKinds(row.signingKinds,SIGNING_KINDS):[];
    const materialCount=row.materialCount??0;
    assert(Number.isSafeInteger(materialCount)&&materialCount>=0&&materialCount<=MAX_MATERIALS,'schema');
    return {id:row.id,version:row.version,...fields(row),credentialKinds,...(signingKinds.length?{signingKinds}:{}),...(materialCount?{materialCount}:{})};
  }
  function originals(value){
    assert(Array.isArray(value)&&value.length<=MAX_MATERIALS,'limit');
    let total=0;
    return value.map(item=>{
      const name=safeText(item?.name,255),blob=item.blob;
      assert(name&&!/[\\/]/.test(name)&&blob instanceof root.Blob);
      total+=blob.size;
      assert(total<=MAX_MATERIAL_BYTES,'limit');
      return {name,blob};
    });
  }
  function imageMime(mime){if(!IMAGE_MIME.includes(mime))throw Error('公章、法人章和签字仅支持 PNG 或 JPEG 图片。');}
  function jpegEnd(bytes){
    if(bytes.length<16||bytes[0]!==255||bytes[1]!==216)return 0;
    let at=2,scan=false,sawScan=false;
    while(at<bytes.length){
      if(scan){
        at=bytes.indexOf(255,at);if(at===-1)return 0;
        let p=at+1;while(bytes[p]===255)p++;
        if(bytes[p]===0||(bytes[p]>=208&&bytes[p]<=215)){at=p+1;continue;}
        scan=false;
      }
      if(bytes[at++]!==255)return 0;
      while(bytes[at]===255)at++;
      const mark=bytes[at++];
      if(mark===217)return sawScan?at:0;
      if(mark===0||mark===216||mark===undefined)return 0;
      if(mark===1||(mark>=208&&mark<=215))continue;
      if(at+2>bytes.length)return 0;
      const len=bytes[at]*256+bytes[at+1];
      if(len<2||at+len>bytes.length)return 0;
      // Skip sized segments, including EXIF thumbnails, instead of searching
      // for a byte pattern that might occur before the image's true end.
      at+=len;if(mark===218){scan=true;sawScan=true;}
    }
    return 0;
  }
  async function signingJpeg(file){
    const reader=root.QuotePacket,validationKind=KINDS[0];
    let a,failure;
    try{a=await reader.readAttachment(file,validationKind);}catch(error){failure=error;}
    if(!a&&(!Number.isSafeInteger(file.size)||file.size<16||file.size>reader.MAX_ATTACHMENT_BYTES))throw failure;
    const bytes=a?.bytes||new Uint8Array(await file.arrayBuffer());
    if(bytes.length!==file.size)throw failure||err('invalid');
    const end=jpegEnd(bytes);
    if(a&&end===bytes.length)return a;
    if(!end||end>=bytes.length||bytes.length-end>256)throw failure||Error('JPEG结束标记无效或尾部数据过长。');
    // Signing images only: retain the original JPEG stream, but drop a small
    // out-of-stream trailer. The original file and quoted credentials are unchanged.
    const clean=new root.File([bytes.subarray(0,end)],file.name,{type:file.type});
    return reader.readAttachment(clean,validationKind);
  }
  async function readProfileFile(file,kind){
    assert(FILE_KINDS.includes(kind));
    assert(root.QuotePacket?.readAttachment,'closed');
    if(KINDS.includes(kind))return root.QuotePacket.readAttachment(file,kind);
    imageMime(file?.type);
    // Reuse the bounded PNG/JPEG and SHA-256 checks. The synthetic validation
    // kind stays internal, so a stored signing image cannot be a quote certificate.
    const a=file.type==='image/jpeg'?await signingJpeg(file):await root.QuotePacket.readAttachment(file,KINDS[0]);
    return Object.freeze({...a,kind});
  }
  function fileShape(input){
    assert(input&&typeof input==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(input)));
    const ds=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(ds);
    assert(keys.length===FILE_FIELDS.length&&FILE_FIELDS.every(k=>ds[k]?.enumerable&&Object.hasOwn(ds[k],'value')));
    return Object.fromEntries(FILE_FIELDS.map(k=>[k,ds[k].value]));
  }
  async function verify(files,kinds=FILE_KINDS){
    assert(Array.isArray(files)&&files.length<=kinds.length);
    const ds=Object.getOwnPropertyDescriptors(files);
    assert(Reflect.ownKeys(ds).length===files.length+1);
    const items=Array.from({length:files.length},(_,i)=>{
      assert(ds[i]?.enumerable&&Object.hasOwn(ds[i],'value'));
      return fileShape(ds[i].value);
    });
    assert(new Set(items.map(f=>f.kind)).size===items.length&&items.every(f=>kinds.includes(f.kind)));
    if(!items.length)return [];
    assert(root.QuotePacket?.verifyAttachment,'closed');
    return (await Promise.all(items.map(async f=>{
      if(KINDS.includes(f.kind))return root.QuotePacket.verifyAttachment(f);
      imageMime(f.mime);
      const checked=await root.QuotePacket.verifyAttachment({...f,kind:KINDS[0]});
      if(checked.mime==='image/jpeg'&&jpegEnd(checked.bytes)!==checked.size)throw Error('签章 JPEG 包含不规范的结束标记或尾部数据。');
      return Object.freeze({...checked,kind:f.kind});
    }))).sort((a,b)=>FILE_KINDS.indexOf(a.kind)-FILE_KINDS.indexOf(b.kind));
  }
  function projectFiles(attachments,signingAssets){return {attachments,...(signingAssets.length?{signingAssets}:{})};}
  function storeLayout(db,tx){
    assert(db.objectStoreNames.length===2,'schema');
    for(const n of [STORE,FILES]){
      const s=tx.objectStore(n);assert(s.keyPath==='id'&&!s.autoIncrement&&!s.indexNames.length,'schema');
    }
  }
  function access(db,stores,mode,body){
    return new Promise((resolve,reject)=>{
      let tx,answer,reason;try{tx=db.transaction(stores,mode);}catch{reject(err('closed'));return;}
      tx.oncomplete=()=>resolve(answer);tx.onabort=()=>reject(reason||err(tx.error?.name==='QuotaExceededError'?'limit':'storage'));tx.onerror=()=>{};
      const trap=fn=>(...args)=>{try{fn(...args);}catch(e){reason=e;try{tx.abort();}catch{reject(e);}}};
      trap(body)(tx,v=>{answer=v;},(request,fn)=>{request.onsuccess=trap(()=>fn(request.result));});
    });
  }
  async function open(){
    assert(root.indexedDB&&root.crypto?.randomUUID,'closed');
    const db=await new Promise((resolve,reject)=>{
      let r,settled=false;const no=code=>{settled=true;reject(err(code));};
      try{r=root.indexedDB.open(DATABASE,3);}catch{no('closed');return;}
      r.onblocked=()=>no('closed');r.onerror=()=>no(r.error?.name==='VersionError'?'schema':'closed');
      r.onupgradeneeded=e=>{
        try{
          assert(!settled&&[0,1,2].includes(e.oldVersion),'schema');
          // Older versions could overwrite fields added to the existing stores.
          if(e.oldVersion===0)for(const n of [STORE,FILES])r.result.createObjectStore(n,{keyPath:'id'});
          storeLayout(r.result,r.transaction);
        }catch{r.transaction.abort();no('schema');}
      };
      r.onsuccess=()=>{
        const db=r.result;if(settled){db.close();return;}
        try{storeLayout(db,db.transaction([STORE,FILES],'readonly'));
          settled=true;resolve(db);
        }catch{db.close();no('schema');}
      };
    });
    db.onversionchange=()=>db.close();
    const canWrite=(row,version)=>{assert(row,'missing');const old=summary(row);assert(old.version===version,'conflict');assert(version<Number.MAX_SAFE_INTEGER);return old;};
    async function get(id){
      assert(idOK(id));const [row,blob]=await access(db,[STORE,FILES],'readonly',(tx,done,read)=>{
        const results=[];done(results);read(tx.objectStore(STORE).get(id),v=>{results[0]=v;});read(tx.objectStore(FILES).get(id),v=>{results[1]=v;});
      });assert(row,'missing');const out=summary(row);assert(blob&&blob.id===id&&row.version===blob.version,'schema');
      const [attachments,signingAssets]=await Promise.all([
        verify(blob.attachments,KINDS),verify(Object.hasOwn(blob,'signingAssets')?blob.signingAssets:[],SIGNING_KINDS)
      ]);
      assert(JSON.stringify(attachments.map(f=>f.kind))===JSON.stringify(out.credentialKinds)&&
        JSON.stringify(signingAssets.map(f=>f.kind))===JSON.stringify(out.signingKinds||[]),'schema');
      const materials=originals(blob.materials??[]);
      assert(materials.length===(out.materialCount??0),'schema');
      return {...out,...projectFiles(attachments,signingAssets),...(materials.length?{materials}:{})};
    }
    async function write(id,version,data,incoming,creating,sourceFiles){
      const f=fields(data);assert(idOK(id));if(!creating)assert(Number.isSafeInteger(version)&&version>0);
      const prior=incoming===undefined?await get(id):null;
      const files=prior?[...prior.attachments,...(prior.signingAssets||[])]:await verify(incoming);
      const newMaterials=sourceFiles===undefined?null:originals(sourceFiles);
      const attachments=files.filter(a=>KINDS.includes(a.kind)),signingAssets=files.filter(a=>SIGNING_KINDS.includes(a.kind));
      const result=await access(db,[STORE,FILES],'readwrite',(tx,done,read)=>{
        const s=tx.objectStore(STORE),blobs=tx.objectStore(FILES);
        function put(materials){
          const next={id,version:version+1,...f,credentialKinds:attachments.map(a=>a.kind),
            ...(signingAssets.length?{signingKinds:signingAssets.map(a=>a.kind)}:{}),...(materials.length?{materialCount:materials.length}:{})};
          const material={...projectFiles(attachments,signingAssets),...(materials.length?{materials}:{})};
          s.put(next);blobs.put({id,version:next.version,...material});done({...next,...material});
        }
        if(creating){
          read(s.count(),n=>{assert(n<MAX_FIRMS,'limit');read(s.get(id),existing=>{assert(!existing,'conflict');put(newMaterials||[]);});});return;
        }
        read(s.get(id),row=>{
          const old=canWrite(row,version);
          if(newMaterials||!old.materialCount){put(newMaterials||[]);return;}
          read(blobs.get(id),entry=>{
            assert(entry?.version===row.version,'schema');
            const materials=originals(entry.materials);
            assert(materials.length===old.materialCount,'schema');
            put(materials);
          });
        });
      });return result;
    }
    return Object.freeze({
      list(){return access(db,[STORE],'readonly',(tx,done,read)=>read(tx.objectStore(STORE).getAll(undefined,MAX_FIRMS+1),rows=>{assert(rows.length<=MAX_FIRMS,'limit');done(rows.map(summary).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id)));}));},
      get,
      create(value,files=[],materials=[]){return write(root.crypto.randomUUID(),0,value,files,true,materials);},
      update(id,expectedVersion,value,files,materials){return write(id,expectedVersion,value,files,false,materials);},
      async remove(id,expectedVersion){assert(idOK(id));await access(db,[STORE,FILES],'readwrite',(tx,done,read)=>{const s=tx.objectStore(STORE);read(s.get(id),row=>{canWrite(row,expectedVersion);s.delete(id);tx.objectStore(FILES).delete(id);done(true);});});},
      close(){db.close();}
    });
  }
  root.BidderLibrary=Object.freeze({open,DATABASE,SIGNING_KINDS,readProfileFile,validateMaterials:originals});
})(globalThis);
