#!/usr/bin/env node
/** Local-only source preview. The application origin must remain stable. */
import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const HOST = '127.0.0.1';
export const PORT = 8773;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function respond(res, status, message, method = 'GET') {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(method === 'HEAD' ? undefined : `${message}\n`);
}

/** Exported for isolated tests. Production entry point always uses dist and PORT. */
export async function createRequestHandler(directory) {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error('Static root is not a directory.');
  return async function handle(req, res) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      respond(res, 405, 'Only GET and HEAD are supported.', req.method);
      return;
    }
    try {
      // Do not use URL.pathname: it normalizes away traversal before validation.
      const raw = (req.url || '').split('?')[0];
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) {
        respond(res, 400, 'Invalid request path.', req.method); return;
      }
      let decoded;
      try { decoded = decodeURIComponent(raw); }
      catch { respond(res, 400, 'Invalid URL encoding.', req.method); return; }
      // Backslash/colon also block Windows separators, drive paths and ADS.
      if (/[\\:\u0000-\u001f\u007f]/.test(decoded)) {
        respond(res, 403, 'Path is not allowed.', req.method); return;
      }
      const segments = decoded.split('/');
      if (segments.some(segment => segment.startsWith('.'))) {
        respond(res, 403, 'Dotfiles and traversal are not allowed.', req.method); return;
      }
      let target = path.resolve(root, ...segments.filter(Boolean));
      if (!inside(root, target)) {
        respond(res, 403, 'Path is outside the static root.', req.method); return;
      }
      target = await realpath(target);
      if (!inside(root, target)) {
        respond(res, 403, 'Links outside the static root are not allowed.', req.method); return;
      }
      let info = await stat(target);
      if (info.isDirectory()) {
        target = await realpath(path.join(target, 'index.html'));
        if (!inside(root, target)) {
          respond(res, 403, 'Links outside the static root are not allowed.', req.method); return;
        }
        info = await stat(target);
      }
      if (!info.isFile()) { respond(res, 404, 'File not found.', req.method); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': String(info.size),
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(target);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      respond(res, ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500,
        ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'File not found.' : 'Unable to read file.', req.method);
    }
  };
}

export async function startServer({ directory = path.join(REPOSITORY_ROOT, 'dist') } = {}) {
  const server = http.createServer(await createRequestHandler(directory));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => { server.off('error', reject); resolve(); });
  });
  return server;
}

async function main() {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/serve.mjs (fixed 127.0.0.1:8773; no alternate port or public host)');
    process.exitCode = 2; return;
  }
  try {
    const server = await startServer();
    console.log(`审易本机预览：http://${HOST}:${PORT}/`);
    console.log('仅监听本机；不自动打开浏览器、不上传数据。停止：Ctrl+C。请保持此地址和端口，以免切换到另一份浏览器数据。');
    const stop = () => server.close(() => { process.exitCode = 0; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已占用。不会自动更换端口；请确认已有审易预览是否正在运行，或由开发者停止占用进程后重试。不要删除浏览器数据。`);
    } else if (error.code === 'ENOENT') {
      console.error('找不到 dist 静态源码目录。请确认已完整克隆仓库，并在本仓库运行。');
    } else {
      console.error(`本机预览启动失败：${error.message}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
