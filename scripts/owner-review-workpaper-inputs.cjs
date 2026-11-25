'use strict';

const { randomUUID, webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceCodec = require('../dist/legacy-project-source.js');
const { migrationSource } = require('../tests/helpers/project-migration-fixture.cjs');
const { codec, fixture, sha, zip } = require('../tests/helpers/workpaper-package-fixture.cjs');
const { excel, legacy, word } = require('../tests/helpers/workpaper-office-fixture.cjs');

async function createOwnerReviewWorkpaperInputs() {
  // The matched pair is made from synthetic fixtures at build time.
  const id = randomUUID();
  const source = Buffer.from(sourceCodec.encode(migrationSource({ id, sequence: 71 })));
  const frozen = { ...excel({ visibleOther: true }), name: 'existing-frozen.xlsx' };
  const documents = [excel(), word(), legacy(), frozen];
  const original = zip(documents.map(document => ({ name: document.name, data: document.bytes })));
  const archive = {
    name: '合成底稿原包.zip',
    hash: sha(original),
    blob: new Blob([original], { type: 'application/zip' }),
  };
  const index = documents.map(document => ({
    name: document.name,
    path: document.name,
    sha256: document.sha256,
    size: document.bytes.length,
  }));
  const { record } = await fixture({ id });
  Object.assign(record, {
    archive,
    index,
    workpaperSources: { [archive.hash]: { archive, index, phase: 3, canonicalName: archive.name } },
    answers: { [documents[0].sha256]: { 原表: { A2: '迁入前已保存填写' } } },
  });

  const target = {
    id: frozen.sha256 + '::原表',
    sha256: frozen.sha256,
    path: frozen.name,
    archiveId: archive.hash,
    kind: 'excel',
    sheet: '原表',
    fields: ['A2'],
    fieldPolicy: 'declared-structural-blank-input-boxes-v1',
  };
  const context = vm.createContext({
    Blob, TextEncoder, crypto: webcrypto,
    WorkpaperRouteCatalog: { rows: { 8: { mode: 'targets', targets: [target] } }, incompleteLayouts: {} },
  });
  for (const filename of ['workpaper-routing.js', 'workpaper-governance.js']) {
    const file = path.join(__dirname, '..', 'dist', filename);
    vm.runInContext(readFileSync(file, 'utf8'), context, { filename });
  }
  record.workpaperLocks[8] = structuredClone(await context.WorkpaperGovernance.createLock(
    record, 8, [target], { name: '既有合成核对人', attested: true },
    { files: index.map(file => ({ ...file, archiveId: archive.hash, archive })), sources: [{ archive, index, phase: 3 }] }
  ));

  const complete = await codec.create({ record, readCurrent: async () => record });
  return {
    'synthetic-formal-source.json': source,
    'synthetic-complete-workpapers.zip': Buffer.from(complete.bytes),
  };
}

module.exports = { createOwnerReviewWorkpaperInputs };
