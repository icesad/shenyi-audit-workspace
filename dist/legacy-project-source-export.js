/* Read-only export of one existing formal project's governance provenance. */
(function(root){'use strict';
 async function read(projectId,assertContext=()=>{}){
  assertContext();const ledger=await root.QuoteLedger.open();
  try{const [records,quotes,workspace,identity]=await Promise.all([root.ProjectInitiation.listSaved(),ledger.list(),root.ProjectWorkspaceStore.get(projectId),root.ProjectWorkspaceStore.getProjectNumber(projectId)]);assertContext();const initiation=records.find(r=>r.quoteId===projectId),currentQuote=quotes.find(q=>q.id===projectId);if(!initiation||!currentQuote||!identity)throw Error('缺少已存正式立项、报价或固定编号，未补造来源。');return root.LegacyProjectSource.create({initiation,currentQuote,identity,workspace});}finally{ledger.close();}
 }
 async function download(projectId,{assertContext=()=>{}}={}){
  const source=await read(projectId,assertContext),bytes=root.LegacyProjectSource.encode(source),checked=await root.LegacyProjectSource.inspect(bytes);assertContext();const fresh=root.LegacyProjectSource.encode(await read(projectId,assertContext));if(fresh.length!==bytes.length||bytes.some((b,i)=>b!==fresh[i]))throw Error('所选项目来源在导出期间已改变，请重新核对；未下载旧快照。');assertContext();
  const blob=new Blob([bytes],{type:'application/json'}),url=root.URL.createObjectURL(blob),a=root.document.createElement('a');try{a.href=url;a.download='审迹-旧项目归属审核来源-'+projectId+'.json';a.click();}finally{root.URL.revokeObjectURL(url);}return {sha256:checked.sha256,summary:checked.summary};
 }
 root.LegacyProjectSourceExport=Object.freeze({read,download});
})(globalThis);
