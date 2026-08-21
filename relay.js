const WebSocket = require('ws');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const WS_PORT = Number(process.env.ARTNET_WS_PORT || 8081);
const WS_HOST = process.env.ARTNET_WS_HOST || '127.0.0.1';
const ARTNET_PORT = 6454;
const ARTNET_TARGET = process.env.ARTNET_TARGET || '192.168.1.1';

// IMPORTANT: do not bind the UDP socket to the selected LAN address.
// Electron utility processes on macOS can report EHOSTUNREACH when the socket
// is explicitly bound to en0's address, even though a normal Node process can
// reach the same Art-Net node. Let macOS select the correct interface/route.
const udp = dgram.createSocket('udp4');
let udpReady = false;
let shuttingDown = false;
let packetsReceived = 0;
let packetsSent = 0;
let packetsRejected = 0;
let sequence = 0;

const logDir = (() => {
  try {
    const dir = process.env.LIGHTING_CONSOLE_LOG_DIR || path.join(process.env.HOME || process.cwd(), 'Library', 'Logs', 'Lighting Console', 'services');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (_) {
    return null;
  }
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
console.log('🎛 ART-NET RELAY STARTING');
console.log(`📡 Art-Net target: ${ARTNET_TARGET}:${ARTNET_PORT}`);
console.log(`🔌 WebSocket: ${WS_HOST}:${WS_PORT}`);
console.log('🌐 UDP bind address: 0.0.0.0 (OS route selection)');
console.log('========================================');

udp.on('error', err => console.error('❌ UDP ERROR:', err.message));
udp.on('listening', () => {
  udpReady = true;
  const address = udp.address();
  console.log(`✅ UDP READY — local ${address.address}:${address.port}`);
  console.log(`➡️  Art-Net output → ${ARTNET_TARGET}:${ARTNET_PORT}`);
  sendArtNet(buildArtPoll(), ARTNET_TARGET);
});

// Bind without a local-address constraint. This is the same routing behaviour
// as the known-good `node -e 'dgram...send(...)'` test on macOS.
udp.bind(0);

const wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => {
  console.log(`✅ WEBSOCKET READY — ws://${WS_HOST}:${WS_PORT}`);
  console.log('🎛 ART-NET RELAY FULLY RUNNING');
});
wss.on('error', err => console.error('❌ WEBSOCKET SERVER ERROR:', err.message));

function isArtNetPacket(packet, opcode) {
  return Buffer.isBuffer(packet) && packet.length >= 10 &&
    packet.subarray(0, 8).equals(Buffer.from('Art-Net\0')) &&
    packet[8] === (opcode & 0xff) && packet[9] === ((opcode >> 8) & 0xff);
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

function buildArtDMX(dmx, universe = 0) {
  const values = Array.isArray(dmx) || ArrayBuffer.isView(dmx) ? Array.from(dmx) : [];
  const length = Math.max(2, Math.min(512, values.length));
  const packet = Buffer.alloc(18 + length);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x5000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = sequence = (sequence + 1) & 0xff;
  packet[13] = 0;
  packet.writeUInt16LE(Math.max(0, Math.min(32767, Number(universe) || 0)), 14);
  packet.writeUInt16BE(length, 16);
  for (let i = 0; i < length; i++) packet[18 + i] = Number(values[i]) & 0xff;
  return packet;
}

function sendArtNet(packet, target = ARTNET_TARGET) {
  if (shuttingDown || !udpReady) {
    packetsRejected++;
    return false;
  }

  udp.send(packet, 0, packet.length, ARTNET_PORT, target, err => {
    if (err) {
      console.error(`❌ Art-Net UDP SEND FAILED → ${target}:${ARTNET_PORT}:`, err.message);
    } else {
      packetsSent++;
    }
  });
  return true;
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
  packet[23] = 0;
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
  if (isArtNetPacket(packet, 0x2100)) {
    console.log(`✅ ART-NET NODE REPLIED ← ${rinfo.address}`);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ARTNET_NODE', ip: rinfo.address }));
    });
    return;
  }

  const tod = parseTodData(packet, rinfo.address);
  if (tod) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'RDM_TOD', ...tod }));
    });
    return;
  }

  if (isArtNetDMX(packet)) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(packet, { binary: true }); } catch (err) {
          console.error('❌ Visualiser broadcast failed:', err.message);
        }
      }
    });
  }
});

wss.on('connection', (ws, request) => {
  const remote = request?.socket?.remoteAddress || 'unknown';
  console.log(`🔌 WEBSOCKET CLIENT CONNECTED ← ${remote}`);
  console.log(`👥 Connected clients: ${wss.clients.size}`);

  ws.on('message', (data, isBinary) => {
    packetsReceived++;
    console.log(`📥 WS MESSAGE ← ${remote} bytes=${Buffer.byteLength(data)} binary=${isBinary}`);

    if (!isBinary) {
      try {
        const message = JSON.parse(String(data));

        if (message?.type === 'RDM_TOD_REQUEST') {
          sendArtNet(buildTodRequest(message.universe));
          return;
        }

        if (message?.type === 'RDM_TOD_FLUSH') {
          sendArtNet(buildTodControl(message.universe, 1));
          setTimeout(() => sendArtNet(buildTodRequest(message.universe)), 150);
          return;
        }

        if (message?.type === 'DMX_UPDATE' && message.dmx) {
          const universe = message.universe ?? message.portAddress ?? 0;
          const pkt = buildArtDMX(message.dmx, universe);
          console.log(`📤 ART-DMX → ${ARTNET_TARGET}:${ARTNET_PORT} universe=${universe} channels=${pkt.readUInt16BE(16)}`);
          sendArtNet(pkt);
          return;
        }

        if (Array.isArray(message?.dmx)) {
          sendArtNet(buildArtDMX(message.dmx, message.universe ?? 0));
          return;
        }
      } catch (err) {
        console.warn('⚠️ Invalid WebSocket JSON:', err.message);
      }
      packetsRejected++;
      return;
    }

    const pkt = Buffer.from(data);
    if (!isArtNetDMX(pkt)) {
      packetsRejected++;
      console.warn(`⚠️ REJECTED invalid/non-DMX Art-Net packet (${pkt.length} bytes)`);
      return;
    }

    console.log(`📤 ART-DMX → ${ARTNET_TARGET}:${ARTNET_PORT} universe=${pkt.readUInt16LE(14)} channels=${pkt.readUInt16BE(16)}`);
    sendArtNet(pkt);

    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        try { client.send(pkt, { binary: true }); } catch (err) {
          console.error('❌ Visualiser broadcast failed:', err.message);
        }
      }
    });
  });

  ws.on('error', err => console.error(`❌ WebSocket client ERROR (${remote}):`, err.message));
  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket client disconnected ← ${remote}`);
    console.log(`   Code: ${code}${reason?.length ? ` | Reason: ${reason}` : ''}`);
    console.log(`👥 Connected clients: ${wss.clients.size}`);
  });
});

const statsTimer = setInterval(() => {
  console.log(`📊 RELAY STATUS — clients=${wss.clients.size}, received=${packetsReceived}, sent=${packetsSent}, rejected=${packetsRejected}, udpReady=${udpReady}`);
}, 10000);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(statsTimer);
  console.log('🛑 Shutting down Art-Net relay...');
  wss.clients.forEach(client => { try { client.close(); } catch (_) {} });
  wss.close(() => {
    try { udp.close(); } catch (_) {}
    try { logStream?.end(); } catch (_) {}
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

module.exports = { sendArtNet, shutdown, buildTodRequest, buildTodControl, buildArtDMX };
