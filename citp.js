'use strict';

// CITP: lets Light Spark and a visualiser such as Capture work together.
//
//   Finding each other   every second Light Spark says "I'm a lighting console
//                        called Light Spark" on the CITP multicast address
//                        (PINF/PLoc). A visualiser that says the same about
//                        itself gets a TCP connection.
//   Patch (FPTC)         which way the patch goes (config.patchMode):
//                        "send"    Light Spark's patch goes to the visualiser
//                                  (number, universe, address, channel count,
//                                  make and name) and follows every change;
//                        "receive" the visualiser's patch comes here: asked for
//                                  when it links, and its changes followed;
//                        "off"     neither.
//                        "Get Capture's patch" asks for it once (SPtc) and the
//                        console page shows what would change before using it.
//   Selection (FSEL)     selecting lights in Light Spark selects them in the
//                        visualiser, and clicking lights there selects them here.
//   Levels (SDMX)        optional: the DMX itself over the same connection.
//
// The console page (js/citp-link.js) sends the patch, selection and levels
// here over ws://127.0.0.1:8087 and gets the peers and their selections back.

const dgram = require('dgram');
const net = require('net');
const os = require('os');
const WebSocket = require('ws');

const WS_HOST = '127.0.0.1';
const WS_PORT = 8087;
const CITP_PORT = 4809;
// 239.224.0.180 is CITP's address now; 224.0.0.180 is the old one some
// equipment still uses. Light Spark speaks on both.
const GROUPS = ['239.224.0.180', '224.0.0.180'];
const NAME = 'Light Spark';

let config = { enabled: false, patchMode: 'send', selection: true, levels: false };
const sending = () => config.patchMode === 'send';
const receiving = () => config.patchMode === 'receive';
let patch = new Map();          // fixture number -> { id, universe, channel, count, make, name }
let selection = [];             // fixture numbers
let universes = {};             // universe (1-based) -> 512 levels
let sentLevels = {};            // what each universe last went out as
const peers = new Map();        // ip -> { ip, name, type, state, port, seen, socket, buffer, connected, sentPatch }
let udp = null, server = null, tcpPort = 0, wss = null;
let locTimer = null, levelTimer = null, sweepTimer = null;
let lastError = '';

// ------------------------------------------------------------------ packets

const ucs1 = text => Buffer.concat([Buffer.from(String(text ?? ''), 'latin1'), Buffer.alloc(1)]);
const readUcs1 = (buf, offset) => {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return [buf.toString('latin1', offset, end), end + 1];
};

// Every CITP message: a 20-byte header, then the layer's own header and body.
function citp(layer, body) {
  const header = Buffer.alloc(20);
  header.write('CITP', 0, 'latin1');
  header[4] = 1; header[5] = 0;             // version 1.0
  header.writeUInt16LE(0, 6);               // request index
  header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt16LE(1, 12);              // one part
  header.writeUInt16LE(0, 14);
  header.write(layer, 16, 'latin1');
  return Buffer.concat([header, body]);
}
const cookie = text => Buffer.from(text, 'latin1');
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

const pinfLoc = () => citp('PINF', Buffer.concat([cookie('PLoc'), u16(tcpPort), ucs1('LightingConsole'), ucs1(NAME), ucs1(config.enabled ? 'Running' : 'Idle')]));
const pinfName = () => citp('PINF', Buffer.concat([cookie('PNam'), ucs1(NAME)]));

