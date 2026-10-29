"use strict";

/*
 * Song Timeline: the track, its waveform, and the cues on it.
 *
 *   Load track…   an audio file. Its waveform is saved with the show (so it
 *                 shows on another Mac too); the audio itself is kept on this
 *                 Mac — load it once on each.
 *   Cues          a cue's place is its timecode (cue.timecode). Drag a marker
 *                 to move it, drag a cue from the row below onto the track to
 *                 place it, right-click a marker to take it off.
 *   Play          plays the track here, and it becomes the timecode: cues
 *                 fire at their places (if "Timecode fires cues" is on), and
 *                 clicking somewhere else on the track puts up the right cue.
 *                 When the track isn't playing here, the playhead follows the
 *                 timecode coming in (QLab, LTC…).
 *   Learn         play the track and press GO in time through rehearsal: each
 *                 GO gives that cue the time it was pressed. Cues don't fire by
 *                 time while learning. Then just drag the ones that are off.
 *   Starts at     the timecode at the start of the track, if the sound desk's
 *                 timecode doesn't start at 00:00:00:00.
 *
 * Windows → Song Timeline, or "timeline" on the command line.
 */
(function () {
  if (window.LXSong) return;
  const S = () => window.State || {};
  const TC = () => window.LXTimecode;
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = (m, t = "ok") => window.log?.(`♫ ${m}`, t);
  const PEAKS_PER_SEC = 25, MAX_PEAKS = 15000;

  const audio = new Audio();
  audio.preload = "auto";
  let url = null, feeding = false, learning = false, learnFrom = -1;
  let body = null, view = null, canvas = null, scroller = null, spacer = null;
  let pps = 40; // pixels per second
  let drag = null, hover = null, follow = true;

  const song = () => S().song || null;
  const offset = () => Number(song()?.offset) || 0;
  const duration = () => Number(song()?.duration) || (Number.isFinite(audio.duration) ? audio.duration : 0);
  const hasAudio = () => Boolean(url) && audio.readyState >= 1;
  const playing = () => hasAudio() && !audio.paused && !audio.ended;
  const fmt = s => {
    if (!Number.isFinite(s)) return "--:--";
    const neg = s < 0; s = Math.abs(s);
    return `${neg ? "-" : ""}${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  };
  // Where the playhead is, in track seconds: the track while it plays here,
  // otherwise the timecode coming in (QLab, LTC…), otherwise where it stopped.
  function position() {
    if (hasAudio() && (playing() || learning)) return audio.currentTime;
    const st = TC()?.status?.();
    if (st?.running && st.source !== "song" && Number.isFinite(st.time)) return st.time - offset();
    if (hasAudio()) return audio.currentTime;
    return Number.isFinite(st?.time) ? st.time - offset() : 0;
  }

  // ------------------------------------------------------- keeping audio

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("lx-song-audio", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("tracks");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function store(key, blob) {
    try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction("tracks", "readwrite"); tx.objectStore("tracks").put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); db.close(); } catch (err) { console.warn("[SONG] store", err); }
  }
  async function fetchBlob(key) {
    try { const db = await idb(); const blob = await new Promise((res, rej) => { const req = db.transaction("tracks").objectStore("tracks").get(key); req.onsuccess = () => res(req.result || null); req.onerror = () => rej(req.error); }); db.close(); return blob; } catch (_) { return null; }
  }
  const keyOf = sg => `${sg?.name || ""}|${sg?.size || 0}`;

  function useBlob(blob) {
    if (url) URL.revokeObjectURL(url);
    url = blob ? URL.createObjectURL(blob) : null;
    audio.src = url || "";
    if (url) audio.load();
  }

  // The waveform: the loudest sample in each slice, 0-255.
  function peaksOf(buffer) {
    const n = Math.max(1, Math.min(MAX_PEAKS, Math.ceil(buffer.duration * PEAKS_PER_SEC)));
    const channels = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
    const per = buffer.length / n, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * per), b = Math.min(buffer.length, Math.floor((i + 1) * per));
      let max = 0;
      const step = Math.max(1, Math.floor((b - a) / 400));
      for (const data of channels) for (let j = a; j < b; j += step) { const v = Math.abs(data[j]); if (v > max) max = v; }
      out[i] = Math.round(Math.min(1, max) * 255);
    }
    // Scale so the loudest part fills the height.
    const top = Math.max(1, ...out);
    return out.map(v => Math.round(v * 255 / top));
  }

  async function load(file) {
    if (!file) return false;
    say(`Loading ${file.name}…`);
    let buffer;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      ctx.close?.();
    } catch (err) {
      say(`Couldn't read ${file.name} as audio (${err?.message || err}) — try an MP3, WAV, M4A or AIFF`, "warn");
      return false;
    }
    const old = song();
    S().song = { name: file.name, size: file.size, duration: buffer.duration, offset: old?.offset || 0, rate: buffer.duration ? Math.min(MAX_PEAKS, Math.ceil(buffer.duration * PEAKS_PER_SEC)) / buffer.duration : PEAKS_PER_SEC, peaks: peaksOf(buffer) };
    useBlob(file);
    store(keyOf(S().song), file);
    say(`${file.name} — ${fmt(buffer.duration)}. Drag cues onto it, or turn on Learn and press GO along with it.`);
    render(true);
    return true;
  }

  // A show was opened: its track, if this Mac has it.
  async function restore() {
    if (playing()) audio.pause();
    const sg = song();
    if (!sg) { useBlob(null); render(true); return; }
    const blob = await fetchBlob(keyOf(sg));
    useBlob(blob);
    render(true);
  }

  // ------------------------------------------------------- the clock

  // Hand the track's time to timecode (js/timecode.js takes "song" from us).
  function pushTime(running) {
    if (!hasAudio() || learning) return;
    feeding = true;
    try {
      TC()?.feed(offset() + audio.currentTime, "song", 25);
      if (!running) TC()?.halt("song");
    } finally { feeding = false; }
  }
  setInterval(() => {
    if (playing()) pushTime(true);
    if (learning) learnTick();
  }, 20);
  audio.addEventListener("pause", () => pushTime(false));
  audio.addEventListener("ended", () => { pushTime(false); if (learning) stopLearn(); });

  function play() {
    if (!hasAudio()) { say(song() ? `This Mac doesn't have “${song().name}” yet — Load track… to add it` : "Load a track first", "warn"); return; }
    audio.play().catch(err => say(`Can't play: ${err.message}`, "warn"));
  }
  function pause() { audio.pause(); }
  function seek(t) {
    t = Math.max(0, Math.min(duration() || 0, t));
    if (hasAudio()) audio.currentTime = t;
    // Put up the cue that belongs here.
    if (!learning) {
      feeding = true;
      try { TC()?.feed(offset() + t, "song", 25); if (!playing()) TC()?.halt("song"); } finally { feeding = false; }
    }
    render();
  }

  // ------------------------------------------------------------ learn

  function startLearn() {
    if (!hasAudio()) { say("Load the track on this Mac first", "warn"); return; }
    learning = true;
    learnFrom = S().currentCue ?? -1;
    say("Learn: play the track and press GO along with it — each GO sets that cue's time. Learn again (or Esc) to stop.");
    if (!playing()) play();
    render(true);
  }
  function stopLearn() {
    learning = false;
    say("Learn off");
    render(true);
  }
  // A GO while learning: the cue that went live gets the track's time.
  function learnTick() {
    const now = S().currentCue ?? -1;
    if (now === learnFrom) return;
    const forward = now > learnFrom;
    learnFrom = now;
    if (!forward || now < 0 || !playing()) return;
    const t = offset() + audio.currentTime;
    TC()?.setCue(now, t);
    say(`Cue ${window.cueLabel ? window.cueLabel(now) : now + 1} at ${fmt(audio.currentTime)}`);
  }

  // ------------------------------------------------------------- drawing

  const cuesOnTrack = () => (S().cues || []).map((c, i) => c && Number.isFinite(c.timecode) ? { c, i, t: c.timecode - offset() } : null).filter(Boolean);
  const cuesOff = () => (S().cues || []).map((c, i) => c && !Number.isFinite(c.timecode) ? { c, i } : null).filter(Boolean);
  const label = i => (window.cueLabel ? window.cueLabel(i) : String(i + 1));
  const xOf = t => t * pps - (scroller?.scrollLeft || 0);
  const tOf = x => (x + (scroller?.scrollLeft || 0)) / pps;

  function draw() {
    if (!canvas || !view?.isConnected) return;
    const w = view.clientWidth, h = view.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#070b0d"; g.fillRect(0, 0, w, h);
    const sg = song(), dur = duration();
    const top = 22, mid = top + (h - top - 14) / 2, amp = (h - top - 14) / 2 - 4;
    // Ruler.
    const steps = [1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find(s => s * pps >= 64) || 300;
    g.font = "10px ui-monospace, Menlo, monospace"; g.textBaseline = "top";
    for (let t = Math.floor(tOf(0) / step) * step; t <= tOf(w); t += step) {
      if (t < 0) continue;
      const x = Math.round(xOf(t)) + 0.5;
      g.strokeStyle = "#1a2328"; g.beginPath(); g.moveTo(x, top); g.lineTo(x, h); g.stroke();
      g.fillStyle = "#66767a"; g.fillText(fmt(t).replace(/\.0$/, ""), x + 3, 4);
    }
    // Waveform.
    if (sg?.peaks?.length && dur > 0) {
      const rate = sg.peaks.length / dur;
      g.fillStyle = hasAudio() ? "#2f8f78" : "#3b4a50";
      for (let x = Math.max(0, Math.floor(xOf(0))); x < Math.min(w, xOf(dur)); x++) {
        const a = Math.floor(tOf(x) * rate), b = Math.max(a + 1, Math.floor(tOf(x + 1) * rate));
        let v = 0;
        for (let k = a; k < b && k < sg.peaks.length; k++) if (sg.peaks[k] > v) v = sg.peaks[k];
        const y = Math.max(1, v / 255 * amp);
        g.fillRect(x, mid - y, 1, y * 2);
      }
      // Past the end.
      const end = xOf(dur);
      if (end < w) { g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(Math.max(0, end), top, w - end, h - top); }
    } else {
      g.fillStyle = "#66767a"; g.font = "13px system-ui, sans-serif"; g.textBaseline = "middle";
      g.fillText("Load a track to see its waveform — cues with a timecode show on it", 14, mid);
      g.font = "10px ui-monospace, Menlo, monospace"; g.textBaseline = "top";
    }
    // Cues.
    const live = S().currentCue;
    for (const { c, i, t } of cuesOnTrack()) {
      const tt = drag?.kind === "cue" && drag.i === i ? drag.t : t;
      const x = Math.round(xOf(tt)) + 0.5;
      if (x < -120 || x > w + 4) continue;
      const on = i === live, hot = hover === i || (drag?.kind === "cue" && drag.i === i);
      g.strokeStyle = on ? "#19d6a3" : hot ? "#ffd27a" : "#d9a441"; g.lineWidth = on || hot ? 2 : 1;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, h); g.stroke(); g.lineWidth = 1;
      const text = `${label(i)}${c.name && !/^Cue [\d.]+$/.test(c.name) ? " " + c.name : ""}`.slice(0, 28);
      g.font = "bold 11px system-ui, sans-serif";
      const tw = g.measureText(text).width + 8;
      g.fillStyle = on ? "#19d6a3" : hot ? "#ffd27a" : "#d9a441";
      g.fillRect(x, top, tw, 16);
      g.fillStyle = "#0b0f11"; g.textBaseline = "middle"; g.fillText(text, x + 4, top + 8); g.textBaseline = "top";
      if (c.goNote) { g.font = "11px system-ui, sans-serif"; g.fillStyle = "#ffd27a"; g.fillText(String(c.goNote).slice(0, 40), x + 4, top + 19); }
      if (hot && drag?.kind === "cue") { g.font = "10px ui-monospace, Menlo, monospace"; g.fillStyle = "#ffd27a"; g.fillText(fmt(tt), x + 4, h - 13); }
    }
    // A cue being dragged on from the row below.
    if (drag?.kind === "new" && drag.over) {
      const x = Math.round(xOf(drag.t)) + 0.5;
      g.strokeStyle = "#ffd27a"; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, top); g.lineTo(x, h); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#ffd27a"; g.fillText(`${label(drag.i)} at ${fmt(drag.t)}`, x + 4, h - 13);
    }
    // Playhead.
    const p = position(), px = Math.round(xOf(p)) + 0.5;
    if (px >= 0 && px <= w) { g.strokeStyle = learning ? "#ff5a6e" : "#ffffff"; g.lineWidth = 2; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); g.lineWidth = 1; }
    // Keep the playhead in view while playing.
    if (follow && playing() && scroller && !drag && (px > w * 0.85 || px < 0)) scroller.scrollLeft = Math.max(0, p * pps - w * 0.2);
  }

  let lastKey = "";
  function render(force = false) {
    if (!body?.isConnected) return;
    const sg = song();
    const key = JSON.stringify([sg?.name, sg?.duration, sg?.offset, hasAudio(), learning, pps, cuesOff().map(x => [x.i, x.c.name, x.c.number]), TC()?.status?.().source]);
    if (force || key !== lastKey) {
      lastKey = key;
      const name = body.querySelector('[data-st="name"]');
      name.textContent = sg ? `${sg.name} · ${fmt(sg.duration)}${hasAudio() ? "" : " · not on this Mac yet — Load track… to play it"}` : "No track";
      body.querySelector('[data-st="learn"]').classList.toggle("on", learning);
      body.querySelector('[data-st="learn"]').textContent = learning ? "● Learning — press GO in time" : "● Learn";
      const off = body.querySelector('[data-st="offset"]');
      if (document.activeElement !== off) off.value = TC() ? TC().format(offset()) : String(offset());
      if (spacer) spacer.style.width = `${Math.max(view?.clientWidth || 0, Math.ceil((duration() || 60) * pps) + 120)}px`;
      const off2 = cuesOff();
      body.querySelector('[data-st="off"]').innerHTML = off2.length
        ? `<span class="st-offlabel">Drag onto the track:</span>${off2.map(({ c, i }) => `<button type="button" class="st-chip" data-i="${i}" title="${esc(c.name || "")}">${esc(label(i))}${c.name && !/^Cue [\d.]+$/.test(c.name) ? ` <small>${esc(c.name)}</small>` : ""}</button>`).join("")}`
        : `<span class="st-offlabel">${(S().cues || []).length ? "Every cue is on the track." : "No cues yet."}</span>`;
    }
    const playBtn = body.querySelector('[data-st="play"]');
    const txt = playing() ? "❚❚ Pause" : "▶ Play";
    if (playBtn.textContent !== txt) playBtn.textContent = txt;
    const time = body.querySelector('[data-st="time"]');
    const t = fmt(position());
    if (time.textContent !== t) time.textContent = t;
  }

  function loop() {
    if (!body?.isConnected) { body = null; return; }
    render();
    draw();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------- pointer

  function cueAt(x, y) {
    const top = 22;
    let best = null, bestD = 7;
    for (const { c, i, t } of cuesOnTrack()) {
      const cx = xOf(t);
      const inLabel = y >= top && y <= top + 16 && x >= cx && x <= cx + 90;
      const d = Math.abs(x - cx);
      if (inLabel) return i;
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  }
  const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; };

  function wire() {
    scroller.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      // The scrollbar strip at the bottom.
      if (y > view.clientHeight - 12) return;
      const i = cueAt(x, y);
      if (i != null) {
        const c = S().cues[i];
        drag = { kind: "cue", i, t: c.timecode - offset(), dx: x - xOf(c.timecode - offset()), moved: false };
        scroller.setPointerCapture(e.pointerId);
      } else {
        seek(tOf(x));
      }
      e.preventDefault();
    });
    scroller.addEventListener("pointermove", e => {
      const { x, y } = local(e);
      if (drag?.kind === "cue") { drag.t = Math.max(0, tOf(x - drag.dx)); drag.moved = true; return; }
      const h = cueAt(x, y);
      if (h !== hover) { hover = h; scroller.style.cursor = h != null ? "grab" : "text"; }
    });
    const end = e => {
      if (drag?.kind !== "cue") return;
      const d = drag; drag = null;
      if (d.moved) {
        TC()?.setCue(d.i, offset() + d.t);
        say(`Cue ${label(d.i)} at ${fmt(d.t)}`);
      } else {
        window.LXCueInspector?.focus?.(d.i);
      }
      try { scroller.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    scroller.addEventListener("pointerup", end);
    scroller.addEventListener("pointercancel", () => { drag = null; });
    scroller.addEventListener("pointerleave", () => { if (!drag) hover = null; });
    scroller.addEventListener("contextmenu", e => {
      const { x, y } = local(e);
      const i = cueAt(x, y);
      if (i == null) return;
      e.preventDefault();
      TC()?.setCue(i, null);
      say(`Cue ${label(i)} taken off the track`);
      render(true);
    });
    // Zoom with Ctrl/⌘ + wheel or a pinch, round the pointer.
    scroller.addEventListener("wheel", e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { x } = local(e);
      const t = tOf(x);
      zoom(pps * Math.exp(-e.deltaY * 0.005), t, x);
    }, { passive: false });
    scroller.addEventListener("scroll", () => { if (!playing()) follow = true; });

    // Cues from the row below, dragged onto the track.
    body.querySelector('[data-st="off"]').addEventListener("pointerdown", e => {
      const chip = e.target.closest(".st-chip");
      if (!chip) return;
      e.preventDefault();
      drag = { kind: "new", i: Number(chip.dataset.i), t: 0, over: false, chip };
      chip.classList.add("dragging");
      const move = ev => { const p = local(ev); drag.over = p.inside && p.y < view.clientHeight - 12; drag.t = Math.max(0, tOf(p.x)); };
      const up = ev => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        move(ev);
        const d = drag; drag = null;
        d.chip.classList.remove("dragging");
        if (d.over) { TC()?.setCue(d.i, offset() + d.t); say(`Cue ${label(d.i)} at ${fmt(d.t)}`); render(true); }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  function zoom(next, t = position(), x = (view?.clientWidth || 600) * 0.3) {
    pps = Math.max(4, Math.min(400, next));
    render(true);
    if (scroller) scroller.scrollLeft = Math.max(0, t * pps - x);
    const z = body?.querySelector('[data-st="zoom"]');
    if (z) z.value = String(Math.round(Math.log(pps) * 100));
  }

  // ------------------------------------------------------------- window

  function build(host) {
    body = host;
    host.innerHTML = `
      <div class="st">
        <div class="st-bar">
          <button type="button" class="btn-secondary" data-sa="load">Load track…</button>
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aif,.aiff,.flac,.ogg" data-st="file" hidden>
          <button type="button" class="btn-primary st-play" data-sa="play" data-st="play">▶ Play</button>
          <button type="button" class="btn-secondary" data-sa="start" title="Back to the start">⏮</button>
          <span class="st-time" data-st="time">0:00.0</span>
          <button type="button" class="btn-secondary st-learn" data-sa="learn" data-st="learn" title="Play the track and press GO in time: each GO sets that cue's time">● Learn</button>
          <label class="st-check"><input type="checkbox" data-st="fire"> Cues fire on time</label>
          <span class="st-grow"></span>
          <label class="st-small">Starts at <input type="text" data-st="offset" title="The timecode at the start of the track"></label>
          <label class="st-small">Zoom <input type="range" min="139" max="599" data-st="zoom"></label>
        </div>
        <div class="st-name" data-st="name">No track</div>
        <div class="st-view"><canvas></canvas><div class="st-scroll"><div class="st-spacer"></div></div></div>
        <div class="st-off" data-st="off"></div>
      </div>`;
    view = host.querySelector(".st-view");
    canvas = view.querySelector("canvas");
    scroller = view.querySelector(".st-scroll");
    spacer = view.querySelector(".st-spacer");
    const file = host.querySelector('[data-st="file"]');
    file.addEventListener("change", () => { const f = file.files?.[0]; file.value = ""; if (f) load(f); });
    host.addEventListener("click", e => {
      const a = e.target.closest("[data-sa]")?.dataset.sa;
      if (a === "load") file.click();
      else if (a === "play") (playing() ? pause() : play());
      else if (a === "start") seek(0);
      else if (a === "learn") (learning ? stopLearn() : startLearn());
    });
    const fire = host.querySelector('[data-st="fire"]');
    fire.checked = window.LXPrefs?.get("tcTrigger") !== false;
    fire.addEventListener("change", () => window.LXPrefs?.set("tcTrigger", fire.checked));
    const off = host.querySelector('[data-st="offset"]');
    off.addEventListener("change", () => {
      if (!song()) return;
      const v = TC()?.parse(off.value);
      if (v == null) { say("Type a time like 00:00:10:00", "warn"); return; }
      song().offset = Math.max(0, v);
      render(true);
    });
    host.querySelector('[data-st="zoom"]').addEventListener("input", e => zoom(Math.exp(Number(e.target.value) / 100)));
    host.querySelector('[data-st="zoom"]').value = String(Math.round(Math.log(pps) * 100));
    // Esc stops learning.
    host.addEventListener("keydown", e => { if (e.key === "Escape" && learning) stopLearn(); });
    wire();
    render(true);
    requestAnimationFrame(loop);
  }

  function open() { window.LXWindows?.open("song"); }

  function command(c) {
    if (c === "timeline" || c === "song timeline" || c === "song") { open(); return true; }
    if (c === "learn" || c === "learn on") { open(); startLearn(); return true; }
    if (c === "learn off") { stopLearn(); return true; }
    return false;
  }

  function install(tries = 0) {
    if (!window.LXWindows?.register) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if (!window.LXWindows.list().includes("song")) window.LXWindows.register({ id: "song", title: "Song Timeline", build, w: 960, h: 340 });
    if (!document.getElementById("lxSongStyles")) {
      const st = document.createElement("style");
      st.id = "lxSongStyles";
      st.textContent = `.st{display:flex;flex-direction:column;height:100%;min-height:0;font-size:14px;color:#c6d0ce}
.st-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 10px;border-bottom:1px solid var(--border,#1d262b)}
.st-bar button{min-height:30px;padding:0 12px}
.st-play{min-width:92px}
.st-time{font:700 17px var(--mono,monospace);color:#ffd27a;min-width:70px;text-align:center}
.st-learn.on{background:#3a0f16;border-color:#ff5a6e;color:#ffb3bd}
.st-check,.st-small{display:flex;align-items:center;gap:5px;color:#a7b2af;font-size:13px}
.st-small input[type=text]{width:96px;height:26px;padding:0 6px;background:#0a1013;border:1px solid var(--border-strong,#2a363c);border-radius:4px;color:var(--text,#edf4f2);font:13px var(--mono,monospace)}
.st-small input[type=range]{width:110px}
.st-grow{flex:1}
.st-name{padding:4px 10px;color:#a5adac;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-view{position:relative;flex:1;min-height:120px;border-top:1px solid #12191d;border-bottom:1px solid #12191d}
.st-view canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.st-scroll{position:absolute;inset:0;overflow-x:auto;overflow-y:hidden;cursor:text;touch-action:pan-x}
.st-spacer{height:100%}
.st-off{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:7px 10px;max-height:72px;overflow:auto}
.st-offlabel{color:#a5adac;font-size:13px;margin-right:4px}
.st-chip{min-height:26px;padding:0 9px;border:1px solid #5a4520;border-radius:13px;background:#1b1508;color:#ffd27a;font-weight:700;cursor:grab;touch-action:none}
.st-chip small{font-weight:400;color:#c9a96a}
.st-chip.dragging{opacity:.5}`;
      document.head.appendChild(st);
    }
  }

  window.addEventListener("lx-show-file", () => setTimeout(restore, 300));
  window.LXSong = { open, load, play, pause, seek, startLearn, stopLearn, command, restore, position, playing, learning: () => learning, driving: () => feeding, zoom: v => zoom(v) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
