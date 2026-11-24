#!/usr/bin/env node
/** Real Nginx smoke; --include-recovery adds recovery; --config <path> selects a template. */
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {createServer as createHttpsServer, request as httpsRequest} from 'node:https';
import {createServer as createTcpServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const args = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let template = path.join(root, 'deploy/linux/nginx-shenyi-team.conf');
let includeRecovery = process.env.SHENYI_EDGE_TEST_RECOVERY === '1';
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--include-recovery') includeRecovery = true;
  else if (args[index] === '--config') {
    assert(args[index + 1] && !args[index + 1].startsWith('--'), '--config requires a path');
    template = path.resolve(args[++index]);
  } else assert.fail('Unknown edge smoke option: ' + args[index]);
}
const routes = ['onboarding', 'first-administrator'].flatMap(kind =>
  ['preview', 'challenges', 'activate'].map(action => '/api/auth/' + kind + '/' + action));
routes.push('/api/auth/phone/challenges');
if (includeRecovery) routes.push('/api/auth/recovery-requests');
const host = 'team.shenyi.example', stop = new AbortController(), held = new Map(), clients = new Set(), sockets = new Set();
const slowBodies = new Set(), upstreamSlowBodies = new Set();
const execute = promisify(execFile);
let directory, backend, nginx, nginxClosed, dripTimer, nginxEnded = false, nginxError = '', edgePort, edgeCert, sequence = 0;
process.once('SIGINT', () => stop.abort(new Error('Interrupted')));
process.once('SIGTERM', () => stop.abort(new Error('Terminated')));

