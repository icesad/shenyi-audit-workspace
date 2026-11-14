'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

function request(port, target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: target, method }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject); req.end();
  });
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shenyi-dev-tools-'));
  const root = path.join(directory, 'dist'); await fs.mkdir(root);
  await Promise.all([
    fs.writeFile(path.join(root, 'index.html'), '<h1>fixture</h1>'),
    fs.writeFile(path.join(root, 'app.js'), 'globalThis.fixture=true;'),
    fs.writeFile(path.join(root, 'module.wasm'), Buffer.from([0, 97, 115, 109])),
    fs.writeFile(path.join(root, '资料.txt'), '测试文字'),
    fs.writeFile(path.join(directory, 'outside.txt'), 'must-not-leak'),
    fs.writeFile(path.join(root, '.env'), 'must-not-leak'),
    fs.mkdir(path.join(root, 'empty')),
  ]);
  const api = await import(pathToFileURL(path.join(__dirname, 'serve.mjs')).href);
  const server = http.createServer(await api.createRequestHandler(root));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  return { root, directory, port: server.address().port, api };
}

test('local static preview returns HTML, JS, WASM and Unicode files; no-cache and HEAD work', async t => {
  const f = await fixture(t);
  const html = await request(f.port, '/?test=1');
  assert.equal(html.status, 200); assert.equal(html.body.toString(), '<h1>fixture</h1>');
  assert.match(html.headers['content-type'], /^text\/html/);
  assert.equal(html.headers['cache-control'], 'no-store');
  assert.equal(html.headers['x-content-type-options'], 'nosniff');
  assert.equal(html.headers['access-control-allow-origin'], undefined);
  const js = await request(f.port, '/app.js'); assert.equal(js.status, 200); assert.match(js.headers['content-type'], /javascript/);
  const wasm = await request(f.port, '/module.wasm'); assert.equal(wasm.status, 200); assert.equal(wasm.headers['content-type'], 'application/wasm');
  const unicode = await request(f.port, `/${encodeURIComponent('资料.txt')}`); assert.equal(unicode.body.toString(), '测试文字');
  const head = await request(f.port, '/app.js', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.ok(Number(head.headers['content-length']) > 0);
});

test('local preview rejects raw/encoded traversal, hidden files, Windows path tricks and malformed encoding', async t => {
  const f = await fixture(t);
  for (const url of ['/../outside.txt', '/%2e%2e/outside.txt', '/%2e%2e%2foutside.txt', '/%2e%2e%5coutside.txt', '/.env', '/%2eenv', '/.git/config', '/C:/outside.txt', '/app.js::$DATA', '/%00app.js', '//outside.txt']) {
    const result = await request(f.port, url);
    assert.ok([400, 403].includes(result.status), `${url}: ${result.status}`);
    assert.doesNotMatch(result.body.toString(), /must-not-leak/);
  }
  assert.equal((await request(f.port, '/%ZZ')).status, 400);
  assert.equal((await request(f.port, '/missing')).status, 404);
  assert.equal((await request(f.port, '/empty/')).status, 404, 'no directory listing');
  const post = await request(f.port, '/', 'POST'); assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD');
});

test('local preview rejects symlink/junction escapes including directory indexes', async t => {
  const f = await fixture(t);
  const outside = path.join(f.directory, 'private'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'index.html'), 'must-not-leak');
  await fs.symlink(outside, path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await request(f.port, '/linked/')).status, 403);
  assert.equal((await request(f.port, '/linked/index.html')).status, 403);
});

test('production origin is fixed; an occupied port is reported rather than silently changed', async t => {
  const f = await fixture(t);
  assert.equal(f.api.HOST, '127.0.0.1'); assert.equal(f.api.PORT, 8773);
  const blocker = http.createServer(); let ownsBlocker = false;
  try {
    await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(f.api.PORT, f.api.HOST, resolve); });
    ownsBlocker = true;
  } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  try { await assert.rejects(f.api.startServer({ directory: f.root }), { code: 'EADDRINUSE' }); }
  finally { if (ownsBlocker) await new Promise(resolve => blocker.close(resolve)); }
});

test('portable runner documents its options and rejects unknown options', async () => {
  async function run(args) {
    const child = spawn(process.execPath, [path.join(__dirname, 'test.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { code, stdout, stderr };
  }
  const help = await run(['--help']); assert.equal(help.code, 0); for (const option of ['--unit', '--strict', '--list']) assert.ok(help.stdout.includes(option));
  const invalid = await run(['--wrong']); assert.equal(invalid.code, 2); assert.match(invalid.stderr, /Unknown option/);
});

test('portable runner permits SKIP by default, rejects it in strict mode, and filters whole browser files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shenyi-runner-tools-'));
  const scripts = path.join(directory, 'scripts'), tests = path.join(directory, 'tests', 'nested');
  await fs.mkdir(scripts); await fs.mkdir(tests, { recursive: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.copyFile(path.join(__dirname, 'test.mjs'), path.join(scripts, 'test.mjs'));
  await fs.writeFile(path.join(scripts, 'dev-tools.test.cjs'), "require('node:test')('fixture developer test', () => {});\n");
  await fs.writeFile(path.join(tests, 'unit.test.cjs'), "const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');test('local NODE_PATH is portable',()=>assert.equal(process.env.NODE_PATH.split(path.delimiter)[0],path.join(__dirname,'..','..','node_modules')));test('fixture skipped test',t=>t.skip('fixture only'));\n");
  await fs.writeFile(path.join(tests, 'browser.test.cjs'), "// playwright fixture: --unit excludes this entire file\nrequire('node:test')('fixture browser marker',()=>{});\n");
  async function run(args) {
    const env = { ...process.env, NODE_PATH: path.join(directory, 'another-module-path') };
    // This launches an isolated fixture project, not a recursive test runner.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [path.join(scripts, 'test.mjs'), ...args], {
      cwd: os.tmpdir(), env,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { code, stdout, stderr };
  }
  const normal = await run([]); assert.equal(normal.code, 0, normal.stdout + normal.stderr); assert.match(normal.stderr, /SKIP observed/);
  const strict = await run(['--strict']); assert.equal(strict.code, 1); assert.match(strict.stderr, /--strict rejects skipped tests/);
  const list = await run(['--unit', '--list']); assert.equal(list.code, 0); assert.match(list.stdout, /unit\.test\.cjs/); assert.doesNotMatch(list.stdout, /browser\.test\.cjs/); assert.match(list.stdout, /1 whole files excluded/);
});
