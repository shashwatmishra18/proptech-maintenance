const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');

// Opt-in test of a named local QA container; retains its volume and new fixtures.
if (process.env.RUN_LIVE_INTEGRATION !== '1') throw Error('Set RUN_LIVE_INTEGRATION=1 for local QA');
const url = new URL(process.env.INTEGRATION_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.port, '55432'); assert.equal(url.pathname, '/proptech_db');
const name = process.env.QA_CONTAINER_NAME;
assert.match(name || '', /^proptech-phase5-[a-z0-9-]+$/);
const base = 'http://127.0.0.1:3105';
const docker = args => cp.execFileSync('docker', args, { encoding: 'utf8' }).trim();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const email = 'container.' + Date.now() + '@example.test';
const password = crypto.randomBytes(24).toString('hex');
async function api(route, cookie = '', method = 'GET', body, expected = 200) {
    const form = body instanceof FormData;
    const response = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body && !form ? { 'Content-Type': 'application/json' } : {}) }, body: body ? form ? body : JSON.stringify(body) : undefined });
    const json = await response.json(); assert.equal(response.status, expected, route); return { data: json.data, response };
}
async function main() {
    const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]));
    assert.ok(ports['3000/tcp'].some(port => port.HostIp === '127.0.0.1' && port.HostPort === '3105'));
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const loginPage = await fetch(base + '/login'); assert.equal(loginPage.status, 200);
    const html = await loginPage.text(); const stylesheet = html.match(/href="([^" ]*\/_next\/static\/[^" ]+\.css)"/);
    assert.ok(stylesheet); assert.equal((await fetch(base + stylesheet[1])).status, 200);
    await api('/api/auth/register', '', 'POST', { name: 'Container tenant', email, password }, 201);
    const login = await api('/api/auth/login', '', 'POST', { email, password });
    const cookieHeader = login.response.headers.get('set-cookie'); assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /Secure/);
    const cookie = cookieHeader.split(';')[0];
    const form = new FormData(); form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64')], { type: 'image/png' }), 'qa.png');
    const uploads = (await api('/api/upload', cookie, 'POST', form)).data.imageUrls;
    const ticket = (await api('/api/tickets', cookie, 'POST', { title: 'Container storage verification', description: 'Verify protected persistent storage in the production image.', priority: 'HIGH', imageUrls: uploads }, 201)).data;
    assert.equal(ticket.priority, 'HIGH');
    await api('/api/tickets/' + ticket.id + '/notes', cookie, 'POST', { note: 'Container note verification' }, 201);
    const detail = (await api('/api/tickets/' + ticket.id, cookie)).data;
    const image = detail.images[0].imageUrl;
    await api('/api/upload', cookie, 'DELETE', { imageUrls: uploads });
    let response = await fetch(base + image, { headers: { cookie } }); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.equal((await fetch(base + image)).status, 401);
    assert.equal((await fetch(base + '/api/tickets', { headers: { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' } })).status, 401);
    // Attach one existing legacy file to this new local fixture without altering it.
    const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
        const legacy = fs.readdirSync('public/uploads').find(file => file.endsWith('.jpg'));
        assert.ok(legacy);
        const linked = await db.ticketImage.create({ data: { ticketId: ticket.id, imageUrl: '/uploads/' + legacy } });
        assert.equal((await fetch(base + '/api/attachments/' + linked.id, { headers: { cookie } })).status, 200);
        assert.equal((await fetch(base + '/uploads/' + legacy, { headers: { cookie } })).status, 404);
    } finally { await db.$disconnect(); }
    docker(['restart', '--time', '10', name]);
    let ready = false;
    for (let i = 0; i < 60; i++) { try { ready = (await fetch(base + '/api/health')).status === 200; if (ready) break; } catch {} await wait(250); }
    assert.ok(ready, 'Container becomes ready after restart');
    assert.equal((await fetch(base + image, { headers: { cookie } })).status, 200);
    await api('/api/auth/logout', cookie, 'POST');
    for (let i = 0; i < 45; i++) { if (docker(['inspect', '--format', '{{.State.Health.Status}}', name]) === 'healthy') { console.log('Container health, native login, assets, private/legacy attachments, notes and restart persistence passed.'); return; } await wait(1000); }
    throw Error('Docker readiness healthcheck did not become healthy');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
