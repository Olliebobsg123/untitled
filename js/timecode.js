"use strict";

/*
 * Timecode. Cues can have a time; when timecode passes it, the cue fires.
 *
 * Sources (Preferences → Show Control → Timecode):
 *   MTC       MIDI timecode from QLab, a DAW… (read in js/show-control.js)
 *   LTC       timecode as audio, from a sound card input (js/ltc.js decodes)
 *   Internal  Light Spark's own clock: play / pause / locate in the
 *             Timecode window — for rehearsing without the sound desk.
 *
 * If the time jumps (someone locates in the DAW), the cue that should be
 * live at the new time is put up — straight away or with its own fade.
 * If the signal drops out it keeps counting for a moment (freewheel), so a
 * glitch doesn't stop the show.
 *
 * A cue's time is cue.timecode, in seconds; it's shown as HH:MM:SS:FF.
 *
 *   LXTimecode.feed(seconds, source, fps)   — a source has a new time
 *   LXTimecode.now()  .format(s)  .parse(text)  .play() .pause() .stop() .locate(s)
 *   LXTimecode.setCue(index, seconds|null)  .open()
 */
(function () {
  if (window.LXTimecode) return;

  const S = () => window.State;
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;
  const say = (m, l = "info") => window.log?.(`⏱ ${m}`, l);
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------ format

  const fpsPref = () => Number(pref("tcFps", 25)) || 25;
  function format(seconds, fps = clock.fps || fpsPref()) {
    if (!Number.isFinite(seconds)) return "--:--:--:--";
    const neg = seconds < 0; seconds = Math.abs(seconds);
    const whole = Math.floor(seconds + 1e-6);
    const frames = Math.min(Math.round(fps) - 1, Math.floor((seconds - whole) * fps + 1e-6));
    const pad = n => String(n).padStart(2, "0");
    return `${neg ? "-" : ""}${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}:${pad(frames)}`;
  }
  // "1:02:03:04", "01:02:03.5", "2:03", "93.5" (seconds) → seconds
  function parse(text, fps = fpsPref()) {
    const t = String(text ?? "").trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
    const parts = t.split(/[:;]/).map(Number);
    if (parts.some(n => !Number.isFinite(n))) return null;
    let h = 0, m = 0, s = 0, f = 0;
    if (parts.length === 4) [h, m, s, f] = parts;
    else if (parts.length === 3) [h, m, s] = parts;
    else if (parts.length === 2) [m, s] = parts;
    else return null;
    return h * 3600 + m * 60 + s + f / fps;
  }

  // ------------------------------------------------------------- clock

  // What timecode says now. `at` is when it was last told, so the time can
  // be read between messages (and keep running while freewheeling).
  const clock = { time: null, at: 0, running: false, source: "", fps: 0, freewheel: false, lastFeed: 0 };
  const internal = { running: false, start: 0, base: 0 };

  function now() {
    if (clock.time == null) return null;
    return clock.running ? clock.time + (performance.now() - clock.at) / 1000 : clock.time;
  }

  // A source reports a time. Ignored unless it's the chosen source.
  function feed(seconds, source, fps) {
    if (source !== pref("tcSource", "off")) return;
    const t = performance.now();
    const was = lastSeen; // the last time cues were checked against, not the clock's guess
    clock.time = seconds; clock.at = t; clock.lastFeed = t; clock.running = true; clock.freewheel = false;
    clock.source = source; if (fps) clock.fps = fps;
    advance(was, seconds);
  }
  // A source says it has stopped (e.g. internal pause).
  function halt(source) {
    if (source !== pref("tcSource", "off")) return;
    clock.time = now(); clock.at = performance.now(); clock.running = false; clock.freewheel = false;
  }

  // Drop-outs: keep running for the freewheel time, then stop.
  setInterval(() => {
    const src = pref("tcSource", "off");
    if (src === "internal") {
      if (internal.running) feed(internal.base + (performance.now() - internal.start) / 1000, "internal", fpsPref());
      return;
    }
    if (!clock.running || src === "off") return;
    const quiet = performance.now() - clock.lastFeed;
    const allowed = Math.max(0, Number(pref("tcFreewheelMs", 1000)) || 0);
    if (quiet > 150 && !clock.freewheel && allowed > 0) clock.freewheel = true;
    if (quiet > 150 && quiet > allowed) { clock.time = now(); clock.at = performance.now(); clock.running = false; clock.freewheel = false; }
    if (clock.freewheel) { const t = now(); advance(lastSeen, t); }
  }, 20);

  // --------------------------------------------------------- triggering

  let lastSeen = null;
  const timed = () => (S()?.cues || []).map((c, i) => [i, c]).filter(([, c]) => c && Number.isFinite(c.timecode)).sort((a, b) => a[1].timecode - b[1].timecode);

  function advance(from, to) {
    lastSeen = to;
    if (pref("tcTrigger", true) === false || to == null) return;
    const list = timed();
    if (!list.length) return;
    const jump = from == null || to < from - 0.05 || to - from > 1.0;
    if (jump) {
      // Put up whatever should be live at this time.
      let want = -1;
      for (const [i, c] of list) if (c.timecode <= to + 1e-6) want = i;
      if (want >= 0 && want !== S().currentCue) {
        fire(want, pref("tcJump", "snap") === "snap" ? 0 : null, "located");
      }
      return;
    }
    // Normal running: fire the cues whose time we just passed (the last one wins).
    let hit = -1;
    for (const [i, c] of list) if (c.timecode > from + 1e-6 && c.timecode <= to + 1e-6) hit = i;
    if (hit >= 0) fire(hit, null, "on time");
  }

  function fire(index, fade, why) {
    if (window.LXSession && !window.LXSession.drives()) return; // another console is running the show
    const cue = S().cues[index];
    window.LXFixtureInfo?.act("cue", `Cue ${index + 1} “${cue?.name || ""}”`, `timecode ${format(cue.timecode)}`, 1500);
    window.goToCue?.(index, fade);
    if (pref("tcLog", true) !== false) say(`Cue ${index + 1} at ${format(cue.timecode)} (${why})`, "ok");
  }

  // ------------------------------------------------------ internal clock

  function setInternal(running, base) {
    if (base != null) internal.base = base;
    else if (internal.running) internal.base += (performance.now() - internal.start) / 1000;
    internal.running = running;
    internal.start = performance.now();
    if (pref("tcSource", "off") !== "internal") return;
    if (running) feed(internal.base, "internal", fpsPref());
    else { clock.time = internal.base; clock.at = performance.now(); clock.running = false; clock.source = "internal"; }
  }
  const play = () => setInternal(true);
  const pause = () => setInternal(false);
  const stop = () => { setInternal(false, 0); lastSeen = 0; };
  function locate(seconds) {
    if (pref("tcSource", "off") === "internal") {
      const was = now();
      setInternal(internal.running, seconds);
      if (!internal.running) advance(was, seconds); // put the right cue up even while paused
    }
  }

  // --------------------------------------------------- cue times / edits

  function setCue(index, seconds) {
    const cue = S().cues?.[index];
    if (!cue) return false;
    if (seconds == null || seconds === "") delete cue.timecode;
    else cue.timecode = Math.max(0, Number(seconds));
    window.renderCues?.();
    return true;
  }

  // ------------------------------------------------------------- window

  let body = null, timer = null;
  function build(host) {
    body = host;
    host.innerHTML = `
      <div class="tcw">
        <div class="tcw-time" data-tc="time">--:--:--:--</div>
        <div class="tcw-status"><span data-tc="source"></span><span data-tc="state"></span><span data-tc="next"></span></div>
        <div class="tcw-row" data-tc="internal">
          <button type="button" class="btn-secondary" data-tca="play">▶ Play</button>
          <button type="button" class="btn-secondary" data-tca="pause">❚❚ Pause</button>
          <button type="button" class="btn-secondary" data-tca="stop">■ Stop</button>
          <input class="tcw-input" data-tc="locate" placeholder="00:00:00:00">
          <button type="button" class="btn-secondary" data-tca="locate">Locate</button>
        </div>
        <div class="tcw-row">
          <label class="tcw-check"><input type="checkbox" data-tc="trigger"> Timecode fires cues</label>
          <span class="tcw-grow"></span>
          <button type="button" class="btn-secondary" data-tca="learn" title="Give the next cue the time showing now">Set next cue to this time</button>
          <button type="button" class="btn-secondary" data-tca="prefs">Settings…</button>
        </div>
      </div>`;
    host.addEventListener("click", e => {
      const a = e.target.closest("[data-tca]")?.dataset.tca;
      if (!a) return;
      if (a === "play") play();
      else if (a === "pause") pause();
      else if (a === "stop") stop();
      else if (a === "locate") { const s = parse(host.querySelector('[data-tc="locate"]').value); if (s != null) locate(s); else say("Type a time like 00:01:30:00", "warn"); }
      else if (a === "learn") learnNext();
      else if (a === "prefs") window.LXPrefs?.open("showcontrol");
    });
    host.querySelector('[data-tc="trigger"]').addEventListener("change", e => window.LXPrefs?.set("tcTrigger", e.target.checked));
    clearInterval(timer);
    timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); timer = null; body = null; return; } render(); }, 40);
    render();
  }

  function learnNext() {
    const t = now();
    if (t == null) return say("No timecode yet — start the source first", "warn");
    const i = window.LXCueList?.next?.() ?? -1;
    if (!(i >= 0)) return say("No next cue to set", "warn");
    setCue(i, t);
    say(`Cue ${i + 1} fires at ${format(t)}`, "ok");
  }

  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  function render() {
    if (!body) return;
    const src = pref("tcSource", "off");
    const t = now();
    setText(body.querySelector('[data-tc="time"]'), format(t));
    body.querySelector(".tcw").classList.toggle("running", Boolean(clock.running));
    setText(body.querySelector('[data-tc="source"]'), { off: "Timecode off", mtc: "MIDI timecode (MTC)", ltc: "Audio timecode (LTC)", internal: "Internal clock" }[src] || src);
    const state = src === "off" ? "turn it on in Settings…" : clock.freewheel ? "FREEWHEEL — signal lost" : clock.running ? `running · ${Math.round((clock.fps || fpsPref()) * 100) / 100} fps` : t == null ? "waiting for timecode" : "stopped";
    // Timecode can't go below zero: a time "before zero" wraps round to 23:59:59.
    const wrapped = src !== "internal" && t != null && t >= 23.5 * 3600 ? ` · that's ${Math.round(24 * 3600 - t)} s before 00:00:00 — the sender's timecode starts before zero` : "";
    setText(body.querySelector('[data-tc="state"]'), state + wrapped);
    const list = timed();
    const next = list.find(([, c]) => t == null || c.timecode > t + 1e-6);
    setText(body.querySelector('[data-tc="next"]'), next ? `next: cue ${next[0] + 1} at ${format(next[1].timecode)}` : list.length ? "no more timed cues" : "no cues have a time yet");
    body.querySelector('[data-tc="internal"]').style.display = src === "internal" ? "" : "none";
    const trig = body.querySelector('[data-tc="trigger"]');
    if (trig.checked !== (pref("tcTrigger", true) !== false)) trig.checked = pref("tcTrigger", true) !== false;
  }

  // A small readout in the top bar while timecode is on.
  function topbar() {
    const src = pref("tcSource", "off");
    let el = $("lxTcTop");
    if (src === "off") { el?.remove(); return; }
    if (!el) {
      const status = document.querySelector(".topbar-status");
      if (!status) return;
      el = document.createElement("button");
      el.id = "lxTcTop";
      el.type = "button";
      el.className = "status-pill lx-tc-top";
      el.title = "Timecode — click for the Timecode window";
      el.addEventListener("click", open);
      status.prepend(el);
    }
    setText(el, `TC ${format(now())}`);
    el.classList.toggle("running", Boolean(clock.running));
    el.classList.toggle("freewheel", Boolean(clock.freewheel));
  }
  setInterval(topbar, 100);

  function open() { window.LXWindows?.open("timecode"); }

  function injectStyles() {
    if ($("lxTcStyles")) return;
    const style = document.createElement("style");
    style.id = "lxTcStyles";
    style.textContent = `
      .tcw{display:flex;flex-direction:column;gap:10px;padding:14px}
      .tcw-time{font:700 54px/1 var(--mono,monospace);letter-spacing:2px;text-align:center;padding:16px 0;border:1px solid var(--border);border-radius:8px;background:#060a0c;color:#6f7d7a}
      .tcw.running .tcw-time{color:#ffd27a;text-shadow:0 0 18px rgba(255,173,31,.25)}
      .tcw-status{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;color:#8c9a97;font-size:11px}
      .tcw-status span:first-child{color:var(--text);font-weight:700}
      .tcw-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      .tcw-input{width:120px;height:28px;padding:0 8px;background:#0a1013;border:1px solid var(--border-strong);border-radius:4px;color:var(--text);font:12px var(--mono,monospace)}
      .tcw-check{display:flex;align-items:center;gap:6px;color:#8c9a97;font-size:11px}
      .tcw-grow{flex:1}
      .lx-tc-top{font-family:var(--mono,monospace);cursor:pointer}
      .lx-tc-top.running{color:#ffd27a;border-color:rgba(255,173,31,.45)}
      .lx-tc-top.freewheel{color:#ff98a3;border-color:rgba(255,79,98,.5)}
    `;
    document.head.appendChild(style);
  }

  function boot(tries = 0) {
    injectStyles();
    if (window.LXWindows && !window.LXWindows.list().includes("timecode")) window.LXWindows.register({ id: "timecode", title: "Timecode", build, w: 520, h: 300 });
    if (!window.LXWindows && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  window.addEventListener("load", () => setTimeout(boot, 450));
  // Changing source starts from scratch.
  window.LXPrefs?.on?.(key => { if (key === "tcSource") { clock.time = null; clock.running = false; clock.freewheel = false; lastSeen = null; } });

  window.LXTimecode = Object.freeze({ feed, halt, now, format, parse, play, pause, stop, locate, setCue, open, learnNext, status: () => ({ ...clock, time: now() }) });
})();
