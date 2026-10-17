"use strict";

// QLab Connect link: lets QLab Connect (or anything else that speaks OSC)
// fire Light Spark the way it fires a Zero 88 ZerOS desk.
//
// QLab Connect sends a desk command when a QLab cue tagged "LX 5", "LXP 2",
// "LXR 2" or "LXM 3" starts. Point its lighting desk at this computer (port
// 8830 unless changed) and Light Spark answers the same messages:
//   /zeros/cue/go/5        GO cue 5            (/zeros/cue/go/1/5: playback 1, cue 5)
//   /zeros/playback/go/2   run chase 2
//   /zeros/playback/release/2  stop chase 2
//   /zeros/macro/3         run effect 3
// plus simple ones for other software: /go, /back, /stop, /cue/5/go,
// /lightspark/blackout.
//
// OSC over UDP (QLab Connect's default) or TCP, in whichever framing QLab
// Connect uses (SLIP with or without a leading END, or a 4-byte length).

const dgram = require("dgram");
const net = require("net");
const fs = require("fs");
const os = require("os");

const DEFAULTS = { enabled: false, port: 8830, localOnly: false };

// ---------------------------------------------------------------- OSC

function readString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  const text = buffer.toString("utf8", offset, end);
  return [text, (end + 4) & ~3];
}

function decodeOsc(buffer) {
  const messages = [];
  if (!buffer || buffer.length < 4) return messages;
  if (buffer.toString("ascii", 0, 7) === "#bundle") {
    let offset = 16; // "#bundle\0" + timetag
    while (offset + 4 <= buffer.length) {
      const size = buffer.readInt32BE(offset);
      offset += 4;
      if (size <= 0 || offset + size > buffer.length) break;
      messages.push(...decodeOsc(buffer.subarray(offset, offset + size)));
      offset += size;
    }
    return messages;
  }
  let [address, offset] = readString(buffer, 0);
  if (!address.startsWith("/")) return messages;
  const args = [];
  if (offset < buffer.length && buffer[offset] === 44) { // ","
    let tags;
    [tags, offset] = readString(buffer, offset);
    for (const tag of tags.slice(1)) {
      if (tag === "i" && offset + 4 <= buffer.length) { args.push(buffer.readInt32BE(offset)); offset += 4; }
      else if (tag === "f" && offset + 4 <= buffer.length) { args.push(buffer.readFloatBE(offset)); offset += 4; }
      else if (tag === "s") { let s; [s, offset] = readString(buffer, offset); args.push(s); }
      else if (tag === "T") args.push(true);
      else if (tag === "F") args.push(false);
      else break;
    }
  }
  messages.push({ address, args });
  return messages;
}

// What an OSC message asks Light Spark to do, or null.
function commandFor({ address, args }) {
  const parts = address.split("/").filter(Boolean).map(p => p.toLowerCase());
  const number = value => (value != null && /^\d+(\.\d+)?$/.test(String(value)) ? String(value) : null);
  if (parts[0] === "zeros") {
    if (parts[1] === "cue" && parts[2] === "go") {
      // /zeros/cue/go/5 or /zeros/cue/go/<playback>/5
      const [a, b] = [number(parts[3]), number(parts[4])];
      if (b) return { kind: "cue", playback: a, cue: b };
      if (a) return { kind: "cue", playback: null, cue: a };
      if (number(args[0])) return { kind: "cue", playback: null, cue: number(args[0]) };
    }
    if (parts[1] === "playback" && number(parts[3])) {
      if (parts[2] === "go") return { kind: "chase", number: Number(parts[3]) };
      if (parts[2] === "release") return { kind: "release", number: Number(parts[3]) };
    }
    if (parts[1] === "macro" && number(parts[2])) return { kind: "effect", number: Number(parts[2]) };
    return null;
  }
  if (parts[0] === "lightspark") parts.shift();
  if (parts.length === 1 && ["go", "back", "stop", "blackout"].includes(parts[0])) return { kind: parts[0] };
  // /cue/5/go, /cue/5/start, /cue/go/5
  if (parts[0] === "cue") {
    const cue = number(parts[1]) || number(parts[2]);
    if (cue) return { kind: "cue", playback: null, cue };
  }
  return null;
}

