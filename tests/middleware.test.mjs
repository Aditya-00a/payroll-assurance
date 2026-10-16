// The site password check in middleware.js, run against Web-standard Requests.
// node tests/middleware.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// middleware.js uses ESM syntax that Vercel bundles; load a .mjs copy so node does too.
const tmp = `${root}tests/.middleware-under-test.mjs`;
writeFileSync(tmp, readFileSync(`${root}middleware.js`, 'utf8'));
const { default: middleware, config } = await import(tmp);
rmSync(tmp);

let ok = 0, bad = 0;
const check = (label, cond, detail) => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail !== undefined && !cond ? `  ${detail}` : ''}`); };
const site = 'https://payroll.example.test';
const get = (path, cookie) => new Request(site + path, { headers: cookie ? { cookie } : {} });
const post = (fields) => new Request(site + '/__signin', { method: 'POST', body: new URLSearchParams(fields) });
const loc = (res) => (res.headers.get('location') || '').replace(site, '');
const passed = (res) => res.headers.get('x-middleware-next') === '1';

check('brand images are not gated', config.matcher[0] === '/((?!brand/).*)');

delete process.env.SITE_PASSWORD;
let res = await middleware(get('/'));
check('no SITE_PASSWORD: site stays open', passed(res) && res.headers.get('x-site-password') === 'off');

process.env.SITE_PASSWORD = 'correct horse battery';
res = await middleware(get('/'));
const html = await res.text();
check('no cookie: password page', res.status === 401 && /Team password/.test(html) && /name="password"/.test(html) && !passed(res));
check('password page is not cached', res.headers.get('cache-control') === 'no-store');
res = await middleware(get('/app.js'));
check('files are gated too', res.status === 401 && !passed(res));
res = await middleware(get('/api/ai'));
check('API answers 401 JSON', res.status === 401 && (await res.json()).error === 'site_password');

res = await middleware(post({ password: 'wrong', next: '/' }));
check('wrong password refused', res.status === 401 && /isn’t right/.test(await res.text()) && !res.headers.get('set-cookie'));
res = await middleware(post({ next: '/' }));
check('empty password refused', res.status === 401);

res = await middleware(post({ password: 'correct horse battery', next: '/' }));
const set = res.headers.get('set-cookie') || '';
check('right password signs in', res.status === 303 && loc(res) === '/' && /^rc_site=[0-9a-f]{64};/.test(set));
check('cookie is HttpOnly, Secure, SameSite', /HttpOnly/.test(set) && /Secure/.test(set) && /SameSite=Lax/.test(set) && /Max-Age=2592000/.test(set));
check('cookie does not contain the password', !set.includes('correct') && !set.includes('horse'));
const cookie = set.split(';')[0];

res = await middleware(get('/', cookie));
check('with the cookie: page served', passed(res) && res.headers.get('x-site-password') === 'on');
res = await middleware(get('/api/ai', `other=1; ${cookie}`));
check('with the cookie: API served', passed(res));
res = await middleware(get('/__signin', cookie));
check('signed in: sign-in path goes home', res.status === 303 && loc(res) === '/');
res = await middleware(get('/', 'rc_site=' + '0'.repeat(64)));
check('forged cookie refused', res.status === 401);

for (const evil of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)']) {
  res = await middleware(post({ password: 'correct horse battery', next: evil }));
  check(`no redirect off-site (${evil})`, res.headers.get('location') === `${site}/`, res.headers.get('location'));
}
res = await middleware(post({ password: 'correct horse battery', next: '/?x=1' }));
check('returns to the page asked for', loc(res) === '/?x=1');
res = await middleware(get('/"><script>x</script>'));
check('page escapes the path it echoes', !/<script>x<\/script>/.test(await res.text()));

process.env.SITE_PASSWORD = 'a new password';
res = await middleware(get('/', cookie));
check('changing the password signs everyone out', res.status === 401);

res = await middleware(get('/__signout', cookie));
check('sign out clears the cookie', res.status === 303 && /Max-Age=0/.test(res.headers.get('set-cookie') || ''));

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
