"use strict";

// Multi-console link: one Light Spark is the PRIMARY; BACKUP, CLIENT and
// MIRROR consoles connect to it over the network.
//
// The primary listens on a WebSocket (port 8850) and announces itself on
// the LAN with a small UDP beacon every second (port 8851), so the others
// can list it on their start screen. A PIN (optional) keeps strangers out.
// Messages are JSON; this process only carries them — the show itself
// lives in each console's renderer (js/session.js).
//
//   start({ role, name, port, pin, host })   stop()   send(msg, to?)
//   info()  discovered()

const http = require("http");
const os = require("os");
const dgram = require("dgram");
const crypto = require("crypto");
const WebSocket = require("ws");

const BEACON_PORT = Number(process.env.LX_SESSION_BEACON_PORT || 8851);
const ROLES = new Set(["standalone", "primary", "backup", "client", "mirror"]);

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  return out;
}
function broadcastAddresses() {
  const out = new Set(["255.255.255.255", "127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal || !a.netmask) continue;
      const ip = a.address.split(".").map(Number), mask = a.netmask.split(".").map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join("."));
    }
  }
  return [...out];
}

function createSessionLink({ onMessage, onStatus }) {
  let cfg = { role: "standalone", name: os.hostname(), port: 8850, pin: "", host: "" };
  let server = null, wss = null;           // primary
  let socket = null, retry = null;         // backup / client / mirror
  let beaconTimer = null, beaconOut = null, beaconIn = null;
  const peers = new Map();                 // id -> { ws, name, role, address, inControl }
  const seen = new Map();                  // "host:port" -> { name, host, port, pin, at }
  let connected = false, lastError = "";

  const emit = () => { try { onStatus?.(info()); } catch (_) {} };
  const deliver = (from, msg) => { try { onMessage?.(from, msg); } catch (_) {} };

  function info() {
    return {
      role: cfg.role, name: cfg.name, port: cfg.port, host: cfg.host, pin: Boolean(cfg.pin),
      addresses: addresses(), listening: Boolean(server), connected, error: lastError,
      peers: [...peers.entries()].map(([id, p]) => ({ id, name: p.name, role: p.role, address: p.address, inControl: Boolean(p.inControl) }))
    };
  }
  function discovered() {
    const now = Date.now();
    return [...seen.values()].filter(s => now - s.at < 3500).map(({ at, ...s }) => s);
  }

  // ------------------------------------------------------------ primary

  function startPrimary() {
    server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Light Spark session\n"); });
    wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 * 1024 });
    wss.on("connection", (ws, req) => {
      const id = crypto.randomBytes(4).toString("hex");
      const address = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
      let hello = null;
      ws.on("message", data => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch (_) { return; }
        if (!hello) {
          if (msg.type !== "hello") return ws.close(4000, "say hello first");
          if (cfg.pin && String(msg.pin || "") !== String(cfg.pin)) { ws.send(JSON.stringify({ type: "denied", reason: "Wrong PIN" })); return ws.close(4001, "wrong PIN"); }
          if (!ROLES.has(msg.role) || msg.role === "primary" || msg.role === "standalone") { ws.send(JSON.stringify({ type: "denied", reason: "Another primary is on this address" })); return ws.close(4002, "not a peer role"); }
          hello = msg;
          // Only a backup can be running the show.
          if (msg.role !== "backup") msg.inControl = false;
          peers.set(id, { ws, name: String(msg.name || address), role: msg.role, address, inControl: Boolean(msg.inControl) });
          ws.send(JSON.stringify({ type: "welcome", id, name: cfg.name }));
          deliver(id, { ...msg, type: "joined", id });
          emit();
          return;
        }
        if (msg.type === "control") { const p = peers.get(id); if (p) { if (p.role !== "backup") return; p.inControl = Boolean(msg.inControl); } emit(); }
        deliver(id, msg);
      });
      ws.on("close", () => { if (peers.delete(id)) { deliver(id, { type: "left", id }); emit(); } });
      ws.on("error", () => {});
    });
    server.on("error", error => { lastError = error.code === "EADDRINUSE" ? `Port ${cfg.port} is in use — is another Light Spark primary running on this computer?` : error.message; emit(); });
    server.listen(cfg.port, "0.0.0.0", () => { lastError = ""; emit(); });
    // Beacon: tell the LAN we're here.
    beaconOut = dgram.createSocket({ type: "udp4", reuseAddr: true });
    beaconOut.on("error", () => {});
    beaconOut.bind(() => {
      try { beaconOut.setBroadcast(true); } catch (_) {}
      const tick = () => {
        const msg = Buffer.from(JSON.stringify({ lightspark: 1, name: cfg.name, port: cfg.port, pin: Boolean(cfg.pin), addresses: addresses() }));
        for (const to of broadcastAddresses()) beaconOut.send(msg, BEACON_PORT, to, () => {});
      };
      tick();
      beaconTimer = setInterval(tick, 1000);
    });
  }

  // ------------------------------------------------- backup/client/mirror

  function connect() {
    clearTimeout(retry);
    if (!cfg.host || socket) return;
    const url = `ws://${cfg.host.includes(":") && !cfg.host.startsWith("[") ? cfg.host : `${cfg.host}:${cfg.port}`}`;
    let ws;
    try { ws = new WebSocket(url, { handshakeTimeout: 3000, maxPayload: 64 * 1024 * 1024 }); } catch (error) { lastError = error.message; emit(); retry = setTimeout(connect, 1000); return; }
    socket = ws;
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", role: cfg.role, name: cfg.name, pin: cfg.pin, inControl: Boolean(cfg.inControl) })));
    ws.on("message", data => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (_) { return; }
      if (msg.type === "welcome") { connected = true; lastError = ""; emit(); }
      if (msg.type === "denied") { lastError = msg.reason || "Refused"; emit(); }
      deliver("primary", msg);
    });
    ws.on("close", () => {
      const was = connected;
      socket = null; connected = false;
      if (was) deliver("primary", { type: "lost" });
      emit();
      if (cfg.role !== "standalone" && cfg.role !== "primary") retry = setTimeout(connect, 1000);
    });
    ws.on("error", error => { lastError = error.code === "ECONNREFUSED" ? `No Light Spark primary at ${cfg.host}` : error.message; emit(); });
  }

  // Everyone listens for beacons, so the start screen can list primaries.
  function listen() {
    if (beaconIn) return;
    beaconIn = dgram.createSocket({ type: "udp4", reuseAddr: true });
    beaconIn.on("error", () => {});
    beaconIn.on("message", (data, rinfo) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.lightspark !== 1) return;
        const host = rinfo.address;
        const key = `${msg.name}|${msg.port}`;
        // The same primary heard on several interfaces: keep one, preferring a LAN address.
        const before = seen.get(key);
        const keepHost = before && before.host !== "127.0.0.1" && host === "127.0.0.1" ? before.host : host;
        seen.set(key, { name: String(msg.name || host), host: keepHost, port: Number(msg.port) || 8850, pin: Boolean(msg.pin), at: Date.now() });
      } catch (_) {}
    });
    beaconIn.bind(BEACON_PORT);
  }

  // ------------------------------------------------------------ control

  function stop() {
    clearInterval(beaconTimer); beaconTimer = null;
    try { beaconOut?.close(); } catch (_) {} beaconOut = null;
    clearTimeout(retry); retry = null;
    try { socket?.close(); } catch (_) {} socket = null; connected = false;
    for (const p of peers.values()) { try { p.ws.close(); } catch (_) {} }
    peers.clear();
    try { wss?.close(); } catch (_) {} wss = null;
    try { server?.close(); } catch (_) {} server = null;
  }

  function start(next = {}) {
    stop();
    cfg = {
      ...cfg, ...next,
      role: ROLES.has(next.role) ? next.role : "standalone",
      name: String(next.name || cfg.name || os.hostname()).slice(0, 60),
      port: Number(next.port) || 8850,
      pin: String(next.pin || ""),
      host: String(next.host || "").trim(),
      inControl: Boolean(next.inControl)
    };
    lastError = "";
    listen();
    if (cfg.role === "primary") startPrimary();
    else if (cfg.role !== "standalone") connect();
    emit();
    return info();
  }

  // Primary: to one peer or all of them (except `except`). Others: to the primary.
  function send(msg, to = null, except = null) {
    const text = JSON.stringify(msg);
    if (cfg.role === "primary") {
      for (const [id, p] of peers) {
        if ((to && id !== to) || id === except || p.ws.readyState !== WebSocket.OPEN) continue;
        if (p.ws.bufferedAmount > 32 * 1024 * 1024) continue; // a stuck peer doesn't stall everyone
        try { p.ws.send(text); } catch (_) {}
      }
      return true;
    }
    if (socket?.readyState === WebSocket.OPEN) { try { socket.send(text); return true; } catch (_) {} }
    return false;
  }
  function setInControl(on) { cfg.inControl = Boolean(on); }

  listen();
  return { start, stop, send, info, discovered, setInControl };
}

module.exports = { createSessionLink };
