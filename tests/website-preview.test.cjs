'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const previewModule = import('../scripts/website-preview.mjs');
const page = '<!doctype html><html lang="zh-CN"><title>审易官网预览</title></html>';
const css = 'body{color:#20373a}';
const logo = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function fixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'shenyi-website-test-'));
  t.after(async () => {
    const ownedDirectory = await fs.realpath(directory);
    assert.equal(path.dirname(ownedDirectory), temporaryRoot);
    assert.match(path.basename(ownedDirectory), /^shenyi-website-test-/);
    await fs.rm(ownedDirectory, { recursive: true });
  });
  const root = path.join(directory, 'repository');
  await fs.mkdir(path.join(root, 'website'), { recursive: true });
  await fs.mkdir(path.join(root, 'dist'));
  await Promise.all([
    fs.writeFile(path.join(root, 'website/index.html'), page),
    fs.writeFile(path.join(root, 'website/styles.css'), css),
    fs.writeFile(path.join(root, 'dist/brand-shenyi.png'), logo),
    fs.writeFile(path.join(root, 'website/internal.txt'), 'internal notes'),
    fs.writeFile(path.join(root, 'dist/index.html'), 'original audit workbench'),
    fs.writeFile(path.join(root, 'README.md'), 'private repository notes'),
  ]);
  return { directory, root };
}

function request(url, requestPath, options) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const client = http.request({ hostname: endpoint.hostname, port: endpoint.port, path: requestPath, ...options }, response => {
      const data = [];
      response.on('data', chunk => data.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(data) }));
    });
    client.on('error', reject);
    client.end();
  });
}

test('the official website preview uses a separate loopback origin and serves only the public static routes', async t => {
  const { root } = await fixture(t);
  const { startWebsitePreview } = await previewModule;
  const { server, url } = await startWebsitePreview({ rootDirectory: root });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
  assert.ok(![8773, 8774, 10139].includes(server.address().port));
  const html = await request(url, '/');
  assert.equal(html.status, 200);
  assert.equal(html.body.toString(), page);
  assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(html.headers['cache-control'], 'no-store');
  assert.equal(html.headers['x-content-type-options'], 'nosniff');
  assert.equal(html.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(html.headers['content-security-policy'], /default-src 'none'/);
  assert.equal((await request(url, '/index.html')).body.toString(), page);
  const stylesheet = await request(url, '/styles.css');
  assert.equal(stylesheet.body.toString(), css);
  assert.equal(stylesheet.headers['content-type'], 'text/css; charset=utf-8');
  const image = await request(url, '/assets/brand-shenyi.png');
  assert.deepEqual(image.body, logo);
  assert.equal(image.headers['content-type'], 'image/png');
  const head = await request(url, '/assets/brand-shenyi.png', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], String(logo.length));
  assert.equal(head.body.length, 0);
  for (const excluded of ['/api/auth/methods', '/dist/index.html', '/internal.txt', '/README.md', '/assets/', '/styles.css?extra=1']) {
    assert.equal((await request(url, excluded)).status, 404, excluded);
  }
  const post = await request(url, '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.equal((await request(url, '/', { headers: { host: 'untrusted.example' } })).status, 400);
});

test('building a preview copies only the HTML, stylesheet and original logo into a fresh external directory', async t => {
  const { root, directory } = await fixture(t);
  const { buildWebsite } = await previewModule;
  const output = path.join(directory, 'site-package');
  assert.equal(await buildWebsite(output, { rootDirectory: root }), output);
  assert.deepEqual((await fs.readdir(output)).sort(), ['assets', 'index.html', 'styles.css']);
  assert.deepEqual(await fs.readdir(path.join(output, 'assets')), ['brand-shenyi.png']);
  assert.equal(await fs.readFile(path.join(output, 'index.html'), 'utf8'), page);
  assert.equal(await fs.readFile(path.join(output, 'styles.css'), 'utf8'), css);
  assert.deepEqual(await fs.readFile(path.join(output, 'assets/brand-shenyi.png')), logo);
  await assert.rejects(buildWebsite(output, { rootDirectory: root }), { code: 'EEXIST' });
  await assert.rejects(buildWebsite(path.join(root, 'new'), { rootDirectory: root }), /仓库外/);
  assert.equal(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8'), 'original audit workbench');
});


test('the public website candidate identifies its confirmed Hainan operator and keeps filing identifiers pending approval', async () => {
  const root = path.resolve(__dirname, '..');
  const html = await fs.readFile(path.join(root, 'website', 'index.html'), 'utf8');
  assert.match(html, /海南卓雅轩咨询有限公司运营/);
  assert.ok(html.includes('ICP备案号：<!-- filing -->待海南省通信管理局核准后公示<!-- /filing -->；公安联网备案号：完成公安联网备案后公示。'));
  assert.match(html, /公安联网备案号：完成公安联网备案后公示/);
  assert.match(html, /隐私政策、用户协议及订阅服务条款将在正式开放前发布/);
  assert.equal(html.split('<!-- filing -->').length - 1, 1);
  assert.equal(html.split('<!-- /filing -->').length - 1, 1);
  assert.equal(html.split('<!-- windows-release -->').length - 1, 1);
  assert.equal(html.split('<!-- /windows-release -->').length - 1, 1);
});
