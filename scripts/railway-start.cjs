const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createGateway } = require('./railway-gateway.cjs');

async function startRailway() {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const upstreamPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(upstreamPort), HOSTNAME: '127.0.0.1' }, stdio: 'inherit' });
  const gateway = createGateway({ upstreamPort, origin: process.env.APP_ORIGIN });
  let stopping = false;
  function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    gateway.close();
    child.kill('SIGTERM');
    const timeout = setTimeout(() => { child.kill('SIGKILL'); process.exit(code); }, 25000);
    timeout.unref();
    child.once('exit', () => process.exit(code));
  }
  child.once('error', () => shutdown(1));
  child.once('exit', () => { if (!stopping) { gateway.close(); process.exitCode = 1; } });
  process.once('SIGTERM', () => shutdown());
  process.once('SIGINT', () => shutdown());
  gateway.once('error', () => shutdown(1));
  gateway.listen(port, '0.0.0.0');
  console.info(JSON.stringify({ event: 'railway_gateway_started', uid: process.getuid?.(), email: process.env.EMAIL_PROVIDER === 'disabled' ? 'disabled' : 'configured' }));
}
module.exports = { startRailway };
