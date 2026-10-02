const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { prepareDatabase } = require('./railway-environment.cjs');
const { validateDatabase } = require('./production-config.cjs');
try {
  if (process.argv.slice(2).join(' ') !== '--confirm-bootstrap') throw Error();
  prepareDatabase();
  validateDatabase();
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist-ops/prisma/bootstrap-manager.js'), '--confirm-bootstrap'], { env: process.env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch {
  console.error('Explicit --confirm-bootstrap, valid database URL and trusted CA required. Supply private JSON through standard input.');
  process.exitCode = 1;
}
