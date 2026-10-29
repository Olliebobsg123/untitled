"use strict";

(function initialiseChases() {
  const S = () => window.State;
  const log = (message, type = "info") => {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(`[CHASE ${type}]`, message);
  };
  const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const clone = v => typeof window.cloneFixtureState === "function"
    ? window.cloneFixtureState(v)
    : { ...(v && typeof v === "object" ? v : {}) };

  let selectedChase = -1;
  let runToken = 0;
  let cueBridgeInstalled = false;

  function fixtures() { return (S()?.fixtures || []).filter(f => f && f.id != null); }

  function selectedFixtureIds() {
    const s = S();
    const all = fixtures();
    const selected = s?.selected instanceof Set ? [...s.selected] : [];
    return selected.length
      ? all.filter(f => selected.some(id => String(id) === String(f.id))).map(f => f.id)
      : all.map(f => f.id);
  }

  function chaseFixtureIds(chase) {
    const all = fixtures();
    if (!Array.isArray(chase?.fixtureIds) || !chase.fixtureIds.length) return all.map(f => f.id);
    return all.filter(f => chase.fixtureIds.some(id => String(id) === String(f.id))).map(f => f.id);
  }

  function cueState(cue, id) {
    if (!cue) return {};
    if (cue.mode === "track" && typeof window.getCueTarget === "function") {
      const st = window.getCueTarget(cue).fixtureMap.get(id);
      if (st) return clone(st);
    }
    if (Array.isArray(cue.fixtureStates)) {
      const hit = cue.fixtureStates.find(x => Array.isArray(x) && String(x[0]) === String(id));
      if (hit?.[1]) return clone(hit[1]);
    }
    return clone(cue.globalState || cue.state || {});
  }

  function pushState(globalState, map) {
    const s = S();
    if (!s) return;
    s.current ||= {};
    Object.assign(s.current, clone(globalState || {}));
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    map.forEach((state, id) => s.fixtureStates.set(id, clone(state)));
    try { window.updateDMX?.(); } catch (e) { console.error("[CHASE] DMX", e); }
    try { window.sendToVisualizer?.(); } catch (e) { console.error("[CHASE] visualizer", e); }
  }

  function applyCueToFixtures(cue, fixtureIds) {
    const s = S();
    if (!s || !cue) return false;
    if (!(s.fixtureStates instanceof Map)) s.fixtureStates = new Map();
    const allowed = new Set(fixtureIds.map(String));
    const map = new Map();
    fixtures().forEach(f => {
      const existing = s.fixtureStates.get(f.id) || s.current || {};
      map.set(f.id, clone(existing));
    });
    fixtures().forEach(f => {
      if (!allowed.has(String(f.id))) return;
      map.set(f.id, cueState(cue, f.id));
    });
    pushState(cue.globalState || cue.state || {}, map);
    return true;
  }

  function captureLook() {
    const s = S();
    const fixtureStates = fixtures().map(f => [f.id, clone(s.fixtureStates?.get(f.id) || s.current || {})]);
    return { globalState: clone(s.current || {}), fixtureStates };
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return false;
    const map = new Map((snapshot.fixtureStates || []).filter(x => Array.isArray(x) && x.length > 1));
    pushState(snapshot.globalState || {}, map);
    return true;
  }

  // The colour of a light in a step, for the preview strip.
  function swatch(st) {
    if (!st || typeof st !== "object") return "#1a2226";
    const level = Math.max(0, Math.min(100, Number(st.intensity ?? 100))) / 100;
    if (level <= 0.02) return "#0d1215";
    const mix = (r, g, b) => `rgb(${Math.round(r * level + 13 * (1 - level))},${Math.round(g * level + 18 * (1 - level))},${Math.round(b * level + 21 * (1 - level))})`;
    if ([st.r, st.g, st.b].some(v => Number(v) > 0) && ![st.r, st.g, st.b].every(v => Number(v) === Number(st.r))) return mix(Number(st.r) || 0, Number(st.g) || 0, Number(st.b) || 0);
    const sat = Number(st.sat) || 0;
    if (sat > 5) {
      const h = (Number(st.hue) || 0) / 360, l = Math.max(0.3, Math.min(0.7, (Number(st.light) || 50) / 100)), s2 = Math.min(1, sat / 100);
      const k = n => (n + h * 12) % 12, a = s2 * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
      return mix(f(0) * 255, f(8) * 255, f(4) * 255);
    }
    return mix(235, 228, 210);
  }
  // Steps × lights of colour (up to 12 steps, 6 lights).
  function preview(chase) {
    const s = S();
    let steps = [];
    if (chase.mode === "snapshot") steps = (chase.snapshots || []).map(sn => (sn.fixtureStates || []).map(x => x?.[1]));
    else if (chase.mode === "spread") steps = [...Array(6).keys()].map(k => [...Array(6).keys()].map(i => ({ hue: ((i + k) * 60) % 360, sat: 100, light: 50, intensity: 100 })));
    else steps = (chase.steps || []).map(i => { const look = typeof window.getCueTarget === "function" && s.cues?.[i] ? window.getCueTarget(s.cues[i]).fixtureMap : null; return look ? [...look.values()] : []; });
    return steps.slice(0, 12).map(states => { const pick = states.filter(Boolean); const n = Math.min(6, pick.length || 1); return [...Array(n).keys()].map(j => swatch(pick[Math.floor(j * pick.length / n)])); });
  }
  const groupOf = chase => (chase.auto ? `Auto · ${(/^([^:]+?):/.exec(String(chase.name || "")) || [, "Other"])[1]}` : "Your chases");
  let showAuto = true;
  try { showAuto = localStorage.getItem("lx-chases-auto") !== "0"; } catch (_) {}

  function renderChases() {
    const list = document.getElementById("chaseList");
    const s = S();
    if (!list || !s) return;
    s.chases = Array.isArray(s.chases) ? s.chases : [];
    list.replaceChildren();
    list.classList.add("ch-groups");
    if (!s.chases.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No chases yet. Click New Chase to create one, or Auto Create on the Patch page makes a set.";
      list.appendChild(empty);
      return;
    }
    const autoCount = s.chases.filter(c => c?.auto).length;
    if (autoCount) {
      const bar = document.createElement("label");
      bar.className = "ch-autobar";
      bar.innerHTML = `<input type="checkbox"${showAuto ? " checked" : ""}> Show the ${autoCount} auto-made chase${autoCount === 1 ? "" : "s"}`;
      bar.querySelector("input").addEventListener("change", e => { showAuto = e.target.checked; try { localStorage.setItem("lx-chases-auto", showAuto ? "1" : "0"); } catch (_) {} renderChases(); });
      list.appendChild(bar);
    }
    const groups = new Map();
    s.chases.forEach((chase, i) => {
      if (!chase || (chase.auto && !showAuto && i !== s.currentChase)) return;
      const g = groupOf(chase);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([chase, i]);
    });
    const order = [...groups.keys()].sort((a, b) => (a === "Your chases" ? -1 : b === "Your chases" ? 1 : a.localeCompare(b)));
    for (const g of order) {
      const section = document.createElement("section");
      section.className = "ch-group";
      section.innerHTML = `<h3>${g.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))} <small>${groups.get(g).length}</small></h3><div class="ch-grid"></div>`;
      const grid = section.querySelector(".ch-grid");
      for (const [chase, i] of groups.get(g)) {
        const el = document.createElement("div");
        el.className = `cue-item ch-card ${i === selectedChase ? "active" : ""} ${i === s.currentChase ? "running" : ""}`;
        el.dataset.chase = String(i);
        const steps = preview(chase);
        const count = chase.mode === "snapshot" ? (chase.snapshots?.length || 0) : (chase.steps?.length || 0);
        const name = chase.auto ? String(chase.name || "").replace(/^[^:]+?:\s*/, "") : chase.name || `Chase ${i + 1}`;
        const fxCount = Array.isArray(chase.fixtureIds) && chase.fixtureIds.length ? `${chase.fixtureIds.length} light${chase.fixtureIds.length === 1 ? "" : "s"}` : "all lights";
        el.title = `${i + 1}. ${chase.name || `Chase ${i + 1}`}`;
        el.innerHTML = `<div class="ch-strip">${steps.map(col => `<span>${col.map(c => `<i style="background:${c}"></i>`).join("")}</span>`).join("") || "<span></span>"}</div>
          <div class="ch-body"><strong></strong><small>${count} step${count === 1 ? "" : "s"} · ${chase.followTempo ? "♩ show tempo" : `${Math.round(bpmOf(chase))} BPM`} · ${fxCount}${chase.loop ? "" : " · once"}</small></div>
          <button type="button" class="ch-play" title="${i === s.currentChase ? "Stop" : "Run"} this chase">${i === s.currentChase ? "■" : "▶"}</button>`;
        el.querySelector("strong").textContent = name;
        el.onclick = e => {
          if (e.target.closest(".ch-play")) { if (i === S().currentChase) stopChase(); else startChase(i); return; }
          selectedChase = i; showSpeed(chase); renderChases(); log(`Selected Chase ${i + 1}: ${chase.name || `Chase ${i + 1}`}`);
        };
        el.ondblclick = () => startChase(i);
        grid.appendChild(el);
      }
      list.appendChild(section);
    }
  }

  function stopChase(message = true) {
    runToken++;
    const s = S();
    if (!s) return;
    if (s.chaseTimer) clearTimeout(s.chaseTimer);
    s.chaseTimer = null;
    s.currentChase = -1;
    if (typeof window.stopCueTimers === "function") window.stopCueTimers();
    if (s.fading != null) { LXClock.cancel(s.fading); s.fading = null; }
    renderChases();
    if (message) log("⏹ Chase stopped");
  }

  /*
   * Chase speed is in BPM: one step per beat, from 6 BPM (a step every 10
   * seconds) to 1200 BPM (20 steps a second). Shows saved before BPM kept
   * a "speed" percentage that meant 100000/speed ms a step, i.e.
   * 0.6 × speed BPM, so they run exactly as they did.
   * The crossfade never holds a step up: it's cut to the step time.
   */
  const BPM_MIN = 6, BPM_MAX = 1200;
  const clampBpm = v => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(Number(v) * 10) / 10 || 120));
  // A chase can follow the show tempo (js/tempo.js, in the top bar): one
  // step per beat.
  function bpmOf(chase) {
    if (chase?.followTempo && window.LXTempo) return clampBpm(window.LXTempo.bpm());
    if (Number.isFinite(Number(chase?.bpm))) return clampBpm(chase.bpm);
    return clampBpm(0.6 * Math.max(10, Math.min(100, n(chase?.speed, 50))));
  }
  const stepMs = chase => 60000 / bpmOf(chase);
  const fadeMs = chase => Math.min(Math.max(0, Math.min(60000, n(chase?.fade, 0))), stepMs(chase));
  // The speed slider runs on a log scale so slow and fast both get room.
  const sliderToBpm = v => clampBpm(BPM_MIN * Math.pow(BPM_MAX / BPM_MIN, Number(v) / 1000));
  const bpmToSlider = bpm => Math.round(1000 * Math.log(clampBpm(bpm) / BPM_MIN) / Math.log(BPM_MAX / BPM_MIN));
  const describeBpm = bpm => `${Math.round(bpm)} BPM · ${(60 / bpm).toFixed(60 / bpm < 1 ? 2 : 1)} s`;

  const defaultBpm = () => clampBpm(window.LXPrefs?.get("chaseBpm") ?? 120);

  // The speed slider shows the selected chase's speed.
  function showSpeed(chase) {
    const speed = document.getElementById("chaseSpeed");
    if (!speed || !chase) return;
    speed.value = String(bpmToSlider(bpmOf(chase)));
    speed.disabled = Boolean(chase.followTempo);
    const out = document.getElementById("chaseSpeedVal");
    if (out) out.textContent = chase.followTempo ? `show tempo · ${Math.round(bpmOf(chase))} BPM` : describeBpm(bpmOf(chase));
    const follow = document.getElementById("chaseFollowTempo");
    if (follow) follow.checked = Boolean(chase.followTempo);
  }
  let metaTimer = null;
  const renderChaseMetaSoon = () => { clearTimeout(metaTimer); metaTimer = setTimeout(() => renderChases(), 150); };

  // "Follow show tempo" beside the speed: the tempo and its Tap are in the
  // top bar, once for the whole show.
  function installFollow(speed) {
    const row = speed.closest("label");
    if (!row || document.getElementById("chaseFollowTempo")) return;
    const box = document.createElement("label");
    box.className = "ch-follow";
    box.title = "One step per beat of the show tempo (top bar). Tap there to set it.";
    box.innerHTML = '<input type="checkbox" id="chaseFollowTempo"> Follow show tempo';
    row.after(box);
    box.querySelector("input").addEventListener("change", e => {
      const c = S()?.chases?.[selectedChase];
      if (!c) { e.target.checked = false; log("Select a chase first", "warn"); return; }
      c.followTempo = e.target.checked;
      if (!c.followTempo) c.bpm = bpmOf({ ...c, followTempo: false });
      showSpeed(c);
      renderChaseMetaSoon();
    });
  }

  // The show tempo changed: chases following it show the new speed.
  window.addEventListener("lx-tempo", () => {
    const c = S()?.chases?.[selectedChase];
    if (c?.followTempo) showSpeed(c);
    if ((S()?.chases || []).some(x => x?.followTempo)) renderChaseMetaSoon();
  });

  function schedule(token, chase, fn) {
    const s = S();
    s.chaseTimer = setTimeout(() => { if (token === runToken && s.currentChase >= 0) fn(); }, Math.max(40, stepMs(chase)));
  }

  function runSequence(token, chase, step) {
    const s = S();
    if (!s || token !== runToken || s.currentChase !== chase.__index) return;
    const cueIndex = Number(chase.steps[step]);
    const cue = s.cues?.[cueIndex];
    if (!cue) return stopChase(false);
    const fade = fadeMs(chase);
    const fixtureIds = chaseFixtureIds(chase);
    console.debug(`CHASE: sequence step ${step + 1}/${chase.steps.length} → Cue ${window.cueLabel?.(cueIndex) ?? cueIndex + 1} on ${fixtureIds.length} fixture(s)`);
    if (fade > 0 && typeof window.fadeTo === "function") {
      const target = clone(cue.globalState || cue.state || {});
      const fixtureTargets = fixtureIds.map(id => [id, cueState(cue, id)]);
      window.fadeTo(target, fade, fixtureTargets);
    } else {
      applyCueToFixtures(cue, fixtureIds);
    }
    s.currentCue = cueIndex;

    let next = step + 1;
    if (next >= chase.steps.length) {
      if (!chase.loop) return stopChase();
      next = 0;
    }
    schedule(token, chase, () => runSequence(token, chase, next));
  }

  function runSpread(token, chase, rotation) {
    const s = S();
    const allowed = new Set(chaseFixtureIds(chase).map(String));
    const fs = fixtures().filter(f => allowed.has(String(f.id)));
    const steps = (chase.steps || []).map(Number).filter(i => s?.cues?.[i]);
    if (!s || token !== runToken || s.currentChase !== chase.__index) return;
    if (!fs.length || !steps.length) return stopChase(false);

    const map = new Map();
    fixtures().forEach(f => map.set(f.id, clone(s.fixtureStates?.get(f.id) || s.current || {})));
    fs.forEach((fixture, fixtureIndex) => {
      const cueIndex = steps[(fixtureIndex + rotation) % steps.length];
      const state = cueState(s.cues[cueIndex], fixture.id);
      map.set(fixture.id, state);
      console.debug(`CHASE: fixture ${fixture.id} ← Cue ${cueIndex + 1}`);
    });
    const first = s.cues[steps[rotation % steps.length]];
    pushState(first?.globalState || first?.state || {}, map);
    s.currentCue = steps[rotation % steps.length];

    const next = rotation + 1;
    if (!chase.loop && next >= steps.length) return stopChase();
    schedule(token, chase, () => runSpread(token, chase, next % steps.length));
  }

  function runSnapshot(token, chase, step) {
    const s = S();
    if (!s || token !== runToken || s.currentChase !== chase.__index) return;
    const snapshot = chase.snapshots?.[step];
    if (!snapshot) return stopChase(false);
    const ids = new Set(chaseFixtureIds(chase).map(String));
    const filtered = (snapshot.fixtureStates || []).filter(x => Array.isArray(x) && x.length > 1 && ids.has(String(x[0])));
    applySnapshot({ globalState: snapshot.globalState, fixtureStates: filtered });
    console.debug(`CHASE: recorded look ${step + 1}/${chase.snapshots.length} on ${ids.size} fixture(s)`);
    let next = step + 1;
    if (next >= chase.snapshots.length) {
      if (!chase.loop) return stopChase();
      next = 0;
    }
    schedule(token, chase, () => runSnapshot(token, chase, next));
  }

  function startChase(index) {
    const s = S();
    index = Number(index);
    const chase = s?.chases?.[index];
    if (!s || !Number.isInteger(index) || !chase) { log("Choose a chase first", "warn"); return false; }
    stopChase(false);
    const valid = Array.isArray(chase.steps) ? chase.steps.map(Number).filter(i => s.cues?.[i]) : [];
    if (chase.mode === "snapshot" && !chase.snapshots?.length) { log("Recorded chase has no looks", "warn"); return false; }
    if (chase.mode !== "snapshot" && !valid.length) { log("Chase contains no valid cues", "warn"); return false; }
    chase.steps = valid;
    chase.__index = index;
    selectedChase = index;
    s.currentChase = index;
    runToken++;
    const token = runToken;
    const ids = chaseFixtureIds(chase);
    renderChases();
    log(`▶ Started Chase ${index + 1}: ${chase.name || `Chase ${index + 1}`} (${chase.mode || "sequence"}) — ${ids.length} fixture(s)`, "ok");
    if (chase.mode === "snapshot") runSnapshot(token, chase, 0);
    else if (chase.mode === "spread") runSpread(token, chase, 0);
    else runSequence(token, chase, 0);
    return true;
  }

  // `bpm`: steps per minute (see bpmOf).
  function saveChase(name, cueIndices, loop = true, bpm = defaultBpm(), fade = 0, mode = "sequence", fixtureIds = null) {
    const s = S();
    if (!s) return false;
    const steps = [...new Set((Array.isArray(cueIndices) ? cueIndices : []).map(Number).filter(i => Number.isInteger(i) && s.cues?.[i]))];
    if (!steps.length) { log("Choose at least one cue for the chase", "warn"); return false; }
    const allIds = fixtures().map(f => f.id);
    const ids = Array.isArray(fixtureIds) && fixtureIds.length
      ? allIds.filter(id => fixtureIds.some(x => String(x) === String(id)))
      : selectedFixtureIds();
    if (!ids.length) { log("Select at least one fixture for the chase", "warn"); return false; }
    const chase = {
      name: String(name || `Chase ${(s.chases?.length || 0) + 1}`).trim(),
      steps, fixtureIds: ids, loop: Boolean(loop), bpm: clampBpm(bpm),
      fade: Math.max(0, Math.min(60000, n(fade, 0))), mode: mode === "spread" ? "spread" : "sequence"
    };
    s.chases = Array.isArray(s.chases) ? s.chases : [];
    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`✅ Saved Chase: ${chase.name} — ${steps.map(i => `Cue ${window.cueLabel(i)}`).join(", ")} — ${ids.length} fixture(s)`, "ok");
    return true;
  }

  function recordSnapshotChase(name, loop = true, bpm = defaultBpm(), fade = 0, fixtureIds = null) {
    const s = S();
    if (!s || !fixtures().length) { log("Patch at least one fixture before recording", "warn"); return false; }
    const ids = Array.isArray(fixtureIds) && fixtureIds.length ? fixtureIds : selectedFixtureIds();
    if (!ids.length) { log("Select at least one fixture for the chase", "warn"); return false; }
    s.chases = Array.isArray(s.chases) ? s.chases : [];
    const all = captureLook();
    const allowed = new Set(ids.map(String));
    all.fixtureStates = all.fixtureStates.filter(x => allowed.has(String(x[0])));
    const chase = {
      name: String(name || `Chase ${s.chases.length + 1}`).trim(), mode: "snapshot", steps: [],
      snapshots: [all], fixtureIds: ids, loop: Boolean(loop), bpm: clampBpm(bpm),
      fade: Math.max(0, Math.min(60000, n(fade, 0)))
    };
    s.chases.push(chase);
    selectedChase = s.chases.length - 1;
    renderChases();
    log(`💾 Recorded chase look: ${chase.name} — ${ids.length} fixture(s)`, "ok");
    return true;
  }

  function addSnapshotToSelected() {
    const s = S();
    const chase = s?.chases?.[selectedChase];
    if (!chase || chase.mode !== "snapshot") { log("Select a recorded chase first", "warn"); return false; }
    const ids = new Set(chaseFixtureIds(chase).map(String));
    const snapshot = captureLook();
    snapshot.fixtureStates = snapshot.fixtureStates.filter(x => ids.has(String(x[0])));
    chase.snapshots = Array.isArray(chase.snapshots) ? chase.snapshots : [];
    chase.snapshots.push(snapshot);
    renderChases();
    log(`💾 Added look ${chase.snapshots.length} to ${chase.name}`, "ok");
    return true;
  }

  function picker() {
    const s = S();
    if (!s?.cues?.some(Boolean)) { log("Add at least one cue first", "warn"); return; }
    const fs = fixtures();
    if (!fs.length) { log("Patch at least one fixture first", "warn"); return; }
    document.getElementById("chasePicker")?.remove();
    const modal = document.createElement("div");
    modal.id = "chasePicker";
    modal.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:20px";
    const box = document.createElement("div");
    box.style.cssText = "width:min(760px,96vw);max-height:90vh;overflow:auto;background:#151515;border:1px solid #444;padding:24px;border-radius:10px";
    box.innerHTML = `<h2 style="margin-top:0">Create Chase</h2><p>Select the cues <b>and fixtures</b> this chase should control.</p>`;

    const name = document.createElement("input");
    name.placeholder = "Chase name";
    name.style.cssText = "width:100%;margin-bottom:12px";

    const mode = document.createElement("select");
    mode.style.cssText = "width:100%;margin-bottom:12px";
    mode.innerHTML = `<option value="sequence">Sequence — one cue after another</option><option value="spread">🌈 Per-fixture — different cue/colour on each light</option><option value="snapshot">Recorded looks — independent of cue stack</option>`;

    const fixtureHeading = document.createElement("div");
    fixtureHeading.innerHTML = `<strong>Fixtures</strong> <small style="opacity:.7">(defaults to your currently selected fixtures)</small>`;
    fixtureHeading.style.marginTop = "8px";
    const fixtureList = document.createElement("div");
    fixtureList.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px;margin:8px 0 14px";
    const currentSelected = new Set(selectedFixtureIds().map(String));
    fs.forEach((fixture, i) => {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;gap:8px;align-items:center;padding:9px;background:#202020;border-radius:5px";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = String(fixture.id); cb.checked = currentSelected.has(String(fixture.id));
      label.append(cb, document.createTextNode(fixture.name || `Fixture ${i + 1}`));
      fixtureList.appendChild(label);
    });

    const cueHeading = document.createElement("strong");
    cueHeading.textContent = "Cues";
    const list = document.createElement("div");
    list.style.cssText = "display:grid;gap:6px;margin:8px 0 12px";
    s.cues.forEach((cue, i) => {
      if (!cue) return;
      const label = document.createElement("label");
      label.style.cssText = "display:flex;gap:8px;padding:8px;background:#202020";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = String(i);
      label.append(cb, document.createTextNode(`Cue ${window.cueLabel(i)} — ${cue.name || `Cue ${window.cueLabel(i)}`}`));
      list.appendChild(label);
    });

    const opts = document.createElement("div");
    opts.innerHTML = `<label>Speed <input id="cpSpeed" type="number" min="${BPM_MIN}" max="${BPM_MAX}" step="1" value="${defaultBpm()}"> BPM</label> <label>Fade ms <input id="cpFade" type="number" min="0" max="60000" value="0"></label> <label><input id="cpLoop" type="checkbox" checked> Loop</label>`;
    const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px;margin-top:16px";
    const save = document.createElement("button"); save.className = "btn-primary"; save.textContent = "Save Chase";
    const cancel = document.createElement("button"); cancel.className = "btn-secondary"; cancel.textContent = "Cancel";

    save.onclick = () => {
      const selectedCues = [...list.querySelectorAll('input[type="checkbox"]:checked')].map(x => Number(x.value));
      const selectedFixtures = [...fixtureList.querySelectorAll('input[type="checkbox"]:checked')].map(x => x.value);
      const speed = Number(opts.querySelector("#cpSpeed").value);
      const fade = Number(opts.querySelector("#cpFade").value);
      const loop = opts.querySelector("#cpLoop").checked;
      if (!selectedFixtures.length) { log("Select at least one fixture for the chase", "warn"); return; }
      let ok;
      if (mode.value === "snapshot") ok = recordSnapshotChase(name.value, loop, speed, fade, selectedFixtures);
      else ok = saveChase(name.value, selectedCues, loop, speed, fade, mode.value, selectedFixtures);
      if (ok) modal.remove();
    };
    cancel.onclick = () => modal.remove();
    actions.append(save, cancel);
    box.append(name, mode, fixtureHeading, fixtureList, cueHeading, list, opts, actions);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function wireButtons() {
    const save = document.getElementById("btnSaveChase");
    const run = document.getElementById("btnRunChase");
    const stop = document.getElementById("btnStopChase");
    if (save) save.onclick = e => { e.preventDefault(); picker(); };
    if (run) run.onclick = e => { e.preventDefault(); if (selectedChase >= 0) startChase(selectedChase); else log("Select a chase first", "warn"); };
    if (stop) stop.onclick = e => { e.preventDefault(); stopChase(); };
    const speed = document.getElementById("chaseSpeed");
    if (speed) {
      speed.min = "0"; speed.max = "1000"; speed.step = "1";
      const label = speed.closest("label")?.querySelector("strong");
      if (label && !label.dataset.bpm) { label.dataset.bpm = "1"; label.innerHTML = '<span id="chaseSpeedVal"></span>'; label.style.cssText = "white-space:nowrap;min-width:120px;text-align:right"; }
      speed.oninput = () => {
        const bpm = sliderToBpm(speed.value);
        const out = document.getElementById("chaseSpeedVal");
        if (out) out.textContent = describeBpm(bpm);
        const c = S()?.chases?.[selectedChase];
        if (c) { c.bpm = bpm; renderChaseMetaSoon(); }
      };
      installFollow(speed);
      const c = S()?.chases?.[selectedChase];
      if (c) showSpeed(c); else { speed.value = String(bpmToSlider(defaultBpm())); speed.oninput(); }
    }
  }

  function installCueBridge() {
    if (cueBridgeInstalled || typeof window.goToCue !== "function") return;
    const original = window.goToCue;
    window.goToCue = function bridgedGoToCue(index, forceFade = null, options = {}) {
      if (options?.fromChase) return original.call(this, index, forceFade);
      const s = S(); const cue = s?.cues?.[Number(index)];
      if (!cue?.chase) return original.call(this, index, forceFade);
      const chaseIndex = Number(cue.chase.index);
      if (!Number.isInteger(chaseIndex) || !s.chases?.[chaseIndex]) {
        log(`Cue ${Number(index) + 1} references missing chase`, "error"); return false;
      }
      log(`Cue ${Number(index) + 1} → starting Chase ${chaseIndex + 1}`);
      return startChase(chaseIndex);
    };
    cueBridgeInstalled = true;
  }

  window.renderChases = renderChases;
  window.startChase = startChase;
  window.stopChase = stopChase;
  window.LXChaseSpeed = Object.freeze({ bpmOf, stepMs, sliderToBpm, bpmToSlider, min: BPM_MIN, max: BPM_MAX });
  window.saveChase = saveChase;
  window.recordSnapshotChase = recordSnapshotChase;
  window.addSnapshotToSelectedChase = addSnapshotToSelected;
  window.recordChaseToCue = function recordChaseToCue(cueNumber, chaseIndex = selectedChase, name = "") {
    const s = S(); const number = window.parseCueNumber(cueNumber); const ci = Number(chaseIndex);
    if (!s || number == null || !s.chases?.[ci]) return false;
    s.cues = Array.isArray(s.cues) ? s.cues : [];
    let index = window.cueIndexOf(number);
    if (index < 0) index = window.insertCueSlot(number);
    const chase = s.chases[ci];
    s.cues[index] = {
      number,
      name: String(name || `Chase ${chase.name || ci + 1}`).trim(),
      chase: { index: ci },
      globalState: clone(s.current || {}), state: clone(s.current || {}), fixtureStates: [],
      fade: n(chase.fade, 0), follow: 0, followEnabled: false, effect: null
    };
    window.renderCues?.();
    log(`🔗 Recorded Chase ${ci + 1} into Cue ${window.formatCueNumber(number)}`, "ok");
    return true;
  };

  document.addEventListener("DOMContentLoaded", () => { wireButtons(); renderChases(); installCueBridge(); });
  window.addEventListener("load", () => { wireButtons(); renderChases(); installCueBridge(); });
})();
