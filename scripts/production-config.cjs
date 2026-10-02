const { isAbsolute } = require('node:path');

function validateDatabase(env = process.env) {
  const db = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.password || db.pathname === '/' || db.searchParams.get('sslmode') !== 'require' || db.searchParams.get('sslaccept') !== 'strict') throw Error('DATABASE_URL (TLS required)');
}

function validateProduction(env = process.env) {
  const failures = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.trim().length < 32 || /^(change|example|your|test)/i.test(env.JWT_SECRET)) failures.push('JWT_SECRET');
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash || ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(origin.hostname)) throw Error();
  } catch { failures.push('APP_ORIGIN'); }
  try {
    validateDatabase(env);
  } catch { failures.push('DATABASE_URL (TLS required)'); }
  const explicitlyDisabled = env.DEPLOYMENT_PLATFORM === 'railway' && env.EMAIL_PROVIDER === 'disabled';
  if (!explicitlyDisabled && (env.EMAIL_PROVIDER !== 'resend' || !env.RESEND_API_KEY || !env.EMAIL_FROM)) failures.push('Resend configuration');
  if (env.STORAGE_BACKEND !== 'persistent' || !env.UPLOAD_ROOT || !isAbsolute(env.UPLOAD_ROOT)) failures.push('persistent UPLOAD_ROOT');
  if (env.DEV_CREDENTIAL_LINKS === '1') failures.push('DEV_CREDENTIAL_LINKS must be disabled');
  if (failures.length) throw Error('Invalid production configuration: ' + failures.join(', '));
  return true;
}
module.exports = { validateProduction, validateDatabase };
if (require.main === module) {
  try { validateProduction(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
