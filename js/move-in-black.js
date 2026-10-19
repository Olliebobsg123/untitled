"use strict";

/*
 * Move in black. Once a cue has finished, Light Spark looks at the next cue
 * (the amber one in the Cue List). Every light that is off now and comes on
 * in that cue gets everything except its intensity set early — position,
 * colour, gobo, zoom, focus, prism — so it fades up already in place.
 *
 *   - Only lights that are fully off are touched, and nothing in Blind.
 *   - Firing another cue stops it; choosing a different next cue redoes it.
 *   - Turn it off per cue from the Cue List's right-click menu, or all of it
 *     in Preferences → Programming → Move in black (also the delay, the move
 *     time and which attributes move).
 *
 *   LXMoveInBlack.presetFor(id)  → index of the cue a light was preset for
 *   LXMoveInBlack.status()       → { cue, ids } of the last preset
 */
(function () {
  if (window.LXMoveInBlack) return;

  const S = () => window.State;
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;

  const POSITION = new Set(["pan", "panf", "tilt", "tiltf"]);
  const BEAM = /^(gobo|gobo2|gobor|gobo2r|prism|prismr|focus|zoom|frost|iris|rot|fresnel|shutter\d\w*)$/;
  const COLOUR = /^(hue|sat|light|cyan|magenta|yellow|cto|colmacro|r|g|b|w|a|uv|lime|red|green|blue|white|amber)$|col|wheel/i;
  // Never preset: intensity, strobe and anything that makes light, smoke or
  // runs a built-in programme.
  const NEVER = /^(intensity|master|strobe|shutter|effect|speed|macro|preset|shake|mode|zone|fog|fana|haze|fluid|blackout)$|^__/;

  function wanted(key) {
    if (NEVER.test(key)) return false;
    if (POSITION.has(key)) return pref("mibPosition", true) !== false;
    if (BEAM.test(key)) return pref("mibBeam", true) !== false;
    if (COLOUR.test(key)) return pref("mibColour", true) !== false;
    return pref("mibOther", true) !== false;
  }

  const blind = () => document.documentElement.dataset.consoleMode === "blind";
  const level = st => Number(st?.intensity) || 0;

  let readyAt = Infinity;    // when to look at the next cue
  let done = "";             // "live>next" already preset
  let preset = null;         // { cue, ids:Set }
  let frameId = null;

  function stop() {
    if (frameId != null) { window.LXClock?.cancel(frameId); frameId = null; }
  }

  function nextCue() {
    const s = S();
    const i = window.LXCueList?.next?.() ?? (s.currentCue + 1);
    return Number.isInteger(i) && i >= 0 && s.cues?.[i] ? i : -1;
  }

  function run() {
    const s = S();
    const live = s.currentCue, next = nextCue();
    if (s.fading != null) return 0; // something's still fading: try again in a moment
    done = `${live}>${next}`;
    if (pref("mib", true) === false || blind() || live < 0 || next < 0) return 0;
    const cue = s.cues[next];
    if (cue.noMib || cue.chase) return 0;
    let target;
    try { target = window.getCueTarget(cue).fixtureMap; } catch (_) { return 0; }
    const moves = [];
    target.forEach((to, id) => {
      const now = s.fixtureStates.get(id);
      if (!now || level(now) > 0 || level(to) <= 0) return;
      const keys = Object.keys(to).filter(k => wanted(k) && !(now.__targetPositionLock && POSITION.has(k)) && to[k] !== now[k]);
      if (keys.length) moves.push({ id, from: { ...now }, to, keys });
    });
    preset = { cue: next, ids: new Set(moves.map(m => m.id)) };
    if (!moves.length) return 0;
    const ms = Math.max(0, Number(pref("mibTimeMs", 2000)) || 0);
    const ids = moves.map(m => m.id);
    window.LXFixtureInfo?.act("mib", "Move in black", `presetting cue ${next + 1}`, ms + 600, ids);
    window.LXFixtureInfo?.claimKeys(ids, [...new Set(moves.flatMap(m => m.keys))], { kind: "mib", label: `Move in black for cue ${next + 1}`, detail: "preset while dark" });
    if (pref("mibLog", true) !== false) window.log?.(`Move in black: ${moves.length} light${moves.length === 1 ? "" : "s"} preset for cue ${next + 1}`, "info");
    const start = performance.now();
    const step = now => {
      frameId = null;
      const p = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      for (const m of moves) {
        const cur = s.fixtureStates.get(m.id);
        if (!cur || level(cur) > 0) { preset?.ids.delete(m.id); continue; } // someone brought it up: leave it
        const out = { ...cur };
        for (const k of m.keys) {
          const a = m.from[k], b = m.to[k];
          out[k] = typeof a === "number" && typeof b === "number" ? a + (b - a) * e : p < 1 ? (a ?? b) : b;
        }
        s.fixtureStates.set(m.id, out);
      }
      try { window.updateDMX?.(); window.sendToVisualizer?.(); } catch (_) {}
      if (p < 1) frameId = window.LXClock.frame(step);
    };
    frameId = window.LXClock ? window.LXClock.frame(step) : (step(performance.now() + ms), null);
    return moves.length;
  }

  function hook() {
    if (typeof window.goToCue !== "function" || window.goToCue.__lxMib) return Boolean(window.goToCue?.__lxMib);
    const original = window.goToCue;
    const wrapped = function () {
      stop();
      preset = null;
      readyAt = Infinity;
      done = "";
      return original.apply(this, arguments);
    };
    Object.assign(wrapped, original);
    wrapped.__lxMib = true;
    window.goToCue = wrapped;
    return true;
  }

  window.addEventListener("lx-cue-complete", () => {
    readyAt = performance.now() + Math.max(0, Number(pref("mibDelayMs", 1000)) || 0);
  });

  // Watch for the delay running out, and for a different next cue.
  setInterval(() => {
    const s = S();
    if (!s || readyAt === Infinity) return;
    const key = `${s.currentCue}>${nextCue()}`;
    if (key === done && frameId == null) return;
    if (key !== done && done) { stop(); readyAt = Math.min(readyAt, performance.now() + 300); done = ""; }
    if (performance.now() >= readyAt && frameId == null && key !== done) run();
  }, 120);

  window.LXPrefs?.on?.((key, value) => { if (key === "mib") { stop(); preset = null; done = ""; } });

  function boot(tries = 0) {
    const ok = hook();
    if (!ok && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  window.addEventListener("load", () => setTimeout(boot, 600));

  window.LXMoveInBlack = Object.freeze({
    presetFor(id) {
      if (!preset || !preset.ids.has(id)) return null;
      return level(S().fixtureStates.get(id)) > 0 ? null : preset.cue;
    },
    status: () => (preset ? { cue: preset.cue, ids: [...preset.ids] } : null),
    run,
    stop
  });
})();
