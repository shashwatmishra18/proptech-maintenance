const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { prepareDatabase } = require('./railway-environment.cjs');
const { validateDatabase } = require('./production-config.cjs');
try {
  prepareDatabase();
  validateDatabase();
  const result = spawnSync(process.execPath, [path.join(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch {
  console.error(JSON.stringify({ event: 'migration_failed', reason: 'Check database URL and trusted CA configuration' }));
  process.exitCode = 1;
}
