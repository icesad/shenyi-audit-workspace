/* Explicit export of a saved record. Never calculate or create source databases. */
(function (root) {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  function missing() { return Error('未找到本项目已有的正式立项、固定编号或已保存账表校验记录；未新建资料或运行校验。'); }
  function changed() { return Error('项目或已保存校验记录在导出期间已改变，请刷新核对；未下载旧快照。'); }
  function readExisting(name, storeName, keyPath, key) {
    return new Promise((resolve, reject) => {
      let request, completed = false, absent = false;
      function finish(error, value) {
        if (completed) return;
        completed = true;
        error ? reject(error) : resolve(value);
      }
      try { request = root.indexedDB.open(name); } catch { finish(missing()); return; }
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onblocked = () => finish(Error('本机资料库正被其他窗口占用，请关闭旧窗口后重试。'));
      request.onerror = event => { event.preventDefault(); finish(absent ? null : missing(), null); };
      request.onsuccess = () => {
        const db = request.result;
        if (completed) { db.close(); return; }
        db.onversionchange = () => db.close();
        try {
          if (db.version !== 1 || db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains(storeName)) throw missing();
          const transaction = db.transaction(storeName, 'readonly'), store = transaction.objectStore(storeName);
          if (store.keyPath !== keyPath || store.autoIncrement) { transaction.abort(); throw missing(); }
          const read = store.get(key);
          transaction.oncomplete = () => { db.close(); finish(null, read.result ?? null); };
          transaction.onabort = () => { db.close(); finish(missing()); };
        } catch (error) { db.close(); finish(error); }
      };
    });
  }
  async function load(projectId, assertContext) {
    assertContext();
    if (typeof projectId !== 'string' || !UUID.test(projectId) || !root.LedgerCheckSnapshot || !root.ProjectWorkspaceStore?.getProjectNumber || !root.ProjectInitiation?.validateRecord || !root.indexedDB) throw missing();
    // Settle all reads, including failed opens, before returning. Aborted first
    // opens roll back the empty database instead of leaving a new namespace.
    const values = await Promise.allSettled([
      readExisting('hengdu.project.workspace.v1', 'workspaces', 'id', projectId),
      readExisting('hengdu.quote.projects.v1', 'projects', 'quoteId', projectId),
      root.ProjectWorkspaceStore.getProjectNumber(projectId)
    ]);
    assertContext();
    if (values.some(value => value.status !== 'fulfilled')) throw missing();
    const [workspace, record, identity] = values.map(value => value.value);
    if (!workspace || workspace.id !== projectId || !Number.isSafeInteger(workspace.rev) || workspace.rev < 1 || !workspace.reconciliation || !record || !identity || identity.projectId !== projectId) throw missing();
    const initiation = root.ProjectInitiation.validateRecord(record);
    if (initiation.quoteId !== projectId) throw missing();
    if (workspace.projectIdentity !== undefined && ['schemaVersion', 'projectId', 'year', 'sequence', 'firstWonAt'].some(key => workspace.projectIdentity?.[key] !== identity[key])) throw changed();
    const proof = JSON.stringify({ projectId, revision: workspace.rev, reconciliation: workspace.reconciliation, projectIdentity: workspace.projectIdentity ?? null, initiation, identity });
    return { workspace, proof };
  }
  async function read(projectId, assertContext = () => {}) {
    const { workspace } = await load(projectId, assertContext);
    const value = await root.LedgerCheckSnapshot.create({ projectId, workspaceRevision: workspace.rev, reconciliation: workspace.reconciliation });
    assertContext(); return value;
  }
  async function download(projectId, { assertContext = () => {} } = {}) {
    const original = await load(projectId, assertContext);
    const source = await root.LedgerCheckSnapshot.create({ projectId, workspaceRevision: original.workspace.rev, reconciliation: original.workspace.reconciliation });
    const text = await root.LedgerCheckSnapshot.serialize(source), bytes = new TextEncoder().encode(text);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const fresh = await load(projectId, assertContext);
    if (fresh.proof !== original.proof) throw changed();
    assertContext();
    // No awaited computation follows the final read. Separate source databases
    // still do not form a global serializable transaction or a signed record.
    const blob = new Blob([bytes], { type: 'application/json;charset=utf-8' }), url = root.URL.createObjectURL(blob);
    try {
      const anchor = root.document.createElement('a'); anchor.href = url;
      anchor.download = '审易-已保存账表校验快照-' + projectId + '.json'; anchor.click();
    } finally { root.URL.revokeObjectURL(url); }
    return { projectId, workspaceRevision: source.workspaceRevision, calculatedAt: source.reconciliation.calculatedAt, byteLength: bytes.length, sha256 };
  }
  root.LedgerCheckSnapshotExport = Object.freeze({ read, download });
})(globalThis);
