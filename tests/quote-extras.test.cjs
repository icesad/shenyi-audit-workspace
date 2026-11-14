'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Q=require('../dist/quote-packet.js'),E=require('../dist/quote-extras.js');
const digest=b=>createHash('sha256').update(b).digest('hex');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const snap={firmName:'SYNTHETIC',customerName:'SYNTHETIC',auditYear:2026,location:'北京',service:'审计',quoteDate:'2026-11-08',issuer:'合成单位',projectName:'合成项目',projectType:'测试',contactName:'',contactInfo:'',subtotalCents:100,taxCents:0,totalCents:100,taxRateText:'0%'};
const file=(name='合成证明.pdf',bytes=pdf,type='application/pdf')=>({name,size:bytes.length,type,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
const pair=()=>Promise.all(['business_license','practice_certificate'].map(k=>Q.readAttachment(file(k+'.pdf'),k)));
function unzip(raw){const b=Buffer.from(raw),out=new Map();let p=0;while(b.readUInt32LE(p)===0x04034b50){const n=b.readUInt32LE(p+18),nam=b.readUInt16LE(p+26),start=p+30+nam+b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+nam).toString('utf8');assert.equal(out.has(name),false);out.set(name,b.subarray(start,start+n));p=start+n;}assert.equal(b.readUInt32LE(p),0x02014b50);assert.equal(b.readUInt16LE(b.length-12),out.size);return out;}
// Tiny independent Office-like STORE fixture, no Office parser or rendering dependency.
function office(entries){
 const locals=[],directory=[];let offset=0;
 for(const name of entries){const n=Buffer.from(name),h=Buffer.alloc(30+n.length);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(n.length,26);n.copy(h,30);
 const c=Buffer.alloc(46+n.length);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);n.copy(c,46);locals.push(h);directory.push(c);offset+=h.length;}
 const cd=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
test('two certificates alone still create the exact four-entry packet; extras cannot replace either certificate',async()=>{
 const p=await pair(),a=await Q.readExtra(file());const old=await Q.buildPacket(snap,p);assert.deepEqual(old,await Q.buildPacket(snap,p,[]));assert.equal(unzip(old).size,4);assert.equal('extras' in JSON.parse(unzip(old).get('附件清单.json')),false);
 await assert.rejects(Q.buildPacket(snap,[p[0],a],[a]));await assert.rejects(Q.buildPacket(snap,[p[0]],[p[1]]));await assert.rejects(Q.verifyExtras([p[0]]));});
test('ten extras have independent paths even with repeated names and all manifest contents match bytes',async()=>{
 const p=await pair(),a=await Q.readExtra(file()),ten=Array(10).fill(a);const un=unzip(await Q.buildPacket(snap,p,ten)),m=JSON.parse(un.get('附件清单.json'));
 assert.equal(un.size,14);assert.equal(m.attachments.length,2);assert.equal(m.extras.length,10);m.extras.forEach((x,i)=>{assert.equal(x.name,a.name);assert.equal(x.path,'其他附件/'+String(i+1).padStart(2,'0')+'-'+a.name);assert.deepEqual(un.get(x.path),pdf);assert.equal(x.sha256,digest(pdf));});await assert.rejects(Q.buildPacket(snap,p,[...ten,a]),/10份/);});
test('re-verifies name, kind, size and byte hash; safely handles Office types and rejects mismatches and macros',async()=>{
 const a=await Q.readExtra(file());for(const bad of [{...a,name:'../a.pdf'},{...a,kind:'other'},{...a,sha256:'0'.repeat(64)},{...a,size:a.size+1}])await assert.rejects(Q.verifyExtras([bad]));
 for(const x of [file('恶意.html'),file('foo.png',pdf,'image/png'),file('x.docx',pdf,'')])await assert.rejects(Q.readExtra(x));
 const names=['[Content_Types].xml','word/document.xml'];assert.equal((await Q.readExtra(file('标书.docx',office(names),''))).mime,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 assert.equal((await Q.readExtra(file('附表.xlsx',office([names[0],'xl/workbook.xml']),''))).kind,'extra');await assert.rejects(Q.readExtra(file('word.xlsx',office(names),'')));
 for(const unsafe of ['word/vbaProject.bin','../escape','word/activeX/foo.xml'])await assert.rejects(Q.readExtra(file('fake.docx',office([...names,unsafe]),'')));});
test('enforces bounded arrays, rejects a forged or sparse list, captures bytes before an async export',async()=>{
 const a=await Q.readExtra(file());for(const x of [Array(1),null,Object.assign([a],{extra:a}),Array(11).fill(a)])await assert.rejects(Q.verifyExtras(x));await assert.rejects(Q.readExtra({...file(),size:3*1024*1024+1}),/3MiB/);
 const p=await pair(),ongoing=Q.buildPacket(snap,p,[a]);a.bytes.fill(0);const files=unzip(await ongoing);assert.deepEqual(files.get('其他附件/01-'+a.name),pdf);await assert.rejects(Q.verifyExtras([a]));});
// A tiny event target, not a browser claim: tests the controller's pending/cancellation and detached-copy contract.
function harness(){
 class Element extends EventTarget{constructor(tag,doc){super();this.tag=tag;this.ownerDocument=doc;this.children=[];this.attrs={};}
  append(...a){this.children.push(...a);}replaceChildren(...a){this.children=a;}setAttribute(k,v){this.attrs[k]=v;}find(tag){if(this.tag===tag)return this;for(const c of this.children){const found=c.find(tag);if(found)return found;}}}
 const doc={defaultView:{Event},createElement(tag){return new Element(tag,this);}},c=doc.createElement('div'),api=E.mount(c);const pick=async fs=>{const el=c.find('input');el.files=fs;el.dispatchEvent(new Event('change'));for(let i=0;i<100&&api.isPending();i++)await new Promise(r=>setTimeout(r,2));};return {api,c,pick};
}
test('other attachment UI appends atomically, allows remove/re-add, signals changes and prevents late files leaking to next quote',async()=>{
 const {api,c,pick}=harness();let count=0;c.addEventListener('extraschange',e=>{assert.ok(e.bubbles);count++;});
 await pick([file()]);const copy=api.list()[0];copy.bytes.fill(0);assert.equal(digest(api.list()[0].bytes),digest(pdf));
 await pick([file('ok.pdf'),file('bad.html')]);assert.equal(api.list().length,1);
 const currentCount=count;await pick(Array(10).fill(file()));assert.equal(api.list().length,1);assert.equal(count,currentCount);
 await pick(Array(9).fill(file()));assert.equal(api.list().length,10);assert.ok(c.find('input').disabled);
 c.find('button').dispatchEvent(new Event('click'));assert.equal(api.list().length,9);assert.equal(c.find('input').disabled,false);
 let release;const waiting={...file(),arrayBuffer:()=>new Promise(ok=>{release=ok;})};const work=pick([waiting]);assert.equal(api.isPending(),true);api.clear();release(Uint8Array.from(pdf).buffer);await work;assert.equal(api.list().length,0);assert.equal(api.isPending(),false);
 await pick([file('第二单.pdf')]);assert.deepEqual(api.list().map(v=>v.name),['第二单.pdf']);assert.ok(count>=6);});
