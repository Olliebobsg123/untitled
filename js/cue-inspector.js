// Cue Inspector: everything about a cue, on one page, without picking it
// from a list first. It shows the live cue (or the next one when nothing is
// live) and follows each GO; click any cue in the list on the left to look
// at that one instead ("Follow live" goes back).
//
// What a cue can do (the engine is js/cues.js):
//   timing     fade + delay, or split times: up, down, move, colour, beam,
//              each with its own delay; a curve; a rate
//   playback   wait for GO / follow (N s after GO) / hang (N s after it
//              finishes); link (jump) to another cue, looping N times;
//              timecode; disabled (GO skips it)
//   look       block or tracked, move in black, effect, what it changes
//   extras     a command run on GO (e.g. "haze 40; run chase 2"), scene,
//              colour tag, notes
(function () {
  if (window.LXCueInspector) return;
  const S = () => window.State || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = (m, l = "ok") => window.log?.(m, l);
  const secs = ms => { const v = Math.round((Number(ms) || 0) / 100) / 10; return String(v); };
  const label = i => window.cueLabel?.(i) ?? String(i + 1);
  const PARTS = [
    ["up", "Up", "Intensity going up", "#3ddc84"],
    ["down", "Down", "Intensity going down", "#ff6b7d"],
    ["focus", "Move", "Pan and tilt", "#5ca8ff"],
    ["colour", "Colour", "Every kind of colour", "#c38bff"],
    ["beam", "Beam", "Gobo, zoom, focus, iris, prism, frost", "#ffb454"]
  ];
  const CURVES = [["smooth", "Smooth (S-curve)"], ["linear", "Linear"], ["in", "Ease in (slow start)"], ["out", "Ease out (slow end)"], ["snap", "Snap (instant at its time)"]];
  const TAGS = ["", "#ff5265", "#ffb454", "#ffe066", "#3ddc84", "#19d6a3", "#5ca8ff", "#c38bff", "#ff7ad9"];

  let host = null;
  let pinned = null;       // the cue object being looked at, or null = follow live
  let shownCue = null, shownKey = "";
  let railKey = "";

  // ------------------------------------------------------------ which cue

  function focusIndex() {
    const s = S(), cues = s.cues || [];
    if (pinned) { const i = cues.indexOf(pinned); if (i >= 0) return i; pinned = null; }
    if (s.currentCue >= 0 && cues[s.currentCue]) return s.currentCue;
    const next = window.peekNextCue ? window.peekNextCue() : 0;
    return next >= 0 ? next : cues.findIndex(Boolean);
  }
  function focus(i) {
    const cue = S().cues?.[i];
    pinned = cue || null;
    render(true);
  }
  function followLive() { pinned = null; render(true); }

  // --------------------------------------------------------------- edits

  function changed(cue, what) {
    window.renderCues?.();
    window.LXCueList?.refresh?.();
    render(true);
    if (what) say(`Cue ${label(S().cues.indexOf(cue))}: ${what}`);
  }
  const ms = v => { const n = Number(String(v).trim()); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null; };

  function setField(cue, field, raw) {
    const v = String(raw ?? "").trim();
    switch (field) {
      case "name": cue.name = v || `Cue ${label(S().cues.indexOf(cue))}`; return changed(cue, `name → ${cue.name}`);
      case "number": { const now = label(S().cues.indexOf(cue)); if (v && v !== now) window.parseCommand?.(`move cue ${now} to ${v}`); return render(true); }
      case "scene": cue.scene = v || undefined; if (!v) delete cue.scene; return changed(cue, v ? `scene → ${v}` : "scene cleared");
      case "fade": { const t = ms(v); if (t == null) return render(true); cue.fade = t; return changed(cue, `fade → ${secs(t)} s`); }
      case "delay": { const t = ms(v); if (t == null) return render(true); if (t) cue.delay = t; else delete cue.delay; return changed(cue, `delay → ${secs(t)} s`); }
      case "curve": cue.curve = v === "smooth" ? undefined : v; if (v === "smooth") delete cue.curve; return changed(cue, `curve → ${v}`);
      case "rate": { const n = Number(v); if (!(n > 0)) return render(true); if (n === 100) delete cue.rate; else cue.rate = Math.min(1000, n); return changed(cue, `rate → ${n}%`); }
      case "follow": { const t = Number(v); if (!(t >= 0)) return render(true); cue.follow = t; return changed(cue, `${cue.followMode === "go" ? "follow" : "hang"} → ${t} s`); }
      case "link": {
        if (!v) { delete cue.link; delete cue.loop; return changed(cue, "link removed — GO goes to the next cue"); }
        const n = window.parseCueNumber?.(v);
        if (n == null || window.cueIndexOf(n) < 0) { say(`There's no cue ${v} to link to`, "warn"); return render(true); }
        cue.link = n; return changed(cue, `then GO jumps to cue ${window.formatCueNumber(n)}`);
      }
      case "loop": { const n = Math.max(0, Math.floor(Number(v) || 0)); cue.loop = n; return changed(cue, n ? `loop ${n} time${n === 1 ? "" : "s"}` : "loops forever"); }
      case "timecode": {
        const i = S().cues.indexOf(cue);
        if (!v || /^(off|none)$/i.test(v)) { window.LXTimecode?.setCue(i, null); return changed(cue, "no timecode"); }
        const t = window.LXTimecode?.parse(v);
        if (t == null) { say("Times look like 00:01:30:00", "warn"); return render(true); }
        window.LXTimecode.setCue(i, t); return changed(cue, `fires at ${window.LXTimecode.format(t)}`);
      }
      case "macro": if (v) cue.macro = v; else delete cue.macro; return changed(cue, v ? `runs “${v}” on GO` : "no command on GO");
      case "note": if (v) cue.note = String(raw); else delete cue.note; return changed(cue, null);
      case "goNote": if (v) cue.goNote = v; else delete cue.goNote; return changed(cue, v ? `GO note: ${v}` : "GO note cleared");
      default:
        // Part delays: pd:<row>:<group|lights|delay|time>
        if (field.startsWith("pd:")) {
          const [, row, key] = field.split(":");
          const pd = cue.partDelays?.[Number(row)];
          if (!pd) return render(true);
          if (key === "target") { delete pd.group; delete pd.lights; if (v.startsWith("group:")) pd.group = v.slice(6); else pd.lights = pd.lights || ""; return changed(cue, null); }
          if (key === "lights") { pd.lights = v; delete pd.group; return changed(cue, null); }
          if (key === "delay" || key === "time") {
            if (v === "" && key === "time") { delete pd.time; return changed(cue, null); }
            const t = ms(v); if (t == null) return render(true);
            pd[key] = t; return changed(cue, null);
          }
          return;
        }
        if (field.startsWith("t:")) {
          const key = field.slice(2);
          cue.timing ||= {};
          if (v === "") delete cue.timing[key];
          else { const t = ms(v); if (t == null) return render(true); cue.timing[key] = t; }
          if (!Object.keys(cue.timing).length) delete cue.timing;
          return changed(cue, null);
        }
    }
  }

  async function act(cue, a) {
    const s = S(), i = s.cues.indexOf(cue), n = label(i);
    if (i < 0) return;
    if (a === "go") return window.goToCue?.(i);
    if (a === "next") { s.nextCue = i; window.LXCueList?.refresh?.(); return say(`Next: cue ${n} — press GO`, "info"); }
    if (a === "update") return window.parseCommand?.(`update cue ${n}`);
    if (a === "insert") return window.LXDeck?.insertCue(i);
    if (a === "duplicate") {
      const after = s.cues[i + 1] ? window.cueNumberOf(i + 1) : null;
      const to = window.cueNumberBetween(window.cueNumberOf(i), after);
      if (to == null) return say("No room for a cue number right after this one", "warn");
      window.parseCommand?.(`copy cue ${n} to ${window.formatCueNumber(to)}`);
      const copy = s.cues[window.cueIndexOf(to)];
      if (copy) focus(s.cues.indexOf(copy));
      return;
    }
    if (a === "delete") {
      const ok = window.LXAsk ? await window.LXAsk(`Delete cue ${n}?`, [], { ok: "Delete", message: `“${cue.name || ""}” is removed from the cue list.`, safe: true }) : confirm(`Delete cue ${n}?`);
      if (ok) { pinned = null; window.parseCommand?.(`delete cue ${n}`); }
      return render(true);
    }
    if (a === "split") { cue.timing ||= {}; cue.timing.split = !cue.timing.split; if (!cue.timing.split) { PARTS.forEach(([k]) => { delete cue.timing[k]; delete cue.timing[k + "Delay"]; }); delete cue.timing.split; if (!Object.keys(cue.timing).length) delete cue.timing; } return changed(cue, null); }
    if (a.startsWith("curtain:")) {
      const v = a.slice(8);
      if (v === "") delete cue.curtain; else cue.curtain = Number(v);
      return changed(cue, v === "" ? "leaves the curtain as it is" : v === "1" ? "opens the curtain" : "closes the curtain");
    }
    if (a === "disabled") { cue.disabled = !cue.disabled; if (!cue.disabled) delete cue.disabled; return changed(cue, cue.disabled ? "disabled — GO skips it" : "enabled"); }
    if (a === "mib") { cue.noMib = !cue.noMib; return changed(cue, `move in black ${cue.noMib ? "off" : "on"}`); }
    if (a === "block") { window.parseCommand?.(`${cue.mode === "track" ? "block" : "track"} cue ${n}`); return render(true); }
    if (a === "noeffect") { cue.effect = null; cue.effects = []; return changed(cue, "effect removed"); }
    if (a.startsWith("fx:del:")) {
      const list = cueEffects(cue);
      list.splice(Number(a.slice(7)), 1);
      cue.effects = list; cue.effect = list[0] || null;
      return changed(cue, "effect removed");
    }
    if (a === "fx:add") return addEffect(cue);
    if (a === "pd:add") { cue.partDelays ||= []; const g = (s.groups || []).find(x => x?.name); cue.partDelays.push(g ? { group: g.name, delay: 0 } : { lights: "", delay: 0 }); return changed(cue, null); }
    if (a.startsWith("pd:del:")) { cue.partDelays?.splice(Number(a.slice(7)), 1); if (!cue.partDelays?.length) delete cue.partDelays; return changed(cue, null); }
    if (a === "pd:sweep") return sweep(cue);
    if (a.startsWith("then:")) {
      const mode = a.slice(5);
      if (mode === "wait") { cue.followEnabled = false; }
      else { cue.followEnabled = true; cue.followMode = mode === "follow" ? "go" : "complete"; if (!(cue.follow >= 0)) cue.follow = 0; }
      return changed(cue, mode === "wait" ? "waits for GO" : mode === "follow" ? `follows ${cue.follow || 0} s after its GO` : `hangs ${cue.follow || 0} s after it finishes, then GOes`);
    }
    if (a.startsWith("tag:")) { const c = a.slice(4); if (c) cue.colourTag = c; else delete cue.colourTag; return changed(cue, null); }
  }

  // Effects in this cue: run while the cue is up (several at once is fine).
  const cueEffects = cue => (Array.isArray(cue.effects) && cue.effects.length ? cue.effects : cue.effect?.type ? [cue.effect] : []).map(e => ({ ...e }));
  const FX_NAMES = { snowfall: "Snowfall", iceshimmer: "Ice shimmer", aurora: "Aurora", fireplace: "Fireplace", blizzard: "Blizzard", freeze: "Freeze", rainbow: "Rainbow", pulse: "Pulse", strobe: "Strobe", wave: "Wave", chase: "Chase" };
  async function addEffect(cue) {
    const s = S();
    const types = ["rainbow", "pulse", "strobe", "wave", "chase", ...Object.keys(typeof FX_TYPES !== "undefined" ? FX_TYPES : {})];
    const saved = Object.keys(s.savedEffects || {});
    const r = await window.LXAsk?.("Add an effect to this cue", [
      { key: "what", label: "Effect", type: "select", value: saved[0] ? `saved:${saved[0]}` : "type:aurora", options: [...saved.map(n => [`saved:${n}`, `Saved: ${n}`]), ...types.map(t => [`type:${t}`, FX_NAMES[t] || t.replace(/^\w/, c => c.toUpperCase())])] },
      { key: "on", label: "On", type: "select", value: "cue", options: [["cue", "The lights this cue brings up"], ["selected", "The lights selected now"], ...(s.groups || []).filter(g => g?.name).map(g => [`group:${g.name}`, `Group: ${g.name}`])] },
      { key: "speed", label: "Speed", value: 1, type: "number", step: 0.1 }
    ], { ok: "Add", message: "It starts when the cue has faded in and runs until a cue that doesn't have it." });
    if (!r) return;
    const [kind, ...rest] = String(r.what).split(":");
    const name = rest.join(":");
    const base = kind === "saved" ? { ...(s.savedEffects?.[name] || {}), name } : { type: name, name: FX_NAMES[name] || name };
    if (!base.type) return say("That effect isn't there any more", "warn");
    let ids = [];
    if (r.on === "selected") ids = s.selected instanceof Set ? [...s.selected] : [];
    else if (r.on.startsWith("group:")) { const g = (s.groups || []).find(x => x?.name === r.on.slice(6)); ids = (g?.members || []).map(v => (s.fixtures.find(f => String(f.id) === String(v)) || s.fixtures.find(f => Number(f.fixtureNumber) === Number(v)))?.id).filter(Boolean); }
    else {
      // The lights this cue has up.
      const look = window.LXTracking?.look?.(s.cues.indexOf(cue)) || window.cueLook?.(s.cues.indexOf(cue)) || new Map();
      ids = [...(look instanceof Map ? look : new Map(look)).entries()].filter(([, st]) => Number(st?.intensity) > 0).map(([id]) => id);
    }
    if (kind === "saved" && r.on === "cue" && base.fixtureIds?.length) ids = base.fixtureIds.slice();
    if (!ids.length) return say("No lights for it — select some, pick a group, or bring lights up in this cue first", "warn");
    const effect = { ...base, speed: Number(r.speed) > 0 ? Number(r.speed) : (base.speed || 1), fixtureMode: "custom", fixtureIds: ids };
    const list = cueEffects(cue);
    list.push(effect);
    cue.effects = list; cue.effect = list[0];
    const result = changed(cue, `${effect.name || effect.type} on ${ids.length} light${ids.length === 1 ? "" : "s"} while this cue runs`);
    // Effects run at each light's level in the cue, so a light at 0 stays dark.
    const look = window.cueLook?.(s.cues.indexOf(cue))?.fixtureMap;
    const dark = look ? ids.filter(id => Number(look.get(id)?.intensity) === 0).length : 0;
    if (dark) say(`${dark} of those light${dark === 1 ? " is" : "s are"} at 0 in this cue, so the effect is dark on ${dark === 1 ? "it" : "them"} — bring ${dark === 1 ? "it" : "them"} up in the cue to see it`, "warn");
    return result;
  }

  // Sweep: groups in order, each a step later than the one before.
  async function sweep(cue) {
    const groups = (S().groups || []).filter(g => g?.name).map(g => g.name);
    if (!groups.length) return say("Make groups first (e.g. one per bar), then sweep across them", "warn");
    const r = await window.LXAsk?.("Sweep across groups", [
      { key: "order", label: "Groups in order, first to last (comma between)", value: groups.join(", ") },
      { key: "step", label: "Each one starts this much later (s)", value: 0.6, type: "number", step: 0.1 },
      { key: "time", label: "Each one's own fade (s, empty = the cue's)", value: "" }
    ], { ok: "Sweep", message: "Replaces this cue's part delays." });
    if (!r) return;
    const order = String(r.order).split(",").map(x => x.trim()).filter(x => groups.includes(x));
    if (!order.length) return say("None of those are groups", "warn");
    const step = Math.max(0, Number(r.step) || 0), time = String(r.time).trim() === "" ? null : Math.max(0, Number(r.time) || 0);
    cue.partDelays = order.map((group, n) => ({ group, delay: Math.round(n * step * 1000), ...(time != null ? { time: Math.round(time * 1000) } : {}) }));
    return changed(cue, `sweeps ${order.join(" → ")}, ${step} s apart`);
  }

  function partDelaysHtml(cue) {
    const groups = (S().groups || []).filter(g => g?.name);
    const rows = (cue.partDelays || []).map((pd, n) => `<div class="ci-pd">
      <select class="ci-in" data-f="pd:${n}:target">${groups.map(g => `<option value="group:${esc(g.name)}"${pd.group === g.name ? " selected" : ""}>${esc(g.name)}</option>`).join("")}<option value="lights"${pd.group == null ? " selected" : ""}>Lights…</option></select>
      ${pd.group == null ? field(`pd:${n}:lights`, pd.lights || "", 'placeholder="1 thru 4"') : ""}
      <label>delay ${secField(`pd:${n}:delay`, secs(pd.delay || 0))}</label>
      <label>time ${secField(`pd:${n}:time`, pd.time != null ? secs(pd.time) : "", "cue's")}</label>
      <button type="button" class="btn-secondary ci-small" data-a="pd:del:${n}" title="Remove">×</button></div>`).join("");
    return `<div class="ci-pds"><div class="ci-pd-head"><b>Delays by group</b><span>${rows ? "" : "Start groups or lights later than the rest — a sweep in one cue."}</span>
      <button type="button" class="btn-secondary ci-small" data-a="pd:add">＋ Add</button><button type="button" class="btn-secondary ci-small" data-a="pd:sweep">Sweep…</button></div>${rows}</div>`;
  }

  // ------------------------------------------------------------- drawing

  const field = (name, value, attrs = "", cls = "") => `<input class="ci-in${cls ? " " + cls : ""}" data-f="${name}" value="${esc(value)}" ${attrs}>`;
  const secField = (name, value, placeholder = "") => field(name, value, `inputmode="decimal" placeholder="${esc(placeholder)}"`);

  // The timing graph: each part of the fade as a bar after its delay.
  function timeline(cue) {
    const t = window.cueTiming(cue);
    const total = Math.max(t.total, 1);
    const split = cue.timing?.split;
    const rows = split ? PARTS : [["fade", "Fade", "Everything", "#19d6a3"]];
    const W = 100;
    const ticks = [];
    const step = total <= 2000 ? 500 : total <= 6000 ? 1000 : total <= 20000 ? 5000 : 10000;
    for (let x = 0; x <= total + 1; x += step) ticks.push(x);
    const curve = window.cueTiming(cue).curve;
    const shape = (x0, w) => {
      // the curve drawn inside the bar (0 → 1 over its width)
      const pts = [];
      const f = { smooth: p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2), linear: p => p, in: p => p ** 3, out: p => 1 - (1 - p) ** 3, snap: p => (p > 0 ? 1 : 0) }[curve] || (p => p);
      for (let k = 0; k <= 20; k++) { const p = k / 20; pts.push(`${(x0 + w * p).toFixed(2)},${(16 - 12 * f(p)).toFixed(2)}`); }
      return pts.join(" ");
    };
    return `<div class="ci-graph">${rows.map(([k, name, , colour]) => {
      const part = t.parts[k] || t.parts.fade;
      const x = (part.delay / total) * W, w = Math.max(0.6, (part.time / total) * W);
      return `<div class="ci-gr"><span class="ci-gl" style="color:${colour}">${name}</span><svg viewBox="0 0 100 18" preserveAspectRatio="none">
        ${part.delay ? `<line x1="0" y1="9" x2="${x}" y2="9" stroke="${colour}" stroke-width=".6" stroke-dasharray="1.5 1.2" opacity=".6" vector-effect="non-scaling-stroke"/>` : ""}
        <rect x="${x}" y="3" width="${w}" height="13" rx="1.5" fill="${colour}" opacity=".18"/>
        <polyline points="${shape(x, w)}" fill="none" stroke="${colour}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      </svg><span class="ci-gt">${part.delay ? `${secs(part.delay)} + ` : ""}${secs(part.time)} s</span></div>`;
    }).join("")}<div class="ci-axis">${ticks.map(x => `<span style="left:${(x / total) * 100}%">${secs(x)}s</span>`).join("")}</div></div>`;
  }

  // What this cue changes, compared with the cue before it.
  function contents(i) {
    const s = S();
    const T = window.LXTracking;
    if (!T) return "";
    const look = T.look(i).fixtureMap;
    let before = null;
    for (let k = i - 1; k >= 0; k--) if (s.cues[k]) { before = T.look(k).fixtureMap; break; }
    const byId = new Map((s.fixtures || []).filter(Boolean).map(f => [f.id, f]));
    const rows = [];
    for (const [id, st] of look) {
      const was = before?.get(id) || {};
      const f = byId.get(id);
      if (!f) continue;
      const chips = [];
      const diff = k => before ? Math.abs((Number(st[k]) || 0) - (Number(was[k]) || 0)) > 0.5 : (Number(st[k]) || 0) > 0;
      const int = Math.round(Number(st.intensity) || 0);
      if (diff("intensity")) chips.push(`<b class="ci-chip i">${before ? `${Math.round(Number(was.intensity) || 0)} → ` : ""}${int}%</b>`);
      if (["hue", "sat", "light", "r", "g", "b", "colour"].some(diff) && int > 0) {
        const c = `hsl(${Number(st.hue) || 0} ${Number(st.sat) ?? 0}% ${Math.max(30, Math.min(85, Number(st.light) || 50))}%)`;
        chips.push(`<b class="ci-chip c"><i style="background:${c}"></i>colour</b>`);
      }
      if (["pan", "tilt"].some(diff)) chips.push(`<b class="ci-chip m">move</b>`);
      if (["gobo", "gobo2", "prism", "zoom", "focus", "iris", "frost"].some(diff)) chips.push(`<b class="ci-chip b">beam</b>`);
      if (diff("strobe")) chips.push(`<b class="ci-chip s">strobe</b>`);
      if (chips.length) rows.push(`<div class="ci-fx"><span class="ci-fn">${esc(f.fixtureNumber)}</span><span class="ci-fname">${esc(f.name)}</span>${chips.join("")}</div>`);
    }
    if (!rows.length) return `<p class="ci-muted">${before ? "Nothing changes from the cue before." : "No lights on in this cue."}</p>`;
    return `<p class="ci-muted">${rows.length} light${rows.length === 1 ? "" : "s"} change${before ? " from the cue before" : ""}</p><div class="ci-fxs">${rows.slice(0, 80).join("")}${rows.length > 80 ? `<p class="ci-muted">…and ${rows.length - 80} more</p>` : ""}</div>`;
  }

  // The curtain, as part of the cue's look.
  function curtainRow(cue, i) {
    const own = Number.isFinite(Number(cue.curtain)) ? Number(cue.curtain) : null;
    const tracked = own == null ? window.cueCurtain?.(i) : null;
    const word = v => (v >= 1 ? "open" : v <= 0 ? "closed" : `${Math.round(v * 100)}% open`);
    const current = own == null ? "" : own >= 1 ? "1" : own <= 0 ? "0" : "part";
    const note = own != null ? (current === "part" ? `${word(own)}` : "") : tracked != null ? `left as it is (${word(tracked)} from an earlier cue)` : "left as it is";
    return `<div class="ci-line ci-curtain"><b>Curtain</b><div class="ci-seg">${[["1", "Open"], ["0", "Closed"], ["", "Leave"]].map(([v, l]) => `<button type="button" data-a="curtain:${v}" class="${current === v ? "on" : ""}">${l}</button>`).join("")}</div></div>${note ? `<p class="ci-muted">Curtain ${note}</p>` : ""}`;
  }

  function editor(cue, i) {
    const s = S();
    const live = s.currentCue === i;
    const next = (window.LXCueList?.next?.() ?? window.peekNextCue?.()) === i;
    const t = window.cueTiming(cue);
    const split = Boolean(cue.timing?.split);
    const then = cue.followEnabled ? (cue.followMode === "go" ? "follow" : "hang") : "wait";
    const tc = Number.isFinite(cue.timecode) ? window.LXTimecode?.format(cue.timecode) : "";
    const effect = cue.effect ? cue.effect.name || cue.effect.type : "";
    const linked = cue.link != null && window.cueIndexOf(cue.link) >= 0;
    const chip = (on, text, cls = "") => on ? `<span class="ci-st ${cls}">${text}</span>` : "";
    return `
      <div class="ci-head" style="--tag:${cue.colourTag || "transparent"}">
        <div class="ci-num">${field("number", label(i), 'inputmode="decimal" title="Renumber (2.5 goes between 2 and 3)"')}</div>
        <div class="ci-title">
          ${field("name", cue.name || "", 'placeholder="Name"', "ci-name")}
          <div class="ci-sts">${chip(live, "LIVE", "live")}${chip(next && !live, "NEXT", "next")}${chip(cue.disabled, "DISABLED", "off")}${chip(true, cue.mode === "track" ? "TRACKED" : "BLOCK", "mode")}${chip(linked, `→ ${esc(window.formatCueNumber(cue.link))}${cue.loop ? ` ×${cue.loop}` : ""}`, "link")}${chip(cue.followEnabled, then === "follow" ? `FOLLOW ${cue.follow || 0}s` : `HANG ${cue.follow || 0}s`, "auto")}${chip(Boolean(tc), `TC ${tc}`, "tc")}${chip(Boolean(cue.macro), "CMD", "cmd")}</div>
        </div>
        <div class="ci-acts">
          <button type="button" class="btn-primary" data-a="go" title="Play this cue now">▶ Go</button>
          <button type="button" class="btn-secondary" data-a="next" title="GO plays this one next">Next</button>
          <button type="button" class="btn-secondary" data-a="update" title="Save what's on stage into this cue">Update</button>
          <button type="button" class="btn-secondary" data-a="duplicate" title="Copy to a new cue right after">Duplicate</button>
          <button type="button" class="btn-secondary" data-a="insert" title="Load what this cue programs into the Control Deck">Insert</button>
          <button type="button" class="btn-secondary ci-danger" data-a="delete">Delete</button>
        </div>
      </div>

      <div class="ci-grid">
        <section class="ci-card ci-wide">
          <h4>Timing <span class="ci-total">total ${secs(t.total)} s${(cue.rate && cue.rate !== 100) ? ` at ${cue.rate}%` : ""}</span></h4>
          <div class="ci-row">
            <label><em>Fade <span>s</span></em>${secField("fade", secs(cue.fade ?? 800))}</label>
            <label><em>Delay <span>s</span></em>${secField("delay", secs(cue.delay || 0))}</label>
            <label><em>Curve</em><select class="ci-in" data-f="curve">${CURVES.map(([v, l]) => `<option value="${v}"${(cue.curve || "smooth") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
            <label><em>Rate <span>%</span></em>${field("rate", cue.rate || 100, 'inputmode="decimal" title="Play the whole cue faster or slower: 200 = twice as fast"')}</label>
            <button type="button" class="ci-toggle${split ? " on" : ""}" data-a="split" title="Give intensity up, down, moves, colour and beam their own times">Split times</button>
          </div>
          ${split ? `<div class="ci-split">${PARTS.map(([k, name, tip, colour]) => `
            <div class="ci-part" title="${esc(tip)}"><b style="color:${colour}">${name}</b>
              <label>time ${secField(`t:${k}`, cue.timing?.[k] != null ? secs(cue.timing[k]) : "", secs(cue.fade ?? 800))}</label>
              <label>delay ${secField(`t:${k}Delay`, cue.timing?.[k + "Delay"] != null ? secs(cue.timing[k + "Delay"]) : "", secs(cue.delay || 0))}</label></div>`).join("")}
            <p class="ci-muted">Empty = the cue's fade and delay. Up and down are for intensity: a light fading out can go slower than one fading in.</p></div>` : ""}
          ${partDelaysHtml(cue)}
          ${timeline(cue)}
        </section>

        <section class="ci-card">
          <h4>Then</h4>
          <div class="ci-seg">${[["wait", "Wait for GO"], ["follow", "Follow"], ["hang", "Hang"]].map(([k, l]) => `<button type="button" data-a="then:${k}" class="${then === k ? "on" : ""}">${l}</button>`).join("")}</div>
          ${then !== "wait" ? `<label class="ci-line">${then === "follow" ? "Next cue starts this long after this cue's GO" : "Next cue starts this long after this cue finishes"} <span>s</span>${secField("follow", cue.follow || 0)}</label>` : `<p class="ci-muted">The next cue waits for you to press GO.</p>`}
          <label class="ci-line">GO goes to cue ${field("link", cue.link != null ? window.formatCueNumber(cue.link) : "", 'inputmode="decimal" placeholder="next" title="Link / jump: e.g. back to 5 to loop a sequence"')}</label>
          ${cue.link != null ? `<label class="ci-line">…this many times, then on ${field("loop", cue.loop || 0, 'inputmode="numeric" title="0 = forever"')}</label>` : ""}
          <label class="ci-line">Timecode ${field("timecode", tc, 'placeholder="00:00:00:00"')}</label>
        </section>

        <section class="ci-card">
          <h4>Behaviour</h4>
          <button type="button" class="ci-check${cue.mode === "track" ? " on" : ""}" data-a="block"><i></i><span><b>Tracked</b> — stores only what changed; off = a block cue with its whole look</span></button>
          <button type="button" class="ci-check${!cue.noMib ? " on" : ""}" data-a="mib"><i></i><span><b>Move in black</b> — moving lights preset in the dark before this cue</span></button>
          <button type="button" class="ci-check${cue.disabled ? " on warn" : ""}" data-a="disabled"><i></i><span><b>Disabled</b> — GO skips this cue (you can still go to it directly)</span></button>
          ${curtainRow(cue, i)}
          ${cueEffects(cue).map((e, n) => `<div class="ci-line">Effect: <b>${esc(e.name || e.type)}</b> <span class="ci-muted">${(e.fixtureIds || []).length} lights · speed ${e.speed || 1}</span> <button type="button" class="btn-secondary ci-small" data-a="fx:del:${n}">Remove</button></div>`).join("")}
          <button type="button" class="btn-secondary ci-small" data-a="fx:add" title="An effect that runs while this cue is up — e.g. Aurora on the cyc">＋ Add effect to this cue</button>
          ${cue.chase ? `<div class="ci-line">Starts chase ${Number(cue.chase.index) + 1}</div>` : ""}
        </section>

        <section class="ci-card">
          <h4>Label</h4>
          <label class="ci-line">Scene / part ${field("scene", cue.scene || "", 'placeholder="e.g. Act 1 — Opening"')}</label>
          <div class="ci-tags">${TAGS.map(c => `<button type="button" data-a="tag:${c}" class="${(cue.colourTag || "") === c ? "on" : ""}" style="--c:${c || "transparent"}" title="${c ? "Colour tag" : "No colour"}">${c ? "" : "∅"}</button>`).join("")}</div>
          <label class="ci-line ci-col">GO note <span class="ci-muted">shown big under GO while this cue is next</span>${field("goNote", cue.goNote || "", 'placeholder="e.g. first note of Vuelie"')}</label>
          <label class="ci-line ci-col">Notes<textarea class="ci-in" data-f="note" rows="3" placeholder="What happens here, who to watch for…">${esc(cue.note || "")}</textarea></label>
        </section>

        <section class="ci-card">
          <h4>Command on GO</h4>
          ${field("macro", cue.macro || "", 'placeholder="e.g. haze 40; run chase 2"')}
          <p class="ci-muted">Any command line, run when this cue GOes. Separate several with ;</p>
        </section>

        <section class="ci-card ci-wide">
          <h4>What it changes</h4>
          ${contents(i)}
        </section>
      </div>`;
  }

  function rail() {
    const s = S(), cues = s.cues || [];
    const live = s.currentCue, next = window.LXCueList?.next?.() ?? window.peekNextCue?.() ?? -1;
    const at = focusIndex();
    let scene = null;
    return cues.map((c, i) => {
      if (!c) return "";
      const head = c.scene && c.scene !== scene ? `<div class="ci-scene">${esc(c.scene)}</div>` : "";
      if (c.scene) scene = c.scene;
      const t = window.cueTiming(c).total;
      return `${head}<button type="button" class="ci-cue${i === at ? " at" : ""}${i === live ? " live" : ""}${i === next ? " next" : ""}${c.disabled ? " off" : ""}" data-i="${i}" style="--tag:${c.colourTag || "transparent"}">
        <span class="ci-cn">${esc(label(i))}</span><span class="ci-cname">${esc(c.name || "")}</span>
        <span class="ci-cmeta">${c.link != null ? "↩ " : ""}${c.followEnabled ? "⏵ " : ""}${c.timing?.split ? "⧉ " : ""}${secs(t)}s</span></button>`;
    }).join("") || `<p class="ci-muted ci-pad">No cues yet. Set a look and record one (＋ below, or type record cue 1).</p>`;
  }

  function render(force = false) {
    if (!host || !host.isConnected) return;
    if (!host.querySelector(".ci")) {
      host.innerHTML = `<div class="ci">
        <aside class="ci-rail"><div class="ci-railtop"><button type="button" class="ci-toggle" data-a="live" title="Show the live cue, and follow each GO">◉ Follow live</button><button type="button" class="btn-secondary ci-small" data-a="record" title="Record a new cue">＋ Record</button></div><div class="ci-cues"></div></aside>
        <main class="ci-main"></main></div>`;
      host.addEventListener("click", onClick);
      host.addEventListener("change", onChange);
      host.addEventListener("keydown", onKey);
    }
    const s = S();
    const i = focusIndex();
    const cue = s.cues?.[i] || null;
    host.querySelector('[data-a="live"]').classList.toggle("on", !pinned);
    // The list: redrawn when anything shown in it changes.
    const rk = JSON.stringify([(s.cues || []).map(c => c && [c.number, c.name, c.scene, c.colourTag, c.disabled, c.link, c.followEnabled, c.fade, c.delay, c.timing, c.rate]), s.currentCue, i, window.LXCueList?.next?.()]);
    if (rk !== railKey) {
      railKey = rk;
      const list = host.querySelector(".ci-cues");
      list.innerHTML = rail();
      list.querySelector(".ci-cue.at")?.scrollIntoView({ block: "nearest" });
    }
    // The editor: not while you're typing in it.
    const main = host.querySelector(".ci-main");
    const typing = main.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const key = cue ? JSON.stringify([i, s.currentCue, window.LXCueList?.next?.(), cue, (s.fixtures || []).length]) : "none";
    if ((force || key !== shownKey || cue !== shownCue) && !(typing && cue === shownCue && !force)) {
      shownKey = key; shownCue = cue;
      main.innerHTML = cue ? editor(cue, i) : `<div class="ci-empty"><h3>No cues yet</h3><p>Set a look on stage, then record it: <b>record cue 1</b>, or ＋ Record. Cues can go in between later (1.5, 2.25…).</p></div>`;
    }
  }

  function onClick(e) {
    const row = e.target.closest(".ci-cue");
    if (row) return focus(Number(row.dataset.i));
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "live") return followLive();
    if (a === "record") return $("btnRecordCue")?.click();
    const cue = shownCue;
    if (cue) act(cue, a);
  }
  function onChange(e) {
    const el = e.target.closest("[data-f]");
    if (!el || !shownCue) return;
    setField(shownCue, el.dataset.f, el.value);
  }
  function onKey(e) {
    if (e.key === "Enter" && e.target.matches("input.ci-in")) { e.preventDefault(); e.target.blur(); return; }
    if (e.key === "Escape" && e.target.matches(".ci-in")) { shownKey = ""; e.target.blur(); render(true); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const cues = S().cues || [];
      let i = focusIndex() + (e.key === "ArrowDown" ? 1 : -1);
      while (i >= 0 && i < cues.length && !cues[i]) i += e.key === "ArrowDown" ? 1 : -1;
      if (cues[i]) focus(i);
    }
  }

  // ------------------------------------------------------------ commands
  //
  //   cue 5 up 3 / down 5 / move 2 / colour 1 / beam 1   (split times, s)
  //   cue 5 up 3 delay 1                                   …with a delay
  //   cue 5 delay 2        cue 5 curve linear|smooth|in|out|snap
  //   cue 5 rate 150       cue 5 link 2 / link off     cue 5 loop 4
  //   cue 5 follow 2       cue 5 hang 2                cue 5 wait
  //   cue 5 disable / enable    cue 5 scene Act 1      cue 5 note …
  //   cue 5 command haze 40; run chase 2               cue 5 command off
  const PART_WORDS = { up: "up", down: "down", move: "focus", focus: "focus", colour: "colour", color: "colour", beam: "beam" };
  function command(raw) {
    const text = String(raw ?? "").trim();
    const m = text.match(/^cue\s+(\d+(?:\.\d+)?|\.\d+)\s+(up|down|move|focus|colou?r|beam|delay|curve|rate|link|loop|follow|hang|wait|disable|enable|scene|note|command|macro|curtain)\b\s*(.*)$/i);
    if (!m) return false;
    const i = window.cueIndexOf(m[1]);
    if (i < 0) { say(`Cue ${m[1]} not found`, "warn"); return true; }
    const cue = S().cues[i], word = m[2].toLowerCase(), rest = m[3].trim(), n = label(i);
    const seconds = v => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.round(x * 1000) : null; };
    if (PART_WORDS[word]) {
      // One or more: "up 3 down 6", "move 4 delay 1 colour 2"
      const tail = `${word} ${rest}`.trim();
      const re = /(up|down|move|focus|colou?r|beam)\s+(\d*\.?\d+)(?:\s+delay\s+(\d*\.?\d+))?\s*/gi;
      const found = [...tail.matchAll(re)];
      if (!found.length || found.map(f => f[0]).join("").trim() !== tail) { say(`Try: cue ${n} up 3 down 6, or cue ${n} move 4 delay 1 (seconds)`, "warn"); return true; }
      cue.timing ||= {};
      cue.timing.split = true;
      for (const [, w, time, delay] of found) {
        const part = PART_WORDS[w.toLowerCase()];
        cue.timing[part] = seconds(time);
        if (delay != null) cue.timing[part + "Delay"] = seconds(delay);
      }
      changed(cue, found.map(([, w, time, delay]) => `${w.toLowerCase()} ${time} s${delay != null ? ` after ${delay} s` : ""}`).join(", "));
      return true;
    }
    switch (word) {
      case "delay": setField(cue, "delay", rest); return true;
      case "curve": if (!CURVES.some(([k]) => k === rest.toLowerCase())) { say(`Curves: ${CURVES.map(([k]) => k).join(", ")}`, "warn"); return true; } setField(cue, "curve", rest.toLowerCase()); return true;
      case "rate": setField(cue, "rate", rest.replace("%", "")); return true;
      case "link": setField(cue, "link", /^(off|none|clear)$/i.test(rest) ? "" : rest); return true;
      case "loop": setField(cue, "loop", rest); return true;
      case "follow": case "hang":
        if (/^off$/i.test(rest)) { act(cue, "then:wait"); return true; }
        if (!(Number(rest) >= 0) || rest === "") { say(`Try: cue ${n} ${word} 2 (seconds)`, "warn"); return true; }
        cue.follow = Number(rest); act(cue, `then:${word}`); return true;
      case "wait": act(cue, "then:wait"); return true;
      case "curtain": {
        const w = rest.toLowerCase();
        const v = /^(open|out)$/.test(w) ? "1" : /^(close|closed|in|shut)$/.test(w) ? "0" : /^(off|none|leave|clear)$/.test(w) ? "" : null;
        if (v == null) { say(`Try: cue ${n} curtain open, close or leave`, "warn"); return true; }
        act(cue, `curtain:${v}`); return true;
      }
      case "disable": if (!cue.disabled) act(cue, "disabled"); return true;
      case "enable": if (cue.disabled) act(cue, "disabled"); return true;
      case "scene": setField(cue, "scene", /^(off|none|clear)$/i.test(rest) ? "" : rest); return true;
      case "note": setField(cue, "note", rest); return true;
      case "command": case "macro": setField(cue, "macro", /^(off|none|clear)$/i.test(rest) ? "" : rest); return true;
    }
    return false;
  }
  (function install() {
    const previous = window.parseCommand;
    if (typeof previous !== "function") return setTimeout(install, 300);
    const wrapped = function (raw) {
      try { if (command(raw)) return; } catch (e) { say(`Cue command failed: ${e.message}`, "error"); return; }
      return previous.apply(this, arguments);
    };
    Object.assign(wrapped, previous);
    window.parseCommand = wrapped; // once, never re-wrapped
  })();

  // ----------------------------------------------------------------- boot

  function mount() {
    const page = $("page-inspector");
    if (!page) return setTimeout(mount, 300);
    let target = page.querySelector("#cueInspector");
    if (!target) {
      const body = page.querySelector(".panel-body") || page;
      body.innerHTML = `<div id="cueInspector" tabindex="-1"></div>`;
      target = body.querySelector("#cueInspector");
      const meta = page.querySelector(".panel-meta");
      if (meta) meta.textContent = "LIVE";
    }
    host = target;
    render(true);
  }
  // Other parts of the console call this after changing cues.
  window.updateInspectorList = () => { railKey = ""; render(); };
  setInterval(() => { if (host && host.offsetParent !== null) render(); }, 250);
  window.addEventListener("lx-cue-complete", () => render());

  const style = document.createElement("style");
  style.textContent = `
  #cueInspector{outline:none;height:100%}
  .ci{display:grid;grid-template-columns:260px 1fr;gap:12px;min-height:520px;height:100%;font-size:12px;color:var(--text)}
  .ci-rail{display:flex;flex-direction:column;min-height:0;border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-1);overflow:hidden}
  .ci-railtop{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--border)}
  .ci-railtop .ci-toggle{flex:1}
  .ci-cues{overflow:auto;flex:1;padding:4px}
  .ci-scene{font:800 9.5px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted);padding:10px 8px 4px}
  .ci-cue{display:grid;grid-template-columns:44px 1fr auto;gap:6px;align-items:center;width:100%;text-align:left;padding:7px 8px 7px 10px;margin:1px 0;border:1px solid transparent;border-radius:var(--r-sm);background:transparent;color:var(--text-soft);cursor:pointer;position:relative;font:inherit}
  .ci-cue::before{content:"";position:absolute;left:2px;top:6px;bottom:6px;width:3px;border-radius:2px;background:var(--tag)}
  .ci-cue:hover{background:var(--bg-3)}
  .ci-cue.at{border-color:var(--accent-line);background:var(--accent-soft);color:var(--text)}
  .ci-cue.live .ci-cn{color:#3ddc84}.ci-cue.live .ci-cn::after{content:" ●";font-size:8px;vertical-align:2px}
  .ci-cue.next .ci-cn{color:var(--warning)}
  .ci-cue.off{opacity:.45;text-decoration:line-through}
  .ci-cn{font:800 12px var(--mono)}.ci-cname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ci-cmeta{font:600 10px var(--mono);color:var(--text-muted)}
  .ci-main{min-width:0;overflow:auto;padding-right:2px}
  .ci-head{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-left:4px solid var(--tag,transparent);border-radius:var(--r-md);background:linear-gradient(180deg,var(--bg-3),var(--bg-2))}
  .ci-num .ci-in{width:110px;font:800 34px/1 var(--mono);color:var(--accent);background:transparent;border-color:transparent;padding:2px 4px}
  .ci-name{width:100%;font:700 18px var(--sans)!important;background:transparent!important;border-color:transparent!important;padding:2px 4px!important}
  .ci-num .ci-in:hover,.ci-name:hover{border-color:var(--border-strong)!important}
  .ci-sts{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
  .ci-st{font:800 9.5px/1 var(--sans);letter-spacing:.07em;padding:4px 7px;border-radius:20px;border:1px solid var(--border-strong);color:var(--text-soft)}
  .ci-st.live{color:#3ddc84;border-color:rgba(61,220,132,.5)}.ci-st.next{color:var(--warning);border-color:rgba(255,180,84,.5)}.ci-st.off{color:var(--danger);border-color:rgba(255,82,101,.5)}
  .ci-st.link,.ci-st.auto{color:var(--blue);border-color:rgba(92,168,255,.45)}.ci-st.tc,.ci-st.cmd{color:#c38bff;border-color:rgba(195,139,255,.45)}
  .ci-acts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px}
  .ci-acts button{height:28px;font-size:11px;padding:0 11px}
  .ci-danger{color:var(--danger)!important}
  .ci-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:10px}
  .ci-card{border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-2);padding:11px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
  .ci-wide{grid-column:1/-1}
  .ci-card h4{margin:0;font:800 10px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);display:flex;justify-content:space-between}
  .ci-total{color:var(--accent);letter-spacing:.04em}
  .ci-in{background:var(--bg-0);border:1px solid var(--border-strong);border-radius:var(--r-xs);color:var(--text);padding:5px 7px;font:600 12px var(--sans);min-width:0}
  .ci-in:focus{outline:none;border-color:var(--accent)}
  .ci-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
  .ci-row label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;color:var(--text-soft)}
  .ci-row label em{font-style:normal}.ci-row label span,.ci-line span{color:var(--text-muted);font-size:9.5px}
  .ci-row .ci-in{width:76px}.ci-row select.ci-in{width:170px}
  .ci-line{display:flex;align-items:center;gap:8px;color:var(--text-soft);font-size:11px}
  .ci-line .ci-in{width:110px;margin-left:auto}
  .ci-col{flex-direction:column;align-items:stretch}.ci-col textarea{width:100%;resize:vertical;margin:0}
  .ci-card > .ci-in{width:100%}
  .ci-toggle{height:28px;padding:0 10px;border-radius:var(--r-sm);border:1px solid var(--border-strong);background:var(--bg-0);color:var(--text-soft);font:700 11px var(--sans);cursor:pointer}
  .ci-toggle.on{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
  .ci-small{height:26px;font-size:10.5px;padding:0 9px}
  .ci-pds{margin-top:10px;display:grid;gap:6px}.ci-pd-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ci-pd-head b{font-size:12px}.ci-pd-head span{flex:1;font-size:11px;color:var(--text-dim,#7d8987)}.ci-pd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg-1)}.ci-pd select.ci-in{max-width:180px}.ci-pd label{display:flex;align-items:center;gap:5px;font-size:11px}.ci-pd .ci-in{width:auto;min-width:60px;max-width:110px}
  .ci-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
  .ci-part{display:flex;flex-direction:column;gap:5px;padding:8px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg-1)}
  .ci-part label{display:flex;justify-content:space-between;align-items:center;gap:6px;color:var(--text-muted);font-size:10px}
  .ci-part .ci-in{width:64px}
  .ci-split p{grid-column:1/-1;margin:0}
  .ci-graph{display:flex;flex-direction:column;gap:3px;padding:6px 0 18px;position:relative}
  .ci-gr{display:grid;grid-template-columns:52px 1fr 92px;gap:8px;align-items:center}
  .ci-gr svg{width:100%;height:20px;background:var(--bg-1);border-radius:4px}
  .ci-gl{font:800 10px var(--sans);text-transform:uppercase;letter-spacing:.06em}
  .ci-gt{font:600 10px var(--mono);color:var(--text-muted);text-align:right}
  .ci-axis{position:absolute;left:60px;right:100px;bottom:0;height:14px}
  .ci-axis span{position:absolute;transform:translateX(-50%);font:600 9px var(--mono);color:var(--text-muted)}
  .ci-seg{display:flex;border:1px solid var(--border-strong);border-radius:var(--r-sm);overflow:hidden}
  .ci-seg button{flex:1;height:28px;border:0;background:var(--bg-0);color:var(--text-soft);font:700 11px var(--sans);cursor:pointer}
  .ci-seg button+button{border-left:1px solid var(--border-strong)}
  .ci-seg button.on{background:var(--accent-soft);color:var(--accent)}
  .ci-check{display:flex;gap:9px;align-items:flex-start;text-align:left;background:transparent;border:0;color:var(--text-soft);font:500 11px/1.35 var(--sans);cursor:pointer;padding:2px 0}
  .ci-check i{flex:none;width:28px;height:16px;border-radius:9px;background:var(--bg-4);position:relative;margin-top:1px;transition:background .15s}
  .ci-check i::after{content:"";position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#8a9896;transition:left .15s,background .15s}
  .ci-check.on i{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-line)}.ci-check.on i::after{left:14px;background:var(--accent)}
  .ci-check.on.warn i::after{background:var(--danger)}
  .ci-check b{color:var(--text)}
  .ci-curtain{justify-content:space-between}.ci-curtain b{color:var(--text)}.ci-curtain .ci-seg{width:210px}
  .ci-tags{display:flex;gap:6px;flex-wrap:wrap}
  .ci-tags button{width:22px;height:22px;border-radius:50%;border:2px solid var(--border-strong);background:var(--c);color:var(--text-muted);font-size:11px;cursor:pointer;padding:0}
  .ci-tags button.on{border-color:var(--text)}
  .ci-muted{margin:0;color:var(--text-muted);font-size:11px}.ci-pad{padding:10px}
  .ci-fxs{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto}
  .ci-fx{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;background:var(--bg-1)}
  .ci-fn{font:800 11px var(--mono);color:var(--accent);min-width:28px}.ci-fname{flex:1;color:var(--text-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ci-chip{font:700 9.5px var(--mono);padding:2px 6px;border-radius:10px;background:var(--bg-4);color:var(--text-soft);display:inline-flex;align-items:center;gap:4px}
  .ci-chip i{width:9px;height:9px;border-radius:50%;display:inline-block}
  .ci-chip.i{color:#3ddc84}.ci-chip.m{color:var(--blue)}.ci-chip.b{color:var(--warning)}.ci-chip.s{color:var(--danger)}
  .ci-empty{display:grid;place-items:center;text-align:center;height:100%;color:var(--text-soft);padding:40px}
  @media (max-width:820px){.ci{grid-template-columns:1fr}.ci-rail{max-height:220px}}`;
  document.head.appendChild(style);

  window.LXCueInspector = Object.freeze({ render: () => render(true), focus, followLive, current: () => focusIndex() });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
