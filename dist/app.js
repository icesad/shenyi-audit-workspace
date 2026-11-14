/* Original implementation. No external network requests or third-party scripts. */
(function () {
  'use strict';
  const C = globalThis.QuoteCalc;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : '#'; } catch { return '#'; } };
  const fmt = cents => '¥ ' + C.formatMoney(cents);
  const REGION_NAMES = {gx:'广西',hb:'河北',sh:'上海'};
  const slotNames=['第一地 · 默认客户所在地','第二地 · 默认执行团队所在地','第三地 · 自选地区'];
  const EN = {gx:'GUANGXI',hb:'HEBEI',sh:'SHANGHAI'};
  const provinces=globalThis.RuleCatalog.PROVINCES;
  const idFor=p=>({'450000':'gx','130000':'hb','310000':'sh'}[p.code]||p.code);
  const byId=id=>provinces.find(p=>idFor(p)===id);
  function blankRule(p){return {id:idFor(p),name:p.name,document:'未配置',status:'missing',sourceUrl:'',version:'未配置',basis:'assets',mode:'fixed',minimumYuan:0,fixedYuan:null,tiers:[],notes:'该地区尚未配置规则；自定义规则仅为本所草稿，未核定。'};}
  const provinceOptions=()=>provinces.map(p=>'<option value="'+esc(idFor(p))+'">'+esc(p.name)+'</option>').join('');
  const ruleDefault=p=>globalThis.RuleCatalog.defaultRule(idFor(p),initialRules)||blankRule(p);
  const fallbackRule=r=>r.status==='fallback_historical'||r.status==='scope_reference';
  function ensureRule(id,adopt=false){
    const p=byId(id);if(!p)return;
    const i=state.rules.findIndex(r=>r.id===id),current=state.rules[i];
    if(i<0)state.rules.push(state.regionalDefaults||adopt?ruleDefault(p):blankRule(p));
    else if(current.status==='missing'&&(state.regionalDefaults||adopt))state.rules[i]=ruleDefault(p);
  }
  function selectOptions(){
    const legacy={gx:'广西',hb:'河北',sh:'上海'};
    for(const name of ['location','team']) {const select=$('#client-form').elements.namedItem(name);select.innerHTML='<option value="">请选择省级地区</option>'+provinces.map(p=>`<option value="${esc(legacy[idFor(p)]||p.name)}">${esc(p.name)}${p.scopePending?'（适用范围待确认）':''}</option>`).join('')+`<option value="其他地区" ${name==='team'?'disabled':''}>其他地区（旧记录）</option>`;}

  }
  function selectedId(){return byId(state.selectedProvince)?state.selectedProvince:'';}
  function provinceForLocation(location){const legacy={广西:'gx',河北:'hb',上海:'sh'},p=provinces.find(x=>x.name===location);return legacy[location]||(p&&idFor(p))||'';}
  function validComparisonSelection(s){if(!Object.hasOwn(s,'comparisonProvinceIds'))return true;const ids=s.comparisonProvinceIds;return Array.isArray(ids)&&ids.length===3&&ids.every((id,i)=>typeof id==='string'&&(!!byId(id)||(id===''&&(i===0||(i===1&&s.client?.team==='')))))&&(s.selectedProvince===undefined||s.selectedProvince===ids[0]);}
  function comparisonIds(){return Object.hasOwn(state,'comparisonProvinceIds')?state.comparisonProvinceIds.slice():[selectedId(),'hb','sh'];}
  function ensureSelected(){const ids=comparisonIds();state.selectedProvince=ids[0];for(const id of new Set(ids))ensureRule(id);}
  function comparisonRules(){return comparisonIds().map(id=>state.rules.find(r=>r.id===id)||{id:'',name:'待选择地区',document:'未配置',version:'未配置',status:'missing',notes:'请在此栏选择省级地区。'});}
  function uniqueComparisonRules(){return comparisonRules().filter((r,i,all)=>r.id&&all.findIndex(x=>x.id===r.id)===i);}
  function syncProvince(){ensureSelected();const rules=uniqueComparisonRules(),basis=$('#quote-form').elements.namedItem('basis'),known=['budget','manual',...rules.map(r=>r.id)];basis.innerHTML=(state.quote.basis==='budget'?'<option value="budget" disabled>原草稿工时预算（只读）</option>':'')+rules.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}${fallbackRule(r)?' · 借用河北':''}参考（待核定）</option>`).join('')+'<option value="manual">手工输入报价</option>'+(!known.includes(state.quote.basis)?`<option value="${esc(state.quote.basis)}" disabled>原报价地区已移出参考栏，请重新选择</option>`:'');basis.value=state.quote.basis;}

  const STORE = 'hengdu.audit.quote.records.v2';
  const LEGACY_STORE = 'hengdu.audit.quote.records.v1';
  const initialRules = clone(globalThis.REGION_REFERENCE || []);
  const defaultBudget = [{role:'项目负责人',hours:'24',rateYuan:'600'},{role:'审计助理',hours:'48',rateYuan:'300'},{role:'质量复核',hours:'4',rateYuan:'1200'}];
  // New drafts save all slots. The array-less fallback above is only for historical snapshots.
  const defaults = () => {const client={clientName:'示例科技有限公司（演示）',location:'广西',team:'河北',year:'2025',service:'年度财务报表审计',assets:'3000',revenue:'2000',profit:'100'};return {schema:1,regionalDefaults:true,client,comparisonProvinceIds:[provinceForLocation(client.location),provinceForLocation(client.team),'110000'],quote:{basis:'manual',manual:'33600',discount:'0',pricePercent:'100',extra:'0',tax:'0',reason:'仅供初步沟通；税费、差旅范围及交付时间待双方确认。'},budget:clone(defaultBudget),rules:clone(initialRules)};};
  let state = defaults(), ruleDraft = null, activeRule = 'gx', view = 'home', outputs = {}, budgetResult = null, finalResult = null, records = [], readError = false;
  // Never discard unknown records: an older app must not overwrite data it cannot understand.
  let storedRaw = null, storageReadable = true, activeRecordId = null, restoredNeedsReview = false;
  let deliveryStore=null,projectInitiation=null,auditProgram=null,selectedBidder=null,proposalBusy=false,proposalKey=null,proposalEpoch=0,ledgerRows=[],previewPacket=null,cleanAnnex=null,completePdfBusy=false,sealSource=null,signedReview=null,cleanSigned=null;
  let subjectList=null,batchQuote=null,bidderPicker=null,tenderTicket=0,tenderPending=false,intakeChanged=false,hasTender=false,activeTenderSource=null,quoteSigning=null;
  const signingLabels=Object.freeze({company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字'});
  const signingInputs=()=>$$('[data-quote-page-sign-kind]');
  const chosenSignKinds=()=>signingInputs().filter(el=>el.checked).map(el=>el.dataset.quotePageSignKind);
  const signingKey=kinds=>kinds.join('|');
  const signingHashes=assets=>JSON.stringify(assets.map(a=>[a.kind,a.sha256]));
  const outcomeNames={pending:'待反馈',won:'中标',lost:'未中标',cancelled:'已取消'};
  // Compare by JSON value, independent of object-key order. Failure is treated as unverified.
  function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
  function historyMatches(record){try{return !!finalResult && canonical(record.calculation)===canonical({regions:outputs,budget:budgetResult,quote:finalResult}) && record.totalCents===finalResult.totalCents;}catch{return false;}}
  function showRestoreReview(){ $('#restore-recalc-warning').hidden=!restoredNeedsReview; }
  const customerKey = r => JSON.stringify([r.snapshot.client.clientName,r.snapshot.client.year,r.snapshot.client.service]);
  function validateChains(list) {
    const byId=new Map(list.map(r=>[r.id,r]));const chains=new Map();
    for(const r of list){const tagged=Object.hasOwn(r,'revisionRoot')||Object.hasOwn(r,'revisionNo');if(!tagged)continue;
      if(typeof r.revisionRoot!=='string'||!r.revisionRoot||!Number.isSafeInteger(r.revisionNo)||r.revisionNo<2||r.revisionNo>5000||r.revisionRoot===r.id) return false;
      const root=byId.get(r.revisionRoot);if(!root||Object.hasOwn(root,'revisionRoot')||Object.hasOwn(root,'revisionNo')||customerKey(root)!==customerKey(r))return false;
      if(!chains.has(r.revisionRoot))chains.set(r.revisionRoot,new Set());const seen=chains.get(r.revisionRoot);if(seen.has(r.revisionNo))return false;seen.add(r.revisionNo);
    }
    for(const seen of chains.values())for(let n=2;n<=seen.size+1;n++)if(!seen.has(n))return false;return true;
  }
  function rootId(r){return r.revisionRoot||r.id;}
  function chainVersion(r){return r.revisionNo||1;}
  function isLinked(r){return !!r.revisionRoot || records.some(x=>x.revisionRoot===r.id);}
  function chainHead(root){return records.filter(r=>rootId(r)===root).reduce((a,b)=>!a||chainVersion(b)>chainVersion(a)?b:a,null);}
  function ruleNameMatches(rule) { const p=byId(rule.id); if(!p || typeof rule.name!=='string')return false; const shortName=p.name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/, ''); return rule.name===p.name || rule.name===shortName; }
  function validStoredRecord(r) {
    return !!r && typeof r === 'object' && typeof r.id === 'string' && !!r.id &&
      typeof r.savedAt === 'string' && Number.isFinite(Date.parse(r.savedAt)) &&
      Number.isSafeInteger(r.totalCents) && r.totalCents >= 0 &&
      r.appVersion === '0.1' && r.snapshot && r.snapshot.schema === 1 && (r.snapshot.regionalDefaults===undefined||r.snapshot.regionalDefaults===true) && (!Object.hasOwn(r.snapshot,'auditeeRegister')||globalThis.AuditeeRows?.valid(r.snapshot.auditeeRegister)) && validComparisonSelection(r.snapshot) && r.snapshot.client && typeof r.snapshot.client === 'object' &&
      ['clientName','location','team','year','service','assets','revenue','profit'].every(k => typeof r.snapshot.client[k] === 'string') &&
      r.snapshot.quote && typeof r.snapshot.quote === 'object' && ['basis','manual','discount','extra','tax','reason'].every(k => typeof r.snapshot.quote[k] === 'string') && (r.snapshot.quote.pricePercent===undefined||validPricePercent(r.snapshot.quote.pricePercent)) && (r.snapshot.quote.rounding===undefined||['none','hundred','thousand'].includes(r.snapshot.quote.rounding)) &&
      Array.isArray(r.snapshot.budget) && r.snapshot.budget.every(x => x && typeof x === 'object' && ['role','hours','rateYuan'].every(k=>typeof x[k]==='string')) &&
      Array.isArray(r.snapshot.rules) && ['gx','hb','sh'].every(id=>r.snapshot.rules.some(x=>x?.id===id)) &&
      new Set(r.snapshot.rules.map(x=>x?.id)).size===r.snapshot.rules.length && r.snapshot.rules.every(x => x && typeof x==='object' && ruleNameMatches(x) && ['fixed','flat','progressive','budget'].includes(x.mode) && ['assets','revenue','max','average'].includes(x.basis) && Array.isArray(x.tiers) && x.tiers.every(t=>t && typeof t==='object' && !Array.isArray(t))) && r.calculation && typeof r.calculation === 'object' && r.calculation.quote && typeof r.calculation.quote === 'object' && Number.isSafeInteger(r.calculation.quote.totalCents) && r.calculation.quote.totalCents === r.totalCents;
  }
  try {
    storedRaw = localStorage.getItem(STORE);
    const saved = JSON.parse(storedRaw === null ? '[]' : storedRaw);
    if (!Array.isArray(saved) || !saved.every(validStoredRecord) || new Set(saved.map(r => r.id)).size !== saved.length || !validateChains(saved)) throw Error();
    records = saved;
  } catch { readError = true; try { storedRaw = localStorage.getItem(STORE); } catch { storageReadable = false; } }

  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>$('#toast').classList.remove('show'),3500); }
  function formFill(form, values) { for(const [key,value] of Object.entries(values)) { const e = form.elements.namedItem(key); if(e) e.value = value; } }
  function formRead(form) { return Object.fromEntries(new FormData(form)); }
  function positiveNumber(value, label, max=1e12) { if(String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>max) throw Error(label+'必须是有效的非负数'); return Number(value); }
  // Financial inputs are in 万元. Convert up to 6 decimals to integer cents exactly.
  function wanToYuan(value, signed=false) { let v = String(value).trim(); if(!new RegExp(signed ? '^-?\\d+(?:\\.\\d{1,6})?$' : '^\\d+(?:\\.\\d{1,6})?$').test(v)) throw Error('财务规模须为有效金额，万元最多保留 6 位小数'); const negative=v.startsWith('-'); if(negative)v=v.slice(1); const [a,b='']=v.split('.'); let cents=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')); if(cents>900000000000000n) throw Error('输入金额超出原型支持范围'); if(negative)cents=-cents; const abs=cents<0n?-cents:cents; return (cents<0n?'-':'')+(abs/100n).toString()+'.'+(abs%100n).toString().padStart(2,'0'); }
  function validateClient() { const c=state.client; if(!provinceForLocation(c.location))throw Error('客户所在地待确认，请选择具体省级地区'); if(provinces.some(p=>p.scopePending&&p.name===c.location))throw Error('该地区业务适用范围与币种待确认，暂不生成报价'); if(!c.clientName.trim()) throw Error('请填写客户名称'); if(!/^\d{4}$/.test(c.year)||+c.year<2000||+c.year>2100) throw Error('审计年度需为 2000—2100 年'); const assets=wanToYuan(c.assets),revenue=wanToYuan(c.revenue); if(c.profit!=='')wanToYuan(c.profit,true); return {assets,revenue}; }
  // Keep exact legacy calculations for existing drafts and the Shanghai reference.
  function recalcBudget() { try { budgetResult=C.calculateHours(state.budget); } catch { budgetResult=null; } }
  function regionResult(rule, input) {
    if(byId(rule.id)?.scopePending) return {error:'业务适用范围及币种待确认，暂不计算',missing:true};
    if(!input) return {error:'请先完善客户输入'};
    if(rule.id==='sh' && rule.mode==='budget') { if(!budgetResult) return {error:'请先完善工时预算'}; return {...budgetResult,baseLabel:'本所人员工时预算',custom:true}; }
    if((rule.mode==='fixed' && (rule.fixedYuan===null||rule.fixedYuan==='')) || (rule.mode!=='fixed' && !rule.tiers?.length)) return {error:'待配置规则',missing:true};
    try {let baseYuan = rule.basis==='revenue'?input.revenue:input.assets;
      if(rule.basis==='max') baseYuan=C.money(input.assets)>=C.money(input.revenue)?input.assets:input.revenue;
      if(rule.basis==='average')baseYuan=decimalCents(Number((BigInt(C.money(input.assets))+BigInt(C.money(input.revenue))+1n)/2n));
      return {...C.calculateScale({...rule,baseYuan}),baseLabel:rule.mode==='fixed'?'自定义固定金额':({max:'资产 / 收入孰高',average:'未审资产 / 收入平均',assets:'资产总额',revenue:'营业收入'}[rule.basis]||'资产总额')};
    } catch(e) {return {error:rule.overRangeConsult&&e.message==='超出已录入规则范围，请人工报价'?'超出当地参考档位，按原文件须双方协商':e.message};}
  }
  function detailLines(lines) { return lines.map(line=>`<div class="detail-line"><span>${esc(line.label)}</span><b>${esc(fmt(line.amountCents))}</b></div>`).join(''); }
  function renderComparison() {
    $('#comparison').innerHTML=comparisonRules().map((rule,slot)=>{const r=outputs[rule.id]||{error:'请先选择省级地区'};const isSh=rule.id==='sh',duplicate=!!rule.id&&comparisonIds().filter(id=>id===rule.id).length>1;const selected=state.quote.basis===rule.id;
      return `<article class="region-card ${selected?'selected':''}"><div class="card-top"><div class="region-heading"><label for="comparison-region-${slot}">${slotNames[slot]}</label><select class="region-province" id="comparison-region-${slot}" data-comparison-slot="${slot}" aria-label="${slotNames[slot]}"><option value="" ${rule.id?'':'selected'} ${slot===0||slot===1&&state.client.team===''?'':'disabled'}>请选择省级地区</option>${provinces.map(p=>`<option value="${esc(idFor(p))}" ${idFor(p)===rule.id?'selected':''}>${esc(p.name)}${p.scopePending?'（适用范围待确认）':''}</option>`).join('')}</select><div class="region-en">${esc(EN[rule.id]||rule.id||'PENDING')}</div></div></div><span class="badge ${isSh?'neutral':'amber'}">${rule.status==='missing'?(rule.id?'旧快照未配置':'待选择'):fallbackRule(rule)?(rule.status==='scope_reference'?'模板 · 不计价':'借用河北 · 待复核'):isSh||rule.status==='custom_unverified'?'本所自定义 · 待核':'历史参考 · 待复核'}</span><div class="region-price">${r.error?'—':`<small>¥</small>${esc(C.formatMoney(r.totalCents))}`}</div><p class="card-label">${duplicate?'与其他参考栏重复 · ':''}${r.error?esc(r.error==='请先完善工时预算'?'原有预算数据无效，请核对规则或选择其他报价基础':r.error):fallbackRule(rule)?'借用河北历史口径 · 非当地标准':isSh?'本所自定义 · 非上海统一标准':rule.status==='custom_unverified'?'本机自定义规则 · 待核定':'按历史口径测算 · 非现行统一价'}</p><details><summary>参考依据与计算明细</summary><div class="card-facts"><div class="fact"><span>计算口径</span><span>${esc(r.baseLabel||'待配置')}</span></div><div class="fact"><span>规则版本</span><span>${esc(rule.version||'本所 v0.1')}</span></div><div class="fact"><span>参考文件</span><span>${esc(rule.document||'本所内部预算')}</span></div></div><div class="detail-lines">${r.lines?detailLines(r.lines):'<p>没有足够依据，不返回 0 元报价。</p>'}<p>${esc(rule.notes||'请先人工确认适用范围。')}</p><p>精确到分；每项舍入规则需与本所制度核对。</p></div></details><button class="btn choose ${selected?'primary':''}" data-choose="${esc(rule.id)}" ${r.error?'disabled':''}>${selected?'✓ 已作为报价基础':'用于议价测算'}</button></article>`;
    }).join('');
  }
  function validPricePercent(v){return typeof v==='string'&&/^\d{1,5}(?:\.\d{1,2})?$/.test(v)&&Number(v)<=10000;}
  function displayedFactor(q){return q.pricePercent??String(Math.round((100-Number(q.discount))*100)/100);}
  function fillQuoteForm(){formFill($('#quote-form'),{...state.quote,pricePercent:displayedFactor(state.quote)});}
  function adjustedQuote(base,q,extra=q.extra){
    return C.applyAdjustment({baseCents:base,discountPercent:q.discount,pricePercent:q.pricePercent,extraYuan:extra,taxPercent:q.tax,roundingUnit:q.rounding||'none'});
  }
  function batchEstimateKey(){
    const q=state.quote;
    return canonical([state.client.service,q.pricePercent??null,q.pricePercent===undefined?q.discount:null,q.tax,q.rounding||'none',state.rules.filter(r=>r.status!=='missing')]);
  }
  function estimateBatchRow(row){
    if(!row.clientName.trim())return {error:'单位名称待补'};
    const id=provinceForLocation(row.location),place=byId(id);
    if(!place)return {error:'客户所在地待确认'};
    if(place.scopePending)return {error:'业务适用范围及币种待确认，暂不计算'};
    if(state.client.service!=='年度财务报表审计')return {error:'当前业务无自动参考口径，请核对并手填'};
    try{
      const assets=row.assets.trim()?wanToYuan(row.assets):null,revenue=row.revenue.trim()?wanToYuan(row.revenue):null;
      if(row.profit.trim())wanToYuan(row.profit,true);
      const saved=state.rules.find(r=>r.id===id),rule=(!saved||saved.status==='missing')&&state.regionalDefaults?ruleDefault(place):saved;
      function estimate(r){
        if(!r||r.status==='missing'||r.mode==='budget')return {error:'未配置逐家测算规则',missing:true};
        if(r.mode!=='fixed'&&((r.basis!=='revenue'&&assets===null)||(r.basis!=='assets'&&revenue===null)))return {error:'缺少该规则所需财务数据'};
        return regionResult(r,{assets:assets??'0',revenue:revenue??'0'});
      }
      let result=estimate(rule),source=rule?.status==='fallback_historical'?'本地无可用规则 · 暂用河北历史参考（非当地标准，待复核）':place.name+' · '+(rule?.version||'')+' · 待复核';
      if(id!=='hb'&&(result.missing||result.error==='超出已录入规则范围，请人工报价')){
        const why=result.missing?'本地规则未配置':'本地规则超出已录入范围';
        result=estimate(initialRules.find(r=>r.id==='hb'));
        source=why+' · 暂用河北历史参考（非当地标准，待复核）';
      }
      if(result.error)return {error:result.error};
      return {...adjustedQuote(result.totalCents,state.quote,'0'),source};
    }catch(e){return {error:e.message};}
  }
  function calculateQuote() {
    finalResult=null; const q=state.quote; let base=null,label='';
    try {validateClient(); if(q.basis==='budget'){if(!budgetResult)throw Error('原草稿工时数据无效，请另选报价基础');base=budgetResult.totalCents;label='本所工时预算';}
      else if(q.basis==='manual'){base=C.money(q.manual);label='手工输入报价';}
      else{if(!comparisonIds().includes(q.basis))throw Error('原报价地区已移出参考栏，请重新选择报价基础');const r=outputs[q.basis];if(!r||r.error)throw Error('所选地区规则不可计算，请先配置');base=r.totalCents;const rule=state.rules.find(x=>x.id===q.basis);label=(rule?.name||REGION_NAMES[q.basis]||'地区')+(rule&&fallbackRule(rule)?' · 借用河北历史参考（待核定）':'参考（待核定）');}
      finalResult={...adjustedQuote(base,q),baseCents:base,label};
      $('#quote-error').textContent=''; $('#final-price').textContent=fmt(finalResult.totalCents); $('#basis-description').textContent='报价基础：'+(q.basis==='budget'?'原草稿工时预算（只读）':label);
      $('#summary-lines').innerHTML=[['基准金额',fmt(base)],[finalResult.discountCents<0?'加价金额':'优惠金额',(finalResult.discountCents<0?'+ ':finalResult.discountCents>0?'− ':'')+fmt(Math.abs(finalResult.discountCents))],['附加费用',fmt(C.money(q.extra))],['另计税额',fmt(finalResult.taxCents)],...(finalResult.roundingUnit?[['取整前合计',fmt(finalResult.unroundedTotalCents)],['取整方式',finalResult.roundingUnit==='hundred'?'四舍五入至整百元':'四舍五入至整千元']]:[])].map(([a,b])=>`<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('');
      $('#summary-note').textContent=(q.basis==='budget'?'沿用保存时的工时资料；可改用手工输入或地区参考。':'报价仍需确认服务范围与税费口径。')+(q.basis==='gx'||q.basis==='hb'?' 所选历史规则未经核定。':'');
    }catch(e){$('#quote-error').textContent=e.message;$('#final-price').textContent='—';$('#basis-description').textContent='输入有效数据后计算';$('#summary-lines').innerHTML='';$('#summary-note').textContent='不完整或无效输入不会生成报价。';}
    $('#preview').disabled=!finalResult||restoredNeedsReview;$('#save').disabled=!finalResult||restoredNeedsReview;$('#save-revision').disabled=!finalResult||!activeRecordId||restoredNeedsReview;$('#csv').disabled=!finalResult||restoredNeedsReview;showRestoreReview();
    const manual=$('#quote-form').elements.namedItem('manual');manual.disabled=q.basis!=='manual';
    proposalEpoch++;refreshProposalControls();
  }
  function update() { let input=null; try{input=validateClient();$('#client-error').textContent='';}catch(e){$('#client-error').textContent=e.message;} recalcBudget();syncProvince();outputs={};for(const rule of state.rules) outputs[rule.id]=regionResult(rule,input);renderComparison();calculateQuote(); }
  function renderRules(preserveDraft=false) {
    const quick=uniqueComparisonRules();
    if(!byId(activeRule)){activeRule=quick[0]?.id||'gx';ruleDraft=null;}
    const selector=$('#rules-region-select');
    if(!selector.options.length)selector.innerHTML=provinceOptions();
    selector.value=activeRule;
    const selected=state.rules.find(r=>r.id===activeRule);
    const tabs=selected&&!quick.some(r=>r.id===activeRule)?[...quick,selected]:quick;
    $('#rule-tabs').innerHTML=tabs.map(r=>`<button class="${r.id===activeRule?'active':''}" data-rule="${r.id}">${esc(r.name)}</button>`).join('');
    if(!preserveDraft || !ruleDraft || ruleDraft.id!==activeRule) ruleDraft=clone(state.rules.find(r=>r.id===activeRule)||null); const r=ruleDraft;if(!r){$('#rule-editor').textContent='规则数据不可用';return;}
    const readOnly=byId(r.id)?.scopePending===true,flat=r.mode==='flat';
    $('#rule-editor').innerHTML=`<div class="rule-meta"><p><strong>${esc(r.name)} · ${esc(r.document||'未配置')}</strong> <span class="badge amber">${readOnly?'内地模板 · 不计价':fallbackRule(r)?'非当地收费标准':r.id==='sh'?'自定义，不是官方价':'待复核，不用于正式承诺'}</span></p><p>${esc(r.notes||'')}</p><p>规则版本：${esc(r.version||'未配置')}${r.mode==='budget'&&budgetResult?' · 示例预算：'+esc(fmt(budgetResult.totalCents)):''}</p>${r.sourceUrl?`<a href="${esc(safeUrl(r.sourceUrl))}" target="_blank" rel="noopener noreferrer">查看测算来源 ↗</a>`:''}${r.localPolicyUrl?`<p>${esc(r.localPolicyNote||'')} <a href="${esc(safeUrl(r.localPolicyUrl))}" target="_blank" rel="noopener noreferrer">查看当地政策 ↗</a></p>`:''}</div><form id="rules-form" novalidate><fieldset id="rule-editor-parameters" ${readOnly?'disabled':''}><div class="fields two"><label>计费基数<select name="basis"><option value="max">资产总额与营业收入孰高</option><option value="average">未审资产总额与未审收入平均</option><option value="assets">资产总额</option><option value="revenue">营业收入</option></select></label><label>计算方法<select name="mode"><option value="flat">按档固定收费</option><option value="progressive">差额累进收费</option><option value="fixed">自定义固定金额</option>${r.id==='sh'&&r.mode==='budget'?'<option value="budget">原有本所预算口径（兼容）</option>':''}</select></label><label>最低收费（元）<input name="minimumYuan" type="number" min="0" step="0.01" value="${esc(r.minimumYuan??0)}"></label><label>固定金额（元，仅固定模式）<input name="fixedYuan" type="number" min="0" step="0.01" placeholder="${r.mode==='fixed'?'填写固定金额':'当前模式不适用'}" value="${esc(r.fixedYuan??'')}"></label></div><div class="table-scroll" style="margin-top:20px"><table><thead><tr><th>区间上限（万元，末档可留空）</th><th>${flat?'该档收费（元）':'费率（‰）或固定段费用（元）'}</th><th></th></tr></thead><tbody>${(r.tiers||[]).map((t,i)=>`<tr><td><input class="rule-input" aria-label="第 ${i+1} 档上限" data-tier="${i}" data-field="upToYuan" type="number" min="0" step="0.000001" placeholder="不限" value="${t.upToYuan===null?'':esc(Number(t.upToYuan)/10000)}"></td><td><small>${flat||t.feeYuan!=null?'固定费用（元）':'千分费率（‰）'}</small><input class="rule-input" aria-label="第 ${i+1} 档${flat||t.feeYuan!=null?'收费':'费率'}" data-tier="${i}" data-field="${flat||t.feeYuan!=null?'feeYuan':'ratePerMille'}" type="number" min="0" step="${flat||t.feeYuan!=null?'0.01':'0.0001'}" value="${esc(flat||t.feeYuan!=null?t.feeYuan??'':t.ratePerMille??'')}"></td><td><button class="text-button" type="button" data-remove-tier="${i}">移除</button></td></tr>`).join('')}</tbody></table></div><div class="rule-actions"><button type="button" class="btn" id="add-tier">＋ 添加档位</button><button type="submit" class="btn primary">应用到当前草稿</button><button type="button" class="text-button" id="restore-rule">恢复参考版本</button></div></fieldset><p class="error" id="rule-error" role="alert"></p><p class="tiny">费率单位为千分率（‰），不是百分比。修改后仍标记待复核。若变更计算方法，请重新核对所有档位。</p></form>`;
    formFill($('#rules-form'),r);$('#rules-form').elements.namedItem('fixedYuan').value=r.fixedYuan??'';
  }
  function sourceList(){const items=[['价格市场化','国家发改委 · 发改价格〔2014〕2755号','要求放开会计师事务所审计服务价格。','https://www.ndrc.gov.cn/xxgk/zcfb/tz/201501/t20150104_963719.html'],['工时预算依据','财政部 · 会计师事务所一体化管理办法','第八条：业务收费以项目工时预算和人员级差费率为基础。第十五条涉及境内服务器与数据存储要求。','https://www.mof.gov.cn/jrttts/202205/P020220531557195020769.pdf'],['上海收费口径','沪发改价费〔2011〕001号','实行市场调节价，由事务所综合成本、难易、风险等制定标准。','https://czj.sh.gov.cn/zys_8908/zcfg_8983/zcfb_8985/hj_9035/hjssws_9041/20110201/0017-157508.html'],['广西参考实例','桂林理工大学 · 2026年协审服务采购','该采购参考2012年标准并采用下浮率，不代表全省统一现行报价。','https://shenji.glut.edu.cn/info/1007/1787.htm'],['河北参考实例','河北省体育局 · 2022年中标公示','该采购使用2012年历史标准的折扣价，不代表全省平均成交价。','https://sport.hebei.gov.cn/tongzhigonggao/2022/0119/17582.html']];$('#source-list').innerHTML=items.map(([tag,title,note,url])=>`<div class="source-item"><span class="badge neutral">${esc(tag)}</span> <a href="${url}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a><p>${esc(note)}</p></div>`).join('');}
  let settingsPanel=null,workspaceNavigation=null,workpaperWorkspace=null,reportWorkspace=null,archiveWorkspace=null,templateWorkspace=null;
  let projectActivity=null,travelExpenses=null,projectCosts=null,pageDrafts=null;const draftRestored=new Set();let projectPageReady=null,auditPageReady=null;const draftQuoteEpoch={value:null};
  function showSettings(){
    const host=$('#app-settings');if(!host)return;
    if(settingsPanel)return;
    if(!globalThis.AppSettings){host.textContent='设置组件未载入，请刷新后重试；原业务资料未改变。';return;}
    const callbacks={onOpenBackup:()=>$('#export-backup').click(),onHelp:()=>{const help=host.querySelector('.as-help');if(help){help.open=true;help.scrollIntoView?.({block:'center'});}}};
    const adapter=globalThis.AccountClient?.adapter?globalThis.AccountClient.adapter(callbacks):callbacks;
    settingsPanel=globalThis.AppSettings.mount(host,adapter);
  }
  function showTravel(){
    const host=$('#travel-expenses-host');if(!host)return;if(!travelExpenses&&globalThis.TravelExpenses)travelExpenses=globalThis.TravelExpenses.mount(host,{listProjects:()=>globalThis.ProjectInitiation.listSaved(),readAccountState:()=>globalThis.AccountClient.readAccountState(),onSettings:()=>setView('settings')});
  }
  function showCosts(){
    const host=$('#project-costs');if(!host)return;if(!projectCosts&&globalThis.ProjectCosts)projectCosts=globalThis.ProjectCosts.mount(host,{listProjects:()=>globalThis.ProjectInitiation.listSaved(),incomeBasis:'gross',returnBasis:'cost'});
  }
  function showReport(){
    const host=$('#report-workspace');if(!host)return;
    if(!reportWorkspace&&globalThis.ReportWorkspace?.mount){
      reportWorkspace=globalThis.ReportWorkspace.mount(host,{openTrialBalance:async({projectId,index})=>{
        if(!workpaperWorkspace?.openDirectoryIndex)throw Error('底稿目录组件尚未就绪，未打开其他项目或替代底稿。');
        if(setView('audit',{auditStepSelected:true})===false)throw Error('已取消离开当前页面。');
        return workpaperWorkspace.openDirectoryIndex({projectId,index});
      }});
    }
  }
  function setView(name,{openProject=false,auditStepSelected=false}={}){
    const labels={
      home:['首页','审计项目工作台','从招投标到核算，按项目推进。'],
      templates:['基础资料 / 审计底稿模板','审计底稿模板','本机维护模板原件，按项目选用，不上传模板正文。'],
      archive:['报告 / 审计底稿归档','审计底稿归档','按原工作底稿目录整理原件、填写记录和明确关联的附件。'],
      basics:['基础资料','基础资料','统一维护投标方、审计底稿模板与收费依据，业务资料保存在本设备浏览器。'],
      settings:['设置','账号与设置','平台账号资料、显示偏好与本机数据说明。'],
      bidders:['基础资料 / 投标方信息库','投标方信息库','保存本所及获授权合作所的基础资料和证照，报价时按所选用。'],
      quote:['招投标 / 报价测算','把报价依据，摆在同一张桌上。','三栏可分别选择省级地区；优先本地参考，缺少本地规则时标明借用口径。'],
      rules:['基础资料 / 收费依据','收费依据','历史参考、自定义口径与原始出处分开管理。'],
      proposal:['招投标 / 报价单','报价单','按所选格式生成 Word，自动附带营业执照和执业证书。'],
      bid:['招投标 / 标书','标书','独立维护当前项目的投标文件。'],
      ledger:['招投标 / 报价历史','把报过的项目和结果记录下来。','报价日期、发标单位、项目和金额固定保存；已中标记录可进入立项，不自动建档。'],
      project:['立项','项目立项','选择已中标记录，核对来源后填写并保存立项信息表。'],
      travel:['核算 / 费用报销填报','费用报销填报','关联已立项项目，登记费用、发票及支付记录。'],
      costs:['核算 / 项目成本核算','项目成本核算','按项目核对收入、成本与项目收益率。'],
      audit:['审计程序','审计程序','按项目逐项核对资料，资料关门不代表审计完成。'],
      report:['报告','报告','试算平衡表9200与审计报告；审计判断和正式签发须另行核验。'],
      accounting:['核算','核算','此入口已预留，功能待建设。']
    };
    if(!Object.hasOwn(labels,name))return false;if(name!==view){const active=view==='archive'?archiveWorkspace:view==='templates'?templateWorkspace:view==='audit'?workpaperWorkspace:view==='project'?projectInitiation:view==='report'?reportWorkspace:view==='travel'?travelExpenses:view==='costs'?projectCosts:null;}
    if(name!==view&&pageDrafts)void pageDrafts.checkpoint(['proposal','bid'].includes(view)?'quote':view).catch(err=>draftNotice('切页暂存未完成：'+err.message,true));view=name;$('main').dataset.workspaceView=name;
    $$('.view').forEach(e=>e.hidden=e.id!=='view-'+name);
    $$('[data-view]').forEach(e=>{const active=e.dataset.view===name;e.classList.toggle('active',active);if(active)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
    $('.heading-actions').hidden=name!=='quote';
    $('#workspace-eyebrow').textContent=name==='quote'?'PRICING WORKBENCH':'AUDIT WORKSPACE';
    $('#breadcrumb').textContent=labels[name][0];$('#page-title').textContent=labels[name][1];$('#page-subtitle').textContent=labels[name][2];
    if(name==='rules'&&!$('#rules-form'))renderRules();if(name==='ledger')reloadLedger();
    if(name==='project'&&!openProject&&!$('#project-initiation').querySelector('[data-project-register-id]'))projectPageReady=Promise.resolve(projectInitiation?.show());
    if(name==='audit'&&!auditStepSelected&&!$('#audit-program').querySelector('#ac-project'))auditPageReady=Promise.resolve(auditProgram?.show());
    if(name==='settings')showSettings();if(name==='travel')showTravel();if(name==='costs')showCosts();
    if(name==='report')showReport();if(name==='archive'&&!archiveWorkspace&&globalThis.AuditArchiveUI)archiveWorkspace=globalThis.AuditArchiveUI.mount($('#audit-archive'));if(name==='templates'&&!templateWorkspace&&globalThis.AuditTemplates)templateWorkspace=globalThis.AuditTemplates.mount($('#audit-templates'));
    workspaceNavigation?.sync(name);projectActivity?.refreshContext().catch(()=>{});if(pageDrafts&&!draftRestored.has(name)){draftRestored.add(name);void restorePageDraft(name);}return true;
  }
  function connectProjectInitiation(){
    const host=$('#project-initiation');
    if(!host)return;
    if(!globalThis.ProjectInitiation){host.textContent='立项组件未载入，请刷新后重试。';return;}
    const list=async()=>{if(!deliveryStore)throw Error('本机报价台账暂不可用；请稍候重新进入。');const entries=await deliveryStore.list();for(const e of entries)if(e.events?.at(-1)?.outcome==='won')await globalThis.ProjectInitiation.ensureWon(e);return entries;};
    projectInitiation=globalThis.ProjectInitiation.mount(host,{
      listWon:list,
      lookup:async id=>{const row=(await list()).find(x=>x.id===id);if(!row)throw Error('未找到这条报价记录。');return row;},
      onBack:()=>{$('#ledger-filter').value='won';setView('ledger');}
    });
  }
  function hydrate(){selectOptions();if(!byId(state.selectedProvince))state.selectedProvince=provinceForLocation(state.client.location);if(state.client.location&&!provinceForLocation(state.client.location))state.client.location='其他地区';ensureSelected();activeRule=selectedId();ruleDraft=null;formFill($('#client-form'),state.client);fillQuoteForm();$('#rounding-enabled').checked=!!state.quote.rounding&&state.quote.rounding!=='none';$('#rounding-unit').value=state.quote.rounding==='thousand'?'thousand':'hundred';$('#rounding-unit').disabled=!$('#rounding-enabled').checked;update();if(view==='rules')renderRules();}
  function persistRecords(next){
    if(!validateChains(next)){toast('修订链不完整，未写入');return false;}
    if(readError){toast('本机记录不兼容或已损坏，已禁止写入和删除；请先导出原始备份。');return false;}
    try {
      // Detect other-tab updates and refuse to overwrite an unseen newer value.
      if(localStorage.getItem(STORE)!==storedRaw){readError=true;storedRaw=localStorage.getItem(STORE);renderHistory();toast('本机记录已被其他页面修改，请导出原始备份并重新载入。');return false;}
      const raw=JSON.stringify(next);localStorage.setItem(STORE,raw);storedRaw=raw;records=next;return true;
    }catch{toast('无法写入本机存储，记录未保存。请导出备份或检查浏览器权限。');return false;}
  }
  function save(asRevision=false){if(!finalResult)return;if(restoredNeedsReview){toast('历史复算待确认，请先明确确认采用当前重新测算结果');return;}if(readError){toast('已有存储无法读取；为避免覆盖，请先检查浏览器本机数据。');return;}
    const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());if(records.some(r=>r.id===id)){toast('记录编号冲突，未保存，请重试');return;}
    const record={id,savedAt:new Date().toISOString(),totalCents:finalResult.totalCents,snapshot:clone(state),calculation:clone({regions:outputs,budget:budgetResult,quote:finalResult}),appVersion:'0.1'};
    if(asRevision){const loaded=records.find(r=>r.id===activeRecordId);if(!loaded){toast('请先恢复最新修订');return;}const root=rootId(loaded),head=chainHead(root);if(!head||head.id!==loaded.id){toast('当前不是最新修订，请恢复最新版本后再保存');return;}if(customerKey(head)!==customerKey(record)){toast('客户名称、年度或业务类型已改变，请保存为新报价');return;}record.revisionRoot=root;record.revisionNo=chainVersion(head)+1;if(!confirm('将当前草稿另存为第 '+record.revisionNo+' 版？原版本不会覆盖。'))return;}
    if(persistRecords([record,...records])){activeRecordId=record.id;restoredNeedsReview=false;showRestoreReview();$('#preview').disabled=!finalResult;$('#csv').disabled=!finalResult;$('#save-revision').disabled=!finalResult;toast(asRevision?'已新增修订 · 仅本机':'已保存计算草稿 · 仅本机');renderHistory();refreshProposalControls();}}

  function renderHistory(){const list=$('#history-list');if(readError){list.innerHTML='<p class="error">本机记录不兼容、已损坏或被其他页面修改。已禁止写入和删除；请先导出原始备份，再联系维护人员。</p>';return;}list.innerHTML=records.length?records.map(r=>`<div class="record"><div><strong>${esc(r.snapshot.client?.clientName||'未命名客户')}</strong><p>${esc(r.snapshot.client?.year||'')} 年度 · ${esc(new Date(r.savedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · 草稿 · 第 ${esc(chainVersion(r))} 版 · 报价编号 ${esc(rootId(r))}</p></div><div class="record-actions"><strong>${esc(fmt(r.totalCents))}</strong><button class="btn" data-load="${esc(r.id)}">恢复草稿</button>${isLinked(r)?'<span class="muted">修订链保护</span>':`<button class="text-button" data-delete="${esc(r.id)}">删除</button>`}</div></div>`).join(''):'<div class="empty-state">还没有保存的报价。<br><small>完成测算后点击“保存到本机”，留存输入与规则快照。</small></div>';}
  function download(name,content,type){const blob=new Blob(['\ufeff',content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  const decimalCents = cents => C.formatMoney(cents).replace(/,/g,'');
  function csvCell(x){let s=String(x??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function exportCsv(){if(!finalResult||restoredNeedsReview)return;const rows=[['内部参考测算草稿 · 待复核'],['客户',state.client.clientName],['审计年度',state.client.year],['业务类型',state.client.service],['资产总额（万元）',state.client.assets],['营业收入（万元）',state.client.revenue],['净利润（万元，不参与计费）',state.client.profit],['客户所在地',state.client.location],['执行团队所在地',state.client.team],[],['参考地区','金额（元）','计算口径','规则版本','参考文件','状态']];for(const r of comparisonRules()){const v=outputs[r.id]||{error:'待选择地区'};rows.push([r.name,v.error?'不可计算':decimalCents(v.totalCents),v.baseLabel||v.error,r.version,r.document,fallbackRule(r)?'借用河北历史参考 / 非当地收费标准':'待复核 / 非现行统一价']);if(v.lines)for(const l of v.lines)rows.push(['计算明细',l.label,decimalCents(l.amountCents)]);}rows.push([],...(state.quote.basis==='budget'||(state.quote.basis==='sh'&&state.rules.find(r=>r.id==='sh')?.mode==='budget')?[['工时收费预算（元）',budgetResult?decimalCents(budgetResult.totalCents):'不可计算']]:[]),['报价基础',finalResult.label],['报价比例（原价%）',displayedFactor(state.quote)],['附加费用（元）',state.quote.extra],['另计税率（%）',state.quote.tax],['取整方式',state.quote.rounding||'none'],['取整前合计（元）',decimalCents(finalResult.unroundedTotalCents??finalResult.totalCents)],['报价草稿（元）',decimalCents(finalResult.totalCents)],['调整原因',state.quote.reason]);download('审计报价-内部对比草稿.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('已导出内部对比，文件含客户财务数据，请妥善保管');}

  let projectFiles=null,quoteExtras=null,extrasContext=null;
  function fileProject(){
    const f=$('#proposal-form').elements;
    return {issuer:f.issuer.value.trim(),projectName:f.projectName.value.trim(),firmName:f.firmName.value.trim(),bidderId:selectedBidder?.id||'',
      date:f.quoteDate.value,contact:$('#bidder-contact').value.trim(),phone:$('#bidder-phone').value.trim(),email:$('#bidder-email').value.trim()};
  }
  function syncDocumentScope(){
    if(!quoteExtras&&!projectFiles)return;
    const p=fileProject(),next=JSON.stringify([p.issuer,p.projectName,p.firmName,p.bidderId,currentProposalKey()]);
    const changed=extrasContext!==null&&next!==extrasContext;
    extrasContext=next;if(changed)quoteExtras?.clear();
    projectFiles?.refresh();
  }
  function currentExtras(){return quoteExtras?quoteExtras.list():[];}
  function currentProposalKey(){return JSON.stringify([state.client.clientName,state.client.year,state.client.service]);}
  function todayShanghai(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
  function resetProposal(){const f=$('#proposal-form');if(!f)return;$('#issuer-email').value='';const firm=f.elements.firmName.value,types=f.elements.projectType.options,projectType=Array.from(types).some(o=>o.value===state.client.service)?state.client.service:'其他';formFill(f,{firmName:firm,quoteDate:todayShanghai(),issuer:state.client.clientName,projectName:state.client.year+'年度'+state.client.service.replace(/^年度/,''),projectType,contactName:'',contactInfo:''});proposalKey=currentProposalKey();proposalEpoch++;refreshProposalControls();}
  const credentialLabels={business_license:'营业执照',practice_certificate:'执业证书'};
  function selectedPair(){
    if(!selectedBidder || $('#proposal-form').elements.firmName.value!==selectedBidder.name)return [];
    return Object.keys(credentialLabels).map(kind=>selectedBidder.attachments.find(a=>a.kind===kind)).filter(Boolean);
  }
  function previewBlockers(pair,matched){
    const reasons=[];
    const batch=!!batchQuote?.active();
    if(!batch&&!finalResult)reasons.push('客户或报价输入尚不完整，请检查上方错误提示');
    if(batch){try{batchQuote.capture();}catch(e){reasons.push(e.message);}}
    if(restoredNeedsReview)reasons.push('历史报价复算结果待明确确认');
    if(!matched)reasons.push('客户、年度或业务已改变，请点击“按当前客户重填登记信息”');
    if(!globalThis.QuotePacket)reasons.push('附件组件未能加载，请重新打开完整文件或刷新页面');
    if(!selectedBidder)reasons.push('请在投标方信息中选择事务所，以带入营业执照和执业证书');
    else {
      const missing=Object.entries(credentialLabels).filter(([kind])=>!pair.some(a=>a.kind===kind)).map(([,label])=>label);
      if(missing.length)reasons.push('所选事务所缺少'+missing.join('、')+'，请到投标方信息库补齐并重新带入');
    }
    if(selectedBidder&&(batch||finalResult)&&!restoredNeedsReview&&matched&&globalThis.QuotePacket&&!reasons.length){
      try{snapshotForProposal();}catch(e){reasons.push(e.message||'请核对报价登记信息');}
    }
    if(quoteExtras?.isPending())reasons.push('正在检查附加文件');
    if(tenderPending)reasons.push('发标文件正在识别');if(proposalBusy)reasons.push('正在处理，请稍候');return reasons;
  }
  function refreshProposalControls(){
    if(!$('#proposal-form'))return;
    syncDocumentScope();
    batchQuote?.refresh();
    const batchOn=!!batchQuote?.active(),batchTotal=$('#quote-batch-total-box');
    if(batchTotal){
      batchTotal.hidden=!batchOn;batchTotal.closest('.quote-summary').dataset.quoteScope=batchOn?'batch':'single';
      if(batchOn){try{$('#quote-batch-total').textContent=fmt(batchQuote.capture().totalCents);}catch{$('#quote-batch-total').textContent='待填齐';}}
    }
    if(proposalKey!==currentProposalKey())proposalKey=null;
    const pair=selectedPair(),matched=proposalKey===currentProposalKey(),blockers=previewBlockers(pair,matched);
    $('#keep-issuer').hidden=matched;$('#preview').disabled=blockers.length>0;if(quoteSigning?.reviewButton)quoteSigning.reviewButton.disabled=blockers.length>0;$('#export-current-quote').disabled=blockers.length>0;$('#register-quote').disabled=blockers.length>0||!deliveryStore;
    const sealedEntry=$('#preview-with-seal');
    sealedEntry.disabled=blockers.length>0||!selectedBidder?.signingKinds.length||!globalThis.QuoteBodyPdf||!globalThis.QuoteCompletePdf;
    $('#seal-preview-help').textContent=selectedBidder&&!selectedBidder.signingKinds.length
      ?'当前投标方未带入章签，可出无章报价；如需使用，请在信息库保存后点「重新带入」。'
      :'公司公章、法人章、投标人签字可分别选择，默认不加；只生成待复核副本，不发送。';
    const status=$('#preview-status');
    if(status){status.textContent=blockers.length?'暂不能生成：'+blockers.join('；')+'。':'报价与两项必带附件已齐，可生成 Word。';status.classList.toggle('error',blockers.length>0);}
    $('#proposal-client-status').textContent=matched?'登记信息对应当前客户；保存计算草稿不等于已报价。':'客户、年度或业务已改变。请明确按当前客户重填登记信息，避免带入上一客户的联系人。';
    $('#proposal-client-status').classList.toggle('error',!matched);
    const list=$('#credentials-list');
    $('#credentials-status').textContent=selectedBidder?selectedBidder.name+' · 资料第 '+selectedBidder.version+' 版 · '+(pair.length===2?'两证齐全，已随本次报价带入。':'证照未齐；请到库内补齐并保存，再回到报价页点「重新带入」。'):'请先选择投标方。营业执照和执业证书只需在投标方信息库上传一次。';
    $('#choose-bidder-for-quote').hidden=!!selectedBidder;
    $('#manage-bidder-credentials').hidden=!!selectedBidder&&pair.length===2;
    list.hidden=true;
    list.innerHTML=selectedBidder?Object.entries(credentialLabels).map(([kind,label])=>{
      const file=pair.find(a=>a.kind===kind);
      return '<div class="credential-item"><strong>'+label+'</strong><span class="'+(file?'':'error')+'">'+(file?esc(file.name):'缺少必带附件')+'</span></div>';
    }).join(''):'';
    $('#download-packet').disabled=proposalBusy||!previewPacket;$('#print').disabled=proposalBusy||!previewPacket;
    const full=$('#quote-complete-pdf');
    if(full){
      const locked=proposalBusy||completePdfBusy,ack=$('#quote-page-seal');
      const available=sealSource?.packet===previewPacket&&previewPacket&&previewIsCurrent(previewPacket)?sealSource.kinds:[];
      const picked=chosenSignKinds(),matched=picked.length>0&&picked.every(k=>available.includes(k));
      for(const el of signingInputs())el.disabled=locked||!available.includes(el.dataset.quotePageSignKind);
      full.disabled=locked||!previewPacket||!globalThis.QuoteBodyPdf||!globalThis.QuoteCompletePdf;
      ack.disabled=locked||!matched;
      $('#quote-preview-sealed-pdf').disabled=full.disabled||!matched||!ack.checked;
      const downloadDisabled=locked||!signedReview||signedReview.packet!==previewPacket||!matched||!ack.checked||signedReview.key!==signingKey(picked);
      $('#quote-download-sealed-pdf').disabled=downloadDisabled;
      const word=$('#quote-download-unsigned-word');
      word.disabled=locked||!previewPacket||!previewIsCurrent(previewPacket)||!globalThis.QuoteLayouts?.buildUnsignedWord;
      $('#close-preview').disabled=completePdfBusy;
    }
  }
  function snapshotForProposal(){
    if(!globalThis.QuotePacket)throw Error('附件模块未加载，客户导出不可用');
    if(restoredNeedsReview)throw Error('请先核对有效报价');
    const batch=batchQuote?.active()?batchQuote.capture():null,amount=batch||finalResult;
    if(!amount)throw Error('请先核对有效报价');
    if(proposalKey!==currentProposalKey())throw Error('请先按当前客户重填登记信息');
    const p=formRead($('#proposal-form'));if(!p.projectType)throw Error('请填写项目类型');
    if(!selectedBidder||selectedBidder.name!==p.firmName.trim())throw Error('请从投标方信息库选用与报价一致的事务所');
    p.contactInfo=[p.contactInfo,$('#issuer-email').value].map(v=>v.trim()).filter(Boolean).join(' / ');
    const bidderContact={name:$('#bidder-contact').value,phone:$('#bidder-phone').value,email:$('#bidder-email').value};
    if(Object.values(bidderContact).some(v=>v.trim()))p.bidderContact=bidderContact;
    return globalThis.QuotePacket.normalizeSnapshot({...p,
      customerName:batch?batch.quoteRows[0].name+'等 '+batch.quoteRows.length+' 家单位':state.client.clientName,
      auditYear:batch?batch.auditYear:Number(state.client.year),location:batch?'多单位（见报价明细）':state.client.location,service:state.client.service,
      subtotalCents:amount.subtotalCents,taxCents:amount.taxCents,totalCents:amount.totalCents,taxRateText:state.quote.tax+'%（税务口径待确认）',
      ...(batch?{quoteRows:batch.quoteRows}:{})
    });
  }
  async function proposalAction(work,target='#proposal-status'){if(proposalBusy)return;proposalBusy=true;refreshProposalControls();try{await work();}catch(e){if(target==='#quote-pdf-status')pdfStatus(e.message||'操作失败，未自动重试',true);else $(target).textContent=e.message||'操作失败，未自动重试';toast(e.message||'操作失败，未自动重试');}finally{proposalBusy=false;refreshProposalControls();}}
  function selectedLayouts(){return quoteSigning?.selection()||{formats:[],options:{}};}
  function signContext(){
    const {formats,options}=selectedLayouts(),b=selectedBidder,snapshot=snapshotForProposal(),rows=snapshot.quoteRows;
    return {epoch:proposalEpoch,snapshot,pair:selectedPair(),extras:currentExtras(),formats:rows&&!formats.length?['format1']:formats,options:rows?{...options,quoteRows:rows}:options,tenderFile:activeTenderSource,bidder:b?{id:b.id,version:b.version,name:b.name}:null};
  }
  function signContextIsCurrent(c){
    return c.epoch===proposalEpoch&&!!c.bidder&&selectedBidder?.id===c.bidder.id&&selectedBidder.version===c.bidder.version&&selectedBidder.name===c.bidder.name&&c.bidder.name===c.snapshot.firmName;
  }
  async function quoteBodies(ctx){
    const fragments=[];
    if(ctx.formats?.length){
      for(const id of ctx.formats){const d=await globalThis.QuoteLayouts.render(ctx.snapshot,id,[],{...ctx.options,previewOnly:true});fragments.push(d.html);}
    }else fragments.push(await globalThis.QuotePacket.renderDocument(ctx.snapshot,ctx.pair,{includeAttachments:false}));
    return fragments;
  }
  function pdfStatus(message,bad=false){
    const status=$('#quote-pdf-status');status.textContent=message;status.classList.toggle('error',bad);
  }
  const quotePdfHint='下载无章 Word 只含可编辑报价正文，不带章签或附件；需要附件请用报价 ZIP 或无章完整 PDF。';
  function previewIsCurrent(packet){
    return $('#quote-dialog').open&&previewPacket===packet&&(!packet.bidder||signContextIsCurrent(packet));
  }
  function showSealSource(packet,message,kinds=[]){
    if(!previewIsCurrent(packet))return;
    sealSource={packet,kinds};const el=$('#quote-seal-source-status');el.textContent=message;el.dataset.sealReady=kinds.length?'yes':'no';
    refreshProposalControls();
  }
  async function readSigningAssets(packet){
    let db;
    try{
      db=await globalThis.BidderLibrary.open();
      const r=await db.get(packet.bidder.id);
      if(r?.id!==packet.bidder.id||r.version!==packet.bidder.version||r.name!==packet.snapshot.firmName)
        throw Error('投标方档案已更新，请关闭预览，在「投标方信息」点「重新带入」。');
      return (r.signingAssets||[]).filter(a=>Object.hasOwn(signingLabels,a.kind));
    }finally{db?.close?.();}
  }
  async function readSelectedSigningAssets(packet,kinds){
    const assets=await readSigningAssets(packet);
    return kinds.map(k=>{
      const a=assets.find(v=>v.kind===k);
      if(!a)throw Error('当前档案缺少'+signingLabels[k]+'，请补齐并重新带入，或取消勾选。');
      return a;
    });
  }
  async function checkSealSource(packet){
    if(!packet.bidder)return showSealSource(packet,'这是历史报价，只提供无章原稿和原附件，不使用当前档案补盖。');
    showSealSource(packet,'正在检查当前投标方档案的章签…');
    try{
      const assets=await readSigningAssets(packet);
      showSealSource(packet,assets.length?'本次可选：'+assets.map(a=>signingLabels[a.kind]).join('、')+' · 资料第 '+packet.bidder.version+' 版':'当前档案没有上传章签，仍可生成无章报价。',assets.map(a=>a.kind));
    }catch(e){showSealSource(packet,e?.message||'未能读取本机投标方档案，请重新带入。');}
  }
  function resetSignedReview(){
    cleanSigned?.();cleanSigned=null;signedReview=null;
    $('#quote-sealed-review').hidden=true;$('#quote-sealed-status').textContent='';
  }
  async function printCertificates(packet,report){
    if(!previewIsCurrent(packet))throw Error('报价已变化，请重新打开预览。');
    if(!globalThis.QuoteCompletePdf?.buildCertificates)throw Error('证照打印组件未加载，可分别下载原件打印。');
    let tab;
    // Reserve the tab synchronously from this explicit print click.
    try{
      tab=window.open('','_blank');
      if(tab){
        tab.opener=null;
        tab.document.title='正在准备两项证照';
        tab.document.body.textContent='正在本机准备两项证照，请稍候…';
      }
    }catch{try{tab?.close();}catch{}tab=null;}
    report('正在本机准备两项证照…');
    try{
      const pair=await globalThis.QuotePacket.verifyPair(packet.pair);
      const result=await globalThis.QuoteCompletePdf.buildCertificates(pair);
      if(!previewIsCurrent(packet))throw Error('报价已变化，未打开证照，请重新预览。');
      if(tab&&!tab.closed){
        const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
        try{
          tab.location.replace(url);
          setTimeout(()=>URL.revokeObjectURL(url),300000);
          report('已打开两证 PDF（'+result.pageCount+' 页），请使用 PDF 页里的打印按钮。');
          return;
        }catch{URL.revokeObjectURL(url);try{tab.close();}catch{}tab=null;}
      }
      if(tab?.closed){report('打印标签页已关闭，可再点击「打印两项证照」。');return;}
      blobDownload('营业执照与执业证书.pdf',result.bytes,'application/pdf');
      report('浏览器未打开新标签页，已下载两证 PDF（'+result.pageCount+' 页），打开即可打印。');
    }catch(e){
      try{tab?.close();}catch{}
      throw Error((e?.message||'无法打开两证打印文件。')+' 可分别下载原件后打印。');
    }
  }
  function setAttachmentSealPoint(packet,point,clear=false){
    if(!packet.bidder||!previewIsCurrent(packet)||proposalBusy||completePdfBusy||!selectedBidder?.signingKinds.includes('company_seal'))return false;
    const {extraIndex,page,x,y}=point||{},f=packet.extras[extraIndex];
    if(!Number.isInteger(extraIndex)||extraIndex<0||!Number.isInteger(page)||page<1||page>100||!f||
      !['application/pdf','image/png','image/jpeg'].includes(f.mime)||(f.mime!=='application/pdf'&&page!==1)||
      (!clear&&(![x,y].every(Number.isFinite)||x<0||x>1||y<0||y>1)))return false;
    const id=extraIndex+':'+page;
    if(clear)packet.attachmentSealOverrides.delete(id);
    else packet.attachmentSealOverrides.set(id,Object.freeze({extraIndex,page,x,y}));
    $('#quote-page-seal').checked=false;resetSignedReview();
    pdfStatus(clear?'已清除该页的手选章位。请重新确认并生成章签 PDF。':'已记录该页公章位置。请返回上方勾选公司公章，重新确认并生成 PDF。');
    refreshProposalControls();
    return true;
  }
  function openQuotePreview(ctx,fragments){
    cleanAnnex?.();resetSignedReview();sealSource=null;const host=$('#quote-preview-attachments');
    previewPacket={...ctx,fragments,attachmentSealOverrides:new Map()};
    const dialog=$('#quote-dialog');
    dialog.dataset.previewMode='plain';
    $('#quote-preview-title').textContent='客户报价草稿 · 无章';
    $('#customer-preview').hidden=false;
    $('#customer-preview').innerHTML=(ctx.formats?.length?'<style>'+globalThis.QuoteLayouts.styles+'</style>':'')+fragments.join('');
    $('#quote-annex-count').textContent='（'+(ctx.pair.length+ctx.extras.length)+'）';
    const ack=$('#quote-page-seal');ack.checked=false;ack.disabled=true;
    for(const el of signingInputs()){el.checked=false;el.disabled=true;}
    for(const id of ['quote-page-sign-choices','quote-page-seal-option','quote-preview-sealed-pdf'])$('#'+id).hidden=!ctx.bidder;
    pdfStatus(ctx.bidder?quotePdfHint:'历史报价可下载无章 Word、无章完整 PDF 或含原件的 ZIP；不使用当前事务所档案的章签。');
    const packet=previewPacket;
    const manual=ctx.bidder&&selectedBidder?.signingKinds.includes('company_seal')?{
      onSetCompanySealPoint:point=>setAttachmentSealPoint(packet,point),
      onClearCompanySealPoint:point=>setAttachmentSealPoint(packet,point,true)
    }:{};
    if(globalThis.QuoteAnnexPreview)cleanAnnex=globalThis.QuoteAnnexPreview.mount(host,{pair:ctx.pair,extras:ctx.extras,onPrintCertificates:report=>printCertificates(packet,report),...manual});
    else {host.textContent='附件预览组件未加载。仍可用报价 ZIP 下载全部原件。';cleanAnnex=()=>host.replaceChildren();}
    $('#quote-seal-source-status').textContent='';
    $('#quote-seal-source-status').dataset.sealReady='no';
    dialog.showModal();
    dialog.scrollTop=0;
    void checkSealSource(previewPacket);
    return previewPacket;
  }
  async function prepareQuotePreview(){
    const ctx=signContext(),Q=globalThis.QuotePacket;
    ctx.pair=await Q.verifyPair(ctx.pair);ctx.extras=await Q.verifyExtras(ctx.extras);
    const fragments=await quoteBodies(ctx);
    if(!signContextIsCurrent(ctx))throw Error('报价或附件已改变，请重新预览');
    return {ctx,fragments};
  }
  async function preview(){
    return proposalAction(async()=>{
      const {ctx,fragments}=await prepareQuotePreview();
      openQuotePreview(ctx,fragments);
    });
  }
  async function previewWithSeal(){
    if($('#preview-with-seal').disabled)return;
    await proposalAction(async()=>{
      const {ctx,fragments}=await prepareQuotePreview();
      openQuotePreview(ctx,fragments);
      $('#quote-page-sign-choices').scrollIntoView?.({block:'nearest'});
    });
  }
  async function buildQuotePdf(packet,assets=[]){
    const Q=globalThis.QuotePacket,attachments=[...await Q.verifyPair(packet.pair),...await Q.verifyExtras(packet.extras)];
    const seal=assets.find(a=>a.kind==='company_seal')||null;
    const bodySigningAssets=assets.filter(a=>a.kind!=='company_seal');
    const rendered=assets.length
      ?await globalThis.QuoteBodyPdf.buildWithAnchors(packet.fragments,bodySigningAssets.map(a=>a.kind))
      :{body:await globalThis.QuoteBodyPdf.build(packet.fragments)};
    return globalThis.QuoteCompletePdf.build({...rendered,attachments,seal,position:seal?'bottom-right':undefined,bodySigningAssets,
      ...(seal&&packet.attachmentSealOverrides?.size?{attachmentSealOverrides:[...packet.attachmentSealOverrides.values()]}:{})});
  }
  async function withPdfLock(work){
    if(proposalBusy||completePdfBusy)return;
    completePdfBusy=true;
    try{await proposalAction(work,'#quote-pdf-status');}
    finally{completePdfBusy=false;refreshProposalControls();}
  }
  async function wordFile(ctx,isCurrent){
    if(!globalThis.QuoteWordDelivery)throw Error('Word 生成组件未加载，请刷新完整版本。');
    const check=()=>!isCurrent||isCurrent();
    const file=await globalThis.QuoteWordDelivery.build({snapshot:ctx.snapshot,attachments:ctx.pair,extras:ctx.extras||[],formats:ctx.formats||[],options:ctx.options||{},isCurrent:check});
    if(!check())throw Error('报价或附件已变化，未下载，请重试。');
    if(ctx.bidder){let db;try{db=await globalThis.BidderLibrary.open();const latest=await db.get(ctx.bidder.id);if(latest?.version!==ctx.bidder.version||latest.name!==ctx.snapshot.firmName)throw Error('事务所资料已更新，请重新带入后生成。');}finally{db?.close?.();}}
    if(!check())throw Error('报价内容已变化，未下载。');
    blobDownload(file.name,file.bytes,file.mime);
    return file;
  }
  async function generateCurrentWord(){
    return proposalAction(async()=>{const ctx=signContext();if(quoteExtras?.isPending())throw Error('正在检查附加文件');$('#preview-status').textContent='正在本机生成 Word 并逐页附入两证和所选附件…';const file=await wordFile(ctx,()=>signContextIsCurrent(ctx));$('#preview-status').textContent='已生成 Word · '+file.attachmentPages+' 页附件；请核对后使用。';toast('已下载报价单 Word · 未发送');},'#preview-status');
  }
  async function downloadUnsignedWord(){const packet=previewPacket;if(!packet||!previewIsCurrent(packet))return;return proposalAction(async()=>{await wordFile(packet,()=>previewIsCurrent(packet));pdfStatus('已下载包含必带附件的报价单 Word。');},'#quote-pdf-status');}

  async function downloadCompletePdf(){
    const packet=previewPacket;
    if(!packet||!previewIsCurrent(packet))return;
    await withPdfLock(async()=>{
      pdfStatus('正在本机生成无章完整 PDF…');
      const file=await buildQuotePdf(packet);
      if(!previewIsCurrent(packet))throw Error('报价资料已变化，请重新打开预览。');
      blobDownload('审计报价-正文和附件-待复核.pdf',file.bytes,'application/pdf');
      pdfStatus('已下载 '+file.pageCount+' 页无章完整 PDF。如需加章签，请在上方勾选。');
    });
  }
  function reviewIsAuthorized(packet,key){
    return !!packet?.bidder&&previewIsCurrent(packet)&&$('#quote-page-seal').checked&&!!key&&signingKey(chosenSignKinds())===key&&sealSource?.packet===packet&&chosenSignKinds().every(k=>sealSource.kinds.includes(k));
  }
  function revokeSigning(packet,message){
    $('#quote-page-seal').checked=false;resetSignedReview();showSealSource(packet,message);
  }
  async function buildSealedReview(packet){
    const kinds=chosenSignKinds(),key=signingKey(kinds);
    if(!reviewIsAuthorized(packet,key))throw Error('请先勾选并确认本次章签。');
    resetSignedReview();pdfStatus('正在本机生成所选章签副本…');
    let assets,hash;
    try{assets=await readSelectedSigningAssets(packet,kinds);hash=signingHashes(assets);}
    catch(e){revokeSigning(packet,e.message);throw e;}
    if(!reviewIsAuthorized(packet,key))throw Error('报价资料或章签选择已变化，未生成可下载副本。');
    const file=await buildQuotePdf(packet,assets);
    try{if(signingHashes(await readSelectedSigningAssets(packet,kinds))!==hash)throw Error('章签图样已更新，请重新带入。');}
    catch(e){revokeSigning(packet,e.message);throw e;}
    if(!reviewIsAuthorized(packet,key))throw Error('报价资料或章签选择已变化，未生成可下载副本。');
    const review={packet,file,kinds,key,hash};signedReview=review;
    const section=$('#quote-sealed-review'),status=$('#quote-sealed-status');
    const places=file.attachmentSealPlacement;
    const extraNote=places&&(places.auto+places.manual+places.aligned+places.default)>0
      ?'附加附件：'+places.auto+' 页识别落款、'+places.manual+' 页手选、'+places.aligned+' 页沿用同附件落款位置、'+places.default+' 页使用版心靠右下的默认位置。'
        +(places.aligned||places.default?'可在附件原件预览中点选调整。':''):'';
    section.hidden=false;status.textContent='共 '+file.pageCount+' 页 · 已应用：'+kinds.map(k=>signingLabels[k]).join('、')+'。'+
      (kinds.includes('company_seal')?'公章固定 42×42 mm；正文按落款，两证盖在证照内容上。'+extraNote:'所选章签仅用于正文落款，附件未加章签。');
    const mount=globalThis.QuoteAnnexPreview?.mountPdf;
    const noPreview=()=>{if(signedReview===review)status.textContent='共 '+file.pageCount+' 页 · 浏览器无法显示此页，可下载同一份章签 PDF 后核对。';};
    if(mount)cleanSigned=mount($('#quote-sealed-preview'),{bytes:file.bytes,name:'章签 PDF',onError:noPreview});
    else noPreview();
    pdfStatus('已生成章签副本。请在下方逐页核对，再点「下载此章签 PDF」；顶部 Word 始终无章。');
    section.scrollIntoView?.({block:'start'});
  }
  async function reviewSealedPdf(){
    const packet=previewPacket;
    if(!reviewIsAuthorized(packet,signingKey(chosenSignKinds())))return;
    await withPdfLock(()=>buildSealedReview(packet));
  }
  async function downloadSealedPdf(){
    const review=signedReview;
    if(!review||!reviewIsAuthorized(review.packet,review.key))return;
    await withPdfLock(async()=>{
      try{
        if(signingHashes(await readSelectedSigningAssets(review.packet,review.kinds))!==review.hash)
          throw Error('章签图样已更新，请重新带入。');
      }catch(e){revokeSigning(review.packet,e.message);throw e;}
      if(signedReview!==review||!reviewIsAuthorized(review.packet,review.key)){
        $('#quote-page-seal').checked=false;resetSignedReview();throw Error('档案、报价或章签选择已变化，未下载。请重新核对。');
      }
      const fileName=review.key==='company_seal'?'审计报价-正文和附件逐页盖章-待复核.pdf':'审计报价-章签-待复核.pdf';
      blobDownload(fileName,review.file.bytes,'application/pdf');
      pdfStatus('已下载 '+review.file.pageCount+' 页章签 PDF，与上方预览为同一份文件。');
      $('#quote-sealed-status').textContent='已下载 '+review.file.pageCount+' 页 · 原件未修改。';
    });
  }
  async function formatPacket(ctx,plan=[],assets=[]){
    const Q=globalThis.QuotePacket;
    if(!ctx.formats?.length)return Q.buildPacket(ctx.snapshot,ctx.pair,ctx.extras);
    const byId=new Map(plan.map(x=>[x.id,x])),documents=[],replacements=[];
    const needed=kinds=>kinds.map(k=>{const a=assets.find(x=>x.kind===k);if(!a)throw Error('当前投标方档案缺少相应章签图片，请先在信息库补齐并重新带入。');return a;});
    for(const id of ctx.formats){
      const kinds=byId.get('quote:'+id)?.kinds||[];
      const d=await globalThis.QuoteLayouts.render(ctx.snapshot,id,needed(kinds),ctx.options);
      documents.push({formatId:id,html:d.html,docx:d.docx||null,kinds});byId.delete('quote:'+id);
    }
    for(const item of globalThis.QuoteSignUI.itemsFor(ctx)){
      const p=byId.get(item.id);if(!p)continue;
      if(item.type!=='attachment'||!globalThis.QuoteAttachmentStamps)throw Error('附件处理组件未加载，未生成报价包。');
      const copy=await globalThis.QuoteAttachmentStamps.apply(item.file,{kinds:p.kinds,assets:needed(p.kinds),page:p.page,position:p.position});
      replacements.push({...copy,id:item.id,kinds:p.kinds,page:p.page,position:p.position});byId.delete(item.id);
    }
    if(byId.size)throw Error('章签计划与本次报价不一致。');
    return Q.buildPreparedPacket(ctx.snapshot,ctx.pair,ctx.extras,{documents,replacements});
  }
  async function emitSignedPacket(ctx,plan){
    if(proposalBusy||!signContextIsCurrent(ctx)||!ctx.formats.length||!plan.length)throw Error('请重新选择事务所和格式并核对章签。');
    proposalBusy=true;refreshProposalControls();
    let db;
    try{
      const required=[...new Set(plan.flatMap(x=>x.kinds))],labels={company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字'};
      db=await globalThis.BidderLibrary.open();
      const r=await db.get(ctx.bidder.id);
      if(r.id!==ctx.bidder.id||r.version!==ctx.bidder.version||r.name!==ctx.bidder.name||!signContextIsCurrent(ctx))throw Error('事务所档案已变更，请重新带入后再核对章签。');
      const assets=(r.signingAssets||[]).filter(a=>required.includes(a.kind));
      const missing=required.filter(k=>!assets.some(a=>a.kind===k));
      if(missing.length)throw Error('当前所缺少：'+missing.map(k=>labels[k]).join('、')+'。请在信息库补齐并重新带入。');
      const bytes=await formatPacket(ctx,plan,assets);
      const latest=(await db.list()).find(x=>x.id===ctx.bidder.id);
      if(!signContextIsCurrent(ctx)||latest?.version!==ctx.bidder.version||latest.name!==ctx.bidder.name)throw Error('报价、附件或事务所档案已改变，未下载，请重新核对。');
      blobDownload('审计报价-章签副本-待复核.zip',bytes,'application/zip');
      toast('已生成章签待复核副本，原件未修改、未外发。');
    }finally{try{db?.close?.();}finally{proposalBusy=false;refreshProposalControls();}}
  }
  function blobDownload(name,bytes,type){const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  async function reloadLedger(){if(!deliveryStore){$('#ledger-status').textContent='本机台账不可用，请检查浏览器存储权限。';return;}try{ledgerRows=await deliveryStore.list();renderLedger();$('#ledger-status').textContent='已读取 '+ledgerRows.length+' 条本机报价登记。';}catch(e){$('#ledger-status').textContent='读取失败，未重置或覆盖旧数据：'+e.message;}}
  function renderLedger(){const query=$('#ledger-search').value.trim().toLowerCase(),filter=$('#ledger-filter').value;const rows=ledgerRows.filter(e=>{const o=e.events.at(-1)?.outcome||'pending',v=e.snapshot;return (filter==='all'||filter===o)&&(!query||[v.issuer,v.projectName,v.projectType,v.contactName,v.contactInfo,v.customerName].some(x=>x.toLowerCase().includes(query)));});$('#ledger-empty').hidden=rows.length>0;$('#ledger-rows').innerHTML=rows.map((e,i)=>{const v=e.snapshot,o=e.events.at(-1)?.outcome||'pending';return '<tr><td>'+(i+1)+'</td><td>'+esc(v.quoteDate)+'</td><td>'+esc(v.issuer)+'</td><td>'+esc(v.projectName)+'</td><td>'+esc(v.projectType)+'</td><td>'+esc(C.formatMoney(v.totalCents))+'</td><td><span class="status-chip">'+outcomeNames[o]+'</span></td><td>'+esc(v.contactName||'—')+'</td><td>'+esc(v.contactInfo||'—')+'</td><td><div class="ledger-actions"><button class="btn" data-packet-id="'+esc(e.id)+'">下载报价 Word</button><label class="ledger-result-select">登记结果<select data-result-select="'+esc(e.id)+'" aria-label="登记报价结果">'+(o==='pending'?'<option value="" disabled selected hidden>登记结果</option>':'')+['won','lost','cancelled'].map(k=>'<option value="'+k+'"'+(o===k?' selected':'')+'>'+outcomeNames[k]+'</option>').join('')+'</select></label>'+(o==='won'&&projectInitiation?'<button type="button" class="btn primary" data-initiation-id="'+esc(e.id)+'">填立项信息表</button>':'')+'</div><details><summary>结果留痕 '+e.events.length+' 次</summary>'+e.events.map(t=>'<p>#'+t.eventNo+' '+outcomeNames[t.outcome]+' · '+esc(t.recordedAt)+'<br>'+esc(t.note||'未填写说明')+'</p>').join('')+'<small>登记编号 '+esc(e.id)+'</small></details></td></tr>';}).join('');}
  async function openLedgerPacket(id){return proposalAction(async()=>{const data=await deliveryStore.get(id),ctx={snapshot:data.entry.snapshot,pair:data.attachments,extras:data.extras||[],formats:['format1'],options:data.entry.snapshot.quoteRows?{quoteRows:data.entry.snapshot.quoteRows}:{}};await wordFile(ctx,()=>true);$('#ledger-status').textContent='已下载该条已登记报价 Word，含两项必带附件。';},'#ledger-status');}
  function connectProposal(){if(!$('#proposal-form'))return;resetProposal();$('#proposal-form').addEventListener('submit',e=>e.preventDefault());$('#proposal-form').addEventListener('input',e=>{if(e.target===document.querySelector('#tender-file')||e.target.closest('#bidder-picker'))return;proposalEpoch++;if(e.target.name==='firmName'&&selectedBidder){const name=e.target.value;clearBidder();e.target.value=name;bidderPicker?.clearPicker();}if(['issuer','projectName','contactName','contactInfo'].includes(e.target.name)||e.target.id==='issuer-email')intakeChanged=true;refreshProposalControls();});$('#keep-issuer').addEventListener('click',()=>{if(confirm('确认沿用当前发标单位、项目与联系方式，关联至所选被审计方？')){proposalKey=currentProposalKey();proposalEpoch++;refreshProposalControls();}});$('#complete-proposal').addEventListener('click',()=>{setView('quote');$('#proposal-form').scrollIntoView({behavior:'smooth',block:'start'});});$('#sync-proposal').addEventListener('click',()=>{if(confirm('按当前客户重填项目和日期，并清空旧联系人？事务所名称及资质附件保留。'))resetProposal();});
   $('#choose-bidder-for-quote').addEventListener('click',()=>$('#bidder-picker-select')?.focus());
   $('#manage-bidder-credentials').addEventListener('click',()=>{
     setView('bidders');
     const edit=selectedBidder&&$$('[data-bidder-edit]').find(b=>b.dataset.bidderEdit===selectedBidder.id);
     if(edit)edit.click();else $('#bidder-new')?.focus();
   });
   $('#register-quote').addEventListener('click',()=>proposalAction(async()=>{const ticket=proposalEpoch,snapshot=snapshotForProposal(),extras=currentExtras(),pair=await globalThis.QuotePacket.verifyPair(selectedPair());if(ticket!==proposalEpoch)throw Error('内容已变化，请核对后重新登记');if(!confirm('登记当前报价 '+fmt(snapshot.totalCents)+'，并固定保存项目、联系人、两项证照与所选的附加文件？这不会发送或批准报价。'))return;await deliveryStore.register(snapshot,pair,extras);$('#proposal-status').textContent='本次报价已登记，可在“报价历史”查看并追加中标结果。';await reloadLedger();toast('已登记报价 · 未发送');}));
   $('#download-packet').addEventListener('click',downloadUnsignedWord);
   $('#export-current-quote').addEventListener('click',generateCurrentWord);
   $('#ledger-rows').addEventListener('change',e=>{const select=e.target.closest('[data-result-select]');if(!select)return;const entry=ledgerRows.find(x=>x.id===select.dataset.resultSelect),outcome=select.value,previous=entry?.events.at(-1)?.outcome||'pending';if(!entry||!['won','lost','cancelled'].includes(outcome)||outcome===previous)return;if(proposalBusy){select.value=previous==='pending'?'':previous;return;}if(!confirm('将该报价登记为「'+outcomeNames[outcome]+'」？将追加记录，不覆盖原结果。')){select.value=previous==='pending'?'':previous;return;}select.disabled=true;void proposalAction(async()=>{await deliveryStore.appendResult(entry.id,{expectedEventNo:entry.lastEventNo,outcome,note:'通过下拉选项登记结果'});await reloadLedger();if(outcome==='won'){try{await globalThis.ProjectInitiation.ensureWon((await deliveryStore.list()).find(x=>x.id===entry.id));toast('已登记中标并生成项目');}catch(err){toast('中标已登记；项目创建待重试：'+err.message);}}else toast('结果已追加；原有项目资料保留');},'#ledger-status').finally(()=>{if(select.isConnected){select.disabled=false;select.value=previous==='pending'?'':previous;}});});
   $('#ledger-search').addEventListener('input',renderLedger);$('#ledger-filter').addEventListener('change',renderLedger);$('#reload-ledger').addEventListener('click',reloadLedger);
   $('#ledger-rows').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.initiationId&&projectInitiation){
     setView('project',{openProject:true});
     $('#page-title').scrollIntoView?.({block:'start'});
     await projectInitiation.open(b.dataset.initiationId);
     return;
   }if(b.dataset.packetId){await openLedgerPacket(b.dataset.packetId);return;}const entry=ledgerRows.find(x=>x.id===b.dataset.resultId);if(!entry)return;const f=$('#ledger-result-form');formFill(f,{entryId:entry.id,expectedEventNo:String(entry.lastEventNo),outcome:entry.events.at(-1)?.outcome||'won',note:''});$('#result-status').textContent='将追加结果，不覆盖旧记录；若其他页面已更新，需先重新读取。';$('#ledger-result-dialog').showModal();});
   $('#close-result').addEventListener('click',()=>$('#ledger-result-dialog').close());$('#ledger-result-form').addEventListener('submit',e=>{e.preventDefault();proposalAction(async()=>{const v=formRead(e.currentTarget);await deliveryStore.appendResult(v.entryId,{expectedEventNo:Number(v.expectedEventNo),outcome:v.outcome,note:v.note});$('#ledger-result-dialog').close();await reloadLedger();if(v.outcome==='won'){try{await globalThis.ProjectInitiation.ensureWon((await deliveryStore.list()).find(x=>x.id===v.entryId));toast('中标结果已保存 · 项目已自动生成，请到立项填写最终中标价与合同');}catch(e){toast('中标结果已保存，但自动建项目失败：'+e.message+'；请到立项重试');}}else toast('结果已追加，已有项目和合同资料保留');},'#result-status');});
   $('#export-ledger-csv').addEventListener('click',()=>proposalAction(async()=>{const rows=await deliveryStore.list();download('报价历史记录.csv',deliveryStore.historyCsv(rows),'text/csv;charset=utf-8');},'#ledger-status'));
   $('#export-ledger-json').addEventListener('click',()=>proposalAction(async()=>{if(!confirm('导出包含联系人及两项证照文件的完整本机归档？请妥善保管；当前暂不支持自动导入。'))return;const value=await deliveryStore.exportArchive();download('报价台账与附件归档.json',typeof value==='string'?value:JSON.stringify(value,null,2),'application/json;charset=utf-8');},'#ledger-status'));
   if(globalThis.QuoteLedger&&globalThis.QuotePacket)globalThis.QuoteLedger.open().then(store=>{deliveryStore=store;refreshProposalControls();if(view==='project')projectPageReady=Promise.resolve(projectInitiation?.show());}).catch(e=>{$('#proposal-status').textContent='本机报价台账不可用，无法登记；未重置历史资料：'+e.message;deliveryStore=null;refreshProposalControls();});else $('#proposal-status').textContent='台账或附件组件未载入，暂不能登记报价。';
  }
  function captureRuleForm(){const r=clone(ruleDraft), form=$('#rules-form'),values=formRead(form);r.basis=values.basis;r.mode=values.mode;r.minimumYuan=values.minimumYuan;r.fixedYuan=values.fixedYuan===''?null:values.fixedYuan;for(const el of $$('[data-tier]',form)){let val=el.value;if(el.dataset.field==='upToYuan')val=val===''?null:wanToYuan(val);r.tiers[+el.dataset.tier][el.dataset.field]=val;}return r;}
  $('#comparison').addEventListener('change',e=>{const select=e.target.closest('[data-comparison-slot]');if(!select)return;const slot=Number(select.dataset.comparisonSlot),id=select.value;if(!Number.isInteger(slot)||slot<0||slot>2||(!byId(id)&&!(id===''&&(slot===0||slot===1&&state.client.team==='')))){toast('参考地区无效，未更改');renderComparison();return;}const ids=comparisonIds();ids[slot]=id;state.comparisonProvinceIds=ids;state.selectedProvince=ids[0];ensureRule(id,true);ensureSelected();activeRule=id||uniqueComparisonRules()[0]?.id||'';ruleDraft=null;update();if(view==='rules')renderRules();});
  document.addEventListener('input',e=>{
    const form=$('#client-form');if(e.target.form!==form)return;
    const previous=state.client,ids=comparisonIds();state.client=formRead(form);if(e.target.name!=='team'){intakeChanged=true;syncList();}
    for(const [slot,key] of ['location','team'].entries()){
      if(e.target.name!==key||previous[key]===state.client[key])continue;
      const id=provinceForLocation(state.client[key]);
      ids[slot]=id;state.comparisonProvinceIds=ids;state.selectedProvince=ids[0];ensureRule(id,true);activeRule=id;ruleDraft=null;
    }
    update();
  });$('#quote-form').addEventListener('input',e=>{const q=formRead($('#quote-form'));delete q.roundingUnit;if(state.quote.pricePercent===undefined&&e.target.name!=='pricePercent')delete q.pricePercent;state.quote={...state.quote,...q};state.quote.rounding=$('#rounding-enabled').checked?$('#rounding-unit').value:'none';$('#rounding-unit').disabled=!$('#rounding-enabled').checked;update();});
  $('#comparison').addEventListener('click',e=>{const b=e.target.closest('[data-choose]');if(!b)return;state.quote.basis=b.dataset.choose;fillQuoteForm();update();});
  $$('[data-view]:not([data-nav-audit-step]):not([data-nav-section]):not([data-report-section])').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $$('[data-home-view]').forEach(b=>b.addEventListener('click',()=>{setView(b.dataset.homeView);$('#page-title').scrollIntoView?.({block:'start'});}));
  $$('[data-back-home]').forEach(b=>b.addEventListener('click',()=>setView('home')));

  $('#demo').addEventListener('click',()=>{if(!confirm('载入演示会替换当前未保存的草稿，是否继续？'))return;activeRecordId=null;restoredNeedsReview=false;state=defaults();resetIntakeView();hydrate();resetProposal();toast('已载入虚构演示客户与示例报价');});
  $('#clear-client').addEventListener('click',()=>{if(!confirm('清空当前客户名称和财务金额？'))return;Object.assign(state.client,{clientName:'',assets:'',revenue:'',profit:''});intakeChanged=true;syncList();hydrate();});
  function pickRule(id){
    if(!byId(id))return;
    activeRule=id;ruleDraft=null;ensureRule(id,true);update();renderRules();
  }
  $('#rules-region-select').addEventListener('change',e=>pickRule(e.target.value));
  $('#rule-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-rule]');if(b)pickRule(b.dataset.rule);});
  $('#rule-editor').addEventListener('change',e=>{if(e.target.name==='mode'){try{const r=captureRuleForm();ruleDraft=r;renderRules(true);}catch(err){$('#rule-error').textContent=err.message;}}});
  $('#rule-editor').addEventListener('click',e=>{const t=e.target;if(byId(activeRule)?.scopePending)return;if(t.id==='restore-rule'){if(!confirm('恢复该地区的初始参考配置？'))return;const idx=state.rules.findIndex(r=>r.id===activeRule);state.rules[idx]=ruleDefault(byId(activeRule));renderRules();update();return;}if(t.id==='add-tier'||t.dataset.removeTier!==undefined){try{const r=captureRuleForm();if(t.id==='add-tier')r.tiers.push(r.mode==='flat'?{upToYuan:null,feeYuan:'0'}:{upToYuan:null,ratePerMille:'0'});else r.tiers.splice(+t.dataset.removeTier,1);ruleDraft=r;renderRules(true);}catch(err){$('#rule-error').textContent=err.message;}}});
  $('#rule-editor').addEventListener('submit',e=>{e.preventDefault();if(byId(activeRule)?.scopePending)return;try{const r=captureRuleForm();if(r.mode!=='budget') {if(r.mode==='fixed'&&r.fixedYuan===null)throw Error('请填写固定金额');C.calculateScale({...r,baseYuan:'1'});}r.version='本机自定义 v0.1';r.status='custom_unverified';delete r.overRangeConsult;r.notes='用户修改的自定义规则，尚未由事务所核定。'+(r.sourceRegionId==='hb'?'编辑起点为河北历史模板，不是本地标准。':'原始文件仅作为参考线索。');state.rules[state.rules.findIndex(x=>x.id===activeRule)]=r;renderRules();update();toast('规则已应用到草稿，仍需人工复核');}catch(err){$('#rule-error').textContent=err.message;}});
  $('#accept-recalculation').addEventListener('click',()=>{if(restoredNeedsReview&&confirm('确认采用当前重新计算的结果？这不代表历史价格、规则或审计业务已核定，原历史记录不变。')){restoredNeedsReview=false;calculateQuote();toast('已采用当前重新测算结果 · 历史记录未改动');}});$('#save').addEventListener('click',()=>save(false));$('#save-revision').addEventListener('click',()=>save(true));$('#csv').addEventListener('click',exportCsv);$('#preview').addEventListener('click',preview);$('#preview-with-seal').addEventListener('click',previewWithSeal);$('#close-preview').addEventListener('click',()=>{if(!completePdfBusy)$('#quote-dialog').close();});
  $('#quote-dialog').addEventListener('cancel',e=>{if(completePdfBusy)e.preventDefault();});
  $('#quote-dialog').addEventListener('close',()=>{if($('#quote-dialog').open)return;cleanAnnex?.();cleanAnnex=null;previewPacket=null;sealSource=null;resetSignedReview();$('#customer-preview').replaceChildren();$('#quote-page-seal').checked=false;refreshProposalControls();});
  $('#quote-jump-annex').addEventListener('click',()=>$('#quote-preview-attachments').scrollIntoView({block:'start'}));
  $('#quote-page-sign-choices').addEventListener('change',e=>{
    if(!e.target.matches('[data-quote-page-sign-kind]'))return;
    $('#quote-page-seal').checked=false;resetSignedReview();
    pdfStatus(chosenSignKinds().length?'请确认本次选中的章签，再生成 PDF。':quotePdfHint);
    refreshProposalControls();
  });
  $('#quote-page-seal').addEventListener('change',()=>{
    if(!$('#quote-page-seal').checked)resetSignedReview();
    pdfStatus($('#quote-page-seal').checked?'已确认本次章签。点击「预览所选章签 PDF」生成并查看。':quotePdfHint);
    refreshProposalControls();
  });
  $('#quote-preview-sealed-pdf').addEventListener('click',reviewSealedPdf);
  $('#quote-download-sealed-pdf').addEventListener('click',downloadSealedPdf);
  $('#quote-download-unsigned-word').addEventListener('click',downloadUnsignedWord);
  $('#quote-complete-pdf').addEventListener('click',downloadCompletePdf);$('#print').addEventListener('click',()=>proposalAction(async()=>{if(!previewPacket)throw Error('缺少两项必带附件');await globalThis.QuotePacket.verifyPair(previewPacket.pair);window.print();}));
  $('#history-list').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.load||b.dataset.delete;const record=records.find(r=>r.id===id);if(!record)return;if(b.dataset.load){if(!confirm('用保存的快照替换当前草稿？'))return;activeRecordId=record.id;restoredNeedsReview=false;state=clone(record.snapshot);resetIntakeView();hydrate();proposalKey=null;refreshProposalControls();restoredNeedsReview=!historyMatches(record);calculateQuote();setView('quote');toast(restoredNeedsReview?'历史快照复算不一致，请先核对':'已恢复第 '+chainVersion(record)+' 版；仅最新版本可另存修订');}else if(!isLinked(record)&&confirm('删除这条本机记录？此操作不可撤销。')){if(persistRecords(records.filter(r=>r.id!==id))){if(activeRecordId===id)activeRecordId=null;renderHistory();}}});
  $('#clear-history').addEventListener('click',()=>{if(confirm('永久删除此浏览器中的全部报价记录？请先导出备份。'))if(persistRecords([])){activeRecordId=null;renderHistory();toast('已删除全部本机报价记录');}});
  // Restore is always a two-step preview/confirmation. Preview never writes storage.
  let importPreview=null, importSerial=0, expectedLegacyRaw=undefined;
  function normalizedImport(text, format){
    const input=JSON.parse(text.charCodeAt(0)===0xFEFF?text.slice(1):text);
    if(!input || Array.isArray(input) || typeof input!=='object')throw Error('备份格式无效');
    if(format==='v2'){if(input.app!=='hengdu-audit-quote-v2'||input.schema!==2)throw Error('请选择新版 v2 备份；旧版需选择 v1 格式');input.app='hengdu-audit-quote';input.schema=1;}
    else if(format!=='v1'||input.app!=='hengdu-audit-quote'||input.schema!==1)throw Error('请选择对应版本的备份文件');
    return JSON.stringify(input);
  }
  function prepareImport(text, format, legacyRaw){
    if(readError)throw Error('本机存储不可安全读取，请先导出原始记录。');
    const raw=localStorage.getItem(STORE);if(raw!==storedRaw){readError=true;storedRaw=raw;renderHistory();throw Error('本机记录已变化，请导出当前记录后刷新页面');}
    const preview=globalThis.QuoteBackup.previewBackup(normalizedImport(text,format),raw);
    if(!preview.mergedRecords.every(validStoredRecord)||!validateChains(preview.mergedRecords))throw Error('备份记录或修订链不能被当前页面安全恢复，未导入');
    importPreview=preview;expectedLegacyRaw=legacyRaw;
    $('#import-backup-status').textContent='预览：备份 '+preview.incomingCount+' 条，本机 '+preview.existingCount+' 条；新增 '+preview.addedCount+' 条，完全相同跳过 '+preview.identicalCount+' 条，冲突 0 条。';
    $('#import-backup-confirm').disabled=preview.addedCount===0;
  }
  function resetImport(message){importPreview=null;expectedLegacyRaw=undefined;$('#import-backup-confirm').disabled=true;$('#import-backup-status').textContent=message;}
  function importFailure(error){resetImport('未导入：'+(error && error.message ? error.message : '读取失败'));}
  $('#import-backup-format').addEventListener('change',()=>{++importSerial;resetImport('备份格式已更改，请重新选择文件。');});
  $('#export-old-raw').addEventListener('click',()=>{try{const raw=localStorage.getItem(LEGACY_STORE);if(raw===null)throw Error('此浏览器没有旧版记录');const blob=new Blob([raw],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='审计报价-旧版原始记录.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('已导出旧版原始存储字符串');}catch(e){toast(e.message||'无法读取旧版记录');}});
  $('#export-old-json').addEventListener('click',()=>{try{const raw=localStorage.getItem(LEGACY_STORE);if(raw===null)throw Error('此浏览器没有旧版记录');const backup=JSON.stringify({app:'hengdu-audit-quote',schema:1,exportedAt:new Date().toISOString(),records:JSON.parse(raw)},null,2);const check=globalThis.QuoteBackup.previewBackup(backup,null);if(!check.mergedRecords.every(validStoredRecord)||!validateChains(check.mergedRecords))throw Error('旧版记录无法安全解析，请导出原始 TXT');download('审计报价-旧版v1备份.json',backup,'application/json;charset=utf-8');toast('已导出旧版 JSON 备份');}catch(e){toast(e.message||'读取旧版失败，请导出原始 TXT');}});
  $('#preview-old-local').addEventListener('click',()=>{++importSerial;resetImport('尚未选择备份。');try{const old=localStorage.getItem(LEGACY_STORE);if(old===null)throw Error('此浏览器没有旧版记录');if(old.length>globalThis.QuoteBackup.MAX_BYTES)throw Error('旧版记录过大');const rows=JSON.parse(old);const text=JSON.stringify({app:'hengdu-audit-quote',schema:1,exportedAt:new Date().toISOString(),records:rows});prepareImport(text,'v1',old);}catch(err){importFailure(err);}});
  $('#import-backup-file').addEventListener('change',e=>{
    const serial=++importSerial, file=e.target.files && e.target.files[0];
    e.target.value='';
    resetImport('尚未选择备份。');
    if(!file)return;
    if(readError){importFailure(Error('本机存储不可安全读取，请先导出原始记录。'));return;}
    if(file.size>globalThis.QuoteBackup.MAX_BYTES){importFailure(Error('文件超过10 MiB，未读取。'));return;}
    const reader=new FileReader();
    reader.onerror=()=>{if(serial===importSerial)importFailure(Error('无法读取文件。'));};
    reader.onload=()=>{
      if(serial!==importSerial)return;
      try{
        if(typeof reader.result!=='string'||reader.result.includes('\uFFFD'))throw Error('文件不是有效 UTF-8 文本');
        prepareImport(reader.result,$('#import-backup-format').value,undefined);
      }catch(err){importFailure(err);}
    };
    reader.readAsText(file,'UTF-8');
  });
  $('#import-backup-confirm').addEventListener('click',()=>{
    const preview=importPreview;if(!preview)return;
    if(!confirm('确认将 '+preview.addedCount+' 条记录合并到此浏览器？现有相同记录将跳过，不覆盖同编号记录。请先导出本机备份。'))return;
    try{
      if(readError||localStorage.getItem(STORE)!==preview.expectedCurrentRaw){readError=true;storedRaw=localStorage.getItem(STORE);renderHistory();throw Error('本机记录已变化，请导出当前记录并刷新后重新预览');}
      if(expectedLegacyRaw!==undefined&&localStorage.getItem(LEGACY_STORE)!==expectedLegacyRaw)throw Error('旧版本机记录已变化，请重新预览');
      if(!persistRecords(clone(preview.mergedRecords)))throw Error('无法安全写入；本次未完成导入');
      const count=preview.addedCount;importSerial++;resetImport('已合并 '+count+' 条记录。请导出一份新备份，妥善保管。');$('#import-backup-file').value='';renderHistory();toast('备份已合并到本机 · 未上传');
    }catch(err){importFailure(err);}
  });
  $('#export-backup').addEventListener('click',()=>{
    try { if(localStorage.getItem(STORE)!==storedRaw){readError=true;storedRaw=localStorage.getItem(STORE);renderHistory();} } catch {readError=true;storageReadable=false;}
    if(readError){
      let raw;
      try {raw=localStorage.getItem(STORE);storageReadable=true;} catch {storageReadable=false;}
      if(!storageReadable || raw===null){toast('无法读取原始记录，未生成备份。请检查浏览器存储权限。');return;}
      // localStorage stores strings, not original file bytes: export the exact stored string, without a BOM or JSON parsing.
      const blob=new Blob([raw],{type:'text/plain;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url;a.download='审计报价-本机存储原始备份.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
      toast('已导出原始本机记录，请妥善保管并联系维护人员');return;
    }
    download('审计报价-本机记录-v2备份.json',JSON.stringify({app:'hengdu-audit-quote-v2',schema:2,exportedAt:new Date().toISOString(),records},null,2),'application/json;charset=utf-8');
  });
  function projectRow(c){return Object.fromEntries(['clientName','location','year','assets','revenue','profit','dataPeriod'].map(k=>[k,c[k]||'']));}
  function normalPlace(place){const id=provinceForLocation(place);return {gx:'广西',hb:'河北',sh:'上海'}[id]||byId(id)?.name||'';}
  function syncList(){
    if(!subjectList)return;
    try{subjectList.syncClient(state.client);state.auditeeRegister=subjectList.snapshot();}catch(err){toast(err.message);}
  }
  function chooseSubject(row,bind){
    const ids=comparisonIds(),c=state.client;
    for(const k of ['clientName','year','assets','revenue','profit'])c[k]=row[k];
    const prevLocation=c.location;c.location=normalPlace(row.location);ids[0]=provinceForLocation(c.location);if(prevLocation!==c.location)ensureRule(ids[0],true);state.comparisonProvinceIds=ids;state.selectedProvince=ids[0];ensureSelected();
    formFill($('#client-form'),c);if(bind)proposalKey=currentProposalKey();update();
  }
  function resetIntakeView(){
    quoteExtras?.clear();batchQuote?.reset();
    tenderTicket++;tenderPending=false;hasTender=false;activeTenderSource=null;intakeChanged=!!state.auditeeRegister;
    $('#tender-file').value='';$('#tender-status').textContent='可选择 Word 文件识别发标方及被审计方。计算草稿保存名单，不保存原函及发标联系方式。';
    const reg=state.auditeeRegister;if(subjectList)subjectList.load(reg?reg.rows:[projectRow(state.client)],reg?reg.active:0);
  }
  function clearBidder(){
    selectedBidder=null;proposalEpoch++;
    $('#proposal-form').elements.firmName.value='';for(const id of ['bidder-contact','bidder-phone','bidder-email'])$('#'+id).value='';
    const team=$('#client-form').elements.team;team.value='';team.dispatchEvent(new Event('input',{bubbles:true}));
    refreshProposalControls();
  }
  function applyBidder(r,meta){
    // apply() receives both the profile and its verified, possibly incomplete certificate set.
    selectedBidder={id:r.id,name:r.name,version:r.version,signingKinds:(meta?.signingKinds||[]).filter(k=>Object.hasOwn(signingLabels,k)),attachments:r.attachments.filter(a=>Object.hasOwn(credentialLabels,a.kind))};$('#proposal-form').elements.firmName.value=r.name;
    $('#bidder-contact').value=r.contactName;$('#bidder-phone').value=r.phone;$('#bidder-email').value=r.email;
    const team=$('#client-form').elements.team;team.value=normalPlace(r.team);team.dispatchEvent(new Event('input',{bubbles:true}));
    proposalEpoch++;refreshProposalControls();
  }
  function connectIntake(){
    if(globalThis.AuditeeRows)subjectList=globalThis.AuditeeRows.mount({getClient:()=>state.client,onSelect:row=>{const linked=(hasTender||subjectList.snapshot().rows.length>1)&&proposalKey===currentProposalKey();chooseSubject(row,linked);},onEdit:()=>{intakeChanged=true;proposalEpoch++;state.auditeeRegister=subjectList.snapshot();refreshProposalControls();}});
    if(globalThis.BidderUI)bidderPicker=globalThis.BidderUI.connect({apply:applyBidder,detach:clearBidder});
    $('#tender-file').addEventListener('change',async function(){
      const file=this.files?.[0];if(!file)return;const ticket=++tenderTicket,epoch=proposalEpoch,status=$('#tender-status');
      tenderPending=true;refreshProposalControls();status.textContent='正在本机识别正文和表格…';
      try{
        if(!globalThis.TenderImport||!subjectList)throw Error('识别组件未加载，请打开完整版本。');
        const found=await globalThis.TenderImport.read(file);if(ticket!==tenderTicket)return;
        if(epoch!==proposalEpoch)throw Error('读取期间表单已改变，请再次选择文件。');
        const keys=['issuer','projectName','contactName','phone','email'],map={issuer:'发标单位',projectName:'项目名称',contactName:'发标方联系人',phone:'联系电话',email:'邮箱'};
        const rows=found.auditees.map(r=>({...r,location:normalPlace(r.location)})),filled=keys.filter(k=>found[k]);
        if(!rows.length&&!filled.length)throw Error('未找到可确认的发标方或被审计方资料。扫描件请改用有文字的 Word 或手工录入。');
        if(rows.length&&!globalThis.AuditeeRows.valid({rows,active:0}))throw Error('主体字段超过表单支持的长度或格式，请人工检查；未改动表单。');
        const missing=keys.filter(k=>!found[k]).map(k=>map[k]);
        if((intakeChanged||hasTender||activeRecordId)&&!confirm('用新文件替换当前发标方信息和被审计方名单？原有手填内容将被替换；未识别字段会留空。')){status.textContent='已取消导入，原有资料未改变。';return;}
        // Do not leave demo / previous project identities next to the new issuer.
        const subjects=rows.length?rows:[projectRow({})];
        batchQuote?.reset();subjectList.load(subjects,0);state.auditeeRegister=subjectList.snapshot();
        chooseSubject(subjects[0],true);formFill($('#proposal-form'),{issuer:found.issuer,projectName:found.projectName,contactName:found.contactName,contactInfo:found.phone});$('#issuer-email').value=found.email;
        quoteExtras?.clear();hasTender=true;activeTenderSource=file;intakeChanged=false;activeRecordId=null;proposalEpoch++;refreshProposalControls();
        status.textContent='已填写 '+filled.length+' / 5 项发标信息，识别到 '+(found.auditeeOverflow?'超过 50 项，仅列出前 50 行':rows.length+' 个被审计方')+'。'+(missing.length?'待补：'+missing.join('、')+'。':'')+(!rows.length?'未识别到主体，请手工录入。':'请逐行核对单位、所在地、金额及数据期间。');
      }catch(err){if(ticket===tenderTicket)status.textContent='未导入，原有资料未改变：'+err.message;}
      finally{if(ticket===tenderTicket){this.value='';tenderPending=false;refreshProposalControls();}}
    });
  }
  sourceList();hydrate();renderHistory();connectProposal();connectIntake();
  if(subjectList&&globalThis.BatchQuote)batchQuote=globalThis.BatchQuote.mount($('#quote-batch'),{getRegister:()=>subjectList.snapshot(),estimateRow:estimateBatchRow,getEstimateKey:batchEstimateKey,getFinal:()=>restoredNeedsReview?null:finalResult,getTax:()=>state.quote.tax,onChange:()=>{proposalEpoch++;refreshProposalControls();},format:fmt});
  refreshProposalControls();connectProjectInitiation();setView('home');
  /* v56 project activity integration begin */
  function activityProject(){
    const visibleValue=selector=>{const node=document.querySelector(selector);return node&&!node.disabled&&node.getClientRects().length?node.value:'';};
    if(view==='project')return document.querySelector('#project-init-form')?.dataset.activityProjectId||document.activeElement?.closest('[data-project-register-id]')?.dataset.projectRegisterId||'';
    if(view==='audit')return visibleValue('#pw-project')||visibleValue('#ac-project');
    if(view==='report')return visibleValue('#report-project');
    if(view==='archive')return visibleValue('#audit-archive-project');
    if(view==='travel')return document.activeElement?.closest('[data-travel-project-id]')?.dataset.travelProjectId||'';
    if(view==='costs')return document.activeElement?.closest('[data-project-cost-id]')?.dataset.projectCostId||'';
    return '';
  }
  if(globalThis.ProjectActivity?.mount)projectActivity=globalThis.ProjectActivity.mount({resolveProject:activityProject});
  /* v56 project activity integration end */

  if(globalThis.QuoteExtras){
    quoteExtras=globalThis.QuoteExtras.mount($('#quote-extras'));
    $('#quote-extras').addEventListener('extraschange',()=>{proposalEpoch++;refreshProposalControls();});
  }
  if(globalThis.BidDocuments)projectFiles=globalThis.BidDocuments.mount($('#bid-files'),{project:fileProject});
  if(globalThis.BidOriginal)globalThis.BidOriginal.mount($('#bid-original-tools'),{project:fileProject,currentTender:()=>activeTenderSource});
  if(globalThis.QuoteWordUI)quoteSigning=globalThis.QuoteWordUI.mount($('#quote-format-tools'),{
    capture:signContext,isCurrent:signContextIsCurrent,apply:emitSignedPacket,
    onChange:message=>{if(message){toast(message);return;}proposalEpoch++;refreshProposalControls();}
  });
  if(globalThis.AuditProgram&&globalThis.ProjectInitiation?.listSaved)auditProgram=globalThis.AuditProgram.mount($('#audit-program'),{listProjects:()=>globalThis.ProjectInitiation.listSaved()});
  if(globalThis.WorkpaperWorkspace&&auditProgram)workpaperWorkspace=globalThis.WorkpaperWorkspace.mount($('#audit-program'));
  if(globalThis.WorkspaceNavigation)workspaceNavigation=globalThis.WorkspaceNavigation.mount({document,setView,getView:()=>view,notify:toast,onReportSection:section=>reportWorkspace?.selectSection?reportWorkspace.selectSection(section):reportWorkspace?.show?.(section)});
  if(globalThis.AppSettings)try{globalThis.AppSettings.applyPreferences(globalThis.AppSettings.readPreferences(),document);}catch{}
  function draftNotice(text,bad=false){const e=$('#page-save-status');if(e){e.textContent=text;e.classList.toggle('error',bad);}}
  async function pageScope(name){
    if(['quote','proposal','bid'].includes(name))return {kind:'quote-input',instanceId:'current-quote'};
    if(name==='rules')return {kind:'fee-rule',recordId:activeRule};
    if(name==='project'){const c=projectInitiation?.capturePending?.();return c?.scope||{kind:'project-register'};}
    if(name==='audit'){const c=await workpaperWorkspace?.capturePending?.();if(c)return c.scope;const project=$('#pw-project')?.value||$('#ac-project')?.value;if(!project)return null;return {kind:'audit-fields',projectId:project,stage:$('.pw-steps [aria-pressed=true]')?.dataset.auditStep||'1'};}
    if(name==='costs')return projectCosts?.draftScope?.()||{kind:'project-costs',instanceId:'current-device'};
    if(name==='travel')return travelExpenses?.draftScope?.()||{kind:'travel-expenses',instanceId:'current-device'};
    if(name==='bidders')return bidderPicker?.draftScope?.()||null;
    if(name==='report'){const project=$('#report-project')?.value;return project?{kind:'report-fields',projectId:project}:null;}
    if(name==='settings')return {kind:'settings-fields',instanceId:'current-device'};
    return {kind:'page-fields',instanceId:name};
  }
  function captureQuoteDraft(){
    syncList();const rows=$$('[data-batch-amount]').map(e=>({row:e.dataset.batchAmount,value:e.value}));
    return {scope:{kind:'quote-input',instanceId:'current-quote'},values:{snapshot:JSON.stringify(state),proposal:formRead($('#proposal-form')),issuerEmail:$('#issuer-email').value,bidderContact:$('#bidder-contact').value,bidderPhone:$('#bidder-phone').value,bidderEmail:$('#bidder-email').value,bidderId:selectedBidder?.id||'',bidderVersion:selectedBidder?.version||0,layouts:JSON.stringify(selectedLayouts()),batchRows:rows}};
  }
  async function restoreQuoteDraft(value){
    if(draftQuoteEpoch.value!==null&&draftQuoteEpoch.value!==proposalEpoch)throw Error('你已修改当前报价，未用旧暂存覆盖新输入。');const next=JSON.parse(value.snapshot||'null');if(!validStoredRecord({id:'temporary',savedAt:new Date().toISOString(),totalCents:0,appVersion:'0.1',snapshot:next,calculation:{quote:{totalCents:0}}}))throw Error('报价暂存格式不兼容，原数据未覆盖。');
    if(!value.proposal||typeof value.proposal!=='object'||Object.values(value.proposal).some(v=>typeof v!=='string'||v.length>2000))throw Error('报价登记暂存字段无效。');
    state=next;activeRecordId=null;restoredNeedsReview=false;hydrate();resetIntakeView();formFill($('#proposal-form'),value.proposal);$('#issuer-email').value=value.issuerEmail||'';$('#bidder-contact').value=value.bidderContact||'';$('#bidder-phone').value=value.bidderPhone||'';$('#bidder-email').value=value.bidderEmail||'';
    selectedBidder=null;if(value.bidderId){let db;try{db=await globalThis.BidderLibrary.open();const bidder=await db.get(value.bidderId);if(!bidder||bidder.version!==value.bidderVersion)throw Error('暂存的事务所版本已更新，请重新选择事务所；手填信息已保留。');selectedBidder={id:bidder.id,name:bidder.name,version:bidder.version,signingKinds:[],attachments:bidder.attachments.filter(a=>Object.hasOwn(credentialLabels,a.kind))};}finally{db?.close?.();}}
    quoteSigning?.restore?.(JSON.parse(value.layouts||'{}'));proposalKey=currentProposalKey();proposalEpoch++;batchQuote?.refresh();for(const row of value.batchRows||[]){const e=$('[data-batch-amount="'+String(row.row).replace(/[^0-9]/g,'')+'"]');if(e&&typeof row.value==='string'){e.value=row.value;e.dispatchEvent(new Event('input',{bubbles:true}));}}refreshProposalControls();
  }
  async function restorePageDraft(name){try{if(name==='project')await projectPageReady;if(name==='audit')await auditPageReady;if(name==='costs')await projectCosts?.ready;if(name==='travel')await travelExpenses?.ready;const storageView=['proposal','bid'].includes(name)?'quote':name;if(storageView==='quote'){if(draftRestored.has('quote-restored'))return;draftRestored.add('quote-restored');draftQuoteEpoch.value=proposalEpoch;}const scope=await pageScope(name);if(!scope)return;const result=await pageDrafts.restore(storageView,{scope});draftQuoteEpoch.value=null;if(view===name&&result.restored)draftNotice('已恢复暂存 · '+new Date(result.savedAt).toLocaleString('zh-CN'));}catch(err){draftQuoteEpoch.value=null;if(view===name)draftNotice(err.message,true);}}
  if(globalThis.PageDrafts)try{
    pageDrafts=globalThis.PageDrafts.create();
    for(const name of ['home','quote','proposal','bid','rules','ledger','project','audit','report','archive','templates','travel','costs','accounting','basics','bidders','settings'])pageDrafts.registerAdapter(name,{
      scope:()=>pageScope(name)||{},
      async capture(){if(['quote','proposal','bid'].includes(name))return captureQuoteDraft();if(name==='project')return projectInitiation?.capturePending?.()||null;if(name==='audit'){const c=await workpaperWorkspace?.capturePending?.();if(c)return c;}if(name==='costs'&&projectCosts?.capturePending)return projectCosts.capturePending();if(name==='travel'&&travelExpenses?.capturePending)return travelExpenses.capturePending();if(name==='bidders'&&bidderPicker?.capturePending)return bidderPicker.capturePending();if(name==='rules'&&$('#rules-form'))return {scope:await pageScope(name),values:{rule:JSON.stringify(ruleDraft),form:JSON.stringify(formRead($('#rules-form'))),tiers:$$('[data-tier]',$('#rules-form')).map(x=>({index:x.dataset.tier,field:x.dataset.field,value:x.value}))}};const scope=await pageScope(name),host=$('#view-'+name);if(!scope||!host)return null;const values=globalThis.PageDrafts.captureFields(host);return values?{scope,values:{fields:values}}:null;},
      async restore(values,meta){if(['quote','proposal','bid'].includes(name))return restoreQuoteDraft(values);if(name==='project')return projectInitiation.restorePending(values,meta);if(name==='audit'&&['workpaper-input','workpaper-directory'].includes(meta.scope.kind))return workpaperWorkspace.restorePending(values,meta);if(name==='costs'&&projectCosts?.restorePending)return projectCosts.restorePending(values,meta);if(name==='travel'&&travelExpenses?.restorePending)return travelExpenses.restorePending(values,meta);if(name==='bidders'&&bidderPicker?.restorePending)return bidderPicker.restorePending(values,meta);if(name==='rules'){if(meta.scope.recordId!==activeRule)throw Error('收费地区已变化，未恢复其他省份的暂存。');const rule=JSON.parse(values.rule);if(!rule||rule.id!==activeRule||!Array.isArray(rule.tiers))throw Error('规则暂存格式不匹配。');ruleDraft=rule;renderRules(true);formFill($('#rules-form'),JSON.parse(values.form));for(const t of values.tiers){const node=$('[data-tier="'+String(t.index).replace(/[^0-9]/g,'')+'"][data-field="'+String(t.field).replace(/[^a-zA-Z]/g,'')+'"]',$('#rules-form'));if(node)node.value=t.value;}return {restored:1};}if(globalThis.PageDrafts.scopeKey(name,await pageScope(name)||{})!==globalThis.PageDrafts.scopeKey(name,meta.scope))throw Error('项目或页面范围已变化，未恢复旧字段。');return globalThis.PageDrafts.restoreFields($('#view-'+name),values.fields);}
    });
    $('#page-save').onclick=async()=>{const name=['proposal','bid'].includes(view)?'quote':view,b=$('#page-save');if(b.disabled)return;b.disabled=true;try{if(name==='costs')await projectCosts?.ready;if(name==='travel')await travelExpenses?.ready;const result=await pageDrafts.checkpoint(name);if(result.saved){draftNotice('已暂存 · '+new Date(result.savedAt).toLocaleString('zh-CN')+' · 仅本机');toast('已暂存输入；不等于登记、核对或签发。');}else draftNotice('暂无未提交输入；已上传资料以页面原保存状态为准。');}catch(err){draftNotice(err.message,true);toast('暂存未完成：'+err.message);}finally{b.disabled=false;}};
    draftRestored.add('quote');void restorePageDraft('quote');
  }catch(err){draftNotice('暂存不可用：'+err.message,true);}
  syncDocumentScope();refreshProposalControls();
})();