// TCP: split a stream into OSC packets.
function tcpReader(onPacket) {
  let buffer = Buffer.alloc(0);
  let mode = null; // "slip" | "length"
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    // A length prefix starts with a 0 byte; OSC itself starts with "/" or "#".
    if (!mode) mode = buffer[0] === 0 ? "length" : "slip";
    if (mode === "length") {
      while (buffer.length >= 4) {
        const size = buffer.readInt32BE(0);
        if (size <= 0 || size > 65536) { buffer = Buffer.alloc(0); return; }
        if (buffer.length < 4 + size) return;
        onPacket(buffer.subarray(4, 4 + size));
        buffer = buffer.subarray(4 + size);
      }
      return;
    }
    let end;
    while ((end = buffer.indexOf(0xc0)) !== -1) {
      const frame = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      if (!frame.length) continue;
      const out = [];
      for (let i = 0; i < frame.length; i++) {
        if (frame[i] === 0xdb && i + 1 < frame.length) out.push(frame[++i] === 0xdc ? 0xc0 : 0xdb);
        else out.push(frame[i]);
      }
      onPacket(Buffer.from(out));
    }
  };
}

// ---------------------------------------------------------------- server

function createDeskLink({ configPath, onCommand, onInfo }) {
  let config = { ...DEFAULTS };
  try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, "utf8")) }; } catch (_) {}
  let udp = null, tcp = null, error = "", last = null, received = 0;

  const addresses = () => Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address);
  const info = () => ({ available: true, enabled: config.enabled, port: config.port, localOnly: config.localOnly, listening: Boolean(udp), error, last, received, addresses: addresses() });
  const changed = () => { try { onInfo?.(info()); } catch (_) {} };
  const save = () => { try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch (_) {} };

  function handle(packet, from) {
    for (const message of decodeOsc(packet)) {
      const command = commandFor(message);
      last = { at: new Date().toISOString(), address: message.address, from, understood: Boolean(command) };
      received++;
      if (command) onCommand?.({ ...command, address: message.address, from });
      changed();
    }
  }

  function stop() {
    try { udp?.close(); } catch (_) {}
    try { tcp?.close(); } catch (_) {}
    udp = null; tcp = null;
  }

  function start() {
    stop();
    error = "";
    if (!config.enabled) { changed(); return; }
    const host = config.localOnly ? "127.0.0.1" : "0.0.0.0";
    udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
    udp.on("message", (packet, remote) => handle(packet, remote.address));
    udp.on("error", err => { error = err.code === "EADDRINUSE" ? `Port ${config.port} is already in use by another app` : err.message; stop(); changed(); });
    udp.bind(config.port, host, () => changed());
    tcp = net.createServer(socket => {
      const read = tcpReader(packet => handle(packet, socket.remoteAddress));
      socket.on("data", read);
      socket.on("error", () => {});
    });
    tcp.on("error", () => { try { tcp.close(); } catch (_) {} tcp = null; }); // UDP still works
    tcp.listen(config.port, host);
    changed();
  }

  start();
  return {
    info,
    configure(next) {
      const port = Number(next?.port);
      config = {
        enabled: next?.enabled != null ? Boolean(next.enabled) : config.enabled,
        port: Number.isInteger(port) && port > 1023 && port < 65536 ? port : config.port,
        localOnly: next?.localOnly != null ? Boolean(next.localOnly) : config.localOnly
      };
      save();
      start();
      return info();
    },
    close: stop
  };
}

module.exports = { createDeskLink, decodeOsc, commandFor, tcpReader };
