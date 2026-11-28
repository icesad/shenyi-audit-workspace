/* Standard journal and trial balance exports from verified local workbook models. */
(function(root){'use strict';
 const JOURNAL=[
  ['核算单位','责任中心名称','被审计单位','公司名称'],['账套名称','账套','账簿名称'],['会计年度','年度','年'],['会计期间','会计月份','期间'],
  ['凭证日期','记账日期','日期'],['凭证字','凭证类别','凭证类型'],['凭证号','凭证编号'],['分录行号','分录号','行项目','行项目编号','分录序号'],
  ['摘要','凭证摘要','分录摘要'],['科目编码','科目编号','会计科目编码','会计科目编号'],['科目名称（全路径）','科目全名','科目全称','科目名称','会计科目名称'],
  ['客户','客户名称'],['供应商','供应商名称'],['部门','部门名称'],['项目','项目名称'],['个人','个人名称','职员'],['币种','货币','币别'],
  ['汇率'],['原币借方金额','借方原币'],['原币贷方金额','贷方原币'],['本位币借方金额','本币借方金额','借方金额','借方发生额','借方'],
  ['本位币贷方金额','本币贷方金额','贷方金额','贷方发生额','贷方'],['附件张数','附单据数','附件数'],['制单人','制证人','录入人'],
  ['审核人','复核人'],['记账人','过账人'],['记账状态','凭证状态','过账状态']
 ];
 const BALANCE=['核算单位','账套名称','会计年度','期间起月','期间止月','币种','金额单位','科目编码','科目名称（全路径）','层级',
  '期初方向','期初余额','本期借方发生额','本期贷方发生额','期末方向','期末余额','来源文件','工作表','原始行号'];
 const ISSUE=['状态','核算单位','会计期间','科目编码','项目','凭证流水或三栏账','科目余额表','差额','说明','账页来源','余额表来源'];
 const norm=value=>String(value??'').normalize('NFKC').replace(/\s+/gu,'').replace(/[（(](?:人民币)?元[)）]$/u,'');
 const label=value=>norm(value).replace(/[:：]$/u,'');
 const equals=(a,b)=>norm(a)===norm(b);
 const address=(r,c)=>c<0?'':root.WorkpaperSheets.ref(r,c);
 const cell=(s,r,c)=>c<0?null:s.cells[address(r,c)]||null;
 const raw=(s,r,c)=>cell(s,r,c)?.v??'';
 const str=(s,r,c)=>String(raw(s,r,c)).trim();
 const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,'');
 const carry=/^(?:上[年期]结转|期初余额|期初结转|年初余额|期初|上月结转)$/u;
 const subtotal=/^(?:(?:本[年月期]|当[年月期])(?:合计|累计|小计)|累计|月计|合计|总计|小计|本期发生额|本年累计发生额)$/u;
 const issue=(status,meta,account,metric,note,actual='',expected='',delta='',ledger='',balance='')=>
  [status,meta.entity||'',meta.start&&meta.end?(meta.start===meta.end?meta.end:meta.start+' 至 '+meta.end):meta.end||'',
   account||'',metric,actual,expected,delta,note,ledger,balance];
 function amount(value){
  if(value==null||value===''||typeof value==='boolean')return null;
  const text=String(value).trim().normalize('NFKC');
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/u.test(text))return null;
  const [whole,fraction='']=text.replace(/,/gu,'').replace(/^-/u,'').split('.');
  if(whole.length>16)return null;
  return (text.startsWith('-')?-1n:1n)*(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')));
 }
 function money(n){
  if(n===null)return '';
  const abs=n<0n?-n:n,dec=String(abs%1000000n).padStart(6,'0').replace(/0+$/u,'').padEnd(2,'0');
  const text=(n<0n?'-':'')+String(abs/1000000n)+'.'+dec;
  return text.replace(/[-.]/gu,'').length<=15?Number(text):text;
 }
 const yearMonth=match=>match[1]+'-'+String(match[2]).padStart(2,'0');
 function month(value){
  const match=/(20\d{2})\s*[-年/.]\s*(0?[1-9]|1[0-2])(?=\D|$)/u.exec(String(value));
  return match?yearMonth(match):'';
 }
 function date(value){
  let s=String(value??'').trim();
  if(typeof value==='number'&&Number.isInteger(value)&&value>=36526&&value<=73050)s=new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
  const m=/^(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})日?$/u.exec(s);
  if(!m)return '';
  const result=yearMonth(m)+'-'+m[3].padStart(2,'0'),parsed=new Date(result+'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===result?result:'';
 }
 function identifier(s,r,c){
  const data=cell(s,r,c);
  if(!data||data.t==='e'||typeof data.v==='number'&&!Number.isSafeInteger(data.v))return '';
  return typeof data.v==='number'&&/^0\d+$/u.test(data.w||'')?data.w:str(s,r,c);
 }
 function metadata(sheet){
  const result={entity:'',companyCode:'',book:'',start:'',end:'',currency:'',unit:'',account:'',name:''};
  const periods=[];
  for(let r=0;r<=Math.min(sheet.range.e.r,8);r++)for(let c=0;c<=Math.min(sheet.range.e.c,22);c++){
   const line=str(sheet,r,c);if(!line)continue;
   const company=/公司代码\s*[:：]\s*([A-Za-z0-9_-]+)\s+([^;；]+?)(?=[;；]|$)/u.exec(line);
   const account=/(?:所选行科目|会计科目|科目)\s*[:：]\s*([A-Za-z0-9._-]+)\s+([^;；]+?)(?=[;；]|$)/u.exec(line);
   if(company){result.companyCode ||= company[1];result.entity ||= company[2].trim();}
   if(account){result.account ||= account[1];result.name ||= account[2].trim();}
   for(const [field,pattern] of [
    ['entity',/^(?:核算单位|被审计单位|责任中心|单位名称|单位)\s*[:：]\s*([^;；]+)$/u],
    ['book',/(?:账套名称|账簿名称|账套)\s*[:：]\s*([^;；]+)/u],
    ['currency',/(?:^|[;； ])(?:币种|币别|货币)\s*[:：]\s*([^;； ]+)/u],
    ['unit',/(?:金额单位|单位)\s*[:：]\s*(?:人民币)?(元|千元|万元)(?:$|[;； ])/u]
   ]){
    const match=pattern.exec(line);
    if(match&&!(field==='entity'&&/^(?:元|千元|万元|人民币(?:元)?)$/u.test(match[1])))result[field] ||= match[1].trim();
   }
   if(/会计期间\s*[:：]/u.test(line)){
    const range=line.split(/会计期间\s*[:：]/u).at(-1);
    const found=[...range.matchAll(/(20\d{2})\s*[-年/.]\s*(0?[1-9]|1[0-2])(?=\D|$)/gu)].map(yearMonth);
    periods.push(...found);
   }
  }
  if(!periods.length)for(let r=0;r<=Math.min(sheet.range.e.r,2);r++)for(let c=0;c<=Math.min(sheet.range.e.c,12);c++){
   const v=str(sheet,r,c);if(/^20\d{2}[-年/]\d{1,2}月?$/u.test(v)&&month(v))periods.push(month(v));
  }
  result.start=periods[0]||'';result.end=periods.at(-1)||'';
  return result;
 }
 function columns(s,r,aliases){
  const header=new Map();
  for(let c=0;c<=Math.min(s.range.e.c,120);c++){
   const key=label(raw(s,r,c));if(key)header.set(key,header.has(key)?-1:c);
  }
  return aliases.map(names=>names.map(label).map(key=>header.get(key)??-1).find(n=>n>=0)??-1);
 }
 const index=(s,r,...names)=>columns(s,r,[names])[0];
 function childAmount(s,r,from,to){
  for(let k=r+1;k<=r+2;k++)for(let c=from;c<to;c++)if(label(raw(s,k,c))==='金额')return {col:c,header:k};
  return {col:from,header:r};
 }
 function detect(s){
  for(let r=0;r<=Math.min(s.range.e.r,18);r++){
   const cols=columns(s,r,JOURNAL),direction=index(s,r,'方向','余额方向');
   const year=index(s,r,'年'),mon=index(s,r,'月'),day=index(s,r,'日');
   const dateColumns=[year,mon,day];
   if(cols[6]>=0&&(cols[4]>=0||dateColumns.every(n=>n>=0))){
    if(cols[20]<0||cols[21]<0)continue;
    const d=childAmount(s,r,cols[20],cols[21]),c=childAmount(s,r,cols[21],direction>cols[21]?direction:cols[21]+3);
    if(label(raw(s,r+1,cols[20]))==='数量')cols[20]=d.col;
    else d.header=r;
    if(label(raw(s,r+1,cols[21]))==='数量')cols[21]=c.col;
    else c.header=r;
    const balanceColumn=index(s,r,'余额');
    const running=balanceColumn<0?-1:childAmount(s,r,balanceColumn,s.range.e.c+1).col;
    return {kind:cols[9]>=0?'journal':'account',cols,dateColumns,header:Math.max(d.header,c.header),direction,running,
     codeCol:index(s,r,'公司代码')};
   }
   if(cols[9]<0||cols[10]<0)continue;
   const moves=index(s,r,'本期发生','累计发生','本年累计','累计发生额','本期发生额');
   const open=index(s,r,'上期结转','上年结转','期初余额','年初余额'),close=index(s,r,'当前余额','期末余额');
   const openDebit=index(s,r,'期初借方余额','期初借方','年初借方'),openCredit=index(s,r,'期初贷方余额','期初贷方','年初贷方');
   const closeDebit=index(s,r,'期末借方余额','期末借方'),closeCredit=index(s,r,'期末贷方余额','期末贷方');
   const debit=index(s,r,'本期借方发生额','本年累计借方发生额','累计借方发生额','累计借方','本期借方','借方发生额','借方');
   const credit=index(s,r,'本期贷方发生额','本年累计贷方发生额','累计贷方发生额','累计贷方','本期贷方','贷方发生额','贷方');
   if([openDebit,openCredit,closeDebit,closeCredit,debit,credit].every(n=>n>=0))
    return {kind:'balance',header:r,cols,openPair:[openDebit,openCredit],closePair:[closeDebit,closeCredit],debit,credit,
     annual:/累计/u.test(str(s,r,debit))};
   if([open,close,moves].every(n=>n>=0)&&open<moves&&moves<close){
    const nextDebit=index(s,r+1,'借方','本期借方'),nextCredit=index(s,r+1,'贷方','本期贷方');
    if(nextDebit<0||nextCredit<0)continue;
    const o=childAmount(s,r,open,moves),d=childAmount(s,r,nextDebit,nextCredit),c=childAmount(s,r,nextCredit,close-1),z=childAmount(s,r,close,s.range.e.c+1);
    return {kind:'balance',header:Math.max(r+1,o.header,d.header,c.header,z.header),cols,open:o.col,openDir:open-1,close:z.col,closeDir:close-1,
     debit:d.col,credit:c.col,annual:/累计/u.test(str(s,r,moves))};
   }
   if(open>=0&&close>=0&&debit>=0&&credit>=0){
    return {kind:'balance',header:r,cols,open,close,openDir:index(s,r,'期初方向','期初余额方向'),closeDir:index(s,r,'期末方向','期末余额方向'),
     debit,credit,annual:/累计/u.test(str(s,r,debit))};
   }
  }
  return null;
 }
 const missingFormula=c=>Boolean(c?.f&&(c.v===''||c.v==null)||c?.t==='e');
 const numeric=(s,r,c)=>missingFormula(cell(s,r,c))?null:amount(raw(s,r,c));
 function signed(s,r,col,dir,pair){
  if(pair){
   const d=numeric(s,r,pair[0]),c=numeric(s,r,pair[1]);
   return d===null||c===null||d<0n||c<0n||d!==0n&&c!==0n?null:d-c;
  }
  const n=numeric(s,r,col),d=label(raw(s,r,dir)).replace(/方$/u,'');
  if(n===null)return null;
  if(dir<0)return n;
  if(d==='贷'&&n>=0n)return -n;
  if(d==='借'&&n>=0n||d==='平'&&n===0n)return n;
  return null;
 }
 const dir=n=>n===null?'':n<0n?'贷':n>0n?'借':'平';
 const absolute=n=>n===null?null:n<0n?-n:n;
 const reference=(model,r,cols=[])=>model.source.name+' / '+model.sheet.name+'!'+(cols.length?cols.map(c=>address(r,c)).filter(Boolean).join('、'):String(r+1));
 function readBalance(m,issues){
  const {sheet:s,meta,rule:q}=m;
  if(q.annual&&meta.end)meta.start=meta.end.slice(0,4)+'-01';
  const rows=[],seen=new Set(),stack=[];
  for(let r=q.header+1;r<=s.range.e.r;r++){
   const code=identifier(s,r,q.cols[9]),name=String(raw(s,r,q.cols[10]));
   if(!code||subtotal.test(label(code))||subtotal.test(label(name)))continue;
   const opening=signed(s,r,q.open,q.openDir,q.openPair),closing=signed(s,r,q.close,q.closeDir,q.closePair);
   const debit=numeric(s,r,q.debit),credit=numeric(s,r,q.credit),marker=reference(m,r,[q.cols[9],q.debit,q.credit]);
   const indentation=/^[ \u3000\t]*/u.exec(name)[0].length;
   while(stack.length&&(stack.at(-1).indentation>=indentation||!code.startsWith(stack.at(-1).code)))stack.pop();
   const parent=indentation>0?stack.at(-1):undefined;
   const level=parent?parent.level+1:0;
   const path=/[-／/]/u.test(name.trim())||!parent?name.trim():parent.name+'／'+name.trim();
   const row={r,code,name:path,level,indentation,opening,closing,debit,credit,marker,parent:parent?.code||'',leaf:true,
    openingDirection:q.openDir>=0?str(s,r,q.openDir):dir(opening),closingDirection:q.closeDir>=0?str(s,r,q.closeDir):dir(closing),
    openingRaw:q.open>=0?str(s,r,q.open):'',closingRaw:q.close>=0?str(s,r,q.close):''};
   if(parent)parent.leaf=false;
   if(seen.has(code)){
    m.ambiguous=true;
    issues.push(issue('待核',meta,code,'余额表科目重复','同一余额表出现相同科目编码，核对前请确认余额表范围。','','','','',marker));
   }
   seen.add(code);rows.push(row);stack.push(row);
   if([opening,closing,debit,credit].includes(null))
    issues.push(issue('待核',meta,code,'余额表金额','金额、方向或公式缓存缺失，保留源值及空白。','','','','',marker));
   else if(opening+debit-credit!==closing)
    issues.push(issue('差异',meta,code,'余额表期末滚动','期初净额＋借方发生额－贷方发生额与期末净额的差。',money(opening+debit-credit),money(closing),money(opening+debit-credit-closing),'',marker));
  }
  const codes=[...seen].sort();
  if(rows.every(row=>!row.parent)&&codes.some((code,i)=>i>0&&code.startsWith(codes[i-1]))){
   m.ambiguous=true;issues.push(issue('待核',meta,'','余额表科目层级','编码存在父子前缀，源表未提供可确认的缩进或层级；未合计多级科目。','','','','',m.source.name));
  }
  return rows;
 }
 function readJournal(m,issues){
  const {sheet:s,meta,rule:q}=m,rows=[];
  const notes={oneSide:0};
  let carried=null;
  for(let r=q.header+1;r<=s.range.e.r;r++){
   const summary=String(raw(s,r,q.cols[8])),voucher=identifier(s,r,q.cols[6]),dateFields=q.dateColumns.map(c=>str(s,r,c));
   const rawDate=raw(s,r,q.cols[4]),when=date(rawDate)||date(cell(s,r,q.cols[4])?.w)||date(dateFields.join('-'));
   if(!voucher&&(carry.test(label(summary))||subtotal.test(label(summary)))){
    if(carry.test(label(summary))&&q.running>=0&&!carried){
     const period=month(dateFields.slice(0,2).join('-'))||meta.start;
     const value=signed(s,r,q.running,q.direction);
     if(period)carried={period,value,ref:reference(m,r,[q.direction,q.running])};
    }
    continue;
   }
   if(!voucher&&rawDate===''&&!dateFields[2])continue;
   const code=identifier(s,r,q.cols[9])||meta.account,company=identifier(s,r,q.codeCol);
   const entity=str(s,r,q.cols[0])||meta.entity;
   const period=month(raw(s,r,q.cols[3]))||when.slice(0,7);
   const book=str(s,r,q.cols[1])||meta.book;
   const debit=numeric(s,r,q.cols[20]),credit=numeric(s,r,q.cols[21]);
   const unavailable=[q.cols[20],q.cols[21]].some(c=>missingFormula(cell(s,r,c)));
   const tracked=identifier(s,r,q.cols[7]);
   const d=debit??(!unavailable&&raw(s,r,q.cols[20])===''&&credit!==null&&credit!==0n?0n:null);
   const c=credit??(!unavailable&&raw(s,r,q.cols[21])===''&&debit!==null&&debit!==0n?0n:null);
   if((debit===null&&d===0n)||(credit===null&&c===0n))notes.oneSide++;
   const marker=reference(m,r,[q.cols[6],q.cols[8],q.cols[20],q.cols[21]]);
   const values=q.cols.map((col,j)=>j>=18&&j<=21?money(numeric(s,r,col)):j===6||j===7||j===9?identifier(s,r,col):raw(s,r,col));
   values[0]=entity;values[1]=book;values[2]=identifier(s,r,q.cols[2])||when.slice(0,4);
   values[3]=period;values[4]=when||String(rawDate??'');values[6]=voucher;values[7]=tracked;
   values[9]=code;values[10]=str(s,r,q.cols[10])||meta.name;values[16]=str(s,r,q.cols[16])||meta.currency;
   const scope={...meta,entity,book,companyCode:company||meta.companyCode};
   const valid=!!(voucher&&code&&period&&when&&entity&&period===when.slice(0,7)&&d!==null&&c!==null&&!unavailable);
   if(!valid)issues.push(issue('待核',scope,code,'流水行','缺少主体、日期、凭证、科目、本位币金额或公式缓存；本行金额不用于判定一致。','','','',marker));
   else if(d!==0n&&c!==0n)issues.push(issue('待核',scope,code,'分录借贷方向','同一分录行借贷同时非零，请检查原导出口径。',money(d),money(c),'',marker));
   const summaryKey=summary.normalize('NFKC').replace(/[\p{White_Space}\p{Punctuation}]/gu,'');
   const risk=!summary.trim()?(missingFormula(cell(s,r,q.cols[8]))?'摘要公式缓存缺失':'摘要空白'):
    ['往来款','转账','调整'].includes(summaryKey)?'摘要过于笼统':'';
   rows.push({r,code,entity,book,period,when,voucher,tracked,debit:d,credit:c,marker,values,scope,valid,risk,source:m,
    running:q.running<0?null:signed(s,r,q.running,q.direction),balanceRef:reference(m,r,[q.direction,q.running]),
    signature:JSON.stringify(values)});
  }
  if(carried)m.carried=carried;
  if(notes.oneSide)issues.push(issue('口径说明',meta,meta.account,'单边借贷空栏',notes.oneSide+' 行有一边明确非零且另一边真空。汇总按未发生的一侧计算，流水导出保留原空栏。','','','',m.source.name));
  return rows;
 }
 const unique=items=>[...new Set(items.filter(Boolean))];
 const sameScope=(a,b)=>!!a.entity&&!!b.entity&&equals(a.entity,b.entity)&&
  (!a.companyCode||!b.companyCode||equals(a.companyCode,b.companyCode))&&(!a.book||!b.book||equals(a.book,b.book));
 const currency=value=>/^(?:人民币|RMB|CNY)$/iu.test(norm(value))?'CNY':norm(value);
 function reconcile(rows,balances,issues,blocked){
  const accounts=[];
  const rowGroups=new Map();
  for(const line of rows){
   const key=norm(line.entity)+'\u0000'+line.code;
   if(!rowGroups.has(key))rowGroups.set(key,[]);
   rowGroups.get(key).push(line);
  }
  const matched=new Set(),scopesWithBalance=new Set();
  const compare=(m,r,name,a,b,markers,qualified)=>{
   const stat=a===null||b===null||!qualified?'待核':a===b?'一致':'差异';
   accounts.push(issue(stat,m.meta,r.code,name,stat==='待核'?'范围、数据完整性或金额口径须核对。':'差额＝账页汇总减余额表。',money(a),money(b),
     a===null||b===null?'':money(a-b),markers,r.marker));
  };
  for(const m of balances){
   const {meta}=m;
   if(!meta.entity||!meta.start||!meta.end||meta.start.slice(0,4)!==meta.end.slice(0,4)||meta.start>meta.end){
    issues.push(issue('待核',meta,'','余额表期间或主体','未识别同一年度内的明确主体及起止月，未跨主体或跨期比较。','','','','',m.source.name));continue;
   }
   const overlaps=balances.filter(other=>other!==m&&sameScope(meta,other.meta)&&meta.start===other.meta.start&&meta.end===other.meta.end);
   if(overlaps.length){issues.push(issue('待核',meta,'','余额表版本','多份不同余额表覆盖同主体及期间，请确认版本后单独校验。','','','','',m.source.name));continue;}
   scopesWithBalance.add(norm(meta.entity));
   let n=0,totalDebit=0n,totalCredit=0n,totalBookDebit=0n,totalBookCredit=0n,complete=true;
   const eligible=m.rows.filter(row=>row.leaf);
   for(const r of eligible){
    const lines=(rowGroups.get(norm(meta.entity)+'\u0000'+r.code)||[]).filter(line=>sameScope(line.scope,meta));
    const expectedLines=lines.filter(line=>line.period>=meta.start&&line.period<=meta.end);
    const validLines=expectedLines.filter(line=>line.valid);
    expectedLines.forEach(line=>matched.add(line));
    const books=unique(expectedLines.map(line=>line.book)),units=unique(expectedLines.map(line=>line.scope.unit)),currencies=unique(expectedLines.filter(line=>line.scope.currency).map(line=>currency(line.scope.currency)));
    const separateBooks=!meta.book&&books.length>1;
    const unitMismatch=meta.unit&&units.some(unit=>!equals(unit,meta.unit))||units.length>1;
    const currencyMismatch=meta.currency&&currencies.some(v=>v!==currency(meta.currency))||currencies.length>1;
    const noValues=!expectedLines.length||validLines.length!==expectedLines.length||lines.some(line=>!line.period)||unitMismatch||currencyMismatch||separateBooks;
    const absentZero=r.debit===0n&&r.credit===0n&&!expectedLines.length;
    const dup=expectedLines.some(line=>line.overlap);
    const qualified=!m.ambiguous&&!blocked&&!noValues&&!dup;
    const amounts=noValues?[null,null]:[validLines.reduce((sum,line)=>sum+line.debit,0n),validLines.reduce((sum,line)=>sum+line.credit,0n)];
    const markers=unique(expectedLines.map(line=>line.marker)).slice(0,12).join('；');
    compare(m,r,'借方发生额',amounts[0],r.debit,markers,qualified);
    compare(m,r,'贷方发生额',amounts[1],r.credit,markers,qualified);
    const detailModels=unique(expectedLines.filter(line=>line.source.rule.kind==='account').map(line=>line.source));
    const openingCandidates=detailModels.map(item=>item.carried).filter(x=>x?.period===meta.start);
    if(openingCandidates.length===1){
     const opening=openingCandidates[0];compare(m,r,'期初净余额',opening.value,r.opening,opening.ref,qualified);
     if(qualified&&opening.value!==null&&amounts[0]!==null&&amounts[1]!==null)
      compare(m,r,'按三栏账复算期末净余额',opening.value+amounts[0]-amounts[1],r.closing,opening.ref+'；'+markers,true);
    }else if(detailModels.length)issues.push(issue('待核',meta,r.code,'三栏账期初范围','未找到与余额表起月相符的唯一结转行。','','','',markers,r.marker));
    if(detailModels.length===1&&meta.end===expectedLines.at(-1)?.period){
     const last=expectedLines.filter(line=>line.source===detailModels[0]).reduce((a,b)=>a.r>b.r?a:b);
     compare(m,r,'三栏账期末净余额',last.running,r.closing,last.balanceRef,qualified);
    }
    if(!expectedLines.length&&!absentZero)
     issues.push(issue('待核',meta,r.code,'未见匹配账页','该科目在余额表有发生额或金额未确认，未推定流水为零。','','','','',r.marker));
    if(!qualified&&!absentZero||r.debit===null||r.credit===null)complete=false;
    if(qualified){n++;totalDebit+=amounts[0];totalCredit+=amounts[1];totalBookDebit+=r.debit??0n;totalBookCredit+=r.credit??0n;}
   }
   if(n||eligible.length)for(const [name,a,b]of [['末级合计借方',totalDebit,totalBookDebit],['末级合计贷方',totalCredit,totalBookCredit]]){
    const status=complete&&n?(a===b?'一致':'差异'):'待核';
    accounts.push(issue(status,meta,'',name,(complete&&n?'已覆盖可核对的末级发生额。':'仅汇总 '+n+' 个已核对末级科目，其余见科目明细。'),
      n?money(a):'',n?money(b):'',n?money(a-b):'','',m.source.name));
   }
   if(!m.ambiguous&&eligible.length){
    const total=(key)=>eligible.some(row=>row[key]===null)?null:eligible.reduce((sum,row)=>sum+row[key],0n);
    const expected={code:'',marker:m.source.name+' / '+m.sheet.name};
    compare(m,expected,'余额表期初借贷平衡',total('opening'),0n,'',true);
    compare(m,expected,'余额表期末借贷平衡',total('closing'),0n,'',true);
    compare(m,expected,'余额表发生额借贷平衡',total('debit'),total('credit'),'',true);
   }
   if(!meta.unit||!meta.currency||!rows.some(row=>sameScope(row.scope,meta)&&row.scope.unit&&row.scope.currency))
    issues.push(issue('口径说明',meta,'','币种／金额单位','一方或双方未声明币种或金额单位；结果系原值算术对比，未换算。','','','','',m.source.name));
  }
  const unmatched=new Map();
  for(const row of rows)if(!matched.has(row)){
   const k=[row.entity,row.book,row.period,row.code].join('|');
   if(!unmatched.has(k))unmatched.set(k,row);
  }
  for(const row of unmatched.values())issues.push(issue('待核',{...row.scope,start:row.period,end:row.period},row.code,
   scopesWithBalance.has(norm(row.entity))?'未匹配余额表科目或期间':'未匹配余额表主体','未计入不同主体、账套、期间或余额表缺少该末级科目的对账。','','','',row.marker));
  return accounts;
 }
 function build(sources,{entity='',blocked=false}={}){
  const issues=[],excluded=[],rows=[],balances=[],distinct=new Set(),scoped=[];
  for(const source of sources)for(const sheet of source.model.sheets){
   if(sheet.visibility||source.role==='statements')continue;
   const rule=detect(sheet);if(!rule){
    if(/三栏|明细账|联查账页|凭证流水|科目(?:明细)?余额表/u.test(source.name+' '+sheet.name)){
     blocked=true;issues.push(issue('待核',{},'','未识别账表列','本页没有识别出所需账表字段，请核对表头。','','','',source.name+' / '+sheet.name));
    }
    continue;
   }
   const meta=metadata(sheet),m={source,sheet,rule,meta};
   if(source.role&&source.role!==(rule.kind==='balance'?'trial':'ledger')){
    issues.push(issue('待核',meta,meta.account,'账表上传分类不符','请将该工作表放入正确的三栏账或科目余额表上传框。','','','',source.name+' / '+sheet.name));
    continue;
   }
   if(entity&&meta.entity&&!equals(meta.entity,entity)){
    issues.push(issue('待核',meta,meta.account,'与所选被审计单位不符','该工作表未纳入本项目标准表。','','','',source.name+' / '+sheet.name));
    continue;
   }
   scoped.push(m);
  }
  for(const m of scoped.filter(item=>item.rule.kind==='balance')){
   m.rows=readBalance(m,issues);
   const stamp=JSON.stringify([m.meta,m.rows.map(row=>[row.code,row.name,money(row.opening),money(row.debit),money(row.credit),money(row.closing)])]);
   if(distinct.has(stamp)){issues.push(issue('排除',m.meta,'','余额表重复件','同主体同期间且科目余额内容一致，仅保留一份。','','','','',m.source.name));continue;}
   distinct.add(stamp);if(m.rows.length)balances.push(m);
  }
  const bookAndAccount=new Map(),explicitLines=new Map();
  for(const m of scoped.filter(item=>item.rule.kind!=='balance')){
   const found=readJournal(m,issues).filter(row=>{
    if(!entity||!row.entity||equals(row.entity,entity))return true;
    issues.push(issue('待核',row.scope,row.code,'流水行主体与项目不符','该行未纳入导出及对账。','','','',row.marker));return false;
   });
   const signature=JSON.stringify([m.meta,found.map(row=>row.signature)]);
   if(distinct.has(signature)){
    for(const row of found)excluded.push([...row.values,'明细内容重复',row.source.source.name,row.source.sheet.name,row.r+1]);
    continue;
   }
   distinct.add(signature);
   const parentCodes=new Set(balances.filter(b=>sameScope(b.meta,m.meta)).flatMap(b=>b.rows.filter(row=>!row.leaf).map(row=>row.code)));
   for(const row of found){
    if(parentCodes.has(row.code)){
     excluded.push([...row.values,'余额表已确认的上级科目展示',row.source.source.name,row.source.sheet.name,row.r+1]);continue;
    }
    const base=[norm(row.entity),norm(row.book),row.period,row.code].join('|');
    const id=base+'|'+row.when+'|'+row.values[5]+'|'+row.voucher+'|'+row.tracked;
    if(row.tracked&&row.voucher&&row.code&&row.when&&explicitLines.has(id)){
     const other=explicitLines.get(id);
     if(other.signature===row.signature){excluded.push([...row.values,'相同凭证分录号及内容',row.source.source.name,row.source.sheet.name,row.r+1]);continue;}
     row.overlap=other.overlap=true;
    }else if(row.tracked&&row.voucher&&row.code&&row.when)explicitLines.set(id,row);
    if(!bookAndAccount.has(base))bookAndAccount.set(base,new Map());
    const sheets=bookAndAccount.get(base);
    if(!sheets.has(m))sheets.set(m,[]);
    sheets.get(m).push(row);rows.push(row);
   }
  }
  for(const sheets of bookAndAccount.values())if(sheets.size>1){
   const byDate=new Map();
   for(const lines of sheets.values())for(const row of lines){
    const key=row.when+'|'+row.values[5]+'|'+row.voucher;
    if(!byDate.has(key))byDate.set(key,new Set());byDate.get(key).add(row.source);
   }
   const conflicting=[...sheets.values()].flat().filter(row=>row.overlap||!row.tracked&&byDate.get(row.when+'|'+row.values[5]+'|'+row.voucher)?.size>1);
   for(const row of conflicting)row.overlap=true;
   if(conflicting.length)issues.push(issue('待核',{...conflicting[0].scope,start:conflicting[0].period,end:conflicting[0].period},conflicting[0].code,
    '同科目有重叠凭证','跨来源同日同凭证出现无唯一行号或冲突；记录保留待核，未自动判为重复。','','','',conflicting[0].marker));
  }
  if(excluded.length)issues.push(issue('排除',{},'','重复或上级展示',excluded.length+' 行单列于「排除及重复」工作表，未重复计入流水。'));
  if(blocked)issues.push(issue('待核',{},'','读取不完整','存在未读取来源，差额供排查；未把本轮结果记为一致。'));
  if(!balances.length)issues.push(issue('待核',{},'','缺少可识别余额表','可导出已识别的凭证流水；余额对照待补。'));
  if(!rows.length)issues.push(issue('待核',{},'','缺少可识别凭证流水或三栏账','已识别的余额表仍可导出，发生额按源表保留。'));
  for(const row of rows)if(!row.values[10]||row.values[10]===row.scope.name){
   const matches=unique(balances.filter(b=>sameScope(b.meta,row.scope)&&(!row.period||!b.meta.start||row.period>=b.meta.start&&row.period<=b.meta.end))
     .flatMap(b=>b.rows.filter(r=>r.code===row.code).map(r=>r.name)));
   if(matches.length===1)row.values[10]=matches[0];
  }
  rows.sort((a,b)=>a.entity.localeCompare(b.entity,'zh-CN')||a.book.localeCompare(b.book,'zh-CN')||a.when.localeCompare(b.when)||
   String(a.values[5]).localeCompare(String(b.values[5]),'zh-CN')||a.voucher.localeCompare(b.voucher,'zh-CN',{numeric:true})||
   a.tracked.localeCompare(b.tracked,'zh-CN',{numeric:true})||a.code.localeCompare(b.code,'zh-CN'));
  const riskRows=rows.filter(row=>row.risk);
  const riskVouchers=new Set(riskRows.filter(row=>row.voucher).map(row=>JSON.stringify([row.entity,row.book,row.period,row.values[5],row.voucher])));
  if(riskRows.length)issues.push(issue('摘要待核',{},'','摘要筛查汇总',riskRows.length+' 条流水、'+riskVouchers.size+' 个按主体／账套／期间／凭证字／凭证号去重的可识别凭证；见「摘要筛查」。'));
  const accountChecks=reconcile(rows,balances,issues,blocked);
  const balanceRows=balances.flatMap(({meta,rows,source,sheet})=>rows.map(r=>[
   meta.entity,meta.book,meta.end.slice(0,4),meta.start,meta.end,meta.currency,meta.unit,r.code,r.name,r.level,r.openingDirection,r.opening===null?r.openingRaw:money(absolute(r.opening)),
   money(r.debit),money(r.credit),r.closingDirection,r.closing===null?r.closingRaw:money(absolute(r.closing)),source.name,sheet.name,r.r+1
  ]));
  return {journal:rows.map(row=>row.values),balance:balanceRows,
   risks:riskRows.map(row=>[...row.values,row.risk,row.source.source.name,row.source.sheet.name,row.r+1,row.marker]),
   excluded,accountChecks,issues:[...accountChecks.filter(row=>row[0]!=='一致'),...issues],
   origins:rows.map((row,index)=>[index+2,row.entity,row.book,row.period,row.voucher,row.tracked,row.code,row.source.source.name,
    row.source.sheet.name,row.r+1,row.marker,row.risk])};
 }

 const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
 const HEAD='<?xml version="1.0" encoding="UTF-8"?>';
 const escape=value=>clean(value).replace(/[&<>"']/gu,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
 function workbook(sheets){
  const sheetsXml=[],sheetRels=[],types=[],parts={};
  for(const [i,{name,columns:head,rows,footer,widths={},decimalColumns=[]}] of sheets.entries()){
   const no=i+1,last=address(rows.length,head.length-1),lastCell=footer?address(rows.length+1,head.length-1):last;
   sheetsXml.push('<sheet name="'+escape(name)+'" sheetId="'+no+'" r:id="rId'+no+'"/>');
   sheetRels.push('<Relationship Id="rId'+no+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+no+'.xml"/>');
   types.push('<Override PartName="/xl/worksheets/sheet'+no+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
   const content=[HEAD,'<worksheet xmlns="'+NS+'"><dimension ref="A1:'+lastCell+'"/>',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'];
   head.forEach((title,c)=>content.push('<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+(widths[c]??(/来源|科目名称|说明|摘要/u.test(title)?33:Math.max(13,title.length*2+3)))+'" customWidth="1"/>'));
   content.push('</cols><sheetData>');
   function addRow(values,r){
    let text='<row r="'+(r+1)+'">';
    for(const [c,v]of values.entries()){
     if(v==null||v==='')continue;
     const a=address(r,c);
     if(typeof v==='number'&&Number.isFinite(v))text+='<c r="'+a+'"'+(decimalColumns.includes(c)?' s="2"':'')+'><v>'+v+'</v></c>';
     else text+='<c r="'+a+'" t="inlineStr"'+(r===0?' s="1"':'')+'><is><t xml:space="preserve">'+escape(String(v).slice(0,32767))+'</t></is></c>';
    }
    content.push(text+'</row>');
   }
   addRow(head,0);rows.forEach((row,r)=>addRow(row,r+1));
   if(footer)addRow(footer,rows.length+1);
   content.push('</sheetData><autoFilter ref="A1:'+last+'"/></worksheet>');
   parts['xl/worksheets/sheet'+no+'.xml']=content.join('');
  }
  parts['_rels/.rels']=HEAD+'<Relationships xmlns="'+PKG+'"><Relationship Id="rId1" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  parts['xl/workbook.xml']=HEAD+'<workbook xmlns="'+NS+'" xmlns:r="'+REL+'"><bookViews><workbookView/></bookViews><sheets>'+sheetsXml.join('')+'</sheets></workbook>';
  parts['xl/_rels/workbook.xml.rels']=HEAD+'<Relationships xmlns="'+PKG+'">'+sheetRels.join('')+'<Relationship Id="styles" Type="'+REL+'/styles" Target="styles.xml"/></Relationships>';
  parts['xl/styles.xml']=HEAD+'<styleSheet xmlns="'+NS+'"><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF246656"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf xfId="0" numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>';
  parts['[Content_Types].xml']=HEAD+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+types.join('')+'</Types>';
  return root.QuoteLayouts.packCompressedOfficeParts(parts);
 }
 async function exportFile(result,kind){
  const differences={name:'差异及待核',columns:ISSUE,rows:result.issues};
  if(kind==='journal'){
   const columns=JOURNAL.map(column=>column[0]);
   return {name:'标准版凭证流水查询.xlsx',bytes:await workbook([
    {name:'凭证流水查询',columns,rows:result.journal},
    {name:'行来源',columns:['流水表行号','核算单位','账套名称','会计期间','凭证号','分录行号','科目编码','源文件','工作表','原始行号','单元格','摘要提示'],rows:result.origins},
    {name:'排除及重复',columns:[...columns,'排除原因','源文件','工作表','原始行号'],rows:result.excluded},
    {name:'摘要筛查',columns:[...columns,'摘要提示','源文件','工作表','原始行号','单元格'],rows:result.risks},differences
   ])};
  }
  if(kind!=='balance')throw Error('请选择标准凭证流水或科目余额表。');
  return {name:'标准版科目余额表.xlsx',bytes:await workbook([
   {name:'科目余额表',columns:BALANCE,rows:result.balance},
   {name:'发生额勾稽',columns:ISSUE,rows:result.accountChecks},differences
  ])};
 }
 async function nextJournalFilename(prefix){
  const db=await new Promise((resolve,reject)=>{
   const request=root.indexedDB.open('shenyi.journal-export-sequences.v1',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('sequences');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(Error('无法读取本机序时账下载序号，请重试。'));
  });
  try{
   const sequence=await new Promise((resolve,reject)=>{
    const tx=db.transaction('sequences','readwrite'),store=tx.objectStore('sequences');
    const request=store.get(prefix);
    let next;
    request.onsuccess=()=>{
     next=(request.result??0)+1;
     if(!Number.isSafeInteger(next)||next<1){tx.abort();return;}
     store.put(next,prefix);
    };
    tx.oncomplete=()=>resolve(next);
    tx.onabort=()=>reject(Error('无法保存本机序时账下载序号，请重试。'));
   });
   return '序时账-已删除摘要列-'+prefix+'-'+String(sequence).padStart(4,'0')+'.xlsx';
  }finally{db.close();}
 }
 async function exportPrivacyCopy(result,mode,company=''){
  const columns=JOURNAL.map(column=>column[0]);
  if(mode==='without-summary'){
   if(!result.journal.length)throw Error('本轮未识别到凭证流水或三栏账，无法删除摘要列。');
   const prefix=Array.from(company.trim()).slice(0,2).join('').replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_');
   if(!prefix)throw Error('请先选择被审计单位，再下载删除摘要列的序时账。');
   const excluded=new Set(['核算单位','账套名称','摘要']);
   const kept=columns.flatMap((name,index)=>excluded.has(name)?[]:[index]);
   const projectRow=row=>kept.map(index=>row[index]);
   const bytes=await workbook([{name:'凭证流水查询',columns:projectRow(columns),rows:result.journal.map(projectRow)}]);
   return {name:await nextJournalFilename(prefix),bytes};
  }
  if(mode!=='masked')throw Error('请选择账表脱敏方式。');
  const aliases=new Map();
  function alias(group,value){
   const id=norm(value);
   if(!id)return '';
   if(!aliases.has(group))aliases.set(group,new Map());
   const names=aliases.get(group);
   if(!names.has(id))names.set(id,group+'-'+String(names.size+1).padStart(3,'0'));
   return names.get(id);
  }
  const numeric=value=>amount(value)===null?'':value;
  const accountCode=value=>/^\d+(?:[./_-]\d+)*$/u.test(value)?value:alias('科目编码',value);
  const currency=value=>/^(?:[A-Z]{3}|人民币|美元|欧元|港元|港币|日元|英镑)$/u.test(value)?value:'';
  const direction=value=>['借','贷','平'].includes(value)?value:'';
  function journalRow(row){
   const [entity,book,year,period,when,type,no,line,summary,code,account,customer,supplier,department,
    project,person,denomination,rate,originalDebit,originalCredit,debit,credit,attachments,maker,reviewer,poster,status]=row;
   return [alias('单位',entity),alias('账套',book),/^20\d{2}$/u.test(year)?year:'',month(period),date(when),
    alias('凭证字',type),alias('凭证号',no),/^\d+$/u.test(line)?line:alias('分录行',line),norm(summary)?'已脱敏':'',
    accountCode(code),alias('科目',account),alias('客户',customer),alias('供应商',supplier),alias('部门',department),
    alias('项目',project),alias('人员',person),currency(denomination),numeric(rate),numeric(originalDebit),
    numeric(originalCredit),numeric(debit),numeric(credit),numeric(attachments),alias('人员',maker),
    alias('人员',reviewer),alias('人员',poster),alias('状态',status)];
  }
  function balanceRow(row){
   const [entity,book,year,from,to,denomination,unit,code,account,level,openingDirection,opening,debit,credit,closingDirection,closing]=row;
   return [alias('单位',entity),alias('账套',book),/^20\d{2}$/u.test(year)?year:'',month(from),month(to),currency(denomination),
    ['元','千元','万元'].includes(unit)?unit:'',accountCode(code),alias('科目',account),numeric(level),
    direction(openingDirection),numeric(opening),numeric(debit),numeric(credit),direction(closingDirection),numeric(closing)];
  }
  const sheets=[];
  if(result.journal.length){
   sheets.push({name:'凭证流水查询',columns,rows:result.journal.map(journalRow)});
  }
  if(result.balance.length){
   sheets.push({name:'科目余额表',columns:BALANCE.slice(0,16),rows:result.balance.map(balanceRow)});
  }
  if(!sheets.length)throw Error('本轮未识别到可脱敏的凭证流水或科目余额表。');
  return {name:'账表-脱敏副本.xlsx',bytes:await workbook(sheets)};
 }
 root.LedgerStandard=Object.freeze({build,workbook,exportFile,exportPrivacyCopy,metadata,date,journalColumns:Object.freeze(JOURNAL.map(column=>column[0]))});
 if(typeof module==='object'&&module.exports)module.exports=root.LedgerStandard;
})(globalThis);
