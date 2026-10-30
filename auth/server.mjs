#!/usr/bin/env node
// Login service for ebike-map (SPEC §20). Zero dependencies.
//   GET  /auth/check  Caddy forward_auth: 200 with a valid session; otherwise a redirect to
//                     /login for page loads, 401 for API calls
//   GET  /login       login form, or the first-run setup form if no password is set yet
//   POST /login       verify password, set session cookie
//   POST /setup       first run: setup code (printed to this container's log) + new password
//   GET/POST /password  change password (signed in, needs the current one); signs out other devices
//   GET  /logout      clear the session
// Env: AUTH_PASSWORD_HASH (optional override from hash-password.mjs; disables setup and
//      in-app changes), PORT (8080), SESSION_DAYS (180), DATA_DIR (/data: the saved
//      password hash and the cookie-signing secret).
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { hashPassword, isValidHash, verifyPassword } from './password.mjs';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const HASH_FILE = join(DATA_DIR, 'password-hash');
const SECRET_FILE = join(DATA_DIR, 'session-secret');
const PORT = Number(process.env.PORT ?? 8080);
const SESSION_S = Number(process.env.SESSION_DAYS ?? 180) * 86400;
const COOKIE = 'ebike_session';
const MIN_LENGTH = 10;

function writeAtomic(file, data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${file}.tmp`, data, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
const readOrNull = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim() : null);

// Where the password hash comes from. The env var wins when set; a set-but-malformed env
// var locks the app rather than falling back to setup (fail closed).
const ENV_HASH = (process.env.AUTH_PASSWORD_HASH ?? '').trim();
const MODE = ENV_HASH ? (isValidHash(ENV_HASH) ? 'env' : 'broken') : 'file';
let hash = MODE === 'env' ? ENV_HASH : MODE === 'file' ? readOrNull(HASH_FILE) : null;
if (MODE === 'file' && hash && !isValidHash(hash)) {
  console.error(`[auth] ${HASH_FILE} is malformed; delete it and restart to set a new password`);
  hash = 'invalid';
}
const configured = () => Boolean(hash) && isValidHash(hash);
const needsSetup = () => MODE === 'file' && !hash;

// First-run setup code: proves you can read the server's logs, so a stranger who finds the
// URL first can't claim the app. Valid until used; a restart makes a new one.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const setupCode = Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const announceSetup = () => console.log(`[auth] No password set. Open the app and enter setup code: ${setupCode}`);

// Cookie-signing secret: generated once, kept in the volume so sessions survive restarts.
// Replaced on a password change, which signs out every other device.
function loadSecret() {
  try {
    if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE);
    const s = randomBytes(32);
    writeAtomic(SECRET_FILE, s);
    return s;
  } catch (e) {
    console.warn(`[auth] can't persist the session secret (${e.message}); sessions reset on restart`);
    return randomBytes(32);
  }
}
let secret = loadSecret();

