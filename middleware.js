// Site password: one password for the whole team, checked on Vercel before any page, file or
// AI request is served. Set SITE_PASSWORD in the Vercel project (then redeploy) to turn it on;
// without it the site stays open. Changing the password signs everyone out.
//
//   POST /__signin   the password form posts here; a right password sets a 30-day cookie
//   GET  /__signout  forgets the password on this device
import { next } from '@vercel/functions';

export const config = { matcher: ['/((?!brand/).*)'] };

const COOKIE = 'rc_site';
const MAX_AGE = 60 * 60 * 24 * 30;
const SIGNIN = '/__signin';
const SIGNOUT = '/__signout';

// The cookie holds an HMAC of a fixed message keyed by the password, never the password itself.
async function token(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('rollcall-site-v1'));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : '';
}

// Only same-site paths are allowed after sign-in, so the form can't be used to redirect elsewhere.
const safePath = (p) => (typeof p === 'string' && p.length < 512 && /^\/(?![/\\])/.test(p) ? p : '/');

const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(back, wrong) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rollcall.ai · Payroll Assurance</title><meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/brand/favicon-64.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Sora:wght@600;800&display=swap">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; font-family: Manrope, "Segoe UI", system-ui, sans-serif; color: #0b1530;
    background: radial-gradient(1100px 560px at 8% -12%, rgba(54, 83, 253, 0.38), transparent 62%), radial-gradient(900px 520px at 108% 112%, rgba(253, 50, 142, 0.26), transparent 60%), #001137; }
  .wrap { width: min(400px, 100%); display: grid; gap: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand div { display: flex; flex-direction: column; gap: 6px; }
  .brand span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #8d9ccc; font-weight: 700; line-height: 1; }
  form { background: #fff; border-radius: 14px; box-shadow: 0 24px 60px rgba(0, 6, 24, 0.45); padding: 24px; display: grid; gap: 10px; }
  h1 { font-family: Sora, Manrope, sans-serif; font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.015em; }
  p { margin: 0; font-size: 14px; color: #5d6b8a; line-height: 1.5; }
  label { font-size: 14px; font-weight: 700; margin-top: 6px; }
  input { width: 100%; font: inherit; font-size: 15px; padding: 10px 12px; border: 1px solid #b7c3dc; border-radius: 6px; color: inherit; }
  input:focus-visible, button:focus-visible { outline: 2px solid #3653fd; outline-offset: 2px; }
  button { margin-top: 8px; font: inherit; font-weight: 700; font-size: 15px; padding: 10px 14px; border: 0; border-radius: 6px; background: #3653fd; color: #fff; cursor: pointer; }
  button:hover { filter: brightness(1.07); }
  .err { color: #d92d20; font-size: 14px; font-weight: 600; }
  .foot { color: #aab6d8; font-size: 12px; line-height: 1.55; }
</style></head>
<body><main class="wrap">
  <div class="brand"><img src="/brand/rollcall-mark.png" alt="" width="40" height="40"><div><img src="/brand/rollcall-wordmark-white.png" alt="Rollcall.ai" width="132" height="25"><span>Payroll Assurance</span></div></div>
  <form method="post" action="${SIGNIN}">
    <h1>Team password</h1>
    <p>Enter the password you were given to open Payroll Assurance.</p>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus${wrong ? ' aria-describedby="err" aria-invalid="true"' : ''}>
    <input type="hidden" name="next" value="${esc(back)}">
    ${wrong ? '<p class="err" id="err" role="alert">That password isn’t right. Try again, or ask the person who shared the link.</p>' : ''}
    <button type="submit">Continue</button>
  </form>
  <p class="foot">After this you choose Employer or Employee. This device remembers the password for 30 days.</p>
</main></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export default async function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return next({ headers: { 'x-site-password': 'off' } });
  const url = new URL(request.url);
  const want = await token(password);

  if (url.pathname === SIGNOUT) {
    return new Response(null, { status: 303, headers: { Location: new URL('/', url).href, 'Set-Cookie': cookie('', 0), 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === SIGNIN && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const given = form ? String(form.get('password') || '') : '';
    const back = safePath(form ? String(form.get('next') || '/') : '/');
    if (given && same(await token(given), want)) {
      return new Response(null, { status: 303, headers: { Location: new URL(back === SIGNIN ? '/' : back, url).href, 'Set-Cookie': cookie(want, MAX_AGE), 'Cache-Control': 'no-store' } });
    }
    await new Promise((r) => setTimeout(r, 700)); // slows down guessing
    return page(back, true);
  }
  if (same(readCookie(request, COOKIE), want)) {
    if (url.pathname === SIGNIN) return new Response(null, { status: 303, headers: { Location: new URL('/', url).href } });
    return next({ headers: { 'x-site-password': 'on' } });
  }
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'site_password', message: 'Enter the team password first.' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  return page(safePath(url.pathname + url.search), false);
}
