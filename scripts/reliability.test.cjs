const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function load(file, overrides = {}, cache = new Map()) {
    const resolved = path.resolve(file);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', overrides, cache);
        if (name.startsWith('.')) return load(path.resolve(path.dirname(resolved), name) + '.ts', overrides, cache);
        return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
}

const errors = load('src/lib/errors/api-response.ts');
const ids = { tenant: crypto.randomUUID(), tech: crypto.randomUUID(), manager: crypto.randomUUID(), ticket: crypto.randomUUID() };
const session = { userId: ids.tenant, role: 'TENANT', exp: 9999999999 };
function request(body, method = 'POST', url = '/api/test') {
    return new NextRequest('http://localhost' + url, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

function fixture(status = 'OPEN', options = {}) {
    let state = {
        ticket: { version: 0, id: ids.ticket, title: 'Original', description: 'Description', priority: 'MEDIUM', status, tenantId: ids.tenant, assignedToId: status === 'OPEN' ? null : ids.tech, property: { managerId: ids.manager, name: 'Test property' } },
        logs: [], notifications: [], images: options.images || [],
    };
    const events = [];
    const db = {
        ticket: { findUnique: async () => structuredClone(state.ticket) },
        $transaction: async callback => {
            const draft = structuredClone(state);
            const tx = { $queryRaw: async () => [],
                user: {
                    findUnique: async ({ where }) => where.id === ids.tenant ? { id: ids.tenant, role: 'TENANT', unit: { id: 'unit', propertyId: 'property', identifier: '4B', property: { managerId: ids.manager, name: 'Test property' } } } : { id: ids.tech, role: 'TECHNICIAN', name: 'Tech & Co' },
                    findMany: async () => [{ id: ids.manager }],
                },
                ticket: {
                    findUnique: async () => structuredClone(draft.ticket),
                    findUniqueOrThrow: async () => structuredClone(draft.ticket),
                    create: async ({ data }) => {
                        events.push('create');
                        draft.ticket = { id: ids.ticket, status: 'OPEN', ...data };
                        draft.logs.push(data.activityLogs.create);
                        draft.images.push(...data.images.create);
                        return structuredClone(draft.ticket);
                    },
                    updateMany: async ({ where, data }) => {
                        events.push({ where, data });
                        const expected = typeof where.status === 'string' ? draft.ticket.status === where.status : !where.status.notIn.includes(draft.ticket.status);
                        if (options.loseCAS || (where.version !== undefined && where.version !== draft.ticket.version) || !expected || ('assignedToId' in where && where.assignedToId !== draft.ticket.assignedToId)) return { count: 0 };
                        const version = draft.ticket.version + (data.version?.increment || 0);
                        Object.assign(draft.ticket, data, { version });
                        return { count: 1 };
                    },
                },
                ticketImage: { findFirst: async ({ where }) => draft.images.find(image => where.imageUrl.in.includes(image.imageUrl)) || null },
                activityLog: { create: async ({ data }) => { draft.logs.push(data); return data; } },
                notification: {
                    create: async ({ data }) => { if (options.failNotifications) throw new Error('Internal connection failure'); draft.notifications.push(data); return data; },
                    createMany: async ({ data }) => { if (options.failNotifications) throw new Error('Internal connection failure'); draft.notifications.push(...data); return { count: data.length }; },
                },
            };
            try { const result = await callback(tx); state = draft; events.push('commit'); return result; }
            catch (error) { events.push('rollback'); throw error; }
        },
    };
    const attachmentCalls = [];
    const overrides = {
        '../prisma': { prisma: db }, '@/lib/prisma': { prisma: db },
        '../errors/api-response': errors, '@/lib/errors/api-response': errors,
        '../attachments': {
            attachmentUrl: id => '/api/attachments/' + id,
            validateOwnedUploads: async () => attachmentCalls.push('validate'),
            lockUploader: async () => attachmentCalls.push('lock'),
            cleanupUnattachedUploads: async () => attachmentCalls.push('cleanup'),
        },
        '@/lib/roles': { requireAuth: async () => session, requireRole: async () => session, authorizeTicketAccess: () => true },
    };
    const service = load('src/lib/services/TicketService.ts', overrides).TicketService;
    overrides['@/lib/services/TicketService'] = { TicketService: service };
    return { service, overrides, events, attachmentCalls, state: () => state };
}

test('all priorities persist, missing priority defaults, invalid priorities never mutate', async () => {
    for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'URGENT', undefined]) {
        const f = fixture();
        const route = load('src/app/api/tickets/route.ts', f.overrides);
        const response = await route.POST(request({ title: 'Leak & repair', description: "O'Brien <needs> repairs & help", ...(priority ? { priority } : {}) }));
        assert.equal(response.status, 201);
        assert.equal((await response.json()).data.priority, priority || 'MEDIUM');
        assert.equal(f.state().ticket.title, 'Leak & repair');
        assert.equal(f.state().ticket.description, "O'Brien <needs> repairs & help");
        assert.equal(f.state().notifications.length, 1);
    }
    const f = fixture();
    const route = load('src/app/api/tickets/route.ts', f.overrides);
    for (const priority of ['INVALID', null, 1]) {
        assert.equal((await route.POST(request({ title: 'Valid title', description: 'Valid description', priority }))).status, 400);
    }
    assert.equal(f.events.length, 0);
});

