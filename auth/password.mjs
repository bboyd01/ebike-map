// Password hashing with Node's built-in scrypt. Format (no "$", so it's safe in env vars):
//   scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const isValidHash = (h) => /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/.test(String(h ?? '').trim());
