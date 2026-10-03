const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), crypto = require('node:crypto');
function load(file, overrides = {}, cache = new Map()) {
  file = path.resolve(file); if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const local = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts', overrides, cache) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts', overrides, cache) : require(name);
  new Function('require', 'module', 'exports', code)(local, mod, mod.exports); return mod.exports;
}
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => v && typeof v === 'object' ? ('not' in v ? row[k] !== v.not : 'gt' in v ? row[k] > v.gt : 'in' in v ? v.in.includes(row[k]) : false) : row[k] === v);
}
function fixture() {
  const users = [], tokens = [], events = []; let tail = Promise.resolve();
  const select = (row, fields) => row && Object.fromEntries(Object.keys(fields).filter(k => fields[k] === true).map(k => [k, row[k]]));
  const db = {
    $queryRaw: async () => [],
    $transaction: callback => { const run = tail.then(() => callback(db)); tail = run.catch(() => {}); return run; },
    user: {
      findUnique: async ({ where }) => users.find(x => matches(x, where)) || null,
      findUniqueOrThrow: async ({ where }) => { const user = users.find(x => matches(x, where)); assert.ok(user); return { ...user }; },
      create: async ({ data }) => { if (users.some(x => x.email === data.email)) throw Object.assign(new Error('Duplicate'), { code: 'P2002' }); const user = { id: crypto.randomUUID(), authVersion: 0, ...data }; users.push(user); return user; },
      update: async ({ where, data }) => { const user = users.find(x => matches(x, where)); for (const [key, value] of Object.entries(data)) user[key] = value && typeof value === 'object' && 'increment' in value ? user[key] + value.increment : value; return user; },
      findMany: async ({ where, select: fields }) => users.filter(x => matches(x, where)).map(x => ({ ...select(x, fields), credentialTokens: tokens.filter(t => t.userId === x.id && t.purpose === 'INVITE' && t.usedAt).map(t => ({ id: t.id })) })),
    },
    credentialToken: {
      create: async ({ data, select: fields }) => { const record = { id: crypto.randomUUID(), usedAt: null, revokedAt: null, createdAt: new Date(), ...data }; tokens.push(record); return fields ? select(record, fields) : record; },
      findFirst: async ({ where }) => tokens.find(x => matches(x, where)) || null,
      findUnique: async ({ where, include }) => { const record = tokens.find(x => matches(x, where)); return record ? { ...record, ...(include?.user ? { user: users.find(x => x.id === record.userId) } : {}) } : null; },
      findMany: async ({ where, select: fields }) => tokens.filter(x => matches(x, where)).map(x => select(x, fields)),
      updateMany: async ({ where, data }) => { const records = tokens.filter(x => matches(x, where)); for (const record of records) Object.assign(record, data); return { count: records.length }; },
    },
    accountEvent: { create: async ({ data }) => { events.push(data); return data; } },
  };
  const overrides = { '../prisma': { prisma: db }, '@/lib/roles': { requireRole: async (req, roles) => { assert.deepEqual(roles, ['MANAGER']); return !req.actor ? new Response('{}', { status: 401 }) : req.actor.role !== 'MANAGER' ? new Response('{}', { status: 403 }) : req.actor; } } };
  const cache = new Map(); const service = load('src/lib/services/AccountService.ts', overrides, cache).AccountService;
  const staff = load('src/app/api/staff/route.ts', overrides, cache);
  const renew = load('src/app/api/staff/invitations/[id]/route.ts', overrides, cache);
  return { db, users, tokens, events, service, staff, renew };
}
async function production(callback) {
  const previous = { NODE_ENV: process.env.NODE_ENV, APP_ORIGIN: process.env.APP_ORIGIN, EMAIL_PROVIDER: process.env.EMAIL_PROVIDER, DEV_CREDENTIAL_LINKS: process.env.DEV_CREDENTIAL_LINKS };
  Object.assign(process.env, { NODE_ENV: 'production', APP_ORIGIN: 'https://fixnest.example.test', EMAIL_PROVIDER: 'disabled', DEV_CREDENTIAL_LINKS: '0' });
  try { await callback(); } finally { for (const [k, v] of Object.entries(previous)) v === undefined ? delete process.env[k] : process.env[k] = v; }
}
const manager = { userId: crypto.randomUUID(), role: 'MANAGER' };
const otherManager = { userId: crypto.randomUUID(), role: 'MANAGER' };
const input = { name: 'Invited Technician', email: 'invited@example.test' };
const completion = token => ({ token, password: 'private-test-passphrase', confirmation: 'private-test-passphrase' });
const raw = result => new URLSearchParams(new URL(result.url).hash.slice(1)).get('token');

