'use strict';

const { app, BrowserWindow, Menu, protocol, session } = require('electron');
const { mkdirSync } = require('node:fs');
const { readFile, realpath } = require('node:fs/promises');
const path = require('node:path');

const scheme = 'shenyi-workbench';
const origin = scheme + '://local';
const home = origin + '/index.html';
const title = '审易工作台 · 六模块本机体验（测试资料专用）';
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8'
};
const policy = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "worker-src 'self' blob:", "connect-src 'self'",
  "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.enableSandbox();
const profileRoot = app.commandLine.getSwitchValue('user-data-dir') || app.getPath('appData');
const profile = path.join(path.resolve(profileRoot), 'Shenyi-Workbench-LocalReview');
mkdirSync(profile, {recursive: true});
app.setPath('userData', profile);
app.setPath('sessionData', profile);

async function workspaceSession() {
  const dist = await realpath(path.join(__dirname, 'dist'));
  const local = session.fromPartition('persist:shenyi-workbench-local-review');
  local.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  local.setPermissionCheckHandler(() => false);
  local.setDevicePermissionHandler(() => false);
  local.webRequest.onBeforeRequest((request, callback) => {
    const address = request.url;
    const allowed = address.startsWith(origin + '/') || address.startsWith('blob:' + origin + '/') || address.startsWith('data:');
    callback({cancel: !allowed});
  });
  local.on('will-download', (event, item) => {
    if (!item.getURL().startsWith('blob:' + origin + '/')) event.preventDefault();
  });
  await local.protocol.handle(scheme, async request => {
    const url = new URL(request.url);
    if (url.host !== 'local' || url.username || url.password || request.method !== 'GET') return new Response(null, {status: 403});
    const key = url.pathname.slice(1);
    if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.(?:html|css|js|png|txt)$/i.test(key)) return new Response(null, {status: 404});
    const file = path.join(dist, key);
    try {
      if (path.relative(file, await realpath(file))) return new Response(null, {status: 404});
      return new Response(await readFile(file), { headers: {
        'Content-Type': contentTypes[path.extname(file)], 'Content-Security-Policy': policy,
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
      }});
    } catch { return new Response(null, {status: 404}); }
  });
  return local;
}

async function openWorkspace() {
  const local = await workspaceSession();
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({width: 1430, height: 930, minWidth: 800, minHeight: 600, show: false, title,
    webPreferences: { session: local, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, devTools: false }
  });
  win.on('page-title-updated', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  await win.loadURL(home);
  win.show();
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(openWorkspace).catch(() => {
    require('electron').dialog.showErrorBox('审易工作台', '本机体验未能启动。请将完整压缩包解压到新文件夹后重试。');
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
} else { app.quit(); }
