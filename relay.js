const WebSocket = require('ws');
const dgram = require('dgram');

const WS_PORT = Number(process.env.ARTNET_WS_PORT || 8081);
const ARTNET_PORT = 6454;
const ARTNET_BROADCAST = process.env.ARTNET_BROADCAST || '255.255.255.255';

const udp = dgram.createSocket('udp4');

udp.on('error', err => {
  console.error('❌ UDP ERROR:', err.message);
});

udp.bind(0, '0.0.0.0', () => {
  try {
    udp.setBroadcast(true);
  } catch (err) {
    console.error('❌ Unable to enable UDP broadcast:', err.message);
  }
  console.log(`✅ UDP READY — source port ${udp.address().port}`);
  console.log('📡 Broadcast target:', ARTNET_BROADCAST);
});

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`✅ WEBSOCKET READY — Port ${WS_PORT}`);
  console.log('🎛 ART-NET RELAY FULLY RUNNING');
});

wss.on('error', err => {
  console.error('❌ WEBSOCKET ERROR:', err.message);
});

function sendArtNet(packet) {
  udp.send(packet, ARTNET_PORT, ARTNET_BROADCAST, err => {
    if (err) console.error('❌ Art-Net UDP send error:', err.message);
  });
}

wss.on('connection', ws => {
  console.log('🔌 CONSOLE CONNECTED TO RELAY');

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;

    const pkt = Buffer.from(data);
    if (pkt.length < 8 || pkt.toString('ascii', 0, 8) !== 'Art-Net\0') return;

    sendArtNet(pkt);

    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        try {
          client.send(pkt, { binary: true });
        } catch (err) {
          console.error('❌ Visualiser broadcast error:', err.message);
        }
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

process.once('SIGINT', () => {
  wss.close();
  udp.close();
});
