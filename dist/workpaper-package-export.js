/* Explicit read-only export of saved local workpapers; never auto-migrate. */
(function(root){'use strict';
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
 const missing=()=>Error('未找到本项目已有的正式立项、固定编号或已保存底稿；未新建或上传资料。');
 const changed=()=>Error('项目或已保存底稿在导出期间已改变，请刷新核对；未下载旧底稿包。');
  function readExisting(name, storeName, keyPath, key) {
    return new Promise((resolve, reject) => {
      let request, completed = false, absent = false;
      function finish(error, value) {
        if (completed) return;
        completed = true;
        error ? reject(error) : resolve(value);
      }
      try { request = root.indexedDB.open(name); } catch { finish(missing()); return; }
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onblocked = () => finish(Error('本机资料库正被其他窗口占用，请关闭旧窗口后重试。'));
      request.onerror = event => { event.preventDefault(); finish(absent ? null : missing(), null); };
      request.onsuccess = () => {
        const db = request.result;
        if (completed) { db.close(); return; }
        db.onversionchange = () => db.close();
        try {
          if (db.version !== 1 || db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains(storeName)) throw missing();
          const transaction = db.transaction(storeName, 'readonly'), store = transaction.objectStore(storeName);
          if (store.keyPath !== keyPath || store.autoIncrement) { transaction.abort(); throw missing(); }
          const read = store.get(key);
          transaction.oncomplete = () => { db.close(); finish(null, read.result ?? null); };
          transaction.onabort = () => { db.close(); finish(missing()); };
        } catch (error) { db.close(); finish(error); }
      };
    });
  }

 async function load(projectId,assertContext){
  assertContext();if(projectId===root.WorkpaperPackage?.TRIAL_ID||typeof projectId!=='string'||!UUID.test(projectId)||!root.WorkpaperPackage||!root.ProjectWorkspaceStore?.getProjectNumber||!root.ProjectInitiation?.validateRecord||!root.indexedDB)throw missing();
  const results=await Promise.allSettled([readExisting('hengdu.project.workspace.v1','workspaces','id',projectId),readExisting('hengdu.quote.projects.v1','projects','quoteId',projectId),root.ProjectWorkspaceStore.getProjectNumber(projectId)]);assertContext();
  if(results.some(x=>x.status!=='fulfilled'))throw missing();const [workspace,quote,identity]=results.map(x=>x.value);
  if(!workspace||workspace.id!==projectId||!Number.isSafeInteger(workspace.rev)||workspace.rev<1||!quote||!identity||identity.projectId!==projectId)throw missing();
  const initiation=root.ProjectInitiation.validateRecord(quote);if(initiation.quoteId!==projectId)throw missing();
  if(workspace.projectIdentity!==undefined&&['schemaVersion','projectId','year','sequence','firstWonAt'].some(k=>workspace.projectIdentity?.[k]!==identity[k]))throw changed();
  const selected={};for(const k of root.WorkpaperPackage.FIELDS)if(Object.hasOwn(workspace,k))Object.defineProperty(selected,k,{value:workspace[k],enumerable:true});
  const proof=JSON.stringify({initiation,identity,projectIdentity:workspace.projectIdentity??null,workpapers:selected},(key,value)=>value instanceof root.Blob?{originalBlobMetadata:{size:value.size,type:value.type}}:value);
  return{workspace,proof};
 }
 async function build(projectId,{assertContext=()=>{}}={}){
  const original=await load(projectId,assertContext);
  const result=await root.WorkpaperPackage.create({record:original.workspace,assertCurrent:assertContext,readCurrent:async()=>{const fresh=await load(projectId,assertContext);if(fresh.proof!==original.proof)throw changed();return fresh.workspace;}});
  assertContext();const fresh=await load(projectId,assertContext);if(fresh.proof!==original.proof)throw changed();assertContext();return result;
 }
 async function download(projectId,{assertContext=()=>{}}={}){
  const original=await load(projectId,assertContext),result=await build(projectId,{assertContext});assertContext();const fresh=await load(projectId,assertContext);if(fresh.proof!==original.proof)throw changed();assertContext();
  // The last settled read is followed only by synchronous publication. Separate
  // local databases still do not constitute a globally serializable transaction.
  const url=root.URL.createObjectURL(result.blob);try{const anchor=root.document.createElement('a');anchor.href=url;anchor.download='审易-完整项目底稿包-'+projectId+'.zip';anchor.click();}finally{root.URL.revokeObjectURL(url);}
  return {...result.summary,byteLength:result.bytes.length,sha256:result.sha256};
 }
 root.WorkpaperPackageExport=Object.freeze({build,download});
})(globalThis);
