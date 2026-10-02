const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');

async function check(secret, checks) {
    const env = { ...process.env, PORT: '3102', HOSTNAME: '127.0.0.1', DATABASE_URL: 'postgresql://USER:PASSWORD@localhost:5432/DATABASE' };
    if (secret) env.JWT_SECRET = secret;
    else delete env.JWT_SECRET;
    const server = spawn(process.execPath, ['.next/standalone/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(server, 'close');
    let logs = '';
    server.stdout.on('data', chunk => { logs += chunk; });
    server.stderr.on('data', chunk => { logs += chunk; });
    try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            if (server.exitCode !== null) throw new Error('Standalone server exited before startup');
            try { await fetch('http://127.0.0.1:3102/login'); ready = true; break; } catch {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        assert.ok(ready, 'Standalone server started');
        for (const [url, expected, options] of checks) {
            const res = await fetch('http://127.0.0.1:3102' + url, options);
            assert.equal(res.status, expected, url);
            if (url === '/login') {
                const html = await res.text();
                const asset = html.match(/href="([^" ]+\/_next\/static\/[^" ]+\.css)"/) || html.match(/href="(\/_next\/static\/[^" ]+\.css)"/);
                assert.ok(asset, 'Login stylesheet referenced');
                assert.equal((await fetch('http://127.0.0.1:3102' + asset[1])).status, 200);
            }
        }
    } catch (error) {
        console.error(logs);
        throw error;
    } finally {
        server.kill();
        await closed;
    }
}

(async () => {
    assert.ok(!fs.existsSync('.next/standalone/.env'), 'Standalone has no .env');
    fs.cpSync('public', '.next/standalone/public', { recursive: true });
    fs.cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
    const image = fs.readdirSync('public/uploads').find(name => path.extname(name) === '.jpg');
    await check(randomBytes(48).toString('hex'), [
        ['/login', 200],
        ['/api/users?role=TECHNICIAN', 401],
        ['/api/attachments/missing', 401],
        ['/uploads/' + image, 404],
        ['/uploads/' + image, 404, { headers: { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' } }],
        ['/api/auth/register', 400, { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }],
    ]);
    await check(undefined, [['/api/users?role=TECHNICIAN', 503]]);
    console.log('Standalone startup, static assets, security boundaries and missing-secret checks passed; no database queries executed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
