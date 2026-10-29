"use strict";

/*
 * Show tempo. An effect set to follow the tempo has "beats" instead of a
 * speed: how long one cycle lasts (a wave over 1 bar = 4 beats), or one
 * step for step effects (chase, build, sparkle: 1 beat = a step a beat).
 * Change the tempo — type it, "tempo 128", or tap — and those effects
 * speed up or slow down in place, without jumping. It's in the top bar,
 * with Tap. Saved with the show.
 */
(function () {
  if (window.LXTempo) return;
  const S = () => window.State || {};
  const clamp = v => Math.max(20, Math.min(300, Math.round(Number(v) * 10) / 10 || 120));
  const bpm = () => clamp(S().tempo?.bpm ?? 120);
  const say = (m, t = "ok") => window.log?.(m, t);

  // How many cycles (or steps) each effect does per second at speed 1.
  const CYCLES_AT_1 = {
    strobe: 0.5, alternate: 0.5,     // speed counts on and off separately
    sparkle: 8, flicker: 12, fireplace: 3, snowfall: 1.4,
    aurora: 0.2, iceshimmer: 0.35, blizzard: 0.23, freeze: 0.25
  };
  const speedFor = (type, beats, at = bpm()) => (at / 60 / Math.max(0.01, Number(beats) || 1)) / (CYCLES_AT_1[type] || 1);
  const describeBeats = b => {
    b = Number(b);
    if (b >= 4 && b % 4 === 0) return b === 4 ? "1 bar" : `${b / 4} bars`;
    return b === 1 ? "1 beat" : b === 0.5 ? "½ beat" : b === 0.25 ? "¼ beat" : `${b} beats`;
  };

  // Running effects that follow the tempo change speed without a jump:
  // their clock is moved so they're at the same point in the cycle.
  function retime() {
    const now = performance.now();
    for (const e of S().effects || []) {
      if (!(e?.beats > 0) || !e.options) continue;
      const before = Number(e.options.speed) || 1, after = speedFor(e.type, e.beats);
      if (Math.abs(before - after) < 1e-9) continue;
      const elapsed = (now - e.started) / 1000;
      e.started = now - elapsed * (before / after) * 1000;
      e.options.speed = after;
      e.speed = after;
    }
  }

  function set(value, { quiet = false } = {}) {
    const v = clamp(value);
    const s = S();
    s.tempo = { bpm: v };
    retime();
    render();
    if (!quiet) say(`Tempo ${v} BPM`, "ok");
    return v;
  }

  const taps = [];
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length < 2) { render(); return null; }
    return set(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)), { quiet: true });
  }

  // Called by the command line (js/command-line.js).
  function command(c) {
    let m;
    if ((m = /^(?:tempo|bpm)\s+(\d+(?:\.\d+)?)$/.exec(c))) { set(m[1]); return true; }
    if (c === "tempo" || c === "bpm") { say(`Tempo ${bpm()} BPM — ${(S().effects || []).filter(e => e.beats > 0).length} effect(s) following it`, "ok"); return true; }
    if (c === "tap" || c === "tap tempo") { const v = tap(); say(v ? `Tempo ${v} BPM` : "Tap again in time", "ok"); return true; }
    return false;
  }

  // ------------------------------------------------- in the top bar

  // js/shell.js makes the slot (#shellTempo) in the top bar.
  function render() {
    const host = document.getElementById("shellTempo");
    if (!host) return;
    let bar = document.getElementById("lxTempoBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "lxTempoBar";
      bar.className = "lx-tempo";
      bar.title = "Show tempo: effects set to “Follow tempo”, and chases following the show tempo, run at this speed";
      bar.innerHTML = `<span class="lx-tempo-dot"></span><input type="number" id="lxTempoBpm" min="20" max="300" step="1" aria-label="Show tempo (BPM)"><span class="lx-tempo-unit">BPM</span><button type="button" class="btn-secondary" id="lxTempoTap">Tap</button>`;
      host.appendChild(bar);
      bar.querySelector("#lxTempoBpm").addEventListener("change", e => set(e.target.value));
      bar.querySelector("#lxTempoTap").addEventListener("pointerdown", e => { e.preventDefault(); tap(); });
    }
    const input = bar.querySelector("#lxTempoBpm");
    if (document.activeElement !== input) input.value = String(Math.round(bpm() * 10) / 10);
  }

  // The dot blinks on the beat.
  let dotTimer = null;
  function blink() {
    clearTimeout(dotTimer);
    const dot = document.querySelector("#lxTempoBar .lx-tempo-dot");
    if (dot) { dot.classList.add("on"); setTimeout(() => dot.classList.remove("on"), 90); }
    dotTimer = setTimeout(blink, 60000 / bpm());
  }

  function install(tries = 0) {
    if (!document.getElementById("shellTempo")) { if (tries < 150) setTimeout(() => install(tries + 1), 200); return; }
    render();
    blink();
  }
  // A show that's opened brings its tempo.
  window.addEventListener("lx-show-file", () => setTimeout(() => { retime(); render(); }, 200));

  window.LXTempo = { bpm, set, tap, speedFor, describeBeats, command, retime };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