async function command(name, arguments_) {
  return execute(name, arguments_, {timeout: 15000, maxBuffer: 1024 * 1024, signal: stop.signal});
}
async function waitUntil(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    stop.signal.throwIfAborted();
    if (nginxEnded) throw new Error('Nginx exited: ' + nginxError);
    if (Date.now() > deadline) throw new Error('Timed out: ' + description);
    await delay(20, undefined, {signal: stop.signal});
  }
}
function send(route, source, mode = '') {
  const task = {id: String(++sequence), done: false, started: false, responded: false, closed: false};
  task.result = new Promise(resolve => {
    const finish = result => { if (!task.done) { task.done = true; task.outcome = result; resolve(result); } };
    const request = httpsRequest({
      hostname: '127.0.0.1', port: edgePort, localAddress: source, servername: host, ca: edgeCert,
      path: route + (mode ? '?' + mode + '=' + task.id : ''), method: 'POST', agent: false, signal: stop.signal,
      headers: {Host: host, 'Content-Type': 'application/json', 'Content-Length': mode === 'slow' ? '4096' : '2', 'X-Shenyi-Client-IP': '192.0.2.99'},
    }, response => {
      task.responded = true;
      response.resume();
      response.once('end', () => finish({status: response.statusCode}));
      response.once('error', error => finish({error}));
    });
    task.request = request;
    clients.add(request);
    request.once('close', () => { task.closed = true; clients.delete(request); });
    request.once('error', error => finish({error}));
    request.setTimeout(30000, () => request.destroy(new Error('Request timed out')));
    if (mode === 'slow') {
      slowBodies.add(task);
      request.flushHeaders();
      request.write('{', () => { task.started = true; });
    } else request.end('{}');
  });
  return task;
}
async function expectStatus(task, expected, label) {
  const result = await task.result;
  if (result.error) throw new Error(label + ': ' + result.error.message);
  assert.equal(result.status, expected, label);
}
async function holdRequests(route, source, count) {
  const tasks = Array.from({length: count}, () => send(route, source, 'hold'));
  await waitUntil(() => tasks.every(task => held.has(task.id) || task.done), 'upstream held requests');
  for (const task of tasks) {
    assert(held.has(task.id), 'Expected held upstream request, got ' + JSON.stringify(task.outcome));
    assert.equal(held.get(task.id).source, source, 'Edge must overwrite the forged source header');
  }
  return tasks;
}
async function release(tasks) {
  for (const task of tasks) held.get(task.id)?.response.end('released');
  await Promise.all(tasks.map(task => expectStatus(task, 200, 'released request')));
  await waitUntil(() => tasks.every(task => !held.has(task.id)), 'upstream release');
}
function assertSlowBodiesActive() {
  assert.equal(slowBodies.size, 64, 'Slow-body fixture requires 64 requests');
  for (const task of slowBodies) assert(task.started && !task.done && !task.responded && !task.closed,
    'Slow body must remain unfinished and in flight: ' + task.id + ' ' + JSON.stringify(task.outcome));
}
async function main() {
  directory = await mkdtemp(path.join(tmpdir(), 'shenyi-identity-edge-'));
  await Promise.all(['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => mkdir(path.join(directory, name))));
  for (const name of ['edge', 'backend']) {
    await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=' + host, '-addext', 'subjectAltName=DNS:' + host,
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-keyout', path.join(directory, name + '.key'), '-out', path.join(directory, name + '.pem')]);
  }
  edgeCert = await readFile(path.join(directory, 'edge.pem'));
  backend = createHttpsServer({
    key: await readFile(path.join(directory, 'backend.key')), cert: await readFile(path.join(directory, 'backend.pem')),
  }, (request, response) => {
    request.resume();
    request.once('error', () => response.destroy());
    const query = new URL(request.url, 'https://' + host).searchParams;
    if (query.has('slow')) {
      upstreamSlowBodies.add(query.get('slow'));
      request.once('end', () => response.end('ok'));
      return;
    }
    const id = query.get('hold');
    if (!id) { response.end('ok'); return; }
    held.set(id, {response, source: request.headers['x-shenyi-client-ip']});
    response.once('close', () => held.delete(id));
  });
  backend.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const reservation = createTcpServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  edgePort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const original = await readFile(template, 'utf8');
  assert(original.includes('server 127.0.0.1:9443;') && original.includes('listen 443 ssl;'), 'Unexpected edge template');
  const fixture = original.replaceAll('127.0.0.1:9443', '127.0.0.1:' + backend.address().port)
    .replaceAll('listen 443 ', 'listen 127.0.0.1:' + edgePort + ' ')
    .replaceAll('/etc/nginx/shenyi-team/public-chain.pem', directory + '/edge.pem')
    .replaceAll('/etc/nginx/shenyi-team/public-key.pem', directory + '/edge.key')
    .replaceAll('/etc/nginx/shenyi-team/backend-ca.pem', directory + '/backend.pem')
    .replaceAll('/var/log/nginx/shenyi-team-access.log', directory + '/access.log')
    .replaceAll('/var/log/nginx/shenyi-team-error.log', directory + '/error.log');
  assert(!fixture.includes('/etc/nginx/') && !fixture.includes('/var/log/nginx/'), 'Production path in smoke configuration');
  const config = path.join(directory, 'nginx.conf');
  await writeFile(config, 'daemon off; master_process off; worker_processes 1;\npid ' + directory + '/nginx.pid;\n' +
    'error_log ' + directory + '/error.log warn;\nevents { worker_connections 512; }\nhttp {\n' +
    'client_body_temp_path ' + directory + '/body;\nproxy_temp_path ' + directory + '/proxy;\n' +
    'fastcgi_temp_path ' + directory + '/fastcgi;\nuwsgi_temp_path ' + directory + '/uwsgi;\n' +
    'scgi_temp_path ' + directory + '/scgi;\n' + fixture + '\n}\n');
  await command('nginx', ['-t', '-e', 'stderr', '-p', directory + '/', '-c', config]);
  nginx = spawn('nginx', ['-e', 'stderr', '-p', directory + '/', '-c', config], {stdio: ['ignore', 'ignore', 'pipe']});
  nginxClosed = new Promise(resolve => {
    nginx.once('error', error => { nginxError += error.message; nginxEnded = true; resolve(); });
    nginx.once('close', () => { nginxEnded = true; resolve(); });
  });
  nginx.stderr.on('data', chunk => { nginxError = (nginxError + chunk).slice(-4000); });
  await waitUntil(() => nginx.pid && !nginxEnded, 'Nginx process');
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    const result = await send('/api/edge-smoke-ready', '127.0.0.1').result;
    ready = result.status === 200;
    if (!ready) await delay(50, undefined, {signal: stop.signal});
    if (nginxEnded) throw new Error('Nginx startup failed: ' + nginxError);
  }
  assert(ready, 'Nginx HTTPS upstream did not become ready');
  for (const [index, route] of routes.entries()) {
    const source = '127.0.0.' + (10 + index), tasks = await holdRequests(route, source, 4);
    await expectStatus(send(route, source), 429, route + ' fifth concurrent request');
    await expectStatus(send('/api/edge-smoke-unlimited', source), 200, 'unmapped API bypasses per-source gate');
    await release(tasks);
    await expectStatus(send(route, source), 200, route + ' recovers immediately after release');
  }
  await expectStatus(send('/%61pi/auth/onboarding/preview', '127.0.0.19'), 404,
    'Encoded API prefix must retain the raw request-target guard');
  // Keep incomplete bodies alive across every probe; a slow-body timeout must not make this pass.
  dripTimer = setInterval(() => {
    for (const task of slowBodies) if (!task.done && !task.responded && !task.request.destroyed) task.request.write(' ');
  }, 250);
  const sources = Array.from({length: 16}, (_, index) => '127.0.0.' + (50 + index));
  for (const [index, source] of sources.entries()) {
    for (let count = 0; count < 4; count++) send(routes[index % routes.length], source, 'slow');
  }
  await waitUntil(() => [...slowBodies].every(task => task.started || task.done), '64 flushed slow-body headers');
  assertSlowBodiesActive();
  for (const [index, source] of sources.entries()) {
    await expectStatus(send(routes[index % routes.length], source), 429, 'Slow-body source fifth concurrent request');
  }
  assertSlowBodiesActive();
  for (const route of routes) {
    const fresh = send(route, '127.0.0.120');
    await fresh.result;
    assertSlowBodiesActive();
    await expectStatus(fresh, 200, 'SLOW_BODY_ISOLATION: fresh source ' + route);
  }
  await expectStatus(send(routes[0], sources[0]), 429, 'Slow-body source remains limited');
  await expectStatus(send('/api/edge-smoke-unlimited', sources[0]), 200, 'Unmapped API bypasses slow-body source gate');
  assertSlowBodiesActive();
  assert.equal(upstreamSlowBodies.size, 0, 'Incomplete identity bodies must stay at Nginx until fully buffered');
  clearInterval(dripTimer);
  for (const task of slowBodies) task.request.destroy(new Error('Slow-body fixture cleanup'));
  await Promise.all([...slowBodies].map(task => task.result));
  await waitUntil(() => [...slowBodies].every(task => task.closed), 'slow-body client cleanup');
  await expectStatus(send(routes[0], sources[0]), 200, 'Slow-body source recovers after client release');
  console.log('[identity-edge] real nginx -t, ' + routes.length + ' routes, per-IP 4, trusted source headers, exemptions, immediate release and 64 slow-body isolation passed.');
}
let deadline;
try {
  await Promise.race([main(), new Promise((_, reject) => {
    deadline = setTimeout(() => { const error = new Error('90-second edge smoke deadline exceeded'); stop.abort(error); reject(error); }, 90000);
  })]);
} catch (error) {
  process.exitCode = 1;
  console.error('[identity-edge] FAIL:', error.message);
  if (directory) console.error((await readFile(path.join(directory, 'error.log'), 'utf8').catch(() => nginxError)).slice(-6000));
} finally {
  clearTimeout(deadline);
  clearInterval(dripTimer);
  stop.abort();
  for (const request of clients) request.destroy();
  for (const {response} of held.values()) response.destroy();
  for (const socket of sockets) socket.destroy();
  if (nginx && !nginxEnded) {
    nginx.kill('SIGTERM');
    await Promise.race([nginxClosed, delay(2000)]);
    if (!nginxEnded) { nginx.kill('SIGKILL'); await nginxClosed; }
  }
  if (backend?.listening) await new Promise(resolve => backend.close(resolve));
  if (directory) await rm(directory, {recursive: true, force: true});
}
