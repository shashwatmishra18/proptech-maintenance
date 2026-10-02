const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');

// Execute the real TypeScript handlers with an in-memory database boundary.
// No database records are read or written by this suite.
function load(file, overrides = {}) {
    const source = fs.readFileSync(path.resolve(file), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    const localRequire = (name) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', overrides);
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts', overrides);
        return require(name);
    };
    new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
    return module.exports;
}

test('Zod 4 handlers reject invalid and malformed JSON without database operations', async () => {
    const session = { userId: crypto.randomUUID(), role: 'TENANT', exp: 9999999999 };
    const overrides = {
        '@/lib/roles': { requireAuth: async () => session, requireRole: async () => session },
        '@/lib/prisma': { prisma: {} },
        '@/lib/services/AuthService': { AuthService: {} },
        '@/lib/services/TicketService': { TicketService: {} },
        '@/lib/attachments': { validateOwnedUploads: async () => { throw new Error('Unexpected upload access'); } },
    };
    const cases = [
        ['src/app/api/auth/login/route.ts', 'POST'],
        ['src/app/api/auth/register/route.ts', 'POST'],
        ['src/app/api/tickets/route.ts', 'POST'],
        ['src/app/api/tickets/[id]/notes/route.ts', 'POST'],
        ['src/app/api/tickets/[id]/status/route.ts', 'POST'],
        ['src/app/api/tickets/[id]/status/route.ts', 'PATCH'],
    ];
    for (const [file, method] of cases) {
        const handler = load(file, overrides)[method];
        for (const body of ['{}', '{']) {
            const req = new NextRequest('http://localhost/api/test', { method, body, headers: { 'Content-Type': 'application/json' } });
            assert.equal((await handler(req, { params: { id: session.userId } })).status, 400, file + ' ' + body);
        }
    }
    const tickets = load('src/app/api/tickets/route.ts', overrides);
    assert.equal((await tickets.GET(new NextRequest('http://localhost/api/tickets?status=INVALID'))).status, 400);
});

