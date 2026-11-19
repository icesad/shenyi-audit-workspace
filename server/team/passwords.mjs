import {scrypt, randomBytes, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive = promisify(scrypt);
// OWASP scrypt alternative: N=2^15, r=8, p=3; native async Node implementation.
// Argon2id remains a production evaluation item; no custom cryptographic primitive.
const OPTIONS = Object.freeze({N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024});
const PREFIX = 'scrypt$32768$8$3$';
const ENCODED_PASSWORD = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export const validPassword = password => typeof password === 'string' && [...password].length >= 12 && [...password].length <= 128 && Buffer.byteLength(password) <= 512;
export const hasSupportedPasswordHash = encoded => typeof encoded === 'string' && ENCODED_PASSWORD.test(encoded);
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Invalid password');
  const salt = randomBytes(16);
  const result = await derive(password, salt, 32, OPTIONS);
  return `${PREFIX}${salt.toString('hex')}$${result.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 512) return false;
  const match = ENCODED_PASSWORD.exec(encoded || '');
  if (!match) return false;
  const result = await derive(password, Buffer.from(match[1], 'hex'), 32, OPTIONS);
  return timingSafeEqual(result, Buffer.from(match[2], 'hex'));
}
