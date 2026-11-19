'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const sourceCodec = require('../dist/legacy-project-source.js');
const { createOwnerReviewWorkpaperInputs } = require('../scripts/owner-review-workpaper-inputs.cjs');
const { codec, sha, unzip } = require('./helpers/workpaper-package-fixture.cjs');

test('owner review supplies a matched synthetic source and complete stock-codec workpaper package', async () => {
  const pair = await createOwnerReviewWorkpaperInputs();
  assert.deepEqual(Object.keys(pair).sort(), [
    'synthetic-complete-workpapers.zip',
    'synthetic-formal-source.json',
  ]);
  const source = await sourceCodec.inspect(pair['synthetic-formal-source.json']);
  const input = pair['synthetic-complete-workpapers.zip'];
  const { summary, storage } = await codec.inspectForStorage(input);
  assert.equal(summary.projectId, source.source.quote.id);
  assert.equal(summary.originalCount, 2);
  assert.equal(summary.freezeCount, 1);
  assert.equal(source.source.quote.snapshot.customerName, '合成被审单位');
  assert.doesNotMatch(storage.recordJson, /EXCLUDED_/);

  const record = JSON.parse(storage.recordJson);
  const container = storage.originals.find(item => Buffer.from(item.bytes).readUInt32LE(0) === 0x04034b50);
  assert.ok(container);
  const documents = unzip(Buffer.from(container.bytes));
  assert.deepEqual(documents.map(item => item.name), [
    'synthetic.xlsx', 'synthetic.docx', 'synthetic.doc', 'existing-frozen.xlsx',
  ]);
  assert.equal(record.answers[sha(documents[0].data)].原表.A2, '迁入前已保存填写');
  assert.equal(record.workpaperLocks['8'].targets[0].sha256, sha(documents[3].data));
});
