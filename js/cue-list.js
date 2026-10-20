"use strict";

/*
 * Cue List window: the show's cues as a proper table.
 *
 *   green  = live (with a bar while it fades in)
 *   amber  = next — what GO fires. Click any cue to make it next.
 *
 * Double-click a name, fade or follow to edit it there. Drag a row to move
 * the cue. Right-click a cue for Go, Make next, Update from stage, Copy,
 * Delete. GO / BACK at the top.
 *
 * The chosen next cue (State.nextCue) is used by every GO: the GO button,
 * the command line, the GO key, the phone remote and QLab Connect.
 */
(function () {
  if (window.LXCueList) return;

  const S = () => window.State;
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;
  const secs = ms => { const s = Math.max(0, Number(ms) || 0) / 1000; return s === Math.round(s) ? `${s}` : s.toFixed(1); };
  let running = null; // { index, start, fade } of the cue fading in now

  // ------------------------------------------------------------ next cue

  function defaultNext() {
    const s = S();
    let n = (s.currentCue ?? -1) + 1;
    while (n < (s.cues?.length || 0) && !s.cues[n]) n++;
    return s.cues?.[n] ? n : -1;
  }
  // The cue chosen as next, or -1. (Careful: Number(null) is 0, i.e. cue 1.)
  function chosenNext() {
    const s = S();
    return s.nextCue == null || s.nextCue === "" ? -1 : Number(s.nextCue);
  }
  function nextIndex() {
    const s = S();
    const chosen = chosenNext();
    if (Number.isInteger(chosen) && chosen >= 0 && s.cues?.[chosen] && chosen !== s.currentCue) return chosen;
    return defaultNext();
  }
  function setNext(index) {
    const s = S();
    const before = nextIndex();
    s.nextCue = Number.isInteger(index) && s.cues?.[index] ? index : null;
    refreshAll();
    if (s.nextCue != null && before !== index) window.log?.(`Next: cue ${index + 1} “${s.cues[index].name || `Cue ${index + 1}`}” — press GO`, "info");
  }

  function hookEngine() {
    // GO fires the chosen next cue.
    if (typeof window.goNextCue === "function" && !window.goNextCue.__lxCueList) {
      const original = window.goNextCue;
      const wrapped = function (forceFade = null) {
        const s = S();
        const chosen = chosenNext();
        s.nextCue = null;
        if (Number.isInteger(chosen) && s.cues?.[chosen] && chosen !== s.currentCue) return window.goToCue(chosen, forceFade);
        return original.apply(this, arguments);
      };
      wrapped.__lxCueList = true;
      window.goNextCue = wrapped;
    }
    // Know when a cue starts, for the progress bar.
    if (typeof window.goToCue === "function" && !window.goToCue.__lxCueListGo) {
      const original = window.goToCue;
      const wrapped = function (index, forceFade = null) {
        const cue = S().cues?.[index];
        const result = original.apply(this, arguments);
        if (result && cue) {
          running = { index: Number(index), start: performance.now(), fade: forceFade != null ? Number(forceFade) : Number(cue.fade ?? 800) };
          if (chosenNext() === Number(index)) S().nextCue = null;
        }
        refreshAll();
        return result;
      };
      Object.assign(wrapped, original); // keep other wrappers' markers
      wrapped.__lxCueListGo = true;
      window.goToCue = wrapped;
    }
    // The bottom-bar cue stack shows next in amber too.
    if (typeof window.renderCues === "function" && !window.renderCues.__lxCueList) {
      const original = window.renderCues;
      const wrapped = function () { const r = original.apply(this, arguments); markStack(); render(); return r; };
      wrapped.__lxCueList = true;
      window.renderCues = wrapped;
    }
  }

  function markStack() {
    const next = nextIndex();
    document.querySelectorAll("#cueList .cue-item").forEach((el, i) => el.classList.toggle("next", i === next));
  }
  function refreshAll() { markStack(); render(); }

  // --------------------------------------------------------------- window

  let body = null, timer = null;

  function build(host) {
    body = host;
    host.innerHTML = `
      <div class="cl">
        <div class="cl-top">
          <div class="cl-status"><div><span class="cl-tag live">LIVE</span><b data-k="live">—</b></div><div><span class="cl-tag next">NEXT</span><b data-k="next">—</b></div></div>
          <div class="cl-buttons">
            <button type="button" class="btn-secondary" data-cl="back" title="Previous cue">◀ BACK</button>
            <button type="button" class="cl-go" data-cl="go" title="Fire the next cue">GO</button>
          </div>
        </div>
        <div class="cl-head"><span></span><span>#</span><span title="T = tracked (stores only changes) · B = block (stores the whole look)">Mode</span><span>Name</span><span>Fade</span><span>Follow</span><span title="Timecode: when timecode passes this time, the cue fires">TC</span><span class="cl-fxh">Effect</span></div>
        <div class="cl-rows"></div>
        <div class="cl-foot">
          <button type="button" class="btn-secondary" data-cl="record">＋ Record next cue</button>
          <button type="button" class="btn-secondary" data-cl="update" title="Save the stage into the live cue">Update live cue</button>
          <button type="button" class="btn-secondary" data-cl="clear" title="Drop everything set by hand and go back to the live cue">⨯ Clear programmer</button>
          <span>Click a cue to make it next · double-click to edit · drag to move · right-click for more</span>
        </div>
      </div>`;
    host.addEventListener("click", e => {
      const b = e.target.closest("[data-cl]");
      if (b) {
        const a = b.dataset.cl;
        if (a === "go") window.parseCommand?.("go");
        else if (a === "back") window.parseCommand?.("back");
        else if (a === "clear") window.parseCommand?.("clear programmer");
        else if (a === "record") document.getElementById("btnRecordCue")?.click();
        else if (a === "update") { const s = S(); if (s.currentCue >= 0) window.parseCommand?.(`update cue ${s.currentCue + 1}`); else window.log?.("No cue is live to update", "warn"); }
        return;
      }
      const row = e.target.closest(".cl-row");
      if (row && !e.target.closest("input")) setNext(Number(row.dataset.i));
    });
    host.addEventListener("dblclick", e => {
      const row = e.target.closest(".cl-row");
      if (row && pref("clDoubleClick", "edit") === "go") return window.parseCommand?.(`go ${Number(row.dataset.i) + 1}`);
      const cell = e.target.closest("[data-edit]");
      if (cell) edit(cell);
    });
    host.addEventListener("contextmenu", e => {
      const row = e.target.closest(".cl-row");
      if (!row) return;
      e.preventDefault();
      rowMenu(Number(row.dataset.i), e.clientX, e.clientY);
    });
    wireDrag(host.querySelector(".cl-rows"));
    render();
    clearInterval(timer);
    timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); timer = null; body = null; return; } render(); }, 100);
  }

  // Rows are rebuilt only when the list itself changes; otherwise just
  // classes, text and the progress bar are touched.
  function render() {
    if (!body) return;
    const s = S();
    const cues = s.cues || [];
    const rows = body.querySelector(".cl-rows");
    const mib = window.LXMoveInBlack?.status();
    const mibOn = pref("mib", true) !== false;
    const key = cues.map((c, i) => (c ? `${c.name}|${c.fade}|${c.follow}|${c.followEnabled}|${c.effect?.name || c.effect?.type || ""}|${c.mode}|${c.fixtureStates?.length}|${c.timecode ?? ""}|${c.noMib}|${mib?.cue === i ? mib.ids.length : ""}` : "·")).join("¦") + `|${mibOn}`;
    const modeTag = (c, i) => {
      const tags = [c.mode === "track" ? `<b class="cl-mode t" title="Tracked: stores only what changed (${c.fixtureStates?.length || 0} lights)">T</b>` : `<b class="cl-mode b" title="Block: stores the whole look">B</b>`];
      if (c.noMib && mibOn) tags.push('<b class="cl-mib off" title="Move in black is off for this cue">MIB</b>');
      else if (mibOn && mib?.cue === i && mib.ids.length) tags.push(`<b class="cl-mib" title="${mib.ids.length} light${mib.ids.length === 1 ? "" : "s"} preset in the dark for this cue">MIB</b>`);
      return tags.join("");
    };
    if (rows.dataset.key !== key && !rows.querySelector("input")) {
      rows.innerHTML = cues.map((c, i) => c ? `
        <div class="cl-row" data-i="${i}" draggable="true">
          <span class="cl-dot"></span><span class="cl-num">${i + 1}</span><span class="cl-tags">${modeTag(c, i)}</span>
          <span data-edit="name">${esc(c.name || `Cue ${i + 1}`)}</span>
          <span data-edit="fade">${secs(c.fade ?? 800)} s</span>
          <span data-edit="follow">${c.followEnabled ? `${secs((c.follow || 0) * 1000)} s` : "—"}</span>
          <span data-edit="tc" class="cl-tc">${Number.isFinite(c.timecode) ? window.LXTimecode?.format(c.timecode) ?? "" : "—"}</span>
          <span class="cl-fx">${esc(c.effect ? c.effect.name || c.effect.type : "")}</span>
          <i class="cl-progress"></i>
        </div>` : "").join("") || '<div class="cl-empty">No cues yet. Set a look and press ＋ Record next cue.</div>';
      rows.dataset.key = key;
    }
    const cl = body.querySelector(".cl");
    cl.classList.toggle("big-go", pref("clBigGo", false) === true);
    cl.classList.toggle("no-fx", pref("clShowEffect", true) === false);
    cl.classList.toggle("no-mode", pref("clShowMode", true) === false);
    const live = s.currentCue, next = nextIndex();
    rows.querySelectorAll(".cl-row").forEach(row => {
      const i = Number(row.dataset.i);
      row.classList.toggle("live", i === live);
      row.classList.toggle("next", i === next);
      row.classList.toggle("chosen", i === next && chosenNext() === i);
      const bar = row.querySelector(".cl-progress");
      let p = 0;
      if (i === live && running?.index === i && running.fade > 0) p = Math.min(1, (performance.now() - running.start) / running.fade);
      const w = p > 0 && p < 1 ? `${(p * 100).toFixed(1)}%` : "0%";
      if (bar.style.width !== w) bar.style.width = w;
    });
    const label = i => (cues[i] ? `${i + 1} · ${cues[i].name || `Cue ${i + 1}`}` : "—");
    const liveEl = body.querySelector('[data-k="live"]'), nextEl = body.querySelector('[data-k="next"]');
    const fading = running && running.index === live && performance.now() - running.start < running.fade;
    const liveText = live >= 0 ? `${label(live)}${fading ? `  ·  fading ${Math.round((performance.now() - running.start) / running.fade * 100)}%` : ""}` : "nothing yet";
    if (liveEl.textContent !== liveText) liveEl.textContent = liveText;
    const nextText = next >= 0 ? label(next) : "end of the list";
    if (nextEl.textContent !== nextText) nextEl.textContent = nextText;
    // Keep the live cue in view as the show runs.
    if (live !== rows.__live) { rows.__live = live; rows.querySelector(`.cl-row[data-i="${live}"]`)?.scrollIntoView({ block: "nearest" }); }
  }

  // ---------------------------------------------------------------- edit

  function edit(cell) {
    const row = cell.closest(".cl-row");
    const i = Number(row.dataset.i), cue = S().cues[i], field = cell.dataset.edit;
    if (!cue || cell.querySelector("input")) return;
    const value = field === "name" ? cue.name : field === "fade" ? secs(cue.fade ?? 800) : field === "tc" ? (Number.isFinite(cue.timecode) ? window.LXTimecode?.format(cue.timecode) ?? "" : "") : cue.followEnabled ? secs((cue.follow || 0) * 1000) : "";
    cell.innerHTML = `<input class="cl-input" value="${esc(value)}" ${field === "name" ? "" : field === "tc" ? 'placeholder="00:00:00:00"' : 'inputmode="decimal" placeholder="off"'}>`;
    const input = cell.firstElementChild;
    input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      if (save) {
        const v = input.value.trim();
        if (field === "name") cue.name = v || `Cue ${i + 1}`;
        else if (field === "fade") { const n = Number(v); if (Number.isFinite(n) && n >= 0) cue.fade = Math.round(n * 1000); }
        else if (field === "tc") { if (!v || /^(off|none|—)$/i.test(v)) delete cue.timecode; else { const t = window.LXTimecode?.parse(v); if (t != null) cue.timecode = t; } }
        else if (!v || /^off$/i.test(v)) { cue.followEnabled = false; cue.follow = 0; }
        else { const n = Number(v); if (Number.isFinite(n) && n >= 0) { cue.follow = n; cue.followEnabled = true; } }
        window.log?.(`Cue ${i + 1} ${field === "tc" ? "timecode" : field} → ${field === "name" ? cue.name : field === "fade" ? `${secs(cue.fade)} s` : field === "tc" ? (Number.isFinite(cue.timecode) ? window.LXTimecode.format(cue.timecode) : "none") : cue.followEnabled ? `${cue.follow} s` : "off"}`, "ok");
      }
      // Take the box away (and its keyboard focus) before redrawing.
      input.remove();
      cell.textContent = field === "name" ? cue.name : field === "fade" ? `${secs(cue.fade ?? 800)} s` : field === "tc" ? (Number.isFinite(cue.timecode) ? window.LXTimecode?.format(cue.timecode) ?? "" : "—") : cue.followEnabled ? `${secs((cue.follow || 0) * 1000)} s` : "—";
      body.querySelector(".cl-rows").dataset.key = "";
      window.renderCues?.();
      window.updateInspectorList?.();
      render();
    };
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
  }

  // ---------------------------------------------------------------- drag

  function wireDrag(rows) {
    let from = null;
    rows.addEventListener("dragstart", e => { const row = e.target.closest(".cl-row"); if (!row) return; from = Number(row.dataset.i); e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
    rows.addEventListener("dragend", () => { rows.querySelectorAll(".dragging, .drop").forEach(el => el.classList.remove("dragging", "drop")); from = null; });
    rows.addEventListener("dragover", e => { if (from == null) return; e.preventDefault(); rows.querySelectorAll(".drop").forEach(el => el.classList.remove("drop")); e.target.closest(".cl-row")?.classList.add("drop"); });
    rows.addEventListener("drop", e => {
      e.preventDefault();
      const row = e.target.closest(".cl-row");
      if (from == null || !row) return;
      const to = Number(row.dataset.i);
      if (to !== from) window.parseCommand?.(`move cue ${from + 1} to ${to + 1}`);
      from = null;
    });
  }

  // ---------------------------------------------------------- right-click

  function rowMenu(i, x, y) {
    document.querySelector(".cl-menu")?.remove();
    const cue = S().cues[i];
    if (!cue) return;
    const menu = document.createElement("div");
    menu.className = "lxw-menu cl-menu";
    const tracked = cue.mode === "track";
    const items = [["go", "Go to this cue now"], ["next", "Make it next"], "-", ["update", "Update from the stage"], ["insert", "Insert into Control Deck"], ["tcnow", "Set its time to the timecode now"], ["rename", "Rename…"], ["copy", "Copy to the end"], "-",
      ["block", "Block cue (stores its whole look)", !tracked], ["mib", "Move in black before this cue", !cue.noMib], "-", ["delete", "Delete…"]];
    menu.innerHTML = `<div class="lxw-menu-label">CUE ${i + 1} · ${esc(cue.name || "")}</div>${items.map(it => it === "-" ? "<hr>" : `<button type="button" data-a="${it[0]}"><span class="tick">${it[2] ? "✓" : ""}</span><span>${it[1]}</span><kbd></kbd></button>`).join("")}`;
    document.body.appendChild(menu);
    menu.style.left = `${Math.min(x, innerWidth - 250)}px`;
    menu.style.top = `${Math.min(y, innerHeight - 260)}px`;
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
    menu.addEventListener("click", async e => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      menu.remove();
      document.removeEventListener("pointerdown", close, true);
      const n = i + 1, a = b.dataset.a;
      if (a === "go") window.parseCommand?.(`go ${n}`);
      else if (a === "next") setNext(i);
      else if (a === "update") window.parseCommand?.(`update cue ${n}`);
      else if (a === "rename") {
        const r = await window.LXAsk?.(`Rename cue ${n}`, [{ key: "name", label: "Name", value: cue.name || "" }], { ok: "Rename" });
        if (r) window.parseCommand?.(`rename cue ${n} ${r.name.trim() || `Cue ${n}`}`);
      } else if (a === "copy") window.parseCommand?.(`copy cue ${n} to ${S().cues.length + 1}`);
      else if (a === "insert") window.LXDeck?.insertCue(i);
      else if (a === "tcnow") { const t = window.LXTimecode?.now(); if (t == null) window.log?.("No timecode yet — start the source first", "warn"); else { window.LXTimecode.setCue(i, t); window.log?.(`Cue ${n} fires at ${window.LXTimecode.format(t)}`, "ok"); } }
      else if (a === "block") window.parseCommand?.(`${tracked ? "block" : "track"} cue ${n}`);
      else if (a === "mib") {
        cue.noMib = !cue.noMib;
        window.log?.(`Move in black ${cue.noMib ? "off" : "on"} for cue ${n}`, "ok");
        if (cue.noMib && window.LXMoveInBlack?.status()?.cue === i) window.LXMoveInBlack.stop();
        render();
      } else if (a === "delete") {
        if (pref("clConfirmDelete", true) === false) return window.parseCommand?.(`delete cue ${n}`);
        const r = await window.LXAsk?.(`Delete cue ${n}?`, [], { ok: "Delete", message: `“${cue.name || `Cue ${n}`}” will be removed from the cue list.` });
        if (r) window.parseCommand?.(`delete cue ${n}`);
      }
    });
  }

  // ---------------------------------------------------------------- styles

  function injectStyles() {
    if (document.getElementById("lxCueListStyles")) return;
    const style = document.createElement("style");
    style.id = "lxCueListStyles";
    style.textContent = `
      .cl{display:flex;flex-direction:column;height:100%;min-height:0}
      .cl-top{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);background:#0e1519}
      .cl-status{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;font-family:var(--mono);font-size:12px}
      .cl-status div{display:flex;align-items:center;gap:8px;min-width:0}
      .cl-status b{font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cl-tag{flex:none;width:44px;text-align:center;padding:2px 0;border-radius:3px;font-size:9px;font-weight:900;letter-spacing:1px}
      .cl-tag.live{background:rgba(74,201,108,.18);color:#6fe08e}
      .cl-tag.next{background:rgba(255,180,84,.16);color:#ffc46e}
      .cl-buttons{display:flex;gap:6px;align-items:center}
      .cl-buttons .btn-secondary{height:40px}
      .cl-go{height:40px;min-width:92px;border:0;border-radius:6px;background:#2fbf63;color:#04140a;font-size:16px;font-weight:900;letter-spacing:2px;cursor:pointer;box-shadow:0 0 0 1px rgba(255,255,255,.08) inset}
      .cl-go:hover{background:#39d672}
      .cl-go:active{transform:translateY(1px)}
      .cl-head,.cl-row{display:grid;grid-template-columns:16px 34px 54px minmax(0,1fr) 60px 64px 92px minmax(0,.6fr);gap:8px;align-items:center;padding:0 10px}
      .cl-head{height:24px;border-bottom:1px solid var(--border);color:#5d6b68;font-size:9px;font-weight:850;letter-spacing:1.1px;text-transform:uppercase}
      .cl-rows{flex:1 1 auto;min-height:0;overflow:auto}
      .cl-row{position:relative;height:30px;border-bottom:1px solid #141c20;color:#b9c5c2;font-size:12px;cursor:pointer;user-select:none}
      .cl-row:hover{background:#121b20}
      .cl-row > span{position:relative;z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cl-num{font-family:var(--mono);color:#8c9a97}
      .cl-fx{color:#e24fd0;font-size:10.5px}
      .cl-dot{width:8px;height:8px;border-radius:50%;background:transparent}
      .cl-row.live{background:rgba(47,191,99,.14);color:#e9fff0;box-shadow:inset 3px 0 0 #2fbf63}
      .cl-row.live .cl-dot{background:#2fbf63;box-shadow:0 0 8px #2fbf63}
      .cl-row.next{background:rgba(255,173,31,.12);color:#fff2da;box-shadow:inset 3px 0 0 #ffad1f}
      .cl-row.next .cl-dot{border:2px solid #ffad1f;width:6px;height:6px}
      .cl-row.chosen .cl-num::after{content:" ★";color:#ffad1f}
      .cl-progress{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(47,191,99,.22);pointer-events:none}
      .cl-tags{display:flex;gap:3px}
      .cl-mode,.cl-mib{display:inline-block;padding:1px 4px;border-radius:3px;font-size:8.5px;font-weight:900;letter-spacing:.6px;line-height:12px}
      .cl-mode.t{background:rgba(92,168,255,.16);color:#8bc5ff}
      .cl-mode.b{background:rgba(255,255,255,.07);color:#9aa8a5}
      .cl-mib{background:rgba(155,123,255,.2);color:#c7b6ff}
      .cl-mib.off{background:transparent;color:#5d6b68;text-decoration:line-through}
      .cl.no-fx .cl-head,.cl.no-fx .cl-row{grid-template-columns:16px 34px 54px minmax(0,1fr) 60px 64px 92px}
      .cl-tc{font-family:var(--mono);font-size:11px;color:#ffd27a}
      .cl.no-fx .cl-fx,.cl.no-fx .cl-fxh{display:none}
      .cl.no-mode .cl-mode{display:none}
      .cl.big-go .cl-go{height:64px;min-width:150px;font-size:24px}
      .cl.big-go .cl-buttons .btn-secondary{height:64px}
      .cl-row.dragging{opacity:.4}
      .cl-row.drop{box-shadow:inset 0 2px 0 var(--accent)}
      .cl-input{width:100%;height:22px;padding:0 6px;background:#0a1013;border:1px solid var(--accent-line);border-radius:3px;color:var(--text);font-size:12px;user-select:text}
      .cl-empty{padding:26px;text-align:center;color:#6f7d7a;font-size:12px}
      .cl-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 10px;border-top:1px solid var(--border)}
      .cl-foot span{margin-left:auto;color:#5d6b68;font-size:10px}
      #cueList .cue-item.next{box-shadow:inset 3px 0 0 #ffad1f;background:rgba(255,173,31,.10)}
    `;
    document.head.appendChild(style);
  }

  function boot(tries = 0) {
    injectStyles();
    hookEngine();
    if (window.LXWindows && !window.LXWindows.list().includes("cuelist")) window.LXWindows.register({ id: "cuelist", title: "Cue List", build, w: 620, h: 460 });
    const ready = window.LXWindows && window.goNextCue?.__lxCueList && window.goToCue?.__lxCueListGo && window.renderCues?.__lxCueList;
    if (!ready && tries < 40) setTimeout(() => boot(tries + 1), 250);
    else markStack();
  }
  window.addEventListener("load", () => setTimeout(boot, 500));

  window.LXCueList = Object.freeze({ open: () => window.LXWindows?.open("cuelist"), setNext, next: nextIndex });
})();
