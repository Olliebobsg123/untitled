const WebSocket = require("ws");
const dgram = require("dgram");

const WS_PORT = 8081;
const ARTNET_PORT = 6454;
const ARTNET_BROADCAST = "192.168.1.1";

const udp = dgram.createSocket("udp4");

udp.on("error", err => {
  console.error("❌ UDP ERROR:", err.message);
});

udp.bind(ARTNET_PORT, "0.0.0.0", () => {
  udp.setBroadcast(true);

  console.log("✅ UDP READY — Port 6454");
  console.log("📡 Broadcast target:", ARTNET_BROADCAST);
});

const wss = new WebSocket.Server({
  port: WS_PORT
});

wss.on("listening", () => {
  console.log("✅ WEBSOCKET READY — Port 8081");
  console.log("🎛 ART-NET RELAY FULLY RUNNING");
});

wss.on("error", err => {
  console.error("❌ WEBSOCKET ERROR:", err.message);
});

wss.on("connection", ws => {

  console.log("🔌 CONSOLE CONNECTED TO RELAY");

  ws.on("message", (data, isBinary) => {

    if (!isBinary) return;

    const pkt = Buffer.from(data);

    if (
      pkt.length >= 8 &&
      pkt.toString("ascii", 0, 8) === "Art-Net\0"
    ) {

     
      udp.send(
        pkt,
        0,
        pkt.length,
        ARTNET_PORT,
        ARTNET_BROADCAST,
        err => {

        }
      );

      // Send copy to visualiser
      wss.clients.forEach(client => {

        if (client.readyState === WebSocket.OPEN) {
          client.send(pkt);
        }

      });
    }

  });

  ws.on("close", () => {
    console.log("🔌 CONSOLE DISCONNECTED FROM RELAY");
  });

});