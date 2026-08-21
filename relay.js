const WebSocket = require('ws');
const dgram = require('dgram');

const WS_PORT = Number(process.env.ARTNET_WS_PORT || 8081);
const ARTNET_PORT = 6454;
const ARTNET_TARGET = process.env.ARTNET_TARGET || '192.168.1.1';
const udp = dgram.createSocket('udp4');
let udpReady = false;
let shuttingDown = false;
let packetsReceived = 0;
let packetsSent = 0;
let packetsRejected = 0;

console.log('========================================');
console.log('🎛 ART-NET RELAY STARTING');
console.log(`📡 Art-Net target: ${ARTNET_TARGET}:${ARTNET_PORT}`);
console.log(`🔌 WebSocket port: ${WS_PORT}`);
console.log('========================================');

udp.on('error', err => console.error('❌ UDP ERROR:', err.message));

// Art-Net uses UDP 6454 for both source and destination traffic. Binding the
// controller side to 6454 is required for unicast ArtPollReply/TOD responses.
udp.bind(ARTNET_PORT, '0.0.0.0', () => {
  udpReady = true;
  console.log(`✅ UDP READY — local source port ${ARTNET_PORT}`);
  console.log(`➡️  UDP will send Art-Net to ${ARTNET_TARGET}:${ARTNET_PORT}`);
});

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`✅ WEBSOCKET READY — ws://localhost:${WS_PORT}`);
  console.log('🎛 ART-NET RELAY FULLY RUNNING');
});
wss.on('error', err => console.error('❌ WEBSOCKET SERVER ERROR:', err.message));

function isArtNetDMX(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 18) return false;
  if (!packet.subarray(0, 8).equals(Buffer.from('Art-Net\0'))) return false;
  if (packet[8] !== 0x00 || packet[9] !== 0x50) return false;
  if (packet.readUInt16BE(10) < 14) return false;
  const declaredLength = packet.readUInt16BE(16);
  if (declaredLength < 2 || declaredLength > 512) return false;
  return packet.length >= 18 + declaredLength;
}

function isArtNetPacket(packet, opcode) {
  return Buffer.isBuffer(packet) && packet.length >= 10 &&
    packet.subarray(0, 8).equals(Buffer.from('Art-Net\0')) &&
    packet[8] === (opcode & 0xff) && packet[9] === ((opcode >> 8) & 0xff);
}

function sendArtNet(packet, target = ARTNET_TARGET) {
  if (shuttingDown || !udpReady) {
    packetsRejected++;
    return false;
  }
  udp.send(packet, 0, packet.length, ARTNET_PORT, target, err => {
    if (err) console.error(`❌ Art-Net UDP SEND FAILED → ${target}:${ARTNET_PORT}:`, err.message);
    else packetsSent++;
  });
  return true;
}

function buildTodRequest(universe) {
  const portAddress = Math.max(1, Math.min(32767, Number(universe) || 1));
  const packet = Buffer.alloc(56);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x8000, 8); // OpTodRequest
  packet[10] = 0;
  packet[11] = 14;
  // 12-13 filler, 14-20 spare, 21 Net, 22 Command, 23 AddCount.
  packet[21] = (portAddress >> 8) & 0x7f;
  packet[22] = 0x00; // TodFull
  packet[23] = 1;
  packet[24] = portAddress & 0xff;
  return packet;
}

function buildTodControl(universe, command = 1) {
  const portAddress = Math.max(1, Math.min(32767, Number(universe) || 1));
  const packet = Buffer.alloc(24);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x8200, 8); // OpTodControl
  packet[10] = 0;
  packet[11] = 14;
  packet[21] = (portAddress >> 8) & 0x7f;
  packet[22] = command & 0xff; // AtcFlush = 1
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
    devices.push({
      uid,
      universe: ((packet[21] & 0x7f) << 8) | packet[23],
      address: (((packet[21] & 0x7f) << 8) | packet[23]) || 1,
      port: packet[13],
      bindIndex: packet[20],
      rdmVersion: packet[12],
      sourceIp
    });
  }
  return { uidTotal, devices };
}

udp.on('message', (packet, rinfo) => {
  // TOD is controller-facing discovery data. Forward it as JSON to the UI.
  const tod = parseTodData(packet, rinfo.address);
  if (tod) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'RDM_TOD', ...tod }));
      }
    });
    return;
  }

  // Keep the existing live-DMX monitor behaviour intact.
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
      } catch (_) {}
      packetsRejected++;
      return;
    }

    const pkt = Buffer.from(data);
    if (!isArtNetDMX(pkt)) {
      packetsRejected++;
      console.warn(`⚠️ REJECTED invalid/non-DMX Art-Net packet (${pkt.length} bytes)`);
      return;
    }

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
    console.log(`🔌 WEBSOCKET CLIENT DISCONNECTED ← ${remote}`);
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
  wss.close(() => { if (udpReady) { try { udp.close(); } catch (_) {} } });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

module.exports = { sendArtNet, shutdown, buildTodRequest, buildTodControl };
