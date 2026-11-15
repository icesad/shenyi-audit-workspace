'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Each exposed method maps to one allowlisted action. No token, path or raw IPC.
const invoke=(name,arg)=>ipcRenderer.invoke('shenyi:'+name,arg);
contextBridge.exposeInMainWorld('shenyiTeam',Object.freeze({
  login:credentials=>invoke('login',credentials),
  getAuthMethods:()=>invoke('auth-methods'),
  getOnboardingStatus:()=>invoke('onboarding-status'),
  getInvitationAccess:team=>invoke('invitation-access',team),
  createEmployeeInvitation:invite=>invoke('invitation-create',invite),
  listEmployeeInvitations:team=>invoke('invitation-list',team),
  revokeEmployeeInvitation:invite=>invoke('invitation-revoke',invite),
  previewEmployeeInvitation:invite=>invoke('activation-preview',invite),
  requestEmployeeActivation:invite=>invoke('activation-challenge',invite),
  activateEmployee:proof=>invoke('activation-complete',proof),
  loginPhone:credentials=>invoke('phone-login',credentials),
  requestPhoneBind:phone=>invoke('phone-challenge',phone),
  bindPhone:proof=>invoke('phone-bind',proof),
  startWechatLogin:()=>invoke('wechat-start'),
  pollWechatLogin:()=>invoke('wechat-poll'),
  cancelWechatLogin:()=>invoke('wechat-cancel'),
  linkWechatAccount:proof=>invoke('wechat-link',proof),
  getSession:()=>invoke('session'),
  logout:()=>invoke('logout'),
  listTasks:query=>invoke('tasks',query),
  getTask:task=>invoke('task',task),
  getSubmissions:task=>invoke('submissions',task),
  chooseAndUpload:task=>invoke('upload',task),
  downloadAttachment:attachment=>invoke('download',attachment),
}));
