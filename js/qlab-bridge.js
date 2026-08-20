"use strict";

const WebSocket = require("ws");
const dgram = require("dgram");

const QLAB_IP = process.env.QLAB_IP || "127.0.0.1";
const QLAB_PORT = Number(process.env.QLAB_PORT || 53000);
const QLAB_REPLY_PORT = Number(process.env.QLAB_REPLY_PORT || 53001);
const QLAB_PASSWORD = String(process.env.QLAB_PASSWORD || "");
const WS_PORT = Number(process.env.QLAB_WS_PORT || 8083);
const POLL_MS = 250;
const EMPTY_PLAYBACK_CONFIRMATIONS = 2;

const udp = dgram.createSocket("udp4");
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Map();
let cues = [];
let activeCue = null;
let activeCueObject = null;
let timeTriggers = {};
let firedTriggers = new Set();
let pollTimer = null;
let lastElapsed = null;
let emptyPlaybackReplies = 0;
let shuttingDown = false;

function encodeString(value) {
  const raw = Buffer.from(`${value}\0`, "utf8");
  return Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4)]);
}
function tag(v) { return typeof v === "boolean" ? (v ? "T" : "F") : Number.isInteger(v) ? "i" : typeof v === "number" ? "f" : "s"; }
function arg(v) {
  if (typeof v === "boolean") return Buffer.alloc(0);
  if (Number.isInteger(v)) { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }
  if (typeof v === "number") { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; }
  return encodeString(String(v));
}
function encodeOsc(address, args = []) {
  const a = Array.isArray(args) ? args : [args];
  return Buffer.concat([encodeString(address), encodeString(`,${a.map(tag).join("")}`), ...a.map(arg)]);
}
function decodeString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  if (end >= buffer.length) throw new Error("Invalid OSC string");
  const next = end + 1 + ((4 - ((end + 1) % 4)) % 4);
  if (next > buffer.length) throw new Error("Truncated OSC packet");
  return { value: buffer.toString("utf8", offset, end), next };
}
function decodeOsc(buffer) {
  try {
    const address = decodeString(buffer, 0);
    const types = decodeString(buffer, address.next);
    const args = [];
    let offset = types.next;
    for (const t of types.value.startsWith(",") ? types.value.slice(1) : "") {
      if (t === "s") { const v = decodeString(buffer, offset); args.push(v.value); offset = v.next; }
      else if (t === "i" && offset + 4 <= buffer.length) { args.push(buffer.readInt32BE(offset)); offset += 4; }
      else if (t === "f" && offset + 4 <= buffer.length) { args.push(buffer.readFloatBE(offset)); offset += 4; }
      else if (t === "T") args.push(true);
      else if (t === "F") args.push(false);
      else if (t === "N") args.push(null);
    }
    return { address: address.value, args };
  } catch (error) {
    console.error("QLab OSC decode error:", error.message);
    return { address: "", args: [] };
  }
}
function sendOsc(address, args = []) {
  if (shuttingDown) return;
  const values = Array.isArray(args) ? args : [args];
  const packet = encodeOsc(address, QLAB_PASSWORD ? [QLAB_PASSWORD, ...values] : values);
  udp.send(packet, 0, packet.length, QLAB_PORT, QLAB_IP, error => {
    if (error) console.error("QLab UDP send error:", error.message);
  });
}
function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const [ws, client] of clients) {
    if (!client.authenticated || ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch (error) { console.error("QLab WebSocket send error:", error.message); }
  }
}
function replyData(args) {
  let value = args?.[0];
  if (typeof value === "string") { try { value = JSON.parse(value); } catch (_) {} }
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "data")) return value.data;
  return value;
}
function cueNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const s = value.trim();
    return s && !["none", "null", "undefined", "false"].includes(s.toLowerCase()) ? s : null;
  }
  if (typeof value === "object") {
    for (const key of ["number", "cueNumber", "cue", "playbackPosition", "id", "data"]) {
      const result = cueNumber(value[key]);
      if (result !== null) return result;
    }
  }
  return null;
}
function flatten(items, out = []) {
  if (!Array.isArray(items)) return out;
  for (const cue of items) {
    if (!cue) continue;
    out.push(cue);
    if (Array.isArray(cue.cues)) flatten(cue.cues, out);
  }
  return out;
}
function loadCues(data) {
  if (data?.data) return loadCues(data.data);
  const list = Array.isArray(data) ? data : Array.isArray(data?.cues) ? data.cues : Array.isArray(data?.cueLists) ? data.cueLists : [];
  cues = flatten(list);
  broadcast({ type: "qlab-cues", cues });
}
function findCue(number) {
  return cues.find(c => String(c?.number ?? c?.cueNumber ?? "") === String(number)) || null;
}
function setActiveCue(number) {
  const n = cueNumber(number);
  if (!n) {
    if (activeCue !== null) {
      activeCue = null;
      activeCueObject = null;
      firedTriggers.clear();
      lastElapsed = null;
      emptyPlaybackReplies = 0;
      broadcast({ type: "qlab-cue-stop" });
    }
    return;
  }
  emptyPlaybackReplies = 0;
  if (activeCue === n) return;
  activeCue = n;
  activeCueObject = findCue(n);
  firedTriggers.clear();
  lastElapsed = null;
  broadcast({ type: "qlab-cue-start", cueNumber: n, cue: activeCueObject });
}
function processTime(elapsed) {
  if (!activeCue || !Number.isFinite(elapsed)) return;
  if (lastElapsed !== null && elapsed < lastElapsed - 0.05) firedTriggers.clear();
  lastElapsed = elapsed;
  const triggers = Array.isArray(timeTriggers[activeCue]) ? timeTriggers[activeCue] : [];
  triggers.forEach((trigger, index) => {
    const at = Number(trigger?.time);
    const key = `${activeCue}:${index}`;
    if (!Number.isFinite(at) || elapsed < at || firedTriggers.has(key)) return;
    firedTriggers.add(key);
    broadcast({ type: "qlab-lighting-trigger", cueNumber: activeCue, elapsed, triggerTime: at, lights: Array.isArray(trigger?.lights) ? trigger.lights : [], reason: `QLab ${activeCue} reached ${at}s` });
  });
}
function handleReply(address, args) {
  const data = replyData(args);
  if (address.endsWith("/cueLists")) return loadCues(data);
  if (address.endsWith("/playbackPosition")) {
    const n = cueNumber(data);
    if (n) {
      emptyPlaybackReplies = 0;
      setActiveCue(n);
    } else {
      emptyPlaybackReplies += 1;
      if (emptyPlaybackReplies >= EMPTY_PLAYBACK_CONFIRMATIONS) setActiveCue(null);
    }
    if (activeCue) sendOsc(`/cue/${activeCue}/currentFileTime`);
    return;
  }
  if (address.endsWith("/currentFileTime") && activeCue) {
    const elapsed = Number(data);
    if (Number.isFinite(elapsed)) {
      processTime(elapsed);
      broadcast({ type: "qlab-time", cueNumber: activeCue, elapsed });
    }
  }
}
function handleUpdate(address) {
  const start = String(address).match(/^\/cue\/([^/]+)\/start$/);
  if (start) return setActiveCue(start[1]);
  const stop = String(address).match(/^\/cue\/([^/]+)\/stop$/);
  if (stop && String(stop[1]) === String(activeCue)) return setActiveCue(null);
  if (String(address).includes("/update/workspace/")) syncCues();
}
function syncCues() { sendOsc("/cueLists"); }
function pollQLab() { if (!shuttingDown) sendOsc("/playbackPosition"); }
function subscribe() { sendOsc("/updates", 1); sendOsc("/alwaysReply", 1); syncCues(); }

