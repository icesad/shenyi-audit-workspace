'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{pathToFileURL}=require('node:url');
const dist=path.join(__dirname,'../dist');
// Synthetic RAR5 with two tiny UTF-8 filenames and a Quick Open record.
// Generated with Rar.exe -ma5 -m3 -md1m -qo+ -ep1; no user material.
const rar=Buffer.from('UmFyIRoHAQAXfOFjCwEFBwAGAQHDgYAAQftTsSwCAwumAASLCCB9xwKOgAMAEOS4jeimgeaPkOWPli50eHQKAwI8BVKdkW7dAce+IyQEI/ozvgTB3N18FBGl9od/xpt6ztovaLgwqZViQpDJ/3cuSkrYvikCAwuuAASgECCWShPogAMADeS7hea1i+ivlS50eHQKAwKHtlGdkW7dAcW0KyQEMvozvQcH/NmPgoQjRPpm/40yzre2eahcK6wkuWR2NUjI9D0M4/u+w7y4PKhsDgMG8AAA8AAAgAAAAlFPqD+dsDUAswExQftTsSwCAwumAASLCCB9xwKOgAMAEOS4jeimgeaPkOWPli50eHQKAwI8BVKdkW7dAVjWBvExAFwuSkrYvikCAwuuAASgECCWShPogAMADeS7hea1i+ivlS50eHQKAwKHtlGdkW7dAR13VlEDBQQA','base64');
function crc(b){let c=0xffffffff;for(const n of b){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function zip(items){
 const blocks=[],dirs=[];let offset=0;
 for(const v of items){
  const name=Buffer.from(v.name),bytes=Buffer.from(v.data||''),method=v.method??8,packed=method===0?bytes:zlib.deflateRawSync(bytes),sum=v.crc??crc(bytes),flags=v.flags??0x800,size=v.size??bytes.length;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(flags,6);h.writeUInt16LE(method,8);h.writeUInt32LE(sum,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(size,22);h.writeUInt16LE(name.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(method,10);c.writeUInt32LE(sum,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(v.attrs??0,38);c.writeUInt32LE(offset,42);
  blocks.push(h,name,packed);dirs.push(c,name);offset+=h.length+name.length+packed.length;
 }
 const central=Buffer.concat(dirs),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...blocks,central,end]);
}
const vzip=zip([{name:'测试目录/',data:''},{name:'测试目录/甲.txt',data:'选中文件'},{name:'测试目录/乙.txt',data:'仅在清单显示',method:0}]);
test('浏览器本机读取 ZIP/RAR5：按清单定向读文件、核对边界和拒绝异常',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed playwright');}
 const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
 if(!fs.existsSync(executablePath))return t.skip('no installed chromium');
 const browser=await chromium.launch({headless:true,executablePath,chromiumSandbox:true});
 try{
  const context=await browser.newContext();let network=0,pageErrors=0;
  await context.route(/^https?:/,r=>{network++;return r.abort()});const p=await context.newPage();p.on('pageerror',()=>pageErrors++);
  await p.goto(pathToFileURL(path.join(dist,'rule-catalog.js')).href);
  for(const n of ['bidder-archive-vendor.js','bidder-archive.js'])await p.addScriptTag({content:fs.readFileSync(path.join(dist,n),'utf8')});
  const read=async bytes=>p.evaluate(async a=>{
    const f=new Blob([Uint8Array.from(a)]),x=await BidderArchive.open(f);
    try{
      const key=x.format==='rar'?'仅测试.txt':x.entries[0].name,map=await x.read([key]);let unknown=false;
      try{await x.read(['absent'])}catch(e){unknown=/不在/.test(e.message);}
      const next=await x.read([x.entries.find(e=>e.name!==key).name]);
      const res={format:x.format,entries:x.entries,keys:[...map.keys()],contents:new TextDecoder().decode(map.get(key)),frozen:Object.isFrozen(x.entries)&&Object.isFrozen(x.entries[0]),unknown,second:[...next.keys()]};
      x.close();try{await x.read([key]);}catch(e){res.closed=/关闭/.test(e.message);} res.original=[...new Uint8Array(await f.arrayBuffer())].every((v,i)=>v===a[i]);
      return res;
    }finally{x.close();}
  },[...bytes]);
  await t.test('解压 ZIP 中指定文件，保留 Unicode 路径，不展开未选内容',async()=>{
    const r=await read(vzip);assert.equal(r.format,'zip');assert.equal(r.entries.length,2);assert.deepEqual(r.keys,['测试目录/甲.txt']);assert.equal(r.contents,'选中文件');assert.deepEqual(r.second,['测试目录/乙.txt']);assert.ok(r.frozen&&r.closed&&r.unknown&&r.original);
  });
  await t.test('RAR5 Quick Open、Unicode 和反复定向提取均不修改原始 Blob',async()=>{
    const r=await read(rar);assert.equal(r.format,'rar');assert.equal(r.entries.length,2);assert.deepEqual(r.keys,['仅测试.txt']);assert.equal(r.contents,'synthetic selected bytes only \r\n'.repeat(65));assert.deepEqual(r.second,['不要提取.txt']);assert.ok(r.frozen&&r.closed&&r.unknown&&r.original);
  });
  const failure=(data,op='open')=>p.evaluate(async ({a,op})=>{
    let x;try{x=await BidderArchive.open(new Blob([Uint8Array.from(a)]));if(op==='read')await x.read(x.entries.map(e=>e.name));return '';}catch(e){return e.message;}finally{x?.close();}
  },{a:[...data],op});
  await t.test('拒绝遍历、大小写冲突、链接、加密及过大声明',async()=>{
    assert.match(await failure(zip([{name:'../越界.txt',data:'x'}])),/不安全路径/);
    assert.match(await failure(zip([{name:'a.txt',data:'x'},{name:'A.txt',data:'x'}])),/同名或冲突/);
    assert.match(await failure(zip([{name:'a.txt',data:'x',attrs:0xa0000000}])),/链接/);
    assert.match(await failure(zip([{name:'a.txt',data:'x',flags:0x801}])),/加密/);
    assert.match(await failure(zip([{name:'a.txt',data:'x',size:513*1024*1024}])),/解压体积过大/);
    assert.match(await failure(zip([{name:'a.txt',data:'x',size:33*1024*1024}]),'read'),/单个 32 MiB/);
  });
  await t.test('坏 CRC、实际大小不一致、异常签名和旧 RAR4 明确拒绝',async()=>{
    assert.match(await failure(zip([{name:'a.txt',data:'x',crc:1}]),'read'),/内容校验失败/);
    assert.match(await failure(zip([{name:'a.txt',data:'xx',size:1}]),'read'),/解压体积与清单不一致/);
    const damaged=Buffer.from(rar);damaged[8]^=1;assert.match(await failure(damaged),/损坏/);
    assert.match(await failure(Buffer.from([82,97,114,33,26,7,0])),/旧版 RAR 4/);
  });
  await t.test('AbortController 能终止尚未返回的本机 Worker',async()=>{
    const stopped=await p.evaluate(async a=>{const c=new AbortController(),work=BidderArchive.open(new Blob([Uint8Array.from(a)]),{signal:c.signal});c.abort();try{await work;return false;}catch(e){return /取消/.test(e.message);}},[...rar]);assert.ok(stopped);
  });
  assert.equal(network,0);assert.equal(pageErrors,0);
 }finally{await browser.close();}
});

