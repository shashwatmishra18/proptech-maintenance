const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { validateProduction } = require('./production-config.cjs');
const { normalizeDatabase, prepareDatabase, initializeRailwayVolume } = require('./railway-environment.cjs');
const { createGateway, createLimiter, securityHeaders } = require('./railway-gateway.cjs');

const environment = () => ({ DEPLOYMENT_PLATFORM: 'railway', DATABASE_URL: 'postgresql://operator:local-only@postgres.railway.internal/app', JWT_SECRET: randomBytes(48).toString('hex'), APP_ORIGIN: 'https://app.example.test', EMAIL_PROVIDER: 'disabled', STORAGE_BACKEND: 'persistent', UPLOAD_ROOT: '/app/storage/uploads' });
async function gatewayTest(handler, checks) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createGateway({ upstreamPort: upstream.address().port, origin: 'https://app.example.test' });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const base = 'http://127.0.0.1:' + gateway.address().port;
  // Node's fetch transport can replace Host; use actual HTTP to test the
  // provider-supplied public Host without weakening the gateway's host check.
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const headers = { host: 'app.example.test', ...options.headers };
    if (typeof options.body === 'string') headers['content-length'] = String(Buffer.byteLength(options.body));
    const outgoing = http.request(base + path, { method: options.method || 'GET', headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
        const resultHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) resultHeaders.append(key, item);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: resultHeaders }));
      });
    });
    outgoing.on('error', reject);
    if (options.body instanceof Readable) options.body.pipe(outgoing);
    else outgoing.end(options.body);
  });
  try { await checks(request); } finally {
    gateway.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
}

test('Railway normalizes referenced DB URLs with strict TLS/pool options and allows only explicit email disablement', () => {
  const env = environment(); normalizeDatabase(env);
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.searchParams.get('sslmode'), 'require'); assert.equal(url.searchParams.get('sslaccept'), 'strict'); assert.equal(url.searchParams.get('connection_limit'), '5');
  assert.equal(validateProduction(env), true);
  const bad = { ...environment(), DATABASE_URL: environment().DATABASE_URL + '?sslmode=disable' }; normalizeDatabase(bad); assert.throws(() => validateProduction(bad));
  assert.throws(() => validateProduction({ ...env, EMAIL_PROVIDER: '' }));
  assert.throws(() => validateProduction({ ...env, DEPLOYMENT_PLATFORM: 'host' }));
  assert.throws(() => validateProduction({ ...env, DEV_CREDENTIAL_LINKS: '1' }));
});
test('database CA preparation rejects invalid/private/oversized input before creating a certificate file', () => {
  for (const certificate of ['not a certificate', '-----BEGIN PRIVATE KEY-----private-data', 'x'.repeat(16385)]) assert.throws(() => prepareDatabase({ ...environment(), DATABASE_CA_CERT: certificate }));
});
test('Railway mount initialization refuses arbitrary directories before filesystem/privilege changes', () => {
  for (const patch of [{ UPLOAD_ROOT: '/etc' }, { LEGACY_UPLOAD_ROOT: '/etc' }, { RAILWAY_VOLUME_MOUNT_PATH: '/other' }]) assert.throws(() => initializeRailwayVolume({ ...environment(), LEGACY_UPLOAD_ROOT: '/app/storage/legacy', RAILWAY_VOLUME_MOUNT_PATH: '/app/storage', ...patch }));
});
test('single-instance limiter refills safely, separates upload budget and imposes a global anti-spoof budget', () => {
  let now = 0; const limiter = createLimiter(() => now);
  for (let i = 0; i < 20; i++) assert.equal(limiter.check('credential', 'client'), 0);
  assert.equal(limiter.check('credential', 'client'), 2);
  assert.equal(limiter.check('upload', 'client'), 0);
  now = 2000; assert.equal(limiter.check('credential', 'client'), 0);
  const global = createLimiter(() => now);
  for (let i = 0; i < 100; i++) assert.equal(global.check('credential', 'different-' + i), 0);
  assert.ok(global.check('credential', 'different-final') > 0);
});
test('real HTTP gateway retains all headers/cache rules, rejects private paths/foreign origins and strips spoofed forwarding headers', async () => {
  let calls = 0;
  await gatewayTest((req, res) => {
    calls++; assert.equal(req.headers.host, 'app.example.test'); assert.equal(req.headers['x-forwarded-proto'], 'https');
    assert.equal(req.headers['x-forwarded-for'], undefined); assert.equal(req.headers['x-real-ip'], undefined); assert.equal(req.headers['x-middleware-subrequest'], undefined);
    res.end('ok');
  }, async request => {
    const response = await request('/api/account', { headers: { 'x-forwarded-for': 'attacker', 'x-real-ip': '198.51.100.1', 'x-forwarded-proto': 'http', 'x-middleware-subrequest': 'middleware:middleware' } });
    assert.equal(response.status, 200); for (const [key, value] of Object.entries(securityHeaders)) assert.equal(response.headers.get(key), value);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    for (const path of ['/uploads/file.png', '/storage/file.png', '/.env.local', '/scripts/bootstrap-manager.cjs', '/dist-ops/prisma/bootstrap-manager.js', '/_next/image']) assert.equal((await request(path)).status, 404);
    assert.equal((await request('/account', { headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await request('/account', { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/api/health', { headers: { host: 'healthcheck.railway.app' } })).status, 200);
    assert.equal(calls, 2);
  });
});
test('real gateway bounds declared and streamed JSON bodies before any upstream request', async () => {
  let calls = 0;
  await gatewayTest((req, res) => { calls++; req.resume(); res.end('ok'); }, async request => {
    const large = await request('/api/auth/register', { method: 'POST', body: 'x'.repeat(65537) }); assert.equal(large.status, 413);
    const streamed = await request('/api/tickets', { method: 'POST', body: Readable.from([Buffer.alloc(40000), Buffer.alloc(40000)]), duplex: 'half' }); assert.equal(streamed.status, 413);
    assert.equal(calls, 0);
    assert.equal((await request('/api/tickets', { method: 'POST', body: '{}' })).status, 200); assert.equal(calls, 1);
  });
});
test('real gateway shares authentication endpoint limits and does not trust arbitrary X-Forwarded-For identities', async () => {
  await gatewayTest((req, res) => { req.resume(); res.end('ok'); }, async request => {
    for (let i = 0; i < 20; i++) assert.equal((await request('/api/auth/' + (i % 2 ? 'forgot-password' : 'login'), { method: 'POST', body: '{}', headers: { 'x-forwarded-for': 'spoof-' + i } })).status, 200);
    const limited = await request('/api/auth/reset-password', { method: 'POST', body: '{}' }); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(limited.headers.get('x-content-type-options'), 'nosniff');
  });
});
test('real gateway caps simultaneous upload bodies until responses finish and releases capacity', async () => {
  await gatewayTest((req, res) => { req.resume(); setTimeout(() => res.end('ok'), 100); }, async request => {
    const results = await Promise.all([0, 1, 2].map(() => request('/api/upload', { method: 'POST', body: 'x' })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 429]);
    await Promise.all(results.map(r => r.text()));
    assert.equal((await request('/api/upload', { method: 'POST', body: 'x' })).status, 200);
  });
});
test('Railway runtime refuses invalid platform ports before spawning a server', async () => {
  const previous = process.env.PORT;
  try { process.env.PORT = 'not-a-port'; await assert.rejects(require('./railway-start.cjs').startRailway(), /PORT/); }
  finally { if (previous === undefined) delete process.env.PORT; else process.env.PORT = previous; }
});
