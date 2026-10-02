const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function load(file, overrides = {}, cache = new Map()) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const local = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts', overrides, cache) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts', overrides, cache) : require(name);
    new Function('require', 'module', 'exports', code)(local, mod, mod.exports); return mod.exports;
}
test('one password policy enforces minimum, whitespace, confirmation and UTF-8 bcrypt limits', () => {
    const { passwordPolicy } = load('src/lib/password-policy.ts');
    const { completeInput, changeInput } = load('src/lib/services/AccountService.ts');
    for (const password of ['', 'short', ' '.repeat(12), 'a'.repeat(73), 'é'.repeat(37)]) {
        assert.throws(() => passwordPolicy.parse(password));
        assert.throws(() => completeInput.parse({ token: 'a'.repeat(64), password, confirmation: password }));
        assert.throws(() => changeInput.parse({ currentPassword: 'old', password, confirmation: password }));
    }
    for (const password of ['a'.repeat(72), 'é'.repeat(36), 'a long passphrase']) assert.equal(passwordPolicy.parse(password), password);
    assert.throws(() => completeInput.parse({ token: 'a'.repeat(64), password: 'valid-passphrase', confirmation: 'different' }));
});
test('profile, invitation, status and token inputs reject role/status/email takeover', () => {
    const { profileInput, inviteInput, statusInput, completeInput, tokenInput } = load('src/lib/services/AccountService.ts');
    for (const field of ['role', 'active', 'email', 'authVersion', 'id']) assert.throws(() => profileInput.parse({ name: 'Name', [field]: 'attacker' }));
    assert.throws(() => inviteInput.parse({ name: 'Tech', email: 'tech@example.test', role: 'MANAGER' }));
    for (const version of [-1, '0', undefined]) assert.throws(() => statusInput.parse({ active: true, expectedVersion: version }));
    assert.throws(() => tokenInput.parse('bad'));
    assert.throws(() => completeInput.parse({ token: 'a'.repeat(64), password: 'valid-passphrase', confirmation: 'valid-passphrase', email: 'other@example.test' }));
});
test('account session checks reject inactive, missing, changed-version and changed-role users; old version-zero JWTs survive migration', async () => {
    let user = { active: true, authVersion: 0, role: 'TENANT' };
    const { validateAccountSession } = load('src/lib/account-session.ts', { '@/lib/prisma': { prisma: { user: { findUnique: async () => user } } } });
    const payload = { userId: 'id', role: 'TENANT', exp: 9999999999 };
    assert.equal(await validateAccountSession(payload), payload);
    for (const value of [null, { active: false, authVersion: 0, role: 'TENANT' }, { active: true, authVersion: 1, role: 'TENANT' }, { active: true, authVersion: 0, role: 'MANAGER' }]) { user = value; assert.equal(await validateAccountSession(payload), null); }
});
test('production delivery refuses token exposure even when the development flag is set', async () => {
    const previous = { mode: process.env.NODE_ENV, flag: process.env.DEV_CREDENTIAL_LINKS };
    try {
        process.env.NODE_ENV = 'production'; process.env.DEV_CREDENTIAL_LINKS = '1';
        const { deliverCredential } = load('src/lib/credential-delivery.ts', { 'node:fs/promises': { mkdir: () => { throw Error('No production token files'); }, writeFile: () => { throw Error('No production token files'); } } });
        for (const purpose of ['INVITE', 'RESET']) assert.deepEqual(await deliverCredential({ purpose, email: 'qa@example.test', token: 'a'.repeat(64) }), { delivered: false });
    } finally { for (const [key, value] of [['NODE_ENV', previous.mode], ['DEV_CREDENTIAL_LINKS', previous.flag]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('development delivery requires explicit opt-in and keeps bearer tokens in URL fragments and private files', async () => {
    const previous = { mode: process.env.NODE_ENV, flag: process.env.DEV_CREDENTIAL_LINKS, origin: process.env.APP_ORIGIN }; let saved;
    try {
        process.env.NODE_ENV = 'development'; process.env.DEV_CREDENTIAL_LINKS = '0'; process.env.APP_ORIGIN = 'http://localhost:3106';
        const { deliverCredential } = load('src/lib/credential-delivery.ts', { 'node:fs/promises': { mkdir: async () => {}, writeFile: async (file, value, options) => { saved = { value: JSON.parse(value), options }; } } });
        assert.deepEqual(await deliverCredential({ purpose: 'RESET', email: 'qa@example.test', token: 'a'.repeat(64) }), { delivered: false });
        process.env.DEV_CREDENTIAL_LINKS = '1'; const result = await deliverCredential({ purpose: 'RESET', email: 'qa@example.test', token: 'a'.repeat(64) }); assert.ok(result.url.includes('#token=')); assert.equal(saved.options.mode, 0o600); assert.equal(new URL(result.url).search, '');
        process.env.APP_ORIGIN = 'https://attacker.example'; await assert.rejects(deliverCredential({ purpose: 'RESET', email: 'qa@example.test', token: 'a'.repeat(64) }), /must be local/);
    } finally { for (const [key, value] of [['NODE_ENV', previous.mode], ['DEV_CREDENTIAL_LINKS', previous.flag], ['APP_ORIGIN', previous.origin]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('staff lock serializes status changes and assignment without blocking foreign-key reads', async () => {
    let sql;
    const { lockStaff } = load('src/lib/staff-lock.ts'); await lockStaff({ $queryRaw: async strings => { sql = strings.join(''); } }, 'id'); assert.match(sql, /FOR NO KEY UPDATE/);
});
