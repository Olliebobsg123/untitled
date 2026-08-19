// ============================================================
// QLAB 5 ↔ LIGHTING BRIDGE
// ============================================================
// The bridge is the single source of truth for QLab polling.
// It polls playbackPosition, then requests currentFileTime only
// after that reply arrives. This prevents overlapping/duplicate
// QLab queries which could make the UI update extremely quickly.
// ============================================================

const WebSocket = require("ws");
const dgram = require("dgram");

const QLAB_IP = "127.0.0.1";
const QLAB_PORT = 53000;
const QLAB_REPLY_PORT = 53001;
const QLAB_PASSWORD = "";
const WS_PORT = 8083;
const POLL_MS = 250;

const udp = dgram.createSocket("udp4");
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Set();

let cues = [];
let activeCue = null;
let activeCueObject = null;
let activeCueType = "";
let timeTriggers = {};
let firedTriggers = new Set();
let pollTimer = null;
let pollInFlight = false;

function encodeString(value) {
  const raw = Buffer.from(`${value}\0`, "utf8");
  const padding = (4 - (raw.length % 4)) % 4;
  return Buffer.concat([raw, Buffer.alloc(padding)]);
}

function getTypeTag(value) {
  if (typeof value === "boolean") return value ? "T" : "F";
  if (Number.isInteger(value)) return "i";
  if (typeof value === "number") return "f";
  return "s";
}

function encodeArgument(value) {
  if (typeof value === "boolean") return Buffer.alloc(0);
  if (Number.isInteger(value)) {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(value);
    return buf;
  }
  if (typeof value === "number") {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(value);
    return buf;
  }
  return encodeString(String(value));
}

function encodeOsc(address, args = []) {
  const safeArgs = Array.isArray(args) ? args : [args];
  const tags = safeArgs.map(getTypeTag).join("");
  return Buffer.concat([
    encodeString(address),
    encodeString(`,${tags}`),
    ...safeArgs.map(encodeArgument)
  ]);
}

function decodeOscString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  const value = buffer.toString("utf8", offset, end);
  const nextOffset = end + 1 + ((4 - ((end + 1) % 4)) % 4);
  return { value, nextOffset };
}

function decodeOsc(buffer) {
  try {
    const address = decodeOscString(buffer, 0);
    const tags = decodeOscString(buffer, address.nextOffset);
    const args = [];
    let offset = tags.nextOffset;

    if (!tags.value.startsWith(",")) return { address: address.value, args };

    for (const tag of tags.value.slice(1)) {
      if (tag === "s") {
        const value = decodeOscString(buffer, offset);
        args.push(value.value);
        offset = value.nextOffset;
      } else if (tag === "i") {
        if (offset + 4 > buffer.length) break;
        args.push(buffer.readInt32BE(offset));
        offset += 4;
      } else if (tag === "f") {
        if (offset + 4 > buffer.length) break;
        args.push(buffer.readFloatBE(offset));
        offset += 4;
      } else if (tag === "T") args.push(true);
      else if (tag === "F") args.push(false);
      else if (tag === "N") args.push(null);
    }

    return { address: address.value, args };
  } catch (error) {
    console.error("❌ OSC decode error:", error);
    return { address: "", args: [] };
  }
}

function sendOsc(address, args = []) {
  let safeArgs = Array.isArray(args) ? args : [args];
  if (QLAB_PASSWORD) safeArgs = [QLAB_PASSWORD, ...safeArgs];

  const packet = encodeOsc(address, safeArgs);
  udp.send(packet, 0, packet.length, QLAB_PORT, QLAB_IP, error => {
    if (error) console.error("❌ QLab UDP send error:", error.message);
  });
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch (error) {
      console.error("WebSocket send error:", error.message);
    }
  }
}

function parseQLabReply(address, args) {
  if (!String(address).startsWith("/reply/") || !Array.isArray(args) || !args.length) return null;
  let value = args[0];
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { return { status: "ok", data: value }; }
  }
  if (value && typeof value === "object") return value;
  return { status: "ok", data: value };
}

function extractReplyData(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  return Object.prototype.hasOwnProperty.call(value, "data") ? value.data : value;
}

function extractCueNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || ["none", "null", "undefined", "false"].includes(text.toLowerCase())) return null;
    return text;
  }
  if (typeof value === "object") {
    for (const candidate of [value.number, value.cueNumber, value.cue, value.playbackPosition, value.id, value.data]) {
      const result = extractCueNumber(candidate);
      if (result !== null) return result;
    }
  }
  return null;
}

function findCue(number) {
  const wanted = String(number);
  return cues.find(cue => String(cue?.number ?? cue?.cueNumber ?? "") === wanted);
}

function flattenCues(items, output = []) {
  if (!Array.isArray(items)) return output;
  for (const cue of items) {
    if (!cue) continue;
    output.push(cue);
    if (Array.isArray(cue.cues)) flattenCues(cue.cues, output);
  }
  return output;
}

function loadCues(data) {
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.cues)) list = data.cues;
  else if (data && Array.isArray(data.cueLists)) list = data.cueLists;
  else if (data && data.data) return loadCues(data.data);

  cues = flattenCues(list);
  console.log(`🎼 Loaded ${cues.length} QLab cues`);
  broadcast({ type: "qlab-cues", cues });
}

