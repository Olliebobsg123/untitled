"use strict";

const WebSocket = require("ws");
const dgram = require("dgram");

const QLAB_IP = process.env.QLAB_IP || "127.0.0.1";
const QLAB_PORT = Number(process.env.QLAB_PORT || 53000);
const QLAB_REPLY_PORT = Number(process.env.QLAB_REPLY_PORT || 53001);
const QLAB_PASSWORD = String(process.env.QLAB_PASSWORD || "");
const WS_PORT = Number(process.env.QLAB_WS_PORT || 8083);
const POLL_MS = 250;
const END_EPSILON = 0.15;
const EMPTY_ACTIVE_CONFIRMATIONS = 2;

const udp = dgram.createSocket("udp4");
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Map();

let cues = [];
let activeCue = null;
let activeCueObject = null;
let activeDuration = null;
let timeTriggers = {};
let firedTriggers = new Set();
let pollTimer = null;
let lastElapsed = null;
let emptyActiveReplies = 0;
let shuttingDown = false;

function encodeString(value) {
  const raw = Buffer.from(`${value}\0`, "utf8");
  return Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4)]);
}

function tag(v) {
  return typeof v === "boolean" ? (v ? "T" : "F") :
    Number.isInteger(v) ? "i" : typeof v === "number" ? "f" : "s";
}

function arg(v) {
  if (typeof v === "boolean") return Buffer.alloc(0);
  if (Number.isInteger(v)) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    return b;
  }
  if (typeof v === "number") {
    const b = Buffer.alloc(4);
    b.writeFloatBE(v);
    return b;
  }
  return encodeString(String(v));
}

function encodeOsc(address, args = []) {
  const a = Array.isArray(args) ? args : [args];
  return Buffer.concat([
    encodeString(address),
    encodeString(`,${a.map(tag).join("")}`),
    ...a.map(arg)
  ]);
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
      if (t === "s") {
        const v = decodeString(buffer, offset);
        args.push(v.value);
        offset = v.next;
      } else if (t === "i" && offset + 4 <= buffer.length) {
        args.push(buffer.readInt32BE(offset));
        offset += 4;
      } else if (t === "f" && offset + 4 <= buffer.length) {
        args.push(buffer.readFloatBE(offset));
        offset += 4;
      } else if (t === "T") args.push(true);
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
    try { ws.send(payload); } catch (error) {
      console.error("QLab WebSocket send error:", error.message);
    }
  }
}

function replyData(args) {
  let value = args?.[0];
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch (_) {}
  }
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "data")) {
    return value.data;
  }
  return value;
}

function cueNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || ["none", "null", "undefined", "false"].includes(s.toLowerCase())) return null;
    return s;
  }
  if (value && typeof value === "object") {
    for (const key of ["number", "cueNumber", "cue", "playbackPosition", "id", "uniqueID", "uniqueId", "data"]) {
      const result = cueNumber(value[key]);
      if (result !== null) return result;
    }
  }
  return null;
}

function cueId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    return String(value.uniqueID ?? value.uniqueId ?? value.id ?? value.number ?? value.cueNumber ?? "") || null;
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
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.cues)
      ? data.cues
      : Array.isArray(data?.cueLists)
        ? data.cueLists
        : [];
  cues = flatten(list);
  broadcast({ type: "qlab-cues", cues });
}

function findCue(number) {
  return cues.find(c => String(c?.number ?? c?.cueNumber ?? "") === String(number)) || null;
}

function findCueById(id) {
  return cues.find(c => String(c?.uniqueID ?? c?.uniqueId ?? c?.id ?? "") === String(id)) || null;
}

function isFileCue(cue) {
  const type = String(cue?.type ?? cue?.cueType ?? "").toLowerCase();
  return ["audio", "video", "mic", "camera"].includes(type) ||
    type.includes("audio") || type.includes("video");
}

function isInfinite(cue) {
  return cue?.infiniteLoop === true || cue?.loop === true || Number(cue?.infiniteLoop) === 1;
}

