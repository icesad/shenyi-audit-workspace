/* Direct, read-only downloads from the selected project's saved files. */
(function(root){
  'use strict';
  const stale=()=>Error('项目资料已更新，请重新下载。');
  function stageFiles(workspace,stage){
    const files=workspace.auditWorkflow?.files?.[stage]||[];
    if(!Array.isArray(files))throw Error('本项目的文件清单无法读取。');
    return files;
  }
  async function checkFile(file,{checkHash=true}={}){
    if(!file||typeof file.name!=='string'||!file.name.trim()||/[\\/\u0000-\u001f\u007f]/u.test(file.name)||
       !(file.blob instanceof root.Blob)||file.blob.size!==file.size||file.size<1||
       !/^[a-f0-9]{64}$/u.test(file.sha256||''))
      throw Error('项目文件格式或大小有误，请核对原件。');
    if(checkHash&&await root.ProjectWorkspaceStore.hash(file.blob)!==file.sha256)
      throw Error('文件完整性校验失败，请核对原件：'+file.name);
  }
  function memberPath(archive,file,seen){
    const dot=file.name.lastIndexOf('.'),suffix=dot>0?file.name.slice(dot):'';
    let name=file.name;
    try{archive.zipPath(file.folder+name);}
    catch{
      const extension=/^\.[A-Za-z0-9]{1,16}$/u.test(suffix)?suffix:'';
      name=archive.safeName(extension?file.name.slice(0,dot):file.name)+extension;
    }
    const ext=name.lastIndexOf('.'),extension=ext>0?name.slice(ext):'',stem=ext>0?name.slice(0,ext):name;
    let path=file.folder+name,serial=1;
    const key=value=>value.normalize('NFKC').toLowerCase();
    while(seen.has(key(path)))path=file.folder+stem+' ('+(++serial)+')'+extension;
    seen.add(key(path));
    return path;
  }
  async function publish(files,label,assertFresh){
    if(!files.length)throw Error('本项目尚未保存'+label+'。');
    const [first]=files;
    let name=first.name,blob=first.blob;
    if(files.length>1){
      const archive=root.AuditArchive;
      if(!archive?.zipStore)throw Error('压缩组件尚未加载，请刷新后重试。');
      if(files.length>archive.MAX_ENTRIES||files.reduce((total,file)=>total+file.size,0)>archive.MAX_BYTES)
        throw Error('本项目'+label+'超过一次打包上限，请在资料页面分批下载。');
      const seen=new Set(),members=[];
      for(const file of files){
        members.push({path:memberPath(archive,file,seen),bytes:new Uint8Array(await file.blob.arrayBuffer())});
      }
      blob=new root.Blob([archive.zipStore(members)],{type:'application/zip'});
      name=label+'.zip';
    }
    await assertFresh();
    root.ProjectWorkspaceStore.download(blob,name);
    return name;
  }
  async function originalMaterials(projectId,workspace,assertFresh){
    const checklist=root.AuditChecklist,archive=root.AuditArchive;
    if(!checklist?.open||!archive?.currentAttachments)throw Error('资料读取组件尚未加载，请刷新后重试。');
    const db=await checklist.open();
    try{
      const record=await db.get(projectId);
      if(record&&record.project?.quoteId!==projectId)throw Error('资料清单与所在项目不一致。');
      const files=[],seen=new Set();
      const add=file=>{
        const key=file.name+'\n'+file.sha256;
        if(!seen.has(key)){seen.add(key);files.push(file);}
      };
      for(const file of stageFiles(workspace,'client')){
        await checkFile(file);
        add({...file,folder:'客户资料/'});
      }
      for(const {nodeId,fileId,generationId,file} of archive.currentAttachments(record)){
        const got=await db.downloadAttachment(projectId,nodeId,fileId);
        const metadata=got.metadata;
        if(metadata.id!==fileId||metadata.nodeId!==nodeId||metadata.generationId!==generationId||
           metadata.name!==file.name||metadata.sha256!==file.sha256||metadata.size!==file.size)throw stale();
        const entry={...metadata,blob:got.blob,folder:'资料清单/'};
        await checkFile(entry,{checkHash:false});
        add(entry);
      }
      return await publish(files,'原始资料',async()=>{
        const latest=await db.get(projectId);
        if(latest?.revision!==record?.revision||latest?.generationId!==record?.generationId)throw stale();
        await assertFresh();
      });
    }finally{db.close();}
  }
  async function download(projectId,kind,assertContext=()=>{}){
    assertContext();
    const store=root.ProjectWorkspaceStore,workspace=await store.get(projectId);
    if(workspace.id!==projectId||projectId===root.AuditChecklist?.TRIAL_ID)throw Error('请选择有效的正式项目。');
    async function assertFresh(){
      const latest=await store.get(projectId);
      if(latest.id!==projectId||latest.rev!==workspace.rev)throw stale();
      assertContext();
    }
    if(kind==='contract'){
      if(!workspace.signedContract)throw Error('本项目尚未上传合同盖章版。');
      const {blob,name}=workspace.signedContract;
      await store.validateSignedContract(workspace.signedContract);
      await assertFresh();
      store.download(blob,name);
      return name;
    }
    if(kind==='materials')return originalMaterials(projectId,workspace,assertFresh);
    if(kind==='finalReport'||kind==='report'){
      const final=stageFiles(workspace,'finalReport');
      if(final.length){
        const [file]=final;
        if(final.length!==1||file?.type!=='application/pdf'||!/\.pdf$/iu.test(file.name||''))
          throw Error('本项目最终报告资料格式无效。');
        await checkFile(file);
        return publish(final,'最终版全套报告 PDF',assertFresh);
      }
      const tables=stageFiles(workspace,'signedTables');
      if(tables.length===1&&workspace.reportDraft){
        await checkFile(tables[0]);
        await assertFresh();
        return root.ReportWorkspace.downloadReportWithTables(projectId,tables[0],assertFresh);
      }
      if(kind==='finalReport')throw Error(!tables.length?'请先上传本项目的审定表盖章版 PDF。':'请先在报告编制中保存本项目的报告正文。');
    }
    if(kind!=='report'&&kind!=='workpapers')throw Error('项目文件类型无效。');
    const stage=kind==='report'?'report':'export',label=kind==='report'?'报告':'底稿';
    const uploaded=stageFiles(workspace,stage);
    if(uploaded.length){
      for(const file of uploaded)await checkFile(file);
      return publish(uploaded.map(file=>({...file,folder:''})),label,assertFresh);
    }
    if(kind==='report'){
      if(!root.ReportWorkspace?.downloadSavedDraft)throw Error('报告下载组件尚未加载，请刷新后重试。');
      return root.ReportWorkspace.downloadSavedDraft(projectId,assertContext);
    }
    if(!root.WorkpaperPackageExport?.download||!root.WorkpaperPackage?.hasCompiledWorkpapers)
      throw Error('底稿下载组件尚未加载，请刷新后重试。');
    if(!root.WorkpaperPackage.hasCompiledWorkpapers(workspace)&&!Object.keys(workspace.workpaperLocks||{}).length)
      throw Error('本项目尚未上传已编制底稿或保存可导出的底稿填写。');
    return root.WorkpaperPackageExport.download(projectId,{assertContext});
  }
  root.ProjectDownloads=Object.freeze({download});
})(globalThis);
