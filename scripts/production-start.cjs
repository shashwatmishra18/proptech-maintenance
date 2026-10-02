const { validateProduction } = require('./production-config.cjs');
const { accessSync, constants } = require('node:fs');
try {
  validateProduction();
  accessSync(process.env.UPLOAD_ROOT, constants.R_OK | constants.W_OK);
  console.info(JSON.stringify({ event: 'startup', configuration: 'validated', storage: 'persistent' }));
  require('../server.js');
} catch {
  console.error(JSON.stringify({ event: 'startup_failed', reason: 'Check production configuration and writable persistent upload mount' }));
  process.exitCode = 1;
}
