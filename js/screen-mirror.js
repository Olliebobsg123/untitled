// Screen mirror: a mirror console shows a live picture of the screen of the
// console in control — every window, fader, log line and dialog, exactly
// as the operator sees it.
//
// The picture is WebRTC video straight between the two computers (it
// adapts to the Wi-Fi: under strain it drops frames, never falls behind).
// The offers and answers that set it up travel over the session link
// (js/session.js routes them, via the primary when a backup is in control).
//
//   mirror      asks for the picture ("rtc-want") until it has one
//   in control  captures its own window and sends it to each mirror
//
// A Mac needs Screen Recording permission once (System Settings → Privacy
// & Security → Screen Recording → Light Spark) before it can be mirrored.
(function () {
  if (window.LXScreenMirror) return;
  const say = (m, l = "info") => window.log?.(`🖥 ${m}`, l);
  const ICE = { iceServers: [] }; // same network: no outside servers
  const peers = new Map();        // in control: mirror id -> RTCPeerConnection
  let stream = null, capturing = null, warned = 0, openedSettings = false;

  // ------------------------------------------------------------ sending

  async function capture() {
    if (stream && stream.getVideoTracks().some(t => t.readyState === "live")) return stream;
    if (capturing) return capturing;
    capturing = (async () => {
      const src = await window.LXApp?.screenSource?.();
      if (!src?.id) throw new Error("this window can't be captured");
      if (src.permission === "denied" || src.permission === "restricted") throw Object.assign(new Error("screen recording is not allowed"), { permission: true });
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: src.id, maxWidth: 1920, maxHeight: 1200, maxFrameRate: 30 } } });
      for (const t of s.getVideoTracks()) t.contentHint = "detail"; // keep text sharp
      stream = s;
      return s;
    })();
    try { return await capturing; } finally { capturing = null; }
  }

  async function offer(peer) {
    let s;
    try { s = await capture(); }
    catch (e) {
      if (Date.now() - warned > 15000) {
        warned = Date.now();
        say(e.permission ? "A mirror wants to see this screen, but macOS hasn't allowed Light Spark to record it: System Settings → Privacy & Security → Screen Recording → turn on Light Spark, then restart it." : `Can't send this screen to the mirror: ${e.message}`, "warn");
        if (e.permission && !openedSettings) { openedSettings = true; window.LXApp?.openScreenSettings?.(); }
      }
      return;
    }
    close(peer);
    const pc = new RTCPeerConnection(ICE);
    peers.set(peer, pc);
    for (const track of s.getVideoTracks()) {
      const sender = pc.addTrack(track, s);
      try {
        const p = sender.getParameters();
        p.encodings = [{ ...(p.encodings?.[0] || {}), maxBitrate: 4_000_000, maxFramerate: 30 }];
        p.degradationPreference = "maintain-resolution";
        await sender.setParameters(p);
      } catch (_) {}
    }
    pc.onicecandidate = e => { if (e.candidate) signal(peer, { type: "rtc", candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) close(peer); };
    await pc.setLocalDescription(await pc.createOffer());
    signal(peer, { type: "rtc", sdp: pc.localDescription.toJSON() });
  }

  function close(peer) {
    const pc = peers.get(peer);
    if (pc) { try { pc.close(); } catch (_) {} peers.delete(peer); }
  }

  // Stop sending (this console no longer has control).
  function stopAll() {
    for (const peer of [...peers.keys()]) close(peer);
    for (const t of stream?.getTracks() || []) t.stop();
    stream = null;
  }

  const signal = (peer, msg) => window.LXSession?.signal?.(peer, msg);
  // Candidates can arrive before the description they belong to is set.
  const addCandidate = (pc, c) => { if (pc.remoteDescription) return pc.addIceCandidate(c).catch(() => {}); (pc._waiting ||= []).push(c); };
  const remote = async (pc, sdp) => { await pc.setRemoteDescription(sdp); for (const c of pc._waiting?.splice(0) || []) await pc.addIceCandidate(c).catch(() => {}); };

  // ---------------------------------------------------------- receiving

  let view = null, viewPc = null, wantTimer = null, own = false, lastFrameAt = 0;

  function overlay() {
    if (view) return view;
    const style = document.createElement("style");
    style.textContent = `
      #lxScreenMirror{position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;align-items:center;justify-content:center}
      #lxScreenMirror[hidden]{display:none}
      #lxScreenMirror video{width:100%;height:100%;object-fit:contain;background:#000}
      #lxScreenMirror .bar{position:absolute;top:8px;right:8px;display:flex;gap:6px;align-items:center;padding:4px 6px 4px 10px;border-radius:8px;background:rgba(10,14,16,.72);color:#9fe0c0;font:700 10px/1 system-ui;letter-spacing:.06em;opacity:.35;transition:opacity .2s}
      #lxScreenMirror .bar:hover{opacity:1}
      #lxScreenMirror .bar button{height:22px;padding:0 8px;font-size:10px}
      #lxScreenMirror .wait{position:absolute;color:#7d8b88;font:600 13px system-ui}
      #lxMirrorBack{position:fixed;right:10px;bottom:10px;z-index:2147483000}
    `;
    document.head.appendChild(style);
    view = document.createElement("div");
    view.id = "lxScreenMirror";
    view.innerHTML = `<video autoplay muted playsinline></video><div class="wait">Waiting for the picture from the console in control…</div><div class="bar"><span data-mirror-label>MIRROR</span><button type="button" class="btn-secondary" data-mirror-own>My own view</button></div>`;
    document.body.appendChild(view);
    const back = document.createElement("button");
    back.id = "lxMirrorBack"; back.type = "button"; back.className = "btn-primary"; back.hidden = true;
    back.textContent = "🖥 Show the live screen";
    document.body.appendChild(back);
    view.querySelector("[data-mirror-own]").addEventListener("click", () => setOwn(true));
    back.addEventListener("click", () => setOwn(false));
    const video = view.querySelector("video");
    video.addEventListener("playing", () => { view.querySelector(".wait").hidden = true; });
    if ("requestVideoFrameCallback" in video) {
      const tick = () => { lastFrameAt = performance.now(); video.requestVideoFrameCallback(tick); };
      video.requestVideoFrameCallback(tick);
    }
    return view;
  }

  function setOwn(on) {
    own = Boolean(on);
    overlay().hidden = own;
    document.getElementById("lxMirrorBack").hidden = !own;
  }

  async function answer(msg) {
    if (msg.sdp?.type === "offer") {
      try { viewPc?.close(); } catch (_) {}
      const pc = viewPc = new RTCPeerConnection(ICE);
      pc.ontrack = e => {
        const v = overlay().querySelector("video");
        v.srcObject = e.streams[0] || new MediaStream([e.track]);
        v.play?.().catch(() => {});
        if (!own) overlay().hidden = false;
      };
      pc.onicecandidate = e => { if (e.candidate) signal("primary", { type: "rtc", candidate: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(pc.connectionState) && viewPc === pc) { viewPc = null; showWaiting(); } };
      await remote(pc, msg.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      signal("primary", { type: "rtc", sdp: pc.localDescription.toJSON() });
    } else if (msg.candidate && viewPc) addCandidate(viewPc, msg.candidate);
  }

  function showWaiting() {
    if (!view) return;
    const v = view.querySelector("video");
    v.srcObject = null;
    view.querySelector(".wait").hidden = false;
  }

  // Mirror: keep asking until the picture is coming in.
  function startWatching(label) {
    overlay();
    view.querySelector("[data-mirror-label]").textContent = `MIRROR${label ? ` · ${label}` : ""}`;
    if (!own) view.hidden = false;
    clearInterval(wantTimer);
    const ask = () => {
      const live = viewPc && viewPc.connectionState === "connected" && performance.now() - lastFrameAt < 4000;
      if (!live) signal("primary", { type: "rtc-want" });
    };
    ask();
    wantTimer = setInterval(ask, 3000);
  }
  // Another console took control: ask it for its picture now (the old one
  // stays on screen until the new one arrives).
  function restart() {
    if (!wantTimer) return;
    try { viewPc?.close(); } catch (_) {}
    viewPc = null;
    signal("primary", { type: "rtc-want" });
  }
  function stopWatching() {
    clearInterval(wantTimer); wantTimer = null;
    try { viewPc?.close(); } catch (_) {}
    viewPc = null;
    if (view) { view.hidden = true; showWaiting(); }
    const back = document.getElementById("lxMirrorBack");
    if (back) back.hidden = true;
  }

  // ------------------------------------------------------------ routing

  // Called by js/session.js with a signalling message for this console.
  async function onSignal(from, msg) {
    try {
      if (msg.type === "rtc-want") return offer(from);            // in control
      if (msg.sdp?.type === "offer" || (msg.candidate && !peers.has(from))) return answer(msg); // mirror
      const pc = peers.get(from);                                  // in control: answers and candidates
      if (!pc) return;
      if (msg.sdp?.type === "answer") await remote(pc, msg.sdp);
      else if (msg.candidate) addCandidate(pc, msg.candidate);
    } catch (e) { console.warn("[MIRROR]", e); }
  }

  window.LXScreenMirror = Object.freeze({ onSignal, startWatching, stopWatching, restart, stopAll, sending: () => peers.size, watching: () => Boolean(viewPc && viewPc.connectionState === "connected"), framesAt: () => lastFrameAt, setOwn });
})();
