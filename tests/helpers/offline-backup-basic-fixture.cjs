'use strict';
// All databases belong to this test run; no preview listener, shared DB or vault is opened.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const BASE=process.platform==='win32'?path.resolve('D:/codex-temp/shenyi-team-backup-20261118/boundary-tests'):path.join(require('node:fs').realpathSync(os.tmpdir()),'shenyi-team-offline-backup-boundary-tests');
const api=()=>import(pathToFileURL(path.join(ROOT,'server/team/offline-backup.mjs')).href);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let seed;
async function ownDirectory(label='case'){
 await fs.mkdir(BASE,{recursive:true});const directory=await fs.mkdtemp(path.join(BASE,label+'-'));
 assert.ok(path.resolve(directory).startsWith(BASE+path.sep));return directory;
}
async function seedDatabase(){
 if(!seed)seed=(async()=>{
  const directory=await ownDirectory('baseline'),sourceDatabase=path.join(directory,'seed.sqlite');
  const {initializeTeamDatabase,seedDemoTeamData}=await import(pathToFileURL(path.join(ROOT,'server/team/database.mjs')).href);
  const db=new DatabaseSync(sourceDatabase);try{initializeTeamDatabase(db);await seedDemoTeamData(db);}finally{db.close();}
  return {sourceDatabase,sha256:hash(await fs.readFile(sourceDatabase))};
 })();return seed;
}
async function fixture(label='case'){
 const directory=await ownDirectory(label),sourceDatabase=path.join(directory,'source.sqlite'),baseline=await seedDatabase();
 await fs.copyFile(baseline.sourceDatabase,sourceDatabase,require('node:fs').constants.COPYFILE_EXCL);
 assert.equal(hash(await fs.readFile(baseline.sourceDatabase)),baseline.sha256);
 return {directory,sourceDatabase,outputRoot:path.join(directory,'artifacts')};
}
async function mutateDatabase(filename,action){const db=new DatabaseSync(filename);try{return await action(db);}finally{db.close();}}
async function fileHash(filename){return hash(await fs.readFile(filename));}
async function exists(filename){try{await fs.lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function successMarkers(directory){
 if(!await exists(directory))return [];const found=[];
 async function visit(at){for(const entry of await fs.readdir(at,{withFileTypes:true})){const filename=path.join(at,entry.name);if(entry.isDirectory())await visit(filename);else if(['manifest.json','rehearsal.json'].includes(entry.name))found.push(filename);}}
 await visit(directory);return found;
}
async function createBundle(label='bundle'){
 const f=await fixture(label),{createOfflineBackup}=await api(),before=await fileHash(f.sourceDatabase);
 const result=await createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot:f.outputRoot});
 assert.equal(await fileHash(f.sourceDatabase),before);assert.equal(result.offlineOnly,true);assert.equal(result.onlineCutoverSupported,false);
 return {...f,result,bundleDirectory:result.directory,manifestPath:path.join(result.directory,'manifest.json'),snapshotPath:result.databasePath};
}
function cli(args,{cwd=ROOT,timeout=20000}={}){
 const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase().startsWith('SHENYI_')||['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','NODE_DEBUG','NODE_DEBUG_NATIVE'].includes(key.toUpperCase()))delete env[key];
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(ROOT,'scripts/team-database-backup.mjs'),...args],{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('owned CLI timed out'));},timeout);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
 });
}
module.exports={ROOT,BASE,api,hash,ownDirectory,fixture,mutateDatabase,fileHash,exists,successMarkers,createBundle,cli};
