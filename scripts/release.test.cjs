const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function load(file, overrides = {}, cache = new Map()) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const local = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts', overrides, cache) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts', overrides, cache) : require(name);
    new Function('require', 'module', 'exports', code)(local, module, module.exports);
    return module.exports;
}

test('session verification rejects expired, future, malformed, wrong-role and wrong-algorithm claims', async () => {
    const original = process.env.JWT_SECRET;
    try {
        process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
        const session = load('src/lib/session.ts');
        const { SignJWT } = await import('jose');
        const key = session.getSessionKey();
        const userId = crypto.randomUUID();
        const token = (claims, algorithm = 'HS256') => new SignJWT({ userId, role: 'TENANT', exp: Math.floor(Date.now() / 1000) + 60, ...claims }).setProtectedHeader({ alg: algorithm }).sign(key);
        assert.equal((await session.verifyToken(await token({}))).userId, userId);
        for (const value of [await token({ exp: 1 }), await token({ nbf: Math.floor(Date.now() / 1000) + 3600 }), await token({ role: 'ADMIN' }), await token({ userId: 'invalid' }), await token({ exp: undefined }), await token({ authVersion: -1 }), await token({ authVersion: '0' }), await token({ authVersion: 1.5 }), await token({}, 'HS384'), 'not-a-token']) {
            assert.equal(await session.verifyToken(value), null);
        }
        process.env.JWT_SECRET = 'short';
        await assert.rejects(session.signToken({ userId, role: 'TENANT' }), /JWT_SECRET/);
    } finally { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original; }
});

test('concurrent email uniqueness failures become client errors; unrelated database failures remain server errors', async () => {
    let databaseError = Object.assign(new Error('private database details'), { code: 'P2002' });
    const auth = load('src/lib/services/AuthService.ts', {
        '../prisma': { prisma: { user: { findUnique: async () => null, create: async () => { throw databaseError; } } } },
        bcrypt: { hash: async () => 'hash' }, '../auth': {},
    }).AuthService;
    await assert.rejects(auth.register('test@example.test', 'password123', 'Test'), error => error.statusCode === 400 && error.message === 'Email already exists');
    databaseError = new Error('private database details');
    await assert.rejects(auth.register('test@example.test', 'password123', 'Test'), error => error === databaseError);
});

test('registration rejects passwords bcrypt would silently truncate, including multibyte input', async () => {
    let registrations = 0;
    const route = load('src/app/api/auth/register/route.ts', { '@/lib/services/AuthService': { AuthService: { register: async () => { registrations++; return { role: 'TENANT' }; } } } });
    const register = password => route.POST(new NextRequest('http://localhost/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Tenant', email: 'tenant@example.test', password }) }));
    assert.equal((await register('a'.repeat(72))).status, 201);
    assert.equal((await register('a'.repeat(73))).status, 400);
    assert.equal((await register('é'.repeat(36))).status, 201);
    assert.equal((await register('é'.repeat(37))).status, 400);
    assert.equal(registrations, 2);
});

test('readiness requires a valid secret and reachable database without revealing internal errors', async () => {
    let badSecret = false, badDatabase = false, queries = 0;
    const health = load('src/app/api/health/route.ts', {
        '@/lib/session': { getSessionKey: () => { if (badSecret) throw Error('secret details'); } },
        '@/lib/prisma': { prisma: { $queryRaw: async () => { queries++; if (badDatabase) throw Error('database credentials'); return [{ '?column?': 1 }]; } } },
    });
    let response = await health.GET(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ready' }); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    badSecret = true; response = await health.GET(); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { status: 'unavailable' }); assert.equal(queries, 1);
    badSecret = false; badDatabase = true; response = await health.GET(); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { status: 'unavailable' });
    const middleware = load('src/middleware.ts', { '@/lib/session': { getSessionKey() {}, verifyToken: async () => null } });
    assert.equal((await middleware.middleware(new NextRequest('http://localhost/api/health'))).status, 200);
    for (const route of ['/api/health/private', '/api/tickets', '/api/users?role=TECHNICIAN']) assert.equal((await middleware.middleware(new NextRequest('http://localhost' + route))).status, 401);
    const authenticated = load('src/middleware.ts', { '@/lib/session': { getSessionKey() {}, verifyToken: async () => ({ role: 'TENANT' }) } });
    const protectedResponse = await authenticated.middleware(new NextRequest('http://localhost/api/attachments/id', { headers: { cookie: 'session=valid' } }));
    assert.match(protectedResponse.headers.get('Cache-Control'), /private/);
    assert.match(protectedResponse.headers.get('Cache-Control'), /no-store/);
});

test('dynamic ticket handlers await promised route parameters before database use', async () => {
    const id = crypto.randomUUID(); const userId = crypto.randomUUID();
    const ticket = { id, tenantId: userId, assignedToId: null, images: [], activityLogs: [] };
    const base = {
        '@/lib/roles': { requireAuth: async () => ({ userId, role: 'TENANT' }), requireRole: async () => ({ userId, role: 'MANAGER' }), authorizeTicketAccess: () => true },
        '@/lib/prisma': { prisma: { ticket: { findUnique: async ({ where }) => { assert.equal(where.id, id); return ticket; } } } },
        '@/lib/services/TicketService': { TicketService: { addNote: async value => { assert.equal(value, id); return {}; }, assign: async value => { assert.equal(value, id); return {}; }, updateStatus: async value => { assert.equal(value, id); return {}; } } },
        '@/lib/attachments': { attachmentUrl: value => value },
    };
    const context = { params: Promise.resolve({ id }) };
    assert.equal((await load('src/app/api/tickets/[id]/route.ts', base).GET(new NextRequest('http://localhost/api/tickets/' + id), context)).status, 200);
    const notes = load('src/app/api/tickets/[id]/notes/route.ts', base);
    assert.equal((await notes.POST(new NextRequest('http://localhost/api/notes', { method: 'POST', body: JSON.stringify({ note: 'An update' }) }), context)).status, 201);
    const status = load('src/app/api/tickets/[id]/status/route.ts', base);
    assert.equal((await status.POST(new NextRequest('http://localhost/api/status', { method: 'POST', body: JSON.stringify({ technicianId: crypto.randomUUID() }) }), context)).status, 200);
    assert.equal((await status.PATCH(new NextRequest('http://localhost/api/status', { method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS' }) }), context)).status, 200);
});
