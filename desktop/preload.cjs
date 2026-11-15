'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Each exposed method maps to one allowlisted action. No token, path or raw IPC.
const invoke=(name,arg)=>ipcRenderer.invoke('shenyi:'+name,arg);
contextBridge.exposeInMainWorld('shenyiTeam',Object.freeze({
  login:credentials=>invoke('login',credentials),
  getSession:()=>invoke('session'),
  logout:()=>invoke('logout'),
  listTasks:query=>invoke('tasks',query),
  getTask:task=>invoke('task',task),
  getSubmissions:task=>invoke('submissions',task),
  chooseAndUpload:task=>invoke('upload',task),
  downloadAttachment:attachment=>invoke('download',attachment),
}));
