'use strict';
// Main chooses a per-machine location; never derive this from roaming userData.
const path=require('node:path'),os=require('node:os');
function unavailable(){const error=new Error('无法确认本机设备密钥目录，请联系管理员检查系统配置。');error.code='DEVICE_DIRECTORY_UNAVAILABLE';throw error;}
function resolveDeviceVaultDirectory({platform=process.platform,localAppData=process.env.LOCALAPPDATA,home=os.homedir()}={}){
  if(platform==='win32'){
    if(typeof localAppData!=='string'||!localAppData||/[\x00-\x1f\x7f]/.test(localAppData)||!localAppData.isWellFormed())unavailable();
    const base=localAppData.replaceAll('/','\\');
    if(!/^[A-Za-z]:\\/.test(base)||base.split('\\').some(part=>part==='.'||part==='..')||base.startsWith('\\'))unavailable();
    return path.win32.join(base,'ShenyiTeamPreview','device-vault');
  }
  if(platform==='darwin'){
    if(typeof home!=='string'||!home.isWellFormed()||!home.startsWith('/')||home.startsWith('//')||/[\x00-\x1f\x7f]/.test(home)||home.split('/').some(part=>part==='.'||part==='..'))unavailable();
    return path.posix.join(home,'Library','Application Support','ShenyiTeamPreview','device-vault');
  }
  unavailable();
}
module.exports={resolveDeviceVaultDirectory};
