"use strict";

/*
 * Point & shoot focusing. Pick a spot on stage and every selected moving
 * head aims at it.
 *
 *   - Focus window (Windows menu, or "focus"): a to-scale plan of the stage
 *     with the rig on it. Click or drag to aim; beams are drawn to the spot.
 *   - 3D visualiser: 🎯 Point & shoot (or P), then click or drag on the stage,
 *     set or scenery.
 *   - Save the aim as a position palette or a target.
 *
 * Aim height (floor, knee, face height…), "keep spacing" and the aim fade
 * time are in Preferences → Programming → Point & shoot. The aiming maths is
 * Auto Create's (js/auto-create.js), the same the visualiser uses.
 */
(function () {
  if (window.LXFocus) return;

  const S = () => window.State;
  const STAGE = { width: 12, depth: 9, top: 1 }; // js/visualizer/theatre.js
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;
  const say = (m, l = "ok") => window.log?.(m, l);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let lastPoint = null; // { x, y, z } stage point last aimed at (floor level)

  // ------------------------------------------------------------ aiming

  function rig() {
    const AC = window.AutoCreate;
    if (!AC?.describe || !AC.positions || !AC.aim) return null;
    const fixtures = (S().fixtures || []).filter(Boolean);
    return { all: fixtures.map(f => AC.describe(f)), at: AC.positions(fixtures) };
  }

  const heightOf = () => {
    const h = String(pref("aimHeight", "face"));
    return h === "floor" ? 0 : h === "knee" ? 0.5 : h === "waist" ? 1.0 : h === "head" ? 1.8 : h === "custom" ? Number(pref("aimHeightCustom", 1.6)) || 0 : 1.6;
  };

  // Aim the selected moving heads at a point on stage. `point` is where the
  // spot is on the floor (or scenery); the aim height is added on top when
  // the point is on the stage floor.
  function aimAt(point, options = {}) {
    const r = rig();
    if (!r) return say("Point & shoot isn't ready yet — try again in a second", "warn");
    const state = S();
    const ids = new Set(options.ids || [...(state.selected || [])]);
    const heads = r.all.filter(x => x.moving && ids.has(x.fixture.id));
    if (!heads.length) {
      if (!options.quiet) say(ids.size ? "None of the selected fixtures can move — select some moving heads" : "Select some moving heads first, then click on the stage", "warn");
      return 0;
    }
    const onFloor = point.y == null || Math.abs(point.y - STAGE.top) < 0.05 || point.y <= 0.05;
    const base = { x: point.x, y: (point.y ?? STAGE.top) + (onFloor ? heightOf() : 0), z: point.z };
    const spread = pref("aimSpread", "spot") === "spaced";
    const mid = heads.reduce((sum, x) => sum + (r.at.get(x.fixture.id)?.x || 0), 0) / heads.length;
    const ms = options.ms != null ? options.ms : Number(pref("aimFadeMs", 400));
    const targets = [];
    let locked = 0;
    for (const x of heads) {
      const from = r.at.get(x.fixture.id);
      if (!from) continue;
      const st = window.ensureFixtureState?.(x.fixture.id) || {};
      if (st.__targetPositionLock) { locked++; continue; }
      const to = spread ? { ...base, x: base.x + ((from.x || 0) - mid) } : base;
      targets.push([x.fixture.id, { ...st, ...window.AutoCreate.aim(x, from, to) }]);
    }
    if (!targets.length) { say(`${locked} head${locked === 1 ? " is" : "s are"} captured on a target — release it first`, "warn"); return 0; }
    window.LXFixtureInfo?.act("focus", "Point & shoot", `${spread ? "keeping spacing" : "one spot"} · ${base.y.toFixed(1)} m high`, ms + 600, targets.map(t => t[0]));
    window.LXFixtureInfo?.claimKeys(targets.map(t => t[0]), ["pan", "tilt"], { kind: "focus", label: "Point & shoot", detail: "aimed on the stage" });
    window.finishFade?.();
    window.fadeTo?.({}, ms, targets);
    lastPoint = { x: point.x, y: point.y ?? STAGE.top, z: point.z };
    if (!options.quiet) say(`Aimed ${targets.length} head${targets.length === 1 ? "" : "s"} at ${describePoint(point)}${locked ? ` (${locked} captured on a target left alone)` : ""}`);
    renderPlan();
    return targets.length;
  }

  function describePoint(p) {
    const across = Math.abs(p.x) < 0.75 ? "centre" : `${Math.abs(p.x).toFixed(1)} m stage ${p.x < 0 ? "left" : "right"}`;
    const depth = p.z > 0 ? `${p.z.toFixed(1)} m into the house` : -p.z < 3 ? "downstage" : -p.z < 6 ? "mid stage" : "upstage";
    return `${across}, ${depth}`;
  }

  // Visualiser clicks and drags.
  let dragTimer = 0;
  window.addEventListener("message", event => {
    const m = event.data;
    if (!m || m.type !== "VIZ_AIM" || pref("vizAim", true) === false) return;
    if (m.phase === "end" || !m.point) return;
    const now = performance.now();
    if (m.phase === "move" && now - dragTimer < 40) return; // ~25 a second is plenty
    dragTimer = now;
    aimAt(m.point, { ms: m.phase === "move" ? 0 : undefined, quiet: m.phase === "move" });
  });

  // ------------------------------------------------------------- save

  async function saveAsPalette() {
    const state = S();
    const ids = [...(state.selected || [])].filter(id => window.AutoCreate?.describe(state.fixtures.find(f => f?.id === id) || {}).moving);
    if (!ids.length) return say("Select the moving heads you aimed first", "warn");
    const answer = await window.LXAsk?.("Save as a position palette", [{ key: "name", label: "Palette name", value: lastPoint ? describePoint(lastPoint).replace(/^./, c => c.toUpperCase()) : "Focus point" }], { ok: "Save palette" });
    if (!answer) return;
    const name = answer.name.trim() || "Focus point";
    const perFixture = {};
    ids.forEach(id => { const st = window.ensureFixtureState(id); perFixture[id] = { pan: st.pan, panf: st.panf || 0, tilt: st.tilt, tiltf: st.tiltf || 0 }; });
    state.palettes = Array.isArray(state.palettes) ? state.palettes : [];
    const existing = state.palettes.find(p => String(p.name).toLowerCase() === name.toLowerCase());
    const palette = { id: existing?.id || `palette-${Date.now()}`, name, category: "Position", values: {}, perFixture, fixtures: ids, createdAt: new Date().toISOString() };
    if (existing) Object.assign(existing, palette); else state.palettes.push(palette);
    window.Palettes?.refresh?.();
    say(`${existing ? "Updated" : "Saved"} position palette “${name}” for ${ids.length} head${ids.length === 1 ? "" : "s"}`);
  }

  async function saveAsTarget() {
    const answer = await window.LXAsk?.("Save as a target", [{ key: "name", label: "Target name", value: lastPoint ? describePoint(lastPoint).replace(/^./, c => c.toUpperCase()) : "Focus point" }], { ok: "Save target" });
    if (!answer) return;
    const result = window.Targets?.create(answer.name.trim() || "Focus point");
    if (result && !result.ok) say(result.message, "warn");
    if (result?.ok && lastPoint) result.target.point = { ...lastPoint };
    syncTargets();
  }

  // --------------------------------------------- targets in the visualiser

  // Where a head's beam lands on the stage (or the house floor) for a
  // pan/tilt, the reverse of AutoCreate.aim.
  function landing(x, from, st) {
    const panRange = (Number(x.def?.panRange) || 540) * Math.PI / 180;
    const tiltRange = (Number(x.def?.tiltRange) || 270) * Math.PI / 180;
    const word = (c, f) => ((Number(c) || 0) * 256 + (Number(f) || 0)) / 65535;
    const p = (word(st.pan ?? 128, st.panf) - 0.5) * panRange;
    const t = (word(st.tilt ?? 128, st.tiltf) - 0.5) * tiltRange;
    const dir = { x: -Math.sin(p) * Math.sin(t), y: -Math.cos(t), z: -Math.cos(p) * Math.sin(t) };
    if (dir.y > -0.02) return null; // pointing up or flat: it never lands
    const origin = { x: from.x, y: from.y - 0.35, z: from.z };
    const at = height => { const k = (origin.y - height) / -dir.y; return { x: origin.x + dir.x * k, y: height, z: origin.z + dir.z * k }; };
    // Beams meet at the aim height (face height by default): the target is
    // the spot on the floor under that.
    const h = heightOf();
    const top = at(STAGE.top + h);
    if (top.z <= 0 && top.z >= -STAGE.depth && Math.abs(top.x) <= STAGE.width / 2) return { ...top, y: STAGE.top };
    return { ...at(h), y: 0 };
  }
  function average(points) {
    const ok = points.filter(Boolean);
    if (!ok.length) return null;
    const sum = ok.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });
    return { x: sum.x / ok.length, y: sum.y / ok.length, z: sum.z / ok.length };
  }
  // A target's place on stage. New targets take it from the moving heads
  // selected when they were made; older ones are worked out from the heads
  // captured on them (or every head) at the target's pan and tilt.
  function targetPoint(target, r) {
    const p = target.point;
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) return p;
    const heads = r.all.filter(x => x.moving);
    const sel = S().selected || new Set();
    const chosen = heads.filter(x => sel.has(x.fixture.id));
    let point = null;
    const fresh = Date.now() - Date.parse(target.createdAt || 0) < 5000; // just made
    if (chosen.length && fresh) point = average(chosen.map(x => landing(x, r.at.get(x.fixture.id), window.ensureFixtureState?.(x.fixture.id) || {})));
    if (!point) {
      const captured = new Set((target.captures || []).map(c => c.fixtureId));
      const use = captured.size ? heads.filter(x => captured.has(x.fixture.id)) : heads;
      point = average(use.map(x => r.at.get(x.fixture.id) && landing(x, r.at.get(x.fixture.id), { pan: target.pan, tilt: target.tilt })));
    }
    if (point) target.point = { x: +point.x.toFixed(3), y: +point.y.toFixed(3), z: +point.z.toFixed(3) };
    return target.point || null;
  }

  let sentKey = "", sentTo = null;
  function syncTargets() {
    const viz = window.visualizerWindow;
    const r = rig();
    if (!r) return;
    const list = (S().targets || []).map(t => {
      const p = targetPoint(t, r);
      return p && { name: String(t.name || "Target"), x: p.x, y: p.y, z: p.z, captured: (t.captures || []).length };
    }).filter(Boolean);
    if (!viz || viz.closed) return;
    const key = JSON.stringify(list);
    if (key === sentKey && viz === sentTo) return;
    sentKey = key; sentTo = viz;
    try { viz.postMessage({ type: "TARGETS", targets: list }, "*"); } catch (_) {}
  }
  setInterval(syncTargets, 500);
  window.addEventListener("message", e => { if (e.data?.type === "VISUALIZER_READY") { sentKey = ""; setTimeout(syncTargets, 300); } });

  // ------------------------------------------------------------ window

  let body = null, timer = null, planKey = "";
  const W = 560, PAD = 30, HOUSE = 5; // plan: stage 12×9 m plus 5 m of house
  const scale = (W - PAD * 2) / (STAGE.width + 4);
  const H = Math.round(PAD * 2 + (STAGE.depth + HOUSE) * scale);
  const toPlan = p => ({ x: W / 2 + p.x * scale, y: PAD + (STAGE.depth + p.z) * scale });
  const fromPlan = (px, py) => ({ x: (px - W / 2) / scale, z: (py - PAD) / scale - STAGE.depth });

  function build(host) {
    body = host;
    const h = String(pref("aimHeight", "face"));
    host.innerHTML = `
      <div class="ps">
        <div class="ps-bar">
          <label>Aim at <select data-ps="height">${[["floor", "the floor"], ["knee", "knee height"], ["waist", "waist height"], ["face", "face height"], ["head", "above heads"], ["custom", "custom height"]].map(([v, l]) => `<option value="${v}"${v === h ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="ps-check"><input type="checkbox" data-ps="spread"${pref("aimSpread", "spot") === "spaced" ? " checked" : ""}> Keep spacing</label>
          <span class="ps-info" data-ps="info"></span>
        </div>
        <svg class="ps-plan" viewBox="0 0 ${W} ${H}"></svg>
        <div class="ps-foot">
          <button type="button" class="btn-secondary" data-ps="viz">🎯 Point &amp; shoot in the visualiser</button>
          <span class="ps-grow"></span>
          <button type="button" class="btn-secondary" data-ps="palette">Save as position palette…</button>
          <button type="button" class="btn-secondary" data-ps="target">Save as target…</button>
        </div>
      </div>`;
    const svg = host.querySelector(".ps-plan");
    let dragging = false;
    const pointFrom = e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H;
      const p = fromPlan(px, py);
      return { x: Math.max(-10, Math.min(10, p.x)), y: p.z < 0 ? STAGE.top : 0, z: Math.max(-STAGE.depth, Math.min(HOUSE, p.z)) };
    };
    svg.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      aimAt(pointFrom(e));
    });
    svg.addEventListener("pointermove", e => {
      if (!dragging) return;
      const now = performance.now();
      if (now - dragTimer < 40) return;
      dragTimer = now;
      aimAt(pointFrom(e), { ms: 0, quiet: true });
    });
    const stop = () => { if (dragging && lastPoint) say(`Aimed at ${describePoint(lastPoint)}`); dragging = false; };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    host.querySelector('[data-ps="height"]').addEventListener("change", e => { window.LXPrefs?.set("aimHeight", e.target.value); if (lastPoint) aimAt(lastPoint, { quiet: true }); });
    host.querySelector('[data-ps="spread"]').addEventListener("change", e => { window.LXPrefs?.set("aimSpread", e.target.checked ? "spaced" : "spot"); if (lastPoint) aimAt(lastPoint, { quiet: true }); });
    host.querySelector('[data-ps="viz"]').addEventListener("click", () => {
      window.parseCommand?.("viz");
      setTimeout(() => { try { window.visualizerWindow?.postMessage({ type: "AIM_MODE", on: true }, "*"); } catch (_) {} }, 1200);
    });
    host.querySelector('[data-ps="palette"]').addEventListener("click", saveAsPalette);
    host.querySelector('[data-ps="target"]').addEventListener("click", saveAsTarget);
    planKey = "";
    renderPlan();
    clearInterval(timer);
    timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); timer = null; body = null; return; } renderPlan(); }, 250);
  }

  function renderPlan() {
    if (!body) return;
    const svg = body.querySelector(".ps-plan");
    const r = rig();
    if (!svg || !r) return;
    const state = S();
    const sel = state.selected || new Set();
    const heads = r.all.filter(x => x.moving && sel.has(x.fixture.id));
    const key = JSON.stringify([r.all.map(x => [x.fixture.id, r.at.get(x.fixture.id)]), [...sel], lastPoint, heightOf(), pref("aimSpread", "spot")]);
    if (key === planKey) return;
    planKey = key;
    const tl = toPlan({ x: -STAGE.width / 2, z: -STAGE.depth }), br = toPlan({ x: STAGE.width / 2, z: 0 });
    const parts = [];
    parts.push(`<rect x="${tl.x}" y="${tl.y}" width="${br.x - tl.x}" height="${br.y - tl.y}" class="ps-stage"/>`);
    for (let z = -1; z > -STAGE.depth; z -= 1) { const a = toPlan({ x: -STAGE.width / 2, z }), b = toPlan({ x: STAGE.width / 2, z }); parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="ps-grid"/>`); }
    for (let x = -5; x <= 5; x += 1) { const a = toPlan({ x, z: -STAGE.depth }), b = toPlan({ x, z: 0 }); parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="ps-grid${x === 0 ? " c" : ""}"/>`); }
    parts.push(`<text x="${(tl.x + br.x) / 2}" y="${tl.y - 9}" class="ps-label">UPSTAGE</text><text x="${(tl.x + br.x) / 2}" y="${br.y + 16}" class="ps-label">STAGE EDGE · AUDIENCE ▾</text>`);
    parts.push(`<text x="${tl.x + 6}" y="${tl.y + 14}" class="ps-label l">STAGE RIGHT</text><text x="${br.x - 6}" y="${tl.y + 14}" class="ps-label r">STAGE LEFT</text>`);
    // Beams from the selected heads to the spot.
    if (lastPoint && heads.length) {
      const spread = pref("aimSpread", "spot") === "spaced";
      const mid = heads.reduce((s, x) => s + (r.at.get(x.fixture.id)?.x || 0), 0) / heads.length;
      for (const x of heads) {
        const from = r.at.get(x.fixture.id);
        if (!from) continue;
        const to = spread ? { x: lastPoint.x + (from.x - mid), z: lastPoint.z } : lastPoint;
        const a = toPlan(from), b = toPlan(to);
        parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="ps-beam"/><circle cx="${b.x}" cy="${b.y}" r="7" class="ps-pool"/>`);
      }
    }
    // The rig.
    for (const x of r.all) {
      const p = r.at.get(x.fixture.id);
      if (!p) continue;
      const c = toPlan(p);
      const on = sel.has(x.fixture.id);
      parts.push(`<g class="ps-fx${x.moving ? " mh" : ""}${on ? " on" : ""}"><circle cx="${c.x}" cy="${c.y}" r="${x.moving ? 6 : 4}"/><text x="${c.x}" y="${c.y - 9}">${esc(x.fixture.fixtureNumber)}</text></g>`);
    }
    if (lastPoint) { const p = toPlan(lastPoint); parts.push(`<g class="ps-target"><circle cx="${p.x}" cy="${p.y}" r="11"/><line x1="${p.x - 16}" y1="${p.y}" x2="${p.x + 16}" y2="${p.y}"/><line x1="${p.x}" y1="${p.y - 16}" x2="${p.x}" y2="${p.y + 16}"/></g>`); }
    svg.innerHTML = parts.join("");
    const info = body.querySelector('[data-ps="info"]');
    const text = heads.length ? `${heads.length} moving head${heads.length === 1 ? "" : "s"} selected — click or drag on the stage` : "Select moving heads, then click or drag on the stage";
    if (info.textContent !== text) info.textContent = text;
  }

  function injectStyles() {
    if (document.getElementById("lxFocusStyles")) return;
    const style = document.createElement("style");
    style.id = "lxFocusStyles";
    style.textContent = `
      .ps{display:flex;flex-direction:column;height:100%;min-height:0}
      .ps-bar,.ps-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 10px;background:#0e1519;border-bottom:1px solid var(--border)}
      .ps-foot{border-bottom:0;border-top:1px solid var(--border)}
      .ps-bar label{display:flex;align-items:center;gap:6px;color:#8c9a97;font-size:11px}
      .ps-bar select{height:24px;background:#0a1013;border:1px solid var(--border-strong);border-radius:4px;color:var(--text);font-size:11px}
      .ps-check input{width:13px;height:13px;margin:0;accent-color:var(--accent)}
      .ps-info{margin-left:auto;color:#6f7d7a;font-size:10.5px}
      .ps-grow{flex:1}
      .ps-plan{flex:1 1 auto;min-height:0;width:100%;background:#060a0c;cursor:crosshair;touch-action:none}
      .ps-stage{fill:#10171b;stroke:#2b383f;stroke-width:1.5}
      .ps-grid{stroke:#18222a;stroke-width:1}
      .ps-grid.c{stroke:#24313a;stroke-dasharray:4 4}
      .ps-label{fill:#46534f;font-size:10px;font-weight:800;letter-spacing:1.5px;text-anchor:middle}
      .ps-label.l{text-anchor:start}.ps-label.r{text-anchor:end}
      .ps-fx circle{fill:#1c262d;stroke:#3a474d;stroke-width:1.2}
      .ps-fx text{fill:#5d6b68;font-size:9px;font-weight:800;text-anchor:middle}
      .ps-fx.mh circle{fill:#22303a}
      .ps-fx.on circle{fill:var(--accent);stroke:var(--accent-2)}
      .ps-fx.on text{fill:var(--accent-2)}
      .ps-beam{stroke:rgba(255,173,31,.45);stroke-width:1.5}
      .ps-pool{fill:rgba(255,210,122,.16);stroke:rgba(255,173,31,.5)}
      .ps-target circle{fill:none;stroke:#ffad1f;stroke-width:2}
      .ps-target line{stroke:#ffad1f;stroke-width:1.5}
    `;
    document.head.appendChild(style);
  }

  function boot(tries = 0) {
    injectStyles();
    if (window.LXWindows && !window.LXWindows.list().includes("focus")) window.LXWindows.register({ id: "focus", title: "Focus — point & shoot", build, w: 600, h: 560 });
    if (!window.LXWindows && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  window.addEventListener("load", () => setTimeout(boot, 400));

  window.LXFocus = Object.freeze({ aimAt, open: () => window.LXWindows?.open("focus"), saveAsPalette, saveAsTarget, last: () => lastPoint && { ...lastPoint }, landing: id => { const r = rig(); const x = r?.all.find(d => d.fixture.id === id); return x && r.at.get(id) ? landing(x, r.at.get(id), window.ensureFixtureState?.(id) || {}) : null; }, syncTargets });
})();
