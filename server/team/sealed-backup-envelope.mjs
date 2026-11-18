// Fixed-format authenticated envelope for one manifest and one SQLite snapshot.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const magic = Buffer.from('SHENYIB1', 'ascii');
const headerSize = 32;
const tagSize = 16;
const manifestLimit = 1024 * 1024;
const snapshotChunk = 128 * 1024;
const gcmPlaintextLimit = 2 ** 36 - 32;

export class SealedEnvelopeError extends Error {}

function invalid() {
  throw new SealedEnvelopeError('Invalid sealed backup envelope');
}

function validLengths(manifestBytes, databaseBytes) {
  return Number.isSafeInteger(manifestBytes) && manifestBytes > 0 && manifestBytes <= manifestLimit &&
    Number.isSafeInteger(databaseBytes) && databaseBytes > 0 && manifestBytes + databaseBytes <= gcmPlaintextLimit;
}

async function readExact(handle, bytes, position) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, position + offset);
    if (!bytesRead) invalid();
    offset += bytesRead;
  }
}

export async function writeEnvelopeBytes(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    if (!bytesWritten) throw new Error('Incomplete backup write');
    offset += bytesWritten;
  }
}

export async function encryptBackupEnvelope({ database, manifest, databaseBytes, databaseSha256, key, output }) {
  if (!validLengths(manifest.length, databaseBytes)) invalid();
  const header = Buffer.alloc(headerSize);
  magic.copy(header);
  const nonce = randomBytes(12);
  nonce.copy(header, 8);
  header.writeUInt32BE(manifest.length, 20);
  header.writeBigUInt64BE(BigInt(databaseBytes), 24);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: tagSize });
  cipher.setAAD(header);
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(snapshotChunk);
  try {
    await writeEnvelopeBytes(output, header);
    await writeEnvelopeBytes(output, cipher.update(manifest));
    for (let offset = 0; offset < databaseBytes;) {
      const bytes = buffer.subarray(0, Math.min(buffer.length, databaseBytes - offset));
      await readExact(database, bytes, offset);
      digest.update(bytes);
      await writeEnvelopeBytes(output, cipher.update(bytes));
      offset += bytes.length;
    }
    const { bytesRead } = await database.read(buffer, 0, 1, databaseBytes);
    if (bytesRead || digest.digest('hex') !== databaseSha256) invalid();
    await writeEnvelopeBytes(output, cipher.final());
    await writeEnvelopeBytes(output, cipher.getAuthTag());
  } finally {
    buffer.fill(0);
  }
}

export async function readBackupEnvelope(handle, fileBytes) {
  if (!Number.isSafeInteger(fileBytes) || fileBytes <= headerSize + tagSize) invalid();
  const header = Buffer.alloc(headerSize);
  await readExact(handle, header, 0);
  if (!header.subarray(0, magic.length).equals(magic)) invalid();
  const manifestBytes = header.readUInt32BE(20);
  const databaseBytesBig = header.readBigUInt64BE(24);
  if (databaseBytesBig > BigInt(gcmPlaintextLimit)) invalid();
  const databaseBytes = Number(databaseBytesBig);
  if (!validLengths(manifestBytes, databaseBytes) || fileBytes !== headerSize + manifestBytes + databaseBytes + tagSize) invalid();
  const tag = Buffer.alloc(tagSize);
  await readExact(handle, tag, fileBytes - tagSize);
  return { header, tag, manifestBytes, databaseBytes };
}

export async function decryptBackupEnvelope(handle, envelope, key, { authenticatedFrames, writeDatabase } = {}) {
  if ((authenticatedFrames !== undefined && !Buffer.isBuffer(authenticatedFrames)) ||
      (writeDatabase !== undefined && (typeof writeDatabase !== 'function' || !authenticatedFrames))) invalid();
  const { header, tag, manifestBytes, databaseBytes } = envelope;
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8, 20), { authTagLength: tagSize });
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const manifest = Buffer.alloc(manifestBytes);
  const buffer = Buffer.alloc(snapshotChunk);
  const payloadBytes = manifestBytes + databaseBytes;
  const frameBytes = Math.ceil(payloadBytes / snapshotChunk) * 32;
  const frames = authenticatedFrames ?? Buffer.alloc(frameBytes);
  if (frames.length !== frameBytes) invalid();
  let authenticated = false;
  try {
    for (let offset = 0; offset < payloadBytes;) {
      const encrypted = buffer.subarray(0, Math.min(buffer.length, payloadBytes - offset));
      await readExact(handle, encrypted, headerSize + offset);
      const frame = frames.subarray(offset / snapshotChunk * 32, offset / snapshotChunk * 32 + 32);
      const digest = createHash('sha256').update(encrypted).digest();
      // On the writing pass, admit only bytes authenticated by the first pass.
      if (authenticatedFrames) { if (!frame.equals(digest)) invalid(); }
      else digest.copy(frame);
      const plaintext = decipher.update(encrypted);
      try {
        if (plaintext.length !== encrypted.length) invalid();
        const count = Math.min(plaintext.length, Math.max(0, manifestBytes - offset));
        if (count) plaintext.copy(manifest, offset, 0, count);
        if (writeDatabase && count < plaintext.length) await writeDatabase(plaintext.subarray(count));
      } finally {
        plaintext.fill(0);
      }
      offset += encrypted.length;
    }
    let tail;
    try {
      tail = decipher.final();
    } catch {
      invalid();
    }
    if (tail.length) {
      tail.fill(0);
      invalid();
    }
    authenticated = true;
    return { manifest, frames };
  } finally {
    buffer.fill(0);
    if (!authenticated) {
      manifest.fill(0);
      if (!authenticatedFrames) frames.fill(0);
    }
  }
}
