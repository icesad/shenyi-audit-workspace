'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { registerHooks } = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const run = require('node:util').promisify(execFile);

const builder = import('../scripts/build-windows-download-site.mjs');
const repo = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Keep synthetic signing results inside this test process. The publisher imports
// its Windows verifiers directly and offers no verifier override.
async function syntheticBuilder() {
  const url = pathToFileURL(path.join(repo, 'scripts/build-windows-download-site.mjs')).href + '?test-release';
  const code = `import {stat} from 'node:fs/promises';
    async function receipt(input) {
      return {version:input.version,sha256:input.sha256,bytes:(await stat(input.customerExe ?? input.msi)).size};
    }
    export {receipt as checkWindowsReleaseMsi, receipt as verifyWindowsCustomerInstaller};`;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL === url && ['./check-windows-release-msi.mjs','./windows-candidate-authenticode.mjs'].includes(specifier)) {
        return {url:'data:text/javascript,' + encodeURIComponent(code), shortCircuit:true};
      }
      return next(specifier, context);
    },
  });
  try { return await import(url); } finally { hook.deregister(); }
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-managed-download-'));
  t.after(async () => {
    assert.equal(await fs.realpath(directory), directory);
    await fs.rm(directory, { recursive: true });
  });
  const msi = path.join(directory, 'synthetic-test.msi');
  const bytes = Buffer.from('Synthetic test fixture, not an installation program.');
  await fs.writeFile(msi, bytes);
  const input = { msi, sha256: hash(bytes), appPayloadSha256: 'a'.repeat(64), publisherSha256: 'b'.repeat(64),
    publicKey: path.join(directory, 'public.pem'), version: '1.0.1', installedVersion: '1.0.0',
    filingNumber: '沪ICP备12345678号-1', scratchRoot: directory };
  const root = path.join(directory, 'source');
  const sources = ['website/index.html','website/styles.css','dist/brand-shenyi.png','deploy/linux/nginx-shenyi-website.conf'];
  for (const file of sources) {
    await fs.mkdir(path.dirname(path.join(root, file)), {recursive:true});
    await fs.copyFile(path.join(repo, file), path.join(root, file));
  }
  const git = (...args) => run('git',['-c','user.name=Fixture','-c','user.email=test@example.invalid',
    '-c','commit.gpgSign=false','-c','core.autocrlf=false',...args], {cwd:root,windowsHide:true});
  await git('init','-q');
  await git('add','-f','--',...sources);
  await git('commit','--no-verify','-qm','Synthetic test website');
  const sourceCommit = (await git('rev-parse','HEAD')).stdout.trim();
  return { directory, root, bytes, args: { output: path.join(directory, 'out'), input, sourceCommit } };
}

test('release preparation validates the real package and never accepts a stored receipt as release approval', async t => {
  const { buildWindowsDownloadSite } = await builder;
  const { directory, root, args } = await setup(t);
  await assert.rejects(buildWindowsDownloadSite(args, {root}));
  await assert.rejects(buildWindowsDownloadSite({ ...args, input: { ...args.input, installerOsSignatureVerified: true } }, {root}), /备案号/);
  await assert.rejects(buildWindowsDownloadSite({ ...args, input: { ...args.input, filingNumber: '待审批' } }, {root}), /备案号/);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['source','synthetic-test.msi']);
});

test('the filed website can publish ahead of the installer and keeps the download route closed', async t => {
  const { buildWindowsDownloadSite } = await builder;
  const { args, root } = await setup(t);
  const { output, sourceCommit } = args;
  await fs.writeFile(path.join(root, 'website/index.html'), 'uncommitted fixture');
  const staged = await buildWindowsDownloadSite({ output, sourceCommit, filingNumber: args.input.filingNumber }, {root});
  const html = await fs.readFile(path.join(staged.site, 'index.html'), 'utf8');
  assert.ok(html.includes(args.input.filingNumber));
  assert.ok(!html.includes('/downloads/shenyi-windows-x64.msi'));
  assert.deepEqual((await fs.readdir(staged.site)).sort(), ['assets', 'index.html', 'styles.css']);
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'baseline.json')));
  assert.equal(manifest.assets.length, 3);
  assert.equal(staged.version, undefined);
});

