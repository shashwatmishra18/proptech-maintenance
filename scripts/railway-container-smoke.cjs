const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { Readable } = require('node:stream');

// Opt-in, additive fixtures only. Never accept a forwarded production database.
assert.equal(process.env.RUN_LIVE_INTEGRATION, '1');
const url = new URL(process.env.INTEGRATION_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.port, '55433');
assert.equal(url.pathname, '/proptech_db');
assert.equal(process.env.QA_CONTAINER_NAME, 'proptech-railway-app');
const name = 'proptech-railway-app';
const docker = args => cp.execFileSync('docker', args, { encoding: 'utf8' }).trim();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const runId = Date.now();
const password = crypto.randomBytes(24).toString('hex');
const email = role => `railway.${runId}.${role}@example.test`;
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });

async function request(route, { cookie = '', method = 'GET', body, headers = {}, chunks } = {}) {
  let data = body && JSON.stringify(body);
  let contentType = 'application/json';
  if (body instanceof FormData) {
    const encoded = new Request('http://local.test', { method: 'POST', body });
    data = Buffer.from(await encoded.arrayBuffer()); contentType = encoded.headers.get('content-type');
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3108, path: route, method,
      headers: { Host: 'railway-qa.example.test', ...(cookie ? { cookie } : {}),
        ...(data ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, res => {
      const buffers = []; res.on('data', chunk => buffers.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(buffers), text: Buffer.concat(buffers).toString() }));
    });
    req.on('error', reject);
    if (chunks) Readable.from(chunks).pipe(req); else req.end(data);
  });
}
async function api(route, cookie = '', method = 'GET', body, expected = 200) {
  const res = await request(route, { cookie, method, body });
  assert.equal(res.status, expected, `${route}: ${res.text}`);
  return { data: JSON.parse(res.text).data, res };
}
async function login(role, credential = password) {
  const { res } = await api('/api/auth/login', '', 'POST', { email: email(role), password: credential });
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=lax/i);
  return cookie.split(';')[0];
}
function bootstrap(input) {
  return cp.spawnSync('docker', ['exec', '-i', name, 'node', 'scripts/bootstrap-manager.cjs', '--confirm-bootstrap'],
    { input: JSON.stringify(input), encoding: 'utf8' });
}
async function ready() {
  for (let i = 0; i < 60; i++) { try { if ((await request('/api/health')).status === 200) return; } catch {} await wait(500); }
  throw Error('Local Railway container did not become ready');
}
async function main() {
  const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]));
  assert.ok(ports['3211/tcp'].some(p => p.HostIp === '127.0.0.1' && p.HostPort === '3108'));
  await ready();
  assert.match(docker(['exec', name, 'cat', '/proc/1/status']), /Uid:\s+1001\s+1001\s+1001\s+1001/);
  const ssl = await db.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
  assert.equal(ssl[0].ssl, true);
  assert.equal((await db.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)[0].count, 5);
  const page = await request('/login'); assert.equal(page.status, 200);
  const stylesheet = page.text.match(/href="([^" ]*\/_next\/static\/[^" ]+\.css)"/);
  assert.ok(stylesheet); assert.equal((await request(stylesheet[1])).status, 200);
  console.log('PASS Railway: final image, dynamic PORT, native Prisma TLS, five migrations, non-root runtime and static assets');

  const managerInput = { name: 'Railway QA Manager', email: email('manager'), password };
  const first = bootstrap(managerInput); assert.equal(first.status, 0, first.stderr);
  const original = await db.user.findUniqueOrThrow({ where: { email: email('manager') } });
  assert.notEqual(bootstrap(managerInput).status, 0);
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: original.id } }), original);
  const manager = await login('manager');
  await api('/api/auth/register', '', 'POST', { name: 'Railway Tenant', email: email('tenant'), password }, 201);
  await api('/api/auth/register', '', 'POST', { name: 'Railway Other Tenant', email: email('other'), password }, 201);
  const tenant = await login('tenant'), other = await login('other');
  const property = (await api('/api/properties', manager, 'POST', { name: 'Railway QA Property', address: '10 Local QA Street' }, 201)).data;
  const unit = (await api(`/api/properties/${property.id}/units`, manager, 'POST', { identifier: '1A' }, 201)).data;
  await api('/api/tenant-assignment', manager, 'PATCH', { email: email('tenant'), unitId: unit.id, expectedVersion: 0 });
  const invitation = (await api('/api/staff', manager, 'POST', { name: 'Railway QA Technician', email: email('tech') }, 201)).data;
  assert.equal(invitation.delivered, false); assert.equal('url' in invitation, false); assert.equal('token' in invitation, false);
  const technician = await db.user.findUniqueOrThrow({ where: { email: email('tech') } });
  // With provider deliberately disabled, a known LOCAL-only hash fixture exercises
  // the real invitation endpoint without email/token leakage or production access.
  const raw = crypto.randomBytes(32).toString('hex');
  await db.credentialToken.create({ data: { tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), purpose: 'INVITE',
    email: technician.email, role: technician.role, authVersion: technician.authVersion, userId: technician.id,
    createdById: original.id, expiresAt: new Date(Date.now() + 600000) } });
  await api('/api/auth/invitation', '', 'POST', { token: raw, password, confirmation: password });
  await api('/api/auth/invitation', '', 'POST', { token: raw, password, confirmation: password }, 400);
  const tech = await login('tech');
  const recovery = (await api('/api/auth/forgot-password', '', 'POST', { email: email('tenant') })).data;
  assert.equal('url' in recovery, false); assert.equal('token' in recovery, false);
  assert.equal(docker(['exec', name, 'sh', '-c', 'test ! -f /app/.env && test ! -d /app/storage/dev-credentials && echo clean']), 'clean');
  console.log('PASS Railway: explicit manager bootstrap/no overwrite, tenant sessions, property/unit occupancy, real invitation acceptance and disabled-email non-disclosure');

  const form = new FormData(); form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'qa.png');
  const imageUrls = (await api('/api/upload', tenant, 'POST', form)).data.imageUrls;
  const ticket = (await api('/api/tickets', tenant, 'POST', { title: 'Railway storage and workflow', description: 'Verify real PostgreSQL and persistent private storage.', priority: 'HIGH', imageUrls }, 201)).data;
  assert.equal((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).priority, 'HIGH');
  const detail = (await api(`/api/tickets/${ticket.id}`, tenant)).data;
  const image = detail.images[0].imageUrl;
  assert.equal((await request(image)).status, 401);
  assert.equal((await request(image, { cookie: other })).status, 404);
  assert.equal((await request(image, { cookie: tenant })).status, 200);
  await api(`/api/tickets/${ticket.id}/notes`, tenant, 'POST', { note: 'Railway tenant note' }, 201);
  const route = `/api/tickets/${ticket.id}/status`;
  await api(route, manager, 'POST', { technicianId: technician.id });
  assert.equal((await request(image, { cookie: tech })).status, 200);
  const racing = await Promise.all([1, 2].map(() => request(route, { cookie: tech, method: 'PATCH', body: { status: 'IN_PROGRESS' } })));
  assert.deepEqual(racing.map(r => r.status).sort(), [200, 409]);
  await api(`/api/tickets/${ticket.id}/notes`, tech, 'POST', { note: 'Railway technician note' }, 201);
  await api(route, tech, 'PATCH', { status: 'DONE' });
  await api(route, tech, 'PATCH', { status: 'DONE' }, 409);
  assert.equal((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'DONE');
  const notifications = (await api('/api/notifications', tenant)).data;
  assert.ok(notifications.notifications.some(n => n.ticketHref === `/tickets/${ticket.id}`));
  assert.equal(JSON.stringify(notifications).includes('ticketId'), false);
  await api('/api/notifications', tenant, 'PATCH', { ids: [notifications.notifications[0].id] });
  const filtered = (await api('/api/tickets?status=DONE&priority=HIGH', manager)).data;
  assert.ok(filtered.tickets.some(t => t.id === ticket.id));
  const legacyName = crypto.randomUUID() + '.png';
  const legacyBytes = (await request(image, { cookie: tenant })).bytes;
  const legacyWrite = cp.spawnSync('docker', ['exec', '--user', '1001', '-i', name, 'node', '-e',
    "const fs=require('fs');let b=[];process.stdin.on('data',c=>b.push(c));process.stdin.on('end',()=>fs.writeFileSync('/app/storage/legacy/'+process.argv[1],Buffer.concat(b),{flag:'wx'}))", legacyName], { input: legacyBytes });
  assert.equal(legacyWrite.status, 0);
  const legacy = await db.ticketImage.create({ data: { ticketId: ticket.id, imageUrl: '/uploads/' + legacyName } });
  assert.equal((await request('/api/attachments/' + legacy.id, { cookie: tenant })).status, 200);
  assert.equal((await request('/api/attachments/' + legacy.id)).status, 401);
  assert.equal((await request('/uploads/' + legacyName, { cookie: tenant })).status, 404);
  console.log('PASS Railway: private upload authorization, persisted priority, assignment, concurrent start conflict, notes, DONE, scoped search and notifications');

  docker(['restart', '--time', '10', name]); await ready();
  assert.equal((await request(image, { cookie: tenant })).status, 200);
  assert.equal((await request('/api/attachments/' + legacy.id, { cookie: tenant })).status, 200);
  await api('/api/auth/logout', tenant, 'POST');
  const logout = await request('/api/auth/logout', { cookie: other, method: 'POST' });
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
  docker(['stop', '--time', '10', 'proptech-railway-db']);
  try { const failed = await request('/api/health'); assert.equal(failed.status, 503); assert.doesNotMatch(failed.text, /postgres|password|DATABASE_URL/i); }
  finally { docker(['start', 'proptech-railway-db']); }
  await ready();
  for (const pathname of ['/api/health', '/login', stylesheet[1], '/uploads/private.png', '/storage/uploads/a', '/.env']) {
    const response = await request(pathname); assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.ok(response.headers['content-security-policy']); assert.ok(response.headers['strict-transport-security']);
  }
  assert.equal((await request('/login', { headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await request('/login', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/tickets', { headers: { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', chunks: [Buffer.alloc(40000), Buffer.alloc(40000)] })).status, 413);
  let limited;
  for (let i = 0; i < 21; i++) limited = await request('/api/auth/login', { method: 'POST', body: {}, headers: { 'X-Real-IP': '192.0.2.42', 'X-Forwarded-For': `198.51.100.${i}` } });
  assert.equal(limited.status, 429); assert.ok(limited.headers['retry-after']);
  console.log('PASS Railway: volume restart persistence, logout cookie, generic DB-outage readiness, recovery, headers, host/origin/spoof rejection, streamed 413 and real 429');
  console.log('Local Railway container verification passed; fixtures and private volumes retained. No production deployment or email delivery claimed.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