// FPTC header: message type, then a hint saying whether it's part of a run.
const fptc = (type, hint, body) => citp('FPTC', Buffer.concat([cookie(type), u32(hint), body]));
function ptch(f, hint = 0) {
  const body = Buffer.alloc(8);
  body.writeUInt16LE(f.id, 0);
  body[2] = Math.max(0, f.universe - 1);    // 0-based universe
  body[3] = 0;
  body.writeUInt16LE(Math.max(0, f.channel - 1), 4); // 0-based channel
  body.writeUInt16LE(f.count, 6);
  return fptc('Ptch', hint, Buffer.concat([body, ucs1(f.make), ucs1(f.name)]));
}
const idList = ids => Buffer.concat([u16(ids.length), ...ids.map(u16)]);
const uptc = ids => fptc('UPtc', 0, idList(ids));
const sele = ids => citp('FSEL', Buffer.concat([cookie('Sele'), Buffer.from([1, 0]), idList(ids)]));
const dese = ids => citp('FSEL', Buffer.concat([cookie('DeSe'), idList(ids)]));
function chbk(universe, levels) {
  const body = Buffer.alloc(6);
  body[0] = 0;                              // not blind
  body[1] = Math.max(0, universe - 1);
  body.writeUInt16LE(0, 2);
  body.writeUInt16LE(512, 4);
  return citp('SDMX', Buffer.concat([cookie('ChBk'), body, Buffer.from(levels)]));
}
const sptc = () => fptc('SPtc', 0, idList([])); // "send me your whole patch"
const sdmxCapa = () => citp('SDMX', Buffer.concat([cookie('Capa'), u16(1), u16(1)])); // channel lists

// Split a TCP stream into whole messages; returns what's left over.
function eachMessage(buffer, fn) {
  let offset = 0;
  while (buffer.length - offset >= 20) {
    if (buffer.toString('latin1', offset, offset + 4) !== 'CITP') {
      const next = buffer.indexOf('CITP', offset + 1, 'latin1');
      if (next < 0) return Buffer.alloc(0);
      offset = next;
      continue;
    }
    const size = buffer.readUInt32LE(offset + 8);
    if (size < 20) { offset += 4; continue; }
    if (buffer.length - offset < size) break;
    try { fn(buffer.subarray(offset, offset + size)); } catch (err) { console.warn('CITP message error:', err.message); }
    offset += size;
  }
  return buffer.subarray(offset);
}

function readIds(buf, offset) {
  const count = buf.readUInt16LE(offset);
  const ids = [];
  for (let i = 0; i < count && offset + 2 + i * 2 + 2 <= buf.length; i++) ids.push(buf.readUInt16LE(offset + 2 + i * 2));
  return ids;
}

// ------------------------------------------------------------------- peers

function status() {
  return {
    type: 'CITP_STATUS', config, tcpPort, error: lastError, patched: patch.size,
    peers: [...peers.values()].map(p => ({ ip: p.ip, name: p.name, type: p.type, state: p.state, connected: Boolean(p.connected), seen: p.seen }))
  };
}
function tell(message) {
  if (!wss) return;
  const text = JSON.stringify(message);
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) { try { ws.send(text); } catch (_) {} } });
}
const tellStatus = () => tell(status());

function send(peer, packet) {
  if (!peer.connected || !peer.socket || peer.socket.destroyed) return;
  try { peer.socket.write(packet); } catch (_) {}
}
const toAll = packet => { for (const peer of peers.values()) send(peer, packet); };

// Everything a newly connected visualiser needs to know.
function welcome(peer) {
  send(peer, pinfName());
  if (sending()) sendPatch(peer);
  if (receiving()) requestPatch(peer, false);
  if (config.selection && selection.length) send(peer, sele(selection));
  if (config.levels) send(peer, sdmxCapa());
}

function sendPatch(peer, only = null) {
  const list = [...patch.values()].filter(f => !only || only.includes(f.id)).sort((a, b) => a.id - b.id);
  list.forEach((f, i) => send(peer, ptch(f, list.length === 1 ? 0 : i === list.length - 1 ? 2 : 1)));
}

// ------------------------------------------------- the visualiser's patch

// Ask for the whole patch. Replies come as a run of Ptch messages; the run is
// over when one says it's the last, or nothing more comes for a moment.
function requestPatch(peer, preview = true) {
  peer.patch = new Map();
  peer.requesting = preview ? 'preview' : 'follow';
  send(peer, sptc());
  clearTimeout(peer.patchTimer);
  peer.patchTimer = setTimeout(() => finishPatch(peer), 2500);
}

