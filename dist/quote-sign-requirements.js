/* Local, advisory-only recognition of explicitly scoped quotation signing requirements.
 * Procurement text is treated as untrusted data. This module cannot apply any image. */
(function(root){
  'use strict';
  const KINDS=Object.freeze(['company_seal','legal_representative_seal','bidder_signature']);
  const LABELS={company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字'};
  const MAX_TEXT=90000,MAX_ITEMS=32,MAX_DOCS=8,MAX_FILE=12*1024*1024,MAX_READ=24*1024*1024,MAX_EVIDENCE=8;
  const CTRL=/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
  const QUOTE=/报价(?:函|单|表|文件正文)|报价草稿/u;
  const QUOTE_SCOPE_ONLY=/^(?:附件[一二三四五六七八九十\d]+[：:]?\s*)?(?:格式[一二三123][：:]?\s*)?[《【（(]?(?:报价函|报价单|报价表|报价文件正文)[》】）)]?[：:]?$/u;
  const WHOLE_ATTACH=/全部(?:随附|所附|报价)?附件|所有(?:随附|所附|报价)?附件|各(?:份|项)附件|每(?:份|个)附件/u;
  const OTHER_ATTACH=/其他附件|其余附件|部分附件|附件[一二三四五六七八九十\d]+/u;
  const UNSUPPORTED=/骑缝|逐页|每页|各页|电子(?:印章|签章|公章|签名)|数字(?:签名|签章)|CA\s*(?:签名|签章)|亲笔|手写(?:签字|签名)|现场签字|签章平台|原件上|密封处/u;
  const NEG=/无需|无须|毋须|并非|不是所有|未要求|不(?:需要|须|必|得|可|用|应|要求|加盖|签字|签名|盖)|免(?:于)?盖|勿|禁止|不得/u;
  const ALT=/或\s*(?:由|加盖|盖|签|使用|用|选择|法人|法定代表人|投标人|公司|单位|公章)|(?:签字|签名|印章|盖章|公章|法人章|法定代表人|授权代表|投标人)\s*或|二选一|任选(?:其一|一项)?|或者|(?:签字|签名|盖章|公章|法人章|印章|名章)\s*[/／]\s*(?:签字|签名|盖章|公章|公司公章|单位公章|法人章|法定代表人)/u;
  const SELECTIVE=/仅(?:需|须|限|加盖)|只(?:需|须|盖)|只要/u;
  const EXCEPTION=/除外|除[^。；]{1,40}(?:外|以外)|除非|如有|如需|另有要求|视情况|待.{1,12}确认|可以|可(?:酌情|选择|自行|加盖|盖章|签字|签名)|建议加盖|原则上/u;
  const FOREIGN=/(?:由|交由|交给|请|限)\s*(?:采购人|采购方|发标方|发标单位|招标人|招标方|招标代理|委托方|客户|收件人|甲方|对方|业主)|(?:采购人|采购方|发标方|发标单位|招标人|招标方|招标代理|委托方|客户|收件人|甲方|对方|业主)\s*(?:应|须|需|签字|签名|盖章|公章|法人章|印章|[（(]\s*(?:签字|签名|盖章))/u;
  const DIRECT_BIDDER=/(?:由|并由|同时由|请|须|应|需)\s*(?:投标人|投标方|报价人|报价方)(?:本人)?(?:签字|签名)/u;
  const ACTION=/(?:须|应|需|必须|应当|请|要求|加盖|签字|签名|盖章|签章|无需|不需要|不得)/u;
  const PAST=/已(?:盖|加盖|签|经签署)|已(?:经)?由[^，。；]{1,24}(?:签字|签名|加盖|盖章)|(?:盖章|签字|签名)完成|已签章/u;
  const SAMPLE=/示例|样例|模板说明|例如|仅供参考|印章(?:样式|样张|图样|扫描件|图片|原图)|签名(?:样式|样张|图样|扫描件|图片|原图)|上传(?:公章|印章|签名|签字)/u;
  const SIGN_WORD=/公章|单位章|法人章|代表人章|盖章|签字|签名|签章|印章/u;
  const slots=(label)=>new RegExp('(?:[（(【\\[]\\s*(?:请)?(?:加盖)?'+label+'\\s*[）)】\\]]|(?:^|[：:；;，,。\\s])'+label+'\\s*[:：](?:\\s*[_＿—－.·\\s]+)?\\s*$)','u');
  const COMPANY='(?:(?:本公司|本单位|本所|我方|投标方|报价方|公司|单位|企业|事务所|供应商|投标人|报价人|投标单位|报价单位)?公章|单位章)';
  const LEGAL='(?:法人章|法定代表人(?:印章|名章|章))';
  // Only propagate a single explicit stamping verb through a contiguous list of
  // recognized seal names. In particular a nearby signature or incidental noun
  // is not another object of 加盖, and alternatives are handled by ALT.
  const SEAL_NOUN='(?:'+COMPANY+'|'+LEGAL+')';
  const SEAL_LIST=new RegExp('(?:加盖|盖上|盖)\\s*('+SEAL_NOUN+'(?:\\s*(?:、|，|,|以及|和|与|及)\\s*'+SEAL_NOUN+')+)(?=$|\\s*(?:[、，,。；;：:）)】]|并|且|后|均))','gu');
  const BIDDER='(?:(?:投标人|投标方|报价人|报价方)(?:本人)?(?:手写)?(?:签字|签名))';
  const actions=(label)=>new RegExp('(?:(?:必须|应当|应|须|需|要求|请|分别|并|同时|再|后)?\\s*(?:由[^，,。；;：:]{1,22})?\\s*(?:加盖|盖上|盖|签署)\\s*'+label+'|(?:必须|应当|应|须|需|要求|请)\\s*(?:由)?\\s*'+label+')','u');
  const COMPANY_FORM=/(?:供应商|投标人|投标方|投标单位|报价人|报价单位|报价方|单位名称|事务所|单位)\s*[（(]\s*(?:加盖)?(?:单位)?(?:公章|盖章|单位章)\s*[）)]/u;
  const LEGAL_FORM=/(?:法人|法定代表人)\s*[（(]\s*(?:加盖)?(?:印章|名章|法人章|法定代表人章|盖章)\s*[）)]|(?:由)?(?:法人|法定代表人)(?:应|须|需)?加盖(?:本人)?(?:印章|名章)/u;
  const BIDDER_FORM=/(?:投标人|投标方|报价人|报价方)\s*[（(]\s*(?:本人)?(?:签字|签名)\s*[）)]/u;
  const DIRECT_ROLE=/法定代表人|法人代表|授权代表|被授权人|委托代理人|经办人|项目负责人/u;
  const SPECIAL_SIGNER=/(?:法定代表人|法人代表|授权代表|被授权人|委托代理人|经办人|项目负责人)(?:本人)?\s*(?:应当|应|须|需)?\s*[（(]?\s*(?:亲笔)?(?:签字|签名)/u;
  const MARKERS={
    company_seal:[new RegExp(COMPANY,'u'),slots(COMPANY),actions(COMPANY),COMPANY_FORM,/\{\{company_seal\}\}|\[\[公司公章\]\]/u],
    legal_representative_seal:[new RegExp(LEGAL,'u'),slots(LEGAL),actions(LEGAL),LEGAL_FORM,/\{\{legal_representative_seal\}\}|\[\[法人章\]\]/u],
    bidder_signature:[new RegExp(BIDDER,'u'),slots(BIDDER),actions(BIDDER),BIDDER_FORM,/\{\{bidder_signature\}\}|\[\[投标人签字\]\]/u]
  };
  const aliases={business_license:['营业执照','营业执照副本'],practice_certificate:['执业证书','会计师事务所执业证书','执业许可证','执业许可证明']};
  const privateNames=/身份证|护照|银行卡|账号|营业执照|执业(?:许可证|证书)|登记证|纳税(?:申报|证明)|资质证书|财务报表|审计报告|签字图|公章图/u;
  const SELF=/^(?:(?:本|该|此)(?:附件|表|页|文件|声明|承诺书|授权书|证明|函|资料)|签章栏|盖章处|签字栏)/u;
  const negStrong=/不得|禁止|勿/u;
  const clean=v=>String(v??'').slice(0,MAX_TEXT+1).normalize('NFKC').replace(/\r\n?/g,'\n').replace(CTRL,'').slice(0,MAX_TEXT);
  const compact=v=>clean(v).replace(/\s+/g,'').toLowerCase();
  const plainName=v=>clean(v).split(/[\\/]/u).at(-1).slice(0,260);
  function matchNames(item){
    const n=plainName(item.name),stem=n.replace(/\.[a-z0-9]{1,8}$/i,'').trim();
    // Never equate generic labels such as “附件” or “扫描件” with a particular file.
    return [...new Set([n,stem,...(aliases[item.role]||[])].map(compact))]
      .filter(v=>v.length>=3&&!/^(?:其余附件|其他附件|附件[0-9一二三四五六七八九十]*|扫描件|原件|复印件)$/u.test(v));
  }
  function itemArray(items){
    if(!Array.isArray(items)||items.length>MAX_ITEMS)throw Error('待核对的文件过多，请分批处理。');
    const used=new Set();
    return items.map(item=>{
      if(!item||typeof item.id!=='string'||!item.id||item.id.length>140||used.has(item.id))throw Error('待核对文件标识无效或重复。');
      used.add(item.id);
      const type=item.type==='quote'?'quote':'attachment';
      return {...item,type,names:type==='attachment'?matchNames(item):[],suggested:new Set(),prohibited:new Set(),manual:new Set(),notes:new Set(),evidence:new Set()};
    });
  }
  const evidence=(item,source,text)=>{
    if(item.evidence.size<MAX_EVIDENCE)item.evidence.add(source+'：'+clean(text).replace(/\s+/g,' ').trim().slice(0,170));
  };
  function nearPrefix(s){
    // Limit name matching to the described subject, not cross-references that appear after an instruction.
    const i=s.search(/(?:必须|应当|须|需要|无需|不必|不须|不需要|不得|禁止|请|应由|应加盖|应签|应盖|需由|需加盖|需签|加盖|盖(?:公司)?公章|盖法人章|盖单位章|盖章|签字|签名|签章)/u);
    return compact(i>0?s.slice(0,i):s);
  }
  function scope(s,rows){
    const sub=nearPrefix(s),files=rows.filter(r=>r.type==='attachment'&&r.names.some(n=>sub.includes(n)));
    const allQuotes=rows.filter(r=>r.type==='quote'),all=rows.filter(r=>r.type==='attachment');
    const refs=[...sub.matchAll(/格式(?:第)?([0-9]+|[一二三四五六七八九十]+)(?:号)?/gu)];
    const scopedFormat=refs.length&&(QUOTE.test(sub)||/^格式(?:第)?(?:[0-9]+|[一二三四五六七八九十]+)(?:号)?[：:]?$/u.test(sub));
    const isQuote=QUOTE.test(sub)||!!scopedFormat,explicitAll=WHOLE_ATTACH.test(sub),inconclusive=OTHER_ATTACH.test(sub)||/附件/u.test(sub);
    let quote=allQuotes;
    if(scopedFormat){
      const indices=refs.map(m=>({一:'1',二:'2',三:'3'})[m[1]]||m[1]);
      const shorthand=refs.some(m=>/^[至到~～、/或-][0-9一二三四五六七八九十]/u.test(sub.slice(m.index+m[0].length)));
      if(shorthand||indices.some(x=>!['1','2','3'].includes(x))||/或/u.test(sub))return {hits:allQuotes,certain:false,formatAmbiguous:true};
      quote=allQuotes.filter(r=>{
        const id=String(r.formatId||r.id).match(/(?:^|:)format([1-3])$/);
        return id&&indices.includes(id[1]);
      });
      if(!quote.length&&!explicitAll&&!files.length)return {hits:[],certain:true,ignore:true};
    }
    if(explicitAll){
      if(isQuote&&/且|以及|及|和|与|、/u.test(sub))return {hits:[...quote,...all],certain:true};
      if(isQuote)return {hits:[...quote,...all],certain:false};
      return {hits:all,certain:true};
    }
    if(files.length){
      if(isQuote&&(!inconclusive||/和|与|以及|及|、/u.test(sub)))return {hits:[...quote,...files],certain:false};
      // Two similarly named attachments, or a mixed scope, should never share an inferred mark.
      return {hits:files,certain:files.length===1&&!/其他附件|其余附件|部分附件/u.test(sub)};
    }
    if(isQuote&&(!inconclusive||QUOTE_SCOPE_ONLY.test(sub)||/^附件[一二三四五六七八九十\d]+[：:（(]?(?:报价函|报价单|报价表)[）)]?$/u.test(sub)))return {hits:quote,certain:true};
    if(inconclusive)return {hits:all,certain:false};
    return {hits:[],certain:false};
  }
  function markers(s,allowBare){
    const hit=[];
    const shared=allowBare?'':Array.from(s.matchAll(SEAL_LIST),m=>m[1]).join('；');
    for(const k of KINDS){
      const [noun,slot,action,form,placeholder]=MARKERS[k];
      if(slot.test(s)||action.test(s)||form.test(s)||placeholder.test(s)||(k==='bidder_signature'&&DIRECT_BIDDER.test(s))||(allowBare&&noun.test(s))||(k!=='bidder_signature'&&noun.test(shared)))hit.push(k);
    }
    return hit;
  }
  function clauses(text,rows){
    const out=[];
    for(const chunk of clean(text).split(/[\n。；;！？!?]+/u)){
      if(!chunk.trim())continue;
      // Independently scoped instructions after a comma are evaluated separately;
      // however exceptions and alternatives stay attached to the preceding instruction.
      let current='';
      for(const part of chunk.split(/[，,]/u)){
        const q=part.trim();if(!q)continue;
        const independent=ACTION.test(q)&&scope(q,rows).hits.length&&!/^(?:但|除|另有|除非|如果|除外|或|而且|并)/u.test(q);
        if(current&&independent&&ACTION.test(current)&&scope(current,rows).hits.length){
          out.push(current);current=q;
        }else current+=(current?'，':'')+q;
      }
      if(current)out.push(current);
      if(out.length>=800)break;
    }
    return out;
  }
  function applyClause(item,s,source){
    const text=s.trim();
    if(!SIGN_WORD.test(text)&&!/\{\{(?:company_seal|legal_representative_seal|bidder_signature)\}\}/u.test(text))return;
    const hasNeg=NEG.test(text),ambiguous=ALT.test(text)||UNSUPPORTED.test(text)||SAMPLE.test(text)||FOREIGN.test(text)||/\b(?:e-sign|electronic signature)\b/i.test(text);
    const strong=markers(text,false),kindWords=markers(text,true);
    evidence(item,source,text);
    if(hasNeg){
      const targetedNeg=kindWords.length&&text.split(/[，,、]|(?:而|但|并|且)(?=由|须|需|加盖|签)/u).every(t=>!SIGN_WORD.test(t)||NEG.test(t));
      const blocked=targetedNeg?kindWords:KINDS;
      for(const k of blocked)item.prohibited.add(k);
      if(!targetedNeg||ambiguous||SELECTIVE.test(text)||EXCEPTION.test(text)){
        item.notes.add('含否定、条件或例外；未自动套用这条要求，请核对。');item.manual.add('conditional');
      }else{
        item.notes.add((negStrong.test(text)?'明确限制：':'明确不要求：')+blocked.map(k=>LABELS[k]).join('、')+'。');
      }
      return;
    }
    if(ambiguous||SELECTIVE.test(text)||EXCEPTION.test(text)||/以.*为准|按采购文件|按招标文件/u.test(text)){
      const restricted=kindWords.length?kindWords:ALT.test(text)&&/法定代表人|法人代表|法人/u.test(text)&&!FOREIGN.test(text)?['legal_representative_seal','bidder_signature']:KINDS;
      for(const k of restricted)item.prohibited.add(k);
      item.notes.add('含任选、条件、签章方式或位置限制，未自动选择，请按原要求核对。');item.manual.add('ambiguous');return;
    }
    if(PAST.test(text)&&!/(?:另|仍|再)(?:须|需|应)/u.test(text))return;
    for(const k of strong)item.suggested.add(k);
    // An unspecified stamp, a human other than the selected firm's bidder, or any generic
    // “签字盖章” is an unresolved requirement even if another explicit mark was recognized.
    const unidentified=/签字|签名/u.test(text)&&!strong.includes('bidder_signature')
      ||/盖章|签章|印章/u.test(text)&&!strong.some(k=>k!=='bidder_signature');
    if(SPECIAL_SIGNER.test(text)||unidentified||!strong.length){
      item.notes.add('存在未指明章种、签署人或明确落点的文字，请人工核对。');item.manual.add('undefined');
    }
  }
  function analyzeGlobal(text,rows){
    let header=null;
    for(const c of clauses(text,rows)){
      const scoped=scope(c,rows),hasSigns=SIGN_WORD.test(c);
      if(scoped.ignore){header=null;continue;}
      if(!hasSigns){
        const knownHeading=scoped.certain&&scoped.hits.length&&(QUOTE_SCOPE_ONLY.test(c)||/^(?:附件[一二三四五六七八九十\d]+[：:]|[《【]).{2,220}[》】]?[：:]?$/u.test(c));
        header=knownHeading?scoped.hits:null;continue;
      }
      if(scoped.certain&&scoped.hits.length){
        for(const row of scoped.hits)applyClause(row,c,'采购要求');header=null;continue;
      }
      if(!scoped.hits.length&&header&&c.length<=160&&!/附件|报价|另|其他/u.test(c)){
        for(const row of header)applyClause(row,c,'采购要求（前一明确标题）');header=null;continue;
      }
      const fallback=scoped.hits.length?scoped.hits:scoped.formatAmbiguous?[]:rows;
      for(const row of fallback){
        evidence(row,'适用文件待核对',c);
        row.manual.add('scope');
        // Ambiguous scope must not silently pre-select a mark from a template default.
        for(const k of KINDS)row.prohibited.add(k);
        row.notes.add('采购文字提到签章，但未明确对应此文件；请逐件核对。');
      }
      header=null;
    }
  }
  function sourceKind(name,mime){
    if(/\.docx$/i.test(name)||mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')return 'docx';
    if(/\.pdf$/i.test(name)||mime==='application/pdf')return 'pdf';
    if(/\.txt$/i.test(name)||mime==='text/plain')return 'txt';
    return '';
  }
  const hasBytes=x=>ArrayBuffer.isView(x)&&x.BYTES_PER_ELEMENT===1&&x.byteLength>0;
  function joinLines(body){
    if(!Array.isArray(body?.lines))return '';
    return clean(body.lines.slice(0,5000).map(s=>typeof s==='string'?s.slice(0,1200):'').join('\n'));
  }
  async function docText(name,mime,bytes){
    if(!hasBytes(bytes)||bytes.byteLength>MAX_FILE)throw Error('请选择不超过 12 MiB 的可读文件。');
    const kind=sourceKind(name,mime),u=new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(kind==='txt')return clean(new TextDecoder('utf-8',{fatal:true}).decode(u));
    if(kind==='pdf'&&root.BidderPdfText?.read)return joinLines(await root.BidderPdfText.read(u));
    if(kind==='docx'&&root.TenderImport?.readVisibleText){
      const file={name:plainName(name),size:u.byteLength,arrayBuffer:async()=>u.slice().buffer};
      return joinLines(await root.TenderImport.readVisibleText(file));
    }
    throw Error('仅支持有文字层的 PDF、DOCX 或 UTF-8 文本。扫描件及图片不作 OCR。');
  }
  async function readRequirements(file){
    if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE||typeof file.arrayBuffer!=='function')throw Error('请选择不超过 12 MiB 的 DOCX、PDF 或文本文件。');
    const kind=sourceKind(file.name,file.type);if(!kind)throw Error('仅支持 DOCX、PDF 和 UTF-8 文本。扫描件及图片不作 OCR。');
    let text;try{const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.byteLength!==file.size)throw Error();text=await docText(file.name,file.type,bytes);}catch{throw Error('未能读取文件文字，请手工输入明确的章签要求。');}
    if(!text.trim())throw Error('未找到可读文字；如为扫描件，请手工输入明确的章签要求。');
    return Object.freeze({text,notes:Object.freeze(['仅提取本机可见文字，不作 OCR；请核对哪些要求对应哪些文件。'])});
  }
  async function review({requirementsText='',items=[]}={}){
    const rows=itemArray(items);
    for(const row of rows){
      for(const k of (row.type==='quote'&&Array.isArray(row.defaultKinds)?row.defaultKinds:[])){
        if(KINDS.includes(k)){row.suggested.add(k);evidence(row,'模板明示',LABELS[k]);}
      }
    }
    analyzeGlobal(requirementsText,rows);
    let docs=0,read=0;
    for(const row of rows){
      if(row.type!=='attachment')continue;
      if(aliases[row.role]||privateNames.test(plainName(row.name)))continue;
      let t=typeof row.text==='string'?clean(row.text):'';
      if(!t&&hasBytes(row.bytes)&&sourceKind(row.name,row.mime)){
        if(docs>=MAX_DOCS||row.bytes.byteLength>MAX_FILE||read+row.bytes.byteLength>MAX_READ){
          row.notes.add('附件正文超出本次有界识别范围，请人工核对。');row.manual.add('limit');continue;
        }
        docs++;read+=row.bytes.byteLength;
        try{t=await docText(row.name,row.mime,row.bytes);}catch{}
        if(!t.trim()){row.notes.add('没有可靠的附件文字层，需人工核对；未作 OCR。');row.manual.add('notext');continue;}
      }
      for(const c of clauses(t,rows)){
        const as=scope(c,rows);
        const slot=(markers(c,false).length||DIRECT_ROLE.test(c)&&SIGN_WORD.test(c))&&/[:：][\s_＿—－.·]*$|\s*[（(【\[][^）)】\]]{1,25}[）)】\]]\s*$|(?:\{\{|\[\[)/u.test(c);
        const selfInstruction=SELF.test(c)&&ACTION.test(c)&&!QUOTE.test(c)&&scope(c.replace(SELF,''),rows).hits.every(x=>x.id===row.id);
        // A self-referential instruction or an exact placeholder only. Generic provisions about
        // a quoted price/another attachment must not sign the current file itself.
        if((slot&&!as.hits.some(x=>x.id!==row.id)&&!QUOTE.test(nearPrefix(c)))||selfInstruction||(as.certain&&as.hits.length===1&&as.hits[0]===row))
          applyClause(row,c,'附件可读正文');
      }
    }
    return Object.freeze(rows.map(r=>{
      for(const k of r.prohibited)if(r.suggested.has(k)){r.notes.add('原先建议的「'+LABELS[k]+'」与限制或不明确文字并存，已取消自动选择。');r.manual.add('conflict');}
      const kinds=KINDS.filter(k=>r.suggested.has(k)&&!r.prohibited.has(k));
      if(!kinds.length&&!r.prohibited.size){r.notes.add('没有发现明确的章签要求，不自动选择；请核对原文件。');r.manual.add('unknown');}
      return Object.freeze({id:r.id,kinds:Object.freeze(kinds),uncertain:!!r.manual.size,notes:Object.freeze([...r.notes]),evidence:Object.freeze([...r.evidence])});
    }));
  }
  const api=Object.freeze({KINDS,review,readRequirements});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QuoteSignRequirements=api;
})(globalThis);
