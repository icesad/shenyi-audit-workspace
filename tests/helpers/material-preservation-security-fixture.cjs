'use strict';
// Independent synthetic attacks. Browser cases use real isolated IndexedDB,
// not an in-memory transaction mock. No customer profile or team database is read.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const A=require('../../dist/audit-checklist.js');
const M=require('../../dist/material-preservation.js');
const P='851a4ad9-9ea2-4917-83df-c87fb6da7484';
const OTHER='9367a605-7638-4099-aa9a-691147984541';
const FIDS=['18f0b236-0311-4f68-98f0-b0a6e04c1fe3','2ac709fa-a89f-49c8-9d13-41cc241171dc','376925ca-0484-4f25-84d7-78b0134a64ac'];
const NOW='2026-11-16T01:02:03.004Z';
const NS='hengdu.audit.materials.v1',TRIAL_NS='hengdu.audit.materials.trial.v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const bytes=async blob=>Buffer.from(await blob.arrayBuffer());
const project=id=>({quoteId:id,projectName:'合成项目 <img src=x onerror=alert(1)>',firmName:'合成事务所'});
const nodes=title=>[{id:'n1',parentId:'',level:1,title:'资料分组',description:'',kind:'group'},{id:'n2',parentId:'n1',level:2,title,description:'合成说明',kind:'material'}];

function fixture({id=P,closed=true,v1=false}={}){
  if(v1){let record=A.create(project(id),A.parse('仅一项合成资料'),'历史姓名');
    if(closed){record=A.apply(record,{type:'item',id:'i1',status:'na',reason:'仅合成不适用',reviewer:'历史姓名'});record=A.apply(record,{type:'close',reviewer:'历史姓名'});}
    return {record,originals:[],readFile:async()=>assert.fail('schema1 must not invent original files')};
  }
  let record=A.createTree(project(id),nodes('旧代资料'),'历史姓名<script>');
  const originals=[];
  function attach(i){const data=Buffer.from('synthetic immutable original '+i+'\n','utf8'),meta={id:FIDS[i],nodeId:'n2',generationId:record.generationId,name:'合成-'+i+'.txt',size:data.length,type:'text/plain',sha256:sha(data)};
    record=A.apply(record,{type:'attachment-add',nodeId:'n2',file:meta,reviewer:'历史姓名<script>'});
    originals.push({metadata:clone(record.events.at(-1).file),data});
  }
  attach(0);record=A.apply(record,{type:'attachment-remove',nodeId:'n2',fileId:FIDS[0],reason:'合成已移除版本',reviewer:'历史姓名'});
  attach(1);record=A.apply(record,{type:'tree-replace',nodes:nodes('新代资料'),reason:'合成标题换代',reviewer:'历史姓名'});
  attach(2);
  if(closed){record=A.apply(record,{type:'item',id:'n2',status:'confirmed',evidence:'合成旧证据，不代表当前签审',reviewer:'历史姓名'});record=A.apply(record,{type:'close',reviewer:'历史姓名'});}
  A.validate(record);
  return {record,originals,readFile:async meta=>{const f=originals.find(x=>x.metadata.id===meta.id);assert.ok(f,'only referenced originals are read');return {metadata:clone(f.metadata),blob:new Blob([f.data],{type:f.metadata.type})};}};
}
async function create(f=fixture(),overrides={}){return M.create({record:f.record,readFile:f.readFile,readCurrent:async()=>clone(f.record),createdAt:NOW,...overrides});}
let packagePromise;
async function good(){packagePromise??=(async()=>{const f=fixture(),result=await create(f);return {f,result,raw:await bytes(result.blob)};})();return packagePromise;}
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function crc(raw){let n=0xffffffff;for(const b of raw){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
// The archive writer/parser below are test-owned; neither calls codec internals.
function unzip(raw){const b=Buffer.from(raw),end=b.length-22,count=b.readUInt16LE(end+10),start=b.readUInt32LE(end+16),entries=[];let c=start;
  assert.equal(b.readUInt32LE(end),0x06054b50);
  for(let i=0;i<count;i++){assert.equal(b.readUInt32LE(c),0x02014b50);const n=b.readUInt16LE(c+28),x=b.readUInt16LE(c+30),m=b.readUInt16LE(c+32),o=b.readUInt32LE(c+42),length=b.readUInt32LE(c+24),localName=b.readUInt16LE(o+26),localExtra=b.readUInt16LE(o+28),dataOffset=o+30+localName+localExtra;
    entries.push({name:b.toString('utf8',c+46,c+46+n),data:Buffer.from(b.subarray(dataOffset,dataOffset+length)),c,o,dataOffset});c+=46+n+x+m;
  }return entries;
}
function zip(entries){let offset=0;const chunks=[],directory=[];
  for(const e of entries){const name=Buffer.from(e.name,'utf8'),data=Buffer.from(e.data),l=Buffer.alloc(30),c=Buffer.alloc(46),checksum=crc(data);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt32LE(checksum,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(name.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(checksum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    chunks.push(l,name,data);directory.push(c,name);offset+=30+name.length+data.length;
  }const cd=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,cd,end]);
}
async function rewrite(change){const entries=unzip((await good()).raw);change(entries);return zip(entries);}
function manifest(entries,change){const e=entries.find(x=>x.name==='manifest.json'),m=JSON.parse(e.data.toString('utf8'));change(m);e.data=Buffer.from(canonical(m));}
function record(entries,change){const e=entries.find(x=>x.name==='record.json'),r=JSON.parse(e.data.toString('utf8'));change(r);e.data=Buffer.from(JSON.stringify(r));manifest(entries,m=>{m.record.bytes=e.data.length;m.record.sha256=sha(e.data);});}
async function rejected(raw){await assert.rejects(M.inspect(new Uint8Array(raw)),undefined,'malformed package must fail closed');}

module.exports={A,M,P,OTHER,FIDS,NOW,NS,TRIAL_NS,sha,clone,bytes,project,nodes,fixture,create,good,canonical,crc,unzip,zip,rewrite,manifest,record,rejected};