test('ticket/status and manager directory query enums reject invalid values before database access', async () => {
    const f = fixture();
    const tickets = load('src/app/api/tickets/route.ts', f.overrides);
    assert.equal((await tickets.GET(new NextRequest('http://localhost/api/tickets?status=INVALID'))).status, 400);
    const users = load('src/app/api/users/route.ts', f.overrides);
    assert.equal((await users.GET(new NextRequest('http://localhost/api/users?role=INVALID'))).status, 400);
    assert.equal((await users.GET(new NextRequest('http://localhost/api/users?role=MANAGER'))).status, 400);
    assert.equal(f.events.length, 0);
});

test('assignment uses an OPEN/unassigned predicate and commits a single log with required notifications', async () => {
    const f = fixture();
    const ticket = await f.service.assign(ids.ticket, ids.tech, ids.manager);
    assert.equal(ticket.status, 'ASSIGNED');
    assert.deepEqual(f.events[0].where, { id: ids.ticket, status: 'OPEN', assignedToId: null, version: 0 });
    assert.equal(f.state().logs.length, 1);
    assert.equal(f.state().notifications.length, 2);
    await assert.rejects(f.service.assign(ids.ticket, crypto.randomUUID(), ids.manager), error => error.statusCode === 409);
    assert.equal(f.state().ticket.assignedToId, ids.tech);
    assert.equal(f.state().logs.length, 1);
});

test('stale assignment and status writes return 409 without logs or notifications', async () => {
    for (const [status, action] of [['OPEN', f => f.service.assign(ids.ticket, ids.tech, ids.manager)], ['ASSIGNED', f => f.service.updateStatus(ids.ticket, 'IN_PROGRESS', ids.tech)]]) {
        const f = fixture(status, { loseCAS: true });
        await assert.rejects(action(f), error => error.statusCode === 409);
        assert.equal(f.state().ticket.status, status);
        assert.equal(f.state().logs.length, 0);
        assert.equal(f.state().notifications.length, 0);
        assert.equal(f.events.at(-1), 'rollback');
    }
});

test('status transitions preserve sequence, ownership and repeat conflicts', async () => {
    const f = fixture('ASSIGNED');
    await assert.rejects(f.service.updateStatus(ids.ticket, 'DONE', ids.tech), error => error.statusCode === 400);
    await assert.rejects(f.service.updateStatus(ids.ticket, 'IN_PROGRESS', crypto.randomUUID()), error => error.statusCode === 403);
    assert.equal((await f.service.updateStatus(ids.ticket, 'IN_PROGRESS', ids.tech)).status, 'IN_PROGRESS');
    assert.deepEqual(f.events.find(event => typeof event === 'object').where, { id: ids.ticket, status: 'ASSIGNED', assignedToId: ids.tech, version: 0 });
    await assert.rejects(f.service.updateStatus(ids.ticket, 'IN_PROGRESS', ids.tech), error => error.statusCode === 409);
    assert.equal((await f.service.updateStatus(ids.ticket, 'DONE', ids.tech)).status, 'DONE');
    assert.equal(f.state().logs.length, 2);
    assert.equal(f.state().notifications.length, 3);
});

