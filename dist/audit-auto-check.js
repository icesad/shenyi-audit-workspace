/* Source-derived, read-only arithmetic diagnostics. No audit opinion, guessed
 * balances, implicit confirmation, or write-back to a project/workpaper. */
(function(root){'use strict';
 const LIMITS=Object.freeze({sources:24,rows:20000,checks:12000,refs:64,archiveBytes:64*1024*1024});
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
 const entity=s=>norm(s).replace(/^单位(?:名称)?:/,'').replace(/有限公司本部$/u,'有限公司').replace(/事务所本部$/u,'事务所');
 function period(s){const m=/(20\d{2})[-年/](0?[1-9]|1[0-2])(?:月)?(?:$|\D)/.exec(String(s));return m?m[1]+'-'+m[2].padStart(2,'0'):'';}
 function meta(source,s){
  const found={entity:'',period:'',unit:'',currency:'',metadataRefs:[],conflictingPeriods:[]},dates=[];
  for(let r=0;r<=Math.min(4,s.range.e.r);r++)for(let c=0;c<=Math.min(20,s.range.e.c);c++){
   const v=text(s,r,c),n=norm(v);if(!n)continue;
   if(/^责任中心:/.test(n)){const p=v.split(/[／/]/u).at(-1).replace(/^责任中心[:：]\s*[\da-z]+\s*/iu,'');found.entity=entity(p);found.metadataRefs.push(address(r,c));}
   else if(/^(?:单位|单位名称|被审计单位|核算单位):/.test(n)){found.entity=entity(v);found.metadataRefs.push(address(r,c));}
   if(/^会计期间:/.test(n)){found.period=period(n);found.metadataRefs.push(address(r,c));}
   else if(/^20\d{2}年\d{1,2}月$/.test(n)||/^20\d{2}-\d{2}$/.test(n)){dates.push({v:period(n),cell:address(r,c)});}
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
   const open=pick(h,['上年结转','上期结转','期初余额']),close=pick(h,['当前余额','期末余额']),name=pick(h,['科目名称']),move=pick(h,['累计发生','本期发生']);
   if([code,name,open,close,move].every(x=>x>=0)&&norm(text(s,r,open-1))==='方向'&&norm(text(s,r,close-1))==='方向'){
    const sub=headers(s,r+1),d=pick(sub,['借方']),c=pick(sub,['贷方']);
    if(d>=0&&c>=0)return {type:'trial',s,source,meta:meta(source,s),header:r+1,cols:{code,name,open,close,openDir:open-1,closeDir:close-1,debit:d,credit:c},annual:norm(text(s,r,move))==='累计发生'};
   }
  }
  const title=[0,1,2].flatMap(r=>[0,1,2].map(c=>norm(text(s,r,c))));
  for(const [name,type]of [['资产负债表','balance'],['利润表','profit'],['现金流量表','cash']])if(title.includes(name))return {type,s,source,meta:meta(source,s)};
  return null;
 }
 function analyze(sources=[]){
  if(!Array.isArray(sources)||sources.length>LIMITS.sources)throw Error('自动校验最多读取24份账表，请拆分后核对。');
  const checks=[],models=[],summaries=[],seen=new Set(),sameNames=new Map();
  const ref=(m,cells)=>({name:m.source.name,sha256:m.source.sha256,sheet:m.s.name,cells:Array.isArray(cells)?cells:[cells]});
  function add(id,label,status,refs=[],extra={}){if(checks.length>=LIMITS.checks)throw Error('检查项超过12000项，请分组核对。');checks.push({id,label,status,refs:refs.slice(0,LIMITS.refs),...(refs.length>LIMITS.refs?{sourceRefsTruncated:true}:{}),...extra});}
  const compare=(id,label,a,b,refs,ready=true)=>add(id,label,a===null||b===null||!ready?'pending':a===b?'pass':'difference',refs,{actual:money(a),expected:money(b),difference:a===null||b===null?null:money(a-b)});
  for(const source of sources){
   if(!source?.model?.sheets||typeof source.name!=='string')throw Error('账表读取模型无效。');
   if(source.sha256&&seen.has(source.sha256)){add('duplicate','同内容副本已去重，不重复累计：'+source.name,'pass');continue;}if(source.sha256)seen.add(source.sha256);
   const n=source.name.normalize('NFKC').toLowerCase();if(!sameNames.has(n))sameNames.set(n,new Set());sameNames.get(n).add(source.sha256||source);
   let recognized=0;
   for(const s of source.model.sheets){
    if(!s.cells||!s.range||s.range.e.r>1000000)throw Error('工作表范围无效。');
    const formulaCells=Object.entries(s.cells).filter(([,c])=>c.f).map(([a])=>a);
    if(formulaCells.length)add('source.cachedFormula','源表含公式，仅读取原缓存；没有执行、重算或更新外链，需核对缓存是否最新','pending',[{name:source.name,sha256:source.sha256,sheet:s.name,cells:formulaCells.slice(0,32)}]);
    const m=recognize(source,s);if(m){recognized++;models.push(m);}
    else if(!/^目录$/.test(norm(text(s,0,0)))&&!/目录/.test(s.name))add('unknown','未识别明确账表表头，未猜测列映射：'+source.name+' / '+s.name,'pending',[{name:source.name,sha256:source.sha256,sheet:s.name,cells:['A1']}]);
   }
   summaries.push({name:source.name,sha256:source.sha256,recognizedSheets:recognized});
   if(!recognized)add('source.unrecognized','这份工作簿没有明确可识别的自动账表模板，未开展猜测核验：'+source.name,'pending');
  }
  for(const [n,hashes]of sameNames)if(hashes.size>1)add('same-name','同名文件存在不同内容，未任意选择：'+n,'pending');
  function scope(m){
   if(!m.meta.entity)add('scope.entity','未识别明确主体，禁止跨表串用：'+m.source.name,'pending',[ref(m,m.meta.metadataRefs)]);
   if(!m.meta.period)add('scope.period','未识别明确会计期间：'+m.source.name,'pending',[ref(m,m.meta.metadataRefs)]);
   if(m.meta.conflictingPeriods.length)add('scope.dates','表头存在不同日期，请核对范围；未忽略冲突日期','pending',[ref(m,m.meta.conflictingPeriods.map(x=>x.cell))],{periodCandidates:m.meta.conflictingPeriods});
  }
  function get(m,r,c){return cents(value(m.s,r,c));}
  function validDataRows(m,callback){
   const max=m.s.range.e.r;if(max-m.header>LIMITS.rows)throw Error('单张账表超过20000行自动校验上限。');
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
  const summary={pass:checks.filter(c=>c.status==='pass').length,difference:checks.filter(c=>c.status==='difference').length,pending:checks.filter(c=>c.status==='pending').length};
  return {schemaVersion:1,readOnly:true,summary,checks,sources:summaries,groups,models:models.map(m=>m.summary),notice:'仅为所上传原数值的技术算术核验；不代表资料完整、审计通过或审定数，不自动确认任何资料或底稿。'};
 }
 async function collect(key,{signal,isCurrent}={}){
  const A=root.AuditChecklist,S=root.ProjectWorkspaceStore,check=()=>{if(signal?.aborted||isCurrent&&isCurrent()!==true){const e=Error('项目/资料已变化，旧校验已取消。');e.name='AbortError';throw e;}};
  check();const db=await(key===A.TRIAL_ID?A.openTrial():A.open()),sources=[],notes=[],hashes=new Set();
  try{
   const record=await db.get(key);check();if(!record||record.schema!==2||record.project?.quoteId!==key)throw Error('本项目尚无当前标题清单附件。');
   const refs=Object.entries(record.attachments||{}).flatMap(([node,items])=>items.filter(m=>m.nodeId===node&&m.generationId===record.generationId).map(m=>({node,m})));
   for(const {node,m}of refs){
    check();if(!/\.(?:xlsx?|zip)$/iu.test(m.name))continue;
    const got=await db.downloadAttachment(key,node,m.id);check();
    if(got.metadata.sha256!==m.sha256||got.metadata.id!==m.id||got.metadata.nodeId!==node||got.metadata.generationId!==record.generationId)throw Error('资料原件身份与登记不符，未继续校验。');
    if(await S.hash(got.blob)!==m.sha256)throw Error('资料原件SHA256不符，已阻止校验。');check();
    const read=async(blob,name,sha)=>{check();if(hashes.has(sha)){notes.push({id:'source.duplicate',status:'pass',label:'同内容副本已去重：'+name,refs:[]});return;}hashes.add(sha);if(hashes.size>LIMITS.sources)throw Error('账表附件超过24份，请按项目拆分。');try{const model=await root.WorkpaperSheets.read(new root.File([blob],name),{signal});check();sources.push({name,sha256:sha,model});}catch(e){check();notes.push({id:'source.unreadable',status:'pending',label:'该工作簿未读成功，未当作空数据：'+name+' · '+(e.message||'读取失败'),refs:[{name,sha256:sha,sheet:'',cells:[]}]});}};
    if(/\.zip$/iu.test(m.name)){
     const archive=await root.BidderArchive.open(new root.File([got.blob],m.name),{signal});
     try{const entries=archive.entries.filter(e=>/\.xlsx?$/iu.test(e.name)&&!e.directory);if(entries.reduce((n,e)=>n+e.size,0)>LIMITS.archiveBytes)throw Error('压缩包内账表超过64MiB读取上限。');for(const e of entries){check();const entries=await archive.read([e.name]),bytes=entries.get(e.name),blob=new root.Blob([bytes]);await read(blob,m.name+' / '+e.name,await S.hash(blob));}}finally{archive.close();}
    }else await read(got.blob,m.name,m.sha256);
   }
   const latest=await db.get(key);check();if(latest?.revision!==record.revision||latest?.generationId!==record.generationId)throw Error('资料清单已更新，本轮结果作废，请重新校验。');
   const result=analyze(sources);result.checks.push(...notes);for(const n of notes)result.summary[n.status]++;result.materialRevision=record.revision;result.generationId=record.generationId;
   if(!sources.length){result.checks.push({id:'source.empty',label:'本项目还没有可读取的XLS/XLSX账表附件，未从其他项目借用。',status:'pending',refs:[]});result.summary.pending++;}
   return result;
  }finally{db.close();}
 }
 function mount(host,ctx){
  const d=host.ownerDocument,el=(t,s)=>{const n=d.createElement(t);if(s!==undefined)n.textContent=s;return n;},box=el('section'),title=el('h3','自动账表校验'),status=el('p','正在从本项目资料收集读取账表…'),run=el('button','重新校验'),output=el('div');
  box.className='ap-card';box.dataset.auditAutoCheck='';status.setAttribute('role','status');run.type='button';box.append(title,el('p','进入页面自动读取同项目XLS/XLSX（也读取ZIP内账表），复核SHA并按真实表头识别。未知格式/单位/主体/科目映射列为待核，不猜测、不填0、不改原件或底稿。'),run,status,output);host.append(box);
  let alive=true,controller,epoch=0,busy=false,lastRevision=null;
  const current=()=>alive&&(!ctx.isCurrent||ctx.isCurrent())&&ctx.getRecord()?.id===ctx.key;
  function refsText(c){return c.refs.map(r=>r.name+(r.sha256?' · SHA '+r.sha256.slice(0,12):'')+' / '+r.sheet+'!'+r.cells.filter(Boolean).join(', ')).join('；');}
  function list(parent,items){let shown=0;const more=el('button','继续显示'),rows=el('div');more.type='button';parent.append(rows,more);const append=()=>{for(const c of items.slice(shown,shown+100)){const p=el('p',(c.status==='difference'?'差异':c.status==='pending'?'待核':'算术一致')+' · '+c.label+(c.difference!==undefined&&c.difference!==null?' · 差额 '+c.difference:''));if(c.refs.length)p.append(el('small',' 来源：'+refsText(c)+(c.sourceRefsTruncated?'（本项地址较多，显示前64条）':'')));p.className=c.status==='pass'?'ap-pass':'ap-warning';rows.append(p);}shown+=100;more.hidden=shown>=items.length;};more.onclick=append;append();}
  function display(result){
   output.replaceChildren();status.textContent='原数值算术一致 '+result.summary.pass+' 项 · 差异 '+result.summary.difference+' 项 · 待核 '+result.summary.pending+' 项';
   output.append(el('p',result.notice));for(const group of result.groups)output.append(el('p','资料分组：'+group));
   const issues=result.checks.filter(c=>c.status!=='pass');if(issues.length){const details=el('div');output.append(details);list(details,issues);}else output.append(el('p','已识别范围内未发现算术差异；仍须人工核对主体、金额单位、期间和完整性。'));
   const passed=el('details');passed.append(el('summary','查看算术一致项及源地址（'+result.summary.pass+'）'));output.append(passed);list(passed,result.checks.filter(c=>c.status==='pass'));
  }
  async function refresh(){
   if(!current())return;controller?.abort();controller=new AbortController();const ticket=++epoch;busy=true;run.disabled=true;status.textContent='正在本机读取并核验…';output.replaceChildren();
   try{const result=await collect(ctx.key,{signal:controller.signal,isCurrent:()=>current()&&ticket===epoch});if(!current()||ticket!==epoch)return;lastRevision=result.materialRevision;display(result);}
   catch(e){if(current()&&ticket===epoch){status.textContent='未完成自动校验：'+(e.message||'读取失败。')+' 原件与原有手动映射均未改动。';}}
   finally{if(current()&&ticket===epoch){busy=false;run.disabled=false;}}
  }
  run.onclick=()=>void refresh();void refresh();
  const timer=setInterval(async()=>{if(!current()||busy||lastRevision===null)return;let db;try{const A=root.AuditChecklist;db=await(ctx.key===A.TRIAL_ID?A.openTrial():A.open());const r=await db.get(ctx.key);if(current()&&r?.revision!==lastRevision)void refresh();}catch{}finally{db?.close();}},5000);
  return {refresh,destroy(){alive=false;epoch++;controller?.abort();clearInterval(timer);box.remove();}};
 }
 const api=Object.freeze({analyze,collect,mount,cents,money,LIMITS});root.AuditAutoCheck=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
