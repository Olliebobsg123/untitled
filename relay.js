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

udp.on('error', err => {
  console.error('❌ UDP ERROR:', err.message);
});

udp.bind(0, '0.0.0.0', () => {
  udpReady = true;
  console.log(`✅ UDP READY — local source port ${udp.address().port}`);
  console.log(`➡️  UDP will send Art-Net to ${ARTNET_TARGET}:${ARTNET_PORT}`);
});

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`✅ WEBSOCKET READY — ws://localhost:${WS_PORT}`);
  console.log('🎛 ART-NET RELAY FULLY RUNNING');
});

wss.on('error', err => {
  console.error('❌ WEBSOCKET SERVER ERROR:', err.message);
});

function isArtNet(packet) {
  return Buffer.isBuffer(packet) &&
    packet.length >= 8 &&
    packet.subarray(0, 8).equals(Buffer.from('Art-Net\0'));
}

function sendArtNet(packet) {
  if (shuttingDown) {
    console.warn('⚠️ Packet not sent — relay is shutting down');
    return;
  }

  if (!udpReady) {
    console.warn('⚠️ Packet not sent — UDP socket is not ready yet');
    return;
  }

  udp.send(packet, 0, packet.length, ARTNET_PORT, ARTNET_TARGET, err => {
    if (err) {
      console.error(`❌ Art-Net UDP SEND FAILED → ${ARTNET_TARGET}:${ARTNET_PORT}`);
      console.error('   ', err.message);
      return;
    }

    packetsSent++;
    console.log(`📤 Art-Net SENT #${packetsSent} → ${ARTNET_TARGET}:${ARTNET_PORT} (${packet.length} bytes)`);
  });
}

wss.on('connection', (ws, request) => {
  const remote = request?.socket?.remoteAddress || 'unknown';
  console.log(`🔌 WEBSOCKET CLIENT CONNECTED ← ${remote}`);
  console.log(`👥 Connected clients: ${wss.clients.size}`);

  ws.on('message', (data, isBinary) => {
    packetsReceived++;
    console.log(`📥 WS MESSAGE #${packetsReceived} — ${isBinary ? 'BINARY' : 'TEXT'} — ${data.length} bytes`);

    if (!isBinary) {
      console.warn('⚠️ Ignoring text WebSocket message');
      return;
    }

    const pkt = Buffer.from(data);

    if (!isArtNet(pkt)) {
      packetsRejected++;
      console.warn(`⚠️ REJECTED packet #${packetsRejected} — not valid Art-Net`);
      console.warn(`   Header: ${pkt.subarray(0, Math.min(16, pkt.length)).toString('hex')}`);
      return;
    }

    console.log('✅ Valid Art-Net packet received');
    console.log(`   Size: ${pkt.length} bytes`);
    console.log(`   OpCode: 0x${pkt.readUInt16LE(8).toString(16).padStart(4, '0')}`);

    sendArtNet(pkt);

    let visualiserCount = 0;
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        try {
          client.send(pkt, { binary: true });
          visualiserCount++;
        } catch (err) {
          console.error('❌ Visualiser broadcast failed:', err.message);
        }
      }
    });

    console.log(`📺 Forwarded packet to ${visualiserCount} other WebSocket client(s)`);
  });

  ws.on('error', err => {
    console.error(`❌ WebSocket client ERROR (${remote}):`, err.message);
  });

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

  wss.clients.forEach(client => {
    try { client.close(); } catch (_) {}
  });

  wss.close(() => {
    if (udpReady) {
      try { udp.close(); } catch (_) {}
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

module.exports = { sendArtNet };
