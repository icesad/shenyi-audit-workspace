'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {MAX_FILE_BYTES,ClientError} = require('./team-client.cjs');
const APP_URL = 'shenyi://app/index.html';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function input(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key=>!keys.includes(key))) throw Error('操作参数无效。');
  for (const key of ['teamId','taskId','attachmentId']) if (keys.includes(key) && (typeof value[key]!=='string'||!ID.test(value[key]))) throw Error('任务标识无效。');
  return value;
}
async function readChosenFile(filename) {
  const handle = await fs.open(filename,'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size>MAX_FILE_BYTES) throw Error('请选择不超过12 MiB的文件。');
    const chunks=[]; let size=0;
    for (;;) { const buffer=Buffer.alloc(Math.min(65536,MAX_FILE_BYTES-size+1));const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>MAX_FILE_BYTES)throw Error('资料超过12 MiB。');chunks.push(buffer.subarray(0,bytesRead)); }
    return {filename:path.basename(filename),bytes:Buffer.concat(chunks)};
  } finally { await handle.close(); }
}
function safeDownloadName(disposition) {
  let value='采集资料.bin';
  const match=/filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if(match)try{value=decodeURIComponent(match[1]);}catch{}
  return Array.from(path.basename(value).toWellFormed().replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_')).slice(0,160).join('')||'采集资料.bin';
}
function registerDesktopBridge({ipcMain,window,client,dialog}) {
  const channels=[];
  const safeError=error=>({ok:false,error:{code:error instanceof ClientError?error.code:'OPERATION_FAILED',message:error instanceof ClientError?error.message:'操作未完成，请刷新后重试。'}});
  function handle(name, action) {
    const channel='shenyi:'+name;channels.push(channel);
    ipcMain.handle(channel,async(event,arg)=>{
      if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==APP_URL)return {ok:false,error:{code:'UNTRUSTED_SENDER',message:'此页面不能访问桌面操作。'}};
      try{return {ok:true,value:await action(arg)};}catch(error){return safeError(error);}
    });
  }
  handle('login',arg=>client.login(input(arg,['username','password'])));
  handle('session',()=>client.getSession());
  handle('logout',()=>client.logout());
  handle('tasks',arg=>client.listTasks(input(arg,['teamId','q','after','limit'])));
  handle('task',arg=>client.getTask(input(arg,['teamId','taskId'])));
  handle('submissions',arg=>client.getSubmissions(input(arg,['teamId','taskId'])));
  handle('upload',async arg=>{
    input(arg,['teamId','taskId','revision']);
    if(!Number.isSafeInteger(arg.revision)||arg.revision<0)throw Error('资料版本无效。');
    const assertSession=client.guardSession();
    // Authorize before opening a native dialog; re-check server scope on upload.
    await client.getTask({teamId:arg.teamId,taskId:arg.taskId});
    const selected=await dialog.showOpenDialog(window,{title:'选择采集资料（合成演示）',properties:['openFile'],buttonLabel:'选择资料'});
    if(selected.canceled||selected.filePaths.length!==1)return {canceled:true};
    const file=await readChosenFile(selected.filePaths[0]);
    assertSession();
    return client.upload(arg,file);
  });
  handle('download',async arg=>{
    input(arg,['teamId','taskId','attachmentId']);
    const assertSession=client.guardSession();
    const file=await client.download(arg);
    const selected=await dialog.showSaveDialog(window,{title:'保存采集资料副本',defaultPath:safeDownloadName(file.contentDisposition),buttonLabel:'保存副本'});
    if(selected.canceled||!selected.filePath)return {canceled:true};
    assertSession();
    // The operating-system dialog owns path selection/overwrite confirmation.
    await fs.writeFile(selected.filePath,file.bytes);
    return {saved:true,filename:path.basename(selected.filePath),byteLength:file.bytes.length};
  });
  return ()=>{for(const channel of channels)ipcMain.removeHandler(channel);client.clearSession();};
}
module.exports={APP_URL,registerDesktopBridge,readChosenFile,safeDownloadName};
