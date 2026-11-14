/* Device-local, explicitly mapped checks. No opinion, implicit confirmation, or silent write. */
(function (root) {
  'use strict';
  const ROLE_FIELDS = {
    ledger: ['accountCode', 'voucherId', 'lineId', 'date', 'debit', 'credit'],
    trialBalance: ['accountCode', 'openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'],
    statements: ['lineId', 'opening', 'closing']
  };
  const LABELS = { accountCode: '末级科目编码', voucherId: '凭证号', lineId: '分录行号／报表行标识', date: '日期', debit: '借方发生额', credit: '贷方发生额', openingDebit: '期初借方余额', openingCredit: '期初贷方余额', periodDebit: '本期借方发生额', periodCredit: '本期贷方发生额', closingDebit: '期末借方余额', closingCredit: '期末贷方余额', opening: '报表期初金额', closing: '报表期末金额' };
  const copy = value => structuredClone(value);
  function mount(host, ctx) {
    const D = host.ownerDocument, S = root.ProjectWorkspaceStore, key = ctx.key;
    const el = (tag, text, cls) => { const n = D.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
    const option = (text, value) => { const n = el('option', text); n.value = value; return n; };
    const button = (text, fn) => { const n = el('button', text, 'btn'); n.type = 'button'; n.onclick = fn; return n; };
    let alive = true, files = [], last = null;
    const roles = {}, page = el('div', undefined, 'ap-root'), shell=el('div'), advanced=el('details');
    host.append(shell);
    const automatic=root.AuditAutoCheck?.mount?root.AuditAutoCheck.mount(shell,ctx):null;
    advanced.open=!automatic;advanced.append(el('summary','高级手动列映射与辅助填写（保留原映射）'),page);shell.append(advanced);
    function current() { return alive && (!ctx.isCurrent || ctx.isCurrent()) && ctx.getRecord()?.id === key; }
    function assertCurrent() { if (!current()) throw Error('项目或页面已改变，未继续使用旧页面数据。'); }
    function say(message, bad = false) { if (!current()) return; status.textContent = message; status.classList.toggle('error', bad); }
    const status = el('p', '请从本项目资料清单选择三类Excel；确认数据范围和列映射后才校验。', 'ap-status'); status.setAttribute('role', 'status');
    const fields = el('div', undefined, 'fields');
    function input(label, value = '') { const l = el('label', label), n = el('input'); n.value = value; l.append(n); fields.append(l); return n; }
    const entity = input('被审计主体（须与三份资料一致）'), start = input('期间起日'), end = input('期间止日'), currency = input('币种代码', 'CNY'), unit = input('金额单位（例如元／万元，不自动换算）', '元'), scale = input('金额小数位（0—6）', '2'), reviewer = input('人工核对人');
    start.type = end.type = 'date'; scale.type = 'number'; scale.min = 0; scale.max = 6;
    page.append(el('h3', '先核验账表，再辅助填写'), el('p', '本功能只检查明确映射的余额数据。通过不等于审计通过；利润表、现金流量表等流量项目不能按余额映射替代。未提供的数值绝不按0处理；公式只读取原缓存，必须另行核对是否已刷新。', 'ap-warning'), fields, status);
    const roleHost = el('div'); page.append(roleHost);
    function readScope() {
      if (!/^[0-6]$/.test(scale.value)) throw Error('请明确填写0至6位金额小数位，空白不视为0。');
      return { projectId: key, entityId: entity.value.trim(), currency: currency.value.trim(), unit: unit.value.trim(), periodStart: start.value, periodEnd: end.value, scale: Number(scale.value) };
    }
    async function checklist() {
      assertCurrent(); const a = root.AuditChecklist, db = await (key === a.TRIAL_ID ? a.openTrial() : a.open());
      try { const r = await db.get(key); assertCurrent(); if (r && r.project?.quoteId !== key) throw Error('资料项目归属不一致。'); return r; } finally { db.close(); }
    }
    function currentFiles(record) {
      if (!record || record.schema !== 2) return [];
      const nodes = new Map(record.nodes.map(n => [n.id, n]));
      return Object.entries(record.attachments || {}).flatMap(([nodeId, items]) => items.filter(f => f.nodeId === nodeId && f.generationId === record.generationId && /\.xlsx?$/i.test(f.name)).map(f => ({
        nodeId, fileId: f.id, name: f.name, sha256: f.sha256, generationId: f.generationId, revision: record.revision,
        status: record.states[nodeId]?.status || 'pending', title: nodes.get(nodeId)?.title || ''
      })));
    }
    function matchSource(record, ref, requireConfirmed = false) {
      const found = ref && currentFiles(record).find(f => f.nodeId === ref.nodeId && f.fileId === ref.fileId && f.sha256 === ref.sha256 && f.generationId === ref.generationId);
      if (!found || record.revision !== ref.revision) throw Error('资料清单或原文件已改变，请刷新并重新映射；未沿用旧结果。');
      if (requireConfirmed && found.status !== 'confirmed') throw Error('三类资料均须先在资料清单核对通过。');
      return found;
    }
    async function original(ref, requireConfirmed = false) {
      const fresh = await checklist(), found = matchSource(fresh, ref, requireConfirmed);
      const a = root.AuditChecklist, db = await (key === a.TRIAL_ID ? a.openTrial() : a.open());
      try {
        const f = await db.downloadAttachment(key, ref.nodeId, ref.fileId); assertCurrent();
        if (f.metadata.sha256 !== ref.sha256 || f.metadata.generationId !== ref.generationId || f.metadata.nodeId !== ref.nodeId || f.metadata.id !== ref.fileId) throw Error('下载文件身份已改变，未继续使用旧结果。');
        return { ...f, status: found.status };
      } finally { db.close(); }
    }
    async function verifySources(refs, confirmed) {
      for (const ref of Object.values(refs)) await original(ref, confirmed);
      // One final checklist snapshot checks all sources after asynchronous attachment reads.
      const latest = await checklist(); for (const ref of Object.values(refs)) matchSource(latest, ref, confirmed);
    }
    async function workspaceAt(revision) {
      assertCurrent(); const local = ctx.getRecord();
      if (local.rev !== revision) throw Error('工作区版本已改变，请刷新后重新核对，未覆盖。');
      const saved = await S.get(key); assertCurrent();
      if (saved.rev !== revision || ctx.getRecord().rev !== revision) throw Error('工作区已被另一处更新，请刷新后重新核对，未覆盖。');
      return ctx.getRecord();
    }
    function cell(sheet, r, c) { const v = sheet.cells[root.WorkpaperSheets.ref(r, c)]; return v === undefined ? '' : String(v.v ?? '').trim(); }
    function invalidate(message = '映射或确认已变化，请重新核对并运行账表校验。') {
      last = null; approve.checked = false; sourceValue.replaceChildren(); result.replaceChildren(el('p', message, 'ap-warning'));
    }
    function invalidateRole(st) { st.confirmed.checked = false; mapConfirmed.checked = false; invalidate(); }
    function makeRole(role, label) {
      const box = el('section', undefined, 'ap-card'), select = el('select'), sheet = el('select'), begin = el('input'), finish = el('input'), columns = el('div', undefined, 'fields'), preview = el('div', undefined, 'ap-preview'), confirmed = el('input'), note = el('p');
      select.setAttribute('aria-label', label + '原资料'); sheet.setAttribute('aria-label', label + '工作表');
      begin.type = finish.type = 'number'; begin.min = finish.min = 1; begin.value = finish.value = '2'; confirmed.type = 'checkbox';
      const controls = el('div', undefined, 'ap-range'); controls.append(el('span', '工作表'), sheet, el('span', '起止数据行（Excel行号，不含合计/父科目）'), begin, finish);
      const check = el('label'); check.append(confirmed, D.createTextNode(' 已核对这份资料的主体、期间、币种、金额单位、完整数据范围和列映射；仅使用末级科目。'));
      box.append(el('h4', label), select, controls, columns, check, note, preview); roleHost.append(box);
      const state = roles[role] = { select, sheet, begin, finish, confirmed, columns, preview, note, map: {}, ref: null, model: null, ticket: 0 };
      function draw() {
        invalidateRole(state); const s = state.model?.sheets.find(x => x.name === sheet.value);
        columns.replaceChildren(); preview.replaceChildren(); state.map = {}; if (!s || s.visibility) return;
        finish.value = String(s.range.e.r + 1);
        for (const field of ROLE_FIELDS[role]) {
          const l = el('label', LABELS[field]), c = el('select'); c.append(option('请选择原列', ''));
          for (let i = s.range.s.c; i <= s.range.e.c; i++) c.append(option(root.WorkpaperSheets.ref(0, i).replace(/\d+$/, '') + ' · ' + cell(s, Math.max(0, Number(begin.value) - 2), i).slice(0, 45), String(i)));
          c.onchange = () => invalidateRole(state); state.map[field] = c; l.append(c); columns.append(l);
        }
        const table = el('table');
        for (let r = s.range.s.r; r <= Math.min(s.range.e.r, s.range.s.r + 14); r++) {
          const tr = el('tr'); tr.append(el('th', String(r + 1)));
          for (let c = s.range.s.c; c <= Math.min(s.range.e.c, s.range.s.c + 12); c++) tr.append(el('td', cell(s, r, c)));
          table.append(tr);
        }
        preview.append(table);
      }
      for (const n of [begin, finish]) { n.oninput = () => invalidateRole(state); n.onchange = () => invalidateRole(state); }
      confirmed.onchange = () => invalidate(); sheet.onchange = draw;
      select.onchange = async () => {
        const ticket = ++state.ticket;
        state.ref = select.value !== '' && /^(?:0|[1-9]\d*)$/.test(select.value) ? files[Number(select.value)] || null : null;
        const ref = state.ref; state.model = null; state.map = {}; columns.replaceChildren(); preview.replaceChildren(); sheet.replaceChildren(); note.textContent = ''; invalidateRole(state);
        if (!ref) return;
        try {
          const f = await original(ref), model = await root.WorkpaperSheets.read(new File([f.blob], f.metadata.name));
          if (!current() || ticket !== state.ticket) return;
          state.model = model;
          for (const s of model.sheets.filter(s => !s.visibility)) sheet.append(option(s.name, s.name));
          draw(); note.textContent = '来源：' + ref.title + ' / ' + ref.name + ' · SHA ' + ref.sha256 + ' · ' + (ref.status === 'confirmed' ? '资料项已核对' : '资料项未核对，不能据此生成填写建议');
        } catch (e) { if (current() && ticket === state.ticket) say(e.message, true); }
      };
    }
    makeRole('ledger', '序时账'); makeRole('trialBalance', '科目余额表'); makeRole('statements', '未审资产负债表（余额类行）');
    const mappingsLabel = el('label', '报表行与科目余额表的明确对应（JSON高级映射；需业务核对，不推断科目名称）'), mapping = el('textarea'); mapping.rows = 5;
    mapping.placeholder = '[{"lineId":"资产总计","confirmed":true,"terms":[{"accountCode":"1001","sign":1}]}]'; mappingsLabel.append(mapping);
    const equation = el('div', undefined, 'fields');
    function eq(label) { const l = el('label', label), i = el('input'); l.append(i); equation.append(l); return i; }
    const assets = eq('资产总计行标识（多个用逗号）'), liabilities = eq('负债总计行标识'), equity = eq('权益总计行标识'), mapConfirmed = el('input'); mapConfirmed.type = 'checkbox';
    const ml = el('label'); ml.append(mapConfirmed, D.createTextNode(' 已逐项核对报表—科目映射及恒等式选用行，不重复计入总计与明细。')); page.append(mappingsLabel, equation, ml);
    const result = el('div', undefined, 'ap-result'), actions = el('div', undefined, 'ap-actions'); page.append(actions, result);
    function collect() {
      assertCurrent(); const scope = readScope(), columnMappings = {}, sourceRefs = {};
      const input = { schemaVersion: 1, scope, statementMappings: JSON.parse(mapping.value || '[]'), balanceEquation: { confirmed: mapConfirmed.checked, assets: assets.value.split(/[,，]/).map(x => x.trim()).filter(Boolean), liabilities: liabilities.value.split(/[,，]/).map(x => x.trim()).filter(Boolean), equity: equity.value.split(/[,，]/).map(x => x.trim()).filter(Boolean) } };
      for (const [role, st] of Object.entries(roles)) {
        const s = st.model?.sheets.find(x => x.name === st.sheet.value);
        if (!s || !st.ref || s.visibility) throw Error('请为三种账表分别选择本项目Excel原资料及可见工作表。');
        const a = Number(st.begin.value) - 1, b = Number(st.finish.value) - 1;
        if (!st.begin.value || !st.finish.value || !Number.isInteger(a) || !Number.isInteger(b) || a < s.range.s.r || b > s.range.e.r || b < a || b - a + 1 > 20000) throw Error('请填写有效数据行范围，每份最多20000行；不能含空白尾部或合计行。');
        if (Object.values(st.map).length !== ROLE_FIELDS[role].length || Object.values(st.map).some(x => x.value === '')) throw Error('请明确选择所有要求的列；缺数不能默认0。');
        const selected = Object.fromEntries(Object.entries(st.map).map(([f, n]) => [f, Number(n.value)]));
        if (new Set(Object.values(selected)).size !== ROLE_FIELDS[role].length) throw Error('不同字段不能重复使用同一原列，请重新核对列映射。');
        if (Object.values(selected).some(c => !Number.isInteger(c) || c < s.range.s.c || c > s.range.e.c)) throw Error('列映射超出原工作表范围。');
        const rows = [];
        for (let r = a; r <= b; r++) {
          const values = Object.fromEntries(Object.entries(selected).map(([f, c]) => [f, cell(s, r, c)]));
          if (Object.values(values).every(v => v === '')) throw Error('选定范围包含整行空白（Excel第' + (r + 1) + '行），未静默忽略，请重新核对完整范围。');
          const rowId = st.ref.sha256 + ':' + s.name + '!' + (r + 1);
          if (role === 'trialBalance') rows.push({ rowId, accountCode: values.accountCode, opening: { debit: values.openingDebit, credit: values.openingCredit }, periodDebit: values.periodDebit, periodCredit: values.periodCredit, closing: { debit: values.closingDebit, credit: values.closingCredit } });
          else rows.push({ rowId, ...values });
        }
        input[role] = { scope: { ...scope }, mappingConfirmed: st.confirmed.checked, complete: st.confirmed.checked, ...(role !== 'statements' ? { accountLevel: 'leaf' } : {}), rows };
        columnMappings[role] = { sheet: s.name, fromRow: a + 1, toRow: b + 1, columns: selected };
        sourceRefs[role] = copy(st.ref);
      }
      return { input, columnMappings, sourceRefs };
    }
    const digest = value => S.hash(new Blob([JSON.stringify(value)]));
    function sourceValues(input) {
      const list = [['scope.entityId', input.scope.entityId], ['scope.periodStart', input.scope.periodStart], ['scope.periodEnd', input.scope.periodEnd]];
      for (const [i, row] of input.trialBalance.rows.entries()) for (const f of ['periodDebit', 'periodCredit']) list.push(['trialBalance.rows[' + i + '].' + f, row[f]]);
      return list;
    }
    function renderResult(value) {
      result.replaceChildren(); sourceValue.replaceChildren(); approve.checked = false; if (!value) return;
      const r = value.result; result.append(el('h4', '技术检查：通过 ' + r.summary.pass + ' / 差异 ' + r.summary.fail + ' / 不完整 ' + r.summary.incomplete));
      for (const check of r.checks || []) result.append(el('p', check.id + ' · ' + check.status + (check.difference !== undefined ? ' · 差额 ' + check.difference : '')));
      for (const issue of r.issues || []) result.append(el('p', issue.message, 'ap-warning'));
      result.append(el('p', '所有辅助填写须人工建立字段对应关系、检查来源并确认；不自动作出风险判断或审计意见。'));
      sourceValues(value.input).forEach((pair, i) => sourceValue.append(option((pair[0].startsWith('scope.') ? '人工确认范围 · ' : '') + pair[0] + ' = ' + pair[1], String(i))));
    }
    const checkButton = button('运行账表勾稽校验', () => void ctx.run(async () => {
      assertCurrent(); const revision = ctx.getRecord().rev, snapshot = collect();
      const checked = root.AuditReconciliation.reconcile(snapshot.input), inputHash = await digest(snapshot.input), mappingHash = await digest(snapshot.columnMappings);
      await workspaceAt(revision); await verifySources(snapshot.sourceRefs, false);
      assertCurrent(); if (ctx.getRecord().rev !== revision) throw Error('工作区版本已改变，未覆盖。');
      if (JSON.stringify(collect()) !== JSON.stringify(snapshot)) throw Error('当前数据、列映射或确认已变化，请重新校验。');
      const value = { schemaVersion: 1, ...snapshot, result: checked, inputHash, mappingHash, calculatedAt: new Date().toISOString() };
      await ctx.save({ reconciliation: value }); assertCurrent(); last = value; renderResult(value); say('已保存本项目的技术校验结果；不代表审计通过。');
    }));
    const template = button('下载规范化校验输入模板（无业务数据）', () => { try { assertCurrent(); const t = root.AuditReconciliation.templateDownload(readScope()); S.download(new Blob([t.content], { type: t.mimeType }), t.filename); } catch (e) { say(e.message, true); } });
    actions.append(checkButton, template);
    const suggestion = el('section', undefined, 'ap-card'); suggestion.append(el('h4', '有来源的辅助填写（淡黄色，待人工复核）'));
    const targetRows = el('select'), targets = el('select'), field = el('select'), sourceValue = el('select'), approve = el('input'); approve.type = 'checkbox';
    targetRows.setAttribute('aria-label', '建议目标目录'); targets.setAttribute('aria-label', '建议目标原表'); field.setAttribute('aria-label', '建议目标空白字段'); sourceValue.setAttribute('aria-label', '建议来源字段');
    suggestion.append(targetRows, targets, field, sourceValue);
    const approval = el('label'); approval.append(approve, D.createTextNode(' 我已核对以上来源、账表映射及目标空白字段，作为待复核建议填写（不作审计结论）。')); suggestion.append(approval); page.append(suggestion);
    function targetFields(t) {
      if (!t || !['word', 'excel'].includes(t.kind) || t.hidden || t.visibility || t.incompleteLayout || t.progressPolicy?.kind === 'partial' || root.WorkpaperRouteCatalog?.incompleteLayouts?.[t.sha256]) return [];
      return root.WorkpaperRouting.fields(t).filter(f => !f.hidden && !f.locked && (!f.kind || f.kind === 'blank-cell')).map(f => {
        const sheet = t.kind === 'word' ? '' : f.sheet || t.sheet;
        const keys = Array.isArray(f.answerKeys) && f.answerKeys.length ? f.answerKeys : [t.kind === 'excel' ? f.key.slice(f.key.lastIndexOf('!') + 1) : f.key];
        if (keys.length !== 1 || typeof keys[0] !== 'string' || !keys[0] || t.kind === 'excel' && (!sheet || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(keys[0]))) return null;
        return { fieldKey: f.key, sheet, answerKey: keys[0] };
      }).filter(Boolean);
    }
    for (const row of root.WorkpaperDirectory.rows.filter(r => Number.isInteger(r.row) && r.row >= 6 && r.C && root.WorkpaperRouting.targets(r.row).length)) targetRows.append(option(row.C + ' · ' + row.B, String(row.row)));
    function selectedTarget() { return root.WorkpaperRouting.targets(Number(targetRows.value)).find(t => t.id === targets.value); }
    function fieldsForTarget() {
      approve.checked = false; field.replaceChildren();
      for (const f of targetFields(selectedTarget())) field.append(option(f.fieldKey, f.fieldKey));
    }
    targetRows.onchange = () => { targets.replaceChildren(); for (const t of root.WorkpaperRouting.targets(Number(targetRows.value))) targets.append(option(t.path + (t.sheet ? ' → ' + t.sheet : ''), t.id)); fieldsForTarget(); };
    targets.onchange = fieldsForTarget; targetRows.onchange();
    for (const n of [field, sourceValue, reviewer]) { n.onchange = () => { approve.checked = false; }; n.oninput = () => { approve.checked = false; }; }
    for (const n of [entity, start, end, currency, unit, scale]) {
      const changed = () => { for (const st of Object.values(roles)) st.confirmed.checked = false; mapConfirmed.checked = false; invalidate(); };
      n.oninput = changed; n.onchange = changed;
    }
    for (const n of [mapping, assets, liabilities, equity]) { const changed = () => { mapConfirmed.checked = false; invalidate(); }; n.oninput = changed; n.onchange = changed; }
    mapConfirmed.onchange = () => invalidate();
    function choiceSnapshot() { return { row: targetRows.value, target: targets.value, field: field.value, source: sourceValue.value, reviewer: reviewer.value.trim(), approved: approve.checked }; }
    function writePatch(record, t, loc, value, provenanceEntry) {
      if (root.WorkpaperGovernance.isLocked(record, t.sha256, t.kind === 'word' ? undefined : loc.sheet)) throw Error('此底稿已冻结，不可填写。');
      const storage = t.kind === 'word' ? 'docAnswers' : 'answers', part = loc.sheet || '$document';
      const all = copy(record[storage] || {}), file = all[t.sha256] || (all[t.sha256] = {}), map = storage === 'docAnswers' ? file : file[loc.sheet] || (file[loc.sheet] = {});
      if (Object.hasOwn(map, loc.answerKey) && String(map[loc.answerKey]).trim()) throw Error('目标已有保存内容，不自动覆盖。');
      const provenance = copy(record.autoFillProvenance || {});
      if (provenance[t.sha256]?.[part]?.[loc.answerKey]) throw Error('目标已有辅助填写来源记录，不自动覆盖历史。');
      map[loc.answerKey] = String(value);
      ((provenance[t.sha256] ||= {})[part] ||= {})[loc.answerKey] = provenanceEntry;
      return { [storage]: all, autoFillProvenance: provenance };
    }
    const addSuggestion = button('核对来源并写入一个待复核建议', () => void ctx.run(async () => {
      assertCurrent(); const selected = choiceSnapshot(), revision = ctx.getRecord().rev;
      if (!selected.approved || !selected.reviewer) throw Error('请填写人工核对人并明确确认字段对应。');
      if (!last?.result.eligibleForSuggestions) throw Error('账表校验未全部满足技术条件，禁止生成自动填写建议。');
      const analysis = last, snapshot = collect(), now = snapshot.input;
      if (!root.AuditReconciliation.reconcile(now).eligibleForSuggestions || await digest(now) !== analysis.inputHash || await digest(snapshot.columnMappings) !== analysis.mappingHash || JSON.stringify(snapshot.sourceRefs) !== JSON.stringify(analysis.sourceRefs)) throw Error('当前列映射或数据已变化，请先重新校验。');
      await verifySources(snapshot.sourceRefs, true);
      const before = await workspaceAt(revision), prepared = await root.WorkpaperLibrary.prepare(before); assertCurrent();
      const t = selectedTarget(), loc = targetFields(t).find(f => f.fieldKey === selected.field);
      if (!t || t.id !== selected.target || !loc) throw Error('请选择唯一、可见、完整原表及其声明的空白字段。');
      const originalTarget = await root.WorkpaperLibrary.fileFor(t, prepared); assertCurrent();
      if (t.kind === 'excel') {
        const model = await root.WorkpaperSheets.read(originalTarget.file); assertCurrent();
        const sheet = model.sheets.find(s => s.name === loc.sheet), c = sheet?.cells[loc.answerKey];
        if (!sheet || sheet.visibility || c && (c.f || c.l || c.array || String(c.v ?? '').trim())) throw Error('目标不是原表可见空白单元格，或含公式/链接，不自动改写。');
      }
      const choice = sourceValues(now)[Number(selected.source)];
      if (selected.source === '' || !choice || choice[1] === '' || choice[1] === null || choice[1] === undefined) throw Error('来源字段缺数，不能猜数。');
      // Recheck after every potentially long target read; do not rely on earlier review state.
      const record = await workspaceAt(revision);
      await verifySources(snapshot.sourceRefs, true); assertCurrent();
      if (ctx.getRecord().rev !== revision) throw Error('工作区版本已改变，未覆盖。');
      if (JSON.stringify(choiceSnapshot()) !== JSON.stringify(selected) || JSON.stringify(collect()) !== JSON.stringify(snapshot) || last !== analysis) throw Error('当前映射、目标或人工确认已变化，请重新核对。');
      const cellMatch = /^trialBalance\.rows\[(\d+)\]\.(periodDebit|periodCredit)$/.exec(choice[0]), column = snapshot.columnMappings.trialBalance;
      const sourceLocation = cellMatch ? { role: 'trialBalance', rowId: now.trialBalance.rows[Number(cellMatch[1])].rowId, sheet: column.sheet, address: root.WorkpaperSheets.ref(column.fromRow - 1 + Number(cellMatch[1]), column.columns[cellMatch[2]]) } : { kind: 'manual-scope', field: choice[0] };
      const generatedAt = new Date().toISOString(), entry = {
        kind: 'auto', state: 'pending-review', pendingReview: true, value: String(choice[1]), generatedAt, reviewer: selected.reviewer,
        sourceHashes: Object.values(analysis.sourceRefs).map(x => x.sha256), sourceRefs: copy(analysis.sourceRefs), checkInputHash: analysis.inputHash, mappingHash: analysis.mappingHash,
        sourceRef: choice[0], sourceLocation, target: { sha256: t.sha256, path: t.path, sheet: loc.sheet, answerKey: loc.answerKey, fieldKey: loc.fieldKey, directoryRow: Number(selected.row) }, history: []
      };
      const patch = writePatch(record, t, loc, choice[1], entry);
      await ctx.save(patch); assertCurrent(); approve.checked = false;
      say('已写入一个淡黄色待复核建议；原模板、公式与其他填写未改变。');
    }));
    suggestion.append(addSuggestion);
    async function load() {
      try {
        const materials = await checklist(); assertCurrent(); files = currentFiles(materials);
        for (const st of Object.values(roles)) { st.select.replaceChildren(option('请选择本项目当前Excel资料', '')); files.forEach((f, i) => st.select.append(option(f.title + ' / ' + f.name, String(i)))); }
        const saved = ctx.getRecord().reconciliation;
        if (saved?.input && saved.result?.summary) { last = saved; renderResult(saved); }
        if (!files.length) say('本项目资料清单中尚无Excel附件。请先上传三类资料；不会从其他项目借用。');
      } catch (e) { say(e.message, true); }
    }
    void load();
    return { destroy() { alive = false; automatic?.destroy(); for (const st of Object.values(roles)) ++st.ticket; shell.remove(); } };
  }
  root.AuditPreparation = Object.freeze({ mount });
})(globalThis);
