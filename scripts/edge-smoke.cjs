const assert = require('node:assert/strict');
const https = require('node:https');
// Self-signed certificates are accepted ONLY for this fixed loopback QA target.
if (process.env.RUN_LIVE_INTEGRATION !== '1') throw Error('Local QA opt-in required');
const request = (path, body, headers = {}) => new Promise((resolve, reject) => {
  const req = https.request({ hostname: '127.0.0.1', port: 3443, servername: 'localhost', rejectUnauthorized: false, path, method: body === undefined ? 'GET' : 'POST', headers: { host: 'localhost', ...headers } }, res => {
    let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  }); req.on('error', reject); req.setTimeout(10000, () => req.destroy(Error('Timeout'))); if (body !== undefined) req.write(body); req.end();
});
(async () => {
  const health = await request('/api/health'); assert.equal(health.status, 200);
  const login = await request('/login'); assert.equal(login.status, 200);
  for (const key of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy']) assert.ok(login.headers[key], key);
  assert.match(login.headers['content-security-policy'], /frame-ancestors 'none'/);
  const css = login.text.match(/href="([^" ]*\/_next\/static\/[^" ]+\.css)"/); assert.ok(css); assert.equal((await request(css[1])).status, 200);
  for (const path of ['/uploads/example.jpg', '/.env', '/storage/uploads/example.png', '/prisma/schema.prisma']) assert.equal((await request(path)).status, 404, path);
  assert.equal((await request('/api/attachments/missing', undefined, { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' })).status, 401);
  const oversized = await request('/api/auth/register', 'x'.repeat(65537), { 'Content-Type': 'application/json', 'Content-Length': '65537' }); assert.equal(oversized.status, 413); assert.match(oversized.text, /body too large/);
  let limited;
  for (let i = 0; i < 28; i++) { const result = await request('/api/auth/login', '{', { 'Content-Type': 'application/json' }); if (result.status === 429) { limited = result; break; } assert.equal(result.status, 400); }
  assert.ok(limited, 'Real Nginx rate limiter returned 429'); assert.equal(limited.headers['retry-after'], '60');
  console.log('PASS HTTPS proxy: readiness, CSP/security headers, static assets, private-file denial, middleware spoof rejection, 413 and real 429/Retry-After; no user writes');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
