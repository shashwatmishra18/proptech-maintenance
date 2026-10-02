const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
function load(file, overrides = {}, cache = new Map()) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const local = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts', overrides, cache) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts', overrides, cache) : require(name);
    new Function('require', 'module', 'exports', code)(local, mod, mod.exports); return mod.exports;
}
const query = load('src/lib/ticket-query.ts');
const ids = { manager: randomUUID(), tenant: randomUUID(), tech: randomUUID(), nextTech: randomUUID(), ticket: randomUUID(), property: randomUUID(), unit: randomUUID() };
for (const [role, scope] of [['TENANT', { tenantId: ids.tenant }], ['MANAGER', { property: { managerId: ids.tenant } }], ['TECHNICIAN', { assignedToId: ids.tenant }]]) {
    test(role + ' search always keeps its authorization scope outside search OR predicates', () => {
        const parsed = query.parseTicketQuery(new URLSearchParams('q=  sink  &status=OPEN&priority=HIGH'), role);
        const where = query.ticketWhere({ userId: ids.tenant, role }, parsed);
        for (const [key, value] of Object.entries(scope)) assert.deepEqual(where[key], value);
        assert.equal(where.status, 'OPEN'); assert.equal(where.priority, 'HIGH');
        assert.equal(where.OR.length, 4); assert.equal(where.OR[0].title.contains, 'sink');
    });
}
test('query validation rejects invalid, repeated, unbounded and unauthorized filters', () => {
    for (const params of ['status=INVALID', 'priority=INVALID', 'sort=title', 'propertyId=bad', 'unitId=bad', 'technicianId=bad', 'page=0', 'page=-1', 'page=1.5', 'page=10001', 'pageSize=51', 'pageSize=0', 'q=' + 'x'.repeat(121), 'status=OPEN&status=DONE', 'arbitrary=value']) assert.throws(() => query.parseTicketQuery(new URLSearchParams(params), 'MANAGER'));
    for (const [role, filter] of [['TENANT', 'propertyId'], ['TENANT', 'unitId'], ['TECHNICIAN', 'technicianId']]) assert.throws(() => query.parseTicketQuery(new URLSearchParams(filter + '=' + ids.property), role));
    assert.deepEqual(query.ticketQuerySchema.parse({}), { q: '', sort: 'newest', page: 1, pageSize: 12 });
});
test('query treats SQL wildcards literally and allows only deterministic ordering', () => {
    const where = query.ticketWhere({ role: 'MANAGER', userId: ids.manager }, query.ticketQuerySchema.parse({ q: "%_' OR 1=1 --" }));
    assert.equal(where.OR[0].title.contains, "\\%\\_' OR 1=1 --");
    for (const sort of ['newest', 'oldest', 'updated', 'priority']) assert.deepEqual(query.ticketOrder(sort).at(-1), { id: 'asc' });
    assert.deepEqual(query.ticketOrder('priority')[0], { priority: 'desc' });
});
test('counts and pages use identical scoped filters, bounded offset, and a repeatable-read snapshot', async () => {
    const seen = []; let isolation;
    const tx = { $queryRaw: async () => [], ticket: { count: async arg => { seen.push(arg); return 3; }, findMany: async arg => { seen.push(arg); return []; } } };
    const service = load('src/lib/services/TicketService.ts', { '../prisma': { prisma: { $transaction: async (callback, options) => { isolation = options.isolationLevel; return callback(tx); } } } }).TicketService;
    const result = await service.getAllForUser({ userId: ids.manager, role: 'MANAGER' }, query.ticketQuerySchema.parse({ q: 'sink', page: '100', pageSize: '2' }));
    assert.equal(isolation, 'RepeatableRead'); assert.deepEqual(seen[0].where, seen[1].where); assert.equal(seen[1].take, 2); assert.equal(seen[1].skip, 2);
    assert.deepEqual(result, { tickets: [], total: 3, page: 2, pageSize: 2, totalPages: 2 });
});
function fixture(status = 'ASSIGNED', failure = false) {
    let state = { ticket: { id: ids.ticket, title: 'Leak', version: 7, status, tenantId: ids.tenant, assignedToId: ids.tech, assignedTo: { name: 'Previous Tech' }, property: { managerId: ids.manager, name: 'Court' } }, logs: [], notifications: [] };
    const service = load('src/lib/services/TicketOperations.ts', { '../prisma': { prisma: { $transaction: async callback => {
        const draft = structuredClone(state);
        const tx = { $queryRaw: async () => [],
            ticket: { findUnique: async () => structuredClone(draft.ticket), updateMany: async ({ where, data }) => { assert.equal(where.version, 7); assert.equal(where.assignedToId, ids.tech); Object.assign(draft.ticket, data, { version: 8 }); return { count: 1 }; }, findUniqueOrThrow: async () => draft.ticket },
            user: { findUnique: async ({ where }) => [ids.nextTech, ids.tech].includes(where.id) ? { id: where.id, name: 'Destination Tech' } : null },
            activityLog: { create: async ({ data }) => { draft.logs.push(data); } },
            notification: { create: async ({ data }) => { draft.notifications.push(data); if (failure) throw Error('Notification fault'); } },
        };
        const result = await callback(tx); state = draft; return result;
    } } } }).TicketOperations;
    return { service, state: () => state };
}
const manager = { role: 'MANAGER', userId: ids.manager }, tenant = { role: 'TENANT', userId: ids.tenant };
const reassign = { action: 'reassign', technicianId: ids.nextTech, expectedVersion: 7 };
test('reassignment returns in-progress work to ASSIGNED with explicit history and all affected recipients', async () => {
    const f = fixture('IN_PROGRESS'); await f.service.apply(ids.ticket, manager, reassign);
    assert.equal(f.state().ticket.status, 'ASSIGNED'); assert.equal(f.state().ticket.assignedToId, ids.nextTech); assert.equal(f.state().ticket.version, 8);
    assert.match(f.state().logs[0].action, /REASSIGNED.*Previous Tech.*Destination Tech.*ASSIGNED/);
    assert.deepEqual(f.state().notifications.map(n => n.userId).sort(), [ids.tenant, ids.tech, ids.nextTech].sort());
});
test('unauthorized and stale operations cannot write or disclose foreign tickets', async () => {
    const f = fixture();
    for (const [actor, input, status] of [[{ role: 'MANAGER', userId: randomUUID() }, reassign, 404], [{ role: 'TECHNICIAN', userId: ids.tech }, reassign, 403], [tenant, reassign, 403], [manager, { ...reassign, expectedVersion: 6 }, 409]]) await assert.rejects(f.service.apply(ids.ticket, actor, input), e => e.statusCode === status);
    assert.equal(f.state().logs.length, 0);
});
test('same technician, invalid destination and terminal reassignments are rejected', async () => {
    for (const input of [{ ...reassign, technicianId: ids.tech }, { ...reassign, technicianId: randomUUID() }]) await assert.rejects(fixture().service.apply(ids.ticket, manager, input), e => e.statusCode === 400);
    for (const status of ['OPEN', 'DONE', 'CANCELLED']) await assert.rejects(fixture(status).service.apply(ids.ticket, manager, reassign), e => e.statusCode === 400);
});
test('tenant cancellation is OPEN-only; manager cancellation is active-only', async () => {
    const input = { action: 'cancel', expectedVersion: 7 };
    assert.equal((await fixture('OPEN').service.apply(ids.ticket, tenant, input)).status, 'CANCELLED');
    for (const status of ['ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']) await assert.rejects(fixture(status).service.apply(ids.ticket, tenant, input), e => e.statusCode === 400);
    for (const status of ['OPEN', 'ASSIGNED', 'IN_PROGRESS']) assert.equal((await fixture(status).service.apply(ids.ticket, manager, input)).status, 'CANCELLED');
    for (const status of ['DONE', 'CANCELLED']) await assert.rejects(fixture(status).service.apply(ids.ticket, manager, input), e => e.statusCode === 400);
});
test('reopening is manager-only, DONE-only, clears assignment and retains previous history', async () => {
    const f = fixture('DONE'), input = { action: 'reopen', expectedVersion: 7 };
    await assert.rejects(f.service.apply(ids.ticket, tenant, input), e => e.statusCode === 403);
    await f.service.apply(ids.ticket, manager, input); assert.equal(f.state().ticket.status, 'OPEN'); assert.equal(f.state().ticket.assignedToId, null); assert.match(f.state().logs[0].action, /REOPENED/);
    await assert.rejects(f.service.apply(ids.ticket, manager, input), e => e.statusCode === 409);
    await assert.rejects(fixture('CANCELLED').service.apply(ids.ticket, manager, input), e => e.statusCode === 400);
});
test('new lifecycle operations roll back state, activity and notifications together', async () => {
    for (const [status, input] of [['ASSIGNED', reassign], ['OPEN', { action: 'cancel', expectedVersion: 7 }], ['DONE', { action: 'reopen', expectedVersion: 7 }]]) {
        const f = fixture(status, true), before = structuredClone(f.state()); await assert.rejects(f.service.apply(ids.ticket, manager, input), /Notification fault/); assert.deepEqual(f.state(), before);
    }
});
test('operation input requires safe versions, UUID destinations and no ownership injection', () => {
    const { operationInput } = load('src/lib/services/TicketOperations.ts');
    for (const input of [{ action: 'cancel' }, { action: 'cancel', expectedVersion: -1 }, { action: 'reopen', expectedVersion: '7' }, { ...reassign, technicianId: 'bad' }, { ...reassign, propertyId: ids.property }]) assert.throws(() => operationInput.parse(input));
});
test('notes recheck reassigned technician access inside their write transaction', async () => {
    let writes = 0;
    const service = load('src/lib/services/TicketService.ts', { '../prisma': { prisma: { $transaction: callback => callback({ ticket: { findUnique: async () => ({ status: 'ASSIGNED', version: 2, tenantId: ids.tenant, assignedToId: ids.nextTech }), updateMany: async () => { writes++; return { count: 1 }; } } }) } } }).TicketService;
    await assert.rejects(service.addNote(ids.ticket, ids.tech, 'Late note', { userId: ids.tech, role: 'TECHNICIAN' }, 1), e => e.statusCode === 403); assert.equal(writes, 0);
});
test('URL pagination preserves active filters while clear removes the query', () => {
    const navigations = [];
    const hook = load('src/hooks/use-ticket-query.ts', { 'next/navigation': { useSearchParams: () => new URLSearchParams('q=sink&status=OPEN&page=1'), usePathname: () => '/manager/dashboard', useRouter: () => ({ push: url => navigations.push(url) }) } }).useTicketQuery;
    const state = hook(); state.change({ page: '2' }); state.change({}, true);
    assert.equal(navigations[0], '/manager/dashboard?q=sink&status=OPEN&page=2'); assert.equal(navigations[1], '/manager/dashboard');
});