test('Phase 1 registration, sessions, directory and attachment boundaries', async () => {
    const originalSecret = process.env.JWT_SECRET;
    const session = load('src/lib/session.ts');
    const tenantId = crypto.randomUUID();
    const techId = crypto.randomUUID();
    const managerId = crypto.randomUUID();
    let cookie;
    let created;
    let signedIn;
    const bcrypt = require('bcrypt');
    const password = await bcrypt.hash('test-password', 10);
    const database = { user: {
        findUnique: async ({ where }) => where.email === 'manager@example.test' ? { id: managerId, email: where.email, name: 'Manager', role: 'MANAGER', password } : null,
        create: async ({ data }) => { created = data; return { id: tenantId, name: data.name, email: data.email, role: data.role }; },
        findMany: async (query) => { assert.deepEqual(query.select, { id: true, name: true }); return [{ id: techId, name: 'Technician' }]; },
    } };
    const overrides = {
        '@/lib/prisma': { prisma: database },
        '../prisma': { prisma: database },
        './auth': session,
        '../auth': { setSessionCookie: async (payload) => { signedIn = await session.signToken(payload); } },
    };
    delete process.env.JWT_SECRET;
    await assert.rejects(session.signToken({ userId: tenantId, role: 'TENANT' }), /JWT_SECRET/);
    await assert.rejects(session.verifyToken('invalid'), /JWT_SECRET/);
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    const roles = load('src/lib/roles.ts', overrides);
    overrides['@/lib/roles'] = roles;
    const service = load('src/lib/services/AuthService.ts', overrides).AuthService;
    overrides['@/lib/services/AuthService'] = { AuthService: service };
    const registration = load('src/app/api/auth/register/route.ts', overrides);
    const register = (role) => registration.POST(new NextRequest('http://localhost/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Tenant', email: 'tenant@example.test', password: 'test-password', ...(role ? { role } : {}) }),
    }));
    assert.equal((await register()).status, 201);
    assert.equal(created.role, 'TENANT');
    for (const role of ['MANAGER', 'TECHNICIAN']) assert.equal((await register(role)).status, 400);
    await service.login('manager@example.test', 'test-password');
    assert.equal((await session.verifyToken(signedIn)).role, 'MANAGER');
    assert.equal(await session.verifyToken(signedIn + 'tampered'), null);
    assert.equal(await session.verifyToken(await session.signToken({ role: 'MANAGER' })), null);
    const request = (url) => new NextRequest('http://localhost' + url, { headers: cookie ? { cookie: 'session=' + cookie } : {} });
    const directory = load('src/app/api/users/route.ts', overrides);
    assert.equal((await directory.GET(request('/api/users?role=TECHNICIAN'))).status, 401);
    for (const role of ['TENANT', 'TECHNICIAN']) {
        cookie = await session.signToken({ userId: role === 'TENANT' ? tenantId : techId, role });
        assert.equal((await directory.GET(request('/api/users?role=TECHNICIAN'))).status, 403);
    }
    cookie = signedIn;
    assert.deepEqual((await (await directory.GET(request('/api/users?role=TECHNICIAN'))).json()).data, [{ id: techId, name: 'Technician' }]);
    assert.equal((await directory.GET(request('/api/users?role=TENANT'))).status, 400);
    const legacyFile = fs.readdirSync('public/uploads').find(name => name.endsWith('.jpg'));
    let reads = 0;
    database.ticketImage = { findUnique: async ({ where }) => where.id === 'missing' ? null : {
        id: where.id, imageUrl: '/uploads/' + legacyFile, ticket: { tenantId, assignedToId: techId, property: { managerId } },
    } };
    const attachments = load('src/lib/attachments.ts');
    overrides['@/lib/attachments'] = { ...attachments, readAttachment: async (url) => { reads++; return attachments.readAttachment(url); } };
    const route = load('src/app/api/attachments/[id]/route.ts', overrides);
    const getImage = () => route.GET(request('/api/attachments/image'), { params: { id: 'image' } });
    cookie = undefined;
    assert.equal((await getImage()).status, 401);
    for (const role of ['TENANT', 'TECHNICIAN']) {
        cookie = await session.signToken({ userId: crypto.randomUUID(), role });
        assert.equal((await getImage()).status, 404);
    }
    assert.equal(reads, 0);
    for (const [userId, role] of [[tenantId, 'TENANT'], [techId, 'TECHNICIAN'], [managerId, 'MANAGER']]) {
        cookie = await session.signToken({ userId, role });
        const response = await getImage();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
        assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
        assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    for (const url of ['/uploads/../.env', '/uploads/%2e%2e%2f.env', '/uploads/a/b.jpg', 'https://example.test/image.jpg']) {
        await assert.rejects(attachments.readAttachment(url));
    }
    await assert.rejects(attachments.validateOwnedUploads(['/api/attachments/files/' + techId + '-file.jpg'], tenantId));
    const stored = new Map();
    const mockFiles = {
        mkdir: async () => {},
        writeFile: async (filename, bytes, options) => { assert.equal(options.flag, 'wx'); stored.set(filename, bytes); },
        realpath: async (filename) => filename,
        stat: async (filename) => { if (!stored.has(filename)) throw new Error('Missing'); return { isFile: () => true, size: stored.get(filename).length }; },
        readFile: async (filename) => stored.get(filename),
    };
    const privateAttachments = load('src/lib/attachments.ts', { 'fs/promises': mockFiles });
    const upload = load('src/app/api/upload/route.ts', { ...overrides, 'fs/promises': mockFiles, '@/lib/attachments': privateAttachments });
    cookie = await session.signToken({ userId: tenantId, role: 'TENANT' });
    const form = new FormData();
    form.append('file', new File([fs.readFileSync('public/uploads/' + legacyFile)], '../../image.jpg', { type: 'image/jpeg' }));
    const uploadRequest = new NextRequest('http://localhost/api/upload', { method: 'POST', headers: { cookie: 'session=' + cookie }, body: form });
    const uploaded = await upload.POST(uploadRequest);
    assert.equal(uploaded.status, 200);
    const urls = (await uploaded.json()).data.imageUrls;
    assert.ok(urls[0].startsWith('/api/attachments/files/' + tenantId + '-'));
    assert.ok([...stored.keys()][0].startsWith(path.join(process.cwd(), 'storage/uploads') + path.sep));
    await privateAttachments.validateOwnedUploads(urls, tenantId);
    await assert.rejects(privateAttachments.validateOwnedUploads(urls, techId));
    const badForm = new FormData();
    badForm.append('file', new File(['not an image'], 'file.jpg', { type: 'image/jpeg' }));
    assert.equal((await upload.POST(new NextRequest('http://localhost/api/upload', { method: 'POST', headers: { cookie: 'session=' + cookie }, body: badForm }))).status, 400);
    const middleware = load('src/middleware.ts', { '@/lib/session': session });
    assert.equal((await middleware.middleware(request('/uploads/' + legacyFile))).status, 404);
    assert.equal((await middleware.middleware(request('/_next/image?url=/uploads/' + legacyFile))).status, 404);
    delete process.env.JWT_SECRET;
    assert.equal((await middleware.middleware(request('/api/users?role=TECHNICIAN'))).status, 503);
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    assert.equal(typeof NextResponse.json, 'function');
});
