// LAN remote-control server.
//
// Serves the phone UI in ./remote over HTTP and relays state/commands over a
// WebSocket on the same port. The console's renderer owns all show state, so
// this process is only a relay: renderer -> snapshot -> every remote, and
// remote command -> renderer. Off by default; a PIN gates every connection.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.LX_REMOTE_PORT || 8090);
const ROOT = path.join(__dirname, 'remote');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60 * 1000;

function createRemoteServer({ configPath, onCommand, onClientsChanged }) {
  let config = { enabled: false, pin: null };
  let server = null, wss = null, bonjour = null, advert = null;
  let lastSnapshot = null;
  const tokens = new Set();
  const failures = new Map(); // ip -> { count, until }

  function loadConfig() {
    try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch (_) {}
    if (!/^\d{6}$/.test(String(config.pin || ''))) { config.pin = newPin(); saveConfig(); }
  }
  function saveConfig() { try { fs.writeFileSync(configPath, JSON.stringify(config)); } catch (_) {} }
  function newPin() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

  function addresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
    return out;
  }
  function info() {
    return { enabled: config.enabled, running: !!server, pin: config.pin, port: PORT, addresses: addresses(), clients: wss ? [...wss.clients].filter(c => c.readyState === WebSocket.OPEN && c.authed).length : 0 };
  }
  function notify() { try { onClientsChanged?.(info()); } catch (_) {} }

  function safeEqual(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  function locked(ip) { const f = failures.get(ip); return !!f && f.until > Date.now(); }
  function recordFailure(ip) {
    const f = failures.get(ip) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILURES) { f.until = Date.now() + LOCKOUT_MS; f.count = 0; }
    failures.set(ip, f);
  }

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  function handleAuth(req, res) {
    const ip = req.socket.remoteAddress || '';
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (locked(ip)) return send(429, { error: 'Too many attempts. Try again in a minute.' });
      let pin = '';
      try { pin = String(JSON.parse(body).pin || ''); } catch (_) {}
      if (!safeEqual(pin, config.pin)) { recordFailure(ip); return send(401, { error: 'Wrong PIN' }); }
      failures.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      tokens.add(token);
      send(200, { token });
    });
  }

  function start() {
    if (server) return info();
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/auth') return handleAuth(req, res);
      if (req.method === 'GET') return serveStatic(req, res);
      res.writeHead(405); res.end();
    });
    wss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
      if (!tokens.has(token)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => { ws.authed = true; ws.token = token; wss.emit('connection', ws); });
    });
    wss.on('connection', ws => {
      if (lastSnapshot) ws.send(lastSnapshot);
      ws.on('message', data => {
        let msg; try { msg = JSON.parse(String(data)); } catch (_) { return; }
        if (msg && typeof msg.type === 'string') onCommand?.(msg);
      });
      ws.on('close', notify);
      notify();
    });
    server.on('error', err => { console.error('[REMOTE] server error:', err.message); stop(); });
    server.listen(PORT, '0.0.0.0', () => console.log(`[REMOTE] listening on :${PORT}`));
    try {
      const { Bonjour } = require('bonjour-service');
      bonjour = new Bonjour();
      advert = bonjour.publish({ name: `Lighting Console (${os.hostname()})`, type: 'lxconsole', port: PORT });
    } catch (err) { console.warn('[REMOTE] Bonjour unavailable:', err.message); }
    notify();
    return info();
  }

  function stop() {
    try { advert?.stop?.(); bonjour?.destroy?.(); } catch (_) {}
    advert = bonjour = null;
    try { wss?.clients.forEach(c => c.terminate()); wss?.close(); } catch (_) {}
    try { server?.close(); } catch (_) {}
    server = wss = null;
    tokens.clear();
    notify();
    return info();
  }

  function setEnabled(enabled) {
    config.enabled = !!enabled; saveConfig();
    return config.enabled ? start() : stop();
  }
  function regeneratePin() {
    config.pin = newPin(); saveConfig();
    tokens.clear(); // drop every paired remote
    wss?.clients.forEach(c => c.terminate());
    notify();
    return info();
  }
  function broadcast(snapshot) {
    lastSnapshot = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
    if (!wss) return;
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN && c.authed && c.bufferedAmount < 1e6) c.send(lastSnapshot); });
  }

  loadConfig();
  return { start, stop, setEnabled, regeneratePin, broadcast, info, autostart: () => { if (config.enabled) start(); } };
}

module.exports = { createRemoteServer };