udp.on("message", message => {
  const osc = decodeOsc(message);
  if (!osc.address) return;
  if (osc.address.startsWith("/reply/")) handleReply(osc.address, osc.args);
  else handleUpdate(osc.address);
});
udp.on("error", error => console.error("QLab UDP error:", error.message));
wss.on("error", error => console.error("QLab WebSocket error:", error.message));

wss.on("connection", ws => {
  const client = { authenticated: !QLAB_PASSWORD };
  clients.set(ws, client);
  ws.send(JSON.stringify({ type: "status", connected: true, polling: POLL_MS, authenticated: client.authenticated }));
  if (client.authenticated) {
    if (cues.length) ws.send(JSON.stringify({ type: "qlab-cues", cues }));
    if (activeCue) ws.send(JSON.stringify({ type: "qlab-cue-start", cueNumber: activeCue, cue: activeCueObject }));
  }
  ws.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "auth") {
        client.authenticated = !QLAB_PASSWORD || String(message.passcode || "") === QLAB_PASSWORD;
        ws.send(JSON.stringify({ type: "auth", authenticated: client.authenticated }));
        if (!client.authenticated) ws.close(1008, "Authentication failed");
        else {
          if (cues.length) ws.send(JSON.stringify({ type: "qlab-cues", cues }));
          if (activeCue) ws.send(JSON.stringify({ type: "qlab-cue-start", cueNumber: activeCue, cue: activeCueObject }));
        }
        return;
      }
      if (!client.authenticated) return;
      if (message.type === "subscribe") return subscribe();
      if (message.type === "sync-cues") return syncCues();
      if (message.type === "set-time-triggers") { timeTriggers = message.triggers && typeof message.triggers === "object" ? message.triggers : {}; firedTriggers.clear(); return; }
      if (message.type === "check-playhead") return pollQLab();
      if ((message.type === "osc" || message.address) && typeof message.address === "string") {
        const address = message.address;
        if (address === "/playbackPosition" || /\/cue\/[^/]+\/currentFileTime$/.test(address)) return;
        sendOsc(address, Array.isArray(message.args) ? message.args : []);
      }
    } catch (error) { console.error("QLab WebSocket message error:", error.message); }
  });
  ws.on("close", () => clients.delete(ws));
  ws.on("error", error => console.error("QLab WebSocket client error:", error.message));
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  for (const [ws] of clients) {
    try { ws.close(1001, "Bridge shutting down"); } catch (_) {}
  }
  clients.clear();
  try { wss.close(); } catch (_) {}
  try { udp.close(); } catch (_) {}
}

udp.bind(QLAB_REPLY_PORT, QLAB_IP, () => {
  if (shuttingDown) return;
  console.log(`QLab bridge listening on UDP ${QLAB_REPLY_PORT}; WebSocket ${WS_PORT}; polling ${POLL_MS}ms`);
  pollTimer = setInterval(pollQLab, POLL_MS);
  pollQLab();
});

module.exports = { shutdown };