function queryActiveCueState() {
  if (!activeCue) return;
  // QLab 5 exposes these as authoritative read-only properties.
  sendOsc(`/cue/${activeCue}/currentDuration`);
  sendOsc(`/cue/${activeCue}/currentFileTime`);
  sendOsc(`/cue/${activeCue}/isRunning`);
}

function setActiveCue(number, cueObject = null) {
  const n = cueNumber(number);

  if (!n) {
    if (activeCue !== null) {
      const stoppedCue = activeCue;
      activeCue = null;
      activeCueObject = null;
      activeDuration = null;
      firedTriggers.clear();
      lastElapsed = null;
      emptyActiveReplies = 0;
      broadcast({ type: "qlab-cue-stop", cueNumber: stoppedCue });
    }
    return;
  }

  emptyActiveReplies = 0;
  if (activeCue === n) {
    if (cueObject) activeCueObject = cueObject;
    queryActiveCueState();
    return;
  }

  activeCue = n;
  activeCueObject = cueObject || findCue(n);
  activeDuration = Number(activeCueObject?.duration ?? activeCueObject?.currentDuration);
  if (!Number.isFinite(activeDuration) || activeDuration <= 0) activeDuration = null;

  firedTriggers.clear();
  lastElapsed = null;

  broadcast({
    type: "qlab-cue-start",
    cueNumber: n,
    cue: activeCueObject,
    duration: activeDuration
  });

  queryActiveCueState();
}

function chooseRunningFileCue(data) {
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (_) {}
  }

  const list = flatten(
    Array.isArray(data) ? data :
      Array.isArray(data?.cues) ? data.cues :
        Array.isArray(data?.data) ? data.data : []
  );

  // Prefer an actual file cue. This prevents a selected/playhead cue or a
  // simultaneous fade/group cue from becoming the lighting timeline clock.
  const fileCue = list.find(isFileCue);
  if (fileCue) {
    return {
      number: cueNumber(fileCue),
      cue: fileCue
    };
  }

  // /runningCues/shallow can return IDs rather than dictionaries.
  for (const item of list) {
    const id = cueId(item);
    const local = id ? findCueById(id) : null;
    if (local && isFileCue(local)) {
      return { number: cueNumber(local), cue: local };
    }
  }

  return null;
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
    broadcast({
      type: "qlab-lighting-trigger",
      cueNumber: activeCue,
      elapsed,
      triggerTime: at,
      lights: Array.isArray(trigger?.lights) ? trigger.lights : [],
      reason: `QLab ${activeCue} reached ${at}s`
    });
  });
}

function finishActiveCue(elapsed) {
  if (!activeCue) return;
  const finishedCue = activeCue;
  const duration = activeDuration;

  broadcast({
    type: "qlab-time",
    cueNumber: finishedCue,
    elapsed,
    duration,
    remaining: 0,
    percent: 100,
    ended: true
  });

  setActiveCue(null);
}

function handleRunningCues(data) {
  const selected = chooseRunningFileCue(data);

  if (!selected?.number) {
    emptyActiveReplies += 1;
    if (emptyActiveReplies >= EMPTY_ACTIVE_CONFIRMATIONS) setActiveCue(null);
    return;
  }

  emptyActiveReplies = 0;
  setActiveCue(selected.number, selected.cue);
}

