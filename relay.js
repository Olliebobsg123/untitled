const WebSocket = require('ws');
const dgram = require('dgram');

const WS_PORT = Number(process.env.ARTNET_WS_PORT || 8081);
const ARTNET_PORT = 6454;
const ARTNET_BROADCAST = process.env.ARTNET_BROADCAST || '192.168.1.255';

const udp = dgram.createSocket('udp4');
let udpReady = false;
let shuttingDown = false;

udp.on('error', err => {
  console.error('❌ UDP ERROR:', err.message);
});

udp.bind(0, '0.0.0.0', () => {
  try {
    udp.setBroadcast(true);
  } catch (err) {
    console.error('❌ Unable to enable UDP broadcast:', err.message);
  }

  udpReady = true;
  console.log(`✅ UDP READY — source port ${udp.address().port}`);
  console.log(`📡 Art-Net target: ${ARTNET_BROADCAST}:${ARTNET_PORT}`);
});

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`✅ WEBSOCKET READY — Port ${WS_PORT}`);
  console.log('🎛 ART-NET RELAY FULLY RUNNING');
});

wss.on('error', err => {
  console.error('❌ WEBSOCKET ERROR:', err.message);
});

function isArtNet(packet) {
  return Buffer.isBuffer(packet) &&
    packet.length >= 18 &&
    packet.subarray(0, 8).equals(Buffer.from('Art-Net\0'));
}

function sendArtNet(packet) {
  if (!udpReady || shuttingDown) return;

  udp.send(packet, ARTNET_PORT, ARTNET_BROADCAST, err => {
    if (err) console.error('❌ Art-Net UDP send error:', err.message);
  });
}

wss.on('connection', ws => {
  console.log('🔌 CONSOLE CONNECTED TO RELAY');

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;

    const pkt = Buffer.from(data);
    if (!isArtNet(pkt)) return;

    sendArtNet(pkt);

    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(pkt, { binary: true });
      }
    });
  });

  ws.on('error', err => {
    console.error('❌ Relay client error:', err.message);
  });

  ws.on('close', () => {
    console.log('🔌 CONSOLE DISCONNECTED FROM RELAY');
  });
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('🛑 Shutting down Art-Net relay...');

  wss.clients.forEach(client => {
    try { client.close(); } catch (_) {}
  });

  wss.close(() => {
    if (!udpReady) return;
    try { udp.close(); } catch (_) {}
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

module.exports = { sendArtNet };