test('staging binds the published page, exact download route and TLS baseline to the verified MSI', async t => {
  const { buildWindowsDownloadSite } = await syntheticBuilder();
  const { directory, root, bytes, args } = await setup(t);
  const staged = await buildWindowsDownloadSite(args, {root});
  assert.deepEqual((await fs.readdir(args.output)).sort(), ['baseline.json', 'nginx-shenyi-website.conf', 'site']);
  const route = '/downloads/shenyi-windows-x64.msi';
  const html = await fs.readFile(path.join(staged.site, 'index.html'), 'utf8');
  assert.ok(html.includes('href="' + route + '"') && html.includes('管理员下载受管部署包'));
  assert.ok(html.includes(args.input.filingNumber) && html.includes(staged.sha256));
  assert.equal(await fs.readFile(path.join(staged.site, route.slice(1)), 'utf8'), bytes.toString());
  const encoded = await fs.readFile(path.join(args.output, 'baseline.json'));
  const manifest = JSON.parse(encoded);
  assert.equal(hash(encoded), staged.baselineSha256);
  assert.equal(manifest.mode, 'windows-managed-download');
  assert.equal(manifest.assets.find(row => row.route === route).sha256, hash(bytes));
  const config = await fs.readFile(path.join(args.output, 'nginx-shenyi-website.conf'), 'utf8');
  assert.ok(config.includes('location = ' + route + ' {'));
  assert.ok(config.includes('~^/downloads/shenyi-windows-x64[.]msi([?]|$) 1;'));
  const original = await fs.readFile(path.join(repo, 'deploy/linux/nginx-shenyi-website.conf'), 'utf8');
  assert.ok(!original.includes(route));
  await assert.rejects(buildWindowsDownloadSite(args, {root}), /已存在/);
  const changedArgs = { ...args, output: path.join(directory, 'changed'), input:{...args.input, sha256:'0'.repeat(64)} };
  await assert.rejects(buildWindowsDownloadSite(changedArgs, {root}), /INSTALLER_DIGEST_MISMATCH/);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['out', 'source', 'synthetic-test.msi']);
});

test('customer EXE publication requires independent installer approval and only opens the customer route', async t => {
  const { buildWindowsDownloadSite } = await builder;
  const { args, directory, root, bytes } = await setup(t);
  const customerExe = path.join(directory, 'synthetic-setup.exe');
  await fs.copyFile(args.input.msi, customerExe);
  const { filingNumber, sha256, publisherSha256, version } = args.input;
  args.input = { filingNumber, customerExe, sha256, publisherSha256, version };
  await assert.rejects(buildWindowsDownloadSite(args, {root}));
  await assert.rejects(buildWindowsDownloadSite({...args, input:{...args.input, msi: customerExe}}, {root}), /备案号/);
  const synthetic = await syntheticBuilder();
  const staged = await synthetic.buildWindowsDownloadSite(args, {root});
  const html = await fs.readFile(path.join(staged.site,'index.html'), 'utf8');
  const route = '/downloads/shenyi-windows-setup.exe';
  assert.ok(html.includes('下载 Windows 客户端') && html.includes('href="' + route + '"'));
  assert.ok(!html.includes('/downloads/shenyi-windows-x64.msi'));
  const baseline = JSON.parse(await fs.readFile(path.join(args.output,'baseline.json')));
  assert.equal(baseline.mode, 'windows-customer-download');
  assert.equal(baseline.assets.find(row => row.route === route).sha256, sha256);
  const config = await fs.readFile(path.join(args.output,'nginx-shenyi-website.conf'), 'utf8');
  assert.ok(config.includes('location = ' + route + ' {') && !config.includes('/downloads/shenyi-windows-x64'));
});