test('notification failures roll back creation, assignment and completion', async () => {
    for (const [status, action] of [
        ['OPEN', f => f.service.create({ title: 'New title', description: 'New description', priority: 'HIGH', tenantId: ids.tenant }, [])],
        ['OPEN', f => f.service.assign(ids.ticket, ids.tech, ids.manager)],
        ['IN_PROGRESS', f => f.service.updateStatus(ids.ticket, 'DONE', ids.tech)],
    ]) {
        const f = fixture(status, { failNotifications: true });
        await assert.rejects(action(f), /Internal connection failure/);
        assert.equal(f.state().ticket.title, 'Original');
        assert.equal(f.state().ticket.status, status);
        assert.equal(f.state().logs.length, 0);
        assert.equal(f.state().notifications.length, 0);
        assert.equal(f.events.at(-1), 'rollback');
    }
});

test('notes store raw text and completed-ticket errors preserve 400 at the route', async () => {
    const f = fixture('IN_PROGRESS');
    const text = "O'Brien & <script>alert(1)</script>";
    assert.equal((await f.service.addNote(ids.ticket, ids.tech, text)).action, 'Note added: ' + text);
    const done = fixture('DONE');
    const route = load('src/app/api/tickets/[id]/notes/route.ts', done.overrides);
    assert.equal((await route.POST(request({ note: 'A valid note' }), { params: { id: ids.ticket } })).status, 400);
    assert.equal(done.state().logs.length, 0);
    assert.equal(errors.handleApiError(new errors.AppError('Forbidden', 403)).status, 403);
    const unexpected = errors.handleApiError(new Error('Sensitive database connection details'));
    assert.equal(unexpected.status, 500);
    assert.ok(!JSON.stringify(await unexpected.json()).includes('Sensitive'));
});

test('consumed attachment references are rejected and failed creation invokes safe cleanup', async () => {
    const url = '/api/attachments/files/' + ids.tenant + '-test.jpg';
    const f = fixture('OPEN', { images: [{ imageUrl: url }] });
    await assert.rejects(f.service.create({ title: 'New title', description: 'Description', priority: 'HIGH', tenantId: ids.tenant }, [url]), error => error.statusCode === 409);
    assert.deepEqual(f.attachmentCalls, ['lock', 'validate', 'cleanup']);
    assert.equal(f.state().logs.length, 0);
});

