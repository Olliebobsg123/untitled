"use strict";

/*
 * Show tools:
 *   GO note        the next cue's GO note, big beside the GO button.
 *   Clean up show  removes what points at lights that aren't patched any
 *                  more (in cues, effects, palettes, groups), and colour
 *                  stored on lights that can't change colour.
 *                  Command: clean up show
 *   Cue sheet      number, name, timing, follow, GO note and notes on a
 *                  page to print for the operator. Command: cue sheet
 *   Update choice  update cue 5 cue only  (the cues after keep their look)
 *                  update cue 5 track     (changes carry on into them)
 */
(function () {
  if (window.LXShowTools) return;
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const secs = ms => { const n = Math.round((Number(ms) || 0) / 100) / 10; return String(n); };
  const say = (m, l = "ok") => window.log?.(m, l);

  // ------------------------------------------------------------ GO note

  function nextIndex() {
    const n = window.LXCueList?.next?.();
    if (Number.isInteger(n)) return n;
    return typeof window.peekNextCue === "function" ? window.peekNextCue() : -1;
  }
  function goNoteTick() {
    const header = document.querySelector(".bottom-row .panel.cues .panel-header");
    if (!header) return;
    let el = document.getElementById("lxGoNote");
    if (!el) {
      el = document.createElement("div");
      el.id = "lxGoNote";
      el.className = "lx-gonote";
      header.firstElementChild?.after(el);
    }
    const i = nextIndex();
    const note = i >= 0 ? String(S().cues?.[i]?.goNote || "") : "";
    const text = note ? `GO: ${note}` : "";
    if (el.textContent !== text) { el.textContent = text; el.hidden = !text; el.title = text ? `Cue ${window.cueLabel?.(i)} goes on this` : ""; }
  }

  // ------------------------------------------------------- clean up show

  const COLOUR = ["hue", "sat", "light", "r", "g", "b", "w", "amber", "a", "lime", "uv", "cyan", "magenta", "yellow", "colour", "colourr", "colourSlot", "colourSlotFor", "blueMix", "amberMix", "magentaMix", "colmacro", "cto", "cct", "warmWhite", "naturalWhite", "coolWhite"];
  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const colourCapable = f => COLOUR.filter(k => !["hue", "sat", "light", "colourSlot", "colourSlotFor"].includes(k)).some(k => typeof defOf(f).map?.[k] === "number");

  // What would go; with apply, takes it out.
  function cleanUp(apply = false) {
    const s = S();
    const fixtures = s.fixtures || [];
    const ids = new Set(fixtures.map(f => String(f.id)));
    const numbers = new Set(fixtures.map(f => String(f.fixtureNumber)));
    const noColour = new Set(fixtures.filter(f => !colourCapable(f)).map(f => String(f.id)));
    const known = v => ids.has(String(v)) || numbers.has(String(v));
    const n = { cueLights: 0, colour: 0, effects: 0, palettes: 0, groups: 0, states: 0 };
    const cleanStates = list => {
      if (!Array.isArray(list)) return list;
      const out = [];
      for (const entry of list) {
        const [id, st] = entry || [];
        if (!ids.has(String(id))) { n.cueLights++; continue; }
        if (noColour.has(String(id)) && st && COLOUR.some(k => k in st)) {
          n.colour++;
          if (apply) { const c = { ...st }; COLOUR.forEach(k => delete c[k]); out.push([id, c]); continue; }
        }
        out.push(entry);
      }
      return out;
    };
    const cleanEffect = e => {
      if (!e || !Array.isArray(e.fixtureIds)) return e;
      const keep = e.fixtureIds.filter(known);
      n.effects += e.fixtureIds.length - keep.length;
      return apply ? { ...e, fixtureIds: keep } : e;
    };
    (s.cues || []).forEach(cue => {
      if (!cue) return;
      const states = cleanStates(cue.fixtureStates);
      if (apply) cue.fixtureStates = states;
      if (cue.effect) { const e = cleanEffect(cue.effect); if (apply) cue.effect = e?.fixtureIds?.length ? e : null; }
      if (Array.isArray(cue.effects)) { const list = cue.effects.map(cleanEffect); if (apply) cue.effects = list.filter(e => e?.fixtureIds?.length); }
    });
    Object.entries(s.savedEffects || {}).forEach(([name, e]) => { const c = cleanEffect(e); if (apply) s.savedEffects[name] = c; });
    (s.palettes || []).forEach(p => {
      if (Array.isArray(p?.fixtures)) { const keep = p.fixtures.filter(known); n.palettes += p.fixtures.length - keep.length; if (apply) p.fixtures = keep; }
      if (p?.perFixture && typeof p.perFixture === "object") for (const id of Object.keys(p.perFixture)) if (!known(id)) { n.palettes++; if (apply) delete p.perFixture[id]; }
    });
    (s.groups || []).forEach(g => { if (Array.isArray(g?.members)) { const keep = g.members.filter(known); n.groups += g.members.length - keep.length; if (apply) g.members = keep; } });
    if (s.fixtureStates instanceof Map) for (const id of [...s.fixtureStates.keys()]) {
      if (!ids.has(String(id))) { n.states++; if (apply) s.fixtureStates.delete(id); }
      else if (noColour.has(String(id))) { const st = s.fixtureStates.get(id); if (st && COLOUR.some(k => k in st)) { n.colour++; if (apply) COLOUR.forEach(k => delete st[k]); } }
    }
    return n;
  }

  async function cleanUpShow() {
    const n = cleanUp(false);
    const total = Object.values(n).reduce((a, b) => a + b, 0);
    if (!total) return say("Nothing to clean up — every cue, effect, palette and group only uses lights that are patched", "ok");
    const lines = [
      n.cueLights && `${n.cueLights} light${n.cueLights === 1 ? "" : "s"} in cues that aren't patched any more`,
      n.colour && `${n.colour} colour setting${n.colour === 1 ? "" : "s"} on lights that can't change colour`,
      n.effects && `${n.effects} light${n.effects === 1 ? "" : "s"} in effects that aren't patched`,
      n.palettes && `${n.palettes} in palettes`, n.groups && `${n.groups} in groups`, n.states && `${n.states} leftover light state${n.states === 1 ? "" : "s"}`
    ].filter(Boolean);
    const ok = await window.LXAsk?.("Clean up show", [], { ok: "Clean up", message: `This removes:\n• ${lines.join("\n• ")}\n\nSave first if you want to keep a copy as it is. Nothing a patched light does on stage changes.` });
    if (!ok) return;
    cleanUp(true);
    window.rememberLooks?.();
    window.renderCues?.(); window.renderGroups?.(); window.LXCueList?.refresh?.(); window.updateInspectorList?.();
    window.updateDMX?.();
    say(`Show cleaned up: ${lines.join(", ")}`, "ok");
  }

  // ------------------------------------------------------------ cue sheet

  function cueSheet({ print = true } = {}) {
    const s = S();
    const cues = (s.cues || []).map((c, i) => c && { c, i }).filter(Boolean);
    if (!cues.length) return say("No cues to print yet", "warn");
    const name = window.LXShowCommands?.name?.() || "Light Spark show";
    const timing = c => {
      const parts = [`${secs(c.fade ?? 800)}s`];
      if (c.delay) parts.push(`delay ${secs(c.delay)}s`);
      if (c.timing?.split) parts.push("split");
      if (c.partDelays?.length) parts.push(`sweep: ${c.partDelays.map(p => `${esc(p.group || p.lights)} +${secs(p.delay)}`).join(", ")}`);
      return parts.join(" · ");
    };
    const then = c => c.followEnabled ? `${c.followMode === "go" ? "follow" : "hang"} ${c.follow || 0}s` : c.link != null ? `→ ${c.link}` : "";
    const fx = c => (Array.isArray(c.effects) && c.effects.length ? c.effects : c.effect ? [c.effect] : []).map(e => esc(e.name || e.type)).join(", ");
    let scene = null;
    const rows = cues.map(({ c, i }) => {
      const head = c.scene && c.scene !== scene ? `<tr class="scene"><td colspan="6">${esc(c.scene)}</td></tr>` : "";
      scene = c.scene || scene;
      return `${head}<tr${c.disabled ? ' class="off"' : ""}><td class="n">${esc(window.cueLabel?.(i) ?? i + 1)}</td><td><b>${esc(c.name || "")}</b>${fx(c) ? `<div class="fx">✦ ${fx(c)}</div>` : ""}</td><td>${timing(c)}</td><td>${then(c)}</td><td class="go">${esc(c.goNote || "")}</td><td class="note">${esc(c.note || "")}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — cue sheet</title><style>
      @page{size:A4 landscape;margin:12mm}body{font:11px/1.35 -apple-system,Segoe UI,Arial,sans-serif;color:#111}
      h1{font-size:18px;margin:0 0 2px}.sub{color:#666;margin:0 0 10px}table{width:100%;border-collapse:collapse}
      th{text-align:left;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#555;border-bottom:2px solid #111;padding:4px 6px}
      td{border-bottom:1px solid #ccc;padding:5px 6px;vertical-align:top}td.n{font-weight:800;font-size:13px;width:40px}
      td.go{font-weight:700;font-size:12px;width:22%}td.note{color:#444;width:22%;white-space:pre-wrap}.fx{color:#6a3fbf;font-size:10px}
      tr.scene td{background:#eee;font-weight:800;text-transform:uppercase;letter-spacing:.05em;font-size:10px}tr.off{color:#999;text-decoration:line-through}
      tr{page-break-inside:avoid}</style></head><body>
      <h1>${esc(name)}</h1><p class="sub">Cue sheet · ${cues.length} cues · printed ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>#</th><th>Cue</th><th>Time</th><th>Then</th><th>GO on</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    window.LXShowTools.lastSheet = html;
    if (!print) return html;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    frame.srcdoc = html;
    frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (_) {} setTimeout(() => frame.remove(), 60000); };
    say(`Cue sheet: ${cues.length} cues — choose a printer or Save as PDF`, "ok");
  }

  // --------------------------------------------------- commands and panel

  function hookCommands() {
    const previous = window.parseCommand;
    if (typeof previous !== "function" || previous.__showTools) return;
    const wrapped = function (raw) {
      const c = String(raw || "").trim().toLowerCase();
      if (/^clean\s*up(\s+show)?$/.test(c)) { cleanUpShow(); return true; }
      if (/^(cue\s*sheet|print\s+cues?)$/.test(c)) { cueSheet(); return true; }
      const m = /^update\s+cue\s+(\S+)\s+(cue\s*only|track)$/.exec(c);
      if (m) {
        window.__lxTrackOverride = /only/.test(m[2]) ? "cueonly" : "track";
        try { return previous.call(this, `update cue ${m[1]}`); }
        finally { window.__lxTrackOverride = null; }
      }
      return previous.apply(this, arguments);
    };
    wrapped.__showTools = true;
    window.parseCommand = wrapped;
  }

  function installPanel(tries = 0) {
    if (!window.LXPrefs?.addPanel || !document.getElementById("prefShow")) { if (tries < 100) setTimeout(() => installPanel(tries + 1), 200); return; }
    window.LXPrefs.addPanel("show", "prefShowTools", "Show Tools", "SHOW", `
      <div class="action-row"><button type="button" class="btn-secondary" id="lxCleanUp">🧹 Clean up show…</button><button type="button" class="btn-secondary" id="lxCueSheet">🖨 Print cue sheet…</button></div>
      <div class="lx-pref-note"><b>Clean up</b> removes what points at lights that aren't patched any more (in cues, effects, palettes and groups) and colour stored on lights that can't change colour. <b>Cue sheet</b>: every cue's number, name, timing, follow, GO note and notes on a page for the operator. Commands: <b>clean up show</b>, <b>cue sheet</b>, <b>update cue 5 cue only</b>, <b>update cue 5 track</b>.</div>`);
    document.getElementById("lxCleanUp")?.addEventListener("click", cleanUpShow);
    document.getElementById("lxCueSheet")?.addEventListener("click", cueSheet);
  }

  function styles() {
    const st = document.createElement("style");
    st.textContent = `.lx-gonote{flex:1;min-width:0;margin:0 12px;padding:4px 12px;border-radius:7px;background:#1b1508;color:#ffd27a;font-size:17px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lx-gonote[hidden]{display:none}`;
    document.head.appendChild(st);
  }

  window.LXShowTools = { cleanUp, cleanUpShow, cueSheet, lastSheet: "" };
  const boot = () => { styles(); hookCommands(); installPanel(); setInterval(goNoteTick, 300); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
  else setTimeout(boot, 0);
})();
