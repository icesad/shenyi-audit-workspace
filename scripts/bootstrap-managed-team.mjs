#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapManagedOwner } from '../server/team/managed-owner-bootstrap.mjs';

const maxInputBytes = 8 * 1024;
const fields = ['displayName', 'phone', 'password', 'verifiedOutOfBand'];
const messages = {
  BOOTSTRAP_INPUT_INVALID: '请通过标准输入提供有效的负责人资料，并确认手机号已经线下核验。',
  BOOTSTRAP_TARGET_INVALID: '请指定仓库之外尚未创建的本机目录。',
  BOOTSTRAP_FAILED: '首次负责人初始化未完成。',
};

function invalidInput() {
  throw Object.assign(new Error(messages.BOOTSTRAP_INPUT_INVALID), { code: 'BOOTSTRAP_INPUT_INVALID' });
}

async function readOwnerInput(input) {
  if (input.isTTY) invalidInput();
  const chunks = [];
  let bytes, total = 0;
  try {
    for await (const part of input) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8');
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxInputBytes) invalidInput();
    }
    bytes = Buffer.concat(chunks, total);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) invalidInput();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const data = JSON.parse(text);
    if (!data || Object.getPrototypeOf(data) !== Object.prototype || Object.keys(data).length !== fields.length ||
      fields.some(field => !Object.hasOwn(data, field)) || data.verifiedOutOfBand !== true ||
      ['displayName', 'phone', 'password'].some(field => typeof data[field] !== 'string')) invalidInput();
    // Count only JSON key tokens. After the scalar-only shape check this also
    // rejects duplicates, including keys written with escaped spellings.
    const keys = [...text.matchAll(/"(?:[^"\\]|\\.)*"\s*(:)?/gs)].filter(match => match[1]);
    if (keys.length !== fields.length) invalidInput();
    return data;
  } catch {
    invalidInput();
  } finally {
    bytes?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function runManagedOwnerBootstrap(args, input = process.stdin) {
  if (args.length !== 2 || args[0] !== '--output-dir' || !args[1] || args[1].startsWith('--')) invalidInput();
  const owner = await readOwnerInput(input);
  return { ok: true, ...(await bootstrapManagedOwner({ outputDirectory: args[1], ...owner })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagedOwnerBootstrap(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = Object.hasOwn(messages, error?.code) ? error.code : 'BOOTSTRAP_FAILED';
    console.error(JSON.stringify({ ok: false, code, message: messages[code] }));
    process.exitCode = 1;
  });
}