function handleReply(address, args) {
  const data = replyData(args);

  if (address.endsWith("/cueLists")) return loadCues(data);

  if (address.endsWith("/runningCues") || address.endsWith("/runningCues/shallow")) {
    return handleRunningCues(data);
  }

  // Keep this as a fallback for older QLab/bridge configurations, but do not
  // use playbackPosition as the primary source because it is the playhead,
  // not the cue that is actually playing.
  if (address.endsWith("/playbackPosition")) return;

  if (address.endsWith("/currentDuration") && activeCue) {
    const duration = Number(data);
    if (Number.isFinite(duration) && duration > 0) {
      activeDuration = duration;
      broadcast({ type: "qlab-duration", cueNumber: activeCue, duration });
    }
    return;
  }

  if (address.endsWith("/isRunning") && activeCue) {
    const running = data === true || data === 1 || String(data).toLowerCase() === "true" || String(data) === "1";
    if (!running && lastElapsed !== null && lastElapsed > 0.05) setActiveCue(null);
    return;
  }

  if (address.endsWith("/currentFileTime") && activeCue) {
    const elapsed = Number(data);
    if (!Number.isFinite(elapsed)) return;

    processTime(elapsed);

    const duration = Number.isFinite(activeDuration) ? activeDuration : null;
    const ended = duration !== null && !isInfinite(activeCueObject) && elapsed >= Math.max(0, duration - END_EPSILON);

    broadcast({
      type: "qlab-time",
      cueNumber: activeCue,
      elapsed,
      duration,
      remaining: duration === null ? null : Math.max(0, duration - elapsed),
      percent: duration === null ? null : Math.min(100, Math.max(0, (elapsed / duration) * 100)),
      ended
    });

    if (ended) finishActiveCue(elapsed);
  }
}

function handleUpdate(address) {
  const value = String(address);
  const start = value.match(/^\/cue\/([^/]+)\/start$/);
  if (start) return setActiveCue(start[1]);

  const stop = value.match(/^\/cue\/([^/]+)\/stop$/);
  if (stop && String(stop[1]) === String(activeCue)) return setActiveCue(null);

  if (value.includes("/update/workspace/")) syncCues();
}

function syncCues() {
  sendOsc("/cueLists");
}

function pollQLab() {
  if (shuttingDown) return;
  // IMPORTANT: playbackPosition is the playhead/standby cue. It is not the
  // cue currently playing. runningCues is the authoritative source for this.
  sendOsc("/runningCues");
  if (activeCue) queryActiveCueState();
}

function subscribe() {
  sendOsc("/updates", 1);
  sendOsc("/alwaysReply", 1);
  syncCues();
  pollQLab();
}

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

  ws.send(JSON.stringify({
    type: "status",
    connected: true,
    polling: POLL_MS,
    authenticated: client.authenticated
  }));

  if (client.authenticated) {
    if (cues.length) ws.send(JSON.stringify({ type: "qlab-cues", cues }));
    if (activeCue) {
      ws.send(JSON.stringify({
        type: "qlab-cue-start",
        cueNumber: activeCue,
        cue: activeCueObject,
        duration: activeDuration
      }));
    }
  }

  ws.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === "auth") {
        client.authenticated = !QLAB_PASSWORD || String(message.passcode || "") === QLAB_PASSWORD;
        ws.send(JSON.stringify({ type: "auth", authenticated: client.authenticated }));

        if (!client.authenticated) {
          ws.close(1008, "Authentication failed");
        } else {
          if (cues.length) ws.send(JSON.stringify({ type: "qlab-cues", cues }));
          if (activeCue) {
            ws.send(JSON.stringify({
              type: "qlab-cue-start",
              cueNumber: activeCue,
              cue: activeCueObject,
              duration: activeDuration
            }));
          }
          pollQLab();
        }
        return;
      }

      if (!client.authenticated) return;
      if (message.type === "subscribe") return subscribe();
      if (message.type === "sync-cues") return syncCues();
      if (message.type === "set-time-triggers") {
        timeTriggers = message.triggers && typeof message.triggers === "object" ? message.triggers : {};
        firedTriggers.clear();
        return;
      }
      if (message.type === "check-playhead" || message.type === "check-active") return pollQLab();

      if ((message.type === "osc" || message.address) && typeof message.address === "string") {
        const address = message.address;
        // These are bridge-owned queries; don't forward them as control messages.
        if (address === "/playbackPosition" || address === "/runningCues" || address === "/cue/active" ||
            /\/cue\/[^/]+\/(currentFileTime|currentDuration|isRunning)$/.test(address)) return;
        sendOsc(address, Array.isArray(message.args) ? message.args : []);
      }
    } catch (error) {
      console.error("QLab WebSocket message error:", error.message);
    }
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", error => console.error("QLab WebSocket client error:", error.message));
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
