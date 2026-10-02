const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { validateProduction } = require('./production-config.cjs');
const valid = () => ({ JWT_SECRET: randomBytes(48).toString('hex'), APP_ORIGIN: 'https://maintenance.example.com', DATABASE_URL: 'postgresql://operator:generated@database.example.com/app?sslmode=require&sslaccept=strict', EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'Maintenance <support@example.com>', RESEND_API_KEY: 'mock-provider-boundary-only', STORAGE_BACKEND: 'persistent', UPLOAD_ROOT: process.platform === 'win32' ? 'C:/private/uploads' : '/private/uploads' });
test('production startup rejects missing secrets and dev configuration without revealing values', () => {
  assert.equal(validateProduction(valid()), true);
  for (const key of ['JWT_SECRET', 'APP_ORIGIN', 'DATABASE_URL', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'RESEND_API_KEY', 'STORAGE_BACKEND', 'UPLOAD_ROOT']) {
    const env = valid(); delete env[key]; assert.throws(() => validateProduction(env));
  }
  for (const override of [{ DEV_CREDENTIAL_LINKS: '1' }, { APP_ORIGIN: 'http://localhost:3000' }, { APP_ORIGIN: 'https://evil.example/path' }, { APP_ORIGIN: 'https://user:password@example.com' }, { DATABASE_URL: 'postgresql://operator:PRIVATE_PASSWORD@db/app' }, { UPLOAD_ROOT: 'relative/uploads' }]) {
    assert.throws(() => validateProduction({ ...valid(), ...override }), error => !error.message.includes('PRIVATE_PASSWORD'));
  }
});
test('bootstrap validates shared password policy and never overwrites an existing account', async () => {
  require('ts-node').register({ transpileOnly: true, project: 'tsconfig.seed.json' });
  const { bootstrapManager, bootstrapSchema } = require('../prisma/bootstrap-manager.ts');
  assert.equal(bootstrapSchema.safeParse({ name: 'Manager', email: 'manager@example.test', password: 'short' }).success, false);
  assert.equal(bootstrapSchema.safeParse({ name: 'Manager', email: 'manager@example.test', password: 'a'.repeat(73) }).success, false);
  let writes = 0;
  const db = { user: { findUnique: async () => ({ id: 'existing' }), create: async () => { writes++; } } };
  await assert.rejects(bootstrapManager(db, { name: 'Manager', email: 'manager@example.test', password: randomBytes(24).toString('hex') }), /already exists/);
  assert.equal(writes, 0);
  db.user.findUnique = async () => null;
  db.user.create = async ({ data, select }) => { assert.equal(data.role, 'MANAGER'); assert.match(data.password, /^\$2[aby]\$12\$/); assert.deepEqual(select, { id: true }); return { id: 'new-manager' }; };
  assert.deepEqual(await bootstrapManager(db, { name: 'Manager', email: 'manager@example.test', password: randomBytes(24).toString('hex') }), { id: 'new-manager' });
});
test('production edge enforces shared IP limits and no direct private file locations', () => {
  const edge = fs.readFileSync('deploy/nginx.conf', 'utf8');
  assert.match(edge, /limit_req_status 429/); assert.match(edge, /client_max_body_size 26m/);
  assert.match(edge, /frame-ancestors 'none'/); assert.match(edge, /Strict-Transport-Security/);
  assert.ok(!edge.includes('root ')); assert.match(edge, /uploads.*storage/);
  const proxy = fs.readFileSync('deploy/proxy-common.conf', 'utf8');
  assert.match(proxy, /X-Forwarded-For \$remote_addr/); assert.ok(!proxy.includes('$proxy_add_x_forwarded_for'));
});

test('private persistent adapter survives reconstruction and refuses overwrite/traversal/oversize', async () => {
  require('ts-node').register({ transpileOnly: true, project: 'tsconfig.seed.json' });
  const path = require('node:path');
  const { privateFileStorage } = require('../src/lib/attachment-storage.ts');
  const root = path.resolve('storage/phase10/adapter-' + randomBytes(8).toString('hex'));
  const key = randomBytes(24).toString('hex') + '.png';
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await privateFileStorage(root).write(key, bytes);
  assert.deepEqual(await privateFileStorage(root).read(key), bytes);
  await assert.rejects(privateFileStorage(root).write(key, bytes), error => error.code === 'EEXIST');
  for (const key of ['../secret', '/secret', 'name..png']) await assert.rejects(privateFileStorage(root).read(key));
  await assert.rejects(privateFileStorage(root).write('large.png', Buffer.alloc(5 * 1024 * 1024 + 1)));
  await assert.rejects(privateFileStorage(root).write('empty.png', Buffer.alloc(0)));
  // Retain this isolated QA file; no cleanup can delete existing application data.
});
