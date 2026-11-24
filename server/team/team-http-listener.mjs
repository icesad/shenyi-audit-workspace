import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {json} from './http-utils.mjs';

const host = '127.0.0.1';
// See https://fetch.spec.whatwg.org/#port-blocking. The three legacy local
// entry points are also reserved when an automatic preview port is selected.
const unavailablePreviewPorts = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
  8773, 8774, 10139,
]);

export async function listenOnLoopback(server, port, {exclusive = false} = {}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({host, port, exclusive});
      });
    } catch (error) {
      // Windows may assign an ephemeral port from an excluded/reserved range.
      // Retry only OS-selected ports; a fixed-port permission error is actionable.
      if (port === 0 && ['EACCES', 'EADDRINUSE'].includes(error.code)) continue;
      throw error;
    }
    const bound = server.address();
    if (port !== 0 || (bound.port >= 1024 && !unavailablePreviewPorts.has(bound.port))) return bound;
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
  throw new Error('系统未分配到可用的本机预览端口。');
}

// Finish bounded early-denied bodies without retaining or parsing their bytes.
async function discardBeforeResponse(incoming, request) {
  if (incoming.complete || incoming.destroyed || request?.body?.locked) return;
  let reader, timer;
  const expired = new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); });
  try {
    reader = (request?.body ?? Readable.toWeb(incoming)).getReader();
    let remaining = 17 * 1024 * 1024;
    while (remaining > 0) {
      const part = await Promise.race([reader.read(), expired]);
      if (part === null || part.done) break;
      remaining -= part.value.byteLength;
    }
  } catch { /* The normal response/abort path handles closed or unreadable bodies. */ }
  finally { clearTimeout(timer); reader?.releaseLock(); }
}

export function serviceUnavailable() {
  return json({error:{code:'SERVICE_UNAVAILABLE',message:'团队服务暂不可用。'}}, 503);
}

/** Shared Node-to-Web adapter. Each service supplies its own authority and routing. */
export async function startLoopbackTeamListener({createServer, protocol, port, resolveTarget, dispatch}) {
  let origin;
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const closed = () => { if (!outgoing.writableEnded) abort(); };
    incoming.once('aborted', abort);
    outgoing.once('close', closed);
    if (incoming.aborted || outgoing.destroyed) abort();
    try {
      let response, request;
      try {
        const target = origin && resolveTarget(incoming, origin);
        if (!target) response = json({error:{code:'HOST_DENIED',message:'请求地址无效。'}}, 403);
        else {
          const options = {method:incoming.method, headers:incoming.headers, signal:controller.signal};
          if (!['GET', 'HEAD'].includes(incoming.method)) {
            options.body = Readable.toWeb(incoming);
            options.duplex = 'half';
          }
          request = new Request(target, options);
          response = await dispatch(request, incoming);
        }
      } catch { response = serviceUnavailable(); }
      if (controller.signal.aborted || outgoing.destroyed) { await response.body?.cancel(); return; }
      if (response.status >= 400) await discardBeforeResponse(incoming, request);
      if (controller.signal.aborted || outgoing.destroyed) { await response.body?.cancel(); return; }
      const writeHeaders = () => {
        const headers = Object.fromEntries(response.headers);
        // Unread request bytes must not carry over to a persistent connection.
        if (!incoming.complete) headers.connection = 'close';
        outgoing.writeHead(response.status, headers);
      };
      if (response.headers.has('X-Shenyi-Workpaper-Export-Sha256')) {
        writeHeaders();
        try { await pipeline(Readable.fromWeb(response.body), outgoing, {signal:controller.signal}); }
        catch { outgoing.destroy(); }
        return;
      }
      const bytes = incoming.method === 'HEAD' ? null : Buffer.from(await response.arrayBuffer());
      if (controller.signal.aborted || outgoing.destroyed) return;
      writeHeaders();
      outgoing.end(bytes);
    } finally {
      incoming.off('aborted', abort);
      outgoing.off('close', closed);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  const bound = await listenOnLoopback(server, port);
  origin = `${protocol}://${host}:${bound.port}`;
  const address = {host, port:bound.port, url:origin};
  const close = () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
  return {server, address, close};
}
