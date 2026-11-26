'use strict';

// OS2L (Open Sound to Light): DJ software (VirtualDJ, and bridges for
// rekordbox) sends lighting software the beat straight from the playing
// track's beat grid. It finds us over Bonjour (_os2l._tcp), connects to this
// TCP port and sends JSON messages, back to back:
//   {"evt":"beat","change":false,"pos":42,"bpm":124.0,"strength":0.8}
//   {"evt":"btn","name":"Party","page":"Light Spark","state":"on"}
//   {"evt":"cmd","id":3,"param":0.5}
// Each one goes to the page (js/sound-light.js) as it arrives.
const net = require('net');
const os = require('os');

function createOs2lLink({ onMessage, onStatus }) {
  let server = null, bonjour = null, advert = null, port = 0;
  const clients = new Set();
  const status = () => ({ running: Boolean(server), port, clients: clients.size });
  const notify = () => { try { onStatus?.(status()); } catch (_) {} };

  // Split a TCP stream into whole JSON objects (they aren't separated by anything).
  function reader(socket) {
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buf += chunk;
      if (buf.length > 1e6) buf = '';
      for (;;) {
        const start = buf.indexOf('{');
        if (start < 0) { buf = ''; return; }
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = start; i < buf.length; i++) {
          const c = buf[i];
          if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
          if (c === '"') inStr = true;
          else if (c === '{') depth++;
          else if (c === '}' && --depth === 0) { end = i; break; }
        }
        if (end < 0) { buf = buf.slice(start); return; }
        const text = buf.slice(start, end + 1);
        buf = buf.slice(end + 1);
        try { const msg = JSON.parse(text); if (msg && typeof msg.evt === 'string') onMessage?.(msg); } catch (_) {}
      }
    });
  }

  function start() {
    if (server) return Promise.resolve(status());
    return new Promise(resolve => {
      server = net.createServer(socket => {
        clients.add(socket);
        socket.setNoDelay(true);
        reader(socket);
        socket.on('close', () => { clients.delete(socket); notify(); });
        socket.on('error', () => {});
        notify();
      });
      // A fixed port when free (easy to type into a bridge by hand), else any.
      let tried = 0;
      server.on('error', err => {
        if (err.code === 'EADDRINUSE' && !tried++) return listen(0);
        console.error('[OS2L] server error:', err.message); stop(); resolve(status());
      });
      const listen = p => server.listen(p, '0.0.0.0', () => {
        port = server.address().port;
        console.log(`[OS2L] listening on :${port}`);
        try {
          const { Bonjour } = require('bonjour-service');
          let lastWarn = 0;
          bonjour = new Bonjour({}, err => { if (Date.now() - lastWarn > 60000) { lastWarn = Date.now(); console.warn('[OS2L] Bonjour:', err?.code || err?.message || err); } });
          advert = bonjour.publish({ name: `Light Spark (${os.hostname()})`, type: 'os2l', protocol: 'tcp', port });
        } catch (err) { console.warn('[OS2L] Bonjour unavailable:', err.message); }
        notify();
        resolve(status());
      });
      listen(9996);
    });
  }

  function stop() {
    try { advert?.stop?.(); bonjour?.destroy?.(); } catch (_) {}
    advert = bonjour = null;
    for (const c of clients) { try { c.destroy(); } catch (_) {} }
    clients.clear();
    try { server?.close(); } catch (_) {}
    server = null; port = 0;
    notify();
    return status();
  }

  return { start, stop, status };
}

module.exports = { createOs2lLink };
