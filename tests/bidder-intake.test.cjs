'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{read}=require('../dist/bidder-intake.js');
const text=new TextEncoder(),bytes=s=>text.encode(s),firm='虚构甲会计师事务所（普通合伙）',other='虚构乙会计师事务所（普通合伙）';
function fake(files){
  const map=new Map(Object.entries(files).map(([k,v])=>[k,typeof v==='string'?bytes(v):v])),calls=[];
  return {entries:[...map].map(([name,b])=>({name,size:b.byteLength})),calls,read:async names=>{calls.push([...names]);return new Map(names.map(n=>[n,map.get(n)]));}};
}
test('a firm sheet supplies only explicit fields; five file classes remain separate; other files are inventory only',async()=>{
  const a=fake({
    '资料/投标方基本信息.txt':'企业名称：'+firm+'\n执行团队所在地：河北\n联系人：张样\n联系电话：010-00000000\n联系邮箱：audit@example.invalid\n法定代表人：李样\n',
    '资料/营业执照副本.pdf':'license',
    '资料/会计师事务所执业证书.pdf':'practice',
    '资料/公司公章.png':'seal',
    '资料/法人章.png':'legal',
    '资料/投标人签字.jpg':'signature',
    '资料/身份证.pdf':'never read',
    '资料/招标文件.txt':'联系人：虚构甲\n联系电话：099-1234567\n',
    '资料/注册会计师执业证书.pdf':'personal certificate'
  });
  const r=await read(a);assert.equal(r.inventory.length,9);assert.equal(r.profiles.length,1);
  const {fields,files}=r.profiles[0];
  assert.deepEqual(fields,{name:firm,team:'河北',contactName:'张样',phone:'010-00000000',email:'audit@example.invalid'});
  assert.deepEqual(Object.keys(files),['business_license','practice_certificate','company_seal','legal_representative_seal','bidder_signature']);
  assert.equal(files.practice_certificate.name,'会计师事务所执业证书.pdf');
  assert.equal(files.bidder_signature.name,'投标人签字.jpg');
  assert.equal(files.bidder_signature.sourcePath,'资料/投标人签字.jpg');
  assert.equal(a.calls.flat().length,6);
});
test('a single corroborated firm name can be derived from two distinct filenames without opening either report',async()=>{
  const a=fake({
    ['资料\\自有报表\\'+firm+' 2024年度财务报表审计报告(1).pdf']:'no read',
    ['资料\\体系认证证书\\三体系-'+firm+'.pdf']:'no read',
    '资料\\营业执照副本.pdf':'license',
    '资料\\执业证书.pdf':'practice',
    '资料\\法人章.png':'legal'
  });
  const r=await read(a);assert.equal(r.profiles[0].fields.name,firm);
  assert.equal(a.calls.flat().length,3);
  assert.equal(r.profiles[0].fields.team,'');
  assert.equal(r.profiles[0].files.legal_representative_seal.name,'法人章.png');
});
test('one unnamed draft may preserve available attachments but never guesses contact, execution team, or identity',async()=>{
  const a=fake({
    '材料/公司简介.txt':'办公地址：河北\n联系人：张样\n联系电话：010-00000000',
    '材料/公司公章.png':'seal',
    '材料/营业执照副本.pdf':'license'
  });
  const r=await read(a);assert.equal(r.profiles.length,1);
  assert.deepEqual(r.profiles[0].fields,{name:'',team:'',contactName:'',phone:'',email:''});
  assert.ok(r.profiles[0].files.company_seal);
});
test('explicit firm branches do not share the second firm’s certificate or stamp',async()=>{
  const a=fake({
    ['资料/'+firm+'/营业执照.pdf']:'license-A',
    ['资料/'+firm+'/公司公章.png']:'seal-A',
    ['资料/'+other+'/执业证书.pdf']:'practice-B',
    ['资料/'+other+'/法人章.jpg']:'legal-B',
    '资料/投标人签字.jpg':'unscoped'
  });
  const r=await read(a);assert.equal(r.profiles.length,3);
  const one=r.profiles.find(x=>x.fields.name===firm),two=r.profiles.find(x=>x.fields.name===other);
  assert.deepEqual(Object.keys(one.files),['business_license','company_seal']);
  assert.deepEqual(Object.keys(two.files),['practice_certificate','legal_representative_seal']);
  assert.deepEqual(Object.keys(r.profiles.find(x=>!x.fields.name).files),['bidder_signature']);
});
test('conflicting firm names, duplicate credentials, oversized images, and inconsistent phone labels never choose a winner',async()=>{
  const a=fake({
    '资料/公司简介.txt':'企业名称：'+firm+'\n联系电话：010-00000000',
    '资料/基本资料.txt':'企业名称：'+other+'\n联系电话：020-00000000',
    '资料/公章.png':'ambiguous'
  });
  const r=await read(a);assert.equal(r.profiles.length,2);assert.ok(r.profiles.every(x=>!Object.keys(x.files).length));
  const b=fake({
    '公司简介.txt':'企业名称：'+firm+'\n联系电话：010-00000000\n联系电话：020-00000000',
    '营业执照.pdf':'one','营业执照副本.pdf':'another',
    '公章.png':new Uint8Array(3*1024*1024+1)
  });
  const y=await read(b);assert.equal(y.profiles[0].fields.phone,'');assert.deepEqual(y.profiles[0].alternatives.phone,['010-00000000','020-00000000']);assert.deepEqual(Object.keys(y.profiles[0].files),[]);
  assert.ok(y.profiles[0].notes.some(n=>n.includes('多份营业执照'))&&y.profiles[0].notes.some(n=>n.includes('3 MiB')));
  assert.equal(b.calls.flat().length,1);
});
test('malformed archives and path confusion are rejected before selective extraction',async()=>{
  for(const files of [{'../营业执照.pdf':'x'},{'同目录\\营业执照.pdf':'x','同目录/营业执照.pdf':'y'}]){
    const a=fake(files);await assert.rejects(()=>read(a));assert.equal(a.calls.length,0);
  }
  await assert.rejects(()=>read({entries:[{name:'公章.png',size:5}],read:async()=>new Map([['公章.png',bytes('a')]])}),/读取不完整/);
});

test('numbered files and explicit credential, seal and signature aliases route to the five slots',async()=>{
  const a=fake({
    '材料/01.营业执照正本.pdf':'license',
    '材料/附件 2：执业证明.pdf':'practice',
    '材料/03、单位印章_透明底.png':'company',
    '材料/(04)法定代表人名章（原件）.png':'legal',
    '材料/05 投标人手写签名.jpg':'signature',
    '材料/财务公章.png':'not company',
    '材料/法人公章.png':'ambiguous',
    '材料/注册会计师执业证明.pdf':'individual',
    '材料/执业证明申请书.pdf':'application',
    '材料/签名.png':'unassigned',
    '材料/投标人签章.png':'ambiguous'
  });
  const r=await read(a),files=r.profiles[0].files;
  assert.equal(r.inventory.length,11);assert.equal(r.profiles.length,1);
  assert.deepEqual(Object.fromEntries(Object.entries(files).map(([k,f])=>[k,new TextDecoder().decode(f.bytes)])),{
    business_license:'license',practice_certificate:'practice',company_seal:'company',legal_representative_seal:'legal',bidder_signature:'signature'
  });
  assert.equal(a.calls.flat().length,5);
});
