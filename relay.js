const WebSocket = require('ws');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WS_PORT = Number(process.env.ARTNET_WS_PORT || 8081);
const WS_HOST = process.env.ARTNET_WS_HOST || '127.0.0.1';
const ARTNET_PORT = 6454;
const SACN_PORT = 5568;
const ARTNET_TARGET = process.env.ARTNET_TARGET || '192.168.1.1';
const ARTNET_LOCAL_ADDRESS = process.env.ARTNET_LOCAL_ADDRESS || '0.0.0.0';
const udp = dgram.createSocket('udp4');
let udpReady = false;
let shuttingDown = false;
let packetsReceived = 0;
let packetsSent = 0;
let packetsRejected = 0;
let sequence = 0;
let sacnSequence = 0;
const cid = crypto.randomBytes(16);

const output = {
  protocol: 'artnet',
  enabled: true,
  mode: 'LIVE',
  target: ARTNET_TARGET,
  universe: 0,
  priority: 100,
  multicast: false,
  sourceName: 'Lighting Console'
};

const logDir = (() => {
  try {
    const dir = process.env.LIGHTING_CONSOLE_LOG_DIR || path.join(process.env.HOME || process.cwd(), 'Library', 'Logs', 'Lighting Console', 'services');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (_) { return null; }
})();
const logFile = logDir ? path.join(logDir, 'art-net-relay.log') : null;
let logStream = null;
try { if (logFile) logStream = fs.createWriteStream(logFile, { flags: 'a' }); } catch (_) {}
const originalConsole = console.log.bind(console);
const originalError = console.error.bind(console);
function log(...args) {
  originalConsole(...args);
  try { logStream?.write(`[${new Date().toISOString()}] ${args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')}\n`); } catch (_) {}
}
function error(...args) {
  originalError(...args);
  try { logStream?.write(`[${new Date().toISOString()}] ERROR ${args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')}\n`); } catch (_) {}
}
console.log = log;
console.error = error;

console.log('========================================');
console.log('🎛 DMX OUTPUT RELAY STARTING');
console.log(`📡 Art-Net default target: ${ARTNET_TARGET}:${ARTNET_PORT}`);
console.log(`🌐 UDP bind: ${ARTNET_LOCAL_ADDRESS}`);
console.log(`🔌 WebSocket: ${WS_HOST}:${WS_PORT}`);
console.log('========================================');

udp.on('error', err => console.error('❌ UDP ERROR:', err.message));
udp.on('listening', () => {
  udpReady = true;
  const address = udp.address();
  console.log(`✅ UDP READY — local ${address.address}:${address.port}`);
  sendArtNet(buildArtPoll(), ARTNET_TARGET);
});
udp.bind(0, ARTNET_LOCAL_ADDRESS);

const wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => {
  console.log(`✅ WEBSOCKET READY — ws://${WS_HOST}:${WS_PORT}`);
  console.log('🎛 DMX OUTPUT RELAY FULLY RUNNING');
});
wss.on('error', err => console.error('❌ WEBSOCKET SERVER ERROR:', err.message));

