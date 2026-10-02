// Called by the guarded local integration runner; never seeds, resets or deletes records.
module.exports = async function verify({ db, api, base, load, tenant, manager, manager2, tech, tech2, property, property2, unit, tenantCookie, otherCookie, managerCookie, manager2Cookie, techCookie, tech2Cookie, ticket, imageUrl, legacy }) {
    const assert = require('node:assert/strict');
    const crypto = require('node:crypto');
    const actor = { role: 'MANAGER', userId: manager.id };
    const read = id => db.ticket.findUniqueOrThrow({ where: { id } });
    const create = async (title, priority = 'MEDIUM') => (await api('/api/tickets', tenantCookie, 'POST', { title, description: 'Phase 7 integration searchable maintenance issue', priority }, 201)).body;
    const op = async (id, action, cookie = managerCookie, extra = {}, expected = 200) => api('/api/tickets/' + id + '/operations', cookie, 'POST', { action, expectedVersion: (await read(id)).version, ...extra }, expected);
    const marker = 'Phase7 ' + crypto.randomUUID();
    for (let i = 0; i < 15; i++) await create(marker + ' searchable ' + i, i % 2 ? 'URGENT' : 'LOW');
    const foreign = await db.ticket.create({ data: { title: marker + ' foreign', description: marker, tenantId: (await db.user.findUniqueOrThrow({ where: { email: tenant.email.replace('.tenant@', '.other@') } })).id, propertyId: property2.id, unitId: (await db.unit.findFirstOrThrow({ where: { propertyId: property2.id } })).id } });
    for (const [cookie, field, value] of [[tenantCookie, 'tenant', tenant.id], [managerCookie, 'property', property.id]]) {
        const list = (await api('/api/tickets?q=' + encodeURIComponent(marker) + '&sort=oldest&pageSize=5', cookie)).body;
        assert.equal(list.total, 15); assert.equal(list.tickets.length, 5); assert.ok(!list.tickets.some(t => t.id === foreign.id));
        assert.ok(list.tickets.every(t => Number.isInteger(t.version)));
        if (field === 'tenant') assert.ok(list.tickets.every(t => t.tenant.id === value));
        const second = (await api('/api/tickets?q=' + encodeURIComponent(marker) + '&sort=oldest&pageSize=5&page=2', cookie)).body;
        assert.ok(second.tickets.every(t => !list.tickets.some(first => first.id === t.id)));
        assert.deepEqual((await api('/api/tickets?q=' + encodeURIComponent(marker) + '&sort=oldest&pageSize=5', cookie)).body, list);
    }
    assert.equal((await api('/api/tickets?q=' + encodeURIComponent(marker), manager2Cookie)).body.total, 1);
    assert.equal((await api('/api/tickets?q=' + encodeURIComponent(marker), techCookie)).body.total, 0);
    assert.equal((await api('/api/tickets?q=' + encodeURIComponent(marker) + '&propertyId=' + property2.id, managerCookie)).body.total, 0);
    for (const cookie of [tenantCookie, techCookie]) assert.ok((await api('/api/tickets?q=Legacy', cookie)).body.tickets.some(t => t.id === legacy.id));
    assert.equal((await api('/api/tickets?q=Legacy', managerCookie)).body.total, 0);
    const byUnit = (await api('/api/tickets?propertyId=' + property.id + '&unitId=' + unit.id + '&pageSize=50', managerCookie)).body;
    assert.ok(byUnit.total > 0); assert.ok(byUnit.tickets.every(t => t.property.id === property.id && t.unit.id === unit.id));
    for (const filter of ['status=INVALID', 'priority=INVALID', 'sort=id', 'page=0', 'pageSize=51', 'unitId=bad', 'technicianId=bad', 'q=' + 'x'.repeat(121), 'page=1&page=2']) await api('/api/tickets?' + filter, managerCookie, 'GET', undefined, 400);
    await api('/api/tickets?propertyId=' + property.id, tenantCookie, 'GET', undefined, 400);
    await api('/api/tickets?technicianId=' + tech2.id, techCookie, 'GET', undefined, 400);
    await api('/api/tickets/options', tenantCookie, 'GET', undefined, 403);
    const choices = (await api('/api/tickets/options', managerCookie)).body;
    assert.ok(!choices.properties.some(p => p.id === property2.id)); assert.ok(choices.properties.some(p => p.id === property.id));
    assert.ok(choices.technicians.every(t => Object.keys(t).sort().join(',') === 'id,name'));
    for (const q of ['Updated Property', '4B', 'Phase 7 integration', marker]) assert.ok((await api('/api/tickets?q=' + encodeURIComponent(q), managerCookie)).body.total > 0);
    const priority = (await api('/api/tickets?q=' + encodeURIComponent(marker) + '&sort=priority&pageSize=50', managerCookie)).body;
    assert.equal(priority.tickets[0].priority, 'URGENT'); assert.equal(priority.tickets.at(-1).priority, 'LOW');
    assert.equal((await api('/api/tickets?q=%25', managerCookie)).body.total, 0);
    const literal = await create(marker + ' literal %_'); assert.equal((await api('/api/tickets?q=%25_', managerCookie)).body.tickets[0].id, literal.id);
    console.log('PASS Phase 7: real scoped search/counts, structured location, literal wildcards, filters, deterministic pagination and priority sorting');

    const active = await create(marker + ' operational');
    await api('/api/tickets/' + active.id + '/status', managerCookie, 'POST', { technicianId: tech.id, expectedVersion: active.version });
    const assigned = await read(active.id);
    await op(active.id, 'reassign', manager2Cookie, { technicianId: tech2.id }, 404);
    await op(active.id, 'reassign', techCookie, { technicianId: tech2.id }, 403);
    await op(active.id, 'reassign', tenantCookie, { technicianId: tech2.id }, 403);
    await op(active.id, 'reassign', managerCookie, { technicianId: tenant.id }, 400);
    await op(active.id, 'reassign', managerCookie, { technicianId: tech.id }, 400);
    await api('/api/tickets/' + active.id + '/status', techCookie, 'PATCH', { status: 'IN_PROGRESS', expectedVersion: assigned.version });
    const beforeNotifs = await db.notification.findMany({ select: { id: true } });
    await op(active.id, 'reassign', managerCookie, { technicianId: tech2.id });
    const moved = await read(active.id); assert.equal(moved.status, 'ASSIGNED'); assert.equal(moved.assignedToId, tech2.id);
    const sent = await db.notification.findMany({ where: { id: { notIn: beforeNotifs.map(n => n.id) } } });
    assert.deepEqual(sent.map(n => n.userId).sort(), [tenant.id, tech.id, tech2.id].sort());
    assert.match((await db.activityLog.findFirstOrThrow({ where: { ticketId: active.id, action: { startsWith: 'REASSIGNED' } } })).action, /ASSIGNED/);
    await api('/api/tickets/' + active.id, techCookie, 'GET', undefined, 403);
    await api('/api/tickets/' + active.id + '/notes', techCookie, 'POST', { note: 'Revoked late note' }, 403);
    assert.equal((await api('/api/tickets?q=' + encodeURIComponent(marker) + '&technicianId=' + tech2.id, managerCookie)).body.total, 1);
    assert.equal((await api('/api/tickets?q=' + encodeURIComponent(marker), tech2Cookie)).body.total, 1);
    assert.equal((await api('/api/tickets?propertyId=' + property2.id, tech2Cookie)).body.total, 0);
    assert.equal((await api('/api/tickets?q=' + encodeURIComponent(marker) + '&priority=LOW', tech2Cookie)).body.total, 0);
    await api('/api/tickets/' + active.id + '/notes', tech2Cookie, 'POST', { note: 'Stale version', expectedVersion: moved.version - 1 }, 409);
    assert.equal((await read(active.id)).version, moved.version);
    const techChoices = (await api('/api/tickets/options', tech2Cookie)).body;
    assert.ok(techChoices.properties.every(p => p.units.length === 0)); assert.ok(!techChoices.properties.some(p => p.id === property2.id));
    await op(active.id, 'cancel', tenantCookie, {}, 400);
    await op(active.id, 'cancel', tech2Cookie, {}, 403);
    await op(active.id, 'cancel', manager2Cookie, {}, 404);
    await op(active.id, 'cancel'); assert.equal((await read(active.id)).status, 'CANCELLED');
    await api('/api/tickets/' + active.id + '/status', tech2Cookie, 'PATCH', { status: 'IN_PROGRESS' }, 409);
    await api('/api/tickets/' + active.id + '/notes', tenantCookie, 'POST', { note: 'Terminal note' }, 400);
    await op(active.id, 'reopen', managerCookie, {}, 400);
    await op(active.id, 'reassign', managerCookie, { technicianId: tech.id }, 400);
    const ownOpen = await create(marker + ' tenant cancel');
    await op(ownOpen.id, 'cancel', otherCookie, {}, 404); await op(ownOpen.id, 'cancel', tenantCookie);
    const cancelled = (await api('/api/tickets?q=' + encodeURIComponent(marker) + '&status=CANCELLED', tenantCookie)).body;
    assert.equal(cancelled.total, 2);
    console.log('PASS Phase 7: manager reassignment audit/recipients, immediate access revocation, role-specific cancellation and terminal guards');

    const priorLogs = await db.activityLog.findMany({ where: { ticketId: ticket.id } });
    await op(ticket.id, 'reopen', tenantCookie, {}, 403); await op(ticket.id, 'reopen', techCookie, {}, 403); await op(ticket.id, 'reopen', manager2Cookie, {}, 404);
    await op(ticket.id, 'reopen'); const reopened = await read(ticket.id);
    assert.equal(reopened.status, 'OPEN'); assert.equal(reopened.assignedToId, null);
    const newLogs = await db.activityLog.findMany({ where: { ticketId: ticket.id } }); assert.equal(newLogs.length, priorLogs.length + 1); assert.ok(priorLogs.every(log => newLogs.some(n => n.id === log.id)));
    assert.equal((await fetch(base + imageUrl, { headers: { cookie: tenantCookie } })).status, 200);
    assert.equal((await fetch(base + imageUrl, { headers: { cookie: manager2Cookie } })).status, 404);
    assert.equal((await fetch(base + imageUrl, { headers: { cookie: techCookie } })).status, 404);
    await api('/api/tickets/' + ticket.id + '/status', managerCookie, 'POST', { technicianId: tech2.id, expectedVersion: reopened.version });
    await op(ticket.id, 'cancel'); assert.equal((await fetch(base + imageUrl, { headers: { cookie: tech2Cookie } })).status, 200);
    console.log('PASS Phase 7: authorized reopening clears assignment, preserves all notes/images/history; cancelled attachment access stays protected');

    const failed = { create: async (userId, message, tx) => { await tx.notification.create({ data: { userId, message } }); throw Error('Phase 7 notification fault'); } };
    const failing = load('src/lib/services/TicketOperations.ts', { '../prisma': { prisma: db }, './NotificationService': { NotificationService: failed } }).TicketOperations;
    for (const [status, action] of [['ASSIGNED', 'reassign'], ['OPEN', 'cancel'], ['DONE', 'reopen']]) {
        const t = await db.ticket.create({ data: { title: marker + ' rollback ' + action, description: 'Local rollback fixture', tenantId: tenant.id, propertyId: property.id, unitId: unit.id, status, assignedToId: status === 'OPEN' ? null : tech.id } });
        const before = await Promise.all([db.activityLog.count(), db.notification.count()]);
        await assert.rejects(failing.apply(t.id, actor, { action, technicianId: tech2.id, expectedVersion: t.version }), /Phase 7 notification fault/);
        assert.deepEqual(await read(t.id), t); assert.deepEqual(await Promise.all([db.activityLog.count(), db.notification.count()]), before);
    }
    console.log('PASS Phase 7: real transaction rollback for reassignment, cancellation and reopening including ticket version');

    // Force both transactions to read the same state before either conditional write.
    async function race(status, actions) {
        const t = await db.ticket.create({ data: { title: marker + ' concurrency', description: 'Barrier-controlled local race', tenantId: tenant.id, propertyId: property.id, unitId: unit.id, status, assignedToId: tech.id } });
        let reads = 0, release; const gate = new Promise(resolve => { release = resolve; });
        const wrapped = { $transaction: callback => db.$transaction(tx => callback({ ...tx, ticket: { ...tx.ticket, findUnique: async args => { const value = await tx.ticket.findUnique(args); if (++reads === 2) release(); await gate; return value; } } }), { timeout: 10000 }) };
        const overrides = { '../prisma': { prisma: wrapped } };
        const operations = load('src/lib/services/TicketOperations.ts', overrides).TicketOperations;
        const service = load('src/lib/services/TicketService.ts', overrides).TicketService;
        const results = await Promise.allSettled(actions.map(action => action({ t, operations, service })));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.statusCode === 409).length, 1);
        assert.equal((await read(t.id)).version, 1); assert.equal(await db.activityLog.count({ where: { ticketId: t.id } }), 1);
    }
    const reassign = ({ t, operations }) => operations.apply(t.id, actor, { action: 'reassign', technicianId: tech2.id, expectedVersion: t.version });
    const cancel = ({ t, operations }) => operations.apply(t.id, actor, { action: 'cancel', expectedVersion: t.version });
    const start = ({ t, service }) => service.updateStatus(t.id, 'IN_PROGRESS', tech.id, t.version);
    await race('ASSIGNED', [reassign, reassign]);
    await race('ASSIGNED', [reassign, start]);
    await race('ASSIGNED', [cancel, start]);
    await race('IN_PROGRESS', [cancel, ({ t, service }) => service.updateStatus(t.id, 'DONE', tech.id, t.version)]);
    const reopen = ({ t, operations }) => operations.apply(t.id, actor, { action: 'reopen', expectedVersion: t.version });
    await race('DONE', [reopen, reopen]);
    console.log('PASS Phase 7: five PostgreSQL races each produce one success, one 409 and exactly one version increment/activity');
};