test('notification PATCH targets supplied IDs and owner, leaving unseen records unread', async () => {
    const shown = crypto.randomUUID();
    const unseen = crypto.randomUUID();
    const other = crypto.randomUUID();
    const records = [{ id: shown, userId: ids.tenant, read: false }, { id: unseen, userId: ids.tenant, read: false }, { id: other, userId: ids.tech, read: false }];
    const db = { $transaction: async callback => callback({ notification: {
        updateMany: async ({ where }) => { let count = 0; for (const record of records) if (record.userId === where.userId && where.id.in.includes(record.id)) { record.read = true; count++; } return { count }; },
        count: async ({ where }) => records.filter(record => record.userId === where.userId && !record.read).length,
    } }) };
    const route = load('src/app/api/notifications/route.ts', { '@/lib/prisma': { prisma: db }, '@/lib/roles': { requireAuth: async () => session } });
    const response = await route.PATCH(request({ ids: [shown, other] }, 'PATCH'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.unreadCount, 1);
    assert.equal(records[1].read, false);
    assert.equal(records[2].read, false);
    assert.equal((await route.PATCH(request({}, 'PATCH'))).status, 400);
});

test('mutation guard rejects same-tick duplicates and resets after network failure', async () => {
    const pending = []; const messages = [];
    const { useMutation } = load('src/hooks/use-mutation.ts', {
        react: { useRef: value => ({ current: value }), useState: () => [false, value => pending.push(value)] },
        './use-toast': { useToast: () => ({ toast: value => messages.push(value) }) },
    });
    const mutation = useMutation();
    let release; let calls = 0;
    const action = async () => { calls++; await new Promise(resolve => { release = resolve; }); throw new Error('Network failed'); };
    const first = mutation.run(action, 'Failed');
    await mutation.run(action, 'Failed');
    assert.equal(calls, 1);
    release(); await first;
    assert.deepEqual(pending, [true, false]);
    assert.equal(messages[0].description, 'Network failed');
    await mutation.run(async () => { calls++; }, 'Failed');
    assert.equal(calls, 2);
});

test('two requests reading the same state allow only one conditional assignment/status write', async () => {
    for (const operation of ['assign', 'status']) {
        const initial = { id: ids.ticket, status: operation === 'assign' ? 'OPEN' : 'ASSIGNED', assignedToId: operation === 'assign' ? null : ids.tech, tenantId: ids.tenant, property: { managerId: ids.manager, name: 'Test property' } };
        let current = { ...initial }; let arrivals = 0; let release;
        const barrier = new Promise(resolve => { release = resolve; });
        const logs = []; const notifications = [];
        const db = { $transaction: async callback => {
            const pendingLogs = []; const pendingNotifications = [];
            const tx = { $queryRaw: async () => [],
                ticket: {
                    findUnique: async () => { const snapshot = { ...initial }; if (++arrivals === 2) release(); await barrier; return snapshot; },
                    updateMany: async ({ where, data }) => {
                        if (current.status !== where.status || current.assignedToId !== where.assignedToId) return { count: 0 };
                        Object.assign(current, data); return { count: 1 };
                    },
                    findUniqueOrThrow: async () => ({ ...current }),
                },
                user: { findUnique: async ({ where }) => ({ id: where.id, name: 'Tech' }) },
                activityLog: { create: async ({ data }) => pendingLogs.push(data) },
                notification: { create: async ({ data }) => pendingNotifications.push(data) },
            };
            const result = await callback(tx);
            logs.push(...pendingLogs); notifications.push(...pendingNotifications);
            return result;
        } };
        const service = load('src/lib/services/TicketService.ts', {
            '../prisma': { prisma: db }, '../errors/api-response': errors,
            '../attachments': {},
        }).TicketService;
        const actions = operation === 'assign'
            ? [service.assign(ids.ticket, ids.tech, ids.manager), service.assign(ids.ticket, crypto.randomUUID(), ids.manager)]
            : [service.updateStatus(ids.ticket, 'IN_PROGRESS', ids.tech), service.updateStatus(ids.ticket, 'IN_PROGRESS', ids.tech)];
        const results = await Promise.allSettled(actions);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.statusCode, 409);
        assert.equal(logs.length, 1);
        assert.equal(notifications.length, operation === 'assign' ? 2 : 1);
    }
});

test('private cleanup locks uploader, preserves linked/legacy files and rejects unauthorized paths', async () => {
    const root = path.join(process.cwd(), 'storage/uploads');
    const pending = '/api/attachments/files/' + ids.tenant + '-pending.jpg';
    const linked = '/api/attachments/files/' + ids.tenant + '-linked.jpg';
    const files = new Map([[path.join(root, ids.tenant + '-pending.jpg'), Buffer.from([255, 216, 255])], [path.join(root, ids.tenant + '-linked.jpg'), Buffer.from([255, 216, 255])]]);
    const events = [];
    const db = { $transaction: async callback => callback({
        $queryRaw: async (sql, userId) => { assert.ok(sql.join('').includes('FOR UPDATE')); assert.equal(userId, ids.tenant); events.push('lock'); },
        ticketImage: { findFirst: async ({ where }) => { events.push('reference'); return where.imageUrl === linked ? { id: 'existing' } : null; } },
    }) };
    const disk = {
        realpath: async filename => { if (filename !== root && !files.has(filename)) throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); return filename; },
        readFile: async filename => files.get(filename),
        stat: async filename => ({ isFile: () => true, size: files.get(filename).length }),
        unlink: async filename => { events.push('unlink'); files.delete(filename); },
    };
    const attachments = load('src/lib/attachments.ts', { './prisma': { prisma: db }, 'fs/promises': disk });
    await attachments.validateOwnedUploads([pending], ids.tenant);
    await assert.rejects(attachments.validateOwnedUploads([pending], ids.tech));
    await attachments.cleanupUnattachedUploads([linked, pending, pending], ids.tenant);
    assert.equal(events[0], 'lock');
    assert.equal(events.filter(event => event === 'unlink').length, 1);
    assert.ok(files.has(path.join(root, ids.tenant + '-linked.jpg')));
    for (const url of ['/uploads/legacy.jpg', '/api/attachments/files/' + ids.tech + '-linked.jpg', '/api/attachments/files/' + ids.tenant + '-../../.env']) {
        await assert.rejects(attachments.cleanupUnattachedUploads([url], ids.tenant));
    }
    assert.ok(files.has(path.join(root, ids.tenant + '-linked.jpg')));
});

