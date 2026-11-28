/* Project-local correspondence prepared from the control list and dated ledger balances. */
(function(root){
  'use strict';
  const aliases={
    party:['被询证单位','被询证单位名称','被询证者','被询证者名称','发函对象','收函单位','询证单位','往来单位','往来单位名称','对方单位','客商名称','客户名称','供应商名称','客户','供应商','银行名称','开户银行'],
    cutoff:['函证基准日','询证基准日','询证函基准日','基准日','截止日期','截至日期','函证截止日','函证截止日期','截止日','截至日','余额日期'],
    date:['凭证日期','记账日期','业务日期','日期'],year:['年','年度','会计年度'],month:['月','月份'],day:['日'],
    account:['函证项目','科目名称','会计科目','科目名称（全路径）','科目'],code:['科目编码','科目代码','科目编号'],
    id:['函证编号','询证函编号','发函编号'],entity:['被审计单位','核算单位','公司名称','编制单位'],book:['账套名称','账套'],
    currency:['币种','币别','货币'],unit:['金额单位'],direction:['余额方向','借贷方向','方向'],
    amount:['函证金额','询证金额','发函金额','账面余额','期末余额','余额','金额'],
    balance:['往来单位余额','客商余额','客户余额','供应商余额','余额','期末余额','账面余额'],
    debitBalance:['期末借方余额','借方余额','贵单位欠我方'],creditBalance:['期末贷方余额','贷方余额','我方欠贵单位'],
    debit:['借方','借方发生额','借方金额','本位币借方金额'],credit:['贷方','贷方发生额','贷方金额','本位币贷方金额'],
    memo:['摘要','凭证摘要'],number:['凭证号','凭证编号'],firm:['事务所','会计师事务所','回函接收方','承接事务所']
  };
  const norm=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/gu,'');
  const key=value=>norm(value).replace(/[:：]$/u,'');
  function rowsOf(sheet){
    const rows=new Map();
    for(const [address,cell] of Object.entries(sheet.cells)){
      const [,letters,number]=/^([A-Z]+)(\d+)$/u.exec(address),r=Number(number);
      let c=0;for(const ch of letters)c=c*26+ch.charCodeAt(0)-64;
      if(!rows.has(r))rows.set(r,[]);
      rows.get(r)[c-1]=cell;
    }
    return [...rows].sort((a,b)=>a[0]-b[0]);
  }
  const value=cell=>cell?.t==='e'?'':cell?.v??'';
  const display=cell=>String(typeof value(cell)==='number'&&/^0\d+$/u.test(cell.w)?cell.w:value(cell)).trim();
  function headers(row){
    const names=row.map(cell=>key(display(cell)));
    return Object.fromEntries(Object.entries(aliases).map(([role,labels])=>[role,labels.flatMap(s=>{
      const i=names.indexOf(key(s));return i<0?[]:[i];
    })]));
  }
  const read=(row,h,role)=>h[role].map(c=>display(row[c])).find(Boolean)||'';
  const date=(row,h,role)=>h[role].map(c=>root.LedgerStandard.date(value(row[c]))||root.LedgerStandard.date(row[c]?.w)).find(Boolean)||'';
  function cents(v,unit=''){
    if(v==='')return null;
    const s=String(v).normalize('NFKC').replace(/^[¥￥]\s*/u,'').trim();
    if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/u.test(s))throw Error('无法读取金额「'+v+'」。');
    const unitScale={'':2,'元':2,'人民币元':2,'千元':5,'万元':6}[unit];
    if(unitScale===undefined)throw Error('无法识别金额单位「'+unit+'」。');
    const [whole,frac='']=s.replace(/[-,]/gu,'').split('.');
    if(/[1-9]/u.test(frac.slice(unitScale)))throw Error('金额精度小于分，请核对「'+v+'」。');
    return (s.startsWith('-')?-1n:1n)*BigInt(whole+frac.slice(0,unitScale).padEnd(unitScale,'0'));
  }
  const absolute=n=>n<0n?-n:n;
  const money=n=>(n<0n?'-':'')+(absolute(n)/100n).toLocaleString('en-US')+'.'+String(absolute(n)%100n).padStart(2,'0');
  const direction=x=>({'借':'借','借方':'借','贷':'贷','贷方':'贷','平':'平'})[norm(x)];
  const denomination=x=>/^(人民币|人民币元|RMB|CNY)$/iu.test(x)?'CNY':norm(x).toUpperCase();
  function signed(row,h,role,unit,required){
    const debit=read(row,h,'debitBalance'),credit=read(row,h,'creditBalance');
    if([...h.debitBalance,...h.creditBalance].some(i=>row[i]?.t==='e'||row[i]?.f&&value(row[i])===''))
      throw Error('借贷余额缺少有效公式结果。');
    if(debit||credit)return (cents(debit,unit)??0n)-(cents(credit,unit)??0n);
    const n=cents(read(row,h,role),unit);
    if(n===null)return null;
    const dir=direction(read(row,h,'direction'));
    if(dir==='借')return n;
    if(dir==='贷')return -n;
    if(read(row,h,'direction')&&dir!=='平'||dir==='平'&&n!==0n)throw Error('余额方向与金额不明确。');
    if(n===0n)return 0n;
    if(required)throw Error('余额缺少明确的借贷方向。');
    return n;
  }
  function controlRows(model,company){
    const list=[];
    for(const sheet of model.sheets.filter(s=>!s.visibility)){
      const rows=rowsOf(sheet),meta=root.LedgerStandard.metadata(sheet);
      let h,names;
      for(const [r,row] of rows){
        if(!h){const candidate=headers(row);if(candidate.party.length&&candidate.cutoff.length){h=candidate;names=row.map(display);}continue;}
        const where=sheet.name+' 第 '+r+' 行',party=read(row,h,'party');
        if(!row.some(cell=>display(cell))||/^(?:合计|小计|总计)/u.test(party||display(row.find(cell=>display(cell)))))continue;
        if(!party)throw Error(where+' 缺少被询证单位。');
        const cutoff=date(row,h,'cutoff'),entity=read(row,h,'entity')||meta.entity;
        if(!cutoff)throw Error(where+' 缺少有效的函证基准日。');
        if(entity&&norm(entity)!==norm(company))throw Error(where+' 的被审计单位与所选项目不同。');
        const unit=read(row,h,'unit')||meta.unit,dir=read(row,h,'direction');
        const expected=signed(row,h,'amount',unit,false);
        if((h.amount.length||h.debitBalance.length||h.creditBalance.length)&&
            [...h.amount,...h.debitBalance,...h.creditBalance].some(i=>row[i]?.t==='e'||row[i]?.f&&value(row[i])===''))throw Error(where+' 的函证金额缺少有效公式结果。');
        const fields=Object.fromEntries(names.flatMap((name,c)=>name?[[key(name),display(row[c])]]:[]));
        list.push({party,cutoff,id:read(row,h,'id'),account:read(row,h,'account'),code:read(row,h,'code'),
          book:read(row,h,'book')||meta.book,currency:read(row,h,'currency')||meta.currency,expected,
          unsigned:!dir&&!read(row,h,'debitBalance')&&!read(row,h,'creditBalance')&&expected!==null&&expected>=0n,fields,where});
      }
    }
    if(!list.length)throw Error('控制信息表未找到询证对象。请核对「被询证单位」和「函证基准日」两列表头。');
    return list;
  }
  function ledgerBalances(sources,controls,company){
    const records=[],parties=new Set(controls.map(c=>norm(c.party)));
    for(const {name,model} of sources)for(const sheet of model.sheets.filter(s=>!s.visibility)){
      const rows=rowsOf(sheet),meta=root.LedgerStandard.metadata(sheet);
      let h,sheetParty='';const seenParties=new Set(),batch=[];
      for(const [r,row] of rows){
        if(!h){
          const candidate=headers(row);
          if((candidate.date.length||candidate.cutoff.length||candidate.year.length&&candidate.month.length&&candidate.day.length)&&
            (candidate.balance.length||candidate.debitBalance.length||candidate.creditBalance.length)){
            h=candidate;h.partyBalances=h.balance.filter(i=>/^(往来单位|客商|客户|供应商)余额$/u.test(display(row[i])));
          }else for(const cell of row){
            const m=/^(?:往来单位|客户名称|供应商名称|客商名称)\s*[:：]\s*(.+)$/u.exec(display(cell));if(m)sheetParty=m[1].trim();
          }
          continue;
        }
        const summary=read(row,h,'memo');
        if(/^(?:本月合计|本期合计|本年累计|累计|合计|小计|期初余额|上期结转|上年结转)$/u.test(norm(summary)))continue;
        const names=[...new Set(h.party.map(i=>display(row[i])).filter(Boolean))];
        const rawParty=names.length?names:sheetParty?[sheetParty]:[...new Set([sheet.name,meta.name].filter(s=>parties.has(norm(s))))];
        const party=rawParty.length===1?rawParty[0]:'';
        const when=date(row,h,'date')||date(row,h,'cutoff')||root.LedgerStandard.date(['year','month','day'].map(k=>read(row,h,k)).join('-'));
        if(!when)continue;
        seenParties.add(norm(party));
        if(!parties.has(norm(party)))continue;
        const entity=read(row,h,'entity')||meta.entity;
        if(entity&&norm(entity)!==norm(company))continue;
        const ref=name+' / '+sheet.name+' 第 '+r+' 行';
        let balance=null,problem='';
        try{balance=signed(row,h,'balance',read(row,h,'unit')||meta.unit,true);}catch(e){problem=e.message;}
        batch.push({party,when,balance,problem,account:read(row,h,'account')||meta.name,code:read(row,h,'code')||meta.account,
          book:read(row,h,'book')||meta.book,currency:read(row,h,'currency')||meta.currency,ref,source:name+' / '+sheet.name,
          partyBalance:h.partyBalances.some(i=>display(row[i])!=='')&&!read(row,h,'debitBalance')&&!read(row,h,'creditBalance'),end:meta.end});
      }
      for(const rec of batch){if(seenParties.size>1&&!rec.partyBalance)rec.problem='同一账页含多个往来单位，请提供分户三栏账或明确的往来单位余额列。';records.push(rec);}
    }
    return records;
  }
  function reconcile(control,records){
    const fail=msg=>{throw Error(control.where+'（'+control.party+'）：'+msg);};
    const matches=records.filter(r=>norm(r.party)===norm(control.party)&&
      (!control.code||norm(r.code)===norm(control.code))&&(!control.account||norm(r.account)===norm(control.account))&&
      (!control.book||!r.book||norm(r.book)===norm(control.book))&&
      (!control.currency||!r.currency||denomination(r.currency)===denomination(control.currency)));
    const before=matches.filter(r=>r.when<=control.cutoff);
    if(!before.length)fail('三栏账没有匹配单位、科目及截止日期的余额。');
    if(new Set(before.map(r=>JSON.stringify([r.book,r.code,r.account,denomination(r.currency)]))).size>1)fail('匹配到多个账套、科目或币种，请在控制表中分别指定。');
    const lastDate=before.reduce((v,r)=>v>r.when?v:r.when,''),latest=before.filter(r=>r.when===lastDate);
    if(new Set(latest.map(r=>r.source)).size>1)fail('存在多个同日余额来源，请核对三栏账版本。');
    const last=latest.at(-1);
    if(last.problem||last.balance===null)fail(last.ref+' '+(last.problem||'缺少可读取的余额。'));
    if(lastDate<control.cutoff&&(!last.end||last.end<control.cutoff.slice(0,7))&&
        !matches.some(r=>r.source===last.source&&r.when>=control.cutoff))fail('账页只读到 '+lastDate+'，请补充覆盖 '+control.cutoff+' 的账页。');
    const balance=last.balance;
    if(control.expected!==null&&control.expected!==(control.unsigned?absolute(balance):balance))
      fail('控制表金额 '+money(control.expected)+' 与三栏账余额 '+money(balance)+' 存在差异，差额 '+money(control.expected-(control.unsigned?absolute(balance):balance))+'。');
    return {...control,account:control.account||last.account,code:control.code||last.code,book:control.book||last.book,currency:control.currency||last.currency,balance};
  }
  function fieldMap(item,company,firm){
    const fields=new Map(Object.entries(item.fields));
    function add(names,v){for(const name of names)fields.set(key(name),String(v??''));}
    add(aliases.party,item.party);add(aliases.cutoff,item.cutoff);add(aliases.id,item.id);add(aliases.entity,company);
    add(aliases.firm,firm);add(aliases.account,item.account);add(aliases.code,item.code);add(aliases.currency,item.currency);
    add(aliases.amount,money(absolute(item.balance)));add(aliases.direction,item.balance<0n?'贷':item.balance>0n?'借':'平');
    add(aliases.debitBalance,item.balance>=0n?money(item.balance):'');add(aliases.creditBalance,item.balance<0n?money(-item.balance):'');
    fields.set('致被询证单位',item.party);return fields;
  }
  async function verifiedFile(item){
    if(await root.ProjectWorkspaceStore.hash(item.blob)!==item.sha256)throw Error(item.name+' 原件校验失败，请重新上传。');
    return new File([item.blob],item.name,{type:item.type});
  }
  async function compile({company,firm,control,ledgers,template}){
    const controlFile=await verifiedFile(control),list=controlRows(await root.WorkpaperSheets.read(controlFile,{audit:true}),company);
    const files=[];for(const f of ledgers)files.push(await verifiedFile(f));
    const sources=await root.AuditAutoCheck.collect('',{files,workbooksOnly:true});
    const records=ledgerBalances(sources,list,company),letters=new Map();
    for(const c of list){
      const item=reconcile(c,records),group=JSON.stringify(c.id?['id',c.id]:[c.party,c.cutoff]);
      if(!letters.has(group))letters.set(group,[]);
      const rows=letters.get(group);
      if(rows.some(r=>norm(r.party)!==norm(c.party)||r.cutoff!==c.cutoff))throw Error('函证编号 '+c.id+' 对应多个单位或日期，请核对控制信息表。');
      if(rows.some(r=>r.account===item.account&&r.code===item.code&&r.book===item.book&&r.currency===item.currency))
        throw Error(c.where+' 与同函另一行的科目、账套及币种重复，请核对。');
      rows.push(item);
    }
    const groups=[...letters.values()].map(rows=>rows.map(item=>fieldMap(item,company,firm)));
    const bytes=await root.ConfirmationPdf.build(template,groups);
    return {blob:new Blob([bytes],{type:'application/pdf'}),count:groups.length};
  }
  root.ConfirmationLetters=Object.freeze({compile});
})(globalThis);
