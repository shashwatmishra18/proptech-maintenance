const http = require('node:http');
const net = require('node:net');
const { createHash } = require('node:crypto');

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
};
const hopHeaders = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer']);

// Intentionally single-process protection: Railway volume deployments use one
// replica. Global budgets remain effective even if a client identity is missing.
function createLimiter(now = Date.now) {
  const buckets = new Map();
  function consume(key, rate, capacity) {
    const time = now();
    if (buckets.size >= 10000 && !buckets.has(key)) return 60;
    const bucket = buckets.get(key) || { tokens: capacity, time };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.time) * rate / 60000);
    bucket.time = time;
    if (bucket.tokens < 1) { buckets.set(key, bucket); return Math.ceil((1 - bucket.tokens) * 60 / rate); }
    bucket.tokens--;
    buckets.set(key, bucket);
    return 0;
  }
  return {
    check(category, identity) {
      const time = now();
      for (const [key, bucket] of buckets) if (time - bucket.time > 600000) buckets.delete(key);
      const global = consume('global:' + category, category === 'upload' ? 30 : 300, category === 'upload' ? 20 : 100);
      if (global) return global;
      const key = createHash('sha256').update(identity).digest('hex');
      return consume(category + ':' + key, category === 'upload' ? 10 : 30, category === 'upload' ? 10 : 20);
    },
  };
}

function createGateway({ upstreamPort, origin, limiter = createLimiter() }) {
  const publicOrigin = new URL(origin);
  let activeUploads = 0;
  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    function reject(status, message, retry) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Connection', 'close');
      if (retry) res.setHeader('Retry-After', String(retry));
      res.statusCode = status;
      res.end(JSON.stringify({ success: false, error: message }));
      req.resume();
    }
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) { reject(400, 'Invalid request path'); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, publicOrigin).pathname).replace(/\/{2,}/g, '/').replace(/\/$/, ''); }
    catch { reject(400, 'Invalid request path'); return; }
    const health = pathname === '/api/health' && req.method === 'GET';
    if (!health && req.headers.host?.toLowerCase() !== publicOrigin.host.toLowerCase()) { reject(403, 'Invalid request host'); return; }
    if (req.headers.origin && req.headers.origin !== publicOrigin.origin) { reject(403, 'Invalid request origin'); return; }
    if (/^\/(?:uploads|storage|prisma|scripts|dist-ops)(?:\/|$)/.test(pathname) || /^\/\.env(?:\.|$)/.test(pathname) || pathname === '/_next/image') { reject(404, 'Not found'); return; }
    const category = pathname === '/api/upload' ? 'upload' : /^\/api\/auth\/(?:login|register|forgot-password|reset-password|invitation)$/.test(pathname) ? 'credential' : null;
    if (category) {
      // Railway's HTTPS ingress supplies X-Real-IP. Never use client-supplied
      // X-Forwarded-For. Private service access must stay within this project.
      const ip = typeof req.headers['x-real-ip'] === 'string' && net.isIP(req.headers['x-real-ip']) ? req.headers['x-real-ip'] : req.socket.remoteAddress || 'unknown';
      const retry = limiter.check(category, ip);
      if (retry) { reject(429, 'Too many requests. Try again shortly.', retry); return; }
    }
    const upload = pathname === '/api/upload' && req.method === 'POST';
    const limit = upload ? 26 * 1024 * 1024 : 64 * 1024;
    if (Number(req.headers['content-length'] || 0) > limit) { reject(413, 'Request body too large'); return; }
    if (upload && activeUploads >= 2) { reject(429, 'Upload capacity busy. Try again shortly.', 5); return; }
    if (upload) {
      activeUploads++;
      let released = false;
      const release = () => { if (!released) { released = true; activeUploads--; } };
      res.once('finish', release);
      res.once('close', release);
    }
    try {
      const chunks = [];
      let size = 0;
      let oversized = false;
      // Count streamed bytes as well as Content-Length before forwarding. At
      // most two bounded upload bodies are buffered concurrently.
      await new Promise((resolve, rejectBody) => {
        req.on('data', chunk => {
          size += chunk.length;
          if (size > limit) { oversized = true; chunks.length = 0; resolve(); }
          else if (!oversized) chunks.push(chunk);
        });
        req.on('end', resolve);
        req.on('aborted', () => rejectBody(Error('Aborted')));
        req.on('error', rejectBody);
      });
      if (oversized) { reject(413, 'Request body too large'); return; }
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) if (!hopHeaders.has(name) && name !== 'x-middleware-subrequest') headers[name] = value;
      headers.host = publicOrigin.host;
      headers['x-forwarded-host'] = publicOrigin.host;
      headers['x-forwarded-proto'] = 'https';
      delete headers['x-forwarded-for'];
      delete headers['x-real-ip'];
      headers['content-length'] = String(size);
      const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers }, response => {
        res.statusCode = response.statusCode || 502;
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined && !hopHeaders.has(name) && !Object.keys(securityHeaders).some(key => key.toLowerCase() === name)) res.setHeader(name, value);
        if (pathname.startsWith('/api/') || /^\/(?:account|manager|tech|dashboard|tickets|notifications)(?:\/|$)/.test(pathname)) res.setHeader('Cache-Control', 'private, no-store');
        response.pipe(res);
        response.on('error', () => res.destroy());
      });
      upstream.setTimeout(60000, () => upstream.destroy(Error('Upstream timeout')));
      upstream.on('error', () => { if (!res.headersSent) reject(503, 'Service unavailable'); else res.destroy(); });
      res.on('close', () => upstream.destroy());
      upstream.end(Buffer.concat(chunks, size));
    } catch { if (!res.headersSent) reject(400, 'Invalid request body'); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 100;
  return server;
}
module.exports = { createGateway, createLimiter, securityHeaders };
