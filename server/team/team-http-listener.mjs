import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {json} from './http-utils.mjs';

const host = '127.0.0.1';

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
        const target = resolveTarget(incoming, origin);
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
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const bound = server.address();
  origin = `${protocol}://${host}:${bound.port}`;
  const address = {host, port:bound.port, url:origin};
  const close = () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
  return {server, address, close};
}