test('partial upload writes are removed without weakening image validation', async () => {
    const written = []; const removed = [];
    const upload = load('src/app/api/upload/route.ts', {
        '@/lib/roles': { requireRole: async () => session },
        '@/lib/attachments': { imageType: () => 'image/jpeg', storedUploadUrl: filename => '/api/attachments/files/' + filename },
        'fs/promises': {
            mkdir: async () => {},
            writeFile: async filename => { written.push(filename); if (written.length === 2) throw new Error('Disk full'); },
            unlink: async filename => removed.push(filename),
        },
    });
    const form = new FormData();
    for (let i = 0; i < 2; i++) form.append('file', new File([Buffer.from([255, 216, 255])], 'file.jpg', { type: 'image/jpeg' }));
    const response = await upload.POST(new NextRequest('http://localhost/api/upload', { method: 'POST', body: form }));
    assert.equal(response.status, 500);
    assert.deepEqual(removed.sort(), written.sort());
    assert.ok(removed.every(filename => filename.startsWith(path.join(process.cwd(), 'storage/uploads') + path.sep)));
});

test('logout expires the same secured cookie and the client navigates only after success', async () => {
    let cookie;
    const auth = load('src/lib/auth.ts', {
        'next/headers': { cookies: () => ({ set: (...args) => { cookie = args; } }) },
        './session': {},
    });
    const route = load('src/app/api/auth/logout/route.ts', { '@/lib/auth': auth });
    assert.equal((await route.POST()).status, 200);
    assert.equal(cookie[0], 'session'); assert.equal(cookie[1], '');
    assert.equal(cookie[2].maxAge, 0); assert.equal(cookie[2].path, '/');
    assert.equal(cookie[2].httpOnly, true); assert.equal(cookie[2].sameSite, 'lax');
    const originalWindow = global.window;
    const navigations = []; global.window = { location: { replace: target => navigations.push(target) } };
    let fail = false;
    const component = load('src/components/LogoutButton.tsx', {
        './ui/button': { Button: 'button' },
        '@/hooks/use-mutation': { useMutation: () => ({ pending: false, run: async action => { try { await action(); } catch { /* Simulate the hook reporting failure. */ } } }) },
        '@/lib/client-request': { requestData: async () => { if (fail) throw new Error('Network failed'); } },
    }).LogoutButton;
    try {
        await component().props.onClick(); assert.deepEqual(navigations, ['/login']);
        fail = true; await component().props.onClick(); assert.equal(navigations.length, 1);
    } finally { global.window = originalWindow; }
});

test('notification dropdown changes local read state only after a successful targeted PATCH', async () => {
    const shown = crypto.randomUUID();
    const states = [[{ id: shown, message: 'Shown', read: false, createdAt: new Date().toISOString() }], 12, false];
    const refs = []; const messages = []; let stateIndex = 0; let refIndex = 0; let fail = true;
    const component = load('src/components/NotificationBell.tsx', {
        react: {
            useState: () => { const index = stateIndex++; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
            useRef: value => { const index = refIndex++; refs[index] ||= { current: value }; return refs[index]; },
            useEffect: () => {}, useCallback: fn => fn,
        },
        '@/components/ui/dropdown-menu': { DropdownMenu: 'menu', DropdownMenuContent: 'content', DropdownMenuItem: 'item', DropdownMenuTrigger: 'trigger' },
        '@/components/ui/button': { Button: 'button' },
        '@/hooks/use-toast': { useToast: () => ({ toast: message => messages.push(message) }) },
        '@/lib/client-request': { requestData: async (url, options) => {
            assert.equal(url, '/api/notifications'); assert.equal(options.method, 'PATCH');
            assert.deepEqual(JSON.parse(options.body), { ids: [shown] });
            if (fail) throw new Error('Network failed');
            return { unreadCount: 11 };
        } },
    }).NotificationBell;
    const render = () => { stateIndex = 0; refIndex = 0; return component(); };
    render().props.onOpenChange(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states[1], 12); assert.equal(states[0][0].read, false); assert.equal(messages.length, 1);
    fail = false;
    render().props.onOpenChange(false); render().props.onOpenChange(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states[1], 11); assert.equal(states[0][0].read, true);
});
