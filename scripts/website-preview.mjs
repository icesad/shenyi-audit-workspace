#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenOnLoopback } from '../server/team/team-http-listener.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
export const publicFiles = Object.freeze([
  { source: 'website/index.html', name: 'index.html', type: 'text/html; charset=utf-8' },
  { source: 'website/styles.css', name: 'styles.css', type: 'text/css; charset=utf-8' },
  { source: 'dist/brand-shenyi.png', name: 'assets/brand-shenyi.png', type: 'image/png' },
].map(Object.freeze));
const contentSecurityPolicy = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function readPublicFiles(canonicalRoot) {
  return Promise.all(publicFiles.map(async file => {
    const source = path.join(canonicalRoot, file.source);
    if (path.relative(source, await realpath(source)) || !(await lstat(source)).isFile()) {
      throw new Error(`官网素材 ${file.source} 必须是指定位置的普通文件。`);
    }
    return { ...file, bytes: await readFile(source) };
  }));
}

export async function buildWebsite(outputDirectory, { rootDirectory = root } = {}) {
  const canonicalRoot = await realpath(rootDirectory);
  const requested = path.resolve(outputDirectory);
  const destination = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  const fromRoot = path.relative(canonicalRoot, destination);
  if (!fromRoot || (!path.isAbsolute(fromRoot) && !fromRoot.startsWith('..' + path.sep) && fromRoot !== '..')) {
    throw new Error('官网输出目录须是仓库外尚未创建的目录。');
  }
  const files = await readPublicFiles(canonicalRoot);
  await mkdir(destination);
  await mkdir(path.join(destination, 'assets'));
  await Promise.all(files.map(file => writeFile(path.join(destination, file.name), file.bytes, { flag: 'wx' })));
  return destination;
}

export async function startWebsitePreview({ rootDirectory = root } = {}) {
  const files = await readPublicFiles(await realpath(rootDirectory));
  const routes = new Map(files.map(file => ['/' + file.name, file]));
  routes.set('/', routes.get('/index.html'));
  let expectedHost;
  const server = http.createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-security-policy', contentSecurityPolicy);
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-robots-tag', 'noindex, nofollow');

    if (!expectedHost || request.headers.host !== expectedHost) {
      response.writeHead(400).end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const file = routes.get(request.url);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length });
    response.end(request.method === 'HEAD' ? undefined : file.bytes);
  });
  const { port } = await listenOnLoopback(server, 0);
  expectedHost = `${host}:${port}`;
  return { server, url: `http://${expectedHost}/` };
}

function openBrowser(url) {
  const [command, ...browserArguments] = {
    win32: ['rundll32.exe', 'url.dll,FileProtocolHandler', url],
    darwin: ['open', url],
    linux: ['xdg-open', url],
  }[process.platform] ?? [];
  const hint = () => console.error('浏览器未自动打开，可在浏览器地址栏访问上方本机地址。');
  if (!command) {
    hint();
    return;
  }
  const child = spawn(command, browserArguments, { stdio: 'ignore', windowsHide: true });
  child.once('error', hint);
  child.once('exit', code => { if (code) hint(); });
  child.unref();
}

async function main(args) {
  if (args[0] === '--build' && args.length === 2 && args[1] && !args[1].startsWith('--')) {
    console.log('官网静态包已生成 ' + await buildWebsite(args[1]));
    return;
  }
  if (args.length > 1 || (args.length && args[0] !== '--open')) {
    console.error('用法 node scripts/website-preview.mjs [--open | --build 新输出目录]');
    process.exitCode = 2;
    return;
  }
  const { server, url } = await startWebsitePreview();
  console.log('审迹官网本地预览 ' + url);
  if (args[0] === '--open') openBrowser(url);
  const stop = () => server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && path.relative(path.resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '') {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