test('production fallback appears only in authorized manager mutation responses, never staff lists', () => production(async () => {
  const f = fixture();
  for (const actor of [undefined, { userId: 'tenant', role: 'TENANT' }, { userId: 'tech', role: 'TECHNICIAN' }]) {
    const response = await f.staff.POST({ actor, json: async () => input }); assert.equal(response.status, actor ? 403 : 401); assert.equal(f.tokens.length, 0); assert.ok(!(await response.text()).includes('token='));
  }
  const response = await f.staff.POST({ actor: manager, json: async () => input }); assert.equal(response.status, 201);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const invite = (await response.json()).data; const token = raw(invite);
  assert.equal(invite.delivery, 'unconfigured'); assert.equal(invite.delivered, false); assert.match(token, /^[a-f0-9]{64}$/);
  const row = f.tokens[0]; assert.equal(row.tokenHash, crypto.createHash('sha256').update(token).digest('hex')); assert.equal(row.email, input.email); assert.equal(row.role, 'TECHNICIAN'); assert.equal(row.createdById, manager.userId); assert.ok(!JSON.stringify(row).includes(token));
  for (const actor of [manager, otherManager]) { const listing = await f.staff.GET({ actor }); const text = await listing.text(); assert.ok(!text.includes(token)); assert.ok(!text.includes('tokenHash')); assert.ok(!text.includes('password')); assert.ok(!text.includes('token=')); }
  const denied = await f.renew.POST({ actor: otherManager }, { params: Promise.resolve({ id: invite.id }) }); assert.equal(denied.status, 404); assert.ok(!(await denied.text()).includes('token='));
}));

test('invitation acceptance is single-use, email/role-bound and activates the existing account', () => production(async () => {
  const f = fixture(); const invite = await f.service.invite(manager.userId, input); const token = raw(invite);
  assert.deepEqual(await f.service.context(token, 'INVITE'), { name: input.name, email: input.email, role: 'TECHNICIAN' });
  for (const change of [{ role: 'MANAGER' }, { email: 'different@example.test' }]) { const user = f.users[0]; const before = { ...user }; Object.assign(user, change); await assert.rejects(f.service.complete(completion(token), 'INVITE'), e => e.statusCode === 400); Object.assign(user, before); }
  const id = f.users[0].id; assert.equal(f.users[0].active, false);
  const results = await Promise.allSettled([f.service.complete(completion(token), 'INVITE'), f.service.complete(completion(token), 'INVITE')]); assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.users.length, 1); assert.equal(f.users[0].id, id); assert.equal(f.users[0].role, 'TECHNICIAN'); assert.equal(f.users[0].active, true); assert.equal(f.users[0].authVersion, 1); assert.ok(f.tokens[0].usedAt);
  await assert.rejects(f.service.context(token, 'INVITE'), e => e.statusCode === 400);
  await assert.rejects(f.service.invite(manager.userId, input), e => e.statusCode === 409);
}));

test('expired and revoked invitations fail; renewal invalidates old links without duplicate accounts', () => production(async () => {
  const f = fixture(); const first = await f.service.invite(manager.userId, input); const token = raw(first);
  assert.ok(f.tokens[0].expiresAt > new Date()); f.tokens[0].expiresAt = new Date(0);
  await assert.rejects(f.service.complete(completion(token), 'INVITE'), e => e.statusCode === 400);
  const renewed = await f.service.renew(manager.userId, first.id); const newToken = raw(renewed); assert.notEqual(newToken, token); assert.equal(f.users.length, 1);
  await assert.rejects(f.service.revoke(otherManager.userId, renewed.id), e => e.statusCode === 404);
  await f.service.revoke(manager.userId, renewed.id);
  await assert.rejects(f.service.context(newToken, 'INVITE'), e => e.statusCode === 400);
  await assert.rejects(f.service.complete(completion(newToken), 'INVITE'), e => e.statusCode === 400);
  const again = await f.service.renew(manager.userId, renewed.id); await f.service.complete(completion(raw(again)), 'INVITE'); assert.equal(f.users.length, 1);
}));

