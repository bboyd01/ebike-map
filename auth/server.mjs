#!/usr/bin/env node
// Login service for ebike-map (SPEC §20). Zero dependencies.
//   GET  /auth/check  Caddy forward_auth: 200 with a valid session; otherwise a redirect to
//                     /login for page loads, 401 for API calls
//   GET  /login       login form          POST /login   verify password, set session cookie
//   GET  /logout      clear the session
// Env: AUTH_PASSWORD_HASH (from hash-password.mjs; required), PORT (8080),
//      SESSION_DAYS (180), DATA_DIR (/data: holds the cookie-signing secret).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { isValidHash, verifyPassword } from './password.mjs';

const HASH = (process.env.AUTH_PASSWORD_HASH ?? '').trim();
const CONFIGURED = isValidHash(HASH);
const PORT = Number(process.env.PORT ?? 8080);
const SESSION_S = Number(process.env.SESSION_DAYS ?? 180) * 86400;
const COOKIE = 'ebike_session';

// Cookie-signing secret: generated once, kept in the volume so sessions survive restarts.
function loadSecret() {
  const dir = process.env.DATA_DIR ?? '/data';
  const file = join(dir, 'session-secret');
  try {
    if (existsSync(file)) return readFileSync(file);
    mkdirSync(dir, { recursive: true });
    const s = randomBytes(32);
    writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch (e) {
    console.warn(`[auth] can't persist the session secret (${e.message}); sessions reset on restart`);
    return randomBytes(32);
  }
}
const SECRET = loadSecret();

const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');
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

// Brute-force protection: 5 failures per IP -> locked 15 min, doubling on repeat.
const attempts = new Map(); // ip -> { fails, lockedUntil, lockouts }
function lockedFor(ip) {
  const a = attempts.get(ip);
  return a && a.lockedUntil > Date.now() ? Math.ceil((a.lockedUntil - Date.now()) / 60000) : 0;
}
function recordFailure(ip) {
  const a = attempts.get(ip) ?? { fails: 0, lockedUntil: 0, lockouts: 0 };
  a.fails++;
  if (a.fails >= 5) {
    a.lockouts++;
    a.fails = 0;
    a.lockedUntil = Date.now() + 15 * 60000 * 2 ** (a.lockouts - 1);
  }
  attempts.set(ip, a);
}
// Caddy sets X-Real-IP from its trusted-proxy view of the client (deploy/Caddyfile).
const clientIp = (req) => String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '');

// Only same-site paths for the post-login redirect.
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(res, status, { error = '', next = '/', notConfigured = false } = {}) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · ebike-map</title><meta name="robots" content="noindex"><link rel="icon" href="/icon.svg">
<style>
:root{--bg:#fff;--fg:#18201c;--muted:#5b6862;--line:#d8dfdb;--accent:#0b7a4b;--accent-fg:#fff;--error:#b3261e;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101412;--fg:#e7ece9;--muted:#9aa8a1;--line:#2c3430;--accent:#3ccf8e;--accent-fg:#0c1a13;--error:#ff8a80;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,-apple-system,sans-serif}
form{width:min(360px,100%);display:grid;gap:12px}h1{margin:0;font-size:1.375rem}p{margin:0;color:var(--muted)}
input{width:100%;padding:12px;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:10px}
button{min-height:48px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;cursor:pointer}
.error{color:var(--error)}code{font-size:.875rem}
</style></head><body>
${notConfigured
    ? `<form><h1>Login isn't set up</h1><p>Set <code>AUTH_PASSWORD_HASH</code> on the <code>auth</code> service in Coolify (see the README), then redeploy. The app stays locked until then.</p></form>`
    : `<form method="post" action="/login"><h1>ebike-map</h1><p>Enter your password.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<input type="hidden" name="next" value="${esc(next)}">
<input type="text" name="username" value="ebike-map" autocomplete="username" hidden>
<input type="password" name="password" autocomplete="current-password" required autofocus aria-label="Password">
<button type="submit">Sign in</button></form>`}
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

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname === '/auth/check') {
      if (CONFIGURED && validSession(req.headers.cookie)) return res.writeHead(200).end();
      const navigation = req.headers['sec-fetch-mode'] === 'navigate' || String(req.headers.accept ?? '').includes('text/html');
      if (navigation) {
        const next = safeNext(String(req.headers['x-forwarded-uri'] ?? '/'));
        return res.writeHead(302, { location: `/login?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' }).end();
      }
      return res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"error":"login required"}');
    }
    if (url.pathname === '/login' && req.method === 'GET') {
      if (!CONFIGURED) return page(res, 503, { notConfigured: true });
      if (validSession(req.headers.cookie)) return res.writeHead(303, { location: safeNext(url.searchParams.get('next')) }).end();
      return page(res, 200, { next: safeNext(url.searchParams.get('next')) });
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      if (!CONFIGURED) return page(res, 503, { notConfigured: true });
      const ip = clientIp(req);
      const form = await readForm(req);
      const next = safeNext(form.get('next'));
      const wait = lockedFor(ip);
      if (wait) return page(res, 429, { error: `Too many attempts. Try again in ${wait} min.`, next });
      if (await verifyPassword(form.get('password') ?? '', HASH)) {
        attempts.delete(ip);
        return res.writeHead(303, { location: next, 'set-cookie': cookie(makeSession(), SESSION_S), 'cache-control': 'no-store' }).end();
      }
      recordFailure(ip);
      console.warn(`[auth] failed login from ${ip}`);
      return page(res, 401, { error: 'Wrong password.', next });
    }
    if (url.pathname === '/logout') {
      return res.writeHead(303, { location: '/login', 'set-cookie': cookie('', 0), 'cache-control': 'no-store' }).end();
    }
    res.writeHead(404).end();
  } catch (e) {
    console.error('[auth]', e);
    if (!res.headersSent) res.writeHead(400).end();
  }
}).listen(PORT, () => console.log(`[auth] listening on ${PORT}; ${CONFIGURED ? 'password set' : 'AUTH_PASSWORD_HASH not set: app locked'}`));
