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
  let importedTender=null;
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
  function ruleNameMatches(rule) { const p=byId(rule.id); if(!p || typeof rule.name!=='string')return false; const shortName=provinceShortName(p.name); return rule.name===p.name || rule.name===shortName; }
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

  function toast(message) {
    const note=$('#toast');
    note.textContent=message;
    note.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>note.classList.remove('show'),3500);
  }
  const saveResultDialog=$('#save-result-dialog'),pendingSaveResults=[];
  function showNextSaveResult(){
    if(saveResultDialog.open||!pendingSaveResults.length)return;
    const {state,message,operation}=pendingSaveResults.shift();
    saveResultDialog.dataset.state=state;
    const title=['导出','暂存','下载'].includes(operation)?operation:'保存';
    $('#save-result-title').textContent=title+(state==='failed'?'失败':title==='下载'?'已发起':'成功');
    $('#save-result-message').textContent=message;
    saveResultDialog.showModal();
  }
  saveResultDialog.addEventListener('close',showNextSaveResult);
  document.addEventListener('shenyi:save-result',({detail})=>{
    if(!detail||!['saved','failed'].includes(detail.state)||typeof detail.message!=='string')return;
    pendingSaveResults.push(detail);
    showNextSaveResult();
  });
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
  const ESTIMATE_PREFIX = 'hengdu.audit.quote.estimates.v1.';
  const ESTIMATE_OUTCOME_PREFIX = 'hengdu.audit.quote.estimate-outcome.v1.';
  const INQUIRY_CLEARED_AT='hengdu.audit.quote.inquiry-cleared-at';
  const ESTIMATE_DELETION_PREFIX = 'hengdu.audit.quote.estimate-row-deleted.v1.';
  const estimateDeletionKey=(id,index)=>ESTIMATE_DELETION_PREFIX+JSON.stringify([id,index]);
  const estimateTrashIcon=$('#clear-inquiry svg').outerHTML;
  const ESTIMATE_TAX_RATES = ['1','3','6'];
  const projectTypeLabel=value=>globalThis.ProjectWorkspaceStore?.projectTypeLabel?.(value)??value;
  const estimateProjectTypes = [...$('#project-type').options].map(option=>option.textContent);
  const estimateOutcomeNames = {won:outcomeNames.won,lost:outcomeNames.lost,pending:'待确认'};
  const estimateFilters = new Map();
  const estimateFilterMenu = $('#estimate-filter-menu');
  const estimateFilterSearch = $('#estimate-filter-search');
  const estimateFilterOptions = $('#estimate-filter-options');
  const estimateFilterForm = $('#estimate-filter-form');
  const estimateFilterValue = $('#estimate-filter-value');
  const estimateFilterButtons = [];
  const estimatePagination=$('#estimate-pagination');
  estimatePagination.prepend($('#record-page-size-control').content.cloneNode(true));
  const estimatePageSize=estimatePagination.querySelector('select');
  const estimatePageButtons=estimatePagination.querySelector('.record-page-buttons');
  const estimateScroll=$('.quote-estimates-scroll');
  let estimateFilterAnchor = null, estimateRows = [], estimatePage=1;
  let latestRegionalEstimate=null,regionalRecordSaved=false,quoteReferenceFile=null,roundingCarry=null;
  let estimateProjectNumbers=new Map(),estimateNumbersTicket=0;
  const PROJECT_CODE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  let estimateOutcomeBusy = false;
  function provinceShortName(name) {
    return name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/, '');
  }
  function typedProvince(value) {
    const name = value.normalize('NFKC').trim();
    return provinces.find(p => p.name === name || provinceShortName(p.name) === name);
  }
  function legacyEstimateCode(id) {
    // Earlier rows used four random 32-bit words. Keep a stable display code without rewriting them.
    const words = id.split('-');
    if (words.length !== 4 || words.some(word => !/^\d{1,10}$/.test(word) || Number(word) > 0xffffffff)) return '';
    const hex = words.map(word => Number(word).toString(16).padStart(8, '0')).join('');
    const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${variant}${hex.slice(17,20)}-${hex.slice(20)}`;
  }
  function readEstimates() {
    const records = [], deletedRows = new Set();
    let unreadable = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(ESTIMATE_DELETION_PREFIX)) deletedRows.add(key);
        if (!key?.startsWith(ESTIMATE_PREFIX)) continue;
        try {
          const record = JSON.parse(localStorage.getItem(key));
          if (!byId(record?.provinceId) || !Number.isFinite(record.createdAt)) throw Error();
          const id = key.slice(ESTIMATE_PREFIX.length);
          const code = PROJECT_CODE.test(record.projectCode) ? record.projectCode : legacyEstimateCode(id);
          records.push({...record, code, id});
        } catch { unreadable = true; }
      }
    } catch { unreadable = true; }
    records.sort((a, b) => b.createdAt - a.createdAt);
    return {records, unreadable, deletedRows};
  }
  function estimateProjectKey(issuer, project, year, customers = []) {
    const names = [issuer, coreProjectName(project)].map(value => value.normalize('NFKC').trim());
    const audited = [...new Set(customers.filter(name=>typeof name==='string').map(name=>name.normalize('NFKC').trim()).filter(Boolean))].sort();
    return names.every(Boolean) && /^\d{4}$/.test(String(year)) ? JSON.stringify([...names, String(year), audited]) : '';
  }
  function coreProjectName(value) {
    const name=(value||'').trim();
    const match=/((?:19|20)\d{2})\s*年(?:度)?\s*(财务决算审计|财务报表审计|财务审计|年报审计|专项审计|经济责任审计)(?:服务)?(?:项目)?[。.]?$/.exec(name);
    if(!match||new Set(name.match(/(?:19|20)\d{2}/g)).size>1)return name;
    return match[1]+'年'+match[2];
  }
  function matchingEstimateCode(key, totalCents) {
    if (!key) return '';
    const {records,deletedRows} = readEstimates();
    const matching = new Set(records.filter(row => {
      if (!row.code || !row.projectKey) return false;
      if (row.projectKey === key) return true;
      try {
        const [issuer,project,year,audited] = JSON.parse(row.projectKey);
        return estimateProjectKey(issuer,project,year,audited || row.auditeeQuotes?.map(line=>line.name) || [estimateCustomerName(row)]) === key;
      } catch { return false; }
    }));
    const rows = estimateRecordRows(records).filter(row=>row.code&&!row.multiUnit&&matching.has(row.record)&&
      !deletedRows.has(estimateDeletionKey(row.record.id,row.index)));
    const exact = rows.filter(row=>row.unit.cents===totalCents);
    const candidates = exact.length?exact:rows;
    const winners = candidates.filter(({code})=>readEstimateOutcome(code)==='won');
    return winners.length===1?winners[0].code:candidates.length===1?candidates[0].code:'';
  }
  function readEstimateDecision(code) {
    try {
      const raw = localStorage.getItem(ESTIMATE_OUTCOME_PREFIX + code);
      if (['won','lost'].includes(raw)) return {outcome:raw};
      return JSON.parse(raw) || {};
    } catch { return {}; }
  }
  function readEstimateOutcome(code) { return readEstimateDecision(code).outcome || ''; }
  function writeEstimateDecision({code,record,unit}, outcome) {
    const previous = readEstimateDecision(code), changedAt = new Date().toISOString();
    const decision = {...previous,outcome,changedAt};
    if (outcome === 'won' && !decision.awardedAt) {
      const year = Number(record.auditYear);
      decision.awardedAt = changedAt;
      decision.snapshot = {
        origin:'estimate', projectName:record.project || '', issuer:record.issuer || '',
        customerName:unit.name, firmName:record.firm || (latestRegionalEstimate?.id===record.id?selectedBidder?.name:'') || '',
        auditYear:Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : null,
        quoteDate:record.date || todayShanghai(), totalCents:Number.isSafeInteger(unit.cents) ? unit.cents : null,
        projectType:record.projectType || '', riskLevel:record.riskLevel || '', contactName:record.contact || '',
        contactInfo:[record.phone,record.email].filter(Boolean).join(' / '), taxRateText:record.taxRate || ''
      };
    }
    localStorage.setItem(ESTIMATE_OUTCOME_PREFIX + code, JSON.stringify(decision));
  }
  function projectEntry(code, formal) {
    const decision = readEstimateDecision(code);
    if (!decision.snapshot || !decision.awardedAt) return formal;
    const first = {eventNo:1,outcome:'won',recordedAt:decision.awardedAt};
    const latest = formal?.events.at(-1) || {outcome:decision.outcome,recordedAt:decision.changedAt};
    const events = latest.outcome === 'won' ? [first] : [first,{...latest,eventNo:2}];
    const snapshot = {...decision.snapshot};
    if (formal) {
      // Retain the original award identity while filling gaps from the same registered quote.
      for (const key of ['firmName','contactName','contactInfo','riskLevel','taxRateText']) if (!snapshot[key]) snapshot[key]=formal.snapshot[key] || '';
      if (formal.snapshot.bidderContact && formal.snapshot.firmName === snapshot.firmName) snapshot.bidderContact = formal.snapshot.bidderContact;
    }
    return {id:code,lastEventNo:events.length,events,snapshot};
  }
  function withEstimateOutcome(code, work) {
    return code && globalThis.navigator.locks
      ? globalThis.navigator.locks.request(ESTIMATE_OUTCOME_PREFIX + code, work) : work();
  }
  function estimateCustomerName(record, entry) {
    if (Object.hasOwn(record,'customerName')) return record.customerName || '';
    return entry?.snapshot.quoteRows?.map(row=>row.name).join('、').slice(0,200) ||
      entry?.snapshot.customerName || /^被审计方：(.+?)。/.exec(record.detail||'')?.[1] || '';
  }
  function estimateRecordRows(records, registered=new Map()) {
    const counts=new Map();
    const rows=records.flatMap(record=>{
      const quotes=record.auditeeQuotes;
      const multiUnit=Array.isArray(quotes)&&quotes.length>1&&quotes.length<=50&&quotes.every(line=>line&&typeof line.name==='string');
      const units=regionalQuoteLines(record,record.finalQuotes,multiUnit?null:estimateCustomerName(record,registered.get(record.code)));
      counts.set(record.code,(counts.get(record.code)||0)+units.length);
      return units.map((unit,index)=>({record,unit,index,multiUnit}));
    });
    const claimed=new Set(records.map(record=>record.code).filter(Boolean));
    for(const row of rows){
      const {record,index}=row;
      if(record.code&&counts.get(record.code)===1){row.code=record.code;continue;}
      // Old decisions keyed to a shared code cannot identify the selected row.
      // Derive stable codes from the saved measurement ID and unit position.
      const id=PROJECT_CODE.test(record.id)?record.id:legacyEstimateCode(record.id);
      const suffix=id?(parseInt(id.slice(-2),16)^index).toString(16).padStart(2,'0'):'';
      const code=id?id.slice(0,-2)+suffix:'';
      row.code=code&&!claimed.has(code)?code:'';
      if(row.code)claimed.add(row.code);
    }
    return rows;
  }
  async function bidProjectEntries(){
    if(!deliveryStore)await deliveryReady;
    if(!deliveryStore)throw Error('本机报价台账暂不可用；请稍候重新进入。');
    const formal=new Map((await deliveryStore.list()).map(entry=>[entry.id,entry]));
    const ids=new Set([...formal.keys(),...estimateRecordRows(readEstimates().records,formal).map(row=>row.code).filter(Boolean)]);
    return [...ids].map(code=>projectEntry(code,formal.get(code))).filter(Boolean);
  }
  function relevantBidProjects(records,entries){
    const estimateRows=estimateRecordRows(readEstimates().records);
    const grouped=new Set(estimateRows.filter(row=>row.record.code!==row.code).map(row=>row.record.code));
    return records.filter(({quoteId,source})=>{
      const entry=entries.get(quoteId);
      const won=entry?entry.events.at(-1)?.outcome==='won':readEstimateDecision(quoteId).outcome!=='lost';
      return won&&!(source.origin==='estimate'&&grouped.has(quoteId));
    });
  }
  async function listBidProjects(){
    const [records,entries]=await Promise.all([globalThis.ProjectInitiation.listSaved(),bidProjectEntries()]);
    const byId=new Map(entries.map(entry=>[entry.id,entry]));
    return relevantBidProjects(records,byId).map(record=>{
      const entry=byId.get(record.quoteId);
      return entry?{...record,source:{...record.source,totalCents:entry.snapshot.totalCents,riskLevel:entry.snapshot.riskLevel}}:record;
    });
  }
  async function refreshEstimateProjectNumbers(){
    const ticket=++estimateNumbersTicket,S=globalThis.ProjectWorkspaceStore;
    if(!S?.ensureProjectNumbers)return;
    const formal=new Map(ledgerRows.map(entry=>[entry.id,entry]));
    const rows=estimateRecordRows(readEstimates().records,formal).filter(row=>row.code);
    const won=rows.filter(row=>(formal.get(row.code)?.events.at(-1)?.outcome||readEstimateOutcome(row.code))==='won');
    if(!won.length){estimateProjectNumbers=new Map();return;}
    const saved=await globalThis.ProjectInitiation.listSaved();
    const candidates=new Map(saved.map(record=>[record.quoteId,record.source.wonAt??record.createdAt]));
    for(const code of new Set([...formal.keys(),...rows.map(row=>row.code)])){
      const first=projectEntry(code,formal.get(code))?.events.find(event=>event.outcome==='won');
      if(first)candidates.set(code,first.recordedAt);
    }
    if(candidates.size)await S.ensureProjectNumbers([...candidates].map(([projectId,firstWonAt])=>({projectId,firstWonAt})));
    const results=await Promise.all(won.map(async row=>{
      const workspace=await S.get(row.code),entry=projectEntry(row.code,formal.get(row.code));
      const type=workspace.projectClassification?.projectType??entry?.snapshot.projectType??row.record.projectType;
      const risk=workspace.projectRegister?.riskLevel??entry?.snapshot.riskLevel??row.record.riskLevel;
      return [row.code,S.projectCode(workspace.projectIdentity,risk,type)];
    }));
    if(ticket===estimateNumbersTicket)estimateProjectNumbers=new Map(results);
  }
  function regionalQuoteLines(record,overrides=record.finalQuotes,singleName=null) {
    const lines=singleName===null&&Array.isArray(record.auditeeQuotes)?record.auditeeQuotes:
      [{name:singleName??record.customerName,cents:record.cents,reason:record.pending}];
    return lines.map((line,i)=>{
      const measuredCents=hasEstimatePrice(line.cents)?line.cents:null;
      const finalCents=hasEstimatePrice(overrides?.[i])?overrides[i]:null;
      return {...line,measuredCents,finalCents,cents:finalCents??measuredCents};
    });
  }
  function regionalQuoteTotal(lines) {
    const priced=lines.filter(line=>hasEstimatePrice(line.cents)).length;
    const sum=lines.reduce((total,line)=>total+BigInt(line.cents??0),0n);
    const overflow=sum>BigInt(Number.MAX_SAFE_INTEGER);
    return {priced,overflow,totalCents:priced===lines.length&&!overflow?Number(sum):null};
  }
  function auditeeEstimateTable(lines,editable) {
    return `<div class="table-scroll"><table class="estimate-detail-table">
      <thead><tr><th scope="col">被审计单位</th><th scope="col">含税报价</th><th scope="col">最终报价（元）</th></tr></thead>
      <tbody>${lines.map((line,i) => {
        const name=line.name||'单位名称待补',amount=hasEstimatePrice(line.cents)?decimalCents(line.cents):'';
        return `<tr><th scope="row">${esc(name)}</th><td>${esc(line.reason||(hasEstimatePrice(line.measuredCents)?fmt(line.measuredCents):'—'))}</td>
          <td>${editable?`<input class="estimate-final-price" type="text" inputmode="decimal" maxlength="22" autocomplete="off"
            aria-label="${esc(name)}的最终报价（元）" data-final-quote="${i}" data-record-amount="${amount}" value="${amount}" placeholder="待填写"${line.name?'':' disabled'}>`:'—'}</td></tr>`;
      }).join('')}</tbody>
      </table></div>`;
  }
  function readRegionalPrices(record=latestRegionalEstimate) {
    const measured=regionalQuoteLines(record),overrides=[],inputs=$$('#estimate-details [data-final-quote]');
    let invalid=null,error='';
    for(const [i,input] of inputs.entries()){
      const value=input.value.normalize('NFKC').trim().replace(/^(\d{1,3}(?:,\d{3})+)(\.\d{1,2})?$/u,(_,whole,fraction='')=>whole.replaceAll(',','')+fraction);
      let amount=null,message='';
      try{if(value&&!input.disabled)amount=C.money(value);}catch(e){message=e.message;}
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid',String(!!message));
      if(message&&!invalid){invalid=input;error=(measured[i].name||'未命名单位')+'的最终报价：'+message;}
      overrides.push(amount===measured[i].measuredCents?null:amount);
    }
    const lines=regionalQuoteLines(record,overrides);
    return {lines,overrides,error,...regionalQuoteTotal(lines)};
  }
  function refreshRegionalPrices() {
    if(!latestRegionalEstimate)return;
    const result=readRegionalPrices();
    const inputs=$$('#estimate-details [data-final-quote]');
    for(const [i,input] of inputs.entries()){
      const cents=input.validity.valid?result.lines[i].cents:null;
      input.dataset.recordAmount=hasEstimatePrice(cents)?decimalCents(cents):'';
    }
    const note=$('#estimate-final-status');
    const error=result.error||(result.overflow?'最终报价合计超出可处理范围。':'');
    note.textContent=error;
    const count=result.lines.length,manual=result.overrides.some(hasEstimatePrice);
    $('#estimate-result').value=error?'待核对':hasEstimatePrice(result.totalCents)?fmt(result.totalCents):
      count>1?`${result.priced}/${count} 家已${manual?'报价':'测算'}`:'待测算';
    const unchanged=regionalRecordSaved&&result.lines.every((line,i)=>(latestRegionalEstimate.finalQuotes?.[i]??null)===line.finalCents);
    $('#estimate-record-save').disabled=!!error||unchanged;
    return result;
  }
  function showRegionalResult(record = null, saved = false) {
    if(record!==latestRegionalEstimate)proposalEpoch++;
    latestRegionalEstimate=record;
    regionalRecordSaved=saved;
    $('#estimate-record-save').disabled=true;
    roundingCarry=null;
    const details = $('#estimate-details');
    const subjects=subjectList?.snapshot().rows||[],inquiry=$('#inquiry-text').value.trim();
    $('#inquiry-source-note').hidden=!(inquiry&&(hasTender||importedTender||subjects.length>1));
    const lines=record?regionalQuoteLines(record):
      !inquiry&&subjects.length>1?subjects.map(row=>({name:row.clientName,reason:'待测算'})):[];
    details.hidden=!lines.length;
    details.innerHTML=details.hidden?'':auditeeEstimateTable(lines,!!record);
    $('#estimate-result').value='—';
    $('#estimate-final-status').textContent='';
    refreshRegionalPrices();
    refreshProposalControls();
  }
  function saveRegionalRecord() {
    const record=latestRegionalEstimate;
    if(!record)return;
    try{
      const result=readRegionalPrices(record);
      if(result.error||result.overflow)throw Error(result.error||'最终报价合计超出可处理范围。');
      const key=ESTIMATE_PREFIX+record.id,stored=JSON.parse(localStorage.getItem(key));
      const oldLines=regionalQuoteLines(record);
      if(regionalRecordSaved ? !stored||stored.projectCode!==record.projectCode||
        regionalQuoteLines(stored).some((line,i)=>line.finalCents!==oldLines[i]?.finalCents) : stored!==null)
        throw Error('本机报价记录已变化，请重新测算。');
      const {id,code,...data}=record;
      const next={...(stored||data),...(!stored?{firm:$('#proposal-form').elements.firmName.value.trim()}:{}),finalQuotes:result.overrides};
      localStorage.setItem(key,JSON.stringify(next));
      latestRegionalEstimate={...next,id,code};
      regionalRecordSaved=true;
      refreshRegionalPrices();
      estimatePage=1;
      estimateScroll.scrollTop=0;
      renderEstimates();
      showRegionMessage(byId(record.provinceId).name+' · 已记录'+(record.pending?' · 待测算：'+record.pending:''));
      SaveFeedback.saved('报价记录已保存到本机。');
    }catch(error){showRegionMessage(SaveFeedback.failed(error,'无法保存报价记录。'),true);}
  }
  function restoreInquiry(draft) {
    const oldFields={clientName:'被审计单位',project:'项目名称',issuer:'询价单位',type:'项目类型',year:'审计年度',assets:'资产总额',revenue:'营业收入'};
    $('#inquiry-text').value=typeof draft?.text==='string'?draft.text:Object.entries(oldFields)
      .filter(([key])=>draft?.['inquiry-'+key]?.trim())
      .map(([key,label])=>label+'：'+draft['inquiry-'+key]+(['assets','revenue'].includes(key)?'万元':'')).join('，');
  }
  function inquiryAmounts(inquiry,rule) {
    const amounts={};
    for(const [key,label] of [['assets','资产总额'],['revenue','营业收入']]){
      if(!inquiry[key]){
        if(rule.mode!=='fixed'&&(rule.basis===key||!['assets','revenue'].includes(rule.basis)))throw Error('请填写'+label+'（万元）。');
        amounts[key]='0';
      }else{
        let value=inquiry[key].normalize('NFKC');
        if(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value))value=value.replaceAll(',','');
        try{amounts[key]=wanToYuan(value);}catch(error){throw Error(label+'：'+error.message);}
      }
    }
    return amounts;
  }
  function closeEstimateFilter(restoreFocus=false){
    if(!estimateFilterAnchor)return;
    const anchor=estimateFilterAnchor;
    estimateFilterAnchor=null;
    estimateFilterMenu.hidden=true;
    anchor.setAttribute('aria-expanded','false');
    if(restoreFocus)anchor.focus({preventScroll:true});
  }
  function renderEstimateFilterOptions(){
    const column=estimateFilterAnchor?.dataset.column;
    if(!column||estimateFilterOptions.hidden)return;
    const selected=estimateFilters.get(column);
    const normalize=value=>value.normalize('NFKC').trim().toLowerCase();
    const keyword=normalize(estimateFilterSearch.value);
    const values=column==='type'?estimateProjectTypes:column==='outcome'?Object.values(estimateOutcomeNames)
      : [...new Set(estimateRows.map(row=>row.values[column]))]
        .filter(value=>!keyword||normalize(value).includes(keyword))
        .sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
    const nodes=document.createDocumentFragment();
    const add=(value,label)=>{
      const button=document.createElement('button');
      button.type='button';
      button.dataset.value=value;
      button.setAttribute('aria-pressed',String(value===selected||value===''&&!estimateFilters.has(column)));
      button.textContent=label;
      nodes.append(button);
    };
    add('','全部');
    for(const value of values)add(value,value==='—'?'空白（—）':value);
    if(!values.length){
      const empty=document.createElement('p');
      empty.className='muted';empty.textContent=keyword?'没有匹配的选项':'暂无记录';
      nodes.append(empty);
    }
    estimateFilterOptions.replaceChildren(nodes);
  }
  function positionEstimateFilter(){
    if(!estimateFilterAnchor)return;
    const anchor=estimateFilterAnchor.getBoundingClientRect();
    const scroll=estimateFilterAnchor.closest('.quote-estimates-scroll').getBoundingClientRect();
    if(anchor.width&&(anchor.right<=scroll.left||anchor.left>=scroll.right||anchor.bottom<=0||anchor.top>=innerHeight)){
      closeEstimateFilter();return;
    }
    const menu=estimateFilterMenu.getBoundingClientRect();
    const left=Math.max(8,Math.min(Math.max(anchor.left,scroll.left),innerWidth-menu.width-8));
    const top=anchor.bottom+5+menu.height<=innerHeight-8?anchor.bottom+5:Math.max(8,anchor.top-menu.height-5);
    estimateFilterMenu.style.left=left+'px';
    estimateFilterMenu.style.top=top+'px';
  }
  function openEstimateFilter(button){
    if(estimateFilterAnchor===button){closeEstimateFilter(true);return;}
    closeEstimateFilter();
    estimateFilterAnchor=button;
    $('#estimate-filter-title').textContent=button.dataset.label;
    const column=button.dataset.column, isDate=column==='date', isAmount=column==='amount';
    estimateFilterForm.hidden=!isDate&&!isAmount;
    estimateFilterOptions.hidden=!estimateFilterForm.hidden;
    estimateFilterSearch.hidden=estimateFilterOptions.hidden||column==='type'||column==='outcome';
    estimateFilterSearch.value='';
    if (estimateFilterForm.hidden) renderEstimateFilterOptions();
    else {
      const value=estimateFilters.get(column);
      $('#estimate-filter-value-label').textContent=isDate?'报价日期（年/月/日）':'最低含税价格（元）';
      estimateFilterValue.type=isDate?'date':'text';
      estimateFilterValue.inputMode=isDate?'':'decimal';
      estimateFilterValue.placeholder=isDate?'':'例如 30000';
      estimateFilterValue.value=value===undefined?'':isDate?value:decimalCents(value);
      estimateFilterValue.setCustomValidity('');
    }
    button.setAttribute('aria-expanded','true');
    estimateFilterMenu.hidden=false;
    positionEstimateFilter();
    if(estimateFilterAnchor){
      const focusTarget=!estimateFilterForm.hidden?estimateFilterValue:estimateFilterSearch.hidden
        ?estimateFilterOptions.querySelector('[aria-pressed=true]'):estimateFilterSearch;
      focusTarget?.focus({preventScroll:true});
    }
  }
  function setEstimateFilter(value){
    const column=estimateFilterAnchor?.dataset.column;
    if (!column) return;
    if (value==='') estimateFilters.delete(column);
    else estimateFilters.set(column,value);
    closeEstimateFilter(true);
    estimatePage=1;
    estimateScroll.scrollTop=0;
    renderEstimates();
  }
  const hasEstimatePrice = cents => Number.isSafeInteger(cents) && cents >= 0;
  function matchesEstimateFilter({unit,values},column,value){
    if (column==='amount') return hasEstimatePrice(unit.cents)&&unit.cents>=value;
    if (column==='type'&&value==='其他'&&values.type!=='—') return !estimateProjectTypes.includes(values.type)||values.type===value;
    return values[column]===value;
  }
  function renderEstimatePagination(pageCount){
    const first=pageCount<=7?2:Math.min(Math.max(2,estimatePage-2),pageCount-5);
    const last=pageCount<=7?pageCount-1:Math.min(first+4,pageCount-1);
    const pages=[1];
    if(first>2)pages.push(null);
    for(let page=first;page<=last;page++)pages.push(page);
    if(last<pageCount-1)pages.push(null);
    if(pageCount>1)pages.push(pageCount);
    const button=(label,page,disabled=false,current=false)=>
      `<button type="button" class="btn" data-estimate-page="${page}"${disabled?' disabled':''}${current?' aria-current="page"':''}>${label}</button>`;
    estimatePageButtons.innerHTML=button('上一页',estimatePage-1,estimatePage===1)+pages.map(page=>page===null
      ?'<span aria-hidden="true">…</span>':button(page,page,false,page===estimatePage)).join('')+button('下一页',estimatePage+1,estimatePage===pageCount);
  }
  function renderEstimates() {
    const {records, unreadable, deletedRows} = readEstimates();
    const registered = new Map(ledgerRows.map(entry => [entry.id, entry]));
    const cellValue = value => String(value || '—');
    // Assign project codes before filtering so removing one unit cannot renumber its siblings.
    const listed=estimateRecordRows(records,registered).filter(row=>!deletedRows.has(estimateDeletionKey(row.record.id,row.index)));
    const allRows = listed.map(row=>{
      const entry = registered.get(row.code);
      const result = entry ? entry.events.at(-1)?.outcome : readEstimateOutcome(row.code);
      const outcome = Object.hasOwn(estimateOutcomeNames,result) ? result : 'pending';
      return {...row,outcome};
    });
    estimateRows = allRows.map((row,i)=>{
      const {record,unit,outcome}=row;
      return {...row,values:{
        number:String(allRows.length-i),date:cellValue(record.date),code:estimateProjectNumbers.get(row.code)||'待核对项目编码',auditee:cellValue(unit.name),
        firm:cellValue(outcome==='won'?projectEntry(row.code,registered.get(row.code))?.snapshot.firmName||record.firm:record.firm),
        project:cellValue(coreProjectName(record.project)),type:cellValue(record.projectType==='内控审计'?'内控测试':projectTypeLabel(record.projectType)),region:byId(record.provinceId).name,
        amount:hasEstimatePrice(unit.cents)?fmt(unit.cents):cellValue(unit.reason||'待测算'),outcome:estimateOutcomeNames[outcome],
        contact:cellValue(record.contact),phone:cellValue(record.phone),email:cellValue(record.email)
      }};
    });
    const filters=[...estimateFilters],filtering=filters.length>0;
    const rows=filtering?estimateRows.filter(row=>filters.every(([key,value])=>matchesEstimateFilter(row,key,value))):estimateRows;
    const pageSize=Number(estimatePageSize.value);
    const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
    estimatePage=Math.min(estimatePage,pageCount);
    const firstRow=(estimatePage-1)*pageSize;
    const visibleRows=rows.slice(firstRow,firstRow+pageSize);
    renderEstimatePagination(pageCount);
    $('#estimate-filter-clear').disabled = !filtering;
    for(const button of estimateFilterButtons){
      const value=estimateFilters.get(button.dataset.column);
      button.toggleAttribute('data-filter-active',value!==undefined);
      const description=button.dataset.column==='amount'&&value!==undefined?fmt(value)+'及以上':value;
      button.title=value===undefined?button.dataset.label:button.dataset.label+' · '+description;
    }
    renderEstimateFilterOptions();
    $('#quote-estimates-status').textContent = unreadable
      ? '有测算记录无法读取。'
      : filtering ? `显示 ${rows.length} / ${allRows.length} 条` : `${rows.length} 条`;
    const priced = rows.filter(({unit})=>hasEstimatePrice(unit.cents));
    const total = priced.reduce((sum,{unit})=>sum+BigInt(unit.cents),0n);
    const totalText = `¥ ${(total/100n).toLocaleString('en-US')}.${String(total%100n).padStart(2,'0')}`;
    const pending = rows.length - priced.length;
    $('#quote-estimates-total').textContent = priced.length || !rows.length ? totalText : '—';
    $('#quote-estimates-total-note').textContent = pending ? `（${pending} 条待测算）` : '';
    const cell = value => `<td>${esc(value)}</td>`;
    $('#quote-estimates-rows').innerHTML = visibleRows.length ? visibleRows.map(({record,unit,index,code,outcome,values}) => {
      const {id,detail} = record;
      const codeText = `<code>${esc(values.code)}</code>`;
      const codeLink = outcome === 'won' && PROJECT_CODE.test(code)
        ? `<a href="#project-initiation" data-project-info="${esc(code)}" data-estimate-id="${esc(id)}" title="打开立项信息表">${codeText}</a>` : '';
      const options = ['won','lost'].map(value => `<option value="${value}"${outcome === value ? ' selected' : ''}>${estimateOutcomeNames[value]}</option>`).join('');
      const selector = `<select data-estimate-outcome="${esc(code)}" data-estimate-id="${esc(id)}" aria-label="${esc(unit.name || record.project || values.region)}的投标结果" ${!code || estimateOutcomeBusy ? 'disabled' : ''}><option value="" disabled${['won','lost'].includes(outcome) ? '' : ' selected'}>${esc(values.outcome)}</option>${options}</select>`;
      const deleteLabel=esc('删除'+(unit.name||record.project||'第'+values.number+'行')+'的招投标记录');
      const trash=`<button type="button" class="btn quote-clear estimate-delete" data-estimate-id="${esc(id)}" data-delete-unit="${index}" aria-label="${deleteLabel}" title="${deleteLabel}"${estimateOutcomeBusy?' disabled':''}>${estimateTrashIcon}</button>`;
      return `<tr>${cell(values.number)}${cell(values.date)}<td class="quote-estimates-code">${codeLink}</td>${cell(values.auditee)}${cell(values.firm)}${cell(values.project)}${cell(values.type)}${cell(values.region)}<td class="quote-record-amount" title="${esc(detail)}">${esc(values.amount)}</td><td><div class="estimate-outcome-actions">${selector}${trash}</div></td>${cell(values.contact)}${cell(values.phone)}${cell(values.email)}</tr>`;
    }).join('') : `<tr><td colspan="13" class="quote-estimates-empty">${filtering ? '没有符合筛选条件的记录' : '暂无测算记录'}</td></tr>`;
  }
  function deleteEstimateRow(event) {
    const button=event.target.closest('button[data-delete-unit]');
    if(!button||estimateOutcomeBusy)return;
    const row=estimateRows.find(({record,index})=>record.id===button.dataset.estimateId&&index===Number(button.dataset.deleteUnit));
    if(!row)return;
    const key=estimateDeletionKey(row.record.id,row.index),status=$('#estimate-outcome-status');
    const token=crypto.randomUUID();
    try{
      localStorage.setItem(key,token);
      renderEstimates();
      const undo=document.createElement('button');
      undo.type='button';undo.className='btn';undo.textContent='撤销删除';
      undo.onclick=()=>{
        try{
          if(localStorage.getItem(key)===token)localStorage.removeItem(key);
          renderEstimates();
          status.textContent=localStorage.getItem(key)?'该记录已在其他页面重新删除。':'已恢复招投标记录。';
        }catch(error){status.textContent='恢复失败：'+error.message;}
      };
      status.replaceChildren('已删除'+(row.unit.name?'「'+row.unit.name+'」的':'该条')+'招投标记录。',undo);
    }catch(error){status.textContent='删除失败：'+error.message;}
  }
  async function changeEstimateOutcome(event) {
    const select = event.target.closest('[data-estimate-outcome]');
    if (!select || estimateOutcomeBusy) return;
    const code = select.dataset.estimateOutcome, outcome = select.value;
    if (!PROJECT_CODE.test(code) || !['won','lost'].includes(outcome)) return;
    const status = $('#estimate-outcome-status');
    estimateOutcomeBusy = true;
    for (const control of $$('#quote-estimates-rows [data-estimate-outcome],#quote-estimates-rows [data-delete-unit]')) control.disabled = true;
    try {
      await withEstimateOutcome(code, async () => {
        const entries = deliveryStore ? await deliveryStore.list() : [];
        const existing = entries.find(entry => entry.id === code);
        if (existing) {
          if (existing.events.at(-1)?.outcome !== outcome) {
            if (!confirm(`将这个项目的投标结果登记为「${outcomeNames[outcome]}」？`)) return;
            const saved = await deliveryStore.appendResult(code, {expectedEventNo:existing.lastEventNo, outcome, note:'通过招投标记录登记结果'});
            if (outcome === 'won') await globalThis.ProjectInitiation.ensureWon(projectEntry(code,saved));
          }
          status.textContent = outcome === 'won' ? '已登记中标。点击项目编码打开立项信息表。' : '已登记未中标。';
        } else {
          const row = estimateRecordRows(readEstimates().records,new Map(entries.map(entry=>[entry.id,entry])))
            .find(row=>row.code===code&&row.record.id===select.dataset.estimateId);
          if (!row) throw Error('未找到对应的招投标记录。');
          writeEstimateDecision(row,outcome);
          if (outcome === 'won') await globalThis.ProjectInitiation.ensureWon(projectEntry(code));
          status.textContent = outcome === 'won' ? '已保存中标结果。点击项目编码打开立项信息表。' : '已保存未中标结果。';
        }
      });
    } catch (error) { status.textContent = error.message || '投标结果保存失败。'; }
    finally {
      estimateOutcomeBusy = false;
      if (deliveryStore) await reloadLedger();
      else renderEstimates();
    }
  }
  async function openEstimateProject(event) {
    const link = event.target.closest('[data-project-info]');
    if (!link || !projectInitiation) return;
    event.preventDefault();
    const code = link.dataset.projectInfo;
    try {
      await withEstimateOutcome(code, async()=>{
        const entries = deliveryStore ? await deliveryStore.list() : [];
        const registered = new Map(entries.map(entry=>[entry.id,entry]));
        if (!registered.has(code) && readEstimateOutcome(code)==='won' && !readEstimateDecision(code).awardedAt) {
          const row = estimateRecordRows(readEstimates().records,registered).find(row=>row.code===code&&row.record.id===link.dataset.estimateId);
          if (row) writeEstimateDecision(row,'won');
        }
      });
      await openProjectInformation(code,'quote');
    } catch(error) {
      $('#estimate-outcome-status').textContent = error.message || '立项信息表未能打开。';
    }
  }
  async function openProjectInformation(code,from){
    const backLabel={quote:'返回招投标',project:'返回项目汇总表',ledger:'返回报价历史'}[from];
    projectPageReady=projectInitiation.openDetails(code,{backLabel,onBack:()=>setView(from)});
    setView('project',{openProject:true,projectInfo:true});
    if(await projectPageReady&&pageDrafts)await restorePageDraft('project');
    projectActivity?.refreshContext().catch(()=>{});
  }
  function showRegionMessage(message, error = false) {
    const status = $('#quote-region-message');
    status.textContent = message;
    status.classList.toggle('error', error);
  }
  function regionalAuditeeQuote(row, province, rule, quote) {
    const name = row.clientName.trim();
    const details={name,assets:row.assets,revenue:row.revenue,profit:row.profit,period:row.dataPeriod||row.period||''};
    try {
      if (restoredNeedsReview) throw Error('请先确认历史复算结果');
      if (!name) throw Error('单位名称待补');
      if (province.scopePending || byId(provinceForLocation(row.location))?.scopePending) throw Error('适用范围及币种待确认');
      if (rule.mode === 'budget') throw Error('待逐家确认工时预算');
      const needsAssets = rule.mode !== 'fixed' && rule.basis !== 'revenue';
      const needsRevenue = rule.mode !== 'fixed' && rule.basis !== 'assets';
      const missing = [needsAssets && !row.assets.trim() && '资产总额', needsRevenue && !row.revenue.trim() && '营业收入'].filter(Boolean);
      if (missing.length) throw Error('待补' + missing.join('、'));
      const reference = regionResult(rule, {assets:needsAssets ? wanToYuan(row.assets) : '0', revenue:needsRevenue ? wanToYuan(row.revenue) : '0'});
      if (reference.error) throw Error(reference.error);
      const {totalCents} = adjustedQuote(reference.totalCents, quote, '0');
      return {...details,cents:totalCents};
    } catch (error) {
      return {...details,reason:error.message};
    }
  }
  function submitRegionalEstimate(event) {
    event.preventDefault();
    const field = $('#quote-region');
    const description=$('#inquiry-text'), text=description.value.trim();
    let inquiry=null;
    if(text){
      try{inquiry=globalThis.TenderImport.parseInquiry(text);}
      catch(error){showRegionMessage(error.message,true);description.focus();return;}
    }
    const province = typedProvince(field.value.trim()||inquiry?.pricingRegion||'');
    field.setAttribute('aria-invalid', String(!province));
    if (!province) { showRegionMessage(inquiry?'请在报价参数中填写计价地区，或在询价信息中写明按哪个地区计价。':'输入错误', true); field.focus(); return; }
    if (tenderPending) { showRegionMessage('请等文件识别完成后再测算。', true); return; }
    const tax = $('#estimate-tax'), factor = $('#estimate-factor');
    const nextQuote = {...state.quote, basis:idFor(province), tax:tax.value, rounding:$('#estimate-rounding').value, pricePercent:factor.value.normalize('NFKC').trim().replace(/\s*%$/, '')};
    if (!ESTIMATE_TAX_RATES.includes(nextQuote.tax)) {
      showRegionMessage('请选择税率。', true); tax.focus(); return;
    }
    const usesDefaultFactor = !factor.value.trim();
    if (usesDefaultFactor) nextQuote.pricePercent = '100';
    if (!validPricePercent(nextQuote.pricePercent)) {
      showRegionMessage('请输入有效的报价比例，例如 10%。', true); factor.focus(); return;
    }
    const savedRule = state.rules.find(rule => rule.id === nextQuote.basis);
    const rule = savedRule && savedRule.status !== 'missing' ? savedRule : ruleDefault(province);
    let manualAmounts;
    if(inquiry){
      for(const [key,problem] of [['clientName','请在询价信息中写明一家被审计单位的名称。'],['year','请在询价信息中写明本次审计年度，例如 2026 年。']]){
        if(key==='year'? !/^\d{4}$/.test(inquiry.year)||+inquiry.year<2000||+inquiry.year>2100 : !inquiry[key]){
          showRegionMessage(problem,true);description.focus();return;
        }
      }
      if(!province.scopePending&&rule.mode!=='budget'){
        try{manualAmounts=inquiryAmounts(inquiry,rule);}catch(error){showRegionMessage(error.message,true);description.focus();return;}
      }
    }
    const subjects = inquiry?[]:subjectList?.snapshot().rows || [];
    const auditeeQuotes = subjects.length > 1 ? subjects.map(row => regionalAuditeeQuote(row, province, rule, nextQuote)) : null;
    const source = fallbackRule(rule) ? '借用河北历史口径，非当地标准' : '地区参考，待复核';
    const roundingLabel=nextQuote.rounding==='hundred'?'百位取整':nextQuote.rounding==='thousand'?'千位取整':'';
    const terms = `${source}。${rule.document} · ${rule.version}。报价比例 ${nextQuote.pricePercent}%，税率 ${nextQuote.tax}%。${roundingLabel?'各单位含税报价'+roundingLabel+'。':''}`;
    let cents = null, detail, pending = '';
    let pricedCount = 0;
    if (auditeeQuotes) {
      const priced = auditeeQuotes.filter(line => Number.isSafeInteger(line.cents));
      pricedCount = priced.length;
      const total = priced.reduce((sum, line) => sum + BigInt(line.cents), 0n);
      if (pricedCount === auditeeQuotes.length) {
        if (total <= BigInt(Number.MAX_SAFE_INTEGER)) cents = Number(total);
        else pending = '合计超出可处理范围';
      }
      detail = terms;
    } else try {
      if (restoredNeedsReview) throw Error('请先确认历史复算结果。');
      if(inquiry&&rule.mode==='budget'&&!province.scopePending)throw Error('请先核定本项目的工时预算。');
      const input = province.scopePending ? null : inquiry ? manualAmounts : validateClient();
      const reference = regionResult(rule, input);
      if (reference.error) throw Error(reference.error);
      const quote = adjustedQuote(reference.totalCents, nextQuote, inquiry?'0':nextQuote.extra);
      cents = quote.totalCents;
      detail = `${source}。${rule.document} · ${rule.version}。${reference.baseLabel}；基准价 ${fmt(reference.totalCents)}，报价比例 ${nextQuote.pricePercent}%，另计税率 ${nextQuote.tax}%，附加费用 ${fmt(C.money(inquiry?'0':nextQuote.extra))}。`;
      if (quote.roundingUnit) detail += ` 取整前合计 ${fmt(quote.unroundedTotalCents)}。`;
    } catch (error) { pending = detail = error.message; }

    const form = $('#proposal-form').elements;
    const linked = !inquiry&&proposalKey === currentProposalKey();
    const customer=inquiry?.clientName??state.client.clientName, year=inquiry?.year??state.client.year;
    const issuer=inquiry?(inquiry.issuer||customer):linked?form.issuer.value.trim():'';
    const project=inquiry?inquiry.project:linked?form.projectName.value.trim():'';
    const projectKey=estimateProjectKey(issuer,project,year,auditeeQuotes?.map(row=>row.name)||[customer]);
    const record = {
      createdAt: Date.now(), date: inquiry?todayShanghai():form.quoteDate.value || todayShanghai(), issuer, project, projectKey,
      projectType: inquiry?(inquiry.type||'财务报表审计'):form.projectType.value,
      ...(inquiry?{inquiry}:{}),
      riskLevel: linked ? form.riskLevel.value : '',
      customerName: auditeeQuotes
        ? ((auditeeQuotes.find(row=>row.name)?.name || '') + '等 '+auditeeQuotes.length+' 家单位')
        : customer,
      auditYear: year,
      taxRate: nextQuote.tax + '%',
      firm: form.firmName.value.trim(), provinceId: nextQuote.basis, cents,
      detail: !auditeeQuotes && customer.trim() ? `被审计方：${customer.trim()}。${detail}` : detail,
      ...(auditeeQuotes ? {auditeeQuotes} : {}),
      contact: linked ? form.contactName.value.trim() : '',
      phone: linked ? form.contactInfo.value.trim() : '', email: linked ? $('#issuer-email').value.trim() : ''
    };
    record.projectCode=crypto.randomUUID();
    const recordId=crypto.randomUUID();
    record.pricePercent=nextQuote.pricePercent;
    record.rounding=nextQuote.rounding;
    const lines=regionalQuoteLines(record);
    if(roundingCarry&&roundingCarry.projectKey===projectKey&&roundingCarry.lines.length===lines.length&&
      lines.every((line,i)=>line.name===roundingCarry.lines[i].name)){
      record.finalQuotes=roundingCarry.lines.map(line=>line.finalCents);
    }
    if(!auditeeQuotes&&pending)record.pending=pending;

    factor.value = `${nextQuote.pricePercent}%`;
    if (cents !== null) {
      const ids = comparisonIds();
      ids[2] = nextQuote.basis;
      state.comparisonProvinceIds = ids;
      state.quote = nextQuote;
      ensureRule(nextQuote.basis, true);
      activeRule = nextQuote.basis;
      ruleDraft = null;
      fillQuoteForm();
      update();
    }
    const resultLabel = cents === null ? '待测算' : fmt(cents);
    showRegionalResult({...record,id:recordId,code:record.projectCode});
    const status = auditeeQuotes
      ? `${province.name} · ${pricedCount}/${auditeeQuotes.length} 家已测算 · 待保存${pending ? ' · '+pending : ''}`
      : pending ? `${province.name} · 待测算：${pending}` : `${province.name} · ${resultLabel} · 待保存`;
    showRegionMessage(status,!!pending);
  }
  function validPricePercent(v){return typeof v==='string'&&/^\d{1,5}(?:\.\d{1,2})?$/.test(v)&&Number(v)<=10000;}
  function displayedFactor(q){return q.pricePercent??String(Math.round((100-Number(q.discount))*100)/100);}
  function syncEstimateAdjustments() {
    $('#estimate-tax').value = ESTIMATE_TAX_RATES.includes(state.quote.tax) ? state.quote.tax : ESTIMATE_TAX_RATES[0];
    $('#estimate-rounding').value=state.quote.rounding||'none';
    const factor = displayedFactor(state.quote);
    $('#estimate-factor').value = validPricePercent(factor) ? `${factor}%` : '';
  }
  function fillQuoteForm(){
    formFill($('#quote-form'),{...state.quote,pricePercent:displayedFactor(state.quote)});
    $('#rounding-enabled').checked=!!state.quote.rounding&&state.quote.rounding!=='none';
    $('#rounding-unit').value=state.quote.rounding==='thousand'?'thousand':'hundred';
    $('#rounding-unit').disabled=!$('#rounding-enabled').checked;
  }
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
  function update() { let input=null; try{input=validateClient();$('#client-error').textContent='';}catch(e){$('#client-error').textContent=e.message;} recalcBudget();syncProvince();outputs={};for(const rule of state.rules) outputs[rule.id]=regionResult(rule,input);calculateQuote(); }
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
  let settingsPanel=null,workspaceNavigation=null,workpaperWorkspace=null,reportWorkspace=null,archiveWorkspace=null,templateWorkspace=null,commonTemplateWorkspace=null,standardsWorkspace=null;
  const readOnlyHeaderViews=new Set(['home','standards','general-templates']);
  let projectActivity=null,travelExpenses=null,projectCosts=null,pageDrafts=null,deliveryReady=null;const draftRestored=new Set();let projectPageReady=null,auditPageReady=null;const draftQuoteEpoch={value:null};
  let materialDraftReady=null,materialInputEpoch=0;
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
    const host=$('#project-costs');if(!host)return;
    if(projectCosts){void projectCosts.refresh();return;}
    if(globalThis.ProjectCosts)projectCosts=globalThis.ProjectCosts.mount(host,{
      listProjects:listBidProjects,
      incomeBasis:'gross',returnBasis:'cost',
      async readIncome(id,source,fresh){
        if(!fresh)return source.totalCents??null;
        if(!deliveryStore)throw Error('本机报价台账暂不可用。');
        const formal=(await deliveryStore.list()).find(row=>row.id===id),entry=projectEntry(id,formal);
        if(entry&&entry.events.at(-1)?.outcome!=='won'||!entry&&readEstimateDecision(id).outcome==='lost')
          throw Error('此报价的中标结果已变更，请刷新项目。');
        return entry?entry.snapshot.totalCents:source.totalCents??null;
      }
    });
  }
  function updateAuditHeading(){
    if(view!=='audit')return;
    const step=$('.pw-steps [data-audit-step][aria-pressed=true]');
    const entry=step&&$(`[data-nav-audit-step="${step.dataset.auditStep}"]`);
    const title=$('#audit-flow').hidden?(entry?.textContent||step?.textContent.replace(/^[①-⑨]\s*/, '')||'资料收集与核对'):'流程总览';
    const checklistExport=$('#audit-checklist-export');
    checklistExport.hidden=!$('#audit-flow').hidden||!!step&&step.dataset.auditStep!=='1';
    if(checklistExport.hidden)checklistExport.open=false;
    $('#page-title').textContent=title;
    $('#breadcrumb').textContent='审计程序 / '+title;
  }
  function reportSectionTitle(section){return section==='audit-report'?'审计报告':'试算平衡表';}
  function updateReportHeading(section){
    if(view!=='report')return;
    const title=reportSectionTitle(section);
    $('#page-title').textContent=title;
    $('#breadcrumb').textContent='报告出具 / '+title;
  }
  function showReport(){
    const host=$('#report-workspace');if(!host)return;
    if(!reportWorkspace&&globalThis.ReportWorkspace?.mount){
      reportWorkspace=globalThis.ReportWorkspace.mount(host,{onSectionChange:updateReportHeading,openTrialBalance:async({projectId,index})=>{
        if(!workpaperWorkspace?.openDirectoryIndex)throw Error('底稿目录组件尚未就绪，未打开其他项目或替代底稿。');
        if(setView('audit',{auditStepSelected:true})===false)throw Error('已取消离开当前页面。');
        return workpaperWorkspace.openDirectoryIndex({projectId,index});
      }});
    }
  }
  let auditWorkflow=null;
  function assertAuditDownloadContext(projectId){
    if(view!=='audit'||$('#audit-flow').hidden||auditWorkflow.selectedProject()!==projectId)throw Error('已离开当前审计项目，未执行下载。');
  }
  async function openAuditWorkflowStage(stage,projectId,beforeLoad){
    if(stage==='client'){
      const step=$('.pw-steps [data-audit-step="1"]');
      if(step?.disabled)throw Error('当前审计资料正在处理，请稍后重试。');
      if(step&&step.getAttribute('aria-pressed')!=='true')step.click();
      if(step&&step.getAttribute('aria-pressed')!=='true')return;
      setView('audit',{auditDetail:true,auditStepSelected:!!projectId});
      if(projectId)await auditProgram?.selectProject(projectId);
      return $('#ac-project')?.value===projectId;
    }
    const workpaperStep={initial:3,risk:4,ledger:8}[stage];
    if(workpaperStep){
      if(!workpaperWorkspace?.openProjectStage)throw Error('项目底稿工作区尚未就绪。');
      if(!await workpaperWorkspace.openProjectStage(projectId,workpaperStep,beforeLoad))return false;
      return setView('audit',{auditStepSelected:true,auditDetail:true});
    }
    if(stage==='report-download'){
      if(!globalThis.ReportWorkspace?.downloadSavedDraft)throw Error('报告下载组件尚未就绪。');
      await globalThis.ReportWorkspace.downloadSavedDraft(projectId,()=>assertAuditDownloadContext(projectId));
      $('#audit-flow-status').textContent='已下载报告初版（待核对）。';
      return true;
    }
    if(stage==='report'){
      setView('report');
      reportWorkspace?.selectSection?.('audit-report');
      if(projectId)await reportWorkspace?.selectProject?.(projectId);
      return $('#report-project')?.value===projectId;
    }
    setView('archive');
    if(projectId)await archiveWorkspace?.selectProject?.(projectId);
    return $('#audit-archive-project')?.value===projectId;
  }
  function setView(name,{openProject=false,projectInfo=false,auditStepSelected=false,auditDetail=auditStepSelected,overviewProject}={}){
    const labels={
      home:['首页','审计项目工作台',''],
      templates:['资料库 / 审计底稿模板','审计底稿模板','本机维护模板原件，按项目选用，不上传模板正文。'],
      'general-templates':['资料库 / 通用模板','通用模板',''],
      standards:['资料库 / 准则查询','准则查询',''],
      archive:['报告出具 / 审计底稿归档','审计底稿归档','按原工作底稿目录整理原件、填写记录和明确关联的附件。'],
      basics:['资料库','资料库',''],
      settings:['设置','账号与设置','平台账号资料、显示偏好与本机数据说明。'],
      bidders:['资料库 / 投标方信息库','投标方信息库','保存本所及获授权合作所的基础资料和证照，报价时按所选用。'],
      quote:['招投标及立项 / 招投标','招投标',''],
      rules:['资料库 / 收费依据','收费依据','历史参考、自定义口径与原始出处分开管理。'],
      proposal:['招投标及立项 / 报价单','报价单','按所选格式生成 Word，自动附带营业执照和执业证书。'],
      bid:['招投标及立项 / 标书','标书','独立维护当前项目的投标文件。'],
      ledger:['招投标及立项 / 报价历史','把报过的项目和结果记录下来。','报价日期、发标单位、项目和金额固定保存；已中标记录可进入立项，不自动建档。'],
      project:projectInfo?['招投标及立项 / 立项信息表','立项信息表','']:['招投标及立项 / 项目汇总表','项目汇总表',''],
      travel:['成本核算 / 费用报销填报','费用报销填报','关联已立项项目，登记费用、发票及支付记录。'],
      costs:['成本核算 / 项目成本核算','项目成本核算',''],
      audit:['审计程序 / 流程总览','流程总览',''],
      report:['报告出具 / 试算平衡表','试算平衡表','']
    };
    if(!Object.hasOwn(labels,name))return false;
    const detailsOpen=projectInitiation?.isDetailsOpen?.();
    if(view==='project'&&detailsOpen&&(name!=='project'||!openProject)&&!projectInitiation.canLeave())return false;
    if(name!=='quote')closeEstimateFilter();
    if(name!==view&&pageDrafts&&!readOnlyHeaderViews.has(view))void pageDrafts.checkpoint(['proposal','bid'].includes(view)?'quote':view).catch(err=>draftNotice('切页暂存未完成：'+err.message,true));view=name;$('main').dataset.workspaceView=name;
    $$('.view').forEach(e=>e.hidden=e.id!=='view-'+name);
    $$('[data-view]').forEach(e=>{const active=e.dataset.view===name;e.classList.toggle('active',active);if(active)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
    $('#workspace-eyebrow').textContent=name==='quote'?'BIDDING WORKBENCH':'AUDIT WORKSPACE';
    $('#bidding-navigation').hidden=!['proposal','bid','ledger'].includes(name);
    if(name==='project')$('#view-project').dataset.mode=projectInfo?'details':'summary';
    $('#page-save').hidden=name==='project'&&projectInfo;
    for(const id of ['project-summary-clear','project-summary-new','project-summary-export'])$('#'+id).hidden=name!=='project'||projectInfo;
    $('#page-save-status').hidden=name==='project'&&!projectInfo;
    if(name!=='audit'){$('#audit-checklist-export').open=false;$('#audit-checklist-export').hidden=true;}
    $('#breadcrumb').textContent=labels[name][0];$('#page-title').textContent=labels[name][1];
    const subtitle=$('#page-subtitle');subtitle.textContent=labels[name][2];subtitle.hidden=!subtitle.textContent;
    const draftToolbar=$('.page-draft-toolbar');
    if(draftToolbar)draftToolbar.hidden=readOnlyHeaderViews.has(name);
    if(name==='rules'&&!$('#rules-form'))renderRules();if(name==='ledger'||name==='quote'&&deliveryStore)void reloadLedger();
    if(name==='project'&&!openProject)projectPageReady=Promise.resolve(projectInitiation?.show({leaveApproved:!!detailsOpen}));
    if(name==='audit'&&auditWorkflow){
      $('#audit-flow').hidden=auditDetail;$('#audit-program').hidden=!auditDetail;
      if(!auditDetail)auditPageReady=auditWorkflow.show(overviewProject);
      else if(!auditStepSelected)auditPageReady=Promise.resolve(auditProgram?.show());
    }else if(name==='audit'&&!auditStepSelected&&!$('#audit-program').querySelector('#ac-project'))auditPageReady=Promise.resolve(auditProgram?.show());
    if(name==='settings')showSettings();if(name==='travel')showTravel();if(name==='costs')showCosts();
    if(name==='audit')updateAuditHeading();
    if(name==='report'){
      showReport();updateReportHeading($('#report-audit-report')?.hidden===false?'audit-report':'trial-balance');
      reportWorkspace?.refreshActiveSection?.();
    }
    if(name==='archive'&&!archiveWorkspace&&globalThis.AuditArchiveUI)archiveWorkspace=globalThis.AuditArchiveUI.mount($('#audit-archive'),{listProjects:async()=>{
      const projects=await globalThis.ProjectInitiation.listSaved();
      return Promise.all(projects.map(async project=>({...project,companyName:(await globalThis.ProjectWorkspaceStore.get(project.quoteId)).projectInitiationDetails?.companyName})));
    }});
    if(name==='templates'&&globalThis.AuditTemplates){
      if(templateWorkspace)templateWorkspace.show();
      else templateWorkspace=globalThis.AuditTemplates.mount($('#audit-templates'));
    }
    if(name==='general-templates'&&globalThis.AuditTemplates){
      if(commonTemplateWorkspace)commonTemplateWorkspace.show();
      else commonTemplateWorkspace=globalThis.AuditTemplates.mount($('#general-templates'),{common:true});
    }
    if(name==='standards'&&!standardsWorkspace)
      standardsWorkspace=globalThis.StandardsLookup?.mount($('#standards-lookup'));
    workspaceNavigation?.sync(name);projectActivity?.refreshContext().catch(()=>{});if(pageDrafts&&!readOnlyHeaderViews.has(name)&&!draftRestored.has(name)&&!(name==='project'&&openProject)){draftRestored.add(name);void restorePageDraft(name);}return true;
  }
  function connectProjectInitiation(){
    const host=$('#project-initiation');
    if(!host)return;
    if(!globalThis.ProjectInitiation){host.textContent='立项组件未载入，请刷新后重试。';return;}
    projectInitiation=globalThis.ProjectInitiation.mount(host,{
      listWon:bidProjectEntries,
      onOpenDetails:id=>openProjectInformation(id,'project'),
      summaryClearButton:$('#project-summary-clear'),
      summaryNewButton:$('#project-summary-new'),
      summaryExportButton:$('#project-summary-export'),
      summaryRecords:relevantBidProjects,
      projectNameForDisplay:coreProjectName,
      onCheckpoint:scope=>checkpointPageDraft(scope),
      async onCommitted(scope){
        if(!pageDrafts?.peek('project',{scope}))return true;
        try{await pageDrafts.discard('project',{scope});return true;}catch{return false;}
      },
      lookup:async id=>{
        if(!deliveryStore)throw Error('本机报价台账暂不可用；请稍候重新进入。');
        const row=projectEntry(id,(await deliveryStore.list()).find(entry=>entry.id===id));
        if(!row)throw Error('未找到这条报价记录。');
        return row;
      },
      onBack:()=>{$('#ledger-filter').value='won';setView('ledger');}
    });
  }
  function hydrate(){selectOptions();if(!byId(state.selectedProvince))state.selectedProvince=provinceForLocation(state.client.location);if(state.client.location&&!provinceForLocation(state.client.location))state.client.location='其他地区';ensureSelected();activeRule=selectedId();ruleDraft=null;formFill($('#client-form'),state.client);fillQuoteForm();syncEstimateAdjustments();update();if(view==='rules')renderRules();}
  function persistRecords(next){
    if(!validateChains(next)){SaveFeedback.failed('修订链不完整，未写入。');return false;}
    if(readError){SaveFeedback.failed('本机记录不兼容或已损坏，请先导出原始备份。');return false;}
    try {
      // Detect other-tab updates and refuse to overwrite an unseen newer value.
      if(localStorage.getItem(STORE)!==storedRaw){readError=true;storedRaw=localStorage.getItem(STORE);renderHistory();SaveFeedback.failed('本机记录已被其他页面修改，请导出原始备份并重新载入。');return false;}
      const raw=JSON.stringify(next);localStorage.setItem(STORE,raw);storedRaw=raw;records=next;return true;
    }catch(error){SaveFeedback.failed(error,'无法写入本机记录，请检查浏览器存储权限。');return false;}
  }
  function save(asRevision=false){if(!finalResult){SaveFeedback.failed('缺少测算结果，请先填写报价参数并完成测算。');return;}if(restoredNeedsReview){SaveFeedback.failed('历史复算待确认，请先明确确认采用当前重新测算结果。');return;}if(readError){toast('已有存储无法读取；为避免覆盖，请先检查浏览器本机数据。');return;}
    const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());if(records.some(r=>r.id===id)){toast('记录编号冲突，未保存，请重试');return;}
    const record={id,savedAt:new Date().toISOString(),totalCents:finalResult.totalCents,snapshot:clone(state),calculation:clone({regions:outputs,budget:budgetResult,quote:finalResult}),appVersion:'0.1'};
    if(asRevision){const loaded=records.find(r=>r.id===activeRecordId);if(!loaded){toast('请先恢复最新修订');return;}const root=rootId(loaded),head=chainHead(root);if(!head||head.id!==loaded.id){SaveFeedback.failed('当前不是最新修订，请恢复最新版本后再保存。');return;}if(customerKey(head)!==customerKey(record)){toast('客户名称、年度或业务类型已改变，请保存为新报价');return;}record.revisionRoot=root;record.revisionNo=chainVersion(head)+1;if(!confirm('将当前草稿另存为第 '+record.revisionNo+' 版？原版本不会覆盖。'))return;}
    if(persistRecords([record,...records])){activeRecordId=record.id;restoredNeedsReview=false;showRestoreReview();$('#preview').disabled=!finalResult;$('#csv').disabled=!finalResult;$('#save-revision').disabled=!finalResult;SaveFeedback.saved(asRevision?'已新增修订 · 仅本机':'已保存计算草稿 · 仅本机');renderHistory();refreshProposalControls();}}

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
  function tenderProjectType(value){
    const select=$('#project-type');
    select.querySelector('[data-tender-type]')?.remove();
    value=[...select.options].find(option=>option.textContent===value)?.value??value;
    if(value&&!Array.from(select.options).some(option=>option.value===value)){
      const option=new Option(value,value);
      option.dataset.tenderType='';
      select.add(option);
    }
    select.value=value||state.client.service;
    if(!select.value)select.value='其他';
  }
  function resetProposal(){const f=$('#proposal-form');if(!f)return;$('#issuer-email').value='';tenderProjectType();formFill(f,{quoteDate:todayShanghai(),issuer:state.client.clientName,projectName:state.client.year+'年度'+state.client.service.replace(/^年度/,''),riskLevel:'',contactName:'',contactInfo:''});proposalKey=currentProposalKey();proposalEpoch++;refreshProposalControls();}
  const credentialLabels={business_license:'营业执照',practice_certificate:'执业证书'};
  function selectedPair(){
    if(!selectedBidder || $('#proposal-form').elements.firmName.value!==selectedBidder.name)return [];
    return Object.keys(credentialLabels).map(kind=>selectedBidder.attachments.find(a=>a.kind===kind)).filter(Boolean);
  }
  function regionalDocumentRows(lines){
    const metric=(value,signed=false)=>{
      const amount=String(value??'').normalize('NFKC').trim().replace(/^(-?)0+(?=\d)/u,'$1');
      const allowed=signed?/^-?\d{1,9}(?:\.\d{1,6})?$/u:/^\d{1,9}(?:\.\d{1,6})?$/u;
      return allowed.test(amount)?amount:'';
    };
    return lines.map(({name,cents,assets,revenue,profit,period=''})=>({
      name,assets:metric(assets),revenue:metric(revenue),profit:metric(profit,true),period,totalCents:cents
    }));
  }
  function manualRegionalAmount(){
    const record=latestRegionalEstimate;
    if(!record||record.inquiry)return null;
    const result=readRegionalPrices(record);
    if(result.error)throw Error(result.error);
    if(!result.overrides.some(hasEstimatePrice))return null;
    const subjects=subjectList?.snapshot();
    const batch=!!batchQuote?.active();
    const lines=batch?result.lines:[result.lines[subjects?.active??0]||result.lines[0]];
    const {totalCents,overflow}=regionalQuoteTotal(lines);
    if(overflow)throw Error('最终报价合计超出可处理范围。');
    if(totalCents===null)throw Error('请填齐最终报价。');
    const years=new Set(batch?subjects.rows.map(row=>row.year):[state.client.year]);
    if(years.size!==1)throw Error('同一张汇总报价单须使用同一审计年度。');
    const denominator=100n+BigInt(record.taxRate.slice(0,-1));
    const subtotalCents=Number(lines.reduce((total,line)=>total+(BigInt(line.cents)*100n+denominator/2n)/denominator,0n));
    return {totalCents,subtotalCents,taxCents:totalCents-subtotalCents,taxRate:record.taxRate,auditYear:Number([...years][0]),
      ...(batch?{quoteRows:regionalDocumentRows(lines)}:{})};
  }
  function previewBlockers(pair,matched){
    const reasons=[];
    const batch=!!batchQuote?.active();
    let regional;
    try{regional=manualRegionalAmount();}catch(e){reasons.push(e.message);}
    if(!reasons.length&&!regional){
      if(!batch&&!finalResult)reasons.push('客户或报价输入尚不完整，请检查上方错误提示');
      if(batch){try{batchQuote.capture();}catch(e){reasons.push(e.message);}}
    }
    if(restoredNeedsReview)reasons.push('历史报价复算结果待明确确认');
    if(!matched)reasons.push('客户、年度或业务已改变，请点击“按当前客户重填登记信息”');
    if(!globalThis.QuotePacket)reasons.push('附件组件未能加载，请重新打开完整文件或刷新页面');
    if(!selectedBidder)reasons.push('请在投标方信息中选择事务所，以带入营业执照和执业证书');
    else {
      const missing=Object.entries(credentialLabels).filter(([kind])=>!pair.some(a=>a.kind===kind)).map(([,label])=>label);
      if(missing.length)reasons.push('所选事务所缺少'+missing.join('、')+'，请到投标方信息库补齐并重新带入');
    }
    if(selectedBidder&&(regional||batch||finalResult)&&!restoredNeedsReview&&matched&&globalThis.QuotePacket&&!reasons.length){
      try{snapshotForProposal();}catch(e){reasons.push(e.message||'请核对报价登记信息');}
    }
    if(quoteExtras?.isPending())reasons.push('正在检查附加文件');
    if(tenderPending)reasons.push('发标文件正在识别');if(proposalBusy)reasons.push('正在处理，请稍候');return reasons;
  }
  function refreshProposalControls(){
    if(!$('#proposal-form'))return;
    refreshQuoteDownloadControls();
    syncDocumentScope();
    batchQuote?.refresh();
    const batchOn=!!batchQuote?.active(),batchTotal=$('#quote-batch-total-box');
    if(batchTotal){
      batchTotal.hidden=!batchOn;batchTotal.closest('.quote-summary').dataset.quoteScope=batchOn?'batch':'single';
      if(batchOn){try{$('#quote-batch-total').textContent=fmt((manualRegionalAmount()||batchQuote.capture()).totalCents);}catch{$('#quote-batch-total').textContent='待填齐';}}
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
    const regional=manualRegionalAmount();
    const batch=batchQuote?.active()?(regional||batchQuote.capture()):null,amount=regional||batch||finalResult;
    if(!amount)throw Error('请先核对有效报价');
    if(proposalKey!==currentProposalKey())throw Error('请先按当前客户重填登记信息');
    const {riskLevel,...p}=formRead($('#proposal-form'));if(!p.projectType)throw Error('请填写项目类型');
    if(!selectedBidder||selectedBidder.name!==p.firmName.trim())throw Error('请从投标方信息库选用与报价一致的事务所');
    p.contactInfo=[p.contactInfo,$('#issuer-email').value].map(v=>v.trim()).filter(Boolean).join(' / ');
    const bidderContact={name:$('#bidder-contact').value,phone:$('#bidder-phone').value,email:$('#bidder-email').value};
    if(Object.values(bidderContact).some(v=>v.trim()))p.bidderContact=bidderContact;
    return globalThis.QuotePacket.normalizeSnapshot({...p,
      customerName:batch?batch.quoteRows[0].name+'等 '+batch.quoteRows.length+' 家单位':state.client.clientName,
      auditYear:batch?batch.auditYear:Number(state.client.year),location:batch?'多单位（见报价明细）':state.client.location,service:state.client.service,
      subtotalCents:amount.subtotalCents,taxCents:amount.taxCents,totalCents:amount.totalCents,taxRateText:(regional?.taxRate||state.quote.tax+'%')+'（税务口径待确认）',
      ...(batch?{quoteRows:batch.quoteRows}:{}),...(riskLevel?{riskLevel}:{})
    });
  }
  async function proposalAction(work,target='#proposal-status',onError){if(proposalBusy)return;proposalBusy=true;refreshProposalControls();try{await work();}catch(e){if(target==='#quote-pdf-status')pdfStatus(e.message||'操作失败，未自动重试',true);else $(target).textContent=e.message||'操作失败，未自动重试';if(onError)onError(e);else toast(e.message||'操作失败，未自动重试');}finally{proposalBusy=false;refreshProposalControls();}}
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
  function refreshQuoteDownloadControls(){
    $('#clear-tender').disabled=!(hasTender||tenderPending||importedTender);
    $('#clear-inquiry').disabled=!$('#inquiry-text').value;
    $('#clear-quote-reference').disabled=!quoteReferenceFile;
    const price=latestRegionalEstimate&&readRegionalPrices();
    const ready=!!price&&!price.error&&hasEstimatePrice(price.totalCents)&&!!selectedBidder&&!proposalBusy&&!tenderPending;
    $('#quote-download-layout').disabled=!ready||!globalThis.QuoteLayouts?.buildUnsignedWord;
    $('#quote-download-reference').disabled=!ready||!/\.docx$/iu.test(quoteReferenceFile?.name||'')||!globalThis.ContractTemplate?.fillQuotation;
  }
  async function downloadRegionalQuote(useReference,format){
    const chosen=selectedBidder,reference=quoteReferenceFile;
    if(!chosen||!latestRegionalEstimate)return;
    return proposalAction(async()=>{
      const {lines,totalCents,error}=readRegionalPrices();
      if(error)throw Error(error);
      if(!hasEstimatePrice(totalCents))throw Error('请填齐最终报价。');
      const record=latestRegionalEstimate,epoch=proposalEpoch,key=ESTIMATE_PREFIX+record.id;
      const saved=localStorage.getItem(key);
      const picker=$('#bidder-picker-select'),status=$('#quote-template-status');
      const isCurrent=()=>selectedBidder===chosen&&picker?.value===chosen.id&&latestRegionalEstimate===record&&
        proposalEpoch===epoch&&localStorage.getItem(key)===saved&&(!useReference||quoteReferenceFile===reference)&&!tenderPending;
      status.textContent='正在生成本次报价…';
      const db=await globalThis.BidderLibrary.open();
      try{
        const latest=await db.get(chosen.id);
        if(!isCurrent()||latest?.version!==chosen.version)throw Error('报价单位或测算结果已变化，请重新生成。');
        const rows=record.auditeeQuotes?regionalDocumentRows(lines):null;
        const audited=rows?.map(row=>row.name)||[record.customerName];
        const snapshot=globalThis.QuotePacket.normalizeSnapshot({firmName:latest.name,customerName:rows?audited[0]:record.customerName,
          auditYear:Number(record.auditYear),location:byId(record.provinceId).name,service:record.projectType,quoteDate:record.date,
          issuer:record.issuer,projectName:coreProjectName(record.project),projectType:record.projectType,
          contactName:record.contact||'',contactInfo:[record.phone,record.email].filter(Boolean).join(' / '),
          subtotalCents:totalCents,taxCents:0,totalCents,taxRateText:record.taxRate,
          bidderContact:{name:latest.contactName||'',phone:latest.phone||'',email:latest.email||''},...(rows?{quoteRows:rows}:{})});
        const file=useReference?await globalThis.ContractTemplate.fillQuotation(reference,snapshot,{bidder:latest}):
          await globalThis.QuoteLayouts.buildUnsignedWord(snapshot,[format],{grossOnly:true});
        const currentBidder=useReference?await db.get(chosen.id):latest;
        if(!isCurrent()||currentBidder?.version!==latest.version)throw Error('报价资料或报价单位档案已变化，请重新生成。');
        blobDownload(file.name,file.bytes,file.mime);
        const detail=useReference?' · '+file.materials+' 份所选单位附件'+
          (file.missing.length?' · 待补：'+file.missing.join('、'):'')+(file.removedGraphics?' · 请复核原图和签章位置':''):'';
        status.textContent=SaveFeedback.downloaded('已发起下载 '+file.name+detail);
      }finally{db.close();}
    },'#quote-template-status',SaveFeedback.downloadFailed);
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
  async function reloadLedger(){
    const status=$('#ledger-status');
    if(!deliveryStore){status.textContent='本机台账不可用，请检查浏览器存储权限。';return;}
    try{
      ledgerRows=await deliveryStore.list();renderLedger();status.textContent='已读取 '+ledgerRows.length+' 条本机报价登记。';
    }catch(e){status.textContent='读取失败，未重置或覆盖旧数据：'+e.message;}
    try{await refreshEstimateProjectNumbers();}
    catch(e){estimateProjectNumbers=new Map();status.textContent='项目编码待核对：'+e.message;}
    finally{renderEstimates();}
  }
  function renderLedger(){const query=$('#ledger-search').value.trim().toLowerCase(),filter=$('#ledger-filter').value;const rows=ledgerRows.filter(e=>{const o=e.events.at(-1)?.outcome||'pending',v=e.snapshot;return (filter==='all'||filter===o)&&(!query||[v.issuer,v.projectName,v.projectType,v.contactName,v.contactInfo,v.customerName].some(x=>x.toLowerCase().includes(query)));});$('#ledger-empty').hidden=rows.length>0;$('#ledger-rows').innerHTML=rows.map((e,i)=>{const v=e.snapshot,o=e.events.at(-1)?.outcome||'pending';return '<tr><td>'+(i+1)+'</td><td>'+esc(v.quoteDate)+'</td><td>'+esc(v.issuer)+'</td><td>'+esc(v.projectName)+'</td><td>'+esc(v.projectType)+'</td><td>'+esc(C.formatMoney(v.totalCents))+'</td><td><span class="status-chip">'+outcomeNames[o]+'</span></td><td>'+esc(v.contactName||'—')+'</td><td>'+esc(v.contactInfo||'—')+'</td><td><div class="ledger-actions"><button class="btn" data-packet-id="'+esc(e.id)+'">下载报价 Word</button><label class="ledger-result-select">登记结果<select data-result-select="'+esc(e.id)+'" aria-label="登记报价结果">'+(o==='pending'?'<option value="" disabled selected hidden>登记结果</option>':'')+['won','lost','cancelled'].map(k=>'<option value="'+k+'"'+(o===k?' selected':'')+'>'+outcomeNames[k]+'</option>').join('')+'</select></label>'+(o==='won'&&projectInitiation?'<button type="button" class="btn primary" data-initiation-id="'+esc(e.id)+'">填立项信息表</button>':'')+'</div><details><summary>结果留痕 '+e.events.length+' 次</summary>'+e.events.map(t=>'<p>#'+t.eventNo+' '+outcomeNames[t.outcome]+' · '+esc(t.recordedAt)+'<br>'+esc(t.note||'未填写说明')+'</p>').join('')+'<small>登记编号 '+esc(e.id)+'</small></details></td></tr>';}).join('');}
  async function openLedgerPacket(id){return proposalAction(async()=>{const data=await deliveryStore.get(id),ctx={snapshot:data.entry.snapshot,pair:data.attachments,extras:data.extras||[],formats:['format1'],options:data.entry.snapshot.quoteRows?{quoteRows:data.entry.snapshot.quoteRows}:{}};await wordFile(ctx,()=>true);$('#ledger-status').textContent='已下载该条已登记报价 Word，含两项必带附件。';},'#ledger-status');}
  function connectProposal(){if(!$('#proposal-form'))return;resetProposal();$('#proposal-form').addEventListener('submit',e=>e.preventDefault());$('#proposal-form').addEventListener('input',e=>{proposalEpoch++;if(e.target.name==='firmName'&&selectedBidder){const name=e.target.value;clearBidder();e.target.value=name;bidderPicker?.clearPicker();}if(['issuer','projectName','contactName','contactInfo'].includes(e.target.name)||e.target.id==='issuer-email')intakeChanged=true;refreshProposalControls();});$('#keep-issuer').addEventListener('click',()=>{if(confirm('确认沿用当前发标单位、项目与联系方式，关联至所选被审计方？')){proposalKey=currentProposalKey();proposalEpoch++;refreshProposalControls();}});$('#complete-proposal').addEventListener('click',()=>{const review=$('#quote-intake-review');review.open=true;review.scrollIntoView?.({behavior:'smooth',block:'start'});});$('#sync-proposal').addEventListener('click',()=>{if(confirm('按当前客户重填项目和日期，并清空旧联系人？事务所名称及资质附件保留。'))resetProposal();});
   $('#choose-bidder-for-quote').addEventListener('click',()=>{setView('quote');$('#bidder-picker-select')?.focus();});
   $('#quote-download-layout').addEventListener('change',event=>{
     const format=event.currentTarget.value;
     event.currentTarget.value='';
     if(format)void downloadRegionalQuote(false,format);
   });
   $('#quote-download-reference').addEventListener('click',()=>downloadRegionalQuote(true));
   $('#manage-bidder-credentials').addEventListener('click',()=>{
     setView('bidders');
     const edit=selectedBidder&&$$('[data-bidder-edit]').find(b=>b.dataset.bidderEdit===selectedBidder.id);
     if(edit)edit.click();else $('#bidder-new')?.focus();
   });
   $('#register-quote').addEventListener('click',()=>proposalAction(async()=>{
     const ticket=proposalEpoch,snapshot=snapshotForProposal(),extras=currentExtras(),pair=await globalThis.QuotePacket.verifyPair(selectedPair());
     if(ticket!==proposalEpoch)throw Error('内容已变化，请核对后重新登记');
     const code=matchingEstimateCode(estimateProjectKey(snapshot.issuer,snapshot.projectName,snapshot.auditYear,snapshot.quoteRows?.map(row=>row.name)||[snapshot.customerName]),snapshot.totalCents);
     const registered=await withEstimateOutcome(code, async()=>{
       if(ticket!==proposalEpoch)throw Error('内容已变化，请核对后重新登记');
       const outcome=code?readEstimateOutcome(code):'';
       const carriesOutcome=outcome?` 将沿用测算记录的「${outcomeNames[outcome]}」结果。`:'';
       if(!confirm('登记当前报价 '+fmt(snapshot.totalCents)+'，并固定保存项目、联系人、两项证照与所选的附加文件？这不会发送或批准报价。'+carriesOutcome))return null;
       return deliveryStore.register(snapshot,pair,extras,code?{id:code,outcome}:null);
     });
     if(!registered)return;
     $('#proposal-status').textContent='本次报价已登记，可在“报价历史”查看并追加中标结果。';
     await reloadLedger();
     if(registered.events.at(-1)?.outcome==='won'){
       try {await globalThis.ProjectInitiation.ensureWon(projectEntry(registered.id,registered));$('#proposal-status').textContent='本次报价已登记并沿用中标结果，可在立项查看同一编码。';}
       catch(error) {$('#proposal-status').textContent='中标结果已保存，自动立项待重试：'+error.message;}
     }
     toast('已登记报价 · 未发送');
   }));
   $('#download-packet').addEventListener('click',downloadUnsignedWord);
   $('#export-current-quote').addEventListener('click',generateCurrentWord);
   $('#ledger-rows').addEventListener('change',e=>{const select=e.target.closest('[data-result-select]');if(!select)return;const entry=ledgerRows.find(x=>x.id===select.dataset.resultSelect),outcome=select.value,previous=entry?.events.at(-1)?.outcome||'pending';if(!entry||!['won','lost','cancelled'].includes(outcome)||outcome===previous)return;if(proposalBusy){select.value=previous==='pending'?'':previous;return;}if(!confirm('将该报价登记为「'+outcomeNames[outcome]+'」？将追加记录，不覆盖原结果。')){select.value=previous==='pending'?'':previous;return;}select.disabled=true;void proposalAction(async()=>{await deliveryStore.appendResult(entry.id,{expectedEventNo:entry.lastEventNo,outcome,note:'通过下拉选项登记结果'});await reloadLedger();if(outcome==='won'){try{await globalThis.ProjectInitiation.ensureWon((await deliveryStore.list()).find(x=>x.id===entry.id));toast('已登记中标并生成项目');}catch(err){toast('中标已登记；项目创建待重试：'+err.message);}}else toast('结果已追加；原有项目资料保留');},'#ledger-status').finally(()=>{if(select.isConnected){select.disabled=false;select.value=previous==='pending'?'':previous;}});});
   $('#ledger-search').addEventListener('input',renderLedger);$('#ledger-filter').addEventListener('change',renderLedger);$('#reload-ledger').addEventListener('click',reloadLedger);
   $('#ledger-rows').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.initiationId&&projectInitiation){
     await openProjectInformation(b.dataset.initiationId,'ledger');
     $('#page-title').scrollIntoView?.({block:'start'});
     return;
   }if(b.dataset.packetId){await openLedgerPacket(b.dataset.packetId);return;}const entry=ledgerRows.find(x=>x.id===b.dataset.resultId);if(!entry)return;const f=$('#ledger-result-form');formFill(f,{entryId:entry.id,expectedEventNo:String(entry.lastEventNo),outcome:entry.events.at(-1)?.outcome||'won',note:''});$('#result-status').textContent='将追加结果，不覆盖旧记录；若其他页面已更新，需先重新读取。';$('#ledger-result-dialog').showModal();});
   $('#close-result').addEventListener('click',()=>$('#ledger-result-dialog').close());$('#ledger-result-form').addEventListener('submit',e=>{e.preventDefault();proposalAction(async()=>{const v=formRead(e.currentTarget);await deliveryStore.appendResult(v.entryId,{expectedEventNo:Number(v.expectedEventNo),outcome:v.outcome,note:v.note});$('#ledger-result-dialog').close();await reloadLedger();if(v.outcome==='won'){try{await globalThis.ProjectInitiation.ensureWon((await deliveryStore.list()).find(x=>x.id===v.entryId));toast('中标结果已保存 · 项目已自动生成，请到立项填写最终中标价与合同');}catch(e){toast('中标结果已保存，但自动建项目失败：'+e.message+'；请到立项重试');}}else toast('结果已追加，已有项目和合同资料保留');},'#result-status');});
   $('#export-ledger-csv').addEventListener('click',()=>proposalAction(async()=>{const rows=await deliveryStore.list();download('报价历史记录.csv',deliveryStore.historyCsv(rows),'text/csv;charset=utf-8');},'#ledger-status'));
   $('#export-ledger-json').addEventListener('click',()=>proposalAction(async()=>{if(!confirm('导出包含联系人及两项证照文件的完整本机归档？请妥善保管；当前暂不支持自动导入。'))return;const value=await deliveryStore.exportArchive();download('报价台账与附件归档.json',typeof value==='string'?value:JSON.stringify(value,null,2),'application/json;charset=utf-8');},'#ledger-status'));
   if(globalThis.QuoteLedger&&globalThis.QuotePacket)deliveryReady=globalThis.QuoteLedger.open().then(store=>{deliveryStore=store;refreshProposalControls();void reloadLedger();if(view==='project'&&$('#view-project').dataset.mode==='summary')projectPageReady=Promise.resolve(projectInitiation?.show());}).catch(e=>{$('#proposal-status').textContent='本机报价台账不可用，无法登记；未重置历史资料：'+e.message;deliveryStore=null;refreshProposalControls();});else $('#proposal-status').textContent='台账或附件组件未载入，暂不能登记报价。';
  }
  function captureRuleForm(){const r=clone(ruleDraft), form=$('#rules-form'),values=formRead(form);r.basis=values.basis;r.mode=values.mode;r.minimumYuan=values.minimumYuan;r.fixedYuan=values.fixedYuan===''?null:values.fixedYuan;for(const el of $$('[data-tier]',form)){let val=el.value;if(el.dataset.field==='upToYuan')val=val===''?null:wanToYuan(val);r.tiers[+el.dataset.tier][el.dataset.field]=val;}return r;}
  $('#comparison').addEventListener('submit', submitRegionalEstimate);
  $('#estimate-record-save').addEventListener('click',saveRegionalRecord);
  $('#quote-inquiry').addEventListener('input',()=>{
    showRegionalResult();
    showRegionMessage($('#inquiry-text').value.trim()?'本次按手填询价信息测算。':'');
  });
  $('#quote-inquiry').addEventListener('submit',event=>{event.preventDefault();$('#comparison').requestSubmit();});
  $('#quote-estimates-rows').addEventListener('change', changeEstimateOutcome);
  $('#quote-estimates-rows').addEventListener('click', openEstimateProject);
  $('#quote-estimates-rows').addEventListener('click', deleteEstimateRow);
  const regionalDetails=$('#estimate-details');
  regionalDetails.addEventListener('input',event=>{
    if(!event.target.matches('[data-final-quote]'))return;
    proposalEpoch++;
    refreshRegionalPrices();
    showRegionMessage($('#estimate-record-save').disabled?'':'最终报价已修改，待保存。');
    refreshProposalControls();
  });
  regionalDetails.addEventListener('change',event=>{
    const input=event.target;
    if(!input.matches('[data-final-quote]'))return;
    const result=refreshRegionalPrices();
    if(result&&!result.error){
      const cents=result.lines[Number(input.dataset.finalQuote)].cents;
      input.value=hasEstimatePrice(cents)?decimalCents(cents):'';
    }
  });
  regionalDetails.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.isComposing&&event.target.matches('[data-final-quote]')){
      event.preventDefault();event.target.blur();
    }
  });
  document.body.append(estimateFilterMenu);
  for(const heading of $$('[data-estimate-column]')){
    const button=document.createElement('button'),label='筛选'+heading.textContent;
    button.type='button';button.className='estimate-filter-trigger';
    button.dataset.column=heading.dataset.estimateColumn;button.dataset.label=label;
    button.setAttribute('aria-label',label);button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','estimate-filter-menu');
    button.onclick=()=>openEstimateFilter(button);
    heading.append(button);estimateFilterButtons.push(button);
  }
  estimateFilterSearch.addEventListener('input',()=>{renderEstimateFilterOptions();positionEstimateFilter();});
  estimateFilterOptions.addEventListener('click',event=>{
    const button=event.target.closest('button[data-value]');
    if(button)setEstimateFilter(button.dataset.value);
  });
  estimateFilterValue.addEventListener('input',()=>estimateFilterValue.setCustomValidity(''));
  estimateFilterForm.addEventListener('submit',event=>{
    event.preventDefault();
    const value=estimateFilterValue.value.normalize('NFKC').trim();
    if (estimateFilterAnchor?.dataset.column!=='amount'||!value) {setEstimateFilter(value);return;}
    let cents;
    try {cents=C.money(value);} catch(error) {
      estimateFilterValue.setCustomValidity(error.message);
      estimateFilterValue.reportValidity();
      return;
    }
    setEstimateFilter(cents);
  });
  $('#estimate-filter-reset').addEventListener('click',()=>setEstimateFilter(''));
  document.addEventListener('pointerdown',event=>{
    if(estimateFilterAnchor&&!estimateFilterMenu.contains(event.target)&&!estimateFilterAnchor.contains(event.target))closeEstimateFilter();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&estimateFilterAnchor){event.preventDefault();closeEstimateFilter(true);}
  });
  estimateScroll.addEventListener('scroll',positionEstimateFilter);
  globalThis.addEventListener('resize',positionEstimateFilter);
  globalThis.addEventListener('scroll',positionEstimateFilter);
  $('#estimate-filter-clear').addEventListener('click',()=>{
    estimateFilters.clear();
    estimatePage=1;
    estimateScroll.scrollTop=0;
    renderEstimates();
  });
  estimatePageSize.addEventListener('change',()=>{
    closeEstimateFilter();
    estimatePage=1;
    estimateScroll.scrollTop=0;
    renderEstimates();
  });
  estimatePagination.addEventListener('click',event=>{
    const button=event.target.closest('button[data-estimate-page]');
    if(!button||button.disabled)return;
    const page=Number(button.dataset.estimatePage);
    if(page===estimatePage)return;
    closeEstimateFilter();
    estimatePage=page;
    estimateScroll.scrollTop=0;
    renderEstimates();
    estimatePagination.querySelector('[aria-current=page]')?.focus({preventScroll:true});
  });
  $('#comparison').addEventListener('input', event => {
    if(event.target.id==='estimate-rounding'){
      const carry=latestRegionalEstimate?{projectKey:latestRegionalEstimate.projectKey,lines:readRegionalPrices().lines}:roundingCarry;
      state.quote.rounding=event.target.value;
      fillQuoteForm();
      showRegionalResult();
      roundingCarry=carry;
      showRegionMessage('');
      update();
      return;
    }
    if (!['quote-region','estimate-tax','estimate-factor'].includes(event.target.id)) return;
    $('#quote-region').removeAttribute('aria-invalid');
    showRegionalResult();
    showRegionMessage('');
  });
  $('#estimate-factor').addEventListener('blur',event=>{
    const input=event.currentTarget,number=input.value.normalize('NFKC').trim().replace(/\s*%$/u,'');
    if(validPricePercent(number))input.value=number+'%';
  });
  globalThis.addEventListener('storage', event => {
    if(event.key?.startsWith(ESTIMATE_DELETION_PREFIX)){renderEstimates();return;}
    if (!event.key || event.key.startsWith(ESTIMATE_PREFIX) || event.key.startsWith(ESTIMATE_OUTCOME_PREFIX)) {
      if (deliveryStore) void reloadLedger();
      else renderEstimates();
    }
  });
  document.addEventListener('input',e=>{
    const form=$('#client-form');if(e.target.form!==form)return;
    const previous=state.client,ids=comparisonIds();state.client=formRead(form);if(e.target.name!=='team'){intakeChanged=true;syncList();showRegionalResult();showRegionMessage('');}
    for(const [slot,key] of ['location','team'].entries()){
      if(e.target.name!==key||previous[key]===state.client[key])continue;
      const id=provinceForLocation(state.client[key]);
      ids[slot]=id;state.comparisonProvinceIds=ids;state.selectedProvince=ids[0];ensureRule(id,true);activeRule=id;ruleDraft=null;
    }
    update();
  });$('#quote-form').addEventListener('input',e=>{const q=formRead($('#quote-form'));delete q.roundingUnit;if(state.quote.pricePercent===undefined&&e.target.name!=='pricePercent')delete q.pricePercent;state.quote={...state.quote,...q};state.quote.rounding=$('#rounding-enabled').checked?$('#rounding-unit').value:'none';$('#rounding-unit').disabled=!$('#rounding-enabled').checked;syncEstimateAdjustments();update();});
  $$('[data-view]:not([data-nav-audit-step]):not([data-nav-section]):not([data-report-section])').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('[data-quote-home]').addEventListener('click',()=>setView('quote'));
  $('#quote-nav-toggle').addEventListener('click',event=>{
    const items=$('#quote-nav-items');
    items.hidden=!items.hidden;
    event.currentTarget.setAttribute('aria-expanded',String(!items.hidden));
  });
  $$('[data-home-view]').forEach(b=>b.addEventListener('click',()=>{setView(b.dataset.homeView);$('#page-title').scrollIntoView?.({block:'start'});}));
  $('#report-back-to-overview').addEventListener('click',()=>{
    if(setView('audit',{overviewProject:$('#report-project')?.value||''}))$('#page-title').scrollIntoView({block:'start'});
  });

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
    $('#quote-inquiry').reset();
    quoteExtras?.clear();batchQuote?.reset();
    tenderTicket++;tenderPending=false;hasTender=false;activeTenderSource=null;importedTender=null;intakeChanged=!!state.auditeeRegister;
    $('#tender-file').value='';$('#tender-status').textContent='';
    renderTenderFiles([]);
    $('#quote-region').value='';$('#quote-region').removeAttribute('aria-invalid');showRegionMessage('');
    const reg=state.auditeeRegister;if(subjectList)subjectList.load(reg?reg.rows:[projectRow(state.client)],reg?reg.active:0);
    showRegionalResult();
  }
  function clearBidder(){
    selectedBidder=null;proposalEpoch++;
    $('#quote-template-status').textContent='';
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
  function connectQuoteDrop(input,dropzone,status,onFile){
    const choose=files=>{
      const selected=Array.from(files||[]);
      if(!selected.length)return;
      if(input.multiple)onFile(selected);
      else if(selected.length===1)onFile(selected[0]);
      else status.textContent='请每次拖入一个文件。';
    };
    input.addEventListener('change',()=>choose(input.files));
    dropzone.addEventListener('dragover',event=>{
      if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
      event.preventDefault();event.dataTransfer.dropEffect='copy';dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop',event=>{
      event.preventDefault();dropzone.classList.remove('is-dragover');
      choose(event.dataTransfer?.files);
    });
  }
  function renderTenderFiles(entries){
    const list=$('#tender-files');
    list.hidden=!entries.length;
    list.replaceChildren(...entries.map(({file,message,accepted})=>{
      const item=document.createElement('li'),name=document.createElement('strong'),note=document.createElement('small');
      name.textContent=file.name;note.className='muted';note.textContent=message;item.append(name,note);
      if(accepted){
        const download=document.createElement('button');
        download.type='button';download.className='btn';download.textContent='下载原件';
        download.setAttribute('aria-label','下载招标原件 '+file.name);
        download.onclick=()=>blobDownload(file.name,file,file.type||'application/octet-stream');
        item.append(download);
      }
      return item;
    }));
  }
  function connectQuoteReference(){
    const input=$('#quote-reference-input'),status=$('#quote-reference-status');
    const preview=$('#quote-reference-preview');
    connectQuoteDrop(input,$('#quote-reference-dropzone'),status,file=>{
      input.value='';
      if(!/\.(docx|pdf)$/i.test(file.name)){status.textContent='请选择 .docx 或 .pdf 文件。';return;}
      if(!file.size||file.size>100_000_000){status.textContent='请选择有内容且不超过 100 MB 的文件。';return;}
      quoteReferenceFile=file;
      $('#quote-reference-name').textContent=file.name;
      $('#quote-reference-file').hidden=false;
      preview.hidden=!globalThis.AuditAttachmentPreview||(!/\.docx$/iu.test(file.name)&&file.size>12*1024*1024);
      status.textContent=/\.docx$/iu.test(file.name)?'上传成功':'已保存 PDF 供参考。整套替换请上传可编辑的 .docx。';
      refreshQuoteDownloadControls();
    });
    preview.addEventListener('click',()=>{
      const reference=quoteReferenceFile;
      if(reference)globalThis.AuditAttachmentPreview?.open({blob:reference,name:reference.name,quotationWord:true});
    });
    $('#quote-reference-download').addEventListener('click',()=>{
      const reference=quoteReferenceFile;
      if(reference)blobDownload(reference.name,reference,reference.type||'application/octet-stream');
    });
  }
  function clearTenderModule(){
    tenderTicket++;proposalEpoch++;tenderPending=false;hasTender=false;activeTenderSource=null;
    $('#tender-file').value='';
    renderTenderFiles([]);
    const source=importedTender;
    importedTender=null;
    if(source){
      const {rows,active}=subjectList.snapshot();
      const importedRows=new Set(source.rows.map(canonical));
      const remaining=rows.filter(row=>!importedRows.has(canonical(row)));
      const next=remaining.length?remaining:[projectRow({})];
      const index=Math.max(0,next.indexOf(rows[active]));
      batchQuote?.reset();
      subjectList.load(next,index);
      state.auditeeRegister=subjectList.snapshot();
      const form=$('#proposal-form').elements;
      for(const key of ['issuer','projectName','contactName','contactInfo','riskLevel','projectType']){
        if(form[key].value!==source.fields[key])continue;
        if(key==='projectType')tenderProjectType();else form[key].value='';
      }
      if($('#issuer-email').value===source.email)$('#issuer-email').value='';
      chooseSubject(next[index],true);
      if(!latestRegionalEstimate?.inquiry){showRegionalResult();showRegionMessage('');}
    }
    $('#inquiry-source-note').hidden=!$('#inquiry-text').value.trim()||(subjectList?.snapshot().rows.length||0)<2;
    $('#tender-status').textContent='已清空招标资料。';
    refreshProposalControls();
  }
  function connectQuoteClearButtons(){
    const onClear=(id,confirmationLabel,clear,checkpoint=false)=>{
      $(id).addEventListener('click',async()=>{
        if(confirmationLabel&&!confirm('确认清空本轮'+confirmationLabel+'？'))return;
        clear();
        if(checkpoint&&pageDrafts){
          try{await pageDrafts.checkpoint('quote');}
          catch(error){SaveFeedback.failed(error,'已清空当前输入，本机暂存更新失败。');}
        }
      });
    };
    onClear('#clear-tender','招标资料及其带入的信息',clearTenderModule,true);
    onClear('#clear-inquiry',null,()=>{
      // A reload can interrupt the asynchronous draft write after the field has cleared.
      try{sessionStorage.setItem(INQUIRY_CLEARED_AT,String(Date.now()));}catch{}
      const input=$('#inquiry-text');
      input.value='';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.focus();
    },true);
    onClear('#clear-quote-reference','以往报价参考资料',()=>{
      quoteReferenceFile=null;
      $('#quote-reference-input').value='';
      $('#quote-reference-name').textContent='';
      $('#quote-reference-file').hidden=true;
      $('#quote-reference-status').textContent='已清空以往报价参考资料。';
      $('#quote-template-status').textContent='';
      refreshQuoteDownloadControls();
    });
  }
  function connectIntake(){
    if(globalThis.AuditeeRows)subjectList=globalThis.AuditeeRows.mount({getClient:()=>state.client,onSelect:row=>{const linked=(hasTender||subjectList.snapshot().rows.length>1)&&proposalKey===currentProposalKey();chooseSubject(row,linked);},onEdit:()=>{intakeChanged=true;proposalEpoch++;state.auditeeRegister=subjectList.snapshot();showRegionalResult();showRegionMessage('');refreshProposalControls();}});
    if(globalThis.BidderUI)bidderPicker=globalThis.BidderUI.connect({apply:applyBidder,detach:clearBidder,compactPicker:true});
    const picker=$('#tender-file');
    connectQuoteDrop(picker,$('#tender-dropzone'),$('#tender-status'),importTender);
    connectQuoteReference();
    connectQuoteClearButtons();
    async function importTender(files){
      if(!files.length)return;const ticket=++tenderTicket,epoch=proposalEpoch,status=$('#tender-status');
      tenderPending=true;refreshProposalControls();status.textContent='正在识别…';
      try{
        if(!globalThis.TenderImport||!subjectList)throw Error('识别组件未加载，请打开完整版本。');
        const entries=[],results=[];
        const hasFields=result=>result.auditees.length||[result.issuer,result.projectName,result.customerName,result.contactName,result.phone,result.email,result.auditYear,result.riskLevel,result.projectType].some(Boolean);
        for(const file of files){
          if(ticket!==tenderTicket)return;
          const accepted=/\.(?:docx?|xlsx?|pdf|txt)$/iu.test(file.name)&&file.size>0&&file.size<=100_000_000;
          let message='未加入，请选择支持的非空文件，单份不超过 100 MB。';
          if(accepted){
            try{
              const found=await globalThis.TenderImport.read(file);
              if(hasFields(found)){results.push(found);message='已识别招标信息';}
              else message='原件已加入，请手填未识别的招标信息。';
            }catch(error){message='原件已加入。'+error.message;}
          }
          entries.push({file,accepted,message});
        }
        if(ticket!==tenderTicket)return;
        if(epoch!==proposalEpoch)throw Error('读取期间表单已改变，请再次选择文件。');
        if(!entries.some(entry=>entry.accepted))throw Error(entries.map(entry=>entry.file.name+'：'+entry.message).join(' '));
        if((intakeChanged||hasTender||activeRecordId)&&!confirm('替换当前招标资料？')){status.textContent='已取消上传';return;}
        const found=results.length===1?{...results[0],conflicts:[]}:globalThis.TenderImport.merge(results);
        const identityConflict=found.conflicts.some(field=>['发标单位','项目名称','审计年度'].includes(field));
        const rows=found.auditees.map(row=>({...row,location:normalPlace(row.location),year:row.year||found.auditYear}));
        const validRows=!rows.length||globalThis.AuditeeRows.valid({rows,active:0});
        if(results.length&&!identityConflict&&validRows){
          const project=coreProjectName(found.projectName),year=found.auditYear||/^((?:19|20)\d{2})年/.exec(project)?.[1]||'';
          const subjects=rows.length?rows:[projectRow({clientName:found.customerName,year})];
          batchQuote?.reset();subjectList.load(subjects,0);state.auditeeRegister=subjectList.snapshot();
          chooseSubject(subjects[0],true);tenderProjectType(found.projectType);
          formFill($('#proposal-form'),{issuer:found.issuer,projectName:project,contactName:found.contactName,contactInfo:found.phone,riskLevel:found.riskLevel||''});
          $('#issuer-email').value=found.email;
          const form=$('#proposal-form').elements;
          importedTender={rows:subjectList.snapshot().rows,fields:{
            issuer:form.issuer.value,projectName:form.projectName.value,contactName:form.contactName.value,
            contactInfo:form.contactInfo.value,riskLevel:form.riskLevel.value,projectType:form.projectType.value
          },email:$('#issuer-email').value};
          quoteExtras?.clear();intakeChanged=false;activeRecordId=null;
        }
        hasTender=true;
        activeTenderSource=entries.find(entry=>entry.accepted&&/\.docx$/iu.test(entry.file.name))?.file||null;
        proposalEpoch++;renderTenderFiles(entries);
        showRegionalResult();showRegionMessage('');
        const note=identityConflict?'招标身份信息有冲突，表单保留原输入。':!validRows?'主体字段超出表单范围，请手动核对。':
          !results.length?'请手填招标信息。':found.conflicts.length?'请核对：'+found.conflicts.join('、')+'。':'';
        const summary=entries.length===1&&results.length?'上传成功':'已加入 '+entries.filter(entry=>entry.accepted).length+' 份招标资料，识别 '+results.length+' 份。';
        status.textContent=summary+(found.auditeeOverflow?'，仅带入前 50 家单位。':'')+note;
      }catch(err){if(ticket===tenderTicket)status.textContent='未导入，原有资料未改变：'+err.message;}
      finally{if(ticket===tenderTicket){picker.value='';tenderPending=false;refreshProposalControls();}}
    }
  }
  sourceList();hydrate();renderHistory();connectProposal();connectIntake();renderEstimates();
  if(subjectList&&globalThis.BatchQuote)batchQuote=globalThis.BatchQuote.mount($('#quote-batch'),{getRegister:()=>subjectList.snapshot(),estimateRow:estimateBatchRow,getEstimateKey:batchEstimateKey,getFinal:()=>restoredNeedsReview?null:finalResult,getTax:()=>state.quote.tax,onChange:()=>{proposalEpoch++;refreshProposalControls();},format:fmt});
  refreshProposalControls();connectProjectInitiation();setView('home');
  globalThis.WorkspaceRecordTables?.mount($('main'));
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
  if(globalThis.AuditProgram&&globalThis.ProjectInitiation?.listSaved)auditProgram=globalThis.AuditProgram.mount($('#audit-program'),{
    compact:true,
    async listProjects(){
      const projects=await globalThis.ProjectInitiation.listSaved();
      const workspaces=await Promise.allSettled(projects.map(project=>globalThis.ProjectWorkspaceStore?.get(project.quoteId)));
      return projects.map((project,index)=>({...project,companyName:workspaces[index].value?.projectInitiationDetails?.companyName}));
    },
    onProjectReady:restoreMaterialDraft
  });
  $('#audit-checklist-export').addEventListener('click',async event=>{
    const mode=event.target.closest('[data-checklist-export]')?.dataset.checklistExport;
    if(!mode)return;
    event.currentTarget.open=false;
    try{
      if(!auditProgram?.exportChecklist)throw Error('资料清单组件尚未加载。');
      const count=await auditProgram.exportChecklist(mode);
      SaveFeedback.exported('已导出 '+count+' 项资料。');
    }catch(error){SaveFeedback.exportFailed(error);}
  });
  if(globalThis.WorkpaperWorkspace&&auditProgram)workpaperWorkspace=globalThis.WorkpaperWorkspace.mount($('#audit-program'));
  if(globalThis.AuditWorkflow&&globalThis.AuditChecklist&&globalThis.ProjectWorkspaceStore)auditWorkflow=globalThis.AuditWorkflow.mount($('#audit-flow'),{
    listProjects:listBidProjects,openStage:openAuditWorkflowStage
  });
  if(globalThis.WorkspaceNavigation)workspaceNavigation=globalThis.WorkspaceNavigation.mount({document,setView,getView:()=>view,notify:toast,onAuditStep:updateAuditHeading,onReportSection:section=>{
    const result=reportWorkspace?.selectSection?reportWorkspace.selectSection(section):reportWorkspace?.show?.(section);
    if(result!==false)updateReportHeading(section);
    return result;
  }});
  if(globalThis.AppSettings)try{globalThis.AppSettings.applyPreferences(globalThis.AppSettings.readPreferences(),document);}catch{}
  function draftNotice(text,bad=false){const e=$('#page-save-status');if(e&&!e.hidden){e.textContent=text;e.classList.toggle('error',bad);}}
  function materialDraftScope(){
    const selector=$('#ac-project');
    return selector?.value&&!selector.closest('[hidden]')?{kind:'audit-fields',projectId:selector.value,stage:'1'}:null;
  }
  const materialDraftIds=['ac-reviewer','ac-search'];
  const materialDraftFields={accept:input=>materialDraftIds.includes(input.id)};
  $('#audit-program').addEventListener('input',event=>{if(materialDraftFields.accept(event.target))materialInputEpoch++;});
  function restoreMaterialDraft(projectId){
    const scope=materialDraftScope();
    if(!pageDrafts||scope?.projectId!==projectId)return;
    if(materialDraftReady?.projectId===projectId)return materialDraftReady.promise;
    const task={projectId,epoch:materialInputEpoch};
    materialDraftReady=task;
    task.promise=pageDrafts.restore('audit',{scope}).then(result=>{
      if(result.restored&&materialDraftScope()?.projectId===projectId)draftNotice('已恢复本项目暂存');
    }).catch(error=>{
      if(materialDraftScope()?.projectId===projectId)draftNotice(error.message,true);
    });
    return task.promise;
  }
  async function pageScope(name){
    if(['quote','proposal','bid'].includes(name))return {kind:'quote-input',instanceId:'current-quote'};
    if(name==='rules')return {kind:'fee-rule',recordId:activeRule};
    if(name==='project')return projectInitiation?.detailsScope?.()||null;
    if(name==='audit'){
      const collection=materialDraftScope();
      if(collection)return collection;
      if(!$('#audit-flow').hidden)return null;
      const c=await workpaperWorkspace?.capturePending?.();if(c)return c.scope;
      const project=$('#pw-project')?.value,stage=$('.pw-steps [aria-pressed=true]')?.dataset.auditStep;
      return project&&stage&&stage!=='1'?{kind:'audit-fields',projectId:project,stage}:null;
    }
    if(name==='costs')return projectCosts?.draftScope?.()||{kind:'project-costs',instanceId:'current-device'};
    if(name==='travel')return travelExpenses?.draftScope?.()||{kind:'travel-expenses',instanceId:'current-device'};
    if(name==='bidders')return bidderPicker?.draftScope?.()||null;
    if(name==='report'){const project=$('#report-project')?.value;return project?{kind:'report-fields',projectId:project}:null;}
    if(name==='settings')return {kind:'settings-fields',instanceId:'current-device'};
    return {kind:'page-fields',instanceId:name};
  }
  function captureQuoteDraft(){
    const estimateControls={region:$('#quote-region').value,tax:$('#estimate-tax').value,factor:$('#estimate-factor').value,rounding:$('#estimate-rounding').value};
    const record=latestRegionalEstimate;
    const previewState={
      estimateId:record?.id||'',projectCode:record?.projectCode||'',
      previewOnly:record&&!regionalRecordSaved?'yes':'',baseFinalQuotes:record?.finalQuotes||[],
      finalInputs:$$('#estimate-details [data-final-quote]').map(input=>input.value)
    };
    syncList();const rows=$$('[data-batch-amount]').map(e=>({row:e.dataset.batchAmount,value:e.value}));
    return {scope:{kind:'quote-input',instanceId:'current-quote'},values:{snapshot:JSON.stringify(state),proposal:formRead($('#proposal-form')),issuerEmail:$('#issuer-email').value,bidderContact:$('#bidder-contact').value,bidderPhone:$('#bidder-phone').value,bidderEmail:$('#bidder-email').value,bidderId:selectedBidder?.id||'',bidderVersion:selectedBidder?.version||0,layouts:JSON.stringify(selectedLayouts()),batchRows:rows,inquiry:formRead($('#quote-inquiry')),importedTender,estimateControls,...previewState}};
  }
  async function restoreQuoteDraft(value,{savedAt}){
    if(draftQuoteEpoch.value!==null&&draftQuoteEpoch.value!==proposalEpoch)throw Error('你已修改当前报价，未用旧暂存覆盖新输入。');const next=JSON.parse(value.snapshot||'null');if(!validStoredRecord({id:'temporary',savedAt:new Date().toISOString(),totalCents:0,appVersion:'0.1',snapshot:next,calculation:{quote:{totalCents:0}}}))throw Error('报价暂存格式不兼容，原数据未覆盖。');
    if(!value.proposal||typeof value.proposal!=='object'||Object.values(value.proposal).some(v=>typeof v!=='string'||v.length>2000))throw Error('报价登记暂存字段无效。');
    state=next;activeRecordId=null;restoredNeedsReview=false;hydrate();resetIntakeView();tenderProjectType(value.proposal.projectType);formFill($('#proposal-form'),{riskLevel:'',...value.proposal});$('#issuer-email').value=value.issuerEmail||'';$('#bidder-contact').value=value.bidderContact||'';$('#bidder-phone').value=value.bidderPhone||'';$('#bidder-email').value=value.bidderEmail||'';
    selectedBidder=null;if(value.bidderId){let db;try{db=await globalThis.BidderLibrary.open();const bidder=await db.get(value.bidderId);if(!bidder||bidder.version!==value.bidderVersion)throw Error('暂存的事务所版本已更新，请重新选择事务所；手填信息已保留。');selectedBidder={id:bidder.id,name:bidder.name,version:bidder.version,signingKinds:[],attachments:bidder.attachments.filter(a=>Object.hasOwn(credentialLabels,a.kind))};}finally{db?.close?.();}}
    bidderPicker?.restorePicker?.(selectedBidder);quoteSigning?.restore?.(JSON.parse(value.layouts||'{}'));proposalKey=currentProposalKey();proposalEpoch++;batchQuote?.refresh();for(const row of value.batchRows||[]){const e=$('[data-batch-amount="'+String(row.row).replace(/[^0-9]/g,'')+'"]');if(e&&typeof row.value==='string'){e.value=row.value;e.dispatchEvent(new Event('input',{bubbles:true}));}}
    restoreInquiry(value.inquiry);
    try{
      const clearedAt=Number(sessionStorage.getItem(INQUIRY_CLEARED_AT));
      if(clearedAt&&Date.parse(savedAt)<=clearedAt&&$('#inquiry-text').value){
        $('#inquiry-text').value='';
        value={...value,estimateId:'',previewOnly:'',finalInputs:[]};
      }else if(clearedAt&&Date.parse(savedAt)>clearedAt){
        sessionStorage.removeItem(INQUIRY_CLEARED_AT);
      }
    }catch{}
    if(value.importedTender?.fields&&globalThis.AuditeeRows?.valid({rows:value.importedTender.rows,active:0})){
      importedTender=value.importedTender;
    }
    const estimate=value.estimateId&&readEstimates().records.find(record=>record.id===value.estimateId);
    if(estimate){
      $('#quote-region').value=byId(estimate.provinceId).name;
      const tax=estimate.taxRate?.replace(/%$/u,'');
      if(ESTIMATE_TAX_RATES.includes(tax))$('#estimate-tax').value=tax;
      $('#estimate-rounding').value=estimate.rounding??state.quote.rounding??'none';
      if(validPricePercent(estimate.pricePercent))$('#estimate-factor').value=estimate.pricePercent+'%';
      showRegionalResult(estimate,true);
    }else refreshProposalControls();
    if(value.estimateControls){
      const {region,tax,factor,rounding}=value.estimateControls;
      $('#quote-region').value=region;$('#estimate-tax').value=tax;$('#estimate-factor').value=factor;$('#estimate-rounding').value=rounding;
      if(!estimate&&value.previewOnly==='yes'){
        $('#comparison').requestSubmit();
        if(latestRegionalEstimate&&PROJECT_CODE.test(value.projectCode)&&PROJECT_CODE.test(value.estimateId)){
          Object.assign(latestRegionalEstimate,{id:value.estimateId,code:value.projectCode,projectCode:value.projectCode});
        }
      }
    }
    const samePrices=!estimate||(value.previewOnly!=='yes'&&JSON.stringify(estimate.finalQuotes||[])===JSON.stringify(value.baseFinalQuotes));
    if(latestRegionalEstimate&&samePrices&&Array.isArray(value.finalInputs)){
      $$('#estimate-details [data-final-quote]').forEach((input,i)=>{if(typeof value.finalInputs[i]==='string')input.value=value.finalInputs[i];});
      refreshRegionalPrices();
      refreshProposalControls();
    }
  }
  async function restorePageDraft(name){try{if(name==='project')await projectPageReady;if(name==='audit')await auditPageReady;if(name==='costs')await projectCosts?.ready;if(name==='travel')await travelExpenses?.ready;const storageView=['proposal','bid'].includes(name)?'quote':name;if(storageView==='quote'){if(draftRestored.has('quote-restored'))return;draftRestored.add('quote-restored');draftQuoteEpoch.value=proposalEpoch;}const scope=await pageScope(name);if(!scope)return;if(name==='audit'&&scope.kind==='audit-fields'&&scope.stage==='1')return restoreMaterialDraft(scope.projectId);const result=await pageDrafts.restore(storageView,{scope});draftQuoteEpoch.value=null;if(view===name&&result.restored)draftNotice('已恢复暂存 · '+new Date(result.savedAt).toLocaleString('zh-CN'));}catch(err){draftQuoteEpoch.value=null;if(view===name)draftNotice(err.message,true);}}
  function noDraftReason(name){
    if(name==='audit'&&!$('#pw-project')?.value&&!$('#ac-project')?.value&&!auditWorkflow?.selectedProject())return '请先选择审计项目。';
    if(name==='report'&&!$('#report-project')?.value)return '请先选择审计项目。';
    if(name==='archive')return '请在归档页选择项目，并使用「保存明确的附件关联」。';
    if(name==='templates')return '请选择模板文件，并使用「保存所选原件」。';
    if(name==='project')return '请打开已立项项目并填写或修改立项资料。';
    return '当前页面没有可暂存的输入。';
  }
  if(globalThis.PageDrafts)try{
    pageDrafts=globalThis.PageDrafts.create();
    for(const name of ['home','quote','proposal','bid','rules','ledger','project','audit','report','archive','templates','travel','costs','accounting','basics','bidders','settings'])pageDrafts.registerAdapter(name,{
      scope:()=>pageScope(name)||{},
      async capture(){if(['quote','proposal','bid'].includes(name))return captureQuoteDraft();if(name==='project')return projectInitiation?.capturePending?.()||null;if(name==='audit'){const scope=materialDraftScope();if(scope){const fields=PageDrafts.captureFields($('#audit-program'),materialDraftFields);return fields?{scope,values:{fields}}:null;}const c=await workpaperWorkspace?.capturePending?.();if(c)return c;}if(name==='costs'&&projectCosts?.capturePending)return projectCosts.capturePending();if(name==='travel'&&travelExpenses?.capturePending)return travelExpenses.capturePending();if(name==='bidders'&&bidderPicker?.capturePending)return bidderPicker.capturePending();if(name==='rules'&&$('#rules-form'))return {scope:await pageScope(name),values:{rule:JSON.stringify(ruleDraft),form:JSON.stringify(formRead($('#rules-form'))),tiers:$$('[data-tier]',$('#rules-form')).map(x=>({index:x.dataset.tier,field:x.dataset.field,value:x.value}))}};const scope=await pageScope(name),host=$('#view-'+name);if(!scope||!host)return null;const values=globalThis.PageDrafts.captureFields(host);return values?{scope,values:{fields:values}}:null;},
      async restore(values,meta){if(['quote','proposal','bid'].includes(name))return restoreQuoteDraft(values,meta);if(name==='project')return projectInitiation.restorePending(values,meta);if(name==='audit'&&['workpaper-input','workpaper-directory'].includes(meta.scope.kind))return workpaperWorkspace.restorePending(values,meta);if(name==='audit'&&meta.scope.kind==='audit-fields'&&meta.scope.stage==='1'){const scope=materialDraftScope();if(scope?.projectId!==meta.scope.projectId||materialDraftReady?.epoch!==materialInputEpoch)throw Error('当前资料核对输入已变化，旧暂存仍保留。');const fields={};for(const id of materialDraftIds){const key=JSON.stringify({id,row:[]});if(Object.hasOwn(values.fields,key))fields[key]=values.fields[key];}return PageDrafts.restoreFields($('#audit-program'),fields,materialDraftFields);}if(name==='costs'&&projectCosts?.restorePending)return projectCosts.restorePending(values,meta);if(name==='travel'&&travelExpenses?.restorePending)return travelExpenses.restorePending(values,meta);if(name==='bidders'&&bidderPicker?.restorePending)return bidderPicker.restorePending(values,meta);if(name==='rules'){if(meta.scope.recordId!==activeRule)throw Error('收费地区已变化，未恢复其他省份的暂存。');const rule=JSON.parse(values.rule);if(!rule||rule.id!==activeRule||!Array.isArray(rule.tiers))throw Error('规则暂存格式不匹配。');ruleDraft=rule;renderRules(true);formFill($('#rules-form'),JSON.parse(values.form));for(const t of values.tiers){const node=$('[data-tier="'+String(t.index).replace(/[^0-9]/g,'')+'"][data-field="'+String(t.field).replace(/[^a-zA-Z]/g,'')+'"]',$('#rules-form'));if(node)node.value=t.value;}return {restored:1};}if(globalThis.PageDrafts.scopeKey(name,await pageScope(name)||{})!==globalThis.PageDrafts.scopeKey(name,meta.scope))throw Error('项目或页面范围已变化，未恢复旧字段。');return globalThis.PageDrafts.restoreFields($('#view-'+name),values.fields);}
    });
    $('#page-save').onclick=()=>{
      const detail=view==='project'&&$('#project-info-draft');
      if(detail)detail.click();else void checkpointPageDraft();
    };
    draftRestored.add('quote');void restorePageDraft('quote');
  }catch(err){
    const unavailable=()=>draftNotice('保存失败 · '+SaveFeedback.failed(err),true);
    unavailable();
    $('#page-save').onclick=unavailable;
  }
  async function checkpointPageDraft(scope){
    const page=view,name=['proposal','bid'].includes(page)?'quote':page,b=$('#page-save');
    const isProjectDraft=scope?.kind==='project-information';
    const saveFeedback=isProjectDraft?SaveFeedback.drafted:SaveFeedback.saved;
    const failFeedback=isProjectDraft?SaveFeedback.draftFailed:SaveFeedback.failed;
    if(b.disabled)return false;
    b.disabled=true;
    draftNotice('正在暂存到本机…');
    try{
      if(!pageDrafts)throw Error('本机暂存组件不可用。');
      if(name==='costs')await projectCosts?.ready;
      if(name==='travel')await travelExpenses?.ready;
      const collection=name==='audit'&&materialDraftScope();
      if(collection)await restoreMaterialDraft(collection.projectId);
      const requestedScope=collection||scope;
      const result=await pageDrafts.checkpoint(name,requestedScope?{scope:requestedScope}:{});
      if(!result.saved)throw Error(isProjectDraft?'请先填写或修改立项资料，再暂存。':noDraftReason(name));
      const message=saveFeedback('已暂存本页输入 · '+new Date(result.savedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' · 仅本机');
      if(view===page)draftNotice(message);
      return true;
    }catch(error){
      const reason=failFeedback(error);
      if(view===page)draftNotice((isProjectDraft?'暂存失败':'保存失败')+' · '+reason,true);
      return false;
    }finally{b.disabled=false;}
  }
  syncDocumentScope();refreshProposalControls();
})();