test('production logs and generic recovery never reveal tokens, even on provider failure', () => production(async () => {
  const logs = []; const oldInfo = console.info; console.info = (...args) => logs.push(args.join(' '));
  try {
    const token = crypto.randomBytes(32).toString('hex'); const { deliverManagerInvitation } = load('src/lib/invitation-delivery.ts');
    const result = await deliverManagerInvitation(input.email, token); assert.equal(raw(result), token); assert.ok(!logs.join('').includes(token)); assert.ok(!logs.join('').includes('token='));
    const { deliverCredential } = load('src/lib/credential-delivery.ts');
    for (const purpose of ['INVITE', 'RESET']) { const publicResult = await deliverCredential({ purpose, email: input.email, token }, { send: async () => { throw new Error(token); } }); assert.equal('url' in publicResult, false); }
    assert.ok(!logs.join('').includes(token));
    const f = fixture(); assert.deepEqual(await f.service.requestReset(input.email), await f.service.requestReset('unknown@example.test'));
  } finally { console.info = oldInfo; }
}));

test('fallback validates trusted origin and accepted email does not also disclose a link', () => production(async () => {
  const token = 'a'.repeat(64);
  const { deliverManagerInvitation } = load('src/lib/invitation-delivery.ts', { './credential-delivery': { deliverCredential: async () => ({ delivered: false, delivery: 'failed' }) } });
  assert.equal(raw(await deliverManagerInvitation(input.email, token)), token);
  for (const origin of ['http://fixnest.example.test', 'https://user:pass@fixnest.example.test', 'https://fixnest.example.test/other', 'https://fixnest.example.test/?secret=value', 'https://localhost']) { process.env.APP_ORIGIN = origin; assert.equal('url' in await deliverManagerInvitation(input.email, token), false); }
  process.env.APP_ORIGIN = 'https://fixnest.example.test';
  const accepted = load('src/lib/invitation-delivery.ts', { './credential-delivery': { deliverCredential: async () => ({ delivered: true, delivery: 'accepted' }) } });
  assert.deepEqual(await accepted.deliverManagerInvitation(input.email, token), { delivered: true, delivery: 'accepted' });
}));

test('Staff exposes the exact fallback warning, copy/hide controls and revoke for unused expired invitations', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const url = 'https://fixnest.example.test/accept-invitation#token=' + 'a'.repeat(64);
  let copied, lastAction; const states = ['', '']; let index = 0; const requests = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  try {
    const Component = load('src/components/StaffManagement.tsx', {
      react: { ...require('react'), useState: () => { const slot = index++; return [states[slot], value => { states[slot] = value; }]; } },
      '@/hooks/use-resource': { useResource: () => ({ loading: false, data: { technicians: [], invitations: [{ id: 'invite', email: input.email, expiresAt: '1970-01-01', usedAt: null, revokedAt: null }] }, reload: async () => {} }) },
      '@/hooks/use-mutation': { useMutation: () => ({ pending: false, run: action => { lastAction = action(); return lastAction; } }) },
      '@/lib/client-request': { requestData: async (route, options) => { requests.push({ route, options }); return { url, delivery: 'unconfigured' }; } },
      './RequestState': { LoadingState: 'loading', ErrorState: 'error' }, './ui/button': { Button: 'button' }, './ui/input': { Input: 'input' }, './ui/label': { Label: 'label' },
    }).StaffManagement;
    const nodes = element => !element || typeof element !== 'object' ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
    const text = element => element == null || typeof element === 'boolean' ? '' : typeof element !== 'object' ? String(element) : [element.props?.children].flat(Infinity).map(text).join(' ');
    const render = () => { index = 0; return Component(); };
    const button = (tree, label) => nodes(tree).find(x => x.type === 'button' && text(x) === label);
    let tree = render(); assert.ok(button(tree, 'Revoke invitation')); assert.ok(!nodes(tree).some(x => x.props?.id === 'invitation-link'));
    button(tree, 'Renew invitation').props.onClick(); await lastAction; tree = render();
    assert.match(text(tree), /Email delivery is not configured\. Copy this secure invitation link and send it privately to the technician\./);
    assert.equal(nodes(tree).find(x => x.props?.id === 'invitation-link').props.value, url);
    button(tree, 'Copy invitation link').props.onClick(); await lastAction; assert.equal(copied, url);
    button(render(), 'Hide invitation link').props.onClick(); assert.ok(!nodes(render()).some(x => x.props?.id === 'invitation-link'));
    button(render(), 'Renew invitation').props.onClick(); await lastAction;
    button(render(), 'Revoke invitation').props.onClick(); await lastAction; assert.ok(!nodes(render()).some(x => x.props?.id === 'invitation-link')); assert.equal(requests.at(-1).options.method, 'DELETE');
  } finally { previous ? Object.defineProperty(globalThis, 'navigator', previous) : delete globalThis.navigator; }
});
