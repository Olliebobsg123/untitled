"use strict";

/*
 * Fixture Info: "why does this light look like that?"
 *
 * Pick a fixture (◀ ▶ step through, or follow the selection) and see every
 * attribute at a glance; pick one for its value right now, the DMX channels it's sending, what is
 * controlling it — a cue, a chase, an effect, the command line, the Control
 * Deck, a palette — what the running and next cues hold for it, anything
 * changing it on the way out (master, blackout, Blind) and its history.
 *
 * Open it with "info 5", "info" (the selected fixture), right-click a
 * fixture in the list or on the magic sheet, or the Windows menu.
 *
 * How sources are known: whoever acts last owns what they change. Cues,
 * chases, effects, commands, the Control Deck and palettes announce
 * themselves; a watcher compares fixture values 10 times a second and
 * gives each change to whoever was acting at the time.
 */
(function () {
  if (window.LXFixtureInfo) return;

  const S = () => window.State;
  const ATTRS = [
    { id: "intensity", label: "Intensity", keys: ["intensity"], channels: ["dimmer", "intensity"] },
    { id: "colour", label: "Colour", keys: ["hue", "sat", "light", "cyan", "magenta", "yellow", "w", "amber", "uv", "colour", "colourr"], channels: ["r", "g", "b", "w", "amber", "lime", "uv", "cyan", "magenta", "yellow", "colour", "warmWhite", "coolWhite", "cto"] },
    { id: "pan", label: "Pan", keys: ["pan", "panf"], channels: ["pan", "panf"] },
    { id: "tilt", label: "Tilt", keys: ["tilt", "tiltf"], channels: ["tilt", "tiltf"] },
    { id: "zoom", label: "Zoom", keys: ["zoom"], channels: ["zoom"] },
    { id: "focus", label: "Focus", keys: ["focus"], channels: ["focus"] },
    { id: "iris", label: "Iris", keys: ["iris"], channels: ["iris"] },
    { id: "frost", label: "Frost", keys: ["frost"], channels: ["frost"] },
    { id: "strobe", label: "Strobe", keys: ["strobe"], channels: ["strobe", "shutter"] },
    { id: "gobo", label: "Gobo", keys: ["gobo", "gobor"], channels: ["gobo", "gobor"] },
    { id: "gobo2", label: "Gobo 2", keys: ["gobo2", "gobo2r"], channels: ["gobo2", "gobo2r"] },
    { id: "prism", label: "Prism", keys: ["prism", "prismr"], channels: ["prism", "prismr"] }
  ];
  const ATTR_OF = {};
  ATTRS.forEach(a => a.keys.forEach(k => { ATTR_OF[k] = a.id; }));
  const KINDS = {
    cue: ["PLAYBACK", "#19d6a3"], chase: ["CHASE", "#5ca8ff"], effect: ["EFFECT", "#e24fd0"],
    command: ["COMMAND LINE", "#ffb454"], deck: ["CONTROL DECK", "#ffb454"], palette: ["PALETTE", "#ffb454"],
    magic: ["MAGIC SHEET", "#ffb454"], manual: ["MANUAL", "#8c9a97"], start: ["START-UP", "#5d6b68"]
  };

  // ------------------------------------------------------------ tracking

  const owners = new Map();   // fixtureId -> { attrId: source }
  const history = new Map();  // fixtureId -> { attrId: [entries] }
  let actor = null;           // { kind, label, detail, until }
  let last = new Map();       // fixtureId -> copy of its state

  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const fixtureById = id => S()?.fixtures.find(f => f?.id === id);

  function own(id, attrId, source, value) {
    if (!owners.has(id)) owners.set(id, {});
    owners.get(id)[attrId] = { ...source, at: Date.now() };
    if (!history.has(id)) history.set(id, {});
    const list = history.get(id)[attrId] || (history.get(id)[attrId] = []);
    const top = list[0];
    // One line per action, not one per fade frame.
    if (top && top.label === source.label && Date.now() - top.at < 4000) { top.value = value; top.at = Date.now(); return; }
    list.unshift({ kind: source.kind, label: source.label, value, at: Date.now() });
    if (list.length > 8) list.pop();
  }

  // Someone is about to change things: what they change in the next `ms` is theirs.
  function act(kind, label, detail = "", ms = 1200) {
    actor = { kind, label, detail, until: performance.now() + ms };
  }

  // Claim attributes outright (a cue owns what it holds even if the value didn't move).
  function claim(id, attrIds, source) {
    const st = window.ensureFixtureState?.(id) || {};
    attrIds.forEach(a => own(id, a, source, summary(a, st)));
  }

  function chaseHas(id) {
    const s = S();
    const chase = s.currentChase >= 0 ? s.chases?.[s.currentChase] : null;
    if (!chase) return null;
    const ids = Array.isArray(chase.fixtureIds) && chase.fixtureIds.length ? chase.fixtureIds : null;
    return !ids || ids.includes(id) ? chase : null;
  }
  function effectHas(id) {
    const e = S().activeEffect;
    if (!e) return null;
    const ids = Array.isArray(e.fixtureIds) && e.fixtureIds.length ? e.fixtureIds : null;
    return !ids || ids.includes(id) ? e : null;
  }

  function watch() {
    const s = S();
    if (!s?.fixtureStates) return;
    const now = performance.now();
    const live = actor && now < actor.until ? actor : null;
    s.fixtureStates.forEach((st, id) => {
      const before = last.get(id);
      if (before) {
        const changed = new Set();
        for (const k in st) if (ATTR_OF[k] && typeof st[k] === "number" && Math.abs(st[k] - (before[k] ?? st[k])) > 0.01) changed.add(ATTR_OF[k]);
        if (changed.size) {
          let source = live;
          if (!source) {
            const chase = chaseHas(id), effect = effectHas(id);
            if (effect) source = { kind: "effect", label: `Effect “${effect.name || effect.type}”`, detail: `${effect.type} · speed ${effect.speed}` };
            else if (chase) source = { kind: "chase", label: `Chase ${s.currentChase + 1} “${chase.name || "Chase"}”`, detail: `running · ${chase.speed ?? 50}% speed` };
            else source = { kind: "manual", label: "Manual change", detail: "MIDI, the phone remote or another control" };
          }
          changed.forEach(a => own(id, a, source, summary(a, st)));
        }
      }
      last.set(id, { ...st });
    });
  }

  // ----------------------------------------------------------- hooks

  function hook() {
    // Cues: the cue owns everything it holds for its fixtures.
    if (typeof window.goToCue === "function" && !window.goToCue.__lxInfo) {
      const original = window.goToCue;
      const wrapped = function (index, forceFade = null) {
        const cue = S().cues?.[index];
        const fade = forceFade != null ? Number(forceFade) : Number(cue?.fade ?? 800);
        const source = { kind: "cue", label: `Cue ${Number(index) + 1} “${cue?.name || `Cue ${Number(index) + 1}`}”`, detail: `fade ${(fade / 1000).toFixed(1)} s` };
        if (cue) act("cue", source.label, source.detail, fade + 500);
        const result = original.apply(this, arguments);
        if (result && cue && typeof window.getCueTarget === "function") {
          try {
            const { fixtureMap } = window.getCueTarget(cue);
            fixtureMap.forEach((state, id) => claim(id, [...new Set(Object.keys(state).map(k => ATTR_OF[k]).filter(Boolean))], source));
          } catch (_) {}
        }
        return result;
      };
      wrapped.__lxInfo = true;
      window.goToCue = wrapped;
    }
    // Chases and effects change values a moment before they show as running.
    const announce = (name, make) => {
      const fn = window[name];
      if (typeof fn !== "function" || fn.__lxInfo) return;
      const wrapped = function () { const src = make(...arguments); if (src) act(src.kind, src.label, src.detail || "", 1500); return fn.apply(this, arguments); };
      wrapped.__lxInfo = true;
      window[name] = wrapped;
    };
    announce("startChase", i => { const c = S().chases?.[i]; return c && { kind: "chase", label: `Chase ${Number(i) + 1} “${c.name || "Chase"}”`, detail: "starting" }; });
    announce("stopChase", () => S().currentChase >= 0 && { kind: "chase", label: `Chase ${S().currentChase + 1} stopped`, detail: "left at its last step" });
    announce("applySavedEffect", name => ({ kind: "effect", label: `Effect “${name}”`, detail: "starting" }));
    announce("stopEffect", () => S().activeEffect && { kind: "effect", label: `Effect “${S().activeEffect.name || S().activeEffect.type}” stopped`, detail: "" });
    if (window.Palettes?.apply && !window.Palettes.apply.__lxInfo) {
      const original = window.Palettes.apply;
      const wrapped = function (name) { act("palette", `Palette “${name}”`, "", Number(window.LXPrefs?.get("paletteFadeMs") ?? 300) + 500); return original.apply(this, arguments); };
      wrapped.__lxInfo = true;
      try { window.Palettes.apply = wrapped; } catch (_) {}
    }
  }

  document.addEventListener("pointerdown", e => {
    if (e.target.closest?.("#controlPanel")) act("deck", "Control Deck", "a slider or button you moved", 2000);
    else if (e.target.closest?.(".magic-tools")) act("magic", "Magic Sheet", "Full / 50% / Out buttons", 1500);
  }, true);
  document.addEventListener("input", e => { if (e.target.closest?.("#controlPanel")) act("deck", "Control Deck", "a slider or button you moved", 1500); }, true);

  // ------------------------------------------------------------ values

  const clamp255 = v => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  function summary(attrId, st) {
    if (attrId === "intensity") return `${Math.round(Number(st.intensity) || 0)} %`;
    if (attrId === "colour") return Number(st.sat) > 0 ? `hue ${Math.round(st.hue)}° sat ${Math.round(st.sat)}%` : "white";
    const a = ATTRS.find(x => x.id === attrId);
    return String(clamp255(st[a.keys[0]]));
  }

  function channelsOf(f, attr) {
    const map = defOf(f).map || {};
    const seen = new Set(), out = [];
    const base = (Number(f.uni) - 1) * 512 + (Number(f.addr) - 1);
    for (const key of attr.channels) {
      const off = map[key];
      if (typeof off !== "number" || seen.has(off)) continue;
      seen.add(off);
      out.push({ key, ch: Number(f.addr) + off, value: S().dmx?.[base + off] ?? 0 });
    }
    return out;
  }

  const attrsFor = f => ATTRS.filter(a => channelsOf(f, a).length || a.id === "intensity");

  // -------------------------------------------------------------- window
  //
  // The window is built once per fixture/attribute; after that only the
  // text that changed is touched, so nothing under the mouse flickers and
  // a click never lands on a button that's being replaced.

  let body = null, fixtureId = null, attrId = "intensity", timer = null, follow = false;
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 5 ? "just now" : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
  const sortedFixtures = () => (S().fixtures || []).filter(Boolean).slice().sort((a, b) => Number(a.fixtureNumber) - Number(b.fixtureNumber));
  try { follow = localStorage.getItem("lx-fixtureinfo-follow") === "1"; } catch (_) {}

  // Set only if different: text, html, attribute, style.
  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  const setHTML = (el, v) => { if (el && el.__html !== v) { el.innerHTML = v; el.__html = v; } };

  function build(host) {
    body = host;
    host.innerHTML = `
      <div class="fi">
        <div class="fi-pick">
          <button type="button" class="fi-step" data-fi-act="prev" title="Previous fixture">◀</button>
          <select data-fi="fixture" title="Fixture"></select>
          <button type="button" class="fi-step" data-fi-act="next" title="Next fixture">▶</button>
          <label class="fi-follow" title="Show whichever fixture you select"><input type="checkbox" data-fi="follow"> Follow selection</label>
          <span class="fi-live" title="Live — updates as it changes"></span>
        </div>
        <div class="fi-main">
          <div class="fi-head"><div class="fi-title"></div><div class="fi-sub"></div></div>
          <div class="fi-section">ALL ATTRIBUTES <span>click one for the detail</span></div>
          <div class="fi-overview"></div>
          <div class="fi-value">
            <div class="fi-tags"><b data-k="attr"></b><span>LTP</span><span data-k="state"></span></div>
            <div class="fi-big"><span class="fi-swatch" data-k="swatch"></span><span data-k="big"></span></div>
            <div class="fi-bar"><i data-k="bar"></i></div>
            <div class="fi-dmx" data-k="dmx"></div>
          </div>
          <div class="fi-section">CONTROLLED BY</div>
          <div data-k="cards"></div>
          <div class="fi-section">CUES</div>
          <div data-k="cues"></div>
          <div class="fi-section">ON THE WAY OUT</div>
          <div data-k="out"></div>
          <div class="fi-section" data-k="histhead">RECENT CHANGES</div>
          <div class="fi-hist" data-k="hist"></div>
          <div class="fi-actions">
            <button type="button" class="btn-secondary" data-fi-act="select">Select this fixture</button>
            <button type="button" class="btn-secondary" data-fi-act="restore">Put back to the cue</button>
          </div>
        </div>
        <div class="fi-empty" hidden>Patch a fixture to see what it's doing.</div>
      </div>`;
    const fSel = host.querySelector('[data-fi="fixture"]');
    fSel.addEventListener("change", () => { fixtureId = fSel.value; render(); });
    const followBox = host.querySelector('[data-fi="follow"]');
    followBox.checked = follow;
    followBox.addEventListener("change", () => { follow = followBox.checked; try { localStorage.setItem("lx-fixtureinfo-follow", follow ? "1" : "0"); } catch (_) {} render(); });
    host.querySelector(".fi-overview").addEventListener("click", e => {
      const row = e.target.closest("[data-attr]");
      if (row) { attrId = row.dataset.attr; render(); }
    });
    host.addEventListener("click", e => {
      const b = e.target.closest("[data-fi-act]");
      if (!b) return;
      const act = b.dataset.fiAct;
      if (act === "prev" || act === "next") return step(act === "next" ? 1 : -1);
      const f = fixtureById(fixtureId);
      if (!f) return;
      if (act === "select") {
        S().selected = new Set([f.id]); S().selectedFixtureId = f.id;
        window.syncFixtureListSelectionClasses?.(); window.updateControlVisibility?.();
        window.log?.(`Selected fixture ${f.fixtureNumber}`, "ok");
      }
      if (act === "restore") restoreToCue(f);
    });
    render();
    clearInterval(timer);
    timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); timer = null; body = null; return; } render(); }, 200);
  }

  function step(dir) {
    const list = sortedFixtures();
    if (!list.length) return;
    const i = list.findIndex(f => f.id === fixtureId);
    fixtureId = list[(i + dir + list.length) % list.length].id;
    if (follow) { follow = false; body.querySelector('[data-fi="follow"]').checked = false; }
    render();
  }

  // Put just this attribute back to what the current cue says.
  function restoreToCue(f) {
    const s = S();
    const cue = s.cues?.[s.currentCue];
    if (!cue || typeof window.getCueTarget !== "function") return window.log?.("No cue is running to go back to", "warn");
    const target = window.getCueTarget(cue).fixtureMap.get(f.id);
    if (!target) return window.log?.(`Cue ${s.currentCue + 1} doesn't hold fixture ${f.fixtureNumber}`, "warn");
    const attr = ATTRS.find(a => a.id === attrId);
    const next = { ...window.ensureFixtureState(f.id) };
    attr.keys.forEach(k => { if (k in target) next[k] = target[k]; });
    act("cue", `Cue ${s.currentCue + 1} “${cue.name || ""}”`, "put back from the Fixture Info window", 900);
    window.finishFade?.();
    window.fadeTo?.({}, 400, [[f.id, next]]);
    window.log?.(`Fixture ${f.fixtureNumber} ${attr.label.toLowerCase()} back to cue ${s.currentCue + 1}`, "ok");
  }

  // What a cue holds for this fixture's attribute, as text (or null).
  function cueValue(index, f, attr) {
    const cue = S().cues?.[index];
    if (!cue || typeof window.getCueTarget !== "function") return null;
    try {
      const st = window.getCueTarget(cue).fixtureMap.get(f.id);
      return st && attr.keys.some(k => k in st) ? summary(attr.id, st) : null;
    } catch (_) { return null; }
  }

  function render() {
    if (!body) return;
    const s = S();
    if (!s?.fixtures) return;
    const fixtures = sortedFixtures();
    if (follow) { const sel = [...(s.selected || [])]; if (sel.length && fixtureById(sel[sel.length - 1])) fixtureId = sel[sel.length - 1]; }
    if (!fixtureId || !fixtureById(fixtureId)) fixtureId = [...(s.selected || [])][0] ?? fixtures[0]?.id ?? null;
    const main = body.querySelector(".fi-main"), empty = body.querySelector(".fi-empty");
    const f = fixtureById(fixtureId);
    main.hidden = !f; empty.hidden = Boolean(f);

    const fSel = body.querySelector('[data-fi="fixture"]');
    const fKey = fixtures.map(x => `${x.id}:${x.fixtureNumber}:${x.name}`).join("|");
    if (fSel.dataset.key !== fKey) { fSel.innerHTML = fixtures.map(x => `<option value="${esc(x.id)}">${esc(x.fixtureNumber)} · ${esc(x.name)}</option>`).join(""); fSel.dataset.key = fKey; }
    if (!f) return;
    if (fSel.value !== String(f.id) && document.activeElement !== fSel) fSel.value = String(f.id);

    const attrs = attrsFor(f);
    if (!attrs.some(a => a.id === attrId)) attrId = "intensity";
    const attr = ATTRS.find(a => a.id === attrId);
    const st = window.ensureFixtureState?.(f.id) || {};
    const def = defOf(f);
    const k = name => main.querySelector(`[data-k="${name}"]`);

    // Header.
    const groups = (s.groups || []).filter(g => (g?.members || []).map(Number).includes(Number(f.fixtureNumber))).map(g => g.name);
    setHTML(main.querySelector(".fi-title"), `<b>${esc(f.fixtureNumber)}</b> ${esc(f.name)}`);
    setText(main.querySelector(".fi-sub"), `${def.type ? String(def.type).toUpperCase() : "FIXTURE"} · Univ ${f.uni} · Addr ${f.addr}${def.channels ? `–${Number(f.addr) + Number(def.channels) - 1}` : ""}${groups.length ? ` · ${groups.join(", ")}` : ""}`);

    // Overview: one row per attribute, rows built once per fixture, cells patched.
    const ov = main.querySelector(".fi-overview");
    const ovKey = `${f.id}:${attrs.map(a => a.id).join(",")}`;
    if (ov.dataset.key !== ovKey) {
      ov.innerHTML = attrs.map(a => `<div class="fi-row" data-attr="${a.id}"><span>${a.label}</span><b></b><em></em></div>`).join("");
      ov.dataset.key = ovKey;
    }
    const own = owners.get(f.id) || {};
    attrs.forEach(a => {
      const row = ov.querySelector(`[data-attr="${a.id}"]`);
      row.classList.toggle("on", a.id === attrId);
      setText(row.children[1], summary(a.id, st));
      const o = own[a.id];
      setText(row.children[2], o ? o.label : "—");
      row.children[2].style.color = o ? (KINDS[o.kind] || KINDS.manual)[1] : "";
    });

    // The chosen attribute, big.
    const chans = channelsOf(f, attr);
    setText(k("attr"), attr.label.toUpperCase());
    const fading = s.fading != null;
    setText(k("state"), fading ? "FADING" : "STEADY");
    k("state").classList.toggle("on", fading);
    let big, bar = null, swatch = null;
    if (attr.id === "intensity") { const v = Math.round(Number(st.intensity) || 0); big = `${v} %`; bar = v / 100; }
    else if (attr.id === "colour") {
      const rgb = chans.filter(c => ["r", "g", "b"].includes(c.key));
      swatch = rgb.length === 3 ? `rgb(${rgb.map(c => c.value).join(",")})` : `hsl(${st.hue || 0} ${st.sat || 0}% ${Math.max(30, Math.min(80, st.light ?? 50))}%)`;
      big = Number(st.sat) > 0 ? `${Math.round(st.hue)}°  ${Math.round(st.sat)}%` : "White";
    } else { const v = clamp255(st[attr.keys[0]]); big = `${v}`; bar = v / 255; }
    setText(k("big"), big);
    k("swatch").hidden = !swatch;
    if (swatch && k("swatch").style.background !== swatch) k("swatch").style.background = swatch;
    k("bar").parentElement.hidden = bar == null;
    if (bar != null) { const w = `${Math.round(bar * 100)}%`; if (k("bar").style.width !== w) k("bar").style.width = w; }
    setHTML(k("dmx"), chans.length ? chans.map(c => `<span>ch ${c.ch} <em>${c.key}</em> = <b>${c.value}</b></span>`).join("") : "No DMX channel for this on this fixture");

    // Controlled by.
    const owner = own[attr.id], effect = effectHas(f.id), chase = chaseHas(f.id);
    const cards = [];
    if (owner) {
      const [kind, colour] = KINDS[owner.kind] || KINDS.manual;
      cards.push(card(kind, colour, esc(owner.label), `${esc(owner.detail || "")}${owner.detail ? " · " : ""}set ${ago(owner.at)}`));
    } else cards.push(card("NOT CHANGED", "#5d6b68", "Still at its start-up value", "Nothing has set this since Light Spark opened (or the show loaded)."));
    if (effect && owner?.kind !== "effect") cards.push(card("EFFECT", KINDS.effect[1], `Effect “${esc(effect.name || effect.type)}” is running on this fixture`, "It may change this attribute as it runs."));
    if (chase && owner?.kind !== "chase") cards.push(card("CHASE", KINDS.chase[1], `Chase ${s.currentChase + 1} “${esc(chase.name || "Chase")}” is running on this fixture`, "Its next step may change this attribute."));
    setHTML(k("cards"), cards.join(""));

    // Cues: what the running cue holds against what's live, and what's next.
    const live = summary(attr.id, st);
    const cueRows = [];
    if (s.currentCue >= 0 && s.cues?.[s.currentCue]) {
      const held = cueValue(s.currentCue, f, attr);
      const name = s.cues[s.currentCue].name || `Cue ${s.currentCue + 1}`;
      if (held == null) cueRows.push(["info", `Cue ${s.currentCue + 1} “${name}” (running) doesn't hold this fixture.`]);
      else if (held === live) cueRows.push(["ok", `Cue ${s.currentCue + 1} “${name}” (running) holds ${held} — live matches.`]);
      else cueRows.push(["warn", `Cue ${s.currentCue + 1} “${name}” (running) holds ${held}, but live is ${live}. “Put back to the cue” fixes it.`]);
    } else cueRows.push(["info", "No cue running."]);
    let nextIndex = window.LXCueList ? window.LXCueList.next() : (s.currentCue ?? -1) + 1;
    while (!window.LXCueList && nextIndex < (s.cues?.length || 0) && !s.cues[nextIndex]) nextIndex++;
    if (s.cues?.[nextIndex]) {
      const held = cueValue(nextIndex, f, attr);
      const name = s.cues[nextIndex].name || `Cue ${nextIndex + 1}`;
      cueRows.push(["next", held == null ? `Next: cue ${nextIndex + 1} “${name}” doesn't hold this fixture.` : held === live ? `Next: cue ${nextIndex + 1} “${name}” keeps it at ${held}.` : `Next: cue ${nextIndex + 1} “${name}” takes it to ${held}.`]);
    }
    setHTML(k("cues"), cueRows.map(([lvl, t]) => `<div class="fi-out ${lvl}">${esc(t)}</div>`).join(""));

    // On the way out.
    const out = [];
    const master = Number(document.getElementById("master")?.value ?? s.current?.master ?? 100);
    const blind = document.getElementById("consoleModeBlind")?.classList.contains("active");
    if (s.blackout) out.push(["warn", "Blackout is ON — the output is 0 whatever the value above says."]);
    if (blind) out.push(["warn", "BLIND — you're editing without changing the stage; the stage holds its last look."]);
    if (document.documentElement.classList.contains("emergency-active")) out.push(["warn", "Emergency mode is on."]);
    if (attr.id === "intensity" && master < 100) out.push([master === 0 ? "warn" : "info", `Master at ${master}% — on stage this is ${Math.round((Number(st.intensity) || 0) * master / 100)}%.`]);
    if (attr.id !== "intensity" && Number(st.intensity) <= 0) out.push(["info", "The fixture's intensity is 0, so you won't see this on stage."]);
    if (!out.length) out.push(["ok", attr.id === "intensity" ? `Master ${master}% · no blackout · Live — it goes out as it is.` : "Live — it goes out as it is."]);
    setHTML(k("out"), out.map(([lvl, t]) => `<div class="fi-out ${lvl}">${esc(t)}</div>`).join(""));

    // History.
    const hist = history.get(f.id)?.[attr.id] || [];
    k("histhead").hidden = !hist.length;
    setHTML(k("hist"), hist.map(h => `<div><span>${ago(h.at)}</span><b style="color:${(KINDS[h.kind] || KINDS.manual)[1]}">${esc(h.label)}</b><em>${esc(h.value)}</em></div>`).join(""));

    // Buttons stay put; only their wording and state change.
    const restore = main.querySelector('[data-fi-act="restore"]');
    setText(restore, `Put ${attr.label.toLowerCase()} back to the cue`);
    restore.disabled = !(s.currentCue >= 0);
  }

  function card(kind, colour, title, detail) {
    return `<div class="fi-card" style="--k:${colour}"><div class="fi-kind">${kind}</div><div class="fi-card-title">${title}</div><div class="fi-card-detail">${detail}</div></div>`;
  }

  function open(target, attribute) {
    if (target != null) fixtureId = target;
    if (attribute && ATTRS.some(a => a.id === attribute)) attrId = attribute;
    const w = window.LXWindows;
    if (!w) return false;
    if (target != null && follow && body) { follow = false; body.querySelector('[data-fi="follow"]').checked = false; }
    w.open("fixtureinfo");
    render();
    return true;
  }

  function injectStyles() {
    if (document.getElementById("lxFixtureInfoStyles")) return;
    const style = document.createElement("style");
    style.id = "lxFixtureInfoStyles";
    style.textContent = `
      .fi{display:flex;flex-direction:column;min-height:100%}
      .fi-pick{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid var(--border);background:#0e1519;position:sticky;top:0;z-index:1}
      .fi-pick select{flex:1;min-width:0;height:26px;padding:0 6px;background:#0a1013;border:1px solid var(--border-strong);border-radius:4px;color:var(--text);font-size:11px}
      .fi-step{width:24px;height:26px;border:1px solid var(--border-strong);border-radius:4px;background:#0a1013;color:#9aa7a4;font-size:9px;cursor:pointer}
      .fi-step:hover{color:var(--text);border-color:var(--accent-line)}
      .fi-follow{display:flex;align-items:center;gap:5px;color:#7d8b88;font-size:10px;white-space:nowrap;cursor:pointer}
      .fi-follow input{width:13px;height:13px;margin:0;accent-color:var(--accent)}
      .fi-live{flex:none;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
      .fi-main{padding:0 0 10px}
      .fi-empty{padding:30px;color:#6f7d7a;text-align:center;font-size:12px}
      .fi-head{padding:10px 12px;background:rgba(var(--accent-rgb),.08);border-left:3px solid var(--accent)}
      .fi-title{font-size:15px;font-weight:800;color:var(--text)}
      .fi-title b{margin-right:6px}
      .fi-sub{margin-top:3px;color:#7d8b88;font-family:var(--mono);font-size:10px}
      .fi-overview{margin:0 10px;display:flex;flex-direction:column;gap:1px;border:1px solid var(--border);border-radius:4px;overflow:hidden}
      .fi-row{display:grid;grid-template-columns:76px 112px minmax(0,1fr);gap:8px;align-items:center;height:23px;padding:0 8px;background:#0d1418;font-size:10.5px;cursor:pointer}
      .fi-row:hover{background:#142026}
      .fi-row.on{background:var(--accent-soft);box-shadow:inset 2px 0 0 var(--accent)}
      .fi-row span{color:#9aa7a4;font-weight:700}
      .fi-row.on span{color:var(--accent-2)}
      .fi-row b{color:var(--text);font-family:var(--mono);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fi-row em{font-style:normal;font-family:var(--mono);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#5d6b68}
      .fi-value{margin-top:8px;padding:10px 12px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
      .fi-tags{display:flex;gap:10px;align-items:baseline;font-size:10px;font-weight:800;letter-spacing:1px;color:#6f7d7a}
      .fi-tags b{color:var(--accent-2)}
      .fi-tags span.on{color:var(--warning)}
      .fi-big{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:30px;font-weight:300;color:var(--text);font-family:var(--mono)}
      .fi-swatch{width:30px;height:30px;border-radius:6px;border:1px solid var(--border-strong);box-shadow:0 0 18px rgba(255,255,255,.08)}
      .fi-swatch[hidden]{display:none}
      .fi-bar{height:4px;border-radius:2px;background:#1c272d;overflow:hidden}
      .fi-bar[hidden]{display:none}
      .fi-bar i{display:block;height:100%;background:var(--accent);transition:width .15s}
      .fi-dmx{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;color:#6f7d7a;font-family:var(--mono);font-size:10px}
      .fi-dmx em{font-style:normal;color:#9aa7a4}
      .fi-dmx b{color:var(--text)}
      .fi-section{padding:10px 12px 4px;color:#5d6b68;font-size:9px;font-weight:850;letter-spacing:1.3px}
      .fi-section[hidden]{display:none}
      .fi-section span{margin-left:6px;font-weight:600;letter-spacing:.3px;color:#46534f}
      .fi-card{margin:4px 10px;padding:7px 10px;border-left:3px solid var(--k);background:#0f171b;border-radius:3px}
      .fi-kind{color:var(--k);font-size:9.5px;font-weight:900;letter-spacing:1.2px}
      .fi-card-title{margin-top:2px;color:var(--text);font-family:var(--mono);font-size:11.5px}
      .fi-card-detail{margin-top:2px;color:#7d8b88;font-family:var(--mono);font-size:10px}
      .fi-out{margin:3px 10px;padding:6px 10px;border-radius:3px;font-size:11px;background:#0f171b;color:#9aa7a4;border-left:3px solid #2b383f}
      .fi-out.ok{border-left-color:var(--accent)}
      .fi-out.warn{border-left-color:var(--warning);color:var(--warning)}
      .fi-out.info{border-left-color:var(--blue)}
      .fi-out.next{border-left-color:#8c9a97;color:#c4ceca}
      .fi-hist{margin:0 10px;display:flex;flex-direction:column;gap:2px;font-size:10.5px}
      .fi-hist div{display:grid;grid-template-columns:70px 1fr auto;gap:8px;padding:3px 6px;background:#0d1418;border-radius:3px}
      .fi-hist span{color:#5d6b68}
      .fi-hist b{font-weight:600;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fi-hist em{font-style:normal;color:var(--text);font-family:var(--mono)}
      .fi-actions{display:flex;flex-wrap:wrap;gap:6px;padding:10px 10px 0}
    `;
    document.head.appendChild(style);
  }

  // Right-click a fixture (list, patch table or magic sheet) for its info.
  document.addEventListener("contextmenu", e => {
    const item = e.target.closest?.("#fixtureList .fixture-item[data-fixture-id], .ms-fx[data-id], #patchTable .pt-row[data-id]");
    if (!item) return;
    const raw = item.dataset.fixtureId ?? item.dataset.id;
    const f = S().fixtures.find(x => String(x?.id) === String(raw));
    if (!f) return;
    e.preventDefault();
    open(f.id);
  });

  function boot(tries = 0) {
    injectStyles();
    hook();
    if (window.LXWindows && !window.LXWindows.list().includes("fixtureinfo")) {
      window.LXWindows.register({ id: "fixtureinfo", title: "Fixture Info", build, w: 460, h: 760 });
    }
    if ((!window.LXWindows || !window.Palettes?.apply?.__lxInfo || !window.goToCue?.__lxInfo) && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  setInterval(watch, 100);
  window.addEventListener("load", () => setTimeout(boot, 300));

  window.LXFixtureInfo = Object.freeze({ open, act, claim, owners: id => ({ ...(owners.get(id) || {}) }), attrs: ATTRS.map(a => a.id) });
})();
