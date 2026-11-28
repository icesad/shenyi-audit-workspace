'use strict';

module.exports=async function readRetainedChecklistFile(page,projectId,fileId,trial=false){
  const bytes=await page.evaluate(async({projectId,fileId,trial})=>{
    const db=trial?await AuditChecklist.openTrial():await AuditChecklist.open();
    try{
      const record=await db.get(projectId);
      const upload=record.events.find(event=>event.type==='attachment-add'&&event.file.id===fileId);
      const retained=await db.downloadAttachment(projectId,upload.nodeId,fileId);
      return Array.from(new Uint8Array(await retained.blob.arrayBuffer()));
    }finally{db.close();}
  },{projectId,fileId,trial});
  return Buffer.from(bytes);
};
