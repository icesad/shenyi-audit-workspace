import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const detachedSignatureLength = 64;

export function keyFingerprint(key) {
  const publicKey = key.type === 'public' ? key : createPublicKey(key);
  return createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex');
}

export function detachedSignatureFiles(fail) {
  function inside(parent, filename) {
    const relative = path.relative(parent, filename);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
  }

  function localPath(value, code) {
    if (typeof value !== 'string' || !value.isWellFormed() || !path.isAbsolute(value) || /^[\\/]{2}|[\x00-\x1f\x7f]/.test(value)) fail(code);
    if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(value)) fail(code);
    const parts = value.slice(path.parse(value).root.length).split(/[\\/]/);
    if (parts.some(part => part === '.' || part === '..')) fail(code);
    if (process.platform === 'win32' && parts.some(part => /[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail(code);
    return path.resolve(value);
  }

  function sameFile(a, b) {
    return a.dev === b.dev && a.ino === b.ino;
  }

  function sameState(a, b) {
    return sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
  }

  async function separatePath(value, bundleDirectory, code) {
    const filename = localPath(value, code);
    try {
      const parent = path.dirname(filename);
      const [actualParent, canonicalCheckout] = await Promise.all([fs.realpath(parent), fs.realpath(checkout)]);
      if (path.relative(parent, actualParent) || inside(canonicalCheckout, filename) || inside(bundleDirectory, filename)) fail(code);
      return filename;
    } catch {
      fail(code);
    }
  }

  async function readStableFile(filename, maxBytes, code) {
    let handle, bytes;
    try {
      const entry = await fs.lstat(filename, { bigint: true });
      if (!entry.isFile() || entry.nlink !== 1n || entry.size < 1n || entry.size > BigInt(maxBytes)) fail(code);
      if (path.relative(filename, await fs.realpath(filename))) fail(code);
      handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const state = await handle.stat({ bigint: true });
      if (!sameState(entry, state)) fail(code);
      bytes = Buffer.alloc(Number(state.size));
      for (let offset = 0; offset < bytes.length;) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) fail(code);
        offset += bytesRead;
      }
      const final = await handle.stat({ bigint: true });
      if (!sameState(state, final) || !sameState(state, await fs.lstat(filename, { bigint: true }))) fail(code);
      return bytes;
    } catch {
      bytes?.fill(0);
      fail(code);
    } finally {
      await handle?.close();
    }
  }

  async function readEd25519Key(value, directory, privateKey) {
    const code = privateKey ? 'SIGNING_KEY_INVALID' : 'VERIFICATION_KEY_INVALID';
    const filename = await separatePath(value, directory, code);
    const bytes = await readStableFile(filename, 4096, code);
    try {
      const label = privateKey ? 'PRIVATE KEY' : 'PUBLIC KEY';
      const pem = new RegExp(`^-----BEGIN ${label}-----\\r?\\n(?:[A-Za-z0-9+/=]+\\r?\\n)+-----END ${label}-----(?:\\r?\\n)?$`);
      if (!pem.test(bytes.toString('latin1'))) fail(code);
      const key = privateKey ? createPrivateKey(bytes) : createPublicKey(bytes);
      if (key.asymmetricKeyType !== 'ed25519') fail(code);
      return key;
    } catch {
      fail(code);
    } finally {
      bytes.fill(0);
    }
  }

  async function unlinkIfOwned(filename, expected) {
    if (!expected) return;
    try {
      const current = await fs.lstat(filename, { bigint: true });
      if (current.isFile() && sameFile(expected, current)) await fs.unlink(filename);
    } catch {
      // Preserve paths that cannot be confirmed as this invocation's file.
    }
  }

  async function publishSignature(filename, bytes, assertSourceStable) {
    const code = 'SIGNATURE_OUTPUT_INVALID';
    const parent = path.dirname(filename);
    const temporary = path.join(parent, `.shenyi-signature-${randomUUID()}.pending`);
    let handle, owned, linked = false;
    try {
      const directory = await fs.lstat(parent, { bigint: true });
      if (!directory.isDirectory() || path.relative(parent, await fs.realpath(parent))) fail(code);
      handle = await fs.open(temporary, 'wx', 0o600);
      owned = await handle.stat({ bigint: true });
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      const current = await fs.lstat(temporary, { bigint: true });
      if (!sameFile(owned, current) || !current.isFile() || current.nlink !== 1n || current.size !== BigInt(detachedSignatureLength)) fail(code);
      await assertSourceStable?.();
      if (path.relative(parent, await fs.realpath(parent)) || !sameFile(directory, await fs.lstat(parent, { bigint: true }))) fail(code);
      await fs.link(temporary, filename);
      linked = true;
      const published = await fs.lstat(filename, { bigint: true });
      if (!sameFile(owned, published) || !published.isFile() || published.nlink !== 2n) fail(code);
      await fs.unlink(temporary);
      if (!(await readStableFile(filename, detachedSignatureLength, code)).equals(bytes)) fail(code);
      await assertSourceStable?.();
    } catch {
      await handle?.close().catch(() => {});
      if (linked) await unlinkIfOwned(filename, owned);
      await unlinkIfOwned(temporary, owned);
      fail(code);
    }
  }

  return { localPath, separatePath, readStableFile, readEd25519Key, publishSignature };
}
