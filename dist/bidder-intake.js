/* Local-only bidder intake. Archive entries and document text are untrusted evidence, not instructions. */
(function(root){
  'use strict';
  const MiB=1024*1024, MAX_FILE=3*MiB, MAX_TEXT=12*MiB, MAX_ATTACHMENTS=64*MiB, MAX_ENTRIES=1000, MAX_GROUPS=50, MAX_PROFILES=50;
  const kinds=['business_license','practice_certificate','company_seal','legal_representative_seal','bidder_signature'];
  const captions={business_license:'营业执照',practice_certificate:'执业证书',company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字'};
  const labels={
    name:['投标方名称','投标人名称','投标单位名称','事务所名称','会计师事务所名称','企业名称','公司名称','单位名称','机构名称','全称'],
    team:['执行团队所在省级地区','执行团队所在地','执行团队所在省份'],
    contactName:['本方联系人','投标方联系人','投标联系人','投标人联系人','联系人'],
    phone:['本方联系电话','本方电话','投标联系人电话','联系人电话','联系电话','办公电话','手机号码','手机号','电话','联系方式'],
    email:['本方联系邮箱','本方邮箱','投标联系邮箱','电子邮箱','联系邮箱','电子邮件','E-mail','Email','邮箱']
  };
  const keys=Object.keys(labels), aliases=Object.fromEntries(keys.flatMap(k=>labels[k].map(s=>[s.toLowerCase(),k])));
  const labelPattern=Object.keys(aliases).sort((a,b)=>b.length-a.length).join('|');
  const fieldRE=()=>new RegExp('(?:^|[\\t 　，,；;])('+labelPattern+')\\s*[:：\\t]\\s*','gi');
  const labelOnly=new RegExp('^('+labelPattern+')\\s*[:：]?$','i');
  const prohibited=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
  const orgEnd=/(?:会计师事务所(?:[（(](?:特殊普通合伙|普通合伙|有限合伙|合伙制|有限责任公司)[）)])?|有限责任公司|股份有限公司|有限公司|审计事务所|分公司)$/u;
  const badDoc=/发标|招标|采购|被审计|审计报告|合同|评审|项目业绩|人员|业绩|案例|客户|样例|邀请函|报价函|模板/;
  const profileWord=/投标(?:人|方|单位)(?:基本)?(?:情况|信息|资料|简介)|(?:公司|企业|事务所|单位|机构)(?:基本情况|基本信息|基础信息|基本资料|简介|介绍)|基础信息|基本资料|投标方登记/;
  const category=/^(?:基础资料|投标资料|投标材料|资料|证照|证书|证照资料|资质|资质资料|营业执照|执业证书|证件|附件|印章|盖章|签字|图片|资料包|体系认证证书|公司简介|公司介绍|企业简介|企业介绍)$/;
  const normalize=s=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const baseName=s=>s.split('/').at(-1);
  const pathParts=s=>s.split('/');
  const clean=s=>s.normalize('NFC').trim().replace(/[；;，,]+$/u,'').trim();
  function nameOf(s){
    const n=clean(s);
    return n.length>=4&&n.length<=150&&!prohibited.test(n)&&!/[/\\<>:：，,。；;=@]|^(?:名称|未填|待填|请选择|请填写|xxx|xx公司|企业名称)/iu.test(n)&&orgEnd.test(n)?n:'';
  }
  function leafWithoutExtension(s){return baseName(s).replace(/\.[a-z0-9]+$/i,'');}
  const practiceLabel='执业(?:许可)?证书|执业许可证|执业证明';
  const practiceName=new RegExp('(?:会计师事务所|^|[-_ .·—])(?:'+practiceLabel+')(?=$|[\\s([_\\-·—]|副本|正本|扫描件|原件|复印件|电子版)','u');
  // Common archive prefixes ("02. 执业证明", "附件 2：…") and
  // unambiguous role aliases; generic stamp/signature files stay unassigned.
  function unnumber(s){return s.replace(/^(?:附件\s*)?(?:\(\d{1,3}\)|\d{1,3}[.、:_-]|\d{1,3}\s+)[\s.、:_-]*/u,'');}
  function candidateKind(s){
    const f=baseName(s).normalize('NFKC'),ext=/\.[a-z0-9]+$/i.exec(f)?.[0].toLowerCase()||'',stem=unnumber(f.slice(0,f.length-ext.length).trim());
    if(!['.pdf','.png','.jpg','.jpeg'].includes(ext))return '';
    if(/营业执照/.test(stem)&&!/委托|申请|说明|变更登记|下载说明|模板/.test(stem))return 'business_license';
    if(practiceName.test(stem)&&!/注册会计师|人员|个人|注册证|签字|申请|承诺|说明|模板|委托/.test(stem))return 'practice_certificate';
    if(ext==='.pdf')return '';
    const role=stem.replace(/(?:[\s_-]*(?:\([^)]{0,25}\)|透明(?:底)?|原件|扫描件|电子版|图片))$/u,'');
    if(!/授权|说明|委托|样章|模板|财务|合同|发票|业务专用|法人/.test(stem)&&/(?:^公章$|(?:公司|企业|事务所|单位)(?:公章|印章)$)/u.test(role))return 'company_seal';
    if(!/授权|说明|委托|样章|模板/.test(stem)&&/(?:法人章|法定代表人(?:印章|名章|章))$/u.test(role))return 'legal_representative_seal';
    if(!/授权书|说明|委托书|模板/.test(stem)&&/(?:投标人|投标方|投标代表|授权代表)(?:手写)?(?:签字|签名)$/u.test(role))return 'bidder_signature';
    return '';
  }
  function canonicalTeam(s){
    const n=normalize(s);
    if(!n)return '';
    for(const p of root.RuleCatalog?.PROVINCES||[]){
      if(normalize(p.name)===n||normalize(p.name.replace(/(?:省|市|自治区|壮族自治区|回族自治区|维吾尔自治区|特别行政区)$/,''))===n)
        return ({450000:'广西',130000:'河北',310000:'上海'})[p.code]||p.name;
      if(({450000:'广西',130000:'河北',310000:'上海',150000:'内蒙古',640000:'宁夏',650000:'新疆',540000:'西藏',810000:'香港',820000:'澳门'})[p.code]===n)
        return ({450000:'广西',130000:'河北',310000:'上海'})[p.code]||p.name;
    }
    return ['广西','河北','上海'].includes(n)?n:'';
  }
  function valueOf(k,v){
    const s=clean(v);
    if(!s||prohibited.test(s)||/[<>]/u.test(s))return '';
    if(k==='name')return nameOf(s);
    if(k==='team')return canonicalTeam(s);
    if(k==='email')return s.length<=120&&/^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(s)?s:'';
    if(k==='phone'){
      const v=s.normalize('NFKC'),n=v.replace(/[^0-9]/g,'');
      return n.length>=7&&n.length<=19&&/^\+?[\d ()-]+(?:\s*(?:转|分机|ext\.?)\s*\d{1,8})?$/i.test(v)?v:'';
    }
    if(k==='contactName')return /^(?:[\u3400-\u9fff·]{2,10}|[A-Za-z][A-Za-z .'-]{1,40})$/u.test(s)&&!/联系人|待填|电话|邮箱|采购方|法定代表人|见附件/.test(s)?s:'';
    return '';
  }
  function textProfile(lines,tables=[]){
    const out=Object.fromEntries(keys.map(k=>[k,new Map()]));
    const add=(label,value)=>{
      const k=aliases[label.toLowerCase()];if(!k)return;
      const parts=k==='email'?value.split(/[\s/、，,；;]+/u):k==='phone'||k==='contactName'?value.split(/[/、，,；;]+/u):[value];
      for(const piece of parts.slice(0,16)){
        const v=valueOf(k,piece);if(!v)continue;
        const code=k==='phone'?v.replace(/[\s()-]/g,''):normalize(v);
        if(!out[k].has(code))out[k].set(code,v);
      }
    };
    const row=s=>String(s||'').replace(/([\u3400-\u9fff])[ 　]+(?=[\u3400-\u9fff])/g,'$1').trim();
    for(let i=0;i<lines.length&&i<4000;i++){
      const l=row(lines[i]);if(l.length>750)continue;
      const matches=[...l.matchAll(fieldRE())];
      for(let j=0;j<matches.length;j++){
        const m=matches[j],str=l.slice(m.index+m[0].length,matches[j+1]?.index??l.length).trim();
        add(m[1],str||(!matches[j+1]&&i+1<lines.length?row(lines[i+1]):''));
      }
      if(!matches.length){const m=l.match(labelOnly);if(m&&i+1<lines.length)add(m[1],row(lines[i+1]));}
    }
    // A labelled header row followed by a value row is also supported, but
    // never infer headings from mixed rows or borrow cells across tables.
    for(const table of tables.slice(0,100)){
      const rs=table.rows||[];
      for(let i=0;i+1<rs.length&&i<400;i++){
        const headers=rs[i],values=rs[i+1];
        if(headers.length<2||headers.length>keys.length||headers.length!==values.length)continue;
        const ks=headers.map(v=>row(v).match(labelOnly)?.[1]);
        if(ks.every(Boolean)&&new Set(ks.map(k=>aliases[k.toLowerCase()])).size===ks.length&&values.every(v=>!labelOnly.test(row(v))))
          ks.forEach((k,j)=>add(k,row(values[j])));
      }
    }
    return out;
  }
  function profileDoc(s){
    const f=baseName(s),p=s.split('/').slice(0,-1);
    if(!/\.(?:docx?|pdf|txt|rtf|odt|xlsx?|ods|csv|tsv)$/i.test(f)||badDoc.test(f))return false;
    // PDF/company profile can also be identified by its enclosing document class;
    // a free-standing tender, audited financial report or personal file never supplies contact data.
    return profileWord.test(f)||p.some(v=>profileWord.test(v)&&!badDoc.test(v));
  }
  function filenameEvidence(s){
    const n=leafWithoutExtension(s),hits=[];
    let m;
    if((m=/^(.*?)\s*[-_]\s*(?:营业执照|会计师事务所执业(?:许可)?证书)(?:\b|[\s（(_\-]|$)/u.exec(n))&&nameOf(m[1]))hits.push({name:nameOf(m[1]),strong:true});
    if((m=/^(?:三体系|体系认证(?:证书)?|资质证书)\s*[-_]\s*(.+)$/u.exec(n))&&nameOf(m[1]))hits.push({name:nameOf(m[1]),strong:false});
    if((m=/^(.+?)\s+(?:19|20)\d{2}\s*年度财务报表审计报告(?:.*)$/u.exec(n))&&nameOf(m[1]))hits.push({name:nameOf(m[1]),strong:false});
    return hits;
  }
  function grouping(rows){
    let common=0;
    for(;;){
      const p=rows[0]?.parts[common];
      if(!p||rows.some(r=>r.parts.length<=common+1||r.parts[common]!==p))break;
      common++;
    }
    const branch=new Map();
    for(const r of rows){const b=r.parts.length>common+1?r.parts[common]:'';
      if(b&&!category.test(b)){if(!branch.has(b))branch.set(b,new Set());if(r.kind)branch.get(b).add(r.kind);}
    }
    const separated=new Set([...branch].filter(([,v])=>v.has('business_license')&&v.has('practice_certificate')).map(([b])=>b));
    if(separated.size<2)separated.clear();
    const groups=new Map();
    for(const r of rows){
      // Prefer an explicit firm directory. Otherwise split only sibling bundles
      // with independent two-certificate sets; category folders are not firms.
      let idx=-1,claimed='';
      for(let i=0;i<r.parts.length-1;i++){const n=nameOf(r.parts[i]);if(n){idx=i;claimed=n;break;}}
      if(idx<0&&r.parts.length>common+1&&separated.has(r.parts[common]))idx=common;
      const id=idx<0?'':r.parts.slice(0,idx+1).join('/');
      if(!groups.has(id))groups.set(id,{id,claimed,rows:[]});
      groups.get(id).rows.push(r);
    }
    return [...groups.values()].filter(g=>g.rows.some(r=>r.kind||r.profile));
  }
  function textObject(bytes,name){
    return {name,size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer};
  }
  function readTxt(bytes){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(text.length>100000||text.includes('\0'))throw Error('invalid text');
    return {lines:text.split(/\r?\n/)};
  }
  async function documentBody(r,bytes,strictDocuments=false){
    if(strictDocuments&&root.File)await packagePreflight(new root.File([bytes],baseName(r.name)),r.name.split('.').at(-1).toLowerCase());
    if(/\.docx$/i.test(r.name)&&root.TenderImport?.readVisibleText)return root.TenderImport.readVisibleText(textObject(bytes,r.name));
    if(/\.txt$/i.test(r.name))return readTxt(bytes);
    if(/\.pdf$/i.test(r.name)&&root.BidderPdfText?.read)return root.BidderPdfText.read(bytes);
    if(root.AuditPreviewReaders?.read)return flatten(await root.AuditPreviewReaders.read({blob:new root.Blob([bytes]),name:r.name}));
    return null;
  }
  const empty=()=>Object.fromEntries(keys.map(k=>[k,'']));
  function recordsFor(group,docInfo,selected,warnings){
    const notes=[],guesses=new Map(),qualified=new Set();
    const add=(n,strong)=>{
      const k=normalize(n);
      if(!guesses.has(k))guesses.set(k,{n,count:0});
      guesses.get(k).count++;
      if(strong)qualified.add(k);
    };
    if(group.claimed)add(group.claimed,true);
    for(const r of group.rows)for(const v of filenameEvidence(r.clean))add(v.name,v.strong);
    for(const p of docInfo)for(const n of p.data.name.values())add(n,true);
    const eligible=[...guesses].filter(([k,v])=>qualified.has(k)||v.count>=2);
    // A conflicting name from independent materials is a reason not to attach
    // unlabelled credentials/images to any firm in this directory.
    const ambiguous=eligible.length>1||eligible.length===1&&docInfo.some(p=>p.data.name.size>1);
    const candidates=eligible.length?eligible:[['',{n:''}]];
    if(!eligible.length)notes.push('未找到可可靠归属的事务所名称，请手工填写。');
    if(ambiguous){notes.push('资料中出现多个事务所名称，未把同目录附件自动分配给任何一所。');warnings.push('有资料目录出现多个机构名称，请核对各所归属。');}
    return candidates.map(([id,v])=>{
      const n=[...notes],fields=empty(),files=Object.create(null),alternatives=Object.create(null);
      fields.name=v.n;
      const nameSources=docInfo.filter(p=>p.data.name.has(id));
      if(id&&nameSources.length)n.push('名称来自「'+nameSources.map(p=>p.name).join('」「')+'」的明确字段，请核对。');
      else if(id)n.push('名称根据资料目录或文件名候选匹配，请与两证核对。');
      // Only populate contact data from a same-named, unambiguous self profile.
      for(const k of keys.filter(x=>x!=='name')){
        const out=new Map();
        for(const p of docInfo.filter(x=>id&&x.data.name.size===1&&x.data.name.has(id))){
          for(const [v,value] of p.data[k]){
            if(!out.has(v))out.set(v,{value,sources:new Set()});
            out.get(v).sources.add(p.name);
          }
        }
        if(out.size===1){
          const hit=out.values().next().value;fields[k]=hit.value;
          n.push(labels[k][0]+'来自「'+[...hit.sources].join('」「')+'」的明确字段，请核对。');
        }
        else if(out.size>1){
          alternatives[k]=[...out.values()].slice(0,12).map(hit=>hit.value);
          n.push(labels[k][0]+'有多个候选，未自动填写。');
        }
      }
      if(!ambiguous)for(const k of kinds){
        const hits=group.rows.filter(r=>r.kind===k);
        if(hits.length>1){n.push('有多份'+captions[k]+'候选，未自动选择。');continue;}
        if(!hits.length)continue;
        const r=hits[0],bytes=selected.get(r.name);
        if(!bytes){n.push(captions[k]+'超过 3 MiB 或不可读取，请手工核对。');continue;}
        files[k]={name:baseName(r.clean),bytes,sourcePath:r.clean};
      }
      if(!fields.team)n.push('执行团队所在地不能从办公或注册地址推定，请核对后填写。');
      return {fields,files,notes:n,alternatives};
    });
  }
  async function read(archive,{strictDocuments=false}={}){
    if(!archive||!Array.isArray(archive.entries)||archive.entries.length>MAX_ENTRIES||typeof archive.read!=='function')throw Error('资料压缩包格式无效或文件过多。');
    const used=new Set();
    const rows=archive.entries.filter(e=>!e?.directory).map(e=>{
      if(!e||typeof e.name!=='string'||e.name.length>800||prohibited.test(e.name)||!Number.isSafeInteger(e.size)||e.size<0)throw Error('资料压缩包清单无效。');
      const clean=e.name.replace(/\\/g,'/'),parts=pathParts(clean),key=clean.normalize('NFC').toLowerCase();
      if(parts.some(x=>!x||x==='.'||x==='..'||x.includes(':'))||used.has(key))throw Error('资料压缩包清单含不安全或重复路径。');
      used.add(key);
      return {name:e.name,clean,size:e.size,parts,kind:candidateKind(clean),profile:profileDoc(clean)};
    });
    const inventory=rows.map(r=>r.clean),groups=grouping(rows),warnings=[];
    if(groups.length>MAX_GROUPS)throw Error('可识别的事务所目录过多，请分批导入。');
    // Read bounded per-group chunks. At most 8 profile files / 24 MiB in total
    // are used for text extraction. Larger/other files are still in the inventory.
    let remainingDocs=8,remainingText=24*MiB,remainingAttachments=MAX_ATTACHMENTS;
    const profiles=[];
    let unavailable=false,skippedText=false;
    for(const g of groups){
      const eligible=g.rows.filter(r=>r.kind&&g.rows.filter(x=>x.kind===r.kind).length===1&&r.size>0&&r.size<=MAX_FILE);
      remainingAttachments-=eligible.reduce((sum,r)=>sum+r.size,0);
      if(remainingAttachments<0)throw Error('可导入的证照和签章合计超过 64 MiB，请按事务所拆分资料包后再试。');
      const docs=[];
      for(const r of g.rows.filter(r=>r.profile)){
        if(/\.pdf$/i.test(r.name)&&!root.BidderPdfText?.read||/\.docx$/i.test(r.name)&&!root.TenderImport?.readVisibleText){unavailable=true;continue;}
        if(remainingDocs===0||r.size<=0||r.size>MAX_TEXT||r.size>remainingText){skippedText=true;continue;}
        remainingDocs--;remainingText-=r.size;docs.push(r);
      }
      const all=[...new Map([...eligible,...docs].map(r=>[r.name,r])).values()];
      const bytes=all.length?await archive.read(all.map(r=>r.name)):new Map(),selected=new Map();
      if(!(bytes instanceof Map))throw Error('未能读取资料条目。');
      for(const r of all){
        const data=bytes.get(r.name);
        if(!(data instanceof Uint8Array)||data.byteLength!==r.size)throw Error('资料文件读取不完整。');
        selected.set(r.name,data);
      }
      const docInfo=[];
      for(const r of docs){
        try{
          const body=await documentBody(r,selected.get(r.name),strictDocuments);
          if(!body?.lines?.length){skippedText=true;continue;}
          docInfo.push({name:baseName(r.clean),data:textProfile(body.lines,body.tables)});
        }catch(e){skippedText=true;if(strictDocuments)warnings.push(baseName(r.name)+'：'+(e.message||'文档读取失败。'));}
      }
      const records=recordsFor(g,docInfo,selected,warnings);
      if(profiles.length+records.length>MAX_PROFILES)throw Error('可识别的事务所候选过多，请分批导入。');
      profiles.push(...records);
    }
    if(unavailable)warnings.push('当前环境缺少某类文档文本组件；这些文件仍在清单中。');
    if(skippedText)warnings.push('部分介绍或基础资料没有可读文本、超限或格式不受支持；扫描件不作文字识别，请手工核对。');
    if(!profiles.length)warnings.push('未找到可识别的事务所基础资料、两证或签章文件；仅显示文件清单。');
    warnings.push('识别仅作待核对草稿；不核验证照或签章，不自动保存、盖章、签字或外发。');
    return {profiles,inventory,warnings:[...new Set(warnings)]};
  }
  const CERTS=['business_license','practice_certificate'];
  const SOURCE_TYPES=Object.freeze({pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',txt:'text/plain',rtf:'application/rtf',odt:'application/vnd.oasis.opendocument.text',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',ods:'application/vnd.oasis.opendocument.spreadsheet',csv:'text/csv',tsv:'text/tab-separated-values',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',ppt:'application/vnd.ms-powerpoint',odp:'application/vnd.oasis.opendocument.presentation'});
  const roleFile=name=>['company_seal','legal_representative_seal','bidder_signature'].includes(candidateKind(name))||/(?:公章|法人章|签字|签名)(?:原图|图片)?\.(?:png|jpe?g)$/iu.test(name);
  function checkAbort(signal){if(signal?.aborted){const e=Error('已取消本次资料导入，原档案未改动。');e.name='AbortError';throw e;}}
  function sourceName(name){if(typeof name!=='string'||!name||name.length>240||/[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name))throw Error('基础资料文件名不安全或过长。');return name;}
  function flatten(model){
    const lines=[],tables=[],images=[];let last='';
    function blocks(list,depth=0){
      if(depth>14)throw Error('基础资料嵌套层级过深。');
      for(const b of list||[]){
        if(b.kind==='paragraph'){
          const value=String(b.text||'').trim();if(value){lines.push(...value.split(/\r?\n/));last=value;}
          for(const im of b.images||[])images.push({image:im,caption:value||last});
        }else if(b.kind==='image')images.push({image:b,caption:last});
        else if(b.kind==='table'){
          const rows=[];for(const row of b.rows||[]){
            const values=[];for(const cell of row){const before=lines.length;blocks(cell.blocks,depth+1);values.push(lines.slice(before).join(' '));}
            rows.push(values);lines.push(values.join('\t'));
          }tables.push({rows});
        }
      }
    }
    if(model?.kind==='text')lines.push(...String(model.text||'').split(/\r?\n/));
    else if(model?.kind==='document')blocks(model.blocks);
    else if(model?.kind==='slides')for(const page of model.slides||[])blocks(page.blocks);
    else if(model?.kind==='workbook')for(const sheet of model.sheets||[]){
      const rows=new Map();
      for(const [a,c]of Object.entries(sheet.cells||{})){
        // Formula values are not trustworthy identity evidence; never execute,
        // recalculate, or borrow their cached results for a bidder profile.
        if(c.f||c.v===undefined||c.v===null||c.v==='')continue;
        const m=/^([A-Z]+)(\d+)$/.exec(a);if(!m)continue;
        const n=Number(m[2]);if(!rows.has(n))rows.set(n,[]);let col=0;for(const ch of m[1])col=col*26+ch.charCodeAt(0)-64;
        rows.get(n).push({col,text:String(c.v)});
      }
      const table={rows:[...rows].sort((a,b)=>a[0]-b[0]).map(([,cs])=>cs.sort((a,b)=>a.col-b.col).map(c=>c.text))};tables.push(table);lines.push(...table.rows.map(r=>r.join('\t')));
    }
    if(lines.length>6000||lines.join('\n').length>500000||images.length>100)throw Error('基础资料文字或内嵌图片过多，请拆分后导入。');
    return {lines,tables,images};
  }
  async function packagePreflight(file,ext,signal){
    if(!['docx','xlsx','pptx','odt','ods','odp'].includes(ext))return;
    if(!root.BidderArchive?.open)throw Error('本机文档解压组件未加载。');
    const archive=await root.BidderArchive.open(file,{entryLimit:2048,signal});
    try{
      if(archive.entries.reduce((n,e)=>n+e.size,0)>64*MiB)throw Error('基础资料解压后超过64MiB。');
      if(archive.entries.some(e=>/(?:^|\/)(?:vbaproject(?:signature)?\.bin|vbadata\.xml|macros|scripts|activex)(?:\/|$)|\.js$/iu.test(e.name)))throw Error('不接收带宏或脚本部件的基础资料，请另存无宏副本。');
      const entry=archive.entries.find(e=>e.name==='[Content_Types].xml');
      if(entry){
        if(entry.size>MiB)throw Error('文档类型声明过大。');const got=await archive.read([entry.name]),raw=new TextDecoder().decode(got.get(entry.name));
        if(/<!DOCTYPE|<!ENTITY/iu.test(raw))throw Error('文档类型声明包含不安全实体。');
        const types=new root.DOMParser().parseFromString(raw,'application/xml'),names=new Set(archive.entries.map(e=>e.name.toLowerCase()));
        if(types.querySelector('parsererror'))throw Error('文档类型声明损坏。');
        if([...types.getElementsByTagName('*')].some(n=>/macroEnabled|vbaProject/iu.test(n.getAttribute('ContentType')||'')&&
          (n.localName==='Override'&&names.has((n.getAttribute('PartName')||'').replace(/^\//,'').toLowerCase())||n.localName==='Default'&&[...names].some(p=>p.endsWith('.'+(n.getAttribute('Extension')||'').toLowerCase())))))
          throw Error('文档声明包含宏类型，请另存无宏副本。');
      }
      const manifest=archive.entries.find(e=>e.name==='META-INF/manifest.xml');
      if(manifest){if(manifest.size>MiB)throw Error('ODF声明过大。');const got=await archive.read([manifest.name]);if(/encryption-data|<!DOCTYPE|<!ENTITY/iu.test(new TextDecoder().decode(got.get(manifest.name))))throw Error('ODF含加密或不安全声明，请另存静态副本。');}
    }finally{archive.close();}
  }
  async function readFile(file,{signal}={}){
    checkAbort(signal);
    if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1)throw Error('请选择非空基础资料文件。');
    const name=sourceName(file.name),ext=name.split('.').at(-1).toLowerCase();
    if(['zip','rar'].includes(ext)){
      if(file.size>160*MiB)throw Error('压缩包超过160MiB。');
      if(!root.BidderArchive?.open)throw Error('本机压缩包读取组件未加载，请重新打开完整页面。');
      const archive=await root.BidderArchive.open(file,{signal});
      try{
        // The legacy parser remains available to read historical packages;
        // this new UI path neither reads nor exposes signing-image entries.
        const entries=archive.entries.filter(e=>!roleFile(e.name));
        const result=await read({entries,read:names=>archive.read(names)},{strictDocuments:true});checkAbort(signal);
        result.inventory=result.inventory.filter(n=>!roleFile(n));
        result.warnings=result.warnings.filter(s=>!/签章|盖章|签字|签名/u.test(s));
        result.warnings.push('识别结果只填入待核对编辑稿，确认保存后才更新本机资料库；不上传原件。');
        for(const p of result.profiles)p.files=Object.fromEntries(Object.entries(p.files).filter(([k])=>CERTS.includes(k)));
        return {...result,sourceType:'archive',materials:[]};
      }finally{archive.close();}
    }
    if(!Object.hasOwn(SOURCE_TYPES,ext))throw Error('此基础资料格式暂不支持；请提供ZIP、RAR、PDF、DOCX、DOC、TXT、RTF、ODT、常见表格或图片。');
    if(file.size>12*MiB)throw Error('单份基础资料不超过12MiB；DOC正文读取不超过2MiB。');
    if(roleFile(name))throw Error('该图片不属于两证或事务所基础信息文件，请选择正确的资料。');
    const bytes=new Uint8Array(await file.arrayBuffer());checkAbort(signal);
    if(bytes.length!==file.size)throw Error('基础资料读取不完整。');
    const starts=xs=>xs.every((n,i)=>bytes[i]===n),zip=()=>starts([80,75,3,4]);
    if(ext==='pdf'&&!starts([37,80,68,70,45])||['docx','xlsx','pptx','odt','ods','odp'].includes(ext)&&!zip()||['doc','xls','ppt'].includes(ext)&&!starts([208,207,17,224,161,177,26,225])||ext==='rtf'&&!/^\s*\{\\rtf[1-9]/u.test(new TextDecoder().decode(bytes.subarray(0,96))))throw Error('文件内容与扩展名不一致。');
    if(['doc','xls','ppt'].includes(ext)){
      const d=new DataView(bytes.buffer);for(let p=512;p+128<=bytes.length;p+=128){const len=d.getUint16(p+64,true),kind=bytes[p+66];if([1,2].includes(kind)&&len>=2&&len<=64&&len%2===0){const n=new TextDecoder('utf-16le').decode(bytes.subarray(p,p+len-2));if(/^(?:VBA|Macros|_VBA_PROJECT|PROJECTwm|EncryptedPackage|EncryptionInfo)$/iu.test(n))throw Error('旧版Office含宏或加密部件，请另存无宏、未加密副本。');}}
    }
    const source=new root.File([bytes],name,{type:SOURCE_TYPES[ext]});
    await packagePreflight(source,ext,signal);checkAbort(signal);
    const materials=[{name,blob:source,mime:SOURCE_TYPES[ext],sourcePath:name,original:true}],warnings=[],selected=new Map(),rows=[],docInfo=[];
    let body={lines:[],tables:[],images:[]},model;
    if(ext==='pdf'){
      if(!root.BidderPdfText?.read)throw Error('本机PDF文字组件未加载，请重新打开完整页面。');
      try{body={...body,...await root.BidderPdfText.read(bytes)};}catch(e){warnings.push(e.message||'PDF文字无法提取，原件仍可预览及下载。');}
      if(!body.lines.some(s=>s.trim()))warnings.push('该PDF没有可读取文字，可能是扫描件。本版本不提供OCR；原件已保留，可预览后人工指定两证。');
      warnings.push('PDF保留整份原件；混合资料包不会把整份文件当作某一项证照，暂不自动裁出扫描页。');
    }else{
      if(!root.AuditPreviewReaders?.read)throw Error('本机通用文档读取组件未加载，请重新打开完整页面。');
      model=await root.AuditPreviewReaders.read({blob:source,name,signal});checkAbort(signal);body=flatten(model);
      if(ext==='docx'&&root.TenderImport?.readVisibleText){const visible=await root.TenderImport.readVisibleText(source);body.lines=visible.lines;body.tables=visible.tables;}
      if(model.kind==='image')warnings.push('图片只读取原图，不提供OCR；可预览后人工指定为营业执照或执业证书。');
      if(ext==='doc')warnings.push('DOC可提取正文文字，暂不能可靠取出内嵌证照图片；请另存DOCX后导入，或单独上传PDF/PNG/JPEG两证。');
      if(ext==='rtf')warnings.push('RTF提取文字，不执行域或对象；内嵌图片请另存DOCX或单独提供。');
    }
    checkAbort(signal);
    const docText=body.lines.join('\n'),unsafeContext=badDoc.test(name)||/招标文件|招标公告|采购人[：:]|招标人[：:]|发标单位[：:]|合同编号|甲方[：:]|乙方[：:]/u.test(docText);
    if(unsafeContext)warnings.push('文件可能为招标、项目或合同资料，未自动借用其中的单位、联系人或整份文件作为本所两证；请人工确认归属。');
    else docInfo.push({name,data:textProfile(body.lines,body.tables)});
    const sourceKind=candidateKind(name),mixed=/营业执照/u.test(docText+name)&&new RegExp(practiceLabel,'u').test(docText+name);
    if(CERTS.includes(sourceKind)&&!mixed&&!unsafeContext&&[SOURCE_TYPES.pdf,SOURCE_TYPES.png,SOURCE_TYPES.jpg].includes(source.type)&&bytes.length<=MAX_FILE){
      rows.push({name,clean:name,kind:sourceKind,parts:[name]});selected.set(name,bytes);
    }
    let imageNo=0,totalImages=0;
    for(const {image,caption}of body.images){
      if(!image?.blob||!['image/png','image/jpeg'].includes(image.mime)||roleFile(image.alt||''))continue;
      if(image.blob.size>MAX_FILE||(totalImages+=image.blob.size)>24*MiB){warnings.push('部分内嵌图片超过单份3MiB或合计24MiB，未作为证照候选。');continue;}
      checkAbort(signal);const data=new Uint8Array(await image.blob.arrayBuffer()),n='内嵌资料-'+(++imageNo)+(image.mime==='image/png'?'.png':'.jpg');
      const material={name:n,blob:new Blob([data],{type:image.mime}),mime:image.mime,sourcePath:name+' / '+(image.alt||n),original:false};materials.push(material);
      const captionKind=/^(?:附件[一二三四五六七八九十\d]*[：:、. ]*)?(?:\d+[、. ]*)?(营业执照(?:副本)?(?:复印件)?|(?:会计师事务所)?执业(?:许可)?证书|执业证明)[：:、. ]*$/u.exec(caption.trim());
      const visibleCaption=captionKind&&body.lines.some(s=>normalize(s)===normalize(caption));
      const k=visibleCaption?(/营业执照/u.test(captionKind[1])?'business_license':'practice_certificate'):candidateKind(image.alt||'');
      if(!unsafeContext&&CERTS.includes(k)&&docInfo[0]?.data.name.size===1){rows.push({name:n,clean:n,kind:k,parts:[n]});selected.set(n,data);material.suggestedKind=k;}
    }
    const profiles=recordsFor({claimed:'',rows},docInfo,selected,warnings);
    if(!profiles.length)profiles.push({fields:empty(),files:{},notes:['请核对资料并填写事务所名称。'],alternatives:{}});
    for(const p of profiles){p.notes=p.notes.filter(s=>!/签章|盖章|签字|签名/u.test(s));for(const k of Object.keys(p.files))if(!CERTS.includes(k))delete p.files[k];}
    warnings.push('缺项不猜测，多候选不自动选定；原件和图片仅保留在本次编辑会话，确认保存后才更新两证及档案。');
    return {profiles,inventory:[name],warnings:[...new Set(warnings)],sourceType:'document',materials};
  }
  const api=Object.freeze({read,readFile,SOURCE_TYPES});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BidderIntake=api;
})(globalThis);

