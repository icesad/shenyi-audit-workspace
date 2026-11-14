#!/usr/bin/env node
// Defence in depth for the collaboration snapshot; NOT a complete secret scanner.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let files;
try { files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean))]; }
catch { console.error('Run this check inside the initialized collaboration checkout.');process.exit(1); }
const problems=[];
const forbidden=/\.(?:zip|rar|7z|tar|tgz|bundle|docx?|xlsx?|xlsm|pptx?|pdf|sqlite|db|har|pem|key|p12|pfx|png|jpe?g|gif|webp|heic)$/i;
const secrets=[
  ['GitHub credential',new RegExp('gh[pousr]_'+'[A-Za-z0-9]{30,}')],
  ['GitHub fine-grained credential',new RegExp('github_pat_'+'[A-Za-z0-9_]{35,}')],
  ['private key',new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')],
  ['actual Sites deployment identity',new RegExp('appgprj_'+'[a-f0-9]{32}')]
];
for(const file of files){
  if(file==='dist/brand-shenyi.png')continue;
  if(forbidden.test(file)||/(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.dev\.vars|(?:^|\/)\.openai\/hosting\.json$|^(?:outputs|private-data|business-data|uploads|backups|node_modules)\//.test(file)){
    problems.push({file,reason:'Forbidden business/credential/generated file type or path'});continue;
  }
  let bytes;try{bytes=readFileSync(path.join(root,file));}catch{continue;}
  if(bytes.includes(0)) {problems.push({file,reason:'Unexpected binary; manually review before adding'});continue;}
  const text=bytes.toString('utf8');
  for(const [reason,pattern]of secrets)if(pattern.test(text))problems.push({file,reason});
}
if(problems.length){console.error(JSON.stringify({checked:files.length,problems},null,2));process.exitCode=1;}
else console.log(JSON.stringify({checked:files.length,result:'PASS',limit:'Path/types and a few credential patterns only; human privacy review is still required.'},null,2));