function finishPatch(peer) {
  clearTimeout(peer.patchTimer);
  const fixtures = [...(peer.patch || new Map()).values()].sort((a, b) => a.id - b.id);
  const why = peer.requesting;
  peer.requesting = null;
  if (why === 'preview') tell({ type: 'CITP_PEER_PATCH_FULL', from: peer.name || peer.ip, fixtures });
  else if (why === 'follow') tell({ type: 'CITP_PEER_PATCH', from: peer.name || peer.ip, fixtures, removed: [], complete: true });
}

function onPeerPatch(peer, msg, type) {
  peer.patch ||= new Map();
  const hint = msg.readUInt32LE(24);
  if (type === 'Ptch') {
    let offset = 36, make, name;
    [make, offset] = readUcs1(msg, offset);
    [name] = readUcs1(msg, offset);
    // Capture can count addresses straight on through its universes (its
    // "Patch base"): universe 2 channel 1 arrives as universe 1 channel 513.
    // Fold those back into universe and address, or every light lands in
    // universe 1.
    const raw = msg.readUInt16LE(32);
    const fixture = { id: msg.readUInt16LE(28), universe: msg[30] + 1 + Math.floor(raw / 512), channel: (raw % 512) + 1, count: msg.readUInt16LE(34), make, name };
    peer.patch.set(fixture.id, fixture);
    if (peer.requesting) {
      clearTimeout(peer.patchTimer);
      peer.patchTimer = setTimeout(() => finishPatch(peer), hint === 2 ? 50 : 600);
    } else if (receiving()) tell({ type: 'CITP_PEER_PATCH', from: peer.name || peer.ip, fixtures: [fixture], removed: [] });
    return;
  }
  // UPtc: these lights (or, with none listed, all of them) were unpatched there.
  const ids = readIds(msg, 28);
  const removed = ids.length ? ids : [...peer.patch.keys()];
  removed.forEach(id => peer.patch.delete(id));
  if (receiving() && !peer.requesting) tell({ type: 'CITP_PEER_PATCH', from: peer.name || peer.ip, fixtures: [], removed });
}

function handle(peer, msg) {
  const layer = msg.toString('latin1', 16, 20);
  const type = msg.toString('latin1', 20, 24);
  if (layer === 'PINF' && type === 'PNam') { peer.name = readUcs1(msg, 24)[0] || peer.name; tellStatus(); return; }
  if (layer === 'FPTC') {
    if (type === 'SPtc') { if (sending()) { const ids = readIds(msg, 28); sendPatch(peer, ids.length ? ids : null); } return; }
    if (type === 'Ptch' || type === 'UPtc') { onPeerPatch(peer, msg, type); return; }
  }
  if (layer === 'FSEL' && config.selection) {
    if (type === 'Sele') {
      const complete = msg[24] !== 0;
      const ids = readIds(msg, 26);
      selection = complete ? ids : [...new Set([...selection, ...ids])];
      tell({ type: 'CITP_SELECT', ids: selection, from: peer.name || peer.ip });
      // Let any other visualiser follow too.
      for (const other of peers.values()) if (other !== peer) send(other, sele(selection));
      return;
    }
    if (type === 'DeSe') {
      const ids = readIds(msg, 24);
      selection = ids.length ? selection.filter(id => !ids.includes(id)) : [];
      tell({ type: 'CITP_SELECT', ids: selection, from: peer.name || peer.ip });
      for (const other of peers.values()) if (other !== peer) send(other, sele(selection));
    }
  }
}

function attach(peer, socket) {
  peer.socket = socket;
  peer.connected = true;
  peer.buffer = Buffer.alloc(0);
  socket.setNoDelay(true);
  socket.on('data', data => { peer.buffer = eachMessage(Buffer.concat([peer.buffer, data]), msg => handle(peer, msg)); });
  const gone = () => {
    if (peer.socket !== socket) return;
    peer.socket = null; peer.connected = false;
    console.log(`CITP: ${peer.name || peer.ip} disconnected`);
    tellStatus();
  };
  socket.on('close', gone);
  socket.on('error', () => {});
  console.log(`CITP: connected to ${peer.name || peer.ip} (${peer.type || 'peer'})`);
  welcome(peer);
  tellStatus();
}

