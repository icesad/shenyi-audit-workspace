/* Quotation letter layouts. All content is local; role images are supplied only after confirmation. */
(function(root){
  'use strict';
  const ROLES=Object.freeze({company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字'});
  const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const catalog=Object.freeze([
    {id:'format1',title:'格式1 · 分项报价函（岳阳样式）',defaultKinds:['company_seal'],notes:'参考第一份原件的报价函正文，保留总价、两列分项报价和单位落款。'},
    {id:'format2',title:'格式2 · 服务范围及报价明细（常宁样式）',defaultKinds:['company_seal'],notes:'参考第二份原件的报价正文，先列五项服务范围，再列总价和落款。'},
    {id:'format3',title:'格式3 · 财务决算审计报价明细',defaultKinds:[],notes:'参考第三份 Word 的报价正文，保留两行标题、六项报价说明、联系信息和落款。'}
  ].map(o=>Object.freeze({...o,defaultKinds:Object.freeze(o.defaultKinds)})));
  const styles='.ql-doc{box-sizing:border-box;max-width:760px;margin:0 auto;padding:24px 20px;background:white;color:#202727;font:16px/1.8 "SimSun","Songti SC","Noto Serif CJK SC",serif;overflow-wrap:anywhere}.ql-doc h1{margin:0 0 22px;text-align:center;color:#161b1b;font:700 29px/1.35 "SimHei","PingFang SC",sans-serif}.ql-state{display:block;margin:0 0 10px;text-align:right;color:#7f561f;font:600 12px/1.4 "Microsoft YaHei",sans-serif}.ql-recipient,.ql-body p{margin:8px 0}.ql-body p{text-indent:2em}.ql-body .ql-noindent{text-indent:0}.ql-table{width:100%;border-collapse:collapse;table-layout:fixed;margin:14px 0;line-height:1.55}.ql-table th,.ql-table td{padding:6px 10px;border:1px solid #9ea6a6;text-align:left;vertical-align:top}.ql-table th{font-weight:700;background:#f5f6f6}.ql-table th:last-child,.ql-table td:last-child{width:44%}.ql-total{font-weight:700}.ql-close{margin:25px 0 0 auto;text-align:right;break-inside:avoid}.ql-close p{margin:2px 0}.ql-signs{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;margin:13px 0 2px;break-inside:avoid}.ql-sign{flex:0 1 120px;min-width:85px;margin:0;text-align:center;break-inside:avoid}.ql-sign img{display:block;width:auto;height:auto;max-width:115px;max-height:115px;object-fit:contain;margin:4px auto}.ql-sign[data-sign-kind=legal_representative_seal] img{max-width:80px;max-height:80px}.ql-sign[data-sign-kind=bidder_signature] img{max-width:115px;max-height:70px}.ql-sign figcaption{font:13px/1.45 "Microsoft YaHei",sans-serif}.ql-note{margin:20px 0 0;padding-top:8px;border-top:1px solid #cbd1d1;color:#51605e;font:12px/1.5 "Microsoft YaHei",sans-serif}.ql-print + .ql-print{margin-top:20px}@media print{.ql-doc{padding:0;max-width:none;color:#000}.ql-doc h1{font-size:18pt}.ql-state{color:#333}.ql-table th{background:white}.ql-print+.ql-print{break-before:page;margin-top:0}.ql-note{color:#333}}' + '.ql-table.ql-batch-table{font-size:13px}.ql-batch-table th,.ql-batch-table td{padding:5px 4px;overflow-wrap:anywhere}.ql-table.ql-batch-table :is(th,td):last-child{width:15%}.ql-batch-table :is(th,td):nth-child(1){width:7%;text-align:center}.ql-batch-table :is(th,td):nth-child(2){width:31%}.ql-batch-table :is(th,td):nth-child(3),.ql-batch-table :is(th,td):nth-child(4){width:16%}.ql-batch-table :is(th,td):nth-child(5){width:15%}.ql-batch-table td:nth-child(n+3){text-align:right}.ql-batch-table .ql-sum{font-weight:700;background:#f5f6f6}@media print{.ql-batch-table tr{break-inside:avoid}.ql-batch-table .ql-sum{background:white}}';
  const signStyles='.ql-unit-date{position:relative;display:flow-root}.ql-unit-date.has-seal{padding-top:26px;padding-bottom:12px}.ql-unit-date>.ql-signs{margin:0}.ql-sign.ql-overlay{position:absolute;right:4px;bottom:0;width:116px;height:100px;margin:0;z-index:1;pointer-events:none}.ql-sign.ql-overlay img{width:100%;height:100%;margin:0;object-fit:contain}.ql-sign.ql-overlay figcaption{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%)}.ql-role-signs{display:grid;justify-content:end;gap:8px;margin-top:8px}.ql-role-signs .ql-sign{position:relative;width:232px;max-width:100%;min-height:52px;display:flex;align-items:center;justify-content:space-between}.ql-role-signs .ql-sign::after{content:"";width:110px;border-bottom:1px solid #65716d;align-self:center}.ql-role-signs .ql-sign img{position:absolute;right:0;top:50%;width:108px;height:47px;max-width:108px;max-height:47px;transform:translateY(-50%);margin:0;z-index:1}';
  const templateStyles='.ql-table.ql-price-table :is(th,td):first-child{width:43%;background:#f4f5f5}.ql-table.ql-price-table :is(th,td):last-child{width:57%}.ql-table.ql-price-table :is(th,td){border-color:#454b4b}.ql-doc .ql-recipient{font-weight:700}.ql-subtitle{text-align:center;color:#3b4847;font-weight:600;margin:-14px 0 22px;font-size:17px}.ql-body .ql-meta{text-indent:0;font-size:14px;line-height:1.55;margin:3px 0}.ql-body h2{margin:16px 0 7px;padding-bottom:4px;border-bottom:1px solid #aab6b2;color:#253b36;font-size:16px;line-height:1.4;break-after:avoid}.ql-doc:not([data-quote-format=format1]) h1{font-family:"SimSun","Songti SC",serif;font-size:25px}.ql-doc[data-quote-format=format1] .ql-table th{background:#f0f3f2}.ql-table thead{display:table-header-group}.ql-table tr{break-inside:avoid}';
  const ESC=Object.freeze({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>ESC[c]);
  const plain=(s,fallback='待核对')=>s||fallback;
  const encoder=new TextEncoder();
  function opts(input){
    if(input==null)return {};
    if(typeof input!=='object'||Array.isArray(input))throw Error('报价版式选项格式不正确。');
    const limit={negotiationNo:100,authorizedPerson:80,authorizedRole:80,copies:40,workDays:60,validity:100,costScope:200,
      serviceScope:200,firmAddress:160,bankName:120,bankAccount:80,fax:60,legalRepresentative:80,packageNo:80,packageName:120};
    const result={previewOnly:input.previewOnly===true,grossOnly:input.grossOnly===true};
    for(const [k,n]of Object.entries(limit)){
      const v=input[k];
      if(v===undefined||v===null)continue;
      if(typeof v!=='string'||v.length>n||/[\u0000-\u001f\u007f-\u009f]/u.test(v))throw Error('报价补充字段超出有效范围。');
      result[k]=v.trim();
    }
    if(input.quoteRows!==undefined)result.quoteRows=batchRows(input.quoteRows);
    return result;
  }
  function money(cents){const s=String(cents).padStart(3,'0');return s.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+s.slice(-2);}
  function upper(cents){
    if(!Number.isSafeInteger(cents)||cents<0)throw Error('报价金额无效。');
    const cs=BigInt(cents),frac=Number(cs%100n),yuan=String(cs/100n),num='零壹贰叁肆伍陆柒捌玖',small=['','拾','佰','仟'],big=['','万','亿','万亿'];
    const chunks=[];for(let i=yuan.length;i>0;i-=4)chunks.unshift(yuan.slice(Math.max(i-4,0),i));
    let text='',pending=false;
    for(let i=0;i<chunks.length;i++){
      const n=Number(chunks[i]);if(n===0){if(text)pending=true;continue;}
      if(text&&(pending||n<1000))text+='零';
      const s=String(n);let gap=false,part='';
      for(let j=0;j<s.length;j++){const d=Number(s[j]);if(d===0){if(part)gap=true;continue;}if(gap)part+='零';part+=num[d]+small[s.length-1-j];gap=false;}
      text+=part+big[chunks.length-1-i];pending=false;
    }
    if(!text)text='零';
    return text+'元'+(frac===0?'整':(frac>=10?num[Math.floor(frac/10)]+'角':yuan==='0'?'':'零')+(frac%10?num[frac%10]+'分':''));
  }
  function base64(bytes){const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',parts=[];for(let off=0;off<bytes.length;off+=8190){let s='',end=Math.min(off+8190,bytes.length);for(let i=off;i<end;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];s+=abc[a>>>2]+abc[((a&3)<<4)|(b===undefined?0:b>>>4)]+(b===undefined?'=':abc[((b&15)<<2)|(c===undefined?0:c>>>6)])+(c===undefined?'=':abc[c&63]);}parts.push(s);}return parts.join('');}
  function dimensions(a){
    const b=a.bytes,v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    if(a.mime==='image/png')return [v.getUint32(16),v.getUint32(20)];
    for(let i=2;i+8<b.length;){
      if(b[i++]!==255)break;while(b[i]===255)i++;
      const mark=b[i++];if(mark===0xd9||mark===0xda)break;
      if(mark>=0xd0&&mark<=0xd7||mark===1)continue;
      const n=v.getUint16(i);if(n<2||i+n>b.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(mark))return [v.getUint16(i+5),v.getUint16(i+3)];
      i+=n;
    }
    throw Error('无法确定章签图片尺寸。');
  }
  async function assetsFor(list,qp){
    if(!Array.isArray(list)||list.length>3)throw Error('章签选择无效。');
    const map=new Map();
    for(const a of list){
      if(!a||!Object.hasOwn(ROLES,a.kind)||map.has(a.kind)||!['image/png','image/jpeg'].includes(a.mime))throw Error('章签种类或图片格式无效。');
      const f=await qp.verifyAttachment({kind:'business_license',name:a.name,mime:a.mime,sha256:a.sha256,size:a.size,bytes:a.bytes});
      map.set(a.kind,{...f,kind:a.kind});
    }
    return Object.keys(ROLES).filter(k=>map.has(k)).map(k=>map.get(k));
  }
  // Amounts in 万元 are kept as scaled integers, including negative profit.
  // A missing field must remain missing in both the row and its subtotal.
  const BATCH_METRICS=['assets','revenue','profit'],BATCH_SCALE=1000000n;
  function batchText(value,max,required){
    if(typeof value!=='string'||value.length>max||!value.isWellFormed()||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)||(required&&!value.trim()))
      throw Error('分户报价的单位名称或财务数据期间无效。');
    return value.trim();
  }
  function batchMetric(value,signed){
    if(typeof value!=='string'||value.length>48)throw Error('分户报价财务数据无效。');
    const text=value.trim();if(!text)return null;
    if(!(signed?/^-?\d+(?:\.\d{1,6})?$/:/^\d+(?:\.\d{1,6})?$/).test(text))throw Error('分户报价财务数据无效，万元最多保留 6 位小数。');
    const [whole,frac='']=text.replace(/^-/,'').split('.');
    const n=BigInt(whole)*BATCH_SCALE+BigInt(frac.padEnd(6,'0'));
    if(n>900000000000000n)throw Error('分户报价财务数据超出支持范围。');
    return text.startsWith('-')?-n:n;
  }
  function batchRows(value){
    if(!Array.isArray(value)||!value.length||value.length>50)throw Error('分户报价须含 1 至 50 家单位。');
    const rows=[];
    for(let i=0;i<value.length;i++){
      const row=value[i];
      if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isSafeInteger(row.totalCents)||row.totalCents<0)
        throw Error('第 '+(i+1)+' 家单位的报价金额无效。');
      rows.push({name:batchText(row.name,200,true),period:batchText(row.period,100,false),totalCents:row.totalCents,
        amounts:BATCH_METRICS.map(k=>batchMetric(row[k],k==='profit'))});
    }
    return rows;
  }
  function printMetric(n){
    if(n===null)return '—';
    const negative=n<0n;if(negative)n=-n;
    const [whole,frac]=[(n/BATCH_SCALE).toString(),(n%BATCH_SCALE).toString().padStart(6,'0')];
    return (negative?'-':'')+whole+'.'+frac.replace(/0+$/u,'').padEnd(2,'0');
  }
  function withBatch(c,s,id,rows,grossOnly){
    if(!rows)return c;
    const sum=rows.reduce((total,r)=>total+BigInt(r.totalCents),0n);
    if(sum!==BigInt(s.totalCents))throw Error('分户报价之和与报价合计不一致。');
    if(grossOnly){
      const table={quotePriceTable:true,table:[['被审计单位','含税报价（元）'],...rows.map(row=>[row.name,money(row.totalCents)]),['合计',money(s.totalCents)]]};
      const at=c.blocks.findIndex(block=>block.detailTable);
      if(at>=0)c.blocks.splice(at,1,table);
      else c.blocks.splice(c.blocks.findIndex(block=>block.strong)+1,0,table);
      return c;
    }
    const period=rows[0].period,onePeriod=Boolean(period)&&rows.every(r=>r.period===period);
    const showPeriods=!onePeriod&&rows.some(r=>r.period);
    const totals=BATCH_METRICS.map((_,i)=>rows.some(r=>r.amounts[i]===null)?null:rows.reduce((n,r)=>n+r.amounts[i],0n));
    const detail={batch:true,table:[
      ['序号','单位名称','资产总额（万元）','营业收入（万元）','净利润（万元）','报价（元）'],
      ...rows.map((r,i)=>[String(i+1),r.name+(showPeriods?'（财务数据期间：'+(r.period||'—')+'）':''),...r.amounts.map(printMetric),money(r.totalCents)]),
      ['', '合计',...totals.map(printMetric),money(s.totalCents)]
    ]};
    if(id==='format1'){
      const index=c.blocks.findIndex(x=>x.detailTable);
      c.blocks.splice(index,1,
        {p:'分户报价明细（共 '+rows.length+' 家）。',noindent:true},
        {quotePriceTable:true,table:[['公司名称','报价（单位：元）'],
          ...rows.map(r=>[r.name,'¥'+money(r.totalCents)+'（大写：'+upper(r.totalCents)+'）']),
          ['合计','¥'+money(s.totalCents)+'（大写：'+upper(s.totalCents)+'）']]});
      return c;
    }
    const block=c.blocks.findIndex(x=>x.detailTable);
    const at=block>=0?block:c.blocks.findIndex(x=>x.strong||x.batchAfter)+1;
    const notes=[
      {p:'分户报价明细（共 '+rows.length+' 家）'+(onePeriod?'；财务数据期间：'+period:'')+'。',noindent:true},
      detail
    ];
    if(totals.includes(null))notes.push({p:'财务数据未填处以「—」表示；存在缺项的指标不计算合计。',noindent:true});
    c.blocks.splice(at,block>=0?1:0,...notes);

    return c;
  }
  function content(s,id,o,template=false){
    const quote=template?'人民币 ¥________ 元（大写：________）':'人民币 ¥'+money(s.totalCents)+' 元（大写：'+upper(s.totalCents)+'）',
      tax=o.grossOnly?'':template?'税前金额 ¥________ 元；另计税额 ¥________ 元（税率：____%）。':'税前金额 ¥'+money(s.subtotalCents)+' 元；另计税额 ¥'+money(s.taxCents)+' 元（'+s.taxRateText+'）。',
      tableAmount=template?'¥________（大写：________）':'¥'+money(s.totalCents)+'（大写：'+upper(s.totalCents)+'）',
      name=plain(s.firmName,'待填写'),contact=s.bidderContact||{},
      dates=template?'日期：____ 年 __ 月 __ 日':'日期：'+s.quoteDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1 年 $2 月 $3 日');
    const rec='致：'+s.issuer,info=plain([contact.phone,contact.email].filter(Boolean).join(' / '));
    const meta=p=>({p,meta:true,noindent:true});
    const line=(p,strong=false)=>({p,noindent:true,strong});
    const scope=plain(o.serviceScope,s.projectType+'（具体范围待核对）');
    const cost=plain(o.costScope);
    const auditType=s.projectName.includes('财务决算审计')?'财务决算审计':s.projectType.replace(/^年度[\s　]*/u,'');
    const titleOf=s.auditYear+' 年度'+auditType+'报价明细';
    const projectLine=s.projectName.replace(/\s*\d{4}\s*年度\s*(?:财务决算审计|财务报表审计)(?:报价明细)?\s*$/u,'').trim()||s.issuer;
    if(id==='format1')return {title:'报价函',recipient:rec,blocks:[
      {p:'根据贵方对「'+s.projectName+'」的询价，现列示我方'+s.auditYear+' 年度'+auditType+'相关报价，供贵方核对。'},
      line('1. 报价总额（含税）：'+quote+'。'+tax,true),
      {detailTable:true,quotePriceTable:true,table:[['公司名称','报价（单位：元）'],[s.customerName,tableAmount]]},
      line('2. 报价费用范围：'+cost+'；额外费用以双方书面确认内容为准。'),
      line('3. 履约事项：按适用法律与双方书面约定执行。'),
      line('4. 项目服务范围：'+scope+'；服务期限：'+plain(o.workDays)+'。'),
      line('5. 报价有效期：'+plain(o.validity)+'；核对后以正式报价文件为准。'),
      meta('联系人：'+plain(contact.name)+'　联系方式：'+info)
    ],closing:['单位名称：'+name,dates]};
    if(id==='format2')return {title:s.quoteRows?.length>1?s.issuer:s.customerName,subtitle:titleOf,recipient:rec,blocks:[
      {p:'就贵方提出的「'+s.projectName+'」，现列示'+s.auditYear+' 年度'+auditType+'的服务范围及报价，供核对。'},
      {p:'拟服务范围：'+scope+'。以下为本次报价范围核对项，实际工作按双方确认的要求执行。'},
      line('1. 审计方案：明确工作范围、时间安排和重点事项。'),
      line('2. 资料分析：整理本期财务资料，核对报表及相关数据。'),
      line('3. 现场工作与盘点：按项目要求核对需现场执行的程序及盘点安排。'),
      line('4. 报告与交付：核对报告内容、交付件和服务期限（'+plain(o.workDays)+'）。'),
      line('5. 问题沟通：汇总需沟通事项，核对反馈和交付安排。'),
      line('上述服务的报价总额（含税）：'+quote+'。费用范围：'+cost+'。',true),
      ...(tax?[meta(tax)]:[]),
      meta('报价有效期：'+plain(o.validity)+'　联系人：'+plain(contact.name)+'　联系方式：'+info)
    ],closing:['供应商全称：'+name,dates]};
    return {title:projectLine,subtitle:titleOf,recipient:rec,blocks:[
      {p:'根据贵方对本项目的询价，现列示我方报价及相关事项，供核对。'},
      ...(o.grossOnly&&!s.quoteRows?[line('被审计单位：'+s.customerName)]:[]),
      line('1. 报价总额（含税）：'+quote+'。',true),
      line('2. 现场服务期限：'+plain(o.workDays)+'；食宿、交通及其他费用范围：'+cost+'。'),
      line('3. 履约安排：以采购文件和双方最终书面约定为准。'),
      line('4. 报价范围：'+scope+'。'+tax),
      line('5. 报价有效期：'+plain(o.validity)+'。'),
      line('6. 供应商联系信息'),
      meta('地址：'+plain(o.firmAddress)+'　联系人：'+plain(contact.name)),
      meta('电话／邮箱：'+info+(o.fax?'　传真：'+o.fax:'')),
      ...(o.bankName||o.bankAccount?[meta('开户行：'+plain(o.bankName)+'　银行账号：'+plain(o.bankAccount))]:[]),
      ...(o.legalRepresentative||o.authorizedPerson?[meta('法定代表人：'+plain(o.legalRepresentative)+'　授权代表：'+plain([o.authorizedPerson,o.authorizedRole].filter(Boolean).join(' ')))]:[])
    ],closing:['供应商全称：'+name,dates]};
  }
  const status='草稿 · 待审核';
  const unsignedNote='草稿供核对，未经事务所审核不作正式报价或采购承诺。本文件不含章签。';
  const note='仅供核对，未经事务所审核，不作为正式报价或采购承诺；图样不是数字签名。';
  function htmlOf(c,id,images){
    const selected=new Map(images.map(a=>[a.kind,a]));
    const sign=(k,overlay=false)=>{
      const a=selected.get(k);return '<figure class="ql-sign'+(overlay?' ql-overlay':'')+'" data-sign-kind="'+k+'">'+(a?'<img src="data:'+a.mime+';base64,'+base64(a.bytes)+'" alt="'+ROLES[k]+'">':'')+'<figcaption>'+ROLES[k]+(a?'':'（待盖章）')+'</figcaption></figure>';
    };
    const company=selected.get('company_seal'),overlay=company?.mime==='image/png';
    const others=Object.keys(ROLES).filter(k=>k!=='company_seal'&&selected.has(k));
    const signs=(company&&!overlay||id==='format1'&&!company?'<div class="ql-signs">'+sign('company_seal')+'</div>':'')+
      (others.length?'<div class="ql-role-signs">'+others.map(k=>sign(k)).join('')+'</div>':'');
    const close=c.closing.slice(0,-2).map(p=>'<p>'+esc(p)+'</p>').join('')+
      '<div class="ql-unit-date'+(overlay?' has-seal':'')+'">'+c.closing.slice(-2).map(p=>'<p>'+esc(p)+'</p>').join('')+(overlay?sign('company_seal',true):'')+'</div>'+signs;
    const b=c.blocks.map(x=>x.heading?'<h2>'+esc(x.heading)+'</h2>':x.table?'<table class="ql-table'+(x.batch?' ql-batch-table':x.quotePriceTable?' ql-price-table':x.responseTable?' ql-response-table':'')+'"><thead><tr>'+x.table[0].map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+x.table.slice(1).map((row,i)=>'<tr'+(x.batch&&i===x.table.length-2?' class="ql-sum"':'')+'>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p'+(x.strong?' class="ql-total'+(x.noindent?' ql-noindent':'')+'"':x.meta?' class="ql-meta ql-noindent"':x.noindent?' class="ql-noindent"':'')+'>'+esc(x.p)+'</p>').join('');
    return '<article class="ql-doc ql-print" data-quote-format="'+id+'"><span class="ql-state">'+status+'</span><h1>'+esc(c.title)+'</h1>'+(c.subtitle?'<p class="ql-subtitle">'+esc(c.subtitle)+'</p>':'')+'<p class="ql-recipient">'+esc(c.recipient)+'</p><div class="ql-body">'+b+'</div><section class="ql-close">'+close+'</section><p class="ql-note">'+note+'</p></article>';
  }
  const CRC=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
  function crc(b){let c=0xffffffff;for(const x of b)c=CRC[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  function zip(files){
    const entries=Object.entries(files).map(([n,b])=>[encoder.encode(n),typeof b==='string'?encoder.encode(b):b]);
    const total=22+entries.reduce((n,[name,b])=>n+76+2*name.length+b.length,0);
    if(total>12*1024*1024)throw Error('Word报价文件超过安全大小限制。');
    const a=new Uint8Array(total),v=new DataView(a.buffer),u16=(o,n)=>v.setUint16(o,n,true),u32=(o,n)=>v.setUint32(o,n,true);let at=0;
    const ptr=entries.map(([n,b])=>{const o=at,c=crc(b);u32(o,0x04034b50);u16(o+4,20);u16(o+6,0x800);u16(o+12,0x21);u32(o+14,c);u32(o+18,b.length);u32(o+22,b.length);u16(o+26,n.length);a.set(n,o+30);a.set(b,o+30+n.length);at+=30+n.length+b.length;return [o,n,b.length,c];});
    const start=at;for(const [loc,n,size,c]of ptr){u32(at,0x02014b50);u16(at+4,20);u16(at+6,20);u16(at+8,0x800);u16(at+14,0x21);u32(at+16,c);u32(at+20,size);u32(at+24,size);u16(at+28,n.length);u32(at+42,loc);a.set(n,at+46);at+=46+n.length;}
    u32(at,0x06054b50);u16(at+8,ptr.length);u16(at+10,ptr.length);u32(at+12,at-start);u32(at+16,start);return a;
  }
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',PKG='http://schemas.openxmlformats.org/package/2006/relationships',A='http://schemas.openxmlformats.org/drawingml/2006/main',PIC='http://schemas.openxmlformats.org/drawingml/2006/picture',WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const para=(s,{align='left',indent=false,bold=false,pt=11,color='222929',style='',keep=false,space=125,before=0,line=340,extra=''}={})=>'<w:p><w:pPr>'+(style?'<w:pStyle w:val="'+style+'"/>':'')+(keep?'<w:keepNext/>':'')+'<w:spacing w:after="'+space+'" w:before="'+before+'" w:line="'+line+'" w:lineRule="auto"/>'+(indent?'<w:ind w:firstLine="420"/>':'')+'<w:jc w:val="'+align+'"/></w:pPr><w:r><w:rPr>'+(bold?'<w:b/>':'')+'<w:color w:val="'+color+'"/><w:sz w:val="'+pt*2+'"/><w:szCs w:val="'+pt*2+'"/></w:rPr><w:t xml:space="preserve">'+esc(s)+'</w:t></w:r>'+extra+'</w:p>';
  function table(t,batch=false,quotePriceTable=false,responseTable=false){
    const widths=batch?[600,2980,1470,1470,1300,1420]:quotePriceTable?[3973,5267]:responseTable?[2957,6283]:[5200,4040];
    return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(k=>'<w:'+k+' w:val="single" w:sz="5" w:color="929B9B"/>').join('')+'</w:tblBorders>'+(batch||quotePriceTable||responseTable?'<w:tblLayout w:type="fixed"/>':'')+'<w:tblCellMar>'+['top','left','bottom','right'].map(k=>'<w:'+k+' w:w="95" w:type="dxa"/>').join('')+'</w:tblCellMar></w:tblPr><w:tblGrid>'+widths.map(w=>'<w:gridCol w:w="'+w+'"/>').join('')+'</w:tblGrid>'+t.map((row,i)=>'<w:tr><w:trPr><w:cantSplit/>'+(i===0?'<w:tblHeader/>':'')+'</w:trPr>'+row.map((v,j)=>'<w:tc><w:tcPr><w:tcW w:w="'+widths[j]+'" w:type="dxa"/>'+((i===0||quotePriceTable&&j===0||batch&&i===t.length-1)?'<w:shd w:val="clear" w:color="auto" w:fill="F2F4F4"/>':'')+'</w:tcPr>'+para(v,{bold:i===0||batch&&i===t.length-1,align:batch?(j===0?'center':i>0&&j>=2?'right':'left'):'left',pt:batch?10:11,space:0,line:batch?280:340})+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
  }
  function drawing(a,i,anchor=false){
    const [w,h]=dimensions(a),scale=Math.min((a.kind==='legal_representative_seal'?66:104)*12700/w,(a.kind==='bidder_signature'?36:a.kind==='legal_representative_seal'?42:88)*12700/h),cx=Math.round(w*scale),cy=Math.round(h*scale),label=ROLES[a.kind],name='image-'+i;
    const open=anchor?'<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="'+(251659264+i)+'" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>'+((a.kind==='company_seal'?-57:-12)*12700)+'</wp:posOffset></wp:positionV>':'<wp:inline distT="0" distB="0" distL="0" distR="0">';
    const run='<w:r><w:drawing>'+open+'<wp:extent cx="'+cx+'" cy="'+cy+'"/>'+(anchor?'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>':'')+'<wp:docPr id="'+i+'" name="'+name+'" descr="'+label+'"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="'+PIC+'"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="'+name+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage'+i+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'+(anchor?'</wp:anchor>':'</wp:inline>')+'</w:drawing></w:r>';
    return anchor?run:'<w:p><w:pPr><w:spacing w:after="70"/><w:jc w:val="right"/></w:pPr>'+run+'</w:p>';
  }
  function docxOf(c,id,images,statusLabel=status,footer=images.length?note:unsignedNote){
    const files=Object.create(null),rels=['<Relationship Id="rIdStyles" Type="'+R+'/styles" Target="styles.xml"/>'];
    files['[Content_Types].xml']=XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    files['_rels/.rels']=XML+'<Relationships xmlns="'+PKG+'"><Relationship Id="rId1" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>';
    files['word/styles.xml']=XML+'<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:color w:val="000000"/><w:sz w:val="36"/></w:rPr></w:style></w:styles>';
    let companyRun='';
    const sign=images.map((a,j)=>{
      const i=j+1,ext=a.mime==='image/png'?'png':'jpg',target='media/image-'+i+'.'+ext;
      files['word/'+target]=a.bytes;rels.push('<Relationship Id="rIdImage'+i+'" Type="'+R+'/image" Target="'+target+'"/>');
      if(a.kind==='company_seal'&&ext==='png'){companyRun=drawing(a,i,true);return '';}
      if(ext==='png')return para(ROLES[a.kind]+'：__________________',{align:'right',keep:true,pt:10,before:190,space:650,extra:drawing(a,i,true)});
      return para(ROLES[a.kind],{align:'right',keep:true,pt:9,space:0})+drawing(a,i);
    }).join('');
    const closing=c.closing.map((v,i)=>para(v,{align:'right',keep:i<c.closing.length-1,space:companyRun&&i===c.closing.length-1?460:85,
      before:companyRun&&i===c.closing.length-2?800:0,extra:i===c.closing.length-1?companyRun:''})).join('');
    files['word/document.xml']=XML+'<w:document xmlns:w="'+W+'" xmlns:r="'+R+'" xmlns:wp="'+WP+'" xmlns:a="'+A+'" xmlns:pic="'+PIC+'"><w:body>'+para(statusLabel,{align:'right',pt:9,color:'725125',space:80})+para(c.title,{align:'center',bold:true,pt:id==='format1'?18:16,style:'Title',keep:true,space:190})+ (c.subtitle?para(c.subtitle,{align:'center',pt:12,bold:true,keep:true}):'')+para(c.recipient,{keep:true,bold:true})+c.blocks.map(x=>x.heading?para(x.heading,{pt:13,bold:true,keep:true,before:130,space:75}):x.table?table(x.table,x.batch,x.quotePriceTable,x.responseTable):para(x.p,{indent:!x.noindent,bold:!!x.strong,pt:x.meta?10:11,space:x.meta?30:c.blocks.some(b=>b.batch)?90:125,line:c.blocks.some(b=>b.batch)?305:340,keep:!!x.noindent&&x.p.startsWith('分户报价明细')})).join('')+closing+sign+para(footer,{pt:9,color:'51605E',space:0})+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1380" w:right="1333" w:bottom="1380" w:left="1333" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>';
    files['word/_rels/document.xml.rels']=XML+'<Relationships xmlns="'+PKG+'">'+rels.join('')+'</Relationships>';
    return zip(files);
  }
  async function render(snapshot,id,confirmed=[],options={}){
    const qp=root.QuotePacket||(typeof module==='object'&&module.exports?require('./quote-packet.js'):null);
    if(!qp||!catalog.some(v=>v.id===id))throw Error('未知报价格式。');
    const o=opts(options),s=qp.normalizeSnapshot(snapshot);
    const savedRows=s.quoteRows?batchRows(s.quoteRows):null;
    if(savedRows&&o.quoteRows){
      if(savedRows.length!==o.quoteRows.length||savedRows.some((x,i)=>{
        const y=o.quoteRows[i];return x.name!==y.name||x.period!==y.period||x.totalCents!==y.totalCents||x.amounts.some((v,j)=>v!==y.amounts[j]);
      }))throw Error('分户报价明细与报价快照不一致。');
    }
    const c=withBatch(content(s,id,o),s,id,savedRows||o.quoteRows,o.grossOnly),images=await assetsFor(confirmed,qp);
    const html=htmlOf(c,id,images);return Object.freeze({html,...(o.previewOnly?{}:{docx:docxOf(c,id,images)})});
  }
  async function buildUnsignedWord(snapshot,ids=[],options={}){
    if(!Array.isArray(ids)||ids.length>catalog.length||new Set(ids).size!==ids.length||ids.some(id=>!catalog.some(x=>x.id===id)))throw Error('报价格式选择无效。');
    const chosen=ids.length?catalog.filter(x=>ids.includes(x.id)):[catalog[0]];
    const files=Object.create(null);
    for(const {id,title} of chosen){
      const name='审计报价-'+title.replace(' · ','-')+'-无章.docx';
      // The standalone Word export deliberately never takes annexes or signing assets.
      files[name]=(await render(snapshot,id,[],{...options,previewOnly:false})).docx;
    }
    const names=Object.keys(files);
    return Object.freeze(names.length===1?{name:names[0],mime:MIME,bytes:files[names[0]]}:
      {name:'审计报价-无章Word.zip',mime:'application/zip',bytes:zip(files)});
  }
  function buildTemplateWord(id,bidder){
    const ordinal=catalog.findIndex(format=>format.id===id);
    if(ordinal<0||typeof bidder?.name!=='string'||!bidder.name.trim())throw Error('请选择有效的报价单位和模板。');
    const fields={firmName:bidder.name,issuer:'________',customerName:'________',projectName:'________',
      auditYear:'____',projectType:'________',bidderContact:{name:bidder.contactName,phone:bidder.phone,email:bidder.email}};
    const layout=content(fields,id,{},true);
    const bytes=docxOf(layout,id,[],'报价模板 · 待填写','填写后请核对项目、金额、税率与附件。');
    return Object.freeze({name:`报价模板${'一二三'[ordinal]}.docx`,mime:MIME,bytes});
  }
  const api=Object.freeze({catalog,styles:styles+templateStyles+signStyles,render,buildUnsignedWord,buildTemplateWord,docxMime:MIME,packOfficeParts:zip,upper});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QuoteLayouts=api;
})(globalThis);
