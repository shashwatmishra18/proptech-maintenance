const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');

function normalizeDatabase(env = process.env) {
  if (env.DEPLOYMENT_PLATFORM !== 'railway') return;
  const url = new URL(env.DATABASE_URL);
  for (const [key, value] of Object.entries({ sslmode: 'require', sslaccept: 'strict', connection_limit: '5', pool_timeout: '10' })) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  env.DATABASE_URL = url.toString();
}

function prepareDatabase(env = process.env) {
  normalizeDatabase(env);
  if (!env.DATABASE_CA_CERT) return;
  if (env.DATABASE_CA_CERT.length > 16384 || env.DATABASE_CA_CERT.includes('PRIVATE KEY')) throw Error('Invalid database CA certificate');
  const certificate = new X509Certificate(env.DATABASE_CA_CERT);
  if (Date.parse(certificate.validTo) <= Date.now()) throw Error('Expired database CA certificate');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proptech-db-ca-'));
  fs.chmodSync(directory, 0o700);
  const filename = path.join(directory, 'ca.pem');
  fs.writeFileSync(filename, certificate.toString(), { mode: 0o600, flag: 'wx' });
  const url = new URL(env.DATABASE_URL);
  url.searchParams.set('sslcert', filename);
  env.DATABASE_URL = url.toString();
}

// Railway mounts volumes as root. Initialize only the fixed private directories,
// then irreversibly drop privileges before opening any HTTP listener.
function initializeRailwayVolume(env = process.env) {
  if (env.DEPLOYMENT_PLATFORM !== 'railway') return;
  if (env.UPLOAD_ROOT !== '/app/storage/uploads' || env.LEGACY_UPLOAD_ROOT !== '/app/storage/legacy' || env.RAILWAY_VOLUME_MOUNT_PATH !== '/app/storage') throw Error('Railway storage mount must be /app/storage');
  if (process.getuid?.() === 0) {
    for (const directory of ['/app/storage', '/app/storage/uploads', '/app/storage/legacy']) {
      fs.mkdirSync(directory, { recursive: true });
      const info = fs.lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Invalid volume directory');
      fs.chownSync(directory, 1001, 1001);
    }
    process.setgroups([]);
    process.setgid(1001);
    process.setuid(1001);
  }
  if (process.getuid?.() !== 1001) throw Error('Railway application must run as UID 1001');
}
module.exports = { normalizeDatabase, prepareDatabase, initializeRailwayVolume };