function connect(peer) {
  if (!config.enabled || peer.connected || peer.connecting || !peer.port) return;
  peer.connecting = true;
  const socket = net.connect({ host: peer.ip, port: peer.port });
  socket.setTimeout(4000, () => socket.destroy());
  socket.once('connect', () => { socket.setTimeout(0); peer.connecting = false; attach(peer, socket); });
  socket.once('error', () => { peer.connecting = false; });
  socket.once('close', () => { peer.connecting = false; });
}

const ownAddresses = () => new Set(['127.0.0.1', ...Object.values(os.networkInterfaces()).flat().filter(a => a && (a.family === 'IPv4' || a.family === 4)).map(a => a.address)]);

function onLocation(msg, from) {
  if (msg.toString('latin1', 0, 4) !== 'CITP' || msg.toString('latin1', 16, 20) !== 'PINF' || msg.toString('latin1', 20, 24) !== 'PLoc') return;
  const port = msg.readUInt16LE(24);
  let offset = 26, type, name, state;
  [type, offset] = readUcs1(msg, offset);
  [name, offset] = readUcs1(msg, offset);
  [state] = readUcs1(msg, offset);
  if (name === NAME && port === tcpPort && ownAddresses().has(from)) return; // ourselves
  if (/^LightingConsole$/i.test(type)) return; // another console isn't ours to drive
  const peer = peers.get(from) || { ip: from };
  const fresh = !peers.has(from) || peer.port !== port;
  Object.assign(peer, { name, type, state, port, seen: Date.now() });
  peers.set(from, peer);
  if (fresh) { console.log(`CITP: found ${name || 'a peer'} (${type}) at ${from}:${port}`); tellStatus(); }
  connect(peer);
}

// ----------------------------------------------------------------- network

function start() {
  if (udp) return;
  lastError = '';
  server = net.createServer(socket => {
    const ip = String(socket.remoteAddress || '').replace(/^::ffff:/, '');
    const peer = peers.get(ip) || { ip, name: '', type: '', seen: Date.now() };
    peers.set(ip, peer);
    if (peer.connected) { socket.destroy(); return; } // one link per peer
    attach(peer, socket);
  });
  server.on('error', err => { lastError = `TCP: ${err.message}`; tellStatus(); });
  server.listen(0, '0.0.0.0', () => {
    tcpPort = server.address().port;
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('message', (msg, rinfo) => onLocation(msg, rinfo.address));
    udp.on('error', err => { lastError = `UDP: ${err.message}`; console.warn('CITP UDP error:', err.message); tellStatus(); });
    udp.bind(CITP_PORT, () => {
      for (const group of GROUPS) {
        try { udp.addMembership(group); } catch (_) {}
        for (const a of ownAddresses()) { if (a !== '127.0.0.1') { try { udp.addMembership(group, a); } catch (_) {} } }
      }
      try { udp.setMulticastTTL(1); udp.setMulticastLoopback(true); } catch (_) {}
      console.log(`CITP READY — TCP ${tcpPort}, announcing on ${GROUPS.join(' and ')}:${CITP_PORT}`);
      announce();
      tellStatus();
    });
    locTimer = setInterval(announce, 1000);
    sweepTimer = setInterval(sweep, 2000);
    levelTimer = setInterval(() => sendLevels(true), 1000);
  });
}

function stop() {
  clearInterval(locTimer); clearInterval(sweepTimer); clearInterval(levelTimer);
  locTimer = sweepTimer = levelTimer = null;
  for (const peer of peers.values()) { try { peer.socket?.destroy(); } catch (_) {} }
  peers.clear();
  try { udp?.close(); } catch (_) {}
  try { server?.close(); } catch (_) {}
  udp = null; server = null; tcpPort = 0;
  tellStatus();
}

function announce() {
  if (!udp) return;
  const packet = pinfLoc();
  for (const group of GROUPS) udp.send(packet, CITP_PORT, group, () => {});
}

