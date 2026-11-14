'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../dist/quote-sign-requirements.js');
const c='company_seal',l='legal_representative_seal',s='bidder_signature';
const Q=(id='q',defaults=[])=>({id,name:'格式'+id+'报价函',type:'quote',defaultKinds:defaults});
const A=(id,name,rest={})=>({id,name,type:'attachment',...rest});
const all=(...args)=>R.review({requirementsText:args[0],items:args.slice(1)});
const selections=rows=>rows.map(r=>[r.id,[...r.kinds]]);
test('explicit quote requirements apply to both chosen quote formats, never to attachments; aliases resolve archived certificates',async()=>{
 const rows=await all('报价函须加盖公司公章并由投标人签字。\n营业执照复印件须加盖公司公章。\n执业证书须加盖法人章。',
  Q('q1'),Q('q2'),A('license','资质A_2026.pdf',{role:'business_license'}),A('practice','证件B.pdf',{role:'practice_certificate'}),A('promise','独立性承诺书.pdf'));
 assert.deepEqual(selections(rows),[['q1',[c,s]],['q2',[c,s]],['license',[c]],['practice',[l]],['promise',[]]]);
 assert.match(rows[2].evidence[0],/采购要求：营业执照/);assert.equal(rows[4].uncertain,true);
});
test('explicit all attachments is different from a bare附件 heading; quote is not affected by file-specific text',async()=>{
 const a=A('a','资质说明.pdf'),b=A('b','经验附件.pdf');
 let rows=await all('所有附件均须加盖单位公章。',Q(),a,b);
 assert.deepEqual(selections(rows),[['q',[]],['a',[c]],['b',[c]]]);
 rows=await all('附件须加盖公章。',Q('q',[c]),a,b);
 assert.deepEqual(selections(rows),[['q',[c]],['a',[]],['b',[]]]);
 assert.equal(rows[1].uncertain,true);
 rows=await all('并非所有附件须加盖公司公章。',Q(),a,b);assert.deepEqual(selections(rows),[['q',[]],['a',[]],['b',[]]]);
 rows=await all('附件一：报价函\n须加盖公司公章。\n附件二：经验附件\n请加盖法人章。',Q(),a,b);
 assert.deepEqual(selections(rows),[['q',[c]],['a',[]],['b',[l]]]);
});
test('explicit stamping verb carries over all coordinated seal names, not other attachments or alternatives',async()=>{
 const a=A('pdf','独立性承诺书.pdf'),b=A('other','授权委托书.pdf');
 const rows=await all('独立性承诺书须加盖公司公章和法人章，并由投标人签字。',Q(),a,b);
 assert.deepEqual(selections(rows),[['q',[]],['pdf',[c,l,s]],['other',[]]]);
 assert.equal(rows[1].uncertain,false);
 for(const list of ['公司公章、法人章','公司公章及法定代表人印章','法人章和公司公章','公司公章，法人章']){
   assert.deepEqual(selections(await all('独立性承诺书须加盖'+list+'。',a,b)),[['pdf',[c,l]],['other',[]]],list);
 }
 for(const list of ['公司公章或法人章','法人章 或 公司公章','公司公章／法人章','公司公章和法人章任选其一']){
   const reviewed=await all('独立性承诺书须加盖'+list+'。',a);
   assert.deepEqual(selections(reviewed),[['pdf',[]]],list);assert.ok(reviewed[0].uncertain,list);
 }
});
test('clause negation suppresses defaults; disjunctive and specialized stamps never become image selections',async()=>{
 let rows=await all('报价函无需公司公章；报价函请加盖法人章。',Q('q',[c]));
 assert.deepEqual(selections(rows),[['q',[l]]]);assert.match(rows[0].notes.join(),/取消自动选择/);
 rows=await all('报价函由投标人签字或加盖公司公章。',Q('q',[c,s]));
 assert.deepEqual(selections(rows),[['q',[]]]);assert.equal(rows[0].uncertain,true);
 for(const rule of ['报价函须逐页加盖公司公章。','报价函须加盖公司公章和骑缝章。','报价函必须使用电子印章。','报价函须由法定代表人签字。','报价函须上传投标人签字扫描件。','报价函仅需加盖法人章。','报价函请由采购人加盖公司公章。','报价函须加盖公司公章但有特殊要求除外。','报价函可以加盖公司公章。','报价函可加盖公章。']){
   rows=await all(rule,Q());assert.deepEqual(selections(rows),[['q',[]]],rule);assert.ok(rows[0].uncertain,rule);
 }
});
test('an explicit quote layout number targets only that selected layout; ambiguous numbering never transfers',async()=>{
 const f1=Q('quote:format1'),f2=Q('quote:format2'),f3=Q('quote:format3'),att=A('a','承诺书.pdf');
 let rows=await all('格式2报价函须加盖公司公章。',f1,f2,f3,att);
 assert.deepEqual(selections(rows),[['quote:format1',[]],['quote:format2',[c]],['quote:format3',[]],['a',[]]]);
 rows=await all('报价函（格式二）须加盖法人章。',f1,f2,att);
 assert.deepEqual(selections(rows),[['quote:format1',[]],['quote:format2',[l]],['a',[]]]);
 rows=await all('格式2报价函须加盖公司公章。',f1,Q('quote:format3',[s]),att);
 assert.deepEqual(selections(rows),[['quote:format1',[]],['quote:format3',[s]],['a',[]]]);
 rows=await all('格式1至3报价函须加盖公章。',Q('quote:format1',[c]),f2,f3,att);
 assert.deepEqual(selections(rows),[['quote:format1',[]],['quote:format2',[]],['quote:format3',[]],['a',[]]]);
 assert.equal(rows[0].uncertain,true);
});
test('exact per-document placement candidates, no transfer from an attachment mentioning quote or another file',async()=>{
 const rows=await all('',
  Q(),A('promise','承诺书.docx',{text:'承诺事项说明\n本表须加盖法人章。\n投标人（签字）\n对报价函应当加盖公司公章。'}),
  A('authorize','授权书.pdf',{text:'公司公章：______\n法定代表人（签字或盖章）'}),
  A('naked','空白.docx',{text:'报价函须加盖公司公章。\n这份报告已经加盖公司公章。'}));
 assert.deepEqual(selections(rows),[['q',[]],['promise',[l,s]],['authorize',[c]],['naked',[]]]);
 assert.ok(rows[2].uncertain);assert.match(rows[1].evidence.join(),/附件可读正文/);
});
test('multiple similar names or unresolved labels never apply one file requirement across firms',async()=>{
 const rows=await all('营业执照须加盖公司公章。',Q(),
   A('license1','第一家营业执照.pdf',{role:'business_license'}),
   A('license2','第二家营业执照.pdf',{role:'business_license'}));
 assert.deepEqual(selections(rows),[['q',[]],['license1',[]],['license2',[]]]);
 assert.equal(rows[1].uncertain,true);assert.match(rows[2].notes.join(),/未明确对应/);
 await assert.rejects(()=>all('',Q(),Q()),/标识/);
});
test('signed artifacts do not supply new sign instructions; literal placeholders and labels do',async()=>{
 const rows=await all('',
  A('license','营业执照.pdf',{role:'business_license',text:'公司公章：___'}),
  A('existing','已签件.docx',{text:'本附件已加盖公司公章；本表已由投标人签字。'}),
  A('blank','空表.docx',{text:'投标人（盖章）\n法人章：___\n{{bidder_signature}}'}));
 assert.deepEqual(selections(rows),[['license',[]],['existing',[]],['blank',[c,l,s]]]);
});
test('reader only accepts selected readable text, limits malformed inputs and never interprets image data',async()=>{
 const text='报价函须加盖公司公章。\n';
 const data=new TextEncoder().encode(text),x={name:'虚构要求.txt',type:'text/plain',size:data.byteLength,arrayBuffer:async()=>data.buffer};
 const r=await R.readRequirements(x);assert.match(r.text,/报价函须加盖公司公章/);assert.match(r.notes[0],/不作 OCR/);
 await assert.rejects(()=>R.readRequirements({...x,type:'image/png',name:'扫描图.png'}),/扫描件/);
 await assert.rejects(()=>R.readRequirements({...x,size:data.byteLength+1}),/未能读取/);
});
test('native text helpers are used only for eligible auxiliary DOCX/PDF, not two certificate files',async t=>{
 const beforePDF=global.BidderPdfText,beforeDocx=global.TenderImport,calls=[];
 t.after(()=>{if(beforePDF===undefined)delete global.BidderPdfText;else global.BidderPdfText=beforePDF;if(beforeDocx===undefined)delete global.TenderImport;else global.TenderImport=beforeDocx;});
 global.BidderPdfText={read:async b=>{calls.push(['pdf',b.length]);return {lines:['本表须加盖公司公章。']};}};
 global.TenderImport={readVisibleText:async f=>{calls.push(['docx',f.name]);return {lines:['投标人（签字）']};}};
 const bytes=Uint8Array.from([1,2,3,4]);
 const rows=await all('',A('lic','资质.pdf',{role:'business_license',bytes}),A('other','承诺书.pdf',{bytes}),A('word','授权书.docx',{bytes}));
 assert.deepEqual(calls,[['pdf',4],['docx','授权书.docx']]);assert.deepEqual(selections(rows),[['lic',[]],['other',[c]],['word',[s]]]);
});
