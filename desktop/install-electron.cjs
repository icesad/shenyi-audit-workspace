'use strict';
// Optional reproducible fallback for networks where the official Node downloader
// is slow. Downloads the same official artifact and verifies npm's pinned hashes.
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {createHash}=require('node:crypto');const {createReadStream}=require('node:fs');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
async function digest(filename){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
async function main(){
  const version=require('./node_modules/electron/package.json').version;
  if(version!==require('./package.json').devDependencies.electron)throw Error('Electron package does not match the pinned desktop version.');
  if(!['win32','darwin'].includes(process.platform)||!['x64','arm64'].includes(process.arch))throw Error('This preview installer only supports Windows/macOS x64/arm64.');
  const binary=process.platform==='win32'?'electron.exe':'Electron.app/Contents/MacOS/Electron';
  const packageRoot=path.join(__dirname,'node_modules/electron'),dist=path.join(packageRoot,'dist');
  try{const existing=(await fs.readFile(path.join(dist,'version'),'utf8')).trim().replace(/^v/,'');await fs.access(path.join(dist,binary));if(existing===version){await fs.writeFile(path.join(packageRoot,'path.txt'),binary);console.log(`Electron ${version} already installed.`);return;}}catch{}
  const name=`electron-v${version}-${process.platform}-${process.arch}.zip`;
  const expected=require('./node_modules/electron/checksums.json')[name];if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Pinned official artifact checksum unavailable.');
  const cache=process.env.ELECTRON_CACHE|| (process.platform==='win32'?'D:/codex-temp/electron-cache':path.join(os.tmpdir(),'shenyi-electron-cache'));
  await fs.mkdir(cache,{recursive:true});const archive=path.join(cache,name);
  let cached=false;try{cached=(await digest(archive))===expected;}catch{}
  if(!cached){
    const partial=archive+`.${process.pid}.part`;
    await promisify(execFile)(process.platform==='win32'?'curl.exe':'curl',['--location','--fail','--max-time','300','--silent','--show-error','--output',partial,`https://github.com/electron/electron/releases/download/v${version}/${name}`],{windowsHide:true,maxBuffer:1024*1024});
    if(await digest(partial)!==expected)throw Error('Official Electron artifact failed SHA-256 verification; not installed.');
    await fs.rename(partial,archive);
  }
  const {extract}=require('@electron-internal/extract-zip');
  await extract(archive,{dir:dist});await fs.writeFile(path.join(packageRoot,'path.txt'),binary);
  const actualVersion=(await fs.readFile(path.join(dist,'version'),'utf8')).trim().replace(/^v/,'');
  if(actualVersion!==version)throw Error('Installed Electron version mismatch.');
  console.log(JSON.stringify({installed:version,platform:process.platform,arch:process.arch,sha256:expected,source:'official GitHub Electron release'},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