function setActiveCue(number) {
  const empty = number === null || number === undefined || String(number).trim() === "" ||
    ["none", "null", "undefined", "false"].includes(String(number).trim().toLowerCase());

  if (empty) {
    if (activeCue !== null) {
      activeCue = null;
      activeCueObject = null;
      activeCueType = "";
      firedTriggers.clear();
      broadcast({ type: "qlab-cue-stop" });
    }
    return;
  }

  const newCue = String(number).trim();
  if (!newCue || activeCue === newCue) return;

  activeCue = newCue;
  activeCueObject = findCue(newCue);
  activeCueType = String(activeCueObject?.type ?? activeCueObject?.cueType ?? "").toLowerCase();
  firedTriggers.clear();

  broadcast({ type: "qlab-cue-start", cueNumber: activeCue, cue: activeCueObject || null });
}

function processTime(cueNumber, elapsed) {
  const q = String(cueNumber);
  const triggers = timeTriggers[q] || [];

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    const triggerTime = Number(trigger?.time);
    if (!Number.isFinite(triggerTime)) continue;

    const key = `${q}:${i}`;
    if (elapsed < triggerTime || firedTriggers.has(key)) continue;

    firedTriggers.add(key);
    const lights = Array.isArray(trigger?.lights) ? trigger.lights : [];
    broadcast({
      type: "qlab-lighting-trigger",
      cueNumber: q,
      elapsed,
      triggerTime,
      lights,
      reason: `QLab ${q} reached ${triggerTime}s`
    });
  }
}

function handleQLabReply(address, reply) {
  if (reply && reply.status && reply.status !== "ok") {
    console.error("❌ QLab returned error:", reply);
    if (address.endsWith("/playbackPosition")) pollInFlight = false;
    return;
  }

  const data = extractReplyData(reply);

  if (address.endsWith("/cueLists")) {
    loadCues(data);
    return;
  }

  if (address.endsWith("/playbackPosition")) {
    // One request chain: playbackPosition -> currentFileTime.
    pollInFlight = false;

    const cueNumber = extractCueNumber(data);
    if (cueNumber === null) {
      if (activeCue !== null) setActiveCue(null);
      return;
    }

    setActiveCue(cueNumber);
    if (activeCue) sendOsc(`/cue/${String(activeCue).trim()}/currentFileTime`);
    return;
  }

  if (address.endsWith("/currentFileTime")) {
    if (!activeCue) return;
    const elapsed = Number(data);
    if (!Number.isFinite(elapsed)) return;

    processTime(activeCue, elapsed);
    broadcast({ type: "qlab-time", cueNumber: activeCue, elapsed });
  }
}

function handleQLabUpdate(address) {
  const startMatch = String(address).match(/^\/cue\/([^/]+)\/start$/);
  if (startMatch) {
    setActiveCue(startMatch[1]);
    return;
  }

  const stopMatch = String(address).match(/^\/cue\/([^/]+)\/stop$/);
  if (stopMatch && activeCue === String(stopMatch[1])) setActiveCue(null);
  if (String(address).includes("/update/workspace/")) syncCues();
}

udp.on("message", msg => {
  const osc = decodeOsc(msg);
  if (String(osc.address).startsWith("/reply/")) {
    const reply = parseQLabReply(osc.address, osc.args);
    if (reply) handleQLabReply(osc.address, reply);
    return;
  }
  handleQLabUpdate(osc.address);
});

function syncCues() {
  sendOsc("/cueLists");
}

function subscribeToQLab() {
  sendOsc("/updates", 1);
  sendOsc("/alwaysReply", 1);
  syncCues();
}

function pollQLab() {
  // Never queue another playbackPosition request while one is waiting.
  if (pollInFlight) return;
  pollInFlight = true;
  sendOsc("/playbackPosition");
}

function startDurationWatcher() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollQLab, POLL_MS);
  pollQLab();
}

wss.on("connection", ws => {
  clients.add(ws);

  ws.send(JSON.stringify({ type: "status", connected: true, polling: POLL_MS }));
  if (cues.length) ws.send(JSON.stringify({ type: "qlab-cues", cues }));
  if (activeCue) ws.send(JSON.stringify({ type: "qlab-cue-start", cueNumber: activeCue, cue: activeCueObject || null }));

  ws.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === "subscribe") return subscribeToQLab();
      if (message.type === "sync-cues") return syncCues();

      if (message.type === "set-time-triggers") {
        timeTriggers = message.triggers && typeof message.triggers === "object" ? message.triggers : {};
        firedTriggers.clear();
        return;
      }

      if (message.type === "osc" && typeof message.address === "string") {
        // qlab.js may still send its old polling request. Ignore it because
        // the bridge now owns the polling loop.
        if (message.address === "/playbackPosition") return;
        sendOsc(message.address, Array.isArray(message.args) ? message.args : []);
        return;
      }

      if (typeof message.address === "string") {
        if (message.address === "/playbackPosition") return;
        sendOsc(message.address, Array.isArray(message.args) ? message.args : []);
      }
    } catch (error) {
      console.error("❌ WebSocket message error:", error);
    }
  });

  ws.on("close", () => clients.delete(ws));
});

udp.on("error", error => console.error("❌ UDP ERROR:", error.message));
wss.on("error", error => console.error("❌ WEBSOCKET ERROR:", error.message));

udp.bind(QLAB_REPLY_PORT, QLAB_IP, () => {
  console.log(`✅ UDP LISTENING ON ${QLAB_REPLY_PORT}`);
  console.log(`⏱ ${POLL_MS}ms QLAB POLLING STARTING`);
  startDurationWatcher();
});
