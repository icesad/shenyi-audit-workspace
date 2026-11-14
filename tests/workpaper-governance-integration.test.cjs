'use strict';
/* Isolated synthetic browser integration. Real workspace IndexedDB, XLSX worker,
 * renderers and governance; directory/ZIP enumeration uses an explicit test boundary. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const dist = path.resolve(__dirname, '../dist');
test('governance renderer/store/workspace integration', async t => {
  let chromium; try { ({ chromium } = require('playwright')); } catch { return t.skip('Playwright unavailable'); }
  const executablePath = process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE || chromium.executablePath();
  if (!fs.existsSync(executablePath)) return t.skip('Chromium unavailable');
  const browser = await chromium.launch({ headless: true, executablePath });
  async function setup(options = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block' }), p = await context.newPage(), requests = [], errors = [];
    p.setDefaultTimeout(8000);
    p.on('request', r => { if (/^(?:https?|wss?):/u.test(r.url())) requests.push(r.url()); }); p.on('pageerror', e => errors.push(e.message));
    await p.route(/^https?:/u, r => r.abort()); await p.goto(pathToFileURL(path.join(dist, 'rule-catalog.js')).href);
    await p.evaluate(() => { document.body.innerHTML = '<div id="host"></div><div id="direct"></div>'; });
    for (const f of ['workpaper-xlsx-source.js', 'workpaper-sheets.js', 'project-workspace-store.js', 'workpaper-routing.js', 'workpaper-governance.js', 'workpaper-original-sheet.js', 'workpaper-original-word.js', 'workpaper-stages.js', 'workpaper-workspace.js']) await p.addScriptTag({ content: fs.readFileSync(path.join(dist, f), 'utf8') });
    await p.evaluate(async options => {
      const id = '00000000-0000-4000-8000-000000000033', X = new Function(WorkpaperXlsxSource + ';return XLSX;')(), book = X.utils.book_new();
      for (const name of ['冻结页', '其他页', '隐藏页']) X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[name === '隐藏页' ? '隐藏原缓存' : '原模板文字', '', ''], ['', '', '']]), name);
      book.Workbook = { Sheets: [{ name: '冻结页', Hidden: 0 }, { name: '其他页', Hidden: 0 }, { name: '隐藏页', Hidden: 1 }] };
      const file = new File([X.write(book, { type: 'array', bookType: 'xlsx' })], 'fixture.xlsx'), sha = await ProjectWorkspaceStore.hash(file);
      const archiveBlob = new Blob(['fixture-archive-bytes']), archiveHash = await ProjectWorkspaceStore.hash(archiveBlob), archive = { name: 'fixture.zip', hash: archiveHash, blob: archiveBlob };
      const target = { id: sha + '::冻结页', archiveId: archiveHash, path: 'fixture.xlsx', sha256: sha, kind: 'excel', sheet: '冻结页', fields: ['A1', 'B1'] };
      const index = [{ path: target.path, name: target.path, sha256: sha }];
      globalThis.WorkpaperRouteCatalog = { rows: { 6: { code: '1100', name: '冻结测试', mode: 'targets', targets: [target] } } };
      const layout = { range: { s: { r: 0, c: 0 }, e: { r: 1, c: 2 } }, cols: [120, 120, 120], rows: [30, 30], hiddenCols: [], hiddenRows: [], merges: [], styles: {}, styleTable: [{}] };
      const layouts = { sheets: { 冻结页: layout, 其他页: layout, 隐藏页: { ...layout, visibility: 1 } } };
      const verified = { files: [{ ...index[0], archive, available: true }], sources: [{ archive, index }] };
      const auto = { kind: 'auto', state: 'pending-review', value: '自动建议', sourceHashes: ['a'.repeat(64)], sourceRef: 'synthetic', pendingReview: true, history: [] };
      const reuse = { kind: 'reuse', state: 'pending-review', value: '复用文字', sourceProjectId: 'synthetic-source', sourceTemplateHash: 'b'.repeat(64), pendingReview: true, history: [] };
      let r = await ProjectWorkspaceStore.get(id);
      r = await ProjectWorkspaceStore.save(id, r.rev, { choices: { 6: 'yes' }, workpaperSources: { [archiveHash]: { archive, index } }, answers: { [sha]: { 冻结页: { A1: '已保存冻结值', B1: '冻结补充' }, 其他页: { A1: '其他页人工值', B1: '自动建议', C1: '复用文字' }, 隐藏页: { A1: '不应显示的隐藏在线值' } } }, autoFillProvenance: { [sha]: { 其他页: { B1: auto } } }, workpaperReuseProvenance: { [sha]: { 其他页: { C1: reuse } } } });
      const lock = await WorkpaperGovernance.createLock(r, 6, [{ ...target, available: true }], { name: '合成复核人', attested: true }, verified);
      r = await ProjectWorkspaceStore.save(id, r.rev, { workpaperLocks: { 6: lock } });
      globalThis.Q = { id, file, sha, archiveHash, record: r, layout, verified, target, prepMounted: 0, prepDestroyed: 0 };
      globalThis.AuditChecklist = { TRIAL_ID: id };
      Q.initialListReleases = [];
      globalThis.ProjectInitiation = { listSaved: () => options.initialPending ? new Promise(resolve => { Q.initialListReleases.push(() => resolve([])); }) : Promise.resolve([{ quoteId: '4a502e25-69a2-4ff6-b37f-d06a1598eb12', form: { projectName: '另一合成项目' } }]) };
      globalThis.WorkpaperLibrary = { layout: async () => layouts, word: async () => null };
      globalThis.WorkpaperDirectoryUI = { mount(host, ctx) { Q.directory = ctx; host.innerHTML = '<div id="editor"></div>'; return { ready: Promise.resolve(), refresh() {}, openIndex: async () => ({ state: 'ready' }) }; } };
      globalThis.AuditPreparation = { mount(host, ctx) { Q.prepMounted++; Q.prep = ctx; const n = document.createElement('p'); n.textContent = '合成准备界面'; host.append(n); return { destroy() { Q.prepDestroyed++; n.remove(); } }; } };
      document.querySelector('#host').innerHTML = '<select id="ac-project"><option value="' + id + '">合成独立试用</option></select>';
      if (options.initialPending) document.querySelector('#ac-project').value = '';
      Q.workspace = WorkpaperWorkspace.mount(document.querySelector('#host'));
    }, options);
    if (!options.initialPending) { await p.locator('[data-audit-step="2"]').click(); await p.waitForFunction(() => !!Q.directory && !!document.querySelector('#editor')); }
    return { p, context, requests, errors };
  }
  async function scenario(name, fn) { await t.test(name, async () => { const f = await setup(); try { await fn(f.p); assert.deepEqual(f.requests, []); assert.deepEqual(f.errors, []); } finally { await f.context.close(); } }); }
  async function open(p) { await p.evaluate(() => Q.directory.openFile('fixture.xlsx', document.querySelector('#editor'), { file: Q.file, sha256: Q.sha, target: Q.target })); }
  try {
    await scenario('frozen native sheet shows saved version read-only, not original template', async p => {
      await open(p); assert.equal(await p.locator('[data-cell="A1"]').textContent(), '已保存冻结值');
      assert.equal(await p.locator('[data-cell="A1"]').getAttribute('contenteditable'), null);
      assert.equal(await p.getByRole('button', { name: '保存本份在线填写', exact: true }).isDisabled(), true);
      assert.match(await p.locator('.pw-frozen-note').textContent(), /合成复核人|冻结/u);
    });
    await scenario('sheet lock does not freeze another sheet; yellow/blue and manual provenance survive saved edits', async p => {
      await open(p); await p.locator('#pw-sheet').selectOption({ label: '其他页' });
      assert.equal(await p.getByRole('button', { name: '保存本份在线填写', exact: true }).isEnabled(), true);
      assert.equal(await p.locator('[data-cell="A1"]').getAttribute('contenteditable'), 'true');
      assert.equal(await p.locator('[data-original-cell="B1"]').evaluate(n => n.classList.contains('pw-provenance-auto')), true);
      assert.equal(await p.locator('[data-original-cell="C1"]').evaluate(n => n.classList.contains('pw-provenance-reuse')), true);
      await p.locator('[data-cell="B1"]').fill('人工修正建议');
      assert.match(await p.locator('[data-original-cell="B1"]').getAttribute('data-provenance-label'), /人工修正.*待复核/u);
      await p.getByRole('button', { name: '保存本份在线填写', exact: true }).click();
      await p.waitForFunction(async () => (await ProjectWorkspaceStore.get(Q.id)).answers[Q.sha]['其他页'].B1 === '人工修正建议');
      const r = await p.evaluate(async () => { const r = await ProjectWorkspaceStore.get(Q.id); return { old: r.answers[Q.sha]['冻结页'].A1, auto: r.autoFillProvenance[Q.sha]['其他页'].B1, reuse: r.workpaperReuseProvenance[Q.sha]['其他页'].C1 }; });
      assert.equal(r.old, '已保存冻结值'); assert.equal(r.auto.state, 'manual-corrected'); assert.equal(r.auto.sourceRef, 'synthetic'); assert.equal(r.auto.value, '自动建议'); assert.ok(r.auto.history.length); assert.equal(r.reuse.sourceProjectId, 'synthetic-source');
    });
    await scenario('hidden sheet remains original cache despite saved edits and shows no editable cells', async p => {
      await open(p); await p.locator('#pw-show-hidden').check(); await p.locator('#pw-sheet').selectOption('隐藏页');
      assert.equal(await p.locator('[data-cell="A1"]').textContent(), '隐藏原缓存'); assert.equal(await p.locator('[contenteditable="true"]').count(), 0);
    });
    await scenario('read-only native Word displays saved words and has no write event handlers', async p => {
      const r = await p.evaluate(() => {
        const host = document.querySelector('#direct'), model = { width: 500, fillableKeys: ['native:p1'], blocks: [{ type: 'paragraph', id: 'p1', runs: [{ text: '原Word文字' }] }] };
        WorkpaperOriginalWord.renderModel({ container: host, model, edits: { 'native:p1': '已保存的冻结Word内容' }, readOnly: true, onChange() { throw Error('read-only change'); } });
        const n = host.querySelector('[data-native-word-id="p1"]'); return { text: n.textContent, editable: n.getAttribute('contenteditable'), input: !!n.oninput };
      }); assert.equal(r.text, '已保存的冻结Word内容'); assert.equal(r.editable, null); assert.equal(r.input, false);
    });
    await scenario('direct Store rejects changed frozen answers, choices, source metadata, lock deletion and frozen provenance', async p => {
      const out = await p.evaluate(async () => {
        const S = ProjectWorkspaceStore, start = await S.get(Q.id), outcomes = [];
        for (const kind of ['answers', 'choices', 'source', 'locks', 'provenance']) {
          const r = await S.get(Q.id); let patch;
          if (kind === 'answers') { const answers = structuredClone(r.answers); answers[Q.sha]['冻结页'].A1 = '禁止'; patch = { answers }; }
          if (kind === 'choices') patch = { choices: { 6: 'no' } };
          if (kind === 'source') { const s = structuredClone(r.workpaperSources); s[Q.archiveHash].archive.name = 'replaced.zip'; patch = { workpaperSources: s }; }
          if (kind === 'locks') patch = { workpaperLocks: {} };
          if (kind === 'provenance') { const v = structuredClone(r.autoFillProvenance); (v[Q.sha]['冻结页'] ||= {}).A1 = { kind: 'auto', state: 'pending-review', value: '新标记' }; patch = { autoFillProvenance: v }; }
          let error = ''; try { await S.save(Q.id, r.rev, patch); } catch (e) { error = e.message; } outcomes.push({ kind, error, revision: (await S.get(Q.id)).rev });
        }
        return { outcomes, startRevision: start.rev };
      }); for (const o of out.outcomes) { assert.match(o.error, /冻结/u, o.kind); assert.equal(o.revision, out.startRevision); }
    });
    await scenario('same-size changed archive bytes cannot bypass frozen source preservation via ordinary Store API', async p => {
      const out = await p.evaluate(async () => {
        const r = await ProjectWorkspaceStore.get(Q.id), sources = structuredClone(r.workpaperSources), original = sources[Q.archiveHash].archive.blob;
        sources[Q.archiveHash].archive.blob = new Blob(['x'.repeat(original.size)], { type: original.type }); let error = '';
        try { await ProjectWorkspaceStore.save(Q.id, r.rev, { workpaperSources: sources }); } catch (e) { error = e.message; }
        return { error, oldRevision: r.rev, newRevision: (await ProjectWorkspaceStore.get(Q.id)).rev };
      }); assert.ok(out.error, 'changed bytes with unchanged declared hash must not pass'); assert.equal(out.newRevision, out.oldRevision);
    });
    await scenario('unfrozen archive/riskArchive/library source also reject incorrect declared hashes', async p => {
      const out = await p.evaluate(async () => {
        const id = '4a502e25-69a2-4ff6-b37f-d06a1598eb12', bad = { name: 'wrong.zip', hash: 'a'.repeat(64), blob: new Blob(['different source bytes']) }, results = [];
        for (const patch of [{ archive: bad, index: [] }, { riskArchive: bad, riskIndex: [] }, { workpaperSources: { [bad.hash]: { archive: bad, index: [] } } }]) {
          let error = ''; try { await ProjectWorkspaceStore.save(id, 0, patch); } catch (e) { error = e.message; } results.push({ error, revision: (await ProjectWorkspaceStore.get(id)).rev });
        } return results;
      }); assert.equal(out.length, 3); out.forEach(r => { assert.ok(r.error); assert.equal(r.revision, 0); });
    });
    await scenario('caller patch mutation while digest awaits cannot replace verified bytes or inject unrelated values', async p => {
      const out = await p.evaluate(async () => {
        const id = '4a502e25-69a2-4ff6-b37f-d06a1598eb12', blob = new Blob(['verified original bytes']), hash = await ProjectWorkspaceStore.hash(blob);
        const patch = { archive: { name: 'original.zip', hash, blob }, index: [] }, originalDigest = crypto.subtle.digest.bind(crypto.subtle);
        let release, entered; const gate = new Promise(r => { release = r; }), reached = new Promise(r => { entered = r; });
        crypto.subtle.digest = async (...args) => { entered(); await gate; return originalDigest(...args); };
        try {
          const pending = ProjectWorkspaceStore.save(id, 0, patch);
          await Promise.race([reached, new Promise((_, reject) => setTimeout(() => reject(Error('source digest was not reached within bounded wait')), 5000))]);
          patch.archive.blob = new Blob(['x'.repeat(blob.size)]); patch.archive.name = 'mutated.zip'; patch.answers = { forged: true };
          release(); await pending;
        } finally { release(); crypto.subtle.digest = originalDigest; }
        const r = await ProjectWorkspaceStore.get(id); return { name: r.archive.name, sha: await ProjectWorkspaceStore.hash(r.archive.blob), expected: hash, answers: r.answers, revision: r.rev };
      }); assert.equal(out.name, 'original.zip'); assert.equal(out.sha, out.expected); assert.equal(out.answers, undefined); assert.equal(out.revision, 1);
    });
    await scenario('direct concurrent CAS allows one unrelated update and never loses the lock', async p => {
      const out = await p.evaluate(async () => {
        const r = await ProjectWorkspaceStore.get(Q.id), races = await Promise.allSettled([ProjectWorkspaceStore.save(Q.id, r.rev, { industryTag: '合成行业甲' }), ProjectWorkspaceStore.save(Q.id, r.rev, { industryTag: '合成行业乙' })]);
        const after = await ProjectWorkspaceStore.get(Q.id); return { successes: races.filter(x => x.status === 'fulfilled').length, failures: races.filter(x => x.status === 'rejected').map(x => x.reason.message), delta: after.rev - r.rev, lock: after.workpaperLocks['6'].snapshotHash === r.workpaperLocks['6'].snapshotHash };
      }); assert.equal(out.successes, 1); assert.equal(out.delta, 1); assert.equal(out.lock, true); assert.match(out.failures[0], /更新|覆盖/u);
    });
    await scenario('missing governance module fails closed for existing locks and new lock attempts', async p => {
      const out = await p.evaluate(async () => {
        const G = WorkpaperGovernance; globalThis.WorkpaperGovernance = undefined; const messages = [];
        try { const r = await ProjectWorkspaceStore.get(Q.id); try { await ProjectWorkspaceStore.save(Q.id, r.rev, { industryTag: '禁止缺组件保存' }); } catch (e) { messages.push(e.message); }
          const id = '4a502e25-69a2-4ff6-b37f-d06a1598eb12'; try { await ProjectWorkspaceStore.save(id, 0, { workpaperLocks: { 6: {} } }); } catch (e) { messages.push(e.message); }
        } finally { globalThis.WorkpaperGovernance = G; } return messages;
      }); assert.equal(out.length, 2); out.forEach(x => assert.match(x, /冻结.*组件|组件.*冻结/u));
    });
    await scenario('stage8 current project binding and destroy occur on both stage and project changes', async p => {
      await p.locator('[data-audit-step="8"]').click(); await p.waitForFunction(() => Q.prepMounted === 1); assert.equal(await p.evaluate(() => Q.prep.isCurrent()), true);
      await p.locator('[data-audit-step="1"]').click(); assert.equal(await p.evaluate(() => Q.prepDestroyed), 1); assert.equal(await p.evaluate(() => Q.prep.isCurrent()), false);
      await p.locator('[data-audit-step="8"]').click(); await p.waitForFunction(() => Q.prepMounted === 2);
      await p.evaluate(() => { Q.previousPrep = Q.prep; });
      await p.locator('#pw-project').selectOption('4a502e25-69a2-4ff6-b37f-d06a1598eb12'); await p.waitForFunction(() => Q.prepDestroyed === 2 && Q.prepMounted === 3);
      assert.equal(await p.evaluate(() => Q.previousPrep.isCurrent()), false); assert.equal(await p.evaluate(() => Q.prep.isCurrent()), true);
      assert.equal(await p.evaluate(() => Q.prep.key), '4a502e25-69a2-4ff6-b37f-d06a1598eb12');
    });
    await scenario('late project-list response cannot erase a fast trial selection or lose it across stages', async p => {
      // Begin from a populated dropdown but no project; remove material-selector fallback.
      await p.evaluate(() => { document.querySelector('#ac-project').value = ''; });
      await p.locator('#pw-project').selectOption('');
      await p.waitForFunction(() => document.querySelector('#pw-status').textContent.includes('请先选择'));
      await p.evaluate(() => {
        Q.listCalls = 0;
        ProjectInitiation.listSaved = () => {
          Q.listCalls++;
          if (Q.listCalls === 1) return new Promise(resolve => { Q.finishListing = () => resolve([]); });
          return Promise.resolve([]);
        };
      });
      await p.locator('[data-audit-step="8"]').click();
      await p.waitForFunction(() => Q.listCalls === 1 && typeof Q.finishListing === 'function');
      await p.locator('#pw-project').selectOption('00000000-0000-4000-8000-000000000033');
      await p.waitForFunction(() => Q.prep?.key === Q.id && Q.prep.isCurrent());
      // Release the exact older pending call, then wait one paint for its DOM effects.
      await p.evaluate(async () => { Q.finishListing(); await new Promise(resolve => requestAnimationFrame(resolve)); });
      assert.equal(await p.locator('#pw-project').inputValue(), '00000000-0000-4000-8000-000000000033');
      assert.equal(await p.evaluate(() => Q.prep.isCurrent()), true);
      await p.locator('[data-audit-step="2"]').click();
      await p.waitForFunction(() => !!document.querySelector('#editor') && Q.directory?.isCurrent());
      assert.equal(await p.locator('#pw-project').inputValue(), '00000000-0000-4000-8000-000000000033');
      assert.equal(await p.evaluate(() => Q.directory.key), '00000000-0000-4000-8000-000000000033');
    });
    await t.test('first startup pending lists still allow immediate trial button and keep selection after release', async () => {
      const f = await setup({ initialPending: true }), p = f.p;
      try {
        await p.waitForFunction(() => Q.initialListReleases.length === 1);
        // Stage8 reveals the trial button; keep BOTH initial and stage-list requests pending.
        await p.locator('[data-audit-step="8"]').click();
        await p.waitForFunction(() => Q.initialListReleases.length === 2);
        assert.equal(await p.locator('#pw-project').inputValue(), '');
        await p.getByRole('button', { name: '独立试用', exact: true }).click();
        await p.waitForFunction(() => Q.prep?.key === Q.id && Q.prep.isCurrent());
        assert.equal(await p.locator('#pw-project').inputValue(), '00000000-0000-4000-8000-000000000033');
        await p.evaluate(async () => {
          ProjectInitiation.listSaved = () => Promise.resolve([]);
          // Complete newest first, then the obsolete initial response.
          for (const release of [...Q.initialListReleases].reverse()) release();
          await new Promise(resolve => requestAnimationFrame(resolve));
        });
        assert.equal(await p.locator('#pw-project').inputValue(), '00000000-0000-4000-8000-000000000033');
        await p.locator('[data-audit-step="2"]').click();
        await p.waitForFunction(() => Q.directory?.isCurrent() && !!document.querySelector('#editor'));
        assert.equal(await p.evaluate(() => Q.directory.key), '00000000-0000-4000-8000-000000000033');
        assert.deepEqual(f.requests, []); assert.deepEqual(f.errors, []);
      } finally { await f.context.close(); }
    });
  } finally { await browser.close(); }
});