function isArtNetPacket(packet, opcode) {
  return Buffer.isBuffer(packet) && packet.length >= 10 && packet.subarray(0, 8).equals(Buffer.from('Art-Net\0')) && packet[8] === (opcode & 0xff) && packet[9] === ((opcode >> 8) & 0xff);
}
function isArtNetDMX(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 18) return false;
  if (!packet.subarray(0, 8).equals(Buffer.from('Art-Net\0'))) return false;
  if (packet[8] !== 0x00 || packet[9] !== 0x50) return false;
  if (packet.readUInt16BE(10) < 14) return false;
  const declaredLength = packet.readUInt16BE(16);
  if (declaredLength < 2 || declaredLength > 512) return false;
  return packet.length >= 18 + declaredLength;
}
function buildArtPoll() {
  const packet = Buffer.alloc(14);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x2000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = 0;
  packet[13] = 0;
  return packet;
}
function buildArtDMX(dmx, universe = output.universe) {
  const values = Array.isArray(dmx) || ArrayBuffer.isView(dmx) ? Array.from(dmx) : [];
  const length = Math.max(2, Math.min(512, values.length));
  const packet = Buffer.alloc(18 + length);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x5000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = sequence = (sequence + 1) & 0xff;
  packet[13] = 0;
  const u = Math.max(0, Math.min(32767, Number(universe ?? output.universe)));
  packet.writeUInt16LE(Number.isFinite(u) ? u : 0, 14);
  packet.writeUInt16BE(length, 16);
  for (let i = 0; i < length; i++) packet[18 + i] = Number(values[i]) & 0xff;
  return packet;
}
function setFlagsAndLength(packet, offset, length) {
  packet.writeUInt16BE(0x7000 | (length & 0x0fff), offset);
}
function buildSacnDMX(dmx, universe = output.universe, priority = 100) {
  const values = Array.isArray(dmx) || ArrayBuffer.isView(dmx) ? Array.from(dmx) : [];
  const length = Math.max(2, Math.min(512, values.length));
  const packet = Buffer.alloc(126 + length);
  packet.writeUInt16BE(0x0010, 0);
  packet.writeUInt16BE(0x0000, 2);
  Buffer.from([0x41,0x53,0x43,0x2d,0x45,0x31,0x2e,0x31,0x37,0x00,0x00,0x00]).copy(packet, 4);

  setFlagsAndLength(packet, 16, 620);
  packet.writeUInt32BE(0x00000004, 18);
  cid.copy(packet, 22);

  const frameOffset = 38;
  setFlagsAndLength(packet, frameOffset, 598);
  packet.writeUInt32BE(0x00000002, 40);
  const name = Buffer.from(String(output.sourceName || 'Lighting Console').slice(0, 64), 'utf8');
  name.copy(packet, 44);
  packet[108] = Math.max(0, Math.min(200, Number(priority) || 100));
  packet[109] = 0;
  packet[110] = 0;
  packet[111] = sacnSequence = (sacnSequence + 1) & 0xff;
  const u = Math.max(1, Math.min(63999, Number(universe ?? output.universe)));
  packet.writeUInt16BE(Number.isFinite(u) ? u : 1, 113);

  const dmpOffset = 115;
  setFlagsAndLength(packet, dmpOffset, 521);
  packet[dmpOffset + 2] = 0x02;
  packet[dmpOffset + 3] = 0xa1;
  packet.writeUInt16BE(0x0000, dmpOffset + 4);
  packet.writeUInt16BE(0x0001, dmpOffset + 6);
  packet.writeUInt16BE(length + 1, dmpOffset + 8);
  packet[dmpOffset + 10] = 0;
  for (let i = 0; i < length; i++) packet[dmpOffset + 11 + i] = Number(values[i]) & 0xff;
  return packet;
}
function sacnTarget(universe) {
  const u = Math.max(1, Math.min(63999, Number(universe) || 1));
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}
function sendArtNet(packet, target = ARTNET_TARGET) {
  if (shuttingDown || !udpReady) { packetsRejected++; return false; }
  udp.send(packet, ARTNET_PORT, target, err => {
    if (err) console.error(`❌ Art-Net UDP SEND FAILED → ${target}:${ARTNET_PORT}:`, err.message);
    else packetsSent++;
  });
  return true;
}
function sendSacn(packet, target) {
  if (shuttingDown || !udpReady) { packetsRejected++; return false; }
  udp.send(packet, SACN_PORT, target, err => {
    if (err) console.error(`❌ sACN UDP SEND FAILED → ${target}:${SACN_PORT}:`, err.message);
    else packetsSent++;
  });
  return true;
}
function sendDMXBuffer(dmx, universe) {
  if (!output.enabled || output.mode !== 'LIVE') return false;
  if (output.protocol === 'sacn') {
    const u = Math.max(1, Math.min(63999, Number(universe ?? output.universe)));
    const target = output.multicast ? sacnTarget(u) : (output.target || '127.0.0.1');
    return sendSacn(buildSacnDMX(dmx, u, output.priority), target);
  }
  const u = Math.max(0, Math.min(32767, Number(universe ?? output.universe)));
  return sendArtNet(buildArtDMX(dmx, u), output.target || ARTNET_TARGET);
}
function applyOutputConfig(message) {
  const protocol = String(message.protocol || 'artnet').toLowerCase() === 'sacn' ? 'sacn' : 'artnet';
  output.protocol = protocol;
  output.enabled = Boolean(message.enabled);
  output.mode = String(message.mode || 'LIVE').toUpperCase() === 'BLIND' ? 'BLIND' : 'LIVE';
  output.target = String(message.target || (protocol === 'artnet' ? ARTNET_TARGET : '127.0.0.1'));
  const rawUniverse = Number(message.universe);
  const fallbackUniverse = protocol === 'sacn' ? 1 : 0;
  output.universe = protocol === 'sacn'
    ? Math.max(1, Math.min(63999, Number.isFinite(rawUniverse) ? Math.round(rawUniverse) : fallbackUniverse))
    : Math.max(0, Math.min(32767, Number.isFinite(rawUniverse) ? Math.round(rawUniverse) : fallbackUniverse));
  output.priority = Math.max(0, Math.min(200, Number(message.priority) || 100));
  output.multicast = Boolean(message.multicast);
  output.sourceName = String(message.sourceName || 'Lighting Console').slice(0, 64);
  console.log(`🔄 OUTPUT → ${output.enabled && output.mode === 'LIVE' ? 'ON' : 'OFF'} ${output.protocol.toUpperCase()} target=${output.target} universe=${output.universe} mode=${output.mode}`);
  broadcast({ type: 'OUTPUT_STATUS', ...output, online: udpReady });
}
function broadcast(message) {
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { try { client.send(JSON.stringify(message)); } catch (_) {} } });
}
function buildTodRequest(universe) {
  const portAddress = Math.max(0, Math.min(32767, Number(universe) || 0));
  const packet = Buffer.alloc(24);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x8000, 8);
  packet.writeUInt16BE(14, 10);
  packet[20] = (portAddress >> 8) & 0x7f;
  packet[21] = portAddress & 0xff;
  packet[22] = 0;
  packet[23] = 1;
  return packet;
}
function buildTodControl(universe, command = 1) {
  const portAddress = Math.max(0, Math.min(32767, Number(universe) || 0));
  const packet = Buffer.alloc(24);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x8100, 8);
  packet.writeUInt16BE(14, 10);
  packet[20] = (portAddress >> 8) & 0x7f;
  packet[21] = portAddress & 0xff;
  packet[22] = command & 0xff;
  packet[23] = portAddress & 0xff;
  return packet;
}
function parseTodData(packet, sourceIp) {
  if (!isArtNetPacket(packet, 0x8100) || packet.length < 28) return null;
  const uidTotal = packet.readUInt16BE(24);
  const uidCount = packet[27];
  const devices = [];
  for (let i = 0; i < uidCount; i++) {
    const offset = 28 + i * 6;
    if (offset + 6 > packet.length) break;
    const uid = packet.subarray(offset, offset + 6).toString('hex').match(/.{2}/g).join(':').toUpperCase();
    devices.push({ uid, sourceIp });
  }
  return { uidTotal, devices };
}
udp.on('message', (packet, rinfo) => {
  if (isArtNetPacket(packet, 0x2100)) { broadcast({ type: 'ARTNET_NODE', ip: rinfo.address }); return; }
  const tod = parseTodData(packet, rinfo.address);
  if (tod) { broadcast({ type: 'RDM_TOD', ...tod }); return; }
  if (isArtNetDMX(packet)) wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { try { client.send(packet, { binary: true }); } catch (_) {} } });
});
wss.on('connection', (ws, request) => {
  const remote = request?.socket?.remoteAddress || 'unknown';
  console.log(`🔌 WEBSOCKET CLIENT CONNECTED ← ${remote}`);
  ws.send(JSON.stringify({ type: 'OUTPUT_STATUS', ...output, online: udpReady }));
  ws.on('message', (data, isBinary) => {
    packetsReceived++;
    if (!isBinary) {
      try {
        const message = JSON.parse(String(data));
        if (message?.type === 'OUTPUT_CONFIG') { applyOutputConfig(message); return; }
        if (message?.type === 'RDM_TOD_REQUEST') { if (output.protocol === 'artnet') sendArtNet(buildTodRequest(message.universe), output.target || ARTNET_TARGET); return; }
        if (message?.type === 'RDM_TOD_FLUSH') { if (output.protocol === 'artnet') { sendArtNet(buildTodControl(message.universe, 1), output.target || ARTNET_TARGET); setTimeout(() => sendArtNet(buildTodRequest(message.universe), output.target || ARTNET_TARGET), 150); } return; }
        if (message?.type === 'DMX_UPDATE' && message.dmx) { sendDMXBuffer(message.dmx, message.universe); return; }
        if (Array.isArray(message?.dmx)) { sendDMXBuffer(message.dmx, message.universe); return; }
      } catch (err) { console.warn('⚠️ Invalid WebSocket JSON:', err.message); }
      packetsRejected++; return;
    }
    const pkt = Buffer.from(data);
    if (!isArtNetDMX(pkt)) { packetsRejected++; return; }
    if (output.mode !== 'LIVE' || !output.enabled) return;
    const length = pkt.readUInt16BE(16);
    sendDMXBuffer(pkt.subarray(18, 18 + length), output.universe);
    wss.clients.forEach(client => { if (client !== ws && client.readyState === WebSocket.OPEN) { try { client.send(pkt, { binary: true }); } catch (_) {} } });
  });
  ws.on('error', err => console.error(`❌ WebSocket client ERROR (${remote}):`, err.message));
  ws.on('close', () => console.log(`🔌 WebSocket client disconnected ← ${remote}`));
});
const statsTimer = setInterval(() => console.log(`📊 RELAY STATUS — ${output.enabled && output.mode === 'LIVE' ? 'ON' : 'OFF'} ${output.protocol.toUpperCase()} target=${output.target} universe=${output.universe} mode=${output.mode}, clients=${wss.clients.size}, rx=${packetsReceived}, tx=${packetsSent}, rejected=${packetsRejected}`), 10000);
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(statsTimer);
  try { wss.close(); } catch (_) {}
  try { udp.close(); } catch (_) {}
  try { logStream?.end(); } catch (_) {}
}
module.exports = { shutdown, output };
