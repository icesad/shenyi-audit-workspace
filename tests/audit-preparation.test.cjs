/* Synthetic browser integration: real XLS/XLSX workers, real material/workspace IDB.
 * Only the unrelated ZIP library boundary uses a hash-bound synthetic target fixture. */
'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const dist = path.resolve(__dirname, '../dist');
const sourceNames = ['workpaper-xlsx-source.js', 'workpaper-sheets.js', 'audit-checklist.js', 'project-workspace-store.js', 'workpaper-routing.js', 'workpaper-governance.js', 'audit-reconciliation.js', 'audit-preparation.js'];
test('audit preparation bounded synthetic browser/IDB checks', async t => {
  let chromium; try { ({ chromium } = require('playwright')); } catch { return t.skip('Playwright unavailable'); }
  const executablePath = process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE || chromium.executablePath();
  if (!fs.existsSync(executablePath)) return t.skip('Chromium unavailable');
  const browser = await chromium.launch({ headless: true, executablePath });
  async function fixture(options = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    const p = await context.newPage(), remote = [], errors = [];
    p.on('request', r => { if (/^(?:https?|wss?):/u.test(r.url())) remote.push(r.url()); });
    p.on('pageerror', e => errors.push(e.message));
    await p.route(/^https?:/u, r => r.abort());
    await p.goto(pathToFileURL(path.join(dist, 'rule-catalog.js')).href);
    await p.evaluate(() => { document.body.innerHTML = '<main id="qa"></main>'; });
    for (const name of sourceNames) await p.addScriptTag({ content: fs.readFileSync(path.join(dist, name), 'utf8') });
    await p.addStyleTag({ content: fs.readFileSync(path.join(dist, 'audit-preparation.css'), 'utf8') });
    await p.evaluate(async options => {
      const id = AuditChecklist.TRIAL_ID, project = { quoteId: id, projectName: '合成校验试用', firmName: '合成所' };
      const X = new Function(WorkpaperXlsxSource + ';return XLSX;')();
      const rows = [
        [['科目', '凭证', '行', '日期', '借', '贷'], ['asset', 'v1', '1', '2025-02-01', '20.00', '0.00'], ['liability', 'v1', '2', '2025-02-01', '0.00', '20.00']],
        [['科目', '期初借', '期初贷', '本期借', '本期贷', '期末借', '期末贷'], ['asset', '100.00', '0.00', '20.00', '0.00', '120.00', '0.00'], ['liability', '0.00', '40.00', '0.00', '20.00', '0.00', '60.00'], ['equity', '0.00', '60.00', '0.00', '0.00', '0.00', '60.00']],
        [['报表行', '期初', '期末'], ['assets', '100.00', '120.00'], ['liabilities', '40.00', '60.00'], ['equity', '60.00', '60.00']]
      ];
      if (options.emptyAmount) rows[0][1][4] = '';
      if (options.blankRow) rows[0].splice(2, 0, []);
      function workbook(data, name, type = 'xlsx') {
        const w = X.utils.book_new(); X.utils.book_append_sheet(w, X.utils.aoa_to_sheet(data), '明细');
        return new File([X.write(w, { type: 'array', bookType: type })], name, { type: 'application/octet-stream' });
      }
      const db = await AuditChecklist.openTrial(); let material;
      try {
        const nodes = ['n1', 'n2', 'n3'].map((id, i) => ({ id, parentId: '', level: 1, title: ['序时账', '余额表', '报表'][i], description: '' }));
        material = await db.importTree(project, nodes, '合成导入人');
        for (let i = 0; i < 3; i++) material = await db.attach(id, material.revision, nodes[i].id, workbook(rows[i], ['ledger.xls', 'trial.xlsx', 'statement.xlsx'][i], i ? 'xlsx' : 'xls'), '合成上传人');
        for (const n of nodes) if (!options.unconfirmed) material = await db.change(id, material.revision, { type: 'item', id: n.id, status: 'confirmed', evidence: '合成来源核对', reviewer: '合成核对人' });
      } finally { db.close(); }
      const targetBook = X.utils.book_new(), targetSheet = X.utils.aoa_to_sheet([[options.targetNonblank ? '原模板非空文字' : '', '原标签'], ['', '']]);
      if (options.targetFormula) targetSheet.A1 = { t: 'n', v: 2, f: '1+1' };
      X.utils.book_append_sheet(targetBook, targetSheet, '明细');
      const targetFile = new File([X.write(targetBook, { type: 'array', bookType: 'xlsx' })], 'synthetic-target.xlsx');
      const sha = await ProjectWorkspaceStore.hash(targetFile), archiveBlob = new Blob(['synthetic boundary fixture']), archiveHash = await ProjectWorkspaceStore.hash(archiveBlob);
      const field = options.alias ? { key: '明细!A1', sheet: '明细', answerKeys: ['A1'], kind: 'blank-cell' } : { key: 'A1', kind: 'blank-cell' };
      if (options.hiddenField) field.hidden = true;
      const target = { id: sha + '::明细', path: 'synthetic-target.xlsx', archiveId: archiveHash, sha256: sha, kind: 'excel', sheet: '明细', fields: [field] };
      const archive = { hash: archiveHash, name: 'fixture.zip', blob: archiveBlob }, index = [{ path: target.path, sha256: sha }];
      globalThis.WorkpaperRouteCatalog = { rows: { 6: { code: '1100', name: '合成目标', mode: 'targets', targets: [target] } } };
      globalThis.WorkpaperDirectory = { rows: [{ row: 6, B: '合成目标', C: '1100' }] };
      const verified = { files: [{ ...index[0], archive, available: true }], sources: [{ archive, index }] };
      globalThis.WorkpaperLibrary = { prepare: async () => { if (globalThis.QA.beforePrepare) await globalThis.QA.beforePrepare(); return verified; }, fileFor: async t => { if (t.sha256 !== sha) throw Error('wrong target'); return { name: target.path, sha256: sha, file: targetFile, archive }; } };
      let record = await ProjectWorkspaceStore.get(id);
      record = await ProjectWorkspaceStore.save(id, record.rev, { choices: { 6: 'yes' }, workpaperSources: { [archiveHash]: { archive, index } } });
      if (options.overwrite) record = await ProjectWorkspaceStore.save(id, record.rev, { answers: { [sha]: { 明细: { A1: '已有人工值' } } } });
      if (options.locked) { const lock = await WorkpaperGovernance.createLock(record, 6, [{ ...target, available: true }], { name: '合成复核人', attested: true }, verified); record = await ProjectWorkspaceStore.save(id, record.rev, { workpaperLocks: { 6: lock } }); }
      globalThis.QA = { id, sha, target, record, completed: 0, error: '', materialRevision: material.revision,
        async save(patch) { this.record = await ProjectWorkspaceStore.save(id, this.record.rev, patch); return this.record; },
        async materialChange() { const db = await AuditChecklist.openTrial(); try { const r = await db.get(id); await db.change(id, r.revision, { type: 'item', id: 'n1', status: 'confirmed', evidence: '新版复核说明', reviewer: '合成新核对人' }); } finally { db.close(); } }
      };
      QA.controller = AuditPreparation.mount(document.querySelector('#qa'), { key: id, isCurrent: () => QA.active !== false, getRecord: () => QA.record, save: p => QA.save(p), run: async fn => { QA.error = ''; try { await fn(); } catch (e) { QA.error = e.message; } finally { QA.completed++; } } });
    }, options);
    await p.waitForFunction(() => document.querySelectorAll('.ap-card > select')[0]?.options.length === 4);
    return { p, context, remote, errors };
  }
  async function configure(p) {
    const roles = p.locator('.ap-card').filter({ has: p.locator('.ap-preview') });
    for (let i = 0; i < 3; i++) {
      await roles.nth(i).locator(':scope > select').selectOption(String(i));
      await p.waitForFunction(i => [...document.querySelectorAll('.ap-card')].filter(e => e.querySelector('.ap-preview'))[i]?.querySelector('.ap-preview table'), i);
      const selectors = roles.nth(i).locator('.fields select');
      for (let j = 0; j < await selectors.count(); j++) await selectors.nth(j).selectOption(String(j));
      await roles.nth(i).locator('input[type=checkbox]').check();
    }
    await p.evaluate(() => {
      const inputs = document.querySelectorAll('.ap-root > .fields input');
      const values = ['合成主体', '2025-01-01', '2025-12-31', 'CNY', '元', '2', '合成核对人'];
      inputs.forEach((e, i) => { e.value = values[i]; });
      document.querySelector('.ap-root textarea').value = JSON.stringify([
        { lineId: 'assets', confirmed: true, terms: [{ accountCode: 'asset', sign: 1 }] },
        { lineId: 'liabilities', confirmed: true, terms: [{ accountCode: 'liability', sign: -1 }] },
        { lineId: 'equity', confirmed: true, terms: [{ accountCode: 'equity', sign: -1 }] }
      ]);
      const eq = [...document.querySelectorAll('.ap-root > .fields')].at(-1).querySelectorAll('input');
      eq.forEach((e, i) => { e.value = ['assets', 'liabilities', 'equity'][i]; });
      document.querySelector('.ap-root > label input[type=checkbox]').checked = true;
    });
  }
  async function clickRun(p, suggestion = false) {
    const before = await p.evaluate(() => QA.completed);
    await p.getByRole('button', { name: suggestion ? '核对来源并写入一个待复核建议' : '运行账表勾稽校验', exact: true }).click();
    await p.waitForFunction(before => QA.completed > before, before);
    return p.evaluate(() => ({ error: QA.error, record: QA.record, status: document.querySelector('.ap-status')?.textContent || '' }));
  }
  async function approve(p) {
    await p.locator('[aria-label="建议来源字段"]').selectOption('0');
    await p.locator('.ap-card').last().locator('input[type=checkbox]').check();
  }
  async function scenario(name, options, fn) {
    await t.test(name, async () => { const f = await fixture(options); try { await fn(f); assert.deepEqual(f.remote, []); assert.deepEqual(f.errors, []); } finally { await f.context.close(); } });
  }
  try {
    await scenario('real XLS/XLSX mapping -> reconciliation -> empty target write and provenance, persisted IDB', {}, async ({ p }) => {
      await configure(p); const r = await clickRun(p); assert.equal(r.error, ''); assert.equal(r.record.reconciliation.result.eligibleForSuggestions, true);
      await approve(p); const out = await clickRun(p, true); assert.equal(out.error, '');
      const stored = await p.evaluate(async () => ({ record: await ProjectWorkspaceStore.get(QA.id), sha: QA.sha }));
      assert.equal(stored.record.answers[stored.sha]['明细'].A1, '合成主体');
      const provenance = stored.record.autoFillProvenance[stored.sha]['明细'].A1;
      assert.equal(provenance.kind, 'auto'); assert.equal(provenance.state, 'pending-review'); assert.equal(provenance.sourceHashes.length, 3); assert.equal(provenance.checkInputHash, r.record.reconciliation.inputHash); assert.equal(provenance.sourceRef, 'scope.entityId');
    });
    await scenario('source blank amount remains incomplete and prevents suggestion', { emptyAmount: true }, async ({ p }) => {
      await configure(p); const r = await clickRun(p); assert.equal(r.error, ''); assert.equal(r.record.reconciliation.result.eligibleForSuggestions, false); assert.ok(r.record.reconciliation.result.issues.some(i => i.code === 'UNKNOWN_AMOUNT'));
      await approve(p); assert.match((await clickRun(p, true)).error, /禁止|未全部|校验/u);
    });
    await scenario('unreviewed material cannot supply suggestions even with arithmetic eligibility', { unconfirmed: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const r = await clickRun(p, true); assert.match(r.error, /核对/u); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('material revision changes invalidate previous analysis before write', {}, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); await p.evaluate(() => QA.materialChange());
      const r = await clickRun(p, true); assert.match(r.error, /改变|变化|重新/u); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('material revision changed during target preparation is rechecked immediately before write', {}, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p);
      await p.evaluate(() => { QA.beforePrepare = () => QA.materialChange(); });
      const r = await clickRun(p, true); assert.match(r.error, /改变|变化|重新/u); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('workspace changed by another writer during target preparation is not overwritten', {}, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p);
      await p.evaluate(() => { QA.beforePrepare = async () => { const r = await ProjectWorkspaceStore.get(QA.id); await ProjectWorkspaceStore.save(QA.id, r.rev, { answers: { [QA.sha]: { 明细: { A1: '并发人工填写' } } } }); }; });
      const r = await clickRun(p, true); assert.match(r.error, /更新|版本|覆盖/u);
      const stored = await p.evaluate(async () => (await ProjectWorkspaceStore.get(QA.id)).answers[QA.sha]['明细']); assert.deepEqual(stored, { A1: '并发人工填写' });
    });
    await scenario('destroyed or switched project cannot save after awaited target preparation', {}, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p);
      await p.evaluate(() => { QA.beforePrepare = async () => { QA.active = false; QA.controller.destroy(); }; });
      const before = await p.evaluate(() => QA.record.rev);
      const r = await clickRun(p, true); assert.match(r.error, /项目|页面/u); assert.equal(r.record.rev, before); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('existing ordinary answer cannot be overwritten', { overwrite: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const r = await clickRun(p, true); assert.match(r.error, /已有|覆盖/u);
      assert.equal(await p.evaluate(() => QA.record.answers[QA.sha]['明细'].A1), '已有人工值');
    });
    await scenario('existing alias-backed answer cannot be bypassed by composite display key', { alias: true, overwrite: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const r = await clickRun(p, true); assert.match(r.error, /已有|覆盖/u);
      assert.deepEqual(await p.evaluate(() => QA.record.answers[QA.sha]['明细']), { A1: '已有人工值' });
    });
    await scenario('composite display field resolves to actual address and same provenance address', { alias: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const r = await clickRun(p, true); assert.equal(r.error, '');
      assert.deepEqual(await p.evaluate(() => QA.record.answers[QA.sha]['明细']), { A1: '合成主体' });
      assert.ok(await p.evaluate(() => QA.record.autoFillProvenance[QA.sha]['明细'].A1));
    });
    await scenario('real governance lock blocks suggestion without changing locked contents', { locked: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const before = await p.evaluate(() => JSON.stringify(QA.record.workpaperLocks));
      const r = await clickRun(p, true); assert.match(r.error, /冻结/u); assert.equal(await p.evaluate(() => JSON.stringify(QA.record.workpaperLocks)), before); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('empty original choice really clears the source, not coercion to source zero', {}, async ({ p }) => {
      await configure(p); await p.evaluate(async () => { const select = document.querySelector('[aria-label="序时账原资料"]'); select.value = ''; await select.onchange(); });
      assert.equal(await p.locator('.ap-preview').first().locator('table').count(), 0);
      const r = await clickRun(p); assert.match(r.error, /选择|资料/u); assert.equal(r.record.reconciliation, undefined);
    });
    await scenario('blank rows inside explicitly selected source range are not silently omitted', { blankRow: true }, async ({ p }) => {
      await configure(p); const r = await clickRun(p);
      assert.ok(r.error || r.record.reconciliation.result.eligibleForSuggestions === false, 'silent row omission must not produce eligible results');
    });
    await scenario('hidden field is never selectable for automatic writing', { hiddenField: true }, async ({ p }) => {
      assert.equal(await p.locator('[aria-label="建议目标空白字段"] option').evaluateAll(xs => xs.filter(x => x.value).length), 0);
    });
    await scenario('concurrent selection of separate roles does not cancel another source reader', {}, async ({ p }) => {
      await p.evaluate(async () => {
        const a = document.querySelector('[aria-label="序时账原资料"]'), b = document.querySelector('[aria-label="科目余额表原资料"]');
        a.value = '0'; b.value = '1'; await Promise.all([a.onchange(), b.onchange()]);
      });
      assert.equal(await p.locator('.ap-preview table').count(), 2);
    });
    await scenario('same physical column cannot be accepted for different declared fields', {}, async ({ p }) => {
      await configure(p);
      await p.locator('.ap-card').first().locator('.fields select').nth(5).selectOption('4');
      const r = await clickRun(p); assert.match(r.error, /重复|同.*列|不同.*列/u); assert.equal(r.record.reconciliation, undefined);
    });
    await scenario('changing a reviewed mapping revokes the relevant manual confirmation', {}, async ({ p }) => {
      await configure(p);
      await p.locator('.ap-card').first().locator('.fields select').nth(4).selectOption('5');
      assert.equal(await p.locator('.ap-card').first().locator('input[type=checkbox]').isChecked(), false);
    });
    await scenario('scope supports matching explicit unit without conversion; wrong or blank scope blocks', {}, async ({ p }) => {
      await configure(p); await p.evaluate(() => { document.querySelectorAll('.ap-root > .fields input')[4].value = '万元'; });
      const r = await clickRun(p); assert.equal(r.error, ''); assert.equal(r.record.reconciliation.input.scope.unit, '万元'); assert.equal(r.record.reconciliation.result.eligibleForSuggestions, true);
      await p.evaluate(() => { document.querySelectorAll('.ap-root > .fields input')[0].value = ''; });
      const r2 = await clickRun(p); assert.equal(r2.record.reconciliation.result.eligibleForSuggestions, false);
    });
    await scenario('blank precision is not silently converted to zero precision', {}, async ({ p }) => {
      await configure(p); await p.evaluate(() => { document.querySelectorAll('.ap-root > .fields input')[5].value = ''; });
      const r = await clickRun(p); assert.match(r.error, /小数位|空白/u); assert.equal(r.record.reconciliation, undefined);
    });
    await scenario('declared blank field cannot override a real original formula', { targetFormula: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const r = await clickRun(p, true);
      assert.match(r.error, /空白|公式/u); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('declared blank field cannot override real original text', { targetNonblank: true }, async ({ p }) => {
      await configure(p); await clickRun(p); await approve(p); const r = await clickRun(p, true);
      assert.match(r.error, /空白|改写/u); assert.equal(r.record.autoFillProvenance, undefined);
    });
    await scenario('explicit zero is writable and provenance names its original worksheet cell', {}, async ({ p }) => {
      await configure(p); await clickRun(p);
      await p.locator('[aria-label="建议来源字段"]').selectOption('4');
      await p.locator('.ap-card').last().locator('input[type=checkbox]').check();
      const r = await clickRun(p, true); assert.equal(r.error, '');
      const data = await p.evaluate(() => ({ value: QA.record.answers[QA.sha]['明细'].A1, provenance: QA.record.autoFillProvenance[QA.sha]['明细'].A1, analysis: QA.record.reconciliation }));
      assert.equal(data.value, '0.00'); assert.equal(data.provenance.sourceLocation.address, 'E2'); assert.equal(data.provenance.sourceLocation.sheet, '明细');
      assert.equal(data.provenance.mappingHash, data.analysis.mappingHash); assert.equal(data.analysis.columnMappings.trialBalance.columns.periodCredit, 4);
    });
  } finally { await browser.close(); }
});