const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
function makeSession() {
  const payload = `v1.${Math.floor(Date.now() / 1000) + SESSION_S}.${randomBytes(9).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}
function validSession(cookieHeader) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookieHeader ?? '');
  if (!m) return false;
  const value = m[1];
  const dot = value.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = value.slice(0, dot), mac = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return false;
  const [v, exp] = payload.split('.');
  return v === 'v1' && Number(exp) > Date.now() / 1000;
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const signedIn = (req) => configured() && validSession(req.headers.cookie);

// Brute-force protection (login, setup code and current-password checks share it):
// 5 failures per IP -> locked 15 min, doubling on repeat.
const attempts = new Map(); // ip -> { fails, lockedUntil, lockouts }
function lockedFor(ip) {
  const a = attempts.get(ip);
  return a && a.lockedUntil > Date.now() ? Math.ceil((a.lockedUntil - Date.now()) / 60000) : 0;
}
function recordFailure(ip, what) {
  const a = attempts.get(ip) ?? { fails: 0, lockedUntil: 0, lockouts: 0 };
  a.fails++;
  if (a.fails >= 5) {
    a.lockouts++;
    a.fails = 0;
    a.lockedUntil = Date.now() + 15 * 60000 * 2 ** (a.lockouts - 1);
  }
  attempts.set(ip, a);
  console.warn(`[auth] ${what} from ${ip}`);
}
// Caddy sets X-Real-IP from its trusted-proxy view of the client (deploy/Caddyfile).
const clientIp = (req) => String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '');

// Only same-site paths for the post-login redirect.
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !/^\/(login|setup)/.test(n) ? n : '/');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const FORMS = {
  login: ({ next }) => `<form method="post" action="/login"><h1>ebike-map</h1><p>Enter your password.</p>
%ERROR%<input type="hidden" name="next" value="${esc(next)}">
<input type="text" name="username" value="ebike-map" autocomplete="username" hidden>
<input type="password" name="password" autocomplete="current-password" required autofocus aria-label="Password">
<button type="submit">Sign in</button></form>`,
  setup: ({ next }) => `<form method="post" action="/setup"><h1>Set a password</h1>
<p>First run. Enter the setup code from the <code>auth</code> container's log in Coolify (a line starting <code>[auth] No password set</code>), then choose a password.</p>
%ERROR%<input type="hidden" name="next" value="${esc(next)}">
<input type="text" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required autofocus placeholder="Setup code" aria-label="Setup code">
<input type="text" name="username" value="ebike-map" autocomplete="username" hidden>
<input type="password" name="password" autocomplete="new-password" minlength="${MIN_LENGTH}" required placeholder="New password (${MIN_LENGTH}+ characters)" aria-label="New password">
<input type="password" name="password2" autocomplete="new-password" minlength="${MIN_LENGTH}" required placeholder="New password again" aria-label="New password again">
<button type="submit">Set password</button></form>`,
  password: () => `<form method="post" action="/password"><h1>Change password</h1><p>Other signed-in devices will be signed out.</p>
%ERROR%<input type="text" name="username" value="ebike-map" autocomplete="username" hidden>
<input type="password" name="current" autocomplete="current-password" required autofocus placeholder="Current password" aria-label="Current password">
<input type="password" name="password" autocomplete="new-password" minlength="${MIN_LENGTH}" required placeholder="New password (${MIN_LENGTH}+ characters)" aria-label="New password">
<input type="password" name="password2" autocomplete="new-password" minlength="${MIN_LENGTH}" required placeholder="New password again" aria-label="New password again">
<button type="submit">Change password</button><a href="/">Cancel</a></form>`,
  managed: () => `<form><h1>Password set by the server</h1><p>This password comes from <code>AUTH_PASSWORD_HASH</code> in Coolify, so it can't be changed here. Generate a new hash (see the README) and redeploy, or remove the variable to manage the password in the app.</p><a href="/">Back to the map</a></form>`,
  broken: () => `<form><h1>Login is misconfigured</h1><p>The stored password hash isn't valid. Fix or remove <code>AUTH_PASSWORD_HASH</code> in Coolify, or delete <code>password-hash</code> from the <code>auth</code> volume, then redeploy. The app stays locked until then.</p></form>`,
};

function page(res, status, form, { error = '', next = '/' } = {}) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · ebike-map</title><meta name="robots" content="noindex"><link rel="icon" href="/icon.svg">
<style>
:root{--bg:#fff;--fg:#18201c;--muted:#5b6862;--line:#d8dfdb;--accent:#0b7a4b;--accent-fg:#fff;--error:#b3261e;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101412;--fg:#e7ece9;--muted:#9aa8a1;--line:#2c3430;--accent:#3ccf8e;--accent-fg:#0c1a13;--error:#ff8a80;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,-apple-system,sans-serif}
form{width:min(360px,100%);display:grid;gap:12px}h1{margin:0;font-size:1.375rem}p{margin:0;color:var(--muted)}
input{width:100%;padding:12px;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:10px}
button{min-height:48px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;cursor:pointer}
a{color:var(--accent);text-align:center;padding:8px}.error{color:var(--error)}code{font-size:.875rem}
</style></head><body>
${FORMS[form]({ next }).replace('%ERROR%', error ? `<p class="error" role="alert">${esc(error)}</p>\n` : '')}
</body></html>`;
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
  res.end(body);
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4096) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(new URLSearchParams(data)));
    req.on('error', reject);
  });
}

/** Checks a new password pair; returns an error message or ''. */
function newPasswordProblem(form) {
  const a = form.get('password') ?? '', b = form.get('password2') ?? '';
  if (a.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (a.length > 256) return 'That password is too long.';
  if (a !== b) return "The passwords didn't match.";
  return '';
}

/** Saves a new password and starts a fresh session for this device; old sessions end. */
async function setPassword(res, password, next) {
  const h = await hashPassword(password);
  writeAtomic(HASH_FILE, `${h}\n`);
  hash = h;
  secret = randomBytes(32);
  try { writeAtomic(SECRET_FILE, secret); } catch (e) { console.warn(`[auth] can't persist the session secret (${e.message})`); }
  res.writeHead(303, { location: next, 'set-cookie': cookie(makeSession(), SESSION_S), 'cache-control': 'no-store' }).end();
}

