const { validateProduction } = require('./production-config.cjs');
const { accessSync, constants } = require('node:fs');
const { normalizeDatabase, prepareDatabase, initializeRailwayVolume } = require('./railway-environment.cjs');
try {
  normalizeDatabase();
  validateProduction();
  initializeRailwayVolume();
  prepareDatabase();
  accessSync(process.env.UPLOAD_ROOT, constants.R_OK | constants.W_OK);
  console.info(JSON.stringify({ event: 'startup', configuration: 'validated', storage: 'persistent' }));
  if (process.env.DEPLOYMENT_PLATFORM === 'railway') require('./railway-start.cjs').startRailway().catch(() => {
    console.error(JSON.stringify({ event: 'startup_failed', reason: 'Check Railway PORT configuration' }));
    process.exitCode = 1;
  });
  else require('../server.js');
} catch {
  console.error(JSON.stringify({ event: 'startup_failed', reason: 'Check production configuration and writable persistent upload mount' }));
  process.exitCode = 1;
}
