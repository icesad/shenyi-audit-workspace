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
  const EN = {gx:'GUANGXI',hb:'HEBEI',sh:'SHANGHAI'};
  const provinces=globalThis.RuleCatalog.PROVINCES;
  const idFor=p=>({'450000':'gx','130000':'hb','310000':'sh'}[p.code]||p.code);
  const byId=id=>provinces.find(p=>idFor(p)===id);
  function blankRule(p){return {id:idFor(p),name:p.name,document:'未配置',status:'missing',sourceUrl:'',version:'未配置',basis:'assets',mode:'fixed',minimumYuan:0,fixedYuan:null,tiers:[],notes:'该地区尚未配置规则；自定义规则仅为本所草稿，未核定。'};}
  function selectOptions(){
    const legacy={gx:'广西',hb:'河北',sh:'上海'};
    for(const name of ['location','team']) {const select=$('#client-form').elements.namedItem(name);select.innerHTML=provinces.map(p=>`<option value="${esc(legacy[idFor(p)]||p.name)}">${esc(p.name)}${p.scopePending?'（适用范围待确认）':''}</option>`).join('')+'<option value="其他地区">其他地区（旧记录）</option>';}
    $('#comparison-province').innerHTML='<option value="">待确认客户地区</option>'+provinces.map(p=>`<option value="${esc(idFor(p))}">${esc(p.name)}${p.scopePending?'（适用范围待确认）':''}</option>`).join('');
  }
  function selectedId(){return byId(state.selectedProvince)?state.selectedProvince:'';}
  function provinceForLocation(location){const legacy={广西:'gx',河北:'hb',上海:'sh'},p=provinces.find(x=>x.name===location);return legacy[location]||(p&&idFor(p))||'';}
  function ensureSelected(){const id=selectedId(),p=byId(id);state.selectedProvince=id;if(p&&!state.rules.some(r=>r.id===id))state.rules.push(blankRule(p));}
  function comparisonRules(){const ids=[selectedId(),'hb','sh'];return [...new Set(ids)].map(id=>state.rules.find(r=>r.id===id)).filter(Boolean);}
  function syncProvince(){ensureSelected();const id=selectedId(),p=byId(id);$('#comparison-province').value=id;$('#province-hint').textContent='客户所在地：'+(state.client.location||'待确认')+'；比较地区：'+(p?.name||'待确认')+'。 '+(!p?'请先选择比较省级地区。':p.scopePending?'比较地区业务适用范围、币种及规则待确认，暂不计算。':(['hb','sh'].includes(id)?'与固定参考地区重复，已合并展示。':'无规则时不计算；比较地区可独立选择。'));
    const basis=$('#quote-form').elements.namedItem('basis');basis.innerHTML='<option value="budget">本所工时预算</option>'+comparisonRules().map(r=>`<option value="${esc(r.id)}">${esc(r.name)}参考（待核定）</option>`).join('')+'<option value="manual">手工输入报价</option>';if(!['budget','manual',...comparisonRules().map(r=>r.id)].includes(state.quote.basis))state.quote.basis='budget';basis.value=state.quote.basis;
  }
  const STORE = 'hengdu.audit.quote.records.v1';
  const initialRules = clone(globalThis.REGION_REFERENCE || []);
  const defaultBudget = [{role:'项目负责人',hours:'24',rateYuan:'600'},{role:'审计助理',hours:'48',rateYuan:'300'},{role:'质量复核',hours:'4',rateYuan:'1200'}];
  const defaults = () => ({schema:1,client:{clientName:'示例科技有限公司（演示）',location:'广西',team:'河北',year:'2025',service:'年度财务报表审计',assets:'3000',revenue:'2000',profit:'100'},quote:{basis:'budget',manual:'30000',discount:'10',extra:'0',tax:'0',reason:'仅供初步沟通；税费、差旅范围及交付时间待双方确认。'},budget:clone(defaultBudget),rules:clone(initialRules)});
  let state = defaults(), ruleDraft = null, activeRule = 'gx', view = 'quote', outputs = {}, budgetResult = null, finalResult = null, records = [], readError = false;
  // Never discard unknown records: an older app must not overwrite data it cannot understand.
  let storedRaw = null, storageReadable = true;
  function ruleNameMatches(rule) { const p=byId(rule.id); if(!p || typeof rule.name!=='string')return false; const shortName=p.name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/, ''); return rule.name===p.name || rule.name===shortName; }
  function validStoredRecord(r) {
    return !!r && typeof r === 'object' && typeof r.id === 'string' && !!r.id &&
      typeof r.savedAt === 'string' && Number.isFinite(Date.parse(r.savedAt)) &&
      Number.isSafeInteger(r.totalCents) && r.totalCents >= 0 &&
      r.appVersion === '0.1' && r.snapshot && r.snapshot.schema === 1 && r.snapshot.client && typeof r.snapshot.client === 'object' &&
      ['clientName','location','team','year','service','assets','revenue','profit'].every(k => typeof r.snapshot.client[k] === 'string') &&
      r.snapshot.quote && typeof r.snapshot.quote === 'object' && ['basis','manual','discount','extra','tax','reason'].every(k => typeof r.snapshot.quote[k] === 'string') &&
      Array.isArray(r.snapshot.budget) && r.snapshot.budget.every(x => x && typeof x === 'object' && ['role','hours','rateYuan'].every(k=>typeof x[k]==='string')) &&
      Array.isArray(r.snapshot.rules) && ['gx','hb','sh'].every(id=>r.snapshot.rules.some(x=>x?.id===id)) &&
      new Set(r.snapshot.rules.map(x=>x?.id)).size===r.snapshot.rules.length && r.snapshot.rules.every(x => x && typeof x==='object' && ruleNameMatches(x) && ['fixed','flat','progressive','budget'].includes(x.mode) && ['assets','revenue','max'].includes(x.basis) && Array.isArray(x.tiers) && x.tiers.every(t=>t && typeof t==='object' && !Array.isArray(t))) && r.calculation && typeof r.calculation === 'object';
  }
  try {
    storedRaw = localStorage.getItem(STORE);
    const saved = JSON.parse(storedRaw === null ? '[]' : storedRaw);
    if (!Array.isArray(saved) || !saved.every(validStoredRecord) || new Set(saved.map(r => r.id)).size !== saved.length) throw Error();
    records = saved;
  } catch { readError = true; try { storedRaw = localStorage.getItem(STORE); } catch { storageReadable = false; } }

  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>$('#toast').classList.remove('show'),3500); }
  function formFill(form, values) { for(const [key,value] of Object.entries(values)) { const e = form.elements.namedItem(key); if(e) e.value = value; } }
  function formRead(form) { return Object.fromEntries(new FormData(form)); }
  function positiveNumber(value, label, max=1e12) { if(String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>max) throw Error(label+'必须是有效的非负数'); return Number(value); }
  // Financial inputs are in 万元. Convert up to 6 decimals to integer cents exactly.
  function wanToYuan(value, signed=false) { let v = String(value).trim(); if(!new RegExp(signed ? '^-?\\d+(?:\\.\\d{1,6})?$' : '^\\d+(?:\\.\\d{1,6})?$').test(v)) throw Error('财务规模须为有效金额，万元最多保留 6 位小数'); const negative=v.startsWith('-'); if(negative)v=v.slice(1); const [a,b='']=v.split('.'); let cents=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')); if(cents>900000000000000n) throw Error('输入金额超出原型支持范围'); if(negative)cents=-cents; const abs=cents<0n?-cents:cents; return (cents<0n?'-':'')+(abs/100n).toString()+'.'+(abs%100n).toString().padStart(2,'0'); }
  function validateClient() { const c=state.client; if(!provinceForLocation(c.location))throw Error('客户所在地待确认，请选择具体省级地区'); if(provinces.some(p=>p.scopePending&&p.name===c.location))throw Error('该地区业务适用范围与币种待确认，暂不生成报价'); if(!c.clientName.trim()) throw Error('请填写客户名称'); if(!/^\d{4}$/.test(c.year)||+c.year<2000||+c.year>2100) throw Error('审计年度需为 2000—2100 年'); const assets=wanToYuan(c.assets),revenue=wanToYuan(c.revenue); wanToYuan(c.profit,true); return {assets,revenue}; }
  function recalcBudget() { try { budgetResult=C.calculateHours(state.budget); if(!state.budget.length) throw Error('请至少添加一个人员级别'); $('#budget-error').textContent=''; $('#budget-total').textContent=fmt(budgetResult.totalCents); } catch(e) {budgetResult=null; $('#budget-error').textContent=e.message; $('#budget-total').textContent='—';} }
  function regionResult(rule, input) {
    if(byId(rule.id)?.scopePending) return {error:'业务适用范围及币种待确认，暂不计算',missing:true};
    if(!input) return {error:'请先完善客户输入'};
    if(rule.id==='sh' && rule.mode==='budget') { if(!budgetResult) return {error:'请先完善工时预算'}; return {...budgetResult,baseLabel:'本所人员工时预算',custom:true}; }
    if((rule.mode==='fixed' && (rule.fixedYuan===null||rule.fixedYuan==='')) || (rule.mode!=='fixed' && !rule.tiers?.length)) return {error:'待配置规则',missing:true};
    try {let baseYuan = rule.basis==='revenue'?input.revenue:input.assets;
      if(rule.basis==='max') baseYuan=C.money(input.assets)>=C.money(input.revenue)?input.assets:input.revenue;
      return {...C.calculateScale({...rule,baseYuan}),baseLabel:rule.mode==='fixed'?'自定义固定金额':({max:'资产 / 收入孰高',assets:'资产总额',revenue:'营业收入'}[rule.basis]||'资产总额')};
    } catch(e) {return {error:e.message};}
  }
  function detailLines(lines) { return lines.map(line=>`<div class="detail-line"><span>${esc(line.label)}</span><b>${esc(fmt(line.amountCents))}</b></div>`).join(''); }
  function renderComparison() {
    $('#comparison').innerHTML=comparisonRules().map(rule=>{const r=outputs[rule.id]||{error:'未配置'};const isSh=rule.id==='sh';const selected=state.quote.basis===rule.id;
      return `<article class="region-card ${selected?'selected':''}"><div class="card-top"><div><h3 class="region-title">${esc(rule.name)}</h3><div class="region-en">${esc(EN[rule.id]||rule.id)}</div></div><span class="badge ${isSh?'neutral':'amber'}">${rule.status==='missing'?'未配置':isSh||rule.status==='custom_unverified'?'本所自定义 · 待核':'历史参考 · 待复核'}</span></div><div class="region-price">${r.error?'—':`<small>¥</small>${esc(C.formatMoney(r.totalCents))}`}</div><p class="card-label">${r.error?esc(r.error):isSh?'本所自定义 · 非上海统一标准':rule.status==='custom_unverified'?'本机自定义规则 · 待核定':'按历史口径测算 · 非现行统一价'}</p><div class="card-facts"><div class="fact"><span>计算口径</span><span>${esc(r.baseLabel||'待配置')}</span></div><div class="fact"><span>规则版本</span><span>${esc(rule.version||'本所 v0.1')}</span></div><div class="fact"><span>参考文件</span><span>${esc(rule.document||'本所内部预算')}</span></div></div><details><summary>查看计算明细与边界</summary><div class="detail-lines">${r.lines?detailLines(r.lines):'<p>没有足够依据，不返回 0 元报价。</p>'}<p>${esc(rule.notes||'请先人工确认适用范围。')}</p><p>精确到分；每项舍入规则需与本所制度核对。</p></div></details><button class="btn choose ${selected?'primary':''}" data-choose="${esc(rule.id)}" ${r.error?'disabled':''}>${selected?'✓ 已作为报价基础':'用于议价测算'}</button></article>`;
    }).join('');
  }
  function calculateQuote() {
    finalResult=null; const q=state.quote; let base=null,label='';
    try {validateClient(); if(q.basis==='budget'){if(!budgetResult)throw Error('工时预算未完成');base=budgetResult.totalCents;label='本所工时预算';}
      else if(q.basis==='manual'){base=C.money(q.manual);label='手工输入报价';}
      else{const r=outputs[q.basis];if(!r||r.error)throw Error('所选地区规则不可计算，请先配置');base=r.totalCents;label=(state.rules.find(x=>x.id===q.basis)?.name||REGION_NAMES[q.basis]||'地区')+'参考（待核定）';}
      positiveNumber(q.discount,'优惠幅度',100); positiveNumber(q.tax,'另计税率',100);
      finalResult={...C.applyAdjustment({baseCents:base,discountPercent:q.discount,extraYuan:q.extra,taxPercent:q.tax}),baseCents:base,label};
      $('#quote-error').textContent=''; $('#final-price').textContent=fmt(finalResult.totalCents); $('#basis-description').textContent='报价基础：'+label;
      $('#summary-lines').innerHTML=[['基准金额',fmt(base)],['优惠金额','− '+fmt(finalResult.discountCents)],['附加费用',fmt(C.money(q.extra))],['另计税额',fmt(finalResult.taxCents)]].map(([a,b])=>`<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('');
      $('#summary-note').textContent=(budgetResult && finalResult.subtotalCents<budgetResult.totalCents?'当前税前报价低于工时收费预算，请复核资源投入。':'报价仍需确认服务范围、工时与税费口径。')+(q.basis==='gx'||q.basis==='hb'?' 所选历史规则未经核定。':'');
    }catch(e){$('#quote-error').textContent=e.message;$('#final-price').textContent='—';$('#basis-description').textContent='输入有效数据后计算';$('#summary-lines').innerHTML='';$('#summary-note').textContent='不完整或无效输入不会生成报价。';}
    $('#preview').disabled=!finalResult;$('#save').disabled=!finalResult;$('#csv').disabled=!finalResult;
    const manual=$('#quote-form').elements.namedItem('manual');manual.disabled=q.basis!=='manual';
  }
  function update() { let input=null; try{input=validateClient();$('#client-error').textContent='';}catch(e){$('#client-error').textContent=e.message;} recalcBudget();syncProvince();outputs={};for(const rule of state.rules) outputs[rule.id]=regionResult(rule,input);renderComparison();calculateQuote(); }
  function renderBudget() { $('#budget-rows').innerHTML=state.budget.map((row,i)=>`<tr><td><input class="budget-input" aria-label="人员级别 ${i+1}" data-row="${i}" data-key="role" maxlength="50" value="${esc(row.role)}"></td><td><input class="budget-input" aria-label="预计工时 ${i+1}" data-row="${i}" data-key="hours" type="number" min="0" step="0.01" value="${esc(row.hours)}"></td><td><input class="budget-input" aria-label="小时费率 ${i+1}" data-row="${i}" data-key="rateYuan" type="number" min="0" step="0.01" value="${esc(row.rateYuan)}"></td><td class="row-total" data-total="${i}">${rowAmount(row)}</td><td><button class="text-button" data-remove-role="${i}" aria-label="删除人员级别 ${i+1}">删除</button></td></tr>`).join('');recalcBudget(); }
  function rowAmount(row) { try{return esc(fmt(C.calculateHours([row]).totalCents));}catch{return '—';} }
  function renderRules(preserveDraft=false) {
    $('#rule-tabs').innerHTML=comparisonRules().map(r=>`<button class="${r.id===activeRule?'active':''}" data-rule="${r.id}">${esc(r.name)}</button>`).join('');
    if(!preserveDraft || !ruleDraft || ruleDraft.id!==activeRule) ruleDraft=clone(state.rules.find(r=>r.id===activeRule)||null); const r=ruleDraft;if(!r){$('#rule-editor').textContent='规则数据不可用';return;}
    if(byId(r.id)?.scopePending){$('#rule-editor').innerHTML='<p class="error">该地区业务适用范围、币种及规则待确认，暂不支持自定义报价。</p>';return;}
    const flat=r.mode==='flat';
    $('#rule-editor').innerHTML=`<div class="rule-meta"><p><strong>${esc(r.document||'未配置')}</strong> <span class="badge amber">${r.id==='sh'?'自定义，不是官方价':'待复核，不用于正式承诺'}</span></p><p>${esc(r.notes||'')}</p><a href="${esc(safeUrl(r.sourceUrl))}" target="_blank" rel="noopener noreferrer">查看参考来源 ↗</a></div><form id="rules-form" novalidate><div class="fields two"><label>计费基数<select name="basis"><option value="max">资产总额与营业收入孰高</option><option value="assets">资产总额</option><option value="revenue">营业收入</option></select></label><label>计算方法<select name="mode"><option value="flat">按档固定收费</option><option value="progressive">差额累进收费</option><option value="fixed">自定义固定金额</option>${r.id==='sh'?'<option value="budget">本所工时预算</option>':''}</select></label><label>最低收费（元）<input name="minimumYuan" type="number" min="0" step="0.01" value="${esc(r.minimumYuan??0)}"></label><label>固定金额（元，仅固定模式）<input name="fixedYuan" type="number" min="0" step="0.01" value="${esc(r.fixedYuan??'')}"></label></div><div class="table-scroll" style="margin-top:20px"><table><thead><tr><th>区间上限（万元，末档可留空）</th><th>${flat?'该档收费（元）':'费率（‰）或固定段费用（元）'}</th><th></th></tr></thead><tbody>${(r.tiers||[]).map((t,i)=>`<tr><td><input class="rule-input" aria-label="第 ${i+1} 档上限" data-tier="${i}" data-field="upToYuan" type="number" min="0" step="0.000001" value="${t.upToYuan===null?'':esc(Number(t.upToYuan)/10000)}"></td><td><small>${flat||t.feeYuan!=null?'固定费用（元）':'千分费率（‰）'}</small><input class="rule-input" aria-label="第 ${i+1} 档${flat||t.feeYuan!=null?'收费':'费率'}" data-tier="${i}" data-field="${flat||t.feeYuan!=null?'feeYuan':'ratePerMille'}" type="number" min="0" step="${flat||t.feeYuan!=null?'0.01':'0.0001'}" value="${esc(flat||t.feeYuan!=null?t.feeYuan??'':t.ratePerMille??'')}"></td><td><button class="text-button" type="button" data-remove-tier="${i}">移除</button></td></tr>`).join('')}</tbody></table></div><div class="rule-actions"><button type="button" class="btn" id="add-tier">＋ 添加档位</button><button type="submit" class="btn primary">应用到当前草稿</button><button type="button" class="text-button" id="restore-rule">恢复参考版本</button></div><p class="error" id="rule-error" role="alert"></p><p class="tiny">费率单位为千分率（‰），不是百分比。修改后仍标记待复核。若变更计算方法，请重新核对所有档位。</p></form>`;
    formFill($('#rules-form'),r);$('#rules-form').elements.namedItem('fixedYuan').value=r.fixedYuan??'';
  }
  function sourceList(){const items=[['价格市场化','国家发改委 · 发改价格〔2014〕2755号','要求放开会计师事务所审计服务价格。','https://www.ndrc.gov.cn/xxgk/zcfb/tz/201501/t20150104_963719.html'],['工时预算依据','财政部 · 会计师事务所一体化管理办法','第八条：业务收费以项目工时预算和人员级差费率为基础。第十五条涉及境内服务器与数据存储要求。','https://www.mof.gov.cn/jrttts/202205/P020220531557195020769.pdf'],['上海收费口径','沪发改价费〔2011〕001号','实行市场调节价，由事务所综合成本、难易、风险等制定标准。','https://czj.sh.gov.cn/zys_8908/zcfg_8983/zcfb_8985/hj_9035/hjssws_9041/20110201/0017-157508.html'],['广西参考实例','桂林理工大学 · 2026年协审服务采购','该采购参考2012年标准并采用下浮率，不代表全省统一现行报价。','https://shenji.glut.edu.cn/info/1007/1787.htm'],['河北参考实例','河北省体育局 · 2022年中标公示','该采购使用2012年历史标准的折扣价，不代表全省平均成交价。','https://sport.hebei.gov.cn/tongzhigonggao/2022/0119/17582.html']];$('#source-list').innerHTML=items.map(([tag,title,note,url])=>`<div class="source-item"><span class="badge neutral">${esc(tag)}</span> <a href="${url}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a><p>${esc(note)}</p></div>`).join('');}
  function setView(name){view=name;$$('.view').forEach(e=>e.hidden=e.id!=='view-'+name);$$('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===name));const labels={quote:['报价测算','把报价依据，摆在同一张桌上。','选择省级地区，与河北、上海参考口径对比；未配置地区不产生报价。'],budget:['工时预算','从投入出发，让报价有据可依。','按人员级别与预计工时，建立本所收费预算。'],rules:['规则与依据','每一个数字，都有来处。','历史参考、自定义口径与原始出处分开管理。'],history:['本机记录','每一次议价，都留下快照。','只在本机保存，历史记录不受后续规则调整影响。']};$('#breadcrumb').textContent=labels[name][0];$('#page-title').textContent=labels[name][1];$('#page-subtitle').textContent=labels[name][2];if(name==='budget')renderBudget();if(name==='rules')renderRules();if(name==='history')renderHistory();}
  function hydrate(){selectOptions();if(!byId(state.selectedProvince))state.selectedProvince=provinceForLocation(state.client.location);if(!provinceForLocation(state.client.location))state.client.location='其他地区';ensureSelected();activeRule=selectedId();ruleDraft=null;formFill($('#client-form'),state.client);formFill($('#quote-form'),state.quote);renderBudget();update();if(view==='rules')renderRules();}
  function persistRecords(next){
    if(readError){toast('本机记录不兼容或已损坏，已禁止写入和删除；请先导出原始备份。');return false;}
    try {
      // Detect other-tab updates and refuse to overwrite an unseen newer value.
      if(localStorage.getItem(STORE)!==storedRaw){readError=true;storedRaw=localStorage.getItem(STORE);renderHistory();toast('本机记录已被其他页面修改，请导出原始备份并重新载入。');return false;}
      const raw=JSON.stringify(next);localStorage.setItem(STORE,raw);storedRaw=raw;records=next;return true;
    }catch{toast('无法写入本机存储，记录未保存。请导出备份或检查浏览器权限。');return false;}
  }
  function save(){if(!finalResult)return;if(readError){toast('已有存储无法读取；为避免覆盖，请先检查浏览器本机数据。');return;}const record={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),savedAt:new Date().toISOString(),totalCents:finalResult.totalCents,snapshot:clone(state),calculation:clone({regions:outputs,budget:budgetResult,quote:finalResult}),appVersion:'0.1'};if(persistRecords([record,...records])){toast('已保存本机快照 · 未上传');renderHistory();}}
  function renderHistory(){const list=$('#history-list');if(readError){list.innerHTML='<p class="error">本机记录不兼容、已损坏或被其他页面修改。已禁止写入和删除；请先导出原始备份，再联系维护人员。</p>';return;}list.innerHTML=records.length?records.map(r=>`<div class="record"><div><strong>${esc(r.snapshot.client?.clientName||'未命名客户')}</strong><p>${esc(r.snapshot.client?.year||'')} 年度 · ${esc(new Date(r.savedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · 草稿</p></div><div class="record-actions"><strong>${esc(fmt(r.totalCents))}</strong><button class="btn" data-load="${esc(r.id)}">恢复草稿</button><button class="text-button" data-delete="${esc(r.id)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有保存的报价。<br><small>完成测算后点击“保存到本机”，留存输入与规则快照。</small></div>';}
  function download(name,content,type){const blob=new Blob(['\ufeff',content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function csvCell(x){let s=String(x??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function exportCsv(){if(!finalResult)return;const rows=[['内部参考测算草稿 · 待复核'],['客户',state.client.clientName],['审计年度',state.client.year],['业务类型',state.client.service],['资产总额（万元）',state.client.assets],['营业收入（万元）',state.client.revenue],['净利润（万元，不参与计费）',state.client.profit],['客户所在地',state.client.location],['执行团队所在地',state.client.team],[],['参考地区','金额（元）','计算口径','规则版本','状态']];for(const r of comparisonRules()){const v=outputs[r.id];rows.push([r.name,v.error?'不可计算':(v.totalCents/100).toFixed(2),v.baseLabel||v.error,r.version,'待复核 / 非现行统一价']);if(v.lines)for(const l of v.lines)rows.push(['计算明细',l.label,(l.amountCents/100).toFixed(2)]);}rows.push([],['工时收费预算（元）',budgetResult?(budgetResult.totalCents/100).toFixed(2):'不可计算'],['报价基础',finalResult.label],['优惠幅度（%）',state.quote.discount],['附加费用（元）',state.quote.extra],['另计税率（%）',state.quote.tax],['报价草稿（元）',(finalResult.totalCents/100).toFixed(2)],['调整原因',state.quote.reason]);download('审计报价-内部对比草稿.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('已导出内部对比，文件含客户财务数据，请妥善保管');}
  function preview(){if(!finalResult)return;const c=state.client,q=state.quote,f=finalResult;const date=new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});$('#customer-preview').innerHTML=`<div class="document-header"><div><div class="eyebrow">AUDIT SERVICE PROPOSAL</div><h1>审计服务报价单</h1><span class="muted">事务所名称：待填写</span></div><span class="draft">草稿 · 待审核</span></div><div class="document-meta"><div>委托单位：${esc(c.clientName)}</div><div>编制日期：${esc(date)}</div><div>审计年度：${esc(c.year)} 年</div><div>客户所在地：${esc(c.location)}</div></div><table><thead><tr><th>服务项目</th><th>范围</th><th>费用（元）</th></tr></thead><tbody><tr><td>${esc(c.service)}</td><td>单一年度 / 单一主体</td><td>${esc(C.formatMoney(f.subtotalCents))}</td></tr><tr><td>另计税额</td><td>${esc(q.tax)}%（税务口径待确认）</td><td>${esc(C.formatMoney(f.taxCents))}</td></tr></tbody></table><div class="document-total"><span>报价合计</span><strong>${esc(fmt(f.totalCents))}</strong></div><div class="document-terms"><h3>服务与报价说明</h3><p>1. 本报价为初步沟通草稿，不构成承接或价格承诺。正式金额以事务所审核及双方签署的业务约定书为准。</p><p>2. 服务范围、资料清单、交付期限、税费口径、差旅及额外工作费用须另行书面确认。</p><p>3. 报价有效期：待双方确认。财务资料或服务范围发生变化时，应重新测算。</p><p>4. 本报价不对审计意见类型及其他审计结果作出保证。</p></div><div class="document-note">本文件由报价原型生成 · 未经事务所审核 · 不含内部预算与地区比较信息</div>`;$('#quote-dialog').showModal();}
  function captureRuleForm(){const r=clone(ruleDraft), form=$('#rules-form'),values=formRead(form);r.basis=values.basis;r.mode=values.mode;r.minimumYuan=values.minimumYuan;r.fixedYuan=values.fixedYuan===''?null:values.fixedYuan;for(const el of $$('[data-tier]',form)){let val=el.value;if(el.dataset.field==='upToYuan')val=val===''?null:wanToYuan(val);r.tiers[+el.dataset.tier][el.dataset.field]=val;}return r;}
  $('#comparison-province').addEventListener('change',e=>{state.selectedProvince=e.target.value;ensureSelected();activeRule=state.selectedProvince;ruleDraft=null;update();if(view==='rules')renderRules();});
  $('#client-form').addEventListener('input',()=>{const previous=state.client.location;state.client=formRead($('#client-form'));if(previous!==state.client.location){const id=provinceForLocation(state.client.location);state.selectedProvince=id;ensureSelected();activeRule=id;ruleDraft=null;}update();});$('#quote-form').addEventListener('input',()=>{const q=formRead($('#quote-form'));state.quote={...state.quote,...q};update();});
  $('#comparison').addEventListener('click',e=>{const b=e.target.closest('[data-choose]');if(!b)return;state.quote.basis=b.dataset.choose;formFill($('#quote-form'),state.quote);update();});
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('#demo').addEventListener('click',()=>{if(!confirm('载入演示会替换当前未保存的草稿，是否继续？'))return;state=defaults();hydrate();toast('已载入虚构演示客户与示例工时');});
  $('#clear-client').addEventListener('click',()=>{if(!confirm('清空当前客户名称和财务金额？'))return;Object.assign(state.client,{clientName:'',assets:'',revenue:'',profit:''});hydrate();});
  $('#budget-rows').addEventListener('input',e=>{if(!e.target.dataset.key)return;const i=+e.target.dataset.row;state.budget[i][e.target.dataset.key]=e.target.value;const td=$(`[data-total="${i}"]`);if(td)td.innerHTML=rowAmount(state.budget[i]);update();});
  $('#budget-rows').addEventListener('click',e=>{const b=e.target.closest('[data-remove-role]');if(!b)return;state.budget.splice(+b.dataset.removeRole,1);renderBudget();update();});$('#add-role').addEventListener('click',()=>{state.budget.push({role:'新级别',hours:'0',rateYuan:'0'});renderBudget();update();});
  $('#rule-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-rule]');if(!b)return;activeRule=b.dataset.rule;renderRules();});
  $('#rule-editor').addEventListener('change',e=>{if(e.target.name==='mode'){try{const r=captureRuleForm();ruleDraft=r;renderRules(true);}catch(err){$('#rule-error').textContent=err.message;}}});
  $('#rule-editor').addEventListener('click',e=>{const t=e.target;if(t.id==='restore-rule'){if(!confirm('恢复该地区的初始参考配置？'))return;const idx=state.rules.findIndex(r=>r.id===activeRule);state.rules[idx]=clone(initialRules.find(r=>r.id===activeRule)||blankRule(byId(activeRule)));renderRules();update();return;}if(t.id==='add-tier'||t.dataset.removeTier!==undefined){try{const r=captureRuleForm();if(t.id==='add-tier')r.tiers.push(r.mode==='flat'?{upToYuan:null,feeYuan:'0'}:{upToYuan:null,ratePerMille:'0'});else r.tiers.splice(+t.dataset.removeTier,1);ruleDraft=r;renderRules(true);}catch(err){$('#rule-error').textContent=err.message;}}});
  $('#rule-editor').addEventListener('submit',e=>{e.preventDefault();try{const r=captureRuleForm();if(r.mode!=='budget') {if(r.mode==='fixed'&&r.fixedYuan===null)throw Error('请填写固定金额');C.calculateScale({...r,baseYuan:'1'});}r.version='本机自定义 v0.1';r.status='custom_unverified';r.notes='用户修改的自定义规则，尚未由事务所核定。原始文件仅作为参考线索。';state.rules[state.rules.findIndex(x=>x.id===activeRule)]=r;renderRules();update();toast('规则已应用到草稿，仍需人工复核');}catch(err){$('#rule-error').textContent=err.message;}});
  $('#save').addEventListener('click',save);$('#csv').addEventListener('click',exportCsv);$('#preview').addEventListener('click',preview);$('#close-preview').addEventListener('click',()=>$('#quote-dialog').close());$('#print').addEventListener('click',()=>window.print());
  $('#history-list').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.load||b.dataset.delete;const record=records.find(r=>r.id===id);if(!record)return;if(b.dataset.load){if(!confirm('用保存的快照替换当前草稿？'))return;state=clone(record.snapshot);hydrate();setView('quote');toast('已恢复保存时的输入和规则');}else if(confirm('删除这条本机记录？此操作不可撤销。')){if(persistRecords(records.filter(r=>r.id!==id)))renderHistory();}});
  $('#clear-history').addEventListener('click',()=>{if(confirm('永久删除此浏览器中的全部报价记录？请先导出备份。'))if(persistRecords([])){renderHistory();toast('已删除全部本机报价记录');}});
  // Restore is always a two-step preview/confirmation. Preview never writes storage.
  let importPreview=null, importSerial=0;
  function resetImport(message){importPreview=null;$('#import-backup-confirm').disabled=true;$('#import-backup-status').textContent=message;}
  function importFailure(error){resetImport('未导入：'+(error && error.message ? error.message : '读取失败'));}
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
        const raw=localStorage.getItem(STORE);
        if(readError||raw!==storedRaw){readError=true;storedRaw=raw;renderHistory();throw Error('本机记录已变化，请导出当前记录后刷新页面');}
        const preview=globalThis.QuoteBackup.previewBackup(reader.result,raw);
        if(!preview.mergedRecords.every(validStoredRecord))throw Error('备份记录不能被当前页面安全恢复，未导入');
        importPreview=preview;
        $('#import-backup-status').textContent='预览：备份 '+preview.incomingCount+' 条，本机 '+preview.existingCount+' 条；新增 '+preview.addedCount+' 条，完全相同跳过 '+preview.identicalCount+' 条，冲突 0 条。';
        $('#import-backup-confirm').disabled=preview.addedCount===0;
      }catch(err){importFailure(err);}
    };
    reader.readAsText(file,'UTF-8');
  });
  $('#import-backup-confirm').addEventListener('click',()=>{
    const preview=importPreview;if(!preview)return;
    if(!confirm('确认将 '+preview.addedCount+' 条记录合并到此浏览器？现有相同记录将跳过，不覆盖同编号记录。请先导出本机备份。'))return;
    try{
      if(readError||localStorage.getItem(STORE)!==preview.expectedCurrentRaw){readError=true;storedRaw=localStorage.getItem(STORE);renderHistory();throw Error('本机记录已变化，请导出当前记录并刷新后重新预览');}
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
    download('审计报价-本机记录备份.json',JSON.stringify({app:'hengdu-audit-quote',schema:1,exportedAt:new Date().toISOString(),records},null,2),'application/json;charset=utf-8');
  });
  sourceList();hydrate();renderHistory();
})();
