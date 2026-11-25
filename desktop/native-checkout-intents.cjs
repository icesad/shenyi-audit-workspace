'use strict';
const {createHash, randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const idIsValid = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const MAX_RECORD_BYTES = 73;

function createNativeCheckoutIntents(dataRoot) {
  const directory = path.join(dataRoot, 'native-checkout-intents');
  const file = scope => path.join(directory, createHash('sha256').update(JSON.stringify(scope)).digest('hex') + '.txt');
  async function requireDirectory() {
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Invalid checkout directory');
  }
  return Object.freeze({
    async read(scope) {
      let handle;
      try {
        await requireDirectory();
        const location = file(scope);
        if (!(await fs.lstat(location)).isFile()) throw new Error('Invalid checkout record');
        handle = await fs.open(location, 'r');
        const {size} = await handle.stat();
        if (size !== 36 && size !== MAX_RECORD_BYTES) throw new Error('Invalid checkout record');
        const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
        const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
        const [requestId, previousRequestId = null, ...extra] = bytes.toString('utf8', 0, bytesRead).split('\n');
        if (bytesRead !== size || extra.length || !idIsValid(requestId) ||
            previousRequestId !== null && (!idIsValid(previousRequestId) || previousRequestId === requestId)) {
          throw new Error('Invalid checkout record');
        }
        return {requestId, previousRequestId};
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      } finally {
        await handle?.close();
      }
    },
    async write(scope, {requestId, previousRequestId}) {
      if (!idIsValid(requestId) || previousRequestId !== null && (!idIsValid(previousRequestId) || previousRequestId === requestId)) {
        throw new Error('Invalid checkout identity');
      }
      await fs.mkdir(directory, {recursive:true, mode:0o700});
      await requireDirectory();
      const temp = path.join(directory, randomUUID() + '.tmp');
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        try {
          await handle.writeFile(previousRequestId === null ? requestId : requestId + '\n' + previousRequestId, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temp, file(scope));
      } catch (error) {
        await fs.unlink(temp).catch(() => {});
        throw error;
      }
    },
  });
}

module.exports = {createNativeCheckoutIntents};
