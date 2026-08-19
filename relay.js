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
  // ArtDMX needs the 8-byte ID plus opcode at bytes 8–9.
  // Reject undersized packets before readUInt16LE(8) can throw.
  return Buffer.isBuffer(packet) &&
    packet.length >= 10 &&
    packet.subarray(0, 8).equals(Buffer.from('Art-Net\0'));
}

function sendArtNet(packet) {
  if (shuttingDown) return;

  if (!udpReady) {
    packetsRejected++;
    return;
  }

  udp.send(packet, 0, packet.length, ARTNET_PORT, ARTNET_TARGET, err => {
    if (err) {
      console.error(`❌ Art-Net UDP SEND FAILED → ${ARTNET_TARGET}:${ARTNET_PORT}:`, err.message);
      return;
    }

    packetsSent++;
  });
}

wss.on('connection', (ws, request) => {
  const remote = request?.socket?.remoteAddress || 'unknown';
  console.log(`🔌 WEBSOCKET CLIENT CONNECTED ← ${remote}`);
  console.log(`👥 Connected clients: ${wss.clients.size}`);

  ws.on('message', (data, isBinary) => {
    packetsReceived++;

    if (!isBinary) {
      packetsRejected++;
      return;
    }

    const pkt = Buffer.from(data);

    if (!isArtNet(pkt)) {
      packetsRejected++;
      console.warn(`⚠️ REJECTED invalid Art-Net packet #${packetsRejected} (${pkt.length} bytes)`);
      return;
    }

    sendArtNet(pkt);

    // Forward valid Art-Net frames to visualiser clients without echoing the
    // frame back to the sender. This avoids an unnecessary extra browser event.
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        try {
          client.send(pkt, { binary: true });
        } catch (err) {
          console.error('❌ Visualiser broadcast failed:', err.message);
        }
      }
    });
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
