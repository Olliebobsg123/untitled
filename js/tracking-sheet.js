"use strict";

/*
 * Tracking sheet: cues across the top, lights down the side, each light's
 * level (and colour) in every cue. A level the cue changes is bright (green
 * going up, pink going down); one carried on from an earlier cue is dim.
 * Lights no cue ever brings up are flagged, so "fixture 9 is never used"
 * jumps out. Click a cell to open that cue in the inspector.
 *
 * Windows → Tracking Sheet, or "tracking sheet" on the command line.
 */
(function () {
  if (window.LXTrackingSheet) return;
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let host = null, timer = null, lastKey = "", unusedOnly = false;

  const level = st => {
    const v = Number(st?.intensity);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  };
  const shown = v => (v >= 100 ? "FL" : v <= 0 ? "" : String(v));
  // The light's colour in the cue, for a swatch (null: white or no colour).
  function colourOf(st, f) {
    if (!st || (window.canColour && !window.canColour(f))) return null;
    if ([st.r, st.g, st.b].some(v => Number.isFinite(Number(v)) && Number(v) > 0) && ![st.r, st.g, st.b].every(v => Number(v) === Number(st.r))) return `rgb(${Number(st.r) || 0},${Number(st.g) || 0},${Number(st.b) || 0})`;
    const sat = Number(st.sat);
    if (Number.isFinite(Number(st.hue)) && sat > 5) return `hsl(${Number(st.hue)},${Math.min(100, sat)}%,${Math.max(25, Math.min(70, Number(st.light) || 50))}%)`;
    return null;
  }

  // Every light's level in every cue, and what each cue changed.
  function compute() {
    const s = S();
    const fixtures = (s.fixtures || []).filter(f => f && f.id != null);
    const cues = (s.cues || []).map((c, i) => c && { c, i }).filter(Boolean);
    const rows = new Map(fixtures.map(f => [f.id, { f, cells: [], max: 0 }]));
    let prev = new Map();
    for (const { c, i } of cues) {
      const look = typeof window.cueLook === "function" ? window.cueLook(i).fixtureMap : new Map();
      const own = new Set((c.fixtureStates || []).filter(e => Array.isArray(e) && e[1] && "intensity" in e[1]).map(e => e[0]));
      for (const f of fixtures) {
        const row = rows.get(f.id), st = look.get(f.id), v = level(st), was = level(prev.get(f.id));
        const changed = c.mode === "track" ? own.has(f.id) && v !== was : v !== was;
        row.cells.push({ v, changed, dir: changed ? (v > was ? "up" : "down") : "", colour: v > 0 ? colourOf(st, f) : null });
        row.max = Math.max(row.max, v);
      }
      prev = look;
    }
    return { fixtures, cues, rows: [...rows.values()] };
  }

  function render(force = false) {
    if (!host?.isConnected) { clearInterval(timer); timer = null; return; }
    const s = S();
    // Only redraw when the cues or patch changed.
    const key = JSON.stringify([(s.cues || []).map(c => c && [c.number, c.name, c.mode, (c.fixtureStates || []).length, JSON.stringify(c.fixtureStates || []).length]), (s.fixtures || []).map(f => f?.id), s.currentCue, unusedOnly]);
    if (!force && key === lastKey) return;
    lastKey = key;
    const { cues, rows } = compute();
    const unused = rows.filter(r => r.max === 0);
    const list = unusedOnly ? unused : rows;
    const label = f => esc(f.label || f.customName || f.name || "");
    const live = s.currentCue;
    host.innerHTML = `
      <div class="ts">
        <div class="ts-top">
          <span>${rows.length} light${rows.length === 1 ? "" : "s"} · ${cues.length} cue${cues.length === 1 ? "" : "s"}</span>
          ${unused.length ? `<span class="ts-warn">⚠ ${unused.length} never used: ${unused.slice(0, 12).map(r => esc(r.f.fixtureNumber ?? "?")).join(", ")}${unused.length > 12 ? "…" : ""}</span>` : cues.length ? `<span class="ts-ok">Every light is used</span>` : ""}
          <label class="ts-only"><input type="checkbox" data-ts="unused"${unusedOnly ? " checked" : ""}> Only unused</label>
          <span class="ts-key"><i class="up"></i>up <i class="down"></i>down <i class="trk"></i>tracked</span>
        </div>
        ${!cues.length ? `<div class="ts-empty">No cues yet — record some and they appear here.</div>` : `
        <div class="ts-scroll"><table>
          <thead><tr><th class="ts-fix">Light</th>${cues.map(({ c, i }) => `<th class="${i === live ? "live" : ""}" title="${esc(c.name || "")}" data-cue="${i}">${esc(window.cueLabel ? window.cueLabel(i) : c.number)}</th>`).join("")}</tr></thead>
          <tbody>${list.map(r => `<tr class="${r.max === 0 ? "unused" : ""}"><th class="ts-fix" title="${label(r.f)}"><b>${esc(r.f.fixtureNumber ?? "")}</b> ${label(r.f)}</th>${r.cells.map((cell, n) => `<td data-cue="${cues[n].i}" data-fix="${esc(r.f.id)}" class="${cell.changed ? cell.dir : cell.v ? "trk" : ""}${cues[n].i === live ? " live" : ""}">${cell.colour ? `<i style="background:${cell.colour}"></i>` : ""}${shown(cell.v)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>`}
      </div>`;
    host.querySelector('[data-ts="unused"]')?.addEventListener("change", e => { unusedOnly = e.target.checked; render(true); });
  }

  function build(el) {
    host = el;
    lastKey = "";
    render(true);
    el.addEventListener("click", e => {
      const cell = e.target.closest("[data-cue]");
      if (!cell) return;
      const i = Number(cell.dataset.cue);
      window.LXCueInspector?.focus?.(i);
      window.log?.(`Cue ${window.cueLabel ? window.cueLabel(i) : i + 1}${cell.dataset.fix ? ` — light ${S().fixtures.find(f => String(f.id) === cell.dataset.fix)?.fixtureNumber ?? ""}` : ""}`, "ok");
    });
    clearInterval(timer);
    timer = setInterval(() => render(), 1000);
  }

  function open() { window.LXWindows?.open("tracking"); }

  function command(c) {
    if (c === "tracking sheet" || c === "track sheet" || c === "tracksheet") { open(); return true; }
    return false;
  }

  function install(tries = 0) {
    if (!window.LXWindows?.register) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if (!window.LXWindows.list().includes("tracking")) window.LXWindows.register({ id: "tracking", title: "Tracking Sheet", build, w: 760, h: 460 });
    if (!document.getElementById("lxTsStyles")) {
      const st = document.createElement("style");
      st.id = "lxTsStyles";
      st.textContent = `.ts{display:flex;flex-direction:column;height:100%;min-height:0;font-size:14px;color:#c6d0ce}
.ts-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:8px 10px;border-bottom:1px solid var(--border,#1d262b)}
.ts-warn{color:#ffb4a4;font-weight:700}.ts-ok{color:#7fdcb2}.ts-only{display:flex;align-items:center;gap:5px;margin-left:auto}
.ts-key{display:flex;align-items:center;gap:4px;color:#a5adac;font-size:13px}.ts-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-left:6px}
.ts-key .up{background:#1f7a52}.ts-key .down{background:#8a2c62}.ts-key .trk{background:#26323a}
.ts-empty{padding:24px;color:#a5adac}
.ts-scroll{flex:1;min-height:0;overflow:auto}
.ts table{border-collapse:separate;border-spacing:0;font:14px var(--mono,monospace)}
.ts th,.ts td{padding:3px 6px;border-right:1px solid #161d21;border-bottom:1px solid #161d21;text-align:center;white-space:nowrap;min-width:34px}
.ts thead th{position:sticky;top:0;z-index:2;background:#11181c;color:#9fb0ac;cursor:pointer}
.ts thead th.live{color:var(--accent,#19d6a3)}
.ts .ts-fix{position:sticky;left:0;z-index:1;background:#0d1316;text-align:left;max-width:190px;overflow:hidden;text-overflow:ellipsis;font-family:inherit;font-weight:400;color:#c6d0ce}
.ts thead .ts-fix{z-index:3}
.ts td{cursor:pointer;color:#9da9a7;position:relative}
.ts td.trk{color:#93a19e}
.ts td.up{background:rgba(31,122,82,.35);color:#c9f5df;font-weight:700}
.ts td.down{background:rgba(138,44,98,.35);color:#ffd1ec;font-weight:700}
.ts td.live{box-shadow:inset 1px 0 0 var(--accent,#19d6a3),inset -1px 0 0 var(--accent,#19d6a3)}
.ts td i{position:absolute;left:2px;top:3px;bottom:3px;width:3px;border-radius:2px}
.ts td:hover{outline:1px solid #3b4a50}
.ts tr.unused .ts-fix{color:#ffb4a4}.ts tr.unused td{background:rgba(120,40,30,.12)}`;
      document.head.appendChild(st);
    }
  }

  window.LXTrackingSheet = { open, compute, command };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
