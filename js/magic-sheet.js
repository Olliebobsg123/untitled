"use strict";

/*
 * Magic Sheet: a 2D plan of the rig, built automatically from the patch.
 *
 * Every fixture is drawn as the kind of light it is (par, profile, fresnel,
 * moving head, batten, strobe, blinder, smoke machine, mirror ball), placed
 * where it hangs in the visualiser, bar by bar, and filled with the colour and
 * level it is actually putting out. It reads the same DMX the rig gets, so it
 * follows cues, fades, chases and effects as they run. Click a light to select
 * it (Shift/Cmd to add), drag across empty space to lasso, or use the group
 * buttons.
 */
(function () {
  if (window.MagicSheet) return;

  const NS = "http://www.w3.org/2000/svg";
  const S = () => window.State || {};
  let decode = null; // js/visualizer/decode.js, shared with the visualiser
  import("./visualizer/decode.js").then(module => { decode = module; layoutKey = null; }).catch(error => console.warn("[MAGIC] decode module", error));

  const definition = fixture => window.getFixtureDefinition?.(fixture) || window.FixtureLibrary?.[fixture?.name] || null;

  // Names of the visualiser's bars, by depth (js/visualizer/theatre.js BARS).
  const BAR_NAMES = [[-6.4, "LX 3"], [-3.8, "LX 2"], [-1.2, "LX 1"], [6, "FOH"]];
  const ROW_GAP = 104, ICON = 46, MARGIN_X = 84, TOP = 46;

  // ------------------------------------------------------------- layout

  function rowName(z, hung) {
    if (!hung) return "Floor";
    const near = BAR_NAMES.find(([bz]) => Math.abs(bz - z) < 0.7);
    return near ? near[1] : z >= 0 ? "Front" : `Bar ${Math.abs(z).toFixed(1)}m`;
  }

  // Rows of fixtures, upstage first, each in left-to-right order (as the
  // audience sees it), spread so icons never overlap.
  function buildLayout(width) {
    const state = S();
    const fixtures = (state.fixtures || []).filter(Boolean);
    const saved = state.visualizer?.positions || {};
    const fallback = window.AutoCreate?.positions?.(fixtures) || new Map();
    const items = fixtures.map((fixture, i) => {
      const def = definition(fixture);
      const kind = decode ? decode.archetype(def, fixture.name) : "par";
      const own = saved[String(fixture.id)];
      let pos = own && [own.x, own.y, own.z].every(Number.isFinite) ? own : fallback.get(fixture.id);
      // Not placed yet: a mirror ball hangs where the visualiser puts it;
      // smoke machines go on the upstage floor.
      if (!pos) pos = kind === "mirrorBall" ? { x: 0, y: 6.4, z: -2.6 } : { x: -5 + (i % 10), y: 0, z: -7 };
      return { fixture, def, kind, pos, hung: pos.y > 2.5 };
    });
    // Group into rows by depth (and hung vs floor).
    const rows = [];
    for (const item of [...items].sort((a, b) => a.pos.z - b.pos.z)) {
      const row = rows.find(r => r.hung === item.hung && Math.abs(r.z - item.pos.z) < 0.6);
      if (row) { row.items.push(item); row.z = (row.z * (row.items.length - 1) + item.pos.z) / row.items.length; }
      else rows.push({ z: item.pos.z, hung: item.hung, items: [item] });
    }
    rows.sort((a, b) => (a.hung === b.hung ? a.z - b.z : a.hung ? -1 : 1));
    const xs = items.map(i => i.pos.x);
    const minX = Math.min(-6, ...xs), maxX = Math.max(6, ...xs);
    const usable = width - MARGIN_X - 40;
    const toScreen = x => MARGIN_X + ((x - minX) / (maxX - minX || 1)) * usable;
    // The stage edge sits after the last bar over the stage; rows past it
    // get extra room for its label.
    let edgeAfter = -1;
    rows.forEach((row, r) => { if (row.hung && row.z < 0) edgeAfter = r; });
    rows.forEach((row, r) => {
      row.y = TOP + r * ROW_GAP + 30 + (edgeAfter >= 0 && r > edgeAfter ? 28 : 0);
      row.name = rowName(row.z, row.hung);
      row.items.sort((a, b) => a.pos.x - b.pos.x);
      // Push apart anything closer than an icon, then keep the row centred
      // where it was.
      const wide = item => (item.kind === "bar" ? ICON * 1.6 : ICON) + 10;
      let last = -Infinity;
      const wanted = row.items.map(item => toScreen(item.pos.x));
      row.items.forEach((item, i) => { item.sx = Math.max(wanted[i], last + (wide(row.items[i - 1] || item) + wide(item)) / 2); last = item.sx; });
      const shift = (wanted.reduce((a, b) => a + b, 0) - row.items.reduce((a, it) => a + it.sx, 0)) / row.items.length;
      const overflow = Math.max(0, row.items[row.items.length - 1].sx + shift - (width - 30));
      row.items.forEach(item => { item.sx = Math.max(MARGIN_X, item.sx + shift - overflow); item.sy = row.y; });
    });
    const height = TOP + rows.length * ROW_GAP + 48;
    return { rows, items, edgeAfter, height };
  }

  // --------------------------------------------------------------- icons

  function el(name, attrs = {}, parent = null) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  // Draws one fixture's body; returns the elements to fill with its light.
  function drawIcon(g, kind) {
    const body = "ms-body", lens = "ms-lens";
    const lit = [];
    switch (kind) {
      case "profile": {
        lit.push(el("path", { d: "M-9 -20h18v15l8 20h-34l8-20z", class: `${body} ${lens}` }, g));
        break;
      }
      case "fresnel": {
        el("rect", { x: -21, y: -5, width: 42, height: 10, class: "ms-door" }, g);
        lit.push(el("circle", { r: 16, class: `${body} ${lens}` }, g));
        el("circle", { r: 9, class: "ms-ring" }, g);
        break;
      }
      case "movingSpot": case "movingBeam": {
        el("rect", { x: -19, y: -19, width: 38, height: 38, rx: 5, class: body }, g);
        lit.push(el("circle", { r: kind === "movingBeam" ? 7 : 11, class: lens }, g));
        break;
      }
      case "movingWash": {
        el("rect", { x: -19, y: -19, width: 38, height: 38, rx: 5, class: body }, g);
        lit.push(el("circle", { r: 14, class: lens }, g));
        el("circle", { r: 14, class: "ms-pods" }, g);
        break;
      }
      case "bar": {
        el("rect", { x: -37, y: -10, width: 74, height: 20, rx: 3, class: body }, g);
        for (let i = 0; i < 6; i++) lit.push(el("rect", { x: -33 + i * 11, y: -6, width: 9, height: 12, class: lens }, g));
        break;
      }
      case "strobe": {
        el("rect", { x: -22, y: -12, width: 44, height: 24, rx: 3, class: body }, g);
        lit.push(el("rect", { x: -18, y: -7, width: 36, height: 14, class: lens }, g));
        break;
      }
      case "blinder": {
        el("rect", { x: -22, y: -12, width: 44, height: 24, rx: 3, class: body }, g);
        for (let i = 0; i < 2; i++) lit.push(el("circle", { cx: -10 + i * 20, r: 8, class: lens }, g));
        break;
      }
      case "fogger": case "hazer": {
        el("rect", { x: -20, y: -13, width: 40, height: 26, rx: 4, class: body }, g);
        const t = el("text", { y: 4, class: "ms-tag" }, g); t.textContent = kind === "hazer" ? "HAZE" : "FOG";
        break;
      }
      case "mirrorBall": {
        lit.push(el("circle", { r: 17, class: `${body} ${lens}` }, g));
        el("path", { d: "M-17 0h34M0 -17v34M-12 -12l24 24M12 -12l-24 24", class: "ms-ring" }, g);
        break;
      }
      default: // par and anything else round
        lit.push(el("circle", { r: 17, class: `${body} ${lens}` }, g));
    }
    return lit;
  }

  // ---------------------------------------------------------------- view

  let root = null, svg = null, layer = null, lasso = null, layoutKey = null, view = [], groupBar = null, groupKey = null, info = null;

  function injectStyles() {
    if (document.getElementById("magicSheetStyles")) return;
    const style = document.createElement("style");
    style.id = "magicSheetStyles";
    style.textContent = `
      #page-magic .magic-panel{display:flex;flex-direction:column;height:100%;min-height:420px}
      #page-magic .magic-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)}
      #page-magic .magic-tools .sep{width:1px;height:22px;background:var(--border);margin:0 4px}
      #page-magic .magic-tools button{height:28px;padding:0 11px;font-size:10px}
      #page-magic .magic-info{margin-left:auto;color:#6f7d7a;font-size:10px;letter-spacing:.3px}
      #page-magic .magic-stage{flex:1;overflow:auto;background:#070b0d;position:relative}
      #page-magic svg{display:block;user-select:none}
      .ms-bar{stroke:#1d272c;stroke-width:3;stroke-linecap:round}
      .ms-rowname{fill:#5d6b68;font-size:10px;font-weight:800;letter-spacing:1px}
      .ms-edge{stroke:#26333a;stroke-dasharray:6 6}
      .ms-edgetext{fill:#3f4c50;font-size:9px;font-weight:800;letter-spacing:2px}
      .ms-body{fill:#141c20;stroke:#3a474d;stroke-width:1.3}
      .ms-lens{stroke-width:1.3}
      .ms-door{fill:#1a2328;stroke:#33424a}
      .ms-ring{fill:none;stroke:rgba(0,0,0,.45);stroke-width:1.2}
      .ms-pods{fill:none;stroke:rgba(0,0,0,.45);stroke-width:2;stroke-dasharray:3 3}
      .ms-tag{fill:#6f7d7a;font-size:8.5px;font-weight:800;text-anchor:middle;letter-spacing:.5px}
      .ms-num{fill:#aab6b3;font-size:11px;font-weight:800;text-anchor:middle}
      .ms-lvl{font-size:10px;font-weight:800;text-anchor:middle;fill:#46534f}
      .ms-lvl.on{fill:#ff5d5d}
      .ms-fx{cursor:pointer}
      .ms-fx:hover .ms-body{stroke:#7d8b88}
      .ms-sel .ms-body{stroke:var(--accent);stroke-width:2.6}
      .ms-sel .ms-num{fill:var(--accent)}
      .ms-hit{fill:transparent}
      .ms-lasso{fill:rgba(25,214,163,.08);stroke:var(--accent);stroke-dasharray:4 3}
      .ms-empty{fill:#53615f;font-size:12px;text-anchor:middle}
    `;
    document.head.appendChild(style);
  }

  function installPage() {
    if (document.getElementById("page-magic")) return true;
    const nav = document.querySelector('.nav-link[data-page="live"]');
    const live = document.getElementById("page-live");
    if (!nav || !live) return false;
    injectStyles();
    const button = document.createElement("button");
    button.className = "nav-link";
    button.dataset.page = "magic";
    button.innerHTML = '<span class="nav-icon">◉</span><span class="nav-text">Magic Sheet</span><b>08</b>';
    const links = [...document.querySelectorAll(".nav-link[data-page]")];
    links[links.length - 1].after(button);
    button.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".nav-link").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
      button.classList.add("active");
      root.classList.add("active");
      layoutKey = null;
      window.log?.("View: magic sheet");
    });

    root = document.createElement("div");
    root.className = "page";
    root.id = "page-magic";
    root.innerHTML = `
      <section class="panel magic-panel">
        <div class="panel-header"><div><span class="eyebrow">MAGIC SHEET</span> Rig Plan</div><span class="panel-meta">AUTO · LIVE OUTPUT</span></div>
        <div class="magic-tools">
          <button type="button" class="btn-secondary" data-ms="all">All</button>
          <button type="button" class="btn-secondary" data-ms="none">Clear</button>
          <span class="sep"></span>
          <span data-ms-groups style="display:contents"></span>
          <span class="sep"></span>
          <button type="button" class="btn-secondary" data-ms="full">Full</button>
          <button type="button" class="btn-secondary" data-ms="half">50%</button>
          <button type="button" class="btn-secondary" data-ms="out">Out</button>
          <span class="magic-info" data-ms-info></span>
        </div>
        <div class="magic-stage"><svg></svg></div>
      </section>`;
    live.parentElement.appendChild(root);
    svg = root.querySelector("svg");
    groupBar = root.querySelector("[data-ms-groups]");
    info = root.querySelector("[data-ms-info]");
    root.querySelector('[data-ms="all"]').addEventListener("click", () => select((S().fixtures || []).filter(Boolean).map(f => f.id), false));
    root.querySelector('[data-ms="none"]').addEventListener("click", () => select([], false));
    const level = v => { if (!S().selected?.size) return window.log?.("Select fixtures first", "warn"); window.applyLevel?.(v); };
    root.querySelector('[data-ms="full"]').addEventListener("click", () => level(100));
    root.querySelector('[data-ms="half"]').addEventListener("click", () => level(50));
    root.querySelector('[data-ms="out"]').addEventListener("click", () => level(0));
    installPointer();
    return true;
  }

  // Select fixtures the way the fixture list does.
  function select(ids, add) {
    const state = S();
    if (!(state.selected instanceof Set)) state.selected = new Set();
    if (!add) state.selected.clear();
    for (const id of ids) {
      if (add && state.selected.has(id) && ids.length === 1) state.selected.delete(id);
      else state.selected.add(id);
    }
    state.selectedFixtureId = ids[ids.length - 1] ?? null;
    window.syncFixtureListSelectionClasses?.();
    window.updateControlVisibility?.();
    window.updateDMX?.();
  }

  function installPointer() {
    let start = null;
    const point = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    svg.addEventListener("pointerdown", e => {
      const hit = e.target.closest?.(".ms-fx");
      if (hit) { select([hit.dataset.id], e.shiftKey || e.metaKey || e.ctrlKey); return; }
      start = point(e);
      lasso.setAttribute("width", 0); lasso.setAttribute("height", 0); lasso.style.display = "";
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", e => {
      if (!start) return;
      const p = point(e);
      lasso.setAttribute("x", Math.min(start.x, p.x)); lasso.setAttribute("y", Math.min(start.y, p.y));
      lasso.setAttribute("width", Math.abs(p.x - start.x)); lasso.setAttribute("height", Math.abs(p.y - start.y));
    });
    svg.addEventListener("pointerup", e => {
      if (!start) return;
      const p = point(e);
      const [x0, x1] = [Math.min(start.x, p.x), Math.max(start.x, p.x)], [y0, y1] = [Math.min(start.y, p.y), Math.max(start.y, p.y)];
      start = null; lasso.style.display = "none";
      if (x1 - x0 < 4 && y1 - y0 < 4) { if (!(e.shiftKey || e.metaKey)) select([], false); return; }
      const ids = view.filter(v => v.sx >= x0 && v.sx <= x1 && v.sy >= y0 && v.sy <= y1).map(v => v.fixture.id);
      select(ids, e.shiftKey || e.metaKey || e.ctrlKey);
    });
  }

  function renderGroups() {
    const groups = (S().groups || []).filter(g => g?.name);
    const key = groups.map(g => `${g.name}:${(g.members || []).join(",")}`).join("|");
    if (key === groupKey) return;
    groupKey = key;
    groupBar.replaceChildren(...groups.slice(0, 14).map(group => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn-secondary"; b.textContent = group.name;
      b.addEventListener("click", () => { window.selectGroup?.(group); window.syncFixtureListSelectionClasses?.(); });
      return b;
    }));
  }

  // Rebuild the drawing when the patch, positions or size change.
  function rebuild() {
    const width = Math.max(700, root.querySelector(".magic-stage").clientWidth);
    const state = S();
    const key = JSON.stringify([width, (state.fixtures || []).map(f => f && [f.id, f.name, f.fixtureNumber, f.uni, f.addr]), state.visualizer?.positions || {}, Boolean(decode)]);
    if (key === layoutKey) return;
    layoutKey = key;
    const layout = buildLayout(width);
    svg.replaceChildren();
    svg.setAttribute("width", width);
    svg.setAttribute("height", Math.max(layout.height, 300));
    layer = el("g", {}, svg);
    if (!layout.items.length) {
      const t = el("text", { x: width / 2, y: 120, class: "ms-empty" }, layer);
      t.textContent = "Patch some fixtures and they'll appear here, laid out as they hang.";
    }
    layout.rows.forEach((row, r) => {
      if (row.hung) el("line", { x1: MARGIN_X - 30, x2: width - 24, y1: row.y, y2: row.y, class: "ms-bar" }, layer);
      const name = el("text", { x: 14, y: row.y + 4, class: "ms-rowname" }, layer); name.textContent = row.name.toUpperCase();
      if (r === layout.edgeAfter && r < layout.rows.length - 1) {
        const y = row.y + ROW_GAP * 0.56;
        el("line", { x1: MARGIN_X - 30, x2: width - 24, y1: y, y2: y, class: "ms-edge" }, layer);
        const t = el("text", { x: width / 2, y: y + 13, class: "ms-edgetext", "text-anchor": "middle" }, layer); t.textContent = "STAGE EDGE · AUDIENCE ▾";
      }
    });
    view = layout.items.map(item => {
      const g = el("g", { class: "ms-fx", transform: `translate(${item.sx} ${item.sy})` }, layer);
      g.dataset.id = item.fixture.id;
      const glow = el("circle", { r: 30, fill: "transparent" }, g);
      el("rect", { x: -26, y: -34, width: 52, height: 70, class: "ms-hit" }, g);
      const lit = drawIcon(g, item.kind);
      const num = el("text", { y: item.kind === "bar" ? -16 : -27, class: "ms-num" }, g);
      num.textContent = item.fixture.fixtureNumber ?? "";
      const lvl = el("text", { y: item.kind === "bar" ? 24 : 34, class: "ms-lvl" }, g);
      const title = el("title", {}, g);
      title.textContent = `${item.fixture.fixtureNumber}. ${item.fixture.name} — Uni ${item.fixture.uni} Addr ${item.fixture.addr}`;
      return { ...item, g, glow, lit, lvl, last: "" };
    });
    lasso = el("rect", { class: "ms-lasso", style: "display:none" }, svg);
    info.textContent = `${layout.items.length} fixtures · ${layout.rows.length} rows`;
  }

  // Fill each fixture with what it's putting out right now.
  function paint() {
    const state = S();
    const dmx = state.dmx;
    const selected = state.selected instanceof Set ? state.selected : new Set();
    const time = performance.now() / 1000;
    for (const v of view) {
      let level = 0, rgb = [1, 1, 1], strobe = 0;
      if (decode && dmx && v.def) {
        const base = decode.baseAddress(v.fixture);
        if (base >= 0) {
          const d = decode.decodeFixture(v.def, dmx, base, v.fixture.name, v.fixture.manualShutters, v.fixture.beamAngle);
          level = d.intensity; rgb = d.rgb; strobe = d.strobeRate;
        }
      }
      if (strobe > 0 && (time * strobe) % 1 > 0.25) level *= 0.15;
      const isSel = selected.has(v.fixture.id);
      const key = `${level.toFixed(3)}|${rgb.map(c => c.toFixed(2))}|${isSel}`;
      if (key === v.last) continue;
      v.last = key;
      const k = level > 0 ? 0.25 + 0.75 * level : 0;
      const colour = level > 0 ? `rgb(${rgb.map(c => Math.round(c * k * 255)).join(",")})` : "#11181c";
      const edge = level > 0 ? `rgb(${rgb.map(c => Math.round(Math.min(255, c * 255 * (0.5 + level * 0.5)))).join(",")})` : "#2a363c";
      // Inline style, since the .ms-body class rule would beat a fill attribute.
      for (const node of v.lit) { node.style.fill = colour; if (!node.classList.contains("ms-body")) node.style.stroke = edge; }
      v.glow.setAttribute("fill", level > 0.05 ? `rgb(${rgb.map(c => Math.round(c * 255)).join(",")})` : "transparent");
      v.glow.setAttribute("opacity", (0.06 + level * 0.22).toFixed(3));
      const pct = Math.round(level * 100);
      v.lvl.textContent = v.kind === "fogger" || v.kind === "hazer" ? "" : pct >= 100 ? "FL" : pct > 0 ? String(pct) : "--";
      v.lvl.classList.toggle("on", pct > 0);
      v.g.classList.toggle("ms-sel", isSel);
    }
  }

  function tick() {
    if (installPage() && root.classList.contains("active")) {
      rebuild();
      renderGroups();
      paint();
    }
  }
  setInterval(tick, 60);
  window.addEventListener("resize", () => { layoutKey = null; });

  window.MagicSheet = Object.freeze({ refresh: () => { layoutKey = null; tick(); } });
})();
