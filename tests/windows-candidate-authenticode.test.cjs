'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const pe = 0x80;
const optional = pe + 24;
const checksum = optional + 64;
const securityDirectory = optional + 144;
const section = optional + 0xf0;
const rawSection = 0x200;
const mismatch = { code: 'AUTHENTICODE_EXECUTABLE_MISMATCH' };

test('customer signatures cannot approve an internal desktop experience or internal test build', async () => {
  const { matchesCustomerInstallerMetadata } = await import('../scripts/windows-candidate-authenticode.mjs');
  const valid = { productName:'审易 Windows 客户端', executableImage:true, productVersion:'1.2.3.0' };
  const version = valid.productVersion;
  assert.equal(matchesCustomerInstallerMetadata(valid, version), true);
  for (const productName of ['审易（本机体验）', '审易 内 测 版', 'ShenYi 内部测试', 'ShenYi 本機體驗', 'Other Client']) {
    assert.equal(matchesCustomerInstallerMetadata({...valid, productName}, version), false, productName);
  }
  assert.equal(matchesCustomerInstallerMetadata({...valid, executableImage:false}, version), false);
  assert.equal(matchesCustomerInstallerMetadata({...valid, productVersion:'1.2.4.0'}, version), false);
});

function executable(overlayLength = 5) {
  const bytes = Buffer.alloc(0x400 + overlayLength);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(pe, 0x3c);
  bytes.writeUInt32LE(0x00004550, pe);
  bytes.writeUInt16LE(0x8664, pe + 4);
  bytes.writeUInt16LE(1, pe + 6);
  bytes.writeUInt32LE(1700000000, pe + 8);
  bytes.writeUInt16LE(0xf0, pe + 20);
  bytes.writeUInt16LE(0x22, pe + 22);
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(0x200, optional + 4);
  bytes.writeUInt32LE(0x1000, optional + 16);
  bytes.writeUInt32LE(0x1000, optional + 20);
  bytes.writeBigUInt64LE(0x140000000n, optional + 24);
  bytes.writeUInt32LE(0x1000, optional + 32);
  bytes.writeUInt32LE(0x200, optional + 36);
  bytes.writeUInt32LE(0x2000, optional + 56);
  bytes.writeUInt32LE(0x200, optional + 60);
  bytes.writeUInt16LE(3, optional + 68);
  bytes.writeUInt32LE(16, optional + 108);
  bytes.write('.text', section, 'ascii');
  bytes.writeUInt32LE(0x200, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(0x200, section + 16);
  bytes.writeUInt32LE(rawSection, section + 20);
  bytes.writeUInt32LE(0x60000020, section + 36);
  bytes.fill(0x90, rawSection, 0x400);
  bytes.fill(0x41, 0x400);
  return bytes;
}

function addCertificate(unsigned, includeRecordPadding = false) {
  const certificateOffset = Math.ceil(unsigned.length / 8) * 8;
  const tableLength = 16;
  const signed = Buffer.alloc(certificateOffset + tableLength);
  unsigned.copy(signed);
  signed.writeUInt32LE(0xabcdef01, checksum);
  signed.writeUInt32LE(certificateOffset, securityDirectory);
  signed.writeUInt32LE(tableLength, securityDirectory + 4);
  signed.writeUInt32LE(includeRecordPadding ? tableLength : 13, certificateOffset);
  signed.writeUInt16LE(0x0200, certificateOffset + 4);
  signed.writeUInt16LE(2, certificateOffset + 6);
  // A minimal DER SEQUENCE exercises the layout. Windows validates the actual signature.
  Buffer.from([0x30, 3, 2, 1, 1]).copy(signed, certificateOffset + 8);
  return { signed, certificateOffset };
}

test('accepts identical AMD64 PE32+ content with only checksum, certificate directory and aligned certificate changes', async () => {
  const { assertSameWindowsExecutable } = await import('../scripts/windows-candidate-authenticode.mjs');
  for (const overlayLength of [0, 5]) {
    const unsigned = executable(overlayLength);
    const { signed } = addCertificate(unsigned, overlayLength > 0);
    const originalInput = Buffer.from(unsigned);
    const signedInput = Buffer.from(signed);
    assert.doesNotThrow(() => assertSameWindowsExecutable(unsigned, signed));
    assert.deepEqual(unsigned, originalInput);
    assert.deepEqual(signed, signedInput);
  }
});

test('rejects content changes to the header, section table, section bytes and original overlay', async () => {
  const { assertSameWindowsExecutable } = await import('../scripts/windows-candidate-authenticode.mjs');
  const unsigned = executable();
  for (const [description, offset] of [
    ['COFF timestamp', pe + 8],
    ['optional header subsystem', optional + 68],
    ['section characteristics', section + 36],
    ['section data', rawSection + 5],
    ['pre-existing overlay', unsigned.length - 1],
  ]) {
    const { signed } = addCertificate(unsigned);
    signed[offset] ^= 1;
    assert.throws(() => assertSameWindowsExecutable(unsigned, signed), mismatch, description);
  }
});

test('rejects incorrect certificate coordinates, extra records or tail bytes, and nonzero alignment padding', async () => {
  const { assertSameWindowsExecutable } = await import('../scripts/windows-candidate-authenticode.mjs');
  const unsigned = executable();
  for (const [description, change] of [
    ['incorrect directory offset', (signed, offset) => signed.writeUInt32LE(offset - 1, securityDirectory)],
    ['incorrect directory length', signed => signed.writeUInt32LE(8, securityDirectory + 4)],
    ['too short record length', (signed, offset) => signed.writeUInt32LE(7, offset)],
    ['record length points beyond EOF', (signed, offset) => signed.writeUInt32LE(17, offset)],
    ['unsupported revision', (signed, offset) => signed.writeUInt16LE(0x0100, offset + 4)],
    ['unsupported type', (signed, offset) => signed.writeUInt16LE(1, offset + 6)],
    ['nonzero padding before certificate', signed => { signed[unsigned.length] = 1; }],
    ['nonzero padding after certificate', signed => { signed[signed.length - 1] = 1; }],
  ]) {
    const { signed, certificateOffset } = addCertificate(unsigned);
    change(signed, certificateOffset);
    assert.throws(() => assertSameWindowsExecutable(unsigned, signed), mismatch, description);
  }

  const { signed, certificateOffset } = addCertificate(unsigned);
  assert.throws(() => assertSameWindowsExecutable(unsigned, Buffer.concat([signed, Buffer.alloc(1)])), mismatch, 'byte after table');
  const twoRecords = Buffer.concat([signed, signed.subarray(certificateOffset)]);
  twoRecords.writeUInt32LE(32, securityDirectory + 4);
  assert.throws(() => assertSameWindowsExecutable(unsigned, twoRecords), mismatch, 'two structurally valid certificate records');
});

test('rejects malformed DER envelope lengths or nonzero data after the DER envelope inside the declared record', async () => {
  const { assertSameWindowsExecutable } = await import('../scripts/windows-candidate-authenticode.mjs');
  const unsigned = executable();
  for (const [description, relativeOffset, value] of [
    ['not a sequence', 8, 0x31],
    ['indefinite length', 9, 0x80],
    ['length exceeds the record', 9, 0x7f],
    ['nonzero filler included within dwLength', 13, 0x42],
  ]) {
    const { signed, certificateOffset } = addCertificate(unsigned, true);
    signed[certificateOffset + relativeOffset] = value;
    assert.throws(() => assertSameWindowsExecutable(unsigned, signed), mismatch, description);
  }
});

test('rejects malformed and truncated executables, wrong architecture, and existing unsigned certificate pointers', async () => {
  const { assertSameWindowsExecutable } = await import('../scripts/windows-candidate-authenticode.mjs');
  for (const [description, change] of [
    ['missing MZ', unsigned => unsigned.writeUInt16LE(0, 0)],
    ['PE offset outside input', unsigned => unsigned.writeUInt32LE(0xffffffff, 0x3c)],
    ['missing PE signature', unsigned => unsigned.writeUInt32LE(0, pe)],
    ['ARM64 pair', unsigned => unsigned.writeUInt16LE(0xaa64, pe + 4)],
    ['PE32 pair', unsigned => unsigned.writeUInt16LE(0x10b, optional)],
    ['optional header too short', unsigned => unsigned.writeUInt16LE(0x80, pe + 20)],
    ['fewer than five data directories', unsigned => unsigned.writeUInt32LE(4, optional + 108)],
    ['already populated certificate offset', unsigned => unsigned.writeUInt32LE(0x400, securityDirectory)],
    ['already populated certificate size', unsigned => unsigned.writeUInt32LE(16, securityDirectory + 4)],
  ]) {
    const unsigned = executable();
    change(unsigned);
    assert.throws(() => assertSameWindowsExecutable(unsigned, addCertificate(unsigned).signed), mismatch, description);
  }

  const unsigned = executable();
  const { signed, certificateOffset } = addCertificate(unsigned);
  assert.throws(() => assertSameWindowsExecutable(unsigned.subarray(0, 63), signed), mismatch, 'truncated DOS header');
  assert.throws(() => assertSameWindowsExecutable(unsigned, signed.subarray(0, certificateOffset + 7)), mismatch, 'truncated certificate header');
  assert.throws(() => assertSameWindowsExecutable(unsigned, signed.subarray(0, signed.length - 1)), mismatch, 'truncated certificate padding');
});

test('accepts old schema 1 and requires exact distinct Authenticode metadata for schema 2 manifests', async t => {
  const { readWindowsCandidateManifest } = await import('../scripts/verify-windows-candidate-inventory.mjs');
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-authenticode-manifest-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const manifestFile = path.join(directory, 'candidate-manifest.json');
  const files = Object.fromEntries([
    'Shenyi.exe', 'Shenyi_wer.dll', 'resources/app/desktop/main.cjs', 'resources/app/desktop/preload.cjs',
    'resources/app/node_modules/jsdom/package.json', 'resources/app/package-lock.json', 'resources/app/package.json',
  ].sort().map(name => [name, { bytes: 1, sha256: 'b'.repeat(64) }]));
  const unsigned = {
    schemaVersion: 1, kind: 'shenyi-windows-desktop-candidate', platform: 'win32', arch: 'x64',
    releaseStatus: 'unsigned-portable-candidate', version: '0.61.0', trustedServiceProfileIncluded: false,
    electron: { version: '45.3.2', archive: 'electron-v45.3.2-win32-x64.zip', bytes: 158318730, sha256: 'a'.repeat(64) },
    sourceFileCount: 2, productionPackageCount: 1, files,
  };
  const authenticode = { publisherCertificateSha256: 'c'.repeat(64), unsignedExecutableSha256: 'd'.repeat(64) };
  const signed = { ...unsigned, schemaVersion: 2, releaseStatus: 'authenticode-signed-portable-candidate', authenticode };
  async function read(manifest) {
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    return (await readWindowsCandidateManifest(directory)).manifest;
  }

  assert.deepEqual(await read(unsigned), unsigned);
  assert.deepEqual(await read(signed), signed);
  for (const manifest of [
    { ...unsigned, authenticode },
    { ...signed, releaseStatus: unsigned.releaseStatus },
    { ...signed, authenticode: { ...authenticode, approved: true } },
    { ...signed, authenticode: { ...authenticode, publisherCertificateSha256: 'C'.repeat(64) } },
    { ...signed, authenticode: { ...authenticode, unsignedExecutableSha256: files['Shenyi.exe'].sha256 } },
    { ...signed, authenticode: undefined },
  ]) await assert.rejects(read(manifest), { code: 'CANDIDATE_MANIFEST_INVALID' });
});
