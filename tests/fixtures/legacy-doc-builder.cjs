/* Synthetic CFB/Word97 text fixture; never contains private documents.
 * Independent structure references:
 * MS-CFB header and directory: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/68530324-9d3d-4441-9ea9-66a2c8f79567
 * MS-DOC text algorithm: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01
 * This is a text-reader fixture, not a complete authoring implementation.
 */
'use strict';
const FREE=0xffffffff,END=0xfffffffe,FAT=0xfffffffd;
function compoundFile(streams,{mini=true}={}){
  const sectors=[],chains=[],small=[];
  const alloc=bytes=>{const start=sectors.length,n=Math.ceil(bytes.length/512);for(let i=0;i<n;i++){const b=Buffer.alloc(512);bytes.copy(b,0,i*512,(i+1)*512);sectors.push(b);}chains.push({start,n});return start;};
  const entries=streams.map(([name,bytes])=>({name,bytes:Buffer.from(bytes),start:END}));
  let miniSize=0;
  for(const e of entries)if(mini&&e.bytes.length<4096){e.start=miniSize/64;const n=Math.ceil(e.bytes.length/64);small.push({e,n});miniSize+=n*64;}
  const miniBytes=Buffer.alloc(miniSize),miniFat=Buffer.alloc(Math.ceil(Math.max(1,miniSize/64)/128)*512,255);
  for(const {e,n}of small){e.bytes.copy(miniBytes,e.start*64);for(let j=0;j<n;j++)miniFat.writeUInt32LE(j===n-1?END:e.start+j+1,(e.start+j)*4);}
  for(const e of entries)if(!small.some(x=>x.e===e))e.start=alloc(e.bytes);
  const rootStart=miniSize?alloc(miniBytes):END,miniFatStart=miniSize?alloc(miniFat):END;
  const dir=Buffer.alloc(512);
  const directory=(at,name,type,start,size,left=FREE,right=FREE,child=FREE,color=1)=>{
    const nameBytes=Buffer.from(name+'\0','utf16le');nameBytes.copy(dir,at);dir.writeUInt16LE(nameBytes.length,at+64);dir[at+66]=type;dir[at+67]=color;
    dir.writeUInt32LE(left,at+68);dir.writeUInt32LE(right,at+72);dir.writeUInt32LE(child,at+76);dir.writeUInt32LE(start,at+116);dir.writeUInt32LE(size,at+120);
  };
  directory(0,'Root Entry',5,rootStart,miniSize,FREE,FREE,entries.length>1?2:1);
  entries.forEach((e,i)=>directory((i+1)*128,e.name,2,e.start,e.bytes.length,i===1?1:FREE,FREE,FREE,i===0&&entries.length>1?0:1));
  for(let i=entries.length+1;i<4;i++)for(const at of [68,72,76])dir.writeUInt32LE(FREE,i*128+at);
  const directoryStart=alloc(dir),fatStart=sectors.length;let fatCount=1;
  while(Math.ceil((fatStart+fatCount)/128)>fatCount)fatCount++;
  if(fatCount>109)throw Error('Synthetic helper deliberately omits DIFAT extension sectors.');
  const fat=Buffer.alloc(fatCount*512,255);
  for(const {start,n}of chains)for(let i=0;i<n;i++)fat.writeUInt32LE(i===n-1?END:start+i+1,(start+i)*4);
  for(let i=0;i<fatCount;i++)fat.writeUInt32LE(FAT,(fatStart+i)*4);
  for(let i=0;i<fatCount;i++)sectors.push(fat.subarray(i*512,(i+1)*512));
  const h=Buffer.alloc(512);Buffer.from('d0cf11e0a1b11ae1','hex').copy(h);h.writeUInt16LE(0x3e,24);h.writeUInt16LE(3,26);h.writeUInt16LE(0xfffe,28);h.writeUInt16LE(9,30);h.writeUInt16LE(6,32);
  h.writeUInt32LE(fatCount,44);h.writeUInt32LE(directoryStart,48);h.writeUInt32LE(4096,56);h.writeUInt32LE(miniFatStart,60);h.writeUInt32LE(miniSize?miniFat.length/512:0,64);h.writeUInt32LE(END,68);
  for(let i=0;i<109;i++)h.writeUInt32LE(i<fatCount?fatStart+i:FREE,76+i*4);
  return Buffer.concat([h,...sectors]);
}
function buildLegacyDoc(options={}){
  const pieces=options.pieces||[{text:'资料清单2026\r一、基础资料\r9. 营业执照\r29. 银行函证\r',compressed:false}];
  let cp=0,next=1024;
  const encoded=pieces.map(p=>{
    const bytes=Buffer.from(p.text,p.compressed?'latin1':'utf16le'),fc=p.fc??next;next=Math.max(next,fc+bytes.length+18);
    const out={...p,bytes,cp,fc};cp+=p.text.length;return out;
  });
  const word=Buffer.alloc(options.mini?next:Math.max(4096,next)),table=Buffer.alloc(options.mini?512:4096);
  word.writeUInt16LE(0xa5ec,0);word.writeUInt16LE(options.nFib??0xc1,2);word.writeUInt16LE(0x409,6);
  word.writeUInt16LE(0x1004|((options.table||'1Table')==='1Table'?0x200:0)|(options.encrypted?0x100:0)|(options.obfuscated?0x8000:0),10);
  word.writeUInt16LE(0xbf,12);word.writeUInt32LE(1024,24);word.writeUInt32LE(next,28);
  word.writeUInt16LE(14,32);word.writeUInt16LE(22,62);word.writeUInt32LE(word.length,64);word.writeUInt32LE(options.mainLength??cp,76);word.writeUInt16LE(93,152);
  if(options.mainLength!==undefined&&options.mainLength<cp)word.writeUInt32LE(cp-options.mainLength,84); // ccpHdr: a non-main story has its own FIB character count.
  const prefix=options.prc?Buffer.from([1,2,0,0,0]):Buffer.alloc(0),plc=Buffer.alloc(4+12*encoded.length);
  encoded.forEach((p,i)=>{plc.writeUInt32LE(p.cp,i*4);plc.writeUInt32LE(p.compressed?(0x40000000+p.fc*2):p.fc,4*(encoded.length+1)+i*8+2);p.bytes.copy(word,p.fc);});
  plc.writeUInt32LE(cp,encoded.length*4);
  const clx=Buffer.alloc(prefix.length+5+plc.length);prefix.copy(clx);clx[prefix.length]=2;clx.writeUInt32LE(plc.length,prefix.length+1);plc.copy(clx,prefix.length+5);
  const clxStart=64;clx.copy(table,clxStart);word.writeUInt32LE(clxStart,418);word.writeUInt32LE(clx.length,422);
  if(options.mutateWord)options.mutateWord(word);if(options.mutateTable)options.mutateTable(table,{clxStart,plcStart:clxStart+prefix.length+5,pieceCount:encoded.length});
  const data=compoundFile([[options.table||'1Table',table],['WordDocument',word]],{mini:!!options.mini});
  if(options.mutateCfb)options.mutateCfb(data);
  return data;
}
module.exports={buildLegacyDoc,compoundFile};