// A peer that stopped announcing and isn't connected is forgotten.
function sweep() {
  const now = Date.now();
  let changed = false;
  for (const [ip, peer] of peers) {
    if (!peer.connected && now - (peer.seen || 0) > 10000) { peers.delete(ip); changed = true; }
    else if (!peer.connected) connect(peer);
  }
  if (changed) tellStatus();
}

// Levels go out the moment they change (and every second anyway, so a
// visualiser that joins late or missed one catches up). Waiting for a
// timer is what made CITP levels lag behind sACN.
function sendLevels(all = false) {
  if (!config.levels || ![...peers.values()].some(p => p.connected)) return;
  for (const [u, levels] of Object.entries(universes)) {
    const key = levels.join(',');
    if (!all && sentLevels[u] === key) continue;
    sentLevels[u] = key;
    toAll(chbk(Number(u), levels));
  }
}

// --------------------------------------------------------- from the console

function setPatch(list) {
  const next = new Map();
  for (const f of Array.isArray(list) ? list : []) {
    const id = Number(f.id);
    if (!Number.isInteger(id) || id < 1 || id > 65535) continue;
    next.set(id, { id, universe: Math.max(1, Number(f.universe) || 1), channel: Math.max(1, Number(f.channel) || 1), count: Math.max(1, Math.min(512, Number(f.count) || 1)), make: String(f.make || ''), name: String(f.name || `Fixture ${id}`) });
  }
  const removed = [...patch.keys()].filter(id => !next.has(id));
  const changed = [...next.values()].filter(f => JSON.stringify(f) !== JSON.stringify(patch.get(f.id)));
  patch = next;
  if (!sending()) return;
  if (removed.length) toAll(uptc(removed));
  changed.forEach((f, i) => toAll(ptch(f, changed.length === 1 ? 0 : i === changed.length - 1 ? 2 : 1)));
  if (removed.length || changed.length) tellStatus();
}

function setSelection(ids) {
  const next = (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 65536);
  if (JSON.stringify(next) === JSON.stringify(selection)) return;
  selection = next;
  if (config.selection) toAll(next.length ? sele(next) : dese([]));
}

function configure(next) {
  const was = config.enabled, wasMode = config.patchMode;
  // Older settings had patch: true/false.
  if (next && next.patchMode == null && typeof next.patch === 'boolean') next = { ...next, patchMode: next.patch ? 'send' : 'off' };
  config = { ...config, ...next, enabled: Boolean(next?.enabled ?? config.enabled) };
  if (!['send', 'receive', 'off'].includes(config.patchMode)) config.patchMode = 'send';
  if (config.enabled && was && wasMode !== config.patchMode) {
    for (const peer of peers.values()) if (peer.connected) { if (sending()) sendPatch(peer); if (receiving()) requestPatch(peer, false); }
    tellStatus();
    return;
  }
  if (config.enabled && !was) start();
  else if (!config.enabled && was) stop();
  else if (config.enabled) { for (const peer of peers.values()) if (peer.connected) welcome(peer); tellStatus(); }
  else tellStatus();
}

wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('error', err => console.error('CITP SERVICE ERROR:', err.message));
wss.on('connection', ws => {
  ws.send(JSON.stringify(status()));
  ws.on('message', data => {
    try {
      const m = JSON.parse(String(data));
      if (m.type === 'CITP_CONFIG') configure(m.config || {});
      else if (m.type === 'CITP_PATCH') setPatch(m.fixtures);
      else if (m.type === 'CITP_SELECTION') setSelection(m.ids);
      else if (m.type === 'CITP_LEVELS') { universes = m.universes && typeof m.universes === 'object' ? m.universes : {}; sendLevels(); }
      else if (m.type === 'CITP_REQUEST_PATCH') {
        const peer = [...peers.values()].find(p => p.connected);
        if (peer) requestPatch(peer, true);
        else tell({ type: 'CITP_PEER_PATCH_FULL', from: '', fixtures: [], error: 'No visualiser is linked yet' });
      }
    } catch (err) { console.warn('CITP message error:', err.message); }
  });
});

function shutdown() { stop(); try { wss?.close(); } catch (_) {} }

module.exports = { shutdown, citp, ptch, eachMessage, readUcs1 };
