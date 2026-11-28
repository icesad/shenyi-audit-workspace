/* Source-derived, read-only arithmetic diagnostics. No audit opinion, guessed
 * balances, implicit confirmation, or write-back to a project/workpaper. */
(function(root){'use strict';
 const LIMITS=Object.freeze({sources:512,rows:20000,detailRows:100000,cells:2500000,checks:40000,refs:64,archiveBytes:64*1024*1024});
 const ROLES=Object.freeze({ledger:'三栏账',trial:'科目余额表',statements:'未审报表'});
 const isWorkbookSource=name=>typeof name==='string'&&/\.(?:xlsx?|zip)$/iu.test(name);
 const clientWorkbooks=workspace=>(workspace.auditWorkflow?.files?.client||[]).filter(file=>isWorkbookSource(file.name));
 const fileStamp=files=>JSON.stringify(files.map(file=>[file.name,file.sha256,file.size]));
 const roleFor=type=>({ledger:'ledger',accountDetail:'ledger',trial:'trial',balance:'statements',profit:'statements',cash:'statements'})[type];
 const norm=s=>String(s??'').normalize('NFKC').replace(/\s+/gu,'').replace(/[：:]/g,':');
 const address=(r,c)=>{let a='';for(c++;c;c=Math.floor((c-1)/26))a=String.fromCharCode(65+(c-1)%26)+a;return a+(r+1);};
 const value=(s,r,c)=>s.cells?.[address(r,c)]?.v;
 const text=(s,r,c)=>String(value(s,r,c)??'');
 function cents(v){
  if(v===null||v===undefined||v===''||typeof v==='boolean')return null;
  const s=String(v).trim();if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))return null;
  const [a,b='']=s.replace(/,/g,'').replace(/^-/,'').split('.');if(a.length>16)return null;
  const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));return s.startsWith('-')?-n:n;
 }
 const money=n=>n===null?null:(n<0n?'-':'')+(String(n<0n?-n:n).padStart(3,'0').slice(0,-2))+'.'+String(n<0n?-n:n).padStart(3,'0').slice(-2);
 const entity=s=>norm(s).replace(/^(?:单位(?:名称)?|核算单位|编制单位|被审计单位):/u,'').replace(/有限公司本部$/u,'有限公司').replace(/事务所本部$/u,'事务所');
 function period(s){const m=/(20\d{2})[-年/](0?[1-9]|1[0-2])(?:月)?(?:$|\D)/.exec(String(s));return m?m[1]+'-'+m[2].padStart(2,'0'):'';}
 function meta(source,s){
  const found={entity:'',period:'',unit:'',currency:'',metadataRefs:[],conflictingPeriods:[]},dates=[];
  for(let r=0;r<=Math.min(4,s.range.e.r);r++)for(let c=0;c<=Math.min(20,s.range.e.c);c++){
   const v=text(s,r,c),n=norm(v);if(!n)continue;
   if(/^责任中心:/.test(n)){const p=v.split(/[／/]/u).at(-1).replace(/^责任中心[:：]\s*[\da-z]+\s*/iu,'');found.entity=entity(p);found.metadataRefs.push(address(r,c));}
   else if(/^(?:单位|单位名称|编制单位|被审计单位|核算单位):/.test(n)&&!/^单位:(?:人民币)?(?:元|万元|千元)$/.test(n)){
    found.entity=entity(v);found.metadataRefs.push(address(r,c));
   }
   if(/^会计期间:/.test(n)){found.period=period(n);found.metadataRefs.push(address(r,c));}
   else if(/^20\d{2}(?:年\d{1,2}月(?:\d{1,2}日)?|-\d{2}(?:-\d{2})?)$/.test(n)&&period(n)){dates.push({v:period(n),cell:address(r,c)});}
   if(/^(?:金额单位|单位):(?:人民币)?(?:元|万元|千元)$/.test(n)){found.unit=n.split(':').at(-1);found.metadataRefs.push(address(r,c));}
   if(/^(?:币种|货币):/.test(n)){found.currency=n.split(':').at(-1);found.metadataRefs.push(address(r,c));}
  }
  if(!found.period&&dates.length){found.period=dates[0].v;found.metadataRefs.push(dates[0].cell);found.conflictingPeriods=dates.filter(x=>x.v!==found.period);}
  return {...found,name:source.name,sha256:source.sha256,sheet:s.name};
 }
 function headers(s,r){const map=new Map();for(let c=0;c<=Math.min(100,s.range.e.c);c++){const n=norm(text(s,r,c));if(n){if(!map.has(n))map.set(n,[]);map.get(n).push(c);}}return map;}
 function pick(h,labels){for(const k of labels){const cs=h.get(k);if(cs?.length===1)return cs[0];}return -1;}
 function recognize(source,s){
  for(let r=0;r<=Math.min(12,s.range.e.r);r++){
   const h=headers(s,r),code=pick(h,['科目编号','科目编码']),voucher=pick(h,['凭证编号','凭证号']),date=pick(h,['凭证日期','记账日期']),debit=pick(h,['借方金额','借方发生额']),credit=pick(h,['贷方金额','贷方发生额']);
   if([code,voucher,date,debit,credit].every(x=>x>=0))return {type:'ledger',s,source,meta:meta(source,s),header:r,cols:{code,voucher,date,debit,credit,period:pick(h,['会计期间']),entity:pick(h,['责任中心名称','核算单位','被审计单位']),direction:pick(h,['方向'])}};
   const year=pick(h,['年']),month=pick(h,['月']),day=pick(h,['日']),summary=pick(h,['摘要']),company=pick(h,['公司代码']),direction=pick(h,['方向']),balance=pick(h,['余额']);
   const debitHead=pick(h,['借方']),creditHead=pick(h,['贷方']);
   if([year,month,day,summary,company,voucher,direction,balance,debitHead,creditHead].every(c=>c>=0)){
    const subrow=text(s,r+1,debitHead)==='数量';
    const amount=(start,end)=>{
     if(!subrow)return start;
     const matches=[];
     for(let c=start+1;c<end;c++)if(norm(text(s,r+1,c))==='金额')matches.push(c);
     return matches.length===1?matches[0]:-1;
    };
    const debit=amount(debitHead,creditHead),credit=amount(creditHead,direction),closing=amount(balance,balance+4);
    if([debit,credit,closing].every(c=>c>=0))return {type:'accountDetail',s,source,meta:meta(source,s),header:r+Number(subrow),cols:{year,month,day,summary,company,voucher,direction,debit,credit,closing}};
   }
   const open=pick(h,['上年结转','上期结转','期初余额']),close=pick(h,['当前余额','期末余额']),name=pick(h,['科目名称']),move=pick(h,['累计发生','本期发生']);
   if([code,name,open,close,move].every(x=>x>=0)&&norm(text(s,r,open-1))==='方向'&&norm(text(s,r,close-1))==='方向'){
    const sub=headers(s,r+1),d=pick(sub,['借方']),c=pick(sub,['贷方']);
    if(d>=0&&c>=0)return {type:'trial',s,source,meta:meta(source,s),header:r+1,cols:{code,name,open,close,openDir:open-1,closeDir:close-1,debit:d,credit:c},annual:norm(text(s,r,move))==='累计发生'};
   }
  }
  const title=[0,1,2].flatMap(r=>[0,1,2].map(c=>norm(text(s,r,c))));
  for(const [name,type]of [['资产负债表','balance'],['利润表','profit'],['现金流量表','cash']])
   if(title.some(value=>value===name||value==='未审'+name||value===name+'(未审)'))return {type,s,source,meta:meta(source,s)};
  return null;
 }
 function analyze(sources=[],{entity:expectedEntity=''}={}){
  if(!Array.isArray(sources)||sources.length>LIMITS.sources)throw Error('自动校验最多读取 '+LIMITS.sources+' 份账表。');
  const checks=[],models=[],summaries=[],seen=new Set(),sameNames=new Map();
  let omittedChecks=0;
  const ref=(m,cells)=>({name:m.source.name,sha256:m.source.sha256,sheet:m.s.name,cells:Array.isArray(cells)?cells:[cells]});
  function add(id,label,status,refs=[],extra={}){if(checks.length>=LIMITS.checks){omittedChecks++;return;}checks.push({id,label,status,refs:refs.slice(0,LIMITS.refs),...(refs.length>LIMITS.refs?{sourceRefsTruncated:true}:{}),...extra});}
  const compare=(id,label,a,b,refs,ready=true)=>add(id,label,a===null||b===null||!ready?'pending':a===b?'pass':'difference',refs,{actual:money(a),expected:money(b),difference:a===null||b===null?null:money(a-b)});
  for(const source of sources){
   if(!source?.model?.sheets||typeof source.name!=='string')throw Error('账表读取模型无效。');
   const stamp=source.sha256+'|'+(source.role||'');
   if(source.sha256&&seen.has(stamp)){add('duplicate','同内容副本已去重，不重复累计：'+source.name,'pass');continue;}if(source.sha256)seen.add(stamp);
   const n=source.name.normalize('NFKC').toLowerCase();if(!sameNames.has(n))sameNames.set(n,new Set());sameNames.get(n).add(source.sha256||source);
   let recognized=0;
   for(const s of source.model.sheets){
    if(!s.cells||!s.range||s.range.e.r>1048575){
     add('source.range','工作表范围无效，已继续核对其他账表：'+source.name,'pending',[{name:source.name,sha256:source.sha256,sheet:s.name,cells:[]}]);
     continue;
    }
    const formulaCells=Object.entries(s.cells).filter(([,c])=>c.f).map(([a])=>a);
    if(formulaCells.length)add('source.cachedFormula','源表含公式，仅读取原缓存；没有执行、重算或更新外链，需核对缓存是否最新','pending',[{name:source.name,sha256:source.sha256,sheet:s.name,cells:formulaCells.slice(0,32)}]);
    const m=recognize(source,s);if(m){
     if(source.role&&roleFor(m.type)!==source.role)continue;
     if(expectedEntity&&m.meta.entity&&m.meta.entity!==entity(expectedEntity)){
      add('scope.project','此表的编制单位与所选项目不一致，未纳入本项目核验。','pending',[ref(m,m.meta.metadataRefs)]);continue;
     }
     const maxRows=m.type==='accountDetail'?LIMITS.detailRows:LIMITS.rows;
     if(m.header!==undefined&&s.range.e.r-m.header>maxRows){
      add('source.rowLimit','此工作表超过 '+maxRows+' 行，须单独核对。','pending',[ref(m,address(m.header,0))]);
      continue;
     }
     recognized++;models.push(m);
    }
    else if(!/^目录$/.test(norm(text(s,0,0)))&&!/目录/.test(s.name))add('unknown','未识别明确账表表头，未猜测列映射：'+source.name+' / '+s.name,'pending',[{name:source.name,sha256:source.sha256,sheet:s.name,cells:['A1']}]);
   }
   summaries.push({name:source.name,sha256:source.sha256,recognizedSheets:recognized});
   if(!recognized)add('source.unrecognized',source.role?
    '未从此文件识别出「'+ROLES[source.role]+'」，请核对所选类型和表头。':
    '这份工作簿没有明确可识别的账表，请核对表头。','pending',[{name:source.name,sha256:source.sha256,sheet:'',cells:[]}]);
  }
  for(const [n,hashes]of sameNames)if(hashes.size>1)add('same-name','同名文件存在不同内容，未任意选择：'+n,'pending');
  function scope(m){
   if(!m.meta.entity)add('scope.entity','未识别明确主体，禁止跨表串用：'+m.source.name,'pending',[ref(m,m.meta.metadataRefs)]);
   if(!m.meta.period)add('scope.period','未识别明确会计期间：'+m.source.name,'pending',[ref(m,m.meta.metadataRefs)]);
   if(m.meta.conflictingPeriods.length)add('scope.dates','表头存在不同日期，请核对范围；未忽略冲突日期','pending',[ref(m,m.meta.conflictingPeriods.map(x=>x.cell))],{periodCandidates:m.meta.conflictingPeriods});
  }
  function get(m,r,c){return cents(value(m.s,r,c));}
  function validDataRows(m,callback){
   const max=m.s.range.e.r;
   for(let r=m.header+1;r<=max;r++){
    const rawCode=value(m.s,r,m.cols.code);
    if(typeof rawCode==='number'&&!Number.isSafeInteger(rawCode)){m.hasUnknown=true;add('row.code.precision','科目编码为不安全数值，不能恢复原编号；未猜测或补码','pending',[ref(m,address(r,m.cols.code))]);continue;}
    const code=norm(text(m.s,r,m.cols.code));
    const first=norm(text(m.s,r,0));
    if(code==='合计'||code==='总计'||first==='合计'||first==='总计'){m.total={r,debit:get(m,r,m.cols.debit),credit:get(m,r,m.cols.credit)};continue;}
    if(!code){const has=Object.values(m.cols).some(c=>c>=0&&value(m.s,r,c)!==undefined&&value(m.s,r,c)!=='');if(has){m.hasUnknown=true;add('row.unknown','数据区有缺少科目编号的行，未静默计入或填零','pending',[ref(m,[address(r,m.cols.code)])]);}continue;}
    callback(r,code);
   }
  }
  for(const m of models.filter(x=>x.type==='ledger')){
   const rows=[],vouchers=new Map(),accounts=new Map(),entities=new Set(),periods=new Set();let d=0n,c=0n,valid=true;
   validDataRows(m,(r,code)=>{
    const a=get(m,r,m.cols.debit),b=get(m,r,m.cols.credit),voucher=text(m.s,r,m.cols.voucher).trim(),date=norm(text(m.s,r,m.cols.date)),p=m.cols.period>=0?period(text(m.s,r,m.cols.period)):period(date),e=m.cols.entity>=0?entity(text(m.s,r,m.cols.entity)):m.meta.entity;
    const refs=[ref(m,[address(r,m.cols.debit),address(r,m.cols.credit),address(r,m.cols.voucher)])];
    if(e)entities.add(e);if(p)periods.add(p);
    const dateValue=new Date(date+'T00:00:00.000Z'),dateOK=/^20\d{2}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(dateValue.getTime())&&dateValue.toISOString().slice(0,10)===date;
    if(a===null||b===null||!voucher||!p||!e||!dateOK||period(date)!==p){valid=false;add('ledger.row','流水缺金额/主体/日期/期间/凭证号，未填0或猜测','pending',refs);return;}
    if(a!==0n&&b!==0n){valid=false;add('ledger.direction','同一流水行借贷同时非零，需核对列映射','pending',refs);}
    const vkey=e+'|'+p+'|'+voucher,v=vouchers.get(vkey)||{d:0n,c:0n,refs:[],dates:new Set()};v.d+=a;v.c+=b;v.refs.push(...refs);v.dates.add(date);vouchers.set(vkey,v);
    const aa=accounts.get(e+'|'+code)||{d:0n,c:0n,refs:[]};aa.d+=a;aa.c+=b;aa.refs.push(...refs);accounts.set(e+'|'+code,aa);rows.push({r,code,e,p});d+=a;c+=b;
   });
   valid=valid&&!m.hasUnknown;const sorted=[...periods].sort();m.rows=rows;m.accounts=accounts;m.valid=valid;m.start=sorted[0]||'';m.end=sorted.at(-1)||'';
   m.meta.entity=entities.size===1?[...entities][0]:'';m.meta.period=m.end;
   if(entities.size>1)add('ledger.entities','同一流水包含多个主体，整表跨表对账已阻断','pending',[ref(m,[address(m.header,m.cols.entity)])]);
   if(new Set(sorted.map(x=>x.slice(0,4))).size>1){m.valid=false;add('ledger.years','流水跨多个年度，未合并跨年度余额核对','pending',[ref(m,[address(m.header,m.cols.period)])]);}
   scope(m);compare('ledger.total','流水所上传数据借贷合计（红字保留原符号）',d,c,[ref(m,[address(m.header,m.cols.debit),address(m.header,m.cols.credit)])],valid);
   if(m.total){compare('ledger.declared.debit','流水借方与原表合计行',d,m.total.debit,[ref(m,address(m.total.r,m.cols.debit))],valid);compare('ledger.declared.credit','流水贷方与原表合计行',c,m.total.credit,[ref(m,address(m.total.r,m.cols.credit))],valid);}
   for(const [key,v]of vouchers){if(v.dates.size>1)add('ledger.voucher.date','同月同凭证号对应多个日期，请核对唯一键','pending',v.refs);compare('ledger.voucher','凭证借贷平衡（主体+期间+凭证号）：'+key,v.d,v.c,v.refs,valid);}
   m.summary={...m.meta,type:m.type,rowCount:rows.length,vouchers:vouchers.size,debit:money(d),credit:money(c),start:m.start,end:m.end};
  }
  for(const m of models.filter(x=>x.type==='accountDetail')){
   const {s,cols}=m;
   let previous=null,previousCompany='',previousRow=0,rows=0,consistent=0;
   const carry=/^(?:上[年期]结转|期初余额|期初结转)$/u;
   const subtotal=/^(?:本[期月](?:合计|累计)|本年累计|本年合计|月计|合计|总计)$/u;
   for(let r=m.header+1;r<=s.range.e.r;r++){
    const label=norm(text(s,r,cols.summary)),voucher=norm(text(s,r,cols.voucher));
    if(!voucher&&subtotal.test(label))continue;
    const y=norm(text(s,r,cols.year)),mo=norm(text(s,r,cols.month)),day=norm(text(s,r,cols.day));
    const company=norm(text(s,r,cols.company)),dir=norm(text(s,r,cols.direction)),rawBalance=get(m,r,cols.closing);
    const closing=rawBalance!==null&&rawBalance>=0n&&(['借','贷'].includes(dir)||dir==='平'&&rawBalance===0n)?(dir==='贷'?-rawBalance:rawBalance):null;
    if(!voucher&&carry.test(label)){
     previous=closing;previousRow=r;previousCompany=company;
     continue;
    }
    if(!voucher&&!label&&rawBalance===null)continue;
    const date=y+'-'+mo.padStart(2,'0')+'-'+day.padStart(2,'0'),parsed=new Date(date+'T00:00:00.000Z');
    const dated=Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
    const refs=[ref(m,[address(r,cols.voucher),address(r,cols.debit),address(r,cols.credit),address(r,cols.direction),address(r,cols.closing)])];
    if(!voucher||!dated||!company){
     previous=null;
     add('detail.row','明细账行缺少有效日期、公司代码或凭证编号：'+m.source.name,'pending',refs);
     continue;
    }
    rows++;
    if(previous!==null&&(!previousCompany||company===previousCompany))refs.push(ref(m,address(previousRow,cols.closing)));
    const debit=get(m,r,cols.debit),credit=get(m,r,cols.credit);
    const expected=refs.length===2&&debit!==null&&credit!==null?previous+debit-credit:null;
    if(expected!==null&&expected===closing)consistent++;
    else compare('detail.rollforward','明细账余额滚动：'+m.source.name+' · 第 '+(r+1)+' 行',closing,expected,refs);
    previous=closing;previousRow=r;previousCompany=company;
   }
   if(consistent)add('detail.consistent','明细账余额滚动算术一致 '+consistent+' 行：'+m.source.name,'pass',[ref(m,address(m.header,cols.closing))],{rows:consistent});
   m.summary={...m.meta,type:m.type,rowCount:rows,consistentRows:consistent};
  }
  for(const m of models.filter(x=>x.type==='trial')){
   scope(m);const rows=[],stack=[],codes=new Set();let valid=true,hierarchy=true,hasIndent=false;
   const balance=(r,dir,col)=>{const n=get(m,r,col),d=norm(text(m.s,r,dir));if(n===null||n<0n||!['借','贷','平'].includes(d)||d==='平'&&n!==0n)return null;return d==='贷'?-n:n;};
   validDataRows(m,(r,code)=>{
    const name=text(m.s,r,m.cols.name),indent=/^ */.exec(name)[0].length,level=indent/2,open=balance(r,m.cols.openDir,m.cols.open),close=balance(r,m.cols.closeDir,m.cols.close),d=get(m,r,m.cols.debit),c=get(m,r,m.cols.credit);
    const row={r,code,name:name.trim(),level,open,close,d,c,children:[],parent:null,refs:[ref(m,[address(r,m.cols.openDir),address(r,m.cols.open),address(r,m.cols.debit),address(r,m.cols.credit),address(r,m.cols.closeDir),address(r,m.cols.close)])]};
    if(codes.has(code)){valid=false;add('trial.duplicate','余额表科目编码重复，未重复累计','pending',row.refs);}codes.add(code);
    if([open,close,d,c].includes(null)){valid=false;add('trial.blank','余额表有缺金额或方向与余额不一致，未把空白当0','pending',row.refs);}
    compare('trial.rollforward','余额滚动：'+code,close,open===null||d===null||c===null?null:open+d-c,row.refs);
    while(stack.length&&stack.at(-1).level>=level)stack.pop();if(level)hasIndent=true;
    if(!Number.isInteger(level)||level<0||level>15||level&&(!stack.length||stack.at(-1).level+1!==level)||stack.length&&!code.startsWith(stack.at(-1).code))hierarchy=false;
    if(stack.length){row.parent=stack.at(-1);row.parent.children.push(row);}stack.push(row);rows.push(row);
   });
   if(!hasIndent){const sorted=rows.map(r=>r.code).sort();if(sorted.some((code,i)=>i>0&&code.startsWith(sorted[i-1])))hierarchy=false;}
   if(!hierarchy)add('trial.hierarchy','科目名称缩进与编码层级不明确，未混加父子科目；请用高级映射核对','pending',[ref(m,[address(m.header,m.cols.name),address(m.header,m.cols.code)])]);
   const leaves=rows.filter(r=>!r.children.length),roots=rows.filter(r=>!r.parent);m.rows=rows;m.leaves=leaves;m.roots=roots;m.valid=valid&&hierarchy&&!m.hasUnknown;m.start=m.annual&&m.meta.period?m.meta.period.slice(0,4)+'-01':m.meta.period;m.end=m.meta.period;
   const sum=(rs,k)=>rs.some(r=>r[k]===null)?null:rs.reduce((n,r)=>n+r[k],0n);
   for(const row of rows.filter(r=>r.children.length))for(const k of ['open','d','c','close'])compare('trial.parent','父科目与直属子项：'+row.code+' / '+k,row[k],sum(row.children,k),row.refs.concat(row.children.flatMap(r=>r.refs)),hierarchy);
   for(const [label,set]of [['总账',roots],['末级',leaves]]){
    compare('trial.open','余额表'+label+'期初借贷平衡',sum(set,'open'),0n,[],m.valid);compare('trial.close','余额表'+label+'期末借贷平衡',sum(set,'close'),0n,[],m.valid);
    compare('trial.move','余额表'+label+'发生额借贷平衡',sum(set,'d'),sum(set,'c'),[],m.valid);
   }
   if(m.total){compare('trial.declared.debit','末级借方发生额与原合计',sum(leaves,'d'),m.total.debit,[ref(m,address(m.total.r,m.cols.debit))],m.valid);compare('trial.declared.credit','末级贷方发生额与原合计',sum(leaves,'c'),m.total.credit,[ref(m,address(m.total.r,m.cols.credit))],m.valid);}
   m.summary={...m.meta,type:m.type,rowCount:rows.length,leafCount:leaves.length,rootCount:roots.length,start:m.start,end:m.end,openingRepresentation:'方向+单列原始金额；只转换正负号，没有把空白补0'};
  }
  function scopeSame(a,b){return a.meta.entity&&a.meta.entity===b.meta.entity&&a.start===b.start&&a.end===b.end&&(!a.meta.unit||!b.meta.unit||a.meta.unit===b.meta.unit)&&(!a.meta.currency||!b.meta.currency||a.meta.currency===b.meta.currency);}
  for(const t of models.filter(m=>m.type==='trial')){
   const candidates=models.filter(m=>m.type==='ledger'&&scopeSame(m,t));
   if(candidates.length!==1){add('ledger.trial.scope',candidates.length?'同主体同期间有多份流水来源，需人工选定，未任意挑选':'本余额表尚无同主体、同期间的唯一流水，未跨组套用','pending',[ref(t,t.meta.metadataRefs)]);continue;}
   const l=candidates[0],used=new Set();
   for(const r of t.leaves){const key=t.meta.entity+'|'+r.code,a=l.accounts.get(key);used.add(key);
    if(!a){add('ledger.trial.missing','未在流水读取到该末级科目，未推定其发生额为0：'+r.code,'pending',r.refs);continue;}
    const ready=l.valid&&t.valid;compare('ledger.trial.debit','流水对末级余额表借方：'+r.code,a.d,r.d,a.refs.concat(r.refs),ready);compare('ledger.trial.credit','流水对末级余额表贷方：'+r.code,a.c,r.c,a.refs.concat(r.refs),ready);
   }
   for(const [key,a]of l.accounts)if(!used.has(key))add('ledger.trial.unmapped','流水科目未映射到余额表末级：'+key.split('|').at(-1)+(a.d===0n&&a.c===0n?'（原借贷红字抵销后均为0，仍保留映射提示）':''),'pending',a.refs);
   if(!l.meta.unit||!t.meta.unit||!l.meta.currency||!t.meta.currency)add('scope.units','流水/余额表未明确声明币种或金额单位；上述是原数值的算术对照，金额口径仍需核对','pending',[ref(l,l.meta.metadataRefs),ref(t,t.meta.metadataRefs)]);
  }
  for(const l of models.filter(m=>m.type==='ledger'))if(models.filter(m=>m.type==='trial'&&scopeSame(l,m)).length!==1)add('ledger.trial.counterpart','本流水缺少同主体同期间的唯一余额表来源，未猜测对应关系','pending',[ref(l,l.meta.metadataRefs)]);
  function statementLine(m,pattern){
   const hits=[];for(const [addr,c]of Object.entries(m.s.cells)){if(typeof c.v!=='string'||!pattern.test(norm(c.v)))continue;const mm=/^([A-Z]+)(\d+)$/.exec(addr);let col=0;for(const ch of mm[1])col=col*26+ch.charCodeAt(0)-64;hits.push({row:Number(mm[2])-1,col:col-1,label:c.v});}return hits.length===1?hits[0]:null;
  }
  function amountAfter(m,line,labels){
   if(!line)return {n:null,cell:''};
   for(let r=0;r<=Math.min(6,m.s.range.e.r);r++)for(let c=line.col+1;c<=Math.min(line.col+5,m.s.range.e.c);c++)if(labels.includes(norm(text(m.s,r,c))))return {n:get(m,line.row,c),cell:address(line.row,c)};
   return {n:null,cell:address(line.row,line.col)};
  }
  for(const m of models.filter(x=>['balance','profit','cash'].includes(x.type))){
   scope(m);m.summary={...m.meta,type:m.type};
   if(m.type==='balance'){
    add('statement.trial.mapping','财报与余额表的逐行科目对应尚需人工确认；未自动重分类、编审计调整或生成审定数','pending',[ref(m,m.meta.metadataRefs)]);
    const aa=statementLine(m,/^资产总计$/u),ll=statementLine(m,/^负债合计$/u),ee=statementLine(m,/^(?:所有者权益|股东权益)(?:\(或股东权益\))?合计$/u);
    for(const [label,heads]of [['期初',['年初数','期初数','期初余额']],['期末',['期末数','期末余额']]]){
     const a=amountAfter(m,aa,heads),l=amountAfter(m,ll,heads),e=amountAfter(m,ee,heads);compare('statement.balance','资产负债表'+label+'：资产=负债+权益',a.n,l.n===null||e.n===null?null:l.n+e.n,[ref(m,[a.cell,l.cell,e.cell].filter(Boolean))]);
    }
   }else if(m.type==='profit')m.netProfit=statementLine(m,/^(?:[一二三四五六七八九十]+、)?净利润(?:\(.*\))?$/u);
   else{
    m.netProfit=statementLine(m,/^净利润$/u);
    const open=statementLine(m,/^(?:加:)?期初现金及现金等价物余额$/u),close=statementLine(m,/^(?:[一二三四五六七八九十]+、)?期末现金及现金等价物余额$/u),net=statementLine(m,/^[一二三四五六七八九十]+、现金及现金等价物净增加额$/u)||statementLine(m,/^现金及现金等价物净增加额$/u),heads=['本年实际','本年累计'];
    const a=amountAfter(m,open,heads),b=amountAfter(m,close,heads),c=amountAfter(m,net,heads);compare('cash.rollforward','现金流量表：期初现金+净增加=期末现金',b.n,a.n===null||c.n===null?null:a.n+c.n,[ref(m,[a.cell,b.cell,c.cell].filter(Boolean))]);
   }
  }
  for(const p of models.filter(m=>m.type==='profit')){
   const candidates=models.filter(m=>m.type==='cash'&&p.meta.entity&&m.meta.entity===p.meta.entity&&p.meta.period&&m.meta.period===p.meta.period);
   if(candidates.length!==1){add('profit.cash.scope','利润表与现金流量表缺少同主体同期间的唯一对应来源，未跨组套用','pending',[ref(p,p.meta.metadataRefs)]);continue;}
   const c=candidates[0];for(const [label,hp,hc]of [['本月',['本月数','本期金额'],['本月实际','本月数']],['本年累计',['本年累计','本年累计数'],['本年实际','本年累计']]]){
    const a=amountAfter(p,p.netProfit,hp),b=amountAfter(c,c.netProfit,hc);compare('profit.cash','利润表与现金流量表补充资料净利润：'+label,a.n,b.n,[ref(p,a.cell),ref(c,b.cell)]);
   }
  }
  const groups=[...new Set(models.map(m=>m.meta.entity+' / '+(m.start||m.meta.period)+'～'+(m.end||m.meta.period)))];
  if(groups.length>1)add('scope.groups','识别到多个主体或期间，已分别列示；禁止把不同组资料合并成一套账','pending');
  if(omittedChecks)checks.push({id:'checks.limit',status:'pending',label:'另有 '+omittedChecks+' 项超出本次结果明细上限，请按资料范围单独复核。',refs:[]});
  const summary={pass:checks.filter(c=>c.status==='pass').length,difference:checks.filter(c=>c.status==='difference').length,pending:checks.filter(c=>c.status==='pending').length};
  return {schemaVersion:1,readOnly:true,summary,checks,sources:summaries,groups,models:models.map(m=>m.summary),notice:'仅为所上传原数值的技术算术核验；不代表资料完整、审计通过或审定数，不自动确认任何资料或底稿。'};
 }
 async function collect(key,{signal,isCurrent,files=[],entity,workbooksOnly=false}={}){
  const A=root.AuditChecklist,S=root.ProjectWorkspaceStore,check=()=>{if(signal?.aborted||isCurrent&&isCurrent()!==true){const e=Error('项目或资料已变化，本轮校验已取消。');e.name='AbortError';throw e;}};
  check();const sources=[],notes=[],hashes=new Set();
  let cells=0,skipped=0,failed=0,record;
  const pending=(id,label,name,sha256)=>notes.push({id,status:'pending',label:name+' · '+label,refs:[{name,sha256,sheet:'',cells:[]}]});
  async function read(blob,name,sha,role){
   check();
   const stamp=sha+'|'+(role||'');
   if(hashes.has(stamp)){notes.push({id:'source.duplicate',status:'pass',label:'同内容副本已去重：'+name,refs:[]});return;}
   if(hashes.size>=LIMITS.sources||cells>=LIMITS.cells){skipped++;return;}
   hashes.add(stamp);
   try{
    const model=await root.WorkpaperSheets.read(new root.File([blob],name),{signal,audit:true});check();
    const count=model.sheets.reduce((sum,sheet)=>sum+Object.keys(sheet.cells||{}).length,0);
    if(cells+count>LIMITS.cells){skipped++;pending('source.cellLimit','超过本轮单元格容量，须单独核对。',name,sha);return;}
    cells+=count;sources.push({name,sha256:sha,model,role});
   }catch(error){check();failed++;pending('source.unreadable',error.message||'工作簿读取失败，待核对。',name,sha);}
  }
  async function readArchive(blob,name,sha,role,budget,depth=0){
   let archive;
   let found=false;
   try{
    archive=await root.BidderArchive.open(new root.File([blob],name),{signal,entryLimit:2048,legacyZipNames:true});
    const entries=archive.entries.filter(e=>isWorkbookSource(e.name)&&!e.directory&&!e.name.split(/[\\/]/u)
     .some(part=>part==='__MACOSX'||/^(?:\._|~\$|\.~|~lock\.)/iu.test(part)));
    for(const entry of entries){
     check();
     const fullName=name+' / '+entry.name;
     const nested=/\.zip$/iu.test(entry.name);
     if(hashes.size>=LIMITS.sources||cells>=LIMITS.cells||budget.bytes+entry.size>LIMITS.archiveBytes||nested&&depth>=3){
      found=true;skipped++;pending('source.member','超过本轮解包或读取容量，请将该成员单独上传核对。',fullName,sha);continue;
     }
     budget.bytes+=entry.size;
     try{
      const bytes=(await archive.read([entry.name])).get(entry.name),source=new root.Blob([bytes]);
      const sourceHash=await S.hash(source);
      if(nested){if(await readArchive(source,fullName,sourceHash,role,budget,depth+1))found=true;}
      else{found=true;await read(source,fullName,sourceHash,role);}
     }catch(error){check();found=true;failed++;pending('source.member',error.message||'ZIP 成员读取失败。',fullName,sha);}
    }
   }catch(error){check();found=true;failed++;pending('source.archive',error.message||'压缩包读取失败。',name,sha);}
   finally{archive?.close();}
   return found;
  }
  async function readSource(blob,name,sha,role){
   if(!/\.zip$/iu.test(name)){await read(blob,name,sha,role);return;}
   if(!await readArchive(blob,name,sha,role,{bytes:0})){
    failed++;pending('source.archive.empty','ZIP 及其内层压缩包没有 XLS/XLSX 工作簿。',name,sha);
   }
  }
  if(files.length){
   if(files.length>LIMITS.sources)throw Error('单次最多选择 '+LIMITS.sources+' 份文件。');
   for(const input of files){
    const f=input.file||input,role=Object.hasOwn(ROLES,input.role)?input.role:undefined;
    check();
    if(!isWorkbookSource(f.name)||!f.size||f.size>100*1024*1024){
     failed++;pending('source.unsupported','请选择 100 MiB 以内有效 XLS/XLSX/ZIP。',f.name,'');continue;
    }
    await readSource(f,f.name,await S.hash(f),role);
   }
  }else{
   const workspace=await S.get(key);check();
   if(workspace.id!==key)throw Error('当前项目资料的归属无法核对。');
   const uploaded=clientWorkbooks(workspace);
   const db=await(key===A.TRIAL_ID?A.openTrial():A.open());
   try{
    const saved=await db.get(key);check();
    if(saved?.schema===2&&saved.project?.quoteId!==key)throw Error('资料清单附件的项目归属无法核对。');
    if(saved?.schema===2)record=saved;
    if(!record&&!uploaded.length)throw Error('本项目尚无已上传的账表资料。可在本页选择三栏账、科目余额表和未审报表。');
    const refs=Object.entries(record?.attachments||{}).flatMap(([node,items])=>items.filter(m=>m.nodeId===node&&m.generationId===record.generationId).map(m=>({node,m})));
    for(const {node,m} of refs){
     check();
     if(!isWorkbookSource(m.name))continue;
     const got=await db.downloadAttachment(key,node,m.id);check();
     if(got.metadata.sha256!==m.sha256||got.metadata.id!==m.id||got.metadata.nodeId!==node||got.metadata.generationId!==record.generationId)throw Error('资料原件身份与登记不符，未继续校验。');
     if(await S.hash(got.blob)!==m.sha256)throw Error('资料原件 SHA256 不符，已阻止校验。');
     check();await readSource(got.blob,m.name,m.sha256);
    }
    for(const file of uploaded){
     check();
     if(file.blob?.size!==file.size||await S.hash(file.blob)!==file.sha256)
      throw Error('客户资料的文件校验失败，请重新上传：'+file.name);
     await readSource(file.blob,file.name,file.sha256);
    }
    const [latest,latestWorkspace]=await Promise.all([db.get(key),S.get(key)]);check();
    if(latest?.revision!==saved?.revision||latest?.generationId!==saved?.generationId||
       fileStamp(clientWorkbooks(latestWorkspace))!==fileStamp(uploaded))
     throw Error('项目资料已更新，本轮结果作废，请重新核验。');
   }finally{db.close();}
  }
  if(workbooksOnly){
   if(failed||skipped)throw Error(notes.find(note=>note.status==='pending')?.label||'部分三栏账未能读取，请核对上传资料。');
   return sources;
  }
  const result=analyze(sources,{entity});
  result.standard=root.LedgerStandard?.build(sources,{entity,blocked:!!(failed||skipped)});
  if(!result.models.some(model=>roleFor(model.type)==='statements')){
   result.checks.push({id:'statement.missing',status:'pending',label:'未识别到未审报表。请补充本项目的资产负债表、利润表或现金流量表 Excel。',refs:[]});
   result.summary.pending++;
  }
  if(result.standard){
   const covered=new Set([...result.standard.origins.map(row=>row[7]),...result.standard.balance.map(row=>row[16])]);
   result.checks=result.checks.filter(check=>!['unknown','source.unrecognized'].includes(check.id)||!covered.has(check.refs[0]?.name));
   result.summary.pending=result.checks.filter(check=>check.status==='pending').length;
  }
  if(result.standard)for(const note of notes.filter(item=>item.status==='pending'))
   result.standard.issues.push(['待核',entity||'','','','读取来源','','','',note.label,note.refs[0].name,'']);
  result.checks.unshift(...notes);for(const n of notes)result.summary[n.status]++;
  result.materialRevision=record?.revision??null;result.generationId=record?.generationId??null;
  if(skipped){result.checks.push({id:'source.limit',label:'有 '+skipped+' 份账表超出本轮读取容量，须另行核对。',status:'pending',refs:[]});result.summary.pending++;}
  result.workbooks={read:sources.length,skipped,failed};
  if(!sources.length){result.checks.push({id:'source.empty',label:'本轮没有可读取的 XLS/XLSX 账表附件。',status:'pending',refs:[]});result.summary.pending++;}
  return result;
 }
 function mount(host,ctx){
  const d=host.ownerDocument,el=(t,s)=>{const n=d.createElement(t);if(s!==undefined)n.textContent=s;return n;};
  const box=el('section'),title=el('h3','三栏账、科目余额表、未审报表核验'),status=el('p'),output=el('div'),actions=el('div');
  const button=(text,action)=>{const node=el('button',text);node.type='button';node.className='btn';node.onclick=action;return node;};
  const fileBoxes=el('div'),selected=new Map(),captions=new Map();
  fileBoxes.className='ledger-file-boxes';
  for(const [role,label]of Object.entries(ROLES)){
   const upload=el('input'),drop=el('label'),chosen=el('span');
   upload.type='file';upload.multiple=true;upload.accept='.xls,.xlsx,.zip';upload.setAttribute('aria-label',label);
   drop.className='quote-file-drop';
   drop.append(upload,chosen);
   globalThis.ShenyiFileDrop?.present(drop,upload,{material:label,before:chosen});
   fileBoxes.append(drop);captions.set(role,chosen);
   upload.onchange=()=>{choose(role,upload.files);upload.value='';};
   drop.ondragover=event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();drop.classList.add('is-dragover');}};
   drop.ondragleave=()=>drop.classList.remove('is-dragover');
   drop.ondrop=event=>{event.preventDefault();drop.classList.remove('is-dragover');choose(role,event.dataTransfer?.files);};
  }
  const run=button('核验',()=>void refresh()),useSaved=button('使用已上传资料',()=>{
   selected.clear();for(const caption of captions.values())caption.textContent='';
   void refresh();
  });
  actions.className='ledger-standard-actions';
  actions.append(useSaved,run);box.className='ap-card';box.dataset.auditAutoCheck='';status.setAttribute('role','status');
  box.append(title,fileBoxes,actions,status,output);host.append(box);
  let alive=true,controller,epoch=0,busy=false,lastRevision=null,lastGeneration=null,standard=null;
  const current=()=>alive&&(!ctx.isCurrent||ctx.isCurrent())&&ctx.getRecord()?.id===ctx.key;
  function choose(role,files){
   if(!current()||!files?.length)return;
   selected.set(role,Array.from(files,file=>({file,role})));
   captions.get(role).textContent=files.length===1?files[0].name:'已选 '+files.length+' 份文件';
   controller?.abort();epoch++;busy=false;run.disabled=false;standard=null;output.replaceChildren();
   status.textContent='文件已选好，点击「核验」查看结果。';
  }
  function refsText(c){return c.refs.map(r=>r.name+(r.sha256?' · SHA '+r.sha256.slice(0,12):'')+' / '+r.sheet+'!'+r.cells.filter(Boolean).join(', ')).join('；');}
  function list(parent,items){let shown=0;const more=el('button','继续显示'),rows=el('div');more.type='button';parent.append(rows,more);const append=()=>{for(const c of items.slice(shown,shown+100)){const p=el('p',(c.status==='difference'?'差异':c.status==='pending'?'待核':'算术一致')+' · '+c.label+(c.difference!==undefined&&c.difference!==null?' · 差额 '+c.difference:''));if(c.refs.length)p.append(el('small',' 来源：'+refsText(c)+(c.sourceRefsTruncated?'（本项地址较多，显示前64条）':'')));p.className=c.status==='pass'?'ap-pass':'ap-warning';rows.append(p);}shown+=100;more.hidden=shown>=items.length;};more.onclick=append;append();}
  function showStandard(result){
   if(!result)return;
   const heading=el('h4','标准表下载'),line=el('p','已整理 '+result.journal.length+' 行凭证流水、'+result.balance.length+' 行余额表。');
   const wrap=el('div');wrap.className='ledger-standard-actions';output.append(heading,line,wrap);
   async function download(kind){
    if(!current()||busy||!wrap.isConnected)return;
    try{
     const file=await root.LedgerStandard.exportFile(result,kind);
     if(!current()||busy||!wrap.isConnected)return;
     root.ProjectWorkspaceStore.download(new Blob([file.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),file.name);
    }catch(error){status.textContent=error.message;}
   }
   const journal=button('下载标准版凭证流水查询',()=>download('journal')),balance=button('下载标准版科目余额表',()=>download('balance'));
   journal.disabled=!result.journal.length;balance.disabled=!result.balance.length;
   wrap.append(journal,balance);
  }
  function showDifferences(result,checks,workbooks){
   output.append(el('h4','差异及待核事项'));
   const issues=result?.issues||[],alerts=checks.filter(check=>check.status!=='pass'&&
    !['source.unreadable','source.member','source.archive','source.archive.empty','source.unsupported','source.cellLimit'].includes(check.id));
   const differences=issues.filter(r=>r[0]==='差异').length+alerts.filter(check=>check.status==='difference').length;
   if(!workbooks.read)output.append(el('p','未读取到工作簿，本轮未完成核验。'));
   else if(!issues.length&&!alerts.length){output.append(el('p','已识别范围内未发现差异或待核事项。'));return;}
   else output.append(el('p',(workbooks.failed||workbooks.skipped?'已读取范围内发现差异 ':'差异 ')+differences+' 项。其他问题、待核依据和口径说明见下方。'));
   let count=0;
   const rows=el('div'),more=button('继续显示差异及待核',append);
   output.append(rows,more);
   function append(){
    for(const [stat,unit,period,account,metric,a,b,delta,note,file,comparison]of issues.slice(count,count+100)){
     const p=el('p',[stat,unit,period,account,metric].filter(Boolean).join(' · ')+(delta!==''?' · 差额 '+delta+'（账页 '+a+'／余额表 '+b+'）':'')+'。'+note);
     if(file||comparison)p.append(el('small',' 来源：'+[file,comparison].filter(Boolean).join('；')));
     p.className='ap-warning';rows.append(p);
    }
    count+=100;more.hidden=count>=issues.length;
   }
   append();
   if(alerts.length){const details=el('div');output.append(details);list(details,alerts);}
  }
  function display(result){
   standard=result.standard;
   output.replaceChildren();
   status.textContent='已读取 '+result.workbooks.read+' 份工作簿'+(result.workbooks.skipped||result.workbooks.failed?' · 另有 '+(result.workbooks.skipped+result.workbooks.failed)+' 份待读取':'');
   showDifferences(result.standard,result.checks,result.workbooks);
   showStandard(result.standard);
   const details=el('details');
   details.append(el('summary','其他账表算术核验'),el('p',result.notice));
   for(const group of result.groups)details.append(el('p','资料分组：'+group));
   list(details,result.checks.filter(check=>check.status==='pass'));
   output.append(details);
  }
  async function refresh(){
   if(!current())return;
   controller?.abort();controller=new AbortController();const ticket=++epoch;
   busy=true;standard=null;run.disabled=true;status.textContent='正在本机读取并核对…';output.replaceChildren();
   try{
    const result=await collect(ctx.key,{signal:controller.signal,isCurrent:()=>current()&&ticket===epoch,files:[...selected.values()].flat(),entity:ctx.entity});
    if(!current()||ticket!==epoch)return;lastRevision=result.materialRevision;lastGeneration=result.generationId;display(result);
   }catch(e){if(current()&&ticket===epoch)status.textContent=e.message||'账表读取失败。';}
   finally{if(current()&&ticket===epoch){busy=false;run.disabled=false;}}
  }
  void refresh();
  const timer=setInterval(async()=>{
   if(!current()||busy||selected.size||lastRevision===null)return;
   let db;
   try{
    const A=root.AuditChecklist;db=await(ctx.key===A.TRIAL_ID?A.openTrial():A.open());
    const r=await db.get(ctx.key);
    if(current()&&(r?.revision!==lastRevision||r?.generationId!==lastGeneration))void refresh();
   }catch{}finally{db?.close();}
  },5000);
  async function exportLedger(mode){
   if(busy)throw Error('账表正在读取和校验，请完成后再导出。');
   if(!standard||!standard.journal.length&&!standard.balance.length)
    throw Error('请先选择账表资料并点击「核验」。');
   if(mode==='journal'&&!standard.journal.length)throw Error('本轮只有科目余额表，请补充凭证流水或三栏账。');
   const ticket=epoch;
   const file=mode==='journal'?await root.LedgerStandard.exportFile(standard,'journal'):
    await root.LedgerStandard.exportPrivacyCopy(standard,mode,ctx.entity);
   if(!current()||ticket!==epoch)return null;
   return mode==='journal'?{...file,name:'序时账.xlsx'}:file;
  }
  return {refresh,exportLedger,destroy(){alive=false;epoch++;controller?.abort();clearInterval(timer);box.remove();}};
 }
 const api=Object.freeze({analyze,collect,mount,cents,money,LIMITS});root.AuditAutoCheck=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
