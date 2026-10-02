const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { NextRequest } = require('next/server');
function load(file, overrides = {}, cache = new Map()) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const local = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts', overrides, cache) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts', overrides, cache) : require(name);
    new Function('require', 'module', 'exports', code)(local, module, module.exports); return module.exports;
}
test('property/unit/assignment validation rejects malformed IDs, ownership fields and unsafe versions', () => {
    const { propertyInput, unitInput, assignmentInput, resourceId } = load('src/lib/services/PropertyService.ts');
    assert.throws(() => propertyInput.parse({ name: 'Home', address: 'Valid address', managerId: crypto.randomUUID() }));
    assert.throws(() => unitInput.parse({ identifier: '4B', propertyId: crypto.randomUUID() }));
    assert.equal(unitInput.parse({ identifier: ' 4b ' }).identifier, '4B');
    assert.throws(() => unitInput.parse({ identifier: '   ' }));
    assert.throws(() => resourceId.parse('bad'));
    for (const version of [-1, 0.5, '0', undefined]) assert.throws(() => assignmentInput.parse({ email: 'tenant@example.test', unitId: null, expectedVersion: version }));
    assert.equal(assignmentInput.parse({ email: 'tenant@example.test', unitId: null, expectedVersion: 0 }).expectedVersion, 0);
});
test('manager authorization rejects other owners and unmapped legacy tickets; tenant and assigned technician retain access', () => {
    const roles = load('src/lib/roles.ts');
    const userId = crypto.randomUUID(), other = crypto.randomUUID();
    const ticket = { tenantId: userId, assignedToId: userId, property: { managerId: userId } };
    for (const role of ['TENANT', 'TECHNICIAN', 'MANAGER']) {
        assert.equal(roles.authorizeTicketAccess(ticket, { userId, role }), true);
        assert.equal(roles.authorizeTicketAccess(ticket, { userId: other, role }), false);
    }
    assert.equal(roles.authorizeTicketAccess({ ...ticket, property: null }, { userId, role: 'MANAGER' }), false);
    assert.equal(roles.authorizeTicketAccess({ ...ticket, property: null }, { userId, role: 'TENANT' }), true);
});
test('manager ticket lists and every metric query carry the property owner scope', async () => {
    const managerId = crypto.randomUUID(); const queries = [];
    const prisma = { ticket: { findMany: async query => { queries.push(query.where); return []; }, count: async query => { queries.push(query.where); return 0; } } };
    prisma.$transaction = callback => callback(prisma);
    const overrides = { '../prisma': { prisma }, '@/lib/prisma': { prisma }, '@/lib/roles': { requireRole: async () => ({ role: 'MANAGER', userId: managerId }) } };
    const tickets = load('src/lib/services/TicketService.ts', overrides).TicketService;
    await tickets.getAllForUser({ userId: managerId, role: 'MANAGER' });
    const metrics = load('src/app/api/metrics/route.ts', overrides);
    assert.equal((await metrics.GET(new NextRequest('http://localhost/api/metrics'))).status, 200);
    assert.equal(queries.length, 7);
    assert.ok(queries.every(query => query.property.managerId === managerId));
});
test('unassigned tenant creation is rejected before ticket/activity/notification writes', async () => {
    let locked = false, created = false;
    const tx = { user: { findUnique: async () => ({ role: 'TENANT', unit: null }) }, ticket: { create: async () => { created = true; } } };
    const service = load('src/lib/services/TicketService.ts', { '../prisma': { prisma: { $transaction: callback => callback(tx) } }, '../attachments': { lockUploader: async () => { locked = true; }, cleanupUnattachedUploads: async () => {} } }).TicketService;
    await assert.rejects(service.create({ title: 'Repair', description: 'A maintenance issue', priority: 'MEDIUM', tenantId: crypto.randomUUID() }, []), error => error.statusCode === 409);
    assert.equal(locked, true); assert.equal(created, false);
});
