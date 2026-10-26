// Live video on the visualiser's video screens: any screen or window on this
// computer - QLab's video output, a projector screen, a browser - captured and
// drawn on the screen as it plays. Works with any QLab licence: it shows
// whatever QLab puts on screen (a Mac asks for Screen Recording permission
// once: System Settings → Privacy & Security → Screen Recording → Light Spark).
//
// A screen remembers its source by name (window ids change each time an app
// opens), so the same QLab output is found again next time.
import * as THREE from "three";

const feeds = new Map(); // source name → { video, texture, stream, status, error }
let changed = () => {};
// Called when a feed starts, stops or fails (the visualiser redraws, Build mode updates).
export function onLiveChange(fn) { changed = fn; }

// The console window asks the app for these (js/visualizer-link.js), as this
// window can't reach it itself.
let asked = 0;
const waiting = new Map();
window.addEventListener("message", event => {
  const m = event.data;
  if (m?.type === "SCREEN_SOURCES" && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
});

// → { permission, sources: [{ id, name, screen, thumb }], error }
export function listSources() {
  if (!window.opener) return Promise.resolve({ sources: [], error: "Open the visualiser from Light Spark to show live video." });
  const id = ++asked;
  return new Promise(resolve => {
    waiting.set(id, resolve);
    window.opener.postMessage({ type: "VIZ_SCREEN_SOURCES", id }, "*");
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ sources: [], error: "Light Spark didn't answer — is it the Light Spark app (not a browser)?" }); } }, 8000);
  });
}
export function openScreenSettings() { window.opener?.postMessage({ type: "VIZ_SCREEN_SETTINGS" }, "*"); }

const capture = id => navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: id, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } } });

async function start(live, feed) {
  try {
    // The source it was last time first (quick); if that's gone, find it again by name.
    let stream = live.id ? await capture(live.id).catch(() => null) : null;
    if (!stream) {
      const { sources = [], permission } = await listSources();
      if (permission === "denied" || permission === "restricted") throw Object.assign(new Error("Screen Recording isn't allowed for Light Spark"), { permission: true });
      const source = sources.find(s => s.name === live.name);
      if (!source) { feed.status = "missing"; changed(); return; }
      live.id = source.id;
      stream = await capture(source.id);
    }
    if (feeds.get(live.name) !== feed) { stream.getTracks().forEach(t => t.stop()); return; } // stopped meanwhile
    feed.stream = stream;
    feed.video.srcObject = stream;
    await feed.video.play().catch(() => {});
    feed.status = "live";
    stream.getVideoTracks()[0]?.addEventListener("ended", () => { feed.status = "ended"; changed(); });
  } catch (error) {
    feed.status = error.permission || /permission|denied|not allowed/i.test(error.message) ? "permission" : "error";
    feed.error = error.message;
  }
  changed();
}

// The texture a screen shows for its live source (black until the feed starts).
export function liveTexture(live) {
  if (!live?.name) return null;
  if (!feeds.has(live.name)) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const feed = { video, texture, stream: null, status: "starting", error: "" };
    feeds.set(live.name, feed);
    start(live, feed);
  }
  return feeds.get(live.name).texture;
}

// "starting" | "live" | "missing" (not open now) | "permission" | "ended" | "error"
export function liveStatus(live) {
  const feed = live?.name ? feeds.get(live.name) : null;
  return feed ? { status: feed.status, error: feed.error } : { status: "off", error: "" };
}

// Any feed playing (the visualiser keeps drawing while one is).
export function liveActive() {
  for (const feed of feeds.values()) if (feed.status === "live") return true;
  return false;
}

function stop(name) {
  const feed = feeds.get(name);
  if (!feed) return;
  feed.stream?.getTracks().forEach(t => t.stop());
  feed.video.srcObject = null;
  feed.texture.dispose();
  feeds.delete(name);
}

// Stop feeds no screen uses any more.
export function pruneLive(inUse) {
  for (const name of [...feeds.keys()]) if (!inUse.has(name)) stop(name);
}

// Try a source again (it wasn't open, or permission has just been given).
export function retryLive(live) {
  if (live?.name) stop(live.name);
}