const loginForm = () => (MODE === 'broken' || hash === 'invalid' ? 'broken' : needsSetup() ? 'setup' : 'login');

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const ip = clientIp(req);
  try {
    if (url.pathname === '/auth/check') {
      if (signedIn(req)) return res.writeHead(200).end();
      const navigation = req.headers['sec-fetch-mode'] === 'navigate' || String(req.headers.accept ?? '').includes('text/html');
      if (navigation) {
        const next = safeNext(String(req.headers['x-forwarded-uri'] ?? '/'));
        return res.writeHead(302, { location: `/login?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' }).end();
      }
      return res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"error":"login required"}');
    }

    if (url.pathname === '/login' && req.method === 'GET') {
      const form = loginForm(), next = safeNext(url.searchParams.get('next'));
      if (form === 'login' && signedIn(req)) return res.writeHead(303, { location: next }).end();
      if (form === 'setup') announceSetup(); // again, in case the startup line scrolled away
      return page(res, form === 'broken' ? 503 : 200, form, { next });
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      const form = await readForm(req);
      const next = safeNext(form.get('next'));
      if (loginForm() !== 'login') return res.writeHead(303, { location: '/login' }).end();
      const wait = lockedFor(ip);
      if (wait) return page(res, 429, 'login', { error: `Too many attempts. Try again in ${wait} min.`, next });
      if (await verifyPassword(form.get('password') ?? '', hash)) {
        attempts.delete(ip);
        return res.writeHead(303, { location: next, 'set-cookie': cookie(makeSession(), SESSION_S), 'cache-control': 'no-store' }).end();
      }
      recordFailure(ip, 'failed login');
      return page(res, 401, 'login', { error: 'Wrong password.', next });
    }

    if (url.pathname === '/setup' && req.method === 'POST') {
      const form = await readForm(req);
      const next = safeNext(form.get('next'));
      if (!needsSetup()) return res.writeHead(303, { location: '/login' }).end();
      const wait = lockedFor(ip);
      if (wait) return page(res, 429, 'setup', { error: `Too many attempts. Try again in ${wait} min.`, next });
      const given = Buffer.from(normCode(form.get('code'))), want = Buffer.from(normCode(setupCode));
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        recordFailure(ip, 'wrong setup code');
        return page(res, 401, 'setup', { error: 'Wrong setup code. Check the auth container log.', next });
      }
      const problem = newPasswordProblem(form);
      if (problem) return page(res, 400, 'setup', { error: problem, next });
      attempts.delete(ip);
      console.log('[auth] password set');
      return await setPassword(res, form.get('password'), next);
    }

    if (url.pathname === '/password') {
      if (!signedIn(req)) return res.writeHead(303, { location: '/login?next=%2Fpassword' }).end();
      if (MODE === 'env') return page(res, 409, 'managed');
      if (req.method === 'GET') return page(res, 200, 'password');
      if (req.method !== 'POST') return res.writeHead(405).end();
      const form = await readForm(req);
      const wait = lockedFor(ip);
      if (wait) return page(res, 429, 'password', { error: `Too many attempts. Try again in ${wait} min.` });
      if (!(await verifyPassword(form.get('current') ?? '', hash))) {
        recordFailure(ip, 'wrong current password');
        return page(res, 401, 'password', { error: 'Current password is wrong.' });
      }
      const problem = newPasswordProblem(form);
      if (problem) return page(res, 400, 'password', { error: problem });
      attempts.delete(ip);
      console.log('[auth] password changed; other sessions signed out');
      return await setPassword(res, form.get('password'), '/');
    }

    if (url.pathname === '/logout') {
      return res.writeHead(303, { location: '/login', 'set-cookie': cookie('', 0), 'cache-control': 'no-store' }).end();
    }
    res.writeHead(404).end();
  } catch (e) {
    console.error('[auth]', e);
    if (!res.headersSent) res.writeHead(400).end();
  }
}).listen(PORT, () => {
  const how = { env: 'password from AUTH_PASSWORD_HASH', broken: 'AUTH_PASSWORD_HASH is malformed: app locked', file: !hash ? 'no password yet' : configured() ? 'password set' : 'saved password hash is malformed: app locked' }[MODE];
  console.log(`[auth] listening on ${PORT}; ${how}`);
  if (needsSetup()) announceSetup();
});
