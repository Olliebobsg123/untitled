"use strict";

/*
 * Haze and fog safety: a longest run for smoke machines, so a stuck cue or
 * a forgotten fader can't fill the hall and set off the fire alarm.
 *
 *   Foggers   fixtures with a fog channel, or "fog"/"smoke" in the name
 *             (their dimmer is the output). Default: cut after 10 s.
 *   Hazers    a haze channel, or "haze" in the name. Default: no limit
 *             (hazers are made to run); set one if you want it.
 *
 * Once cut, the machine stays off until its level is brought back to 0 (then
 * it can be used again), or you type "fog reset". Preferences → Show →
 * Haze & Fog Safety, or "fog limit 10" / "haze limit 300" (0 = no limit).
 */
(function () {
  if (window.LXAtmos) return;
  const DEFAULT = { fog: 10, haze: 0 };
  const run = new Map(); // fixture id → { since, tripped }
  const prefKey = kind => (kind === "fog" ? "fogMaxSec" : "hazeMaxSec");
  const limitFor = kind => {
    const v = Number(window.LXPrefs?.get(prefKey(kind)));
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT[kind];
  };
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = (m, t = "ok") => window.log?.(m, t);

  // The smoke machines in the patch and the DMX slots that make the smoke.
  function machines() {
    const out = [];
    for (const f of window.State?.fixtures || []) {
      if (!f) continue;
      const def = typeof getFixtureDefinition === "function" ? getFixtureDefinition(f) : null;
      const map = def?.map || {};
      const base = typeof getFixtureBaseAddress === "function" ? getFixtureBaseAddress(f) : -1;
      if (base < 0) continue;
      const name = [f.label, f.customName, f.name].filter(Boolean).join(" ");
      let kind = null, slots = [];
      if (typeof map.fog === "number") { kind = "fog"; slots = [map.fog]; }
      else if (typeof map.haze === "number") { kind = "haze"; slots = [map.haze]; }
      else if (typeof map.pan !== "number") {
        const dim = typeof map.dimmer === "number" ? map.dimmer : map.intensity;
        if (typeof dim === "number") {
          if (/\bhaze/i.test(name)) kind = "haze";
          else if (/\b(fog|smoke)/i.test(name)) kind = "fog";
          slots = [dim];
        }
      }
      if (kind) out.push({ fixture: f, kind, slots: slots.map(s => base + s), name: f.label || f.customName || `${f.name} ${f.fixtureNumber ?? ""}`.trim() });
    }
    return out;
  }

  // Called by updateDMX() just before the DMX goes out.
  function limit(dmx) {
    if (!dmx) return;
    const now = Date.now();
    const seen = new Set();
    for (const m of machines()) {
      const id = String(m.fixture.id);
      seen.add(id);
      const max = limitFor(m.kind);
      const asked = Math.max(0, ...m.slots.map(i => Number(dmx[i]) || 0));
      let r = run.get(id);
      if (!r) run.set(id, r = { since: null, tripped: false, kind: m.kind, name: m.name, max });
      r.kind = m.kind; r.name = m.name; r.max = max;
      if (asked === 0) {
        // Brought back to 0: ready again.
        if (r.tripped) say(`${m.name}: ready again`, "ok");
        r.since = null; r.tripped = false;
        continue;
      }
      if (r.since == null) r.since = now;
      if (!r.tripped && max > 0 && now - r.since >= max * 1000) {
        r.tripped = true;
        say(`⚠ ${m.name} cut after ${max} s (${m.kind === "fog" ? "fog" : "haze"} limit). Bring its level to 0 to use it again, or type "${m.kind} reset".`, "warn");
      }
      if (r.tripped) m.slots.forEach(i => { if (i >= 0 && i < dmx.length) dmx[i] = 0; });
    }
    for (const id of [...run.keys()]) if (!seen.has(id)) run.delete(id);
    banner();
  }

  // A machine whose time runs out while nothing else changes still has to be cut.
  setInterval(() => {
    const now = Date.now();
    for (const r of run.values()) {
      if (!r.tripped && r.since != null && r.max > 0 && now - r.since >= r.max * 1000) { window.updateDMX?.(); return; }
    }
  }, 250);

  function reset(kind = null) {
    let n = 0;
    for (const r of run.values()) if (r.tripped && (!kind || r.kind === kind)) { r.tripped = false; r.since = Date.now(); n++; }
    window.updateDMX?.();
    banner();
    return n;
  }

  function banner() {
    const cut = [...run.values()].filter(r => r.tripped);
    let el = document.getElementById("lxAtmosTrip");
    if (!cut.length) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "lxAtmosTrip";
      el.className = "lx-atmos-trip";
      document.body.appendChild(el);
      el.addEventListener("click", e => { if (e.target.closest("button")) reset(); });
    }
    const text = `⚠ Smoke cut: <b>${cut.map(r => esc(r.name)).join(", ")}</b> ran longer than ${esc(cut[0].max)} s. It stays off until its level goes back to 0.`;
    if (el.dataset.text !== text) { el.dataset.text = text; el.innerHTML = `<span>${text}</span><button type="button" class="btn-secondary">Let it run again</button>`; }
  }

  function setLimit(kind, seconds) {
    const v = Math.max(0, Number(seconds) || 0);
    window.LXPrefs?.set(prefKey(kind), v);
    renderPanel();
    window.updateDMX?.();
    return v;
  }

  // ------------------------------------------------------------ commands

  // Called by the command line (js/command-line.js) before its own "fog 80".
  function command(input) {
    const c = String(input || "").trim().toLowerCase();
    let m;
    if ((m = /^(fog|haze|smoke)\s+reset$/.exec(c))) {
      const n = reset(m[1] === "haze" ? "haze" : m[1] === "fog" ? "fog" : null);
      say(n ? `${n} smoke machine${n === 1 ? "" : "s"} can run again` : "Nothing was cut", "ok");
      return true;
    }
    if ((m = /^(fog|haze)\s+limit\s+(\d+(?:\.\d+)?)\s*s?$/.exec(c))) {
      const v = setLimit(m[1], m[2]);
      say(v ? `${m[1] === "fog" ? "Foggers" : "Hazers"} cut after ${v} s` : `${m[1] === "fog" ? "Foggers" : "Hazers"}: no limit`, "ok");
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ settings

  function renderPanel() {
    const body = document.querySelector("#prefAtmos .panel-body");
    if (!body) return;
    const list = machines();
    body.innerHTML = `
      <div class="lx-atmos-row"><label>Foggers: cut after <input type="number" min="0" step="1" data-atmos="fog" value="${limitFor("fog")}"> s</label></div>
      <div class="lx-atmos-row"><label>Hazers: cut after <input type="number" min="0" step="10" data-atmos="haze" value="${limitFor("haze")}"> s</label></div>
      <div class="lx-pref-note">0 = no limit. After a cut the machine stays off until its level goes back to 0, so a stuck cue can't keep it going. ${list.length ? `In this show: ${list.map(m => `${esc(m.name)} (${m.kind})`).join(", ")}.` : "No smoke machines patched — Light Spark spots them by a fog or haze channel, or “fog”, “smoke” or “haze” in the name."}</div>`;
    body.querySelectorAll("[data-atmos]").forEach(input => input.addEventListener("change", () => setLimit(input.dataset.atmos, input.value)));
  }

  function install(tries = 0) {
    if (!window.LXPrefs?.addPanel || !document.getElementById("prefShow")) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    window.LXPrefs.addPanel("show", "prefAtmos", "Haze & Fog Safety", "SAFETY", "");
    renderPanel();
    document.querySelector('.nav-link[data-page="settings"]')?.addEventListener("click", renderPanel);
    if (!document.getElementById("lxAtmosStyles")) {
      const st = document.createElement("style");
      st.id = "lxAtmosStyles";
      st.textContent = `.lx-atmos-trip{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:100050;display:flex;align-items:center;gap:12px;max-width:min(820px,calc(100vw - 32px));padding:10px 14px;border:1px solid #7a2a20;border-radius:10px;background:#250d09;color:#ffd8cf;font-size:13px;line-height:1.4;box-shadow:0 12px 30px rgba(0,0,0,.5)}.lx-atmos-trip span{flex:1}.lx-atmos-trip button{flex:0 0 auto;min-height:34px;white-space:nowrap}.lx-atmos-row{margin:6px 0;font-size:12.5px;color:#c6d0ce}.lx-atmos-row input{width:76px;margin:0 6px}`;
      document.head.appendChild(st);
    }
  }

  window.LXAtmos = { limit, reset, command, setLimit, machines, status: () => [...run.entries()].map(([id, r]) => ({ id, ...r })) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
