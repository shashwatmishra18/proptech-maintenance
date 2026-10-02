module.exports = async function verify({ db, api, base, load, manager, manager2, tenantCookie, otherCookie, managerCookie, manager2Cookie, techCookie, property, unit, password }) {
    const assert = require('node:assert/strict'); const crypto = require('node:crypto'); const bcrypt = require('bcrypt');
    const prefix = 'phase8.' + Date.now(), events = [];
    const service = load('src/lib/services/AccountService.ts', { '../prisma': { prisma: db }, '../credential-delivery': { deliverCredential: async event => { events.push(event); return { delivered: false }; } } }).AccountService;
    const complete = (token, pass = password) => ({ token, password: pass, confirmation: pass });
    const findToken = async token => db.credentialToken.findUniqueOrThrow({ where: { tokenHash: crypto.createHash('sha256').update(token).digest('hex') } });
    const latest = purpose => events.filter(event => event.purpose === purpose).at(-1).token;
    async function invite(suffix) { const email = prefix + '.' + suffix + '@example.test'; const result = await service.invite(manager.id, { name: 'Phase8 ' + suffix, email }); return { ...result, email, token: latest('INVITE') }; }
    async function login(email, pass = password, expected = 200) { const result = await api('/api/auth/login', '', 'POST', { email, password: pass }, expected); return result.res.headers.get('set-cookie')?.split(';')[0]; }
    for (const cookie of [tenantCookie, techCookie]) { await api('/api/staff', cookie, 'GET', undefined, 403); await api('/api/staff', cookie, 'POST', { name: 'Forbidden', email: prefix + '.forbidden@example.test' }, 403); }
    const production = (await api('/api/staff', managerCookie, 'POST', { name: 'Production token check', email: prefix + '.production@example.test' }, 201)).body;
    assert.equal('url' in production, false); assert.equal('token' in production, false); assert.equal(production.delivered, false);
    const invited = await invite('technician'), record = await findToken(invited.token);
    assert.ok(!JSON.stringify(record).includes(invited.token)); assert.equal(record.email, invited.email); assert.equal(record.role, 'TECHNICIAN'); assert.equal(record.purpose, 'INVITE'); assert.equal(record.createdById, manager.id);
    await login(invited.email, password, 400);
    await api('/api/auth/invitation', '', 'PUT', { token: invited.token });
    await api('/api/auth/invitation', '', 'POST', { ...complete(invited.token), role: 'MANAGER' }, 400);
    await api('/api/auth/invitation', '', 'POST', { ...complete(invited.token), email: 'other@example.test' }, 400);
    await api('/api/auth/invitation', '', 'POST', complete(invited.token));
    await api('/api/auth/invitation', '', 'POST', complete(invited.token), 400);
    const technician = await db.user.findUniqueOrThrow({ where: { email: invited.email } }); assert.equal(technician.role, 'TECHNICIAN'); assert.equal(technician.active, true); assert.equal(technician.authVersion, 1);
    let cookie = await login(invited.email);
    await api('/api/staff', cookie, 'POST', { name: 'Forbidden', email: prefix + '.escalation@example.test' }, 403);
    const staff = (await api('/api/staff', managerCookie)).body; assert.ok(staff.technicians.some(user => user.id === technician.id)); assert.ok(!JSON.stringify(staff).includes('tokenHash')); assert.ok(!JSON.stringify(staff).includes('password'));
    assert.ok(!(await api('/api/staff', manager2Cookie)).body.technicians.some(user => user.id === technician.id));
    await api('/api/staff/' + technician.id, manager2Cookie, 'PATCH', { active: false, expectedVersion: technician.authVersion }, 404);
    for (const unauthorized of [tenantCookie, cookie]) await api('/api/staff/' + technician.id, unauthorized, 'PATCH', { active: false, expectedVersion: technician.authVersion }, 403);
    await api('/api/account', cookie, 'PATCH', { name: 'Renamed', role: 'MANAGER' }, 400);
    await api('/api/account', cookie, 'PATCH', { name: 'Renamed Technician' }); assert.equal((await api('/api/account', cookie)).body.name, 'Renamed Technician');
    const expired = await invite('expired'); await db.credentialToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } }); await api('/api/auth/invitation', '', 'POST', complete(expired.token), 400);
    const revoked = await invite('revoked'); await api('/api/staff/invitations/' + revoked.id, manager2Cookie, 'DELETE', undefined, 404); await api('/api/staff/invitations/' + revoked.id, managerCookie, 'DELETE'); await api('/api/auth/invitation', '', 'POST', complete(revoked.token), 400);
    await service.renew(manager.id, revoked.id); const renewed = latest('INVITE'); await api('/api/auth/invitation', '', 'POST', complete(renewed));
    await assert.rejects(service.invite(manager.id, { name: 'Duplicate', email: invited.email }), e => e.statusCode === 409);
    const duplicates = await Promise.allSettled([1, 2].map(() => service.invite(manager.id, { name: 'Duplicate race', email: prefix + '.duplicate@example.test' }))); assert.equal(duplicates.filter(r => r.status === 'fulfilled').length, 1); assert.equal(duplicates.filter(r => r.status === 'rejected' && r.reason.statusCode === 409).length, 1);
    const racing = await invite('accept-race'); const accepts = await Promise.allSettled([1, 2].map(() => service.complete(complete(racing.token), 'INVITE'))); assert.equal(accepts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(accepts.filter(r => r.status === 'rejected' && r.reason.statusCode === 400).length, 1);
    console.log('PASS Phase 8: role-bound hashed invitations, expiry/revocation/renewal, duplicate and consumption races, staff ownership and profile escalation guards');

    const newPassword = password + 'changed';
    await api('/api/account/password', cookie, 'POST', { currentPassword: 'wrong', password: newPassword, confirmation: newPassword }, 400);
    await api('/api/account/password', cookie, 'POST', { currentPassword: password, password: newPassword, confirmation: newPassword });
    await api('/api/account', cookie, 'GET', undefined, 401); await api('/api/tickets', cookie, 'GET', undefined, 401); await login(invited.email, password, 400); cookie = await login(invited.email, newPassword);
    const versionAfterChange = (await db.user.findUniqueOrThrow({ where: { id: technician.id } })).authVersion; assert.equal(versionAfterChange, 2);
    const knownResponse = (await api('/api/auth/forgot-password', '', 'POST', { email: invited.email })).body;
    const unknownResponse = (await api('/api/auth/forgot-password', '', 'POST', { email: prefix + '.unknown@example.test' })).body; assert.deepEqual(knownResponse, unknownResponse); assert.equal('url' in knownResponse, false);
    await service.requestReset(invited.email); const reset = latest('RESET'); const resetRecord = await findToken(reset); assert.ok(!JSON.stringify(resetRecord).includes(reset));
    await api('/api/auth/reset-password', '', 'POST', complete(reset)); await api('/api/auth/reset-password', '', 'POST', complete(reset), 400); await api('/api/account', cookie, 'GET', undefined, 401); await login(invited.email, newPassword, 400); cookie = await login(invited.email);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: technician.id } })).authVersion, versionAfterChange + 1);
    await service.requestReset(invited.email); const oldReset = latest('RESET'); await service.requestReset(invited.email); const currentReset = latest('RESET'); await api('/api/auth/reset-password', '', 'POST', complete(oldReset), 400);
    await db.credentialToken.update({ where: { id: (await findToken(currentReset)).id }, data: { expiresAt: new Date(0) } }); await api('/api/auth/reset-password', '', 'POST', complete(currentReset), 400);
    await service.requestReset(invited.email); const resetRace = latest('RESET'); const resets = await Promise.allSettled([1, 2].map(() => service.complete(complete(resetRace), 'RESET'))); assert.equal(resets.filter(r => r.status === 'fulfilled').length, 1); assert.equal(resets.filter(r => r.status === 'rejected' && r.reason.statusCode === 400).length, 1);
    cookie = await login(invited.email);
    await service.requestReset(invited.email); const conflictToken = latest('RESET'), prior = await db.user.findUniqueOrThrow({ where: { id: technician.id } });
    const competing = await Promise.allSettled([service.complete(complete(conflictToken, newPassword), 'RESET'), service.changePassword(technician.id, prior.authVersion, { currentPassword: password, password: newPassword, confirmation: newPassword })]); assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1); assert.equal(competing.filter(r => r.status === 'rejected').length, 1);
    cookie = await login(invited.email, newPassword);
    console.log('PASS Phase 8: password change/reset, generic recovery responses, hashed single-use reset tokens, expiry/replacement, JWT invalidation and change/reset race');

    const ticket = await db.ticket.create({ data: { title: 'Phase8 staff assignment', description: 'Only a new local fixture', propertyId: property.id, unitId: unit.id, tenantId: (await db.user.findUniqueOrThrow({ where: { email: prefix + '.tenant@example.test' } }).catch(async () => db.user.create({ data: { name: 'Phase8 tenant', email: prefix + '.tenant@example.test', password: await bcrypt.hash(password, 10), role: 'TENANT', unitId: unit.id } }))).id } });
    await api('/api/tickets/' + ticket.id + '/status', managerCookie, 'POST', { technicianId: technician.id });
    let current = await db.user.findUniqueOrThrow({ where: { id: technician.id } });
    await api('/api/staff/' + technician.id, managerCookie, 'PATCH', { active: false, expectedVersion: current.authVersion }, 409);
    await api('/api/tickets/' + ticket.id + '/status', cookie, 'PATCH', { status: 'IN_PROGRESS' });
    await api('/api/staff/' + technician.id, managerCookie, 'PATCH', { active: false, expectedVersion: current.authVersion }, 409);
    await api('/api/tickets/' + ticket.id + '/status', cookie, 'PATCH', { status: 'DONE' });
    await api('/api/staff/' + technician.id, managerCookie, 'PATCH', { active: false, expectedVersion: current.authVersion });
    await login(invited.email, newPassword, 400); await api('/api/tickets/' + ticket.id, cookie, 'GET', undefined, 401); await api('/api/account', cookie, 'GET', undefined, 401);
    assert.ok(!(await api('/api/users?role=TECHNICIAN', managerCookie)).body.some(t => t.id === technician.id));
    current = await db.user.findUniqueOrThrow({ where: { id: technician.id } }); await api('/api/staff/' + technician.id, managerCookie, 'PATCH', { active: true, expectedVersion: current.authVersion });
    await api('/api/account', cookie, 'GET', undefined, 401); cookie = await login(invited.email, newPassword);
    assert.equal((await api('/api/tickets/' + ticket.id, cookie)).body.status, 'DONE');
    const pending = await invite('pending'); const pendingUser = await db.user.findUniqueOrThrow({ where: { email: pending.email } }); await api('/api/staff/' + pendingUser.id, managerCookie, 'PATCH', { active: true, expectedVersion: 0 }, 409);
    const eventActions = (await db.accountEvent.findMany({ where: { userId: technician.id } })).map(e => e.action); for (const action of ['STAFF_INVITED', 'INVITE_ACCEPTED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'STAFF_DEACTIVATED', 'STAFF_REACTIVATED']) assert.ok(eventActions.includes(action));
    await api('/api/staff/' + manager.id, managerCookie, 'PATCH', { active: false, expectedVersion: 0 }, 404);
    console.log('PASS Phase 8: active-work deactivation guard, inactive login/JWT denial, reactivation, historical tickets and secret-free account audit');

    const TicketService = load('src/lib/services/TicketService.ts', { '../prisma': { prisma: db }, './prisma': { prisma: db } }).TicketService;
    const raceTicket = await db.ticket.create({ data: { title: 'Phase8 deactivation race', description: 'Local account versus assignment concurrency', tenantId: ticket.tenantId, propertyId: property.id, unitId: unit.id } });
    const ready = await db.user.findUniqueOrThrow({ where: { id: technician.id } });
    const races = await Promise.allSettled([service.status(manager.id, technician.id, { active: false, expectedVersion: ready.authVersion }), TicketService.assign(raceTicket.id, technician.id, manager.id)]);
    assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
    const afterUser = await db.user.findUniqueOrThrow({ where: { id: technician.id } }), afterTicket = await db.ticket.findUniqueOrThrow({ where: { id: raceTicket.id } }); assert.ok(afterUser.active || afterTicket.assignedToId === null);
    for (const role of ['TENANT', 'MANAGER']) {
        const user = await db.user.create({ data: { name: 'Credential role check', email: prefix + '.' + role.toLowerCase() + '.change@example.test', password: await bcrypt.hash(password, 10), role } });
        const roleCookie = await login(user.email); await api('/api/account/password', roleCookie, 'POST', { currentPassword: password, password: newPassword, confirmation: newPassword }); await api('/api/account', roleCookie, 'GET', undefined, 401); await login(user.email, password, 400); await login(user.email, newPassword);
    }
    const rollback = await invite('rollback'); const rollbackRecord = await findToken(rollback.token); const rollbackUser = await db.user.findUniqueOrThrow({ where: { email: rollback.email } });
    const failingDb = { $transaction: callback => db.$transaction(tx => callback({ ...tx, $queryRaw: tx.$queryRaw.bind(tx), accountEvent: { create: async () => { throw Error('Account audit fault'); } } })) };
    const failing = load('src/lib/services/AccountService.ts', { '../prisma': { prisma: failingDb } }).AccountService;
    await assert.rejects(failing.complete(complete(rollback.token), 'INVITE'), /Account audit fault/); assert.deepEqual(await findToken(rollback.token), rollbackRecord); assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: rollbackUser.id } }), rollbackUser);
    const session = load('src/lib/session.ts', {});
    const legacyCookie = 'session=' + await session.signToken({ userId: manager.id, role: 'MANAGER' }); await api('/api/account', legacyCookie);
    const forgedRole = 'session=' + await session.signToken({ userId: manager.id, role: 'TECHNICIAN' }); await api('/api/account', forgedRole, 'GET', undefined, 401);
    console.log('PASS Phase 8: real credential/audit rollback, legacy version-zero compatibility and database role revalidation');
    console.log('PASS Phase 8: deactivation/assignment race cannot strand work; all three roles can change password with session revocation');
};
