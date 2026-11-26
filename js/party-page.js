"use strict";

/*
 * The Party page: an automatic light show to the music, set up with buttons
 * instead of commands. The beat comes from js/sound-light.js (Ableton Link
 * from Serato DJ Pro, VirtualDJ, or listening).
 *
 *   Start / Stop        the show on all lights, the selected lights or a group
 *   Looks               which looks it uses, and how many bars each lasts
 *   Colours             the colours it uses (a preset or your own), and how
 *                       often they change
 *   Feel                soft glow ↔ hard flash, background glow, brightness,
 *                       a white hit on the drop (when listening)
 *   Live                hold Flash / White / Strobe / Blackout; tap Next look
 *   Timing              nudge every flash earlier or later
 *
 * Settings are kept on this computer (they're about the DJ set, not a show).
 * LXParty.frame() is what the "party" effect draws each frame.
 */
(function () {
  if (window.LXParty) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(`🎉 ${m}`, t);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------ settings

  const LOOKS = [
    ["flash", "Flash", "Every light flashes on the beat"],
    ["oddeven", "Odd / Even", "Two colours swap sides every beat"],
    ["chase", "Chase", "One light at a time, bouncing along on the beat"],
    ["rainbow", "Rainbow", "Every light its own colour, pulsing"],
    ["pulse", "Pulse", "A slower two-beat swell"],
    ["solid", "Solid", "Steady colour, no flashing (for slow songs)"]
  ];
  const PRESETS = {
    Party: [0, 300, 240, 180, 120, 45],
    Warm: [0, 20, 35, 50, 330],
    Cool: [180, 200, 230, 260, 290],
    Ice: [190, 205, 220, { h: 200, s: 25 }],
    "Red & Blue": [0, 235],
    "Pink & Purple": [320, 285, 300],
    Rainbow: [0, 30, 60, 120, 180, 240, 280]
  };
  const DEFAULTS = {
    looks: ["flash", "oddeven", "chase", "rainbow", "pulse"],
    lookBars: 4, colours: PRESETS.Party, colourEvery: 4,
    flash: 0.8, floor: 0.12, brightness: 1, dropWhite: true,
    lights: "all", group: ""
  };
  const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("lxParty") || "{}") }; } catch (_) { return { ...DEFAULTS }; } };
  const set = load();
  const save = () => { try { localStorage.setItem("lxParty", JSON.stringify(set)); } catch (_) {} };
  const colourOf = c => (c && typeof c === "object" ? { h: Number(c.h) || 0, s: c.s ?? 100 } : { h: Number(c) || 0, s: 100 });
  const css = c => { const { h, s } = colourOf(c); return `hsl(${h} ${s}% ${s < 50 ? 85 : 55}%)`; };

  // Live buttons held down, and how far "Next look" has moved on.
  let hold = null, lookShift = 0;

  // ------------------------------------------------------------ the look

  // The beat's shape: 1 on the beat, falling; hard = a quick flash, soft = a glow.
  function envelope(phase) {
    const hard = Math.exp(-phase * 8), soft = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
    return set.flash * hard + (1 - set.flash) * soft;
  }

  function frame(st, f, c, s) {
    const canColour = typeof fxCanColour === "function" && fxCanColour(f);
    const paint = (colour, light = 50) => { if (canColour) { const { h, s: sat } = colourOf(colour); fxSetColour(f, st, h, sat, sat < 50 ? Math.max(light, 70) : light); } };
    const out = v => { st.intensity = fxApplyIntensity(100 * Math.max(0, Math.min(1, v))); };
    // Live buttons win.
    if (hold === "blackout") return out(0);
    if (hold === "white") { paint({ h: 0, s: 0 }, 100); return out(1); }
    if (hold === "strobe") { paint({ h: 0, s: 0 }, 100); return out(((s.beat * 4 + Math.floor(s.phase * 4)) % 2) === 0 ? 1 : 0); }
    const cols = (set.colours?.length ? set.colours : PRESETS.Party);
    const ci = Math.floor(s.beat / Math.max(1, set.colourEvery));
    const pick = k => cols[((k % cols.length) + cols.length) % cols.length];
    if (hold === "flash") { paint(pick(ci)); return out(1); }
    // A white hit on the drop (when it's listening and hears one).
    if (set.dropWhite && s.drop) { paint({ h: 0, s: 0 }, 100); return out(envelope(s.phase)); }
    const looks = LOOKS.map(([k]) => k).filter(k => set.looks.includes(k));
    const look = looks.length ? looks[(((Math.floor(s.beat / (4 * Math.max(1, set.lookBars))) + lookShift) % looks.length) + looks.length) % looks.length] : "flash";
    // Calmer when the music is quieter, if it's listening; full otherwise.
    const lively = window.LXSound?.raw?.listening ? 0.35 + 0.65 * Math.max(0, Math.min(1, s.energy)) : 1;
    const level = set.brightness * lively;
    const fl = set.floor, env = envelope(s.phase), beatV = fl + (1 - fl) * env;
    switch (look) {
      case "oddeven": {
        const on = (c.index + s.beat) % 2 === 0;
        paint(on ? pick(ci) : pick(ci + 1));
        return out((on ? beatV : fl) * level);
      }
      case "chase": {
        const span = Math.max(1, c.count - 1), pos = s.beat % (span * 2), at = pos <= span ? pos : span * 2 - pos;
        paint(pick(ci));
        return out((c.order === at ? 0.5 + 0.5 * env : fl * 0.6) * level);
      }
      case "rainbow":
        paint(pick(ci + c.index));
        return out((0.55 + 0.45 * env) * level);
      case "pulse": {
        const p = ((s.beat % 2) + s.phase) / 2;
        paint(pick(ci + (c.index % 2)));
        return out((fl + (1 - fl) * envelope(p)) * level);
      }
      case "solid":
        paint(pick(ci));
        return out(level);
      default:
        paint(pick(ci));
        return out(beatV * level);
    }
  }

  // ------------------------------------------------------------ which lights

  function lightIds() {
    const all = (S().fixtures || []).filter(f => {
      if (!f || f.id == null) return false;
      const map = (typeof fxDefinitionMap === "function" ? fxDefinitionMap(f) : {}) || {};
      return typeof map.fog !== "number" && typeof map.haze !== "number" && !/fog|haz|smoke/i.test(f.name || "");
    });
    if (set.lights === "selected") return [...(S().selected || [])].map(String);
    if (set.lights === "group") {
      const g = (S().groups || []).find(x => x?.name === set.group);
      const ids = new Set((g?.members || []).map(String));
      return all.filter(f => ids.has(String(f.id)) || ids.has(String(f.fixtureNumber))).map(f => String(f.id));
    }
    return all.map(f => String(f.id));
  }

  async function startStop() {
    if (window.LXSound?.partyRunning?.()) { await window.LXSound.stopParty(); render(); return; }
    const ids = lightIds();
    if (!ids.length) return say(set.lights === "selected" ? "Select some lights first" : set.lights === "group" ? "That group has no lights" : "Patch some lights first", "warn");
    await window.LXSound?.startParty(ids);
    render();
  }

  // ------------------------------------------------------------ the page

  function style() {
    if (document.getElementById("partyStyle")) return;
    const el = document.createElement("style");
    el.id = "partyStyle";
    el.textContent = `
  #page-party .pt-wrap{display:grid;gap:14px;padding:16px}
  #page-party .pt-top{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:16px;border:1px solid var(--border);border-radius:var(--r-md,10px);background:var(--bg-1)}
  #page-party .pt-go{min-width:150px;height:56px;border-radius:12px;border:0;font:800 18px var(--sans);cursor:pointer;background:var(--accent);color:#05110d}
  #page-party .pt-go.on{background:#ff5265;color:#fff}
  #page-party .pt-bpm{font:800 30px var(--sans);color:var(--text)}
  #page-party .pt-src{font:600 12px var(--sans);color:var(--text-muted)}
  #page-party .pt-dots{display:flex;gap:8px;margin-left:auto}
  #page-party .pt-dots i{width:18px;height:18px;border-radius:50%;background:var(--border-strong);transition:background .12s,transform .12s}
  #page-party .pt-dots i.on{background:var(--accent);transform:scale(1.25);transition:none}
  #page-party .pt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  #page-party .pt-card{padding:14px;border:1px solid var(--border);border-radius:var(--r-md,10px);background:var(--bg-1);display:grid;gap:10px;align-content:start}
  #page-party .pt-card h4{margin:0;font:800 11px var(--sans);letter-spacing:.08em;color:var(--text-muted);text-transform:uppercase}
  #page-party .pt-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  #page-party .pt-chip{height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--border-strong);background:var(--bg-0);color:var(--text-soft);font:700 12px var(--sans);cursor:pointer}
  #page-party .pt-chip.on{border-color:var(--accent);color:var(--text);box-shadow:0 0 0 1px var(--accent) inset}
  #page-party .pt-sw{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer;position:relative}
  #page-party .pt-sw:hover::after{content:"×";position:absolute;inset:0;display:grid;place-items:center;font:800 14px var(--sans);color:#000;background:rgba(255,255,255,.55);border-radius:50%}
  #page-party .pt-add{width:30px;height:30px;border-radius:50%;border:1px dashed var(--border-strong);background:transparent;color:var(--text-muted);cursor:pointer;font:700 16px var(--sans);display:grid;place-items:center;overflow:hidden;position:relative}
  #page-party .pt-add input{position:absolute;inset:0;opacity:0;cursor:pointer}
  #page-party label.pt-sl{display:grid;grid-template-columns:92px minmax(0,1fr) 78px;align-items:center;gap:8px;font:600 12px var(--sans);color:var(--text-soft)}
  #page-party label.pt-sl input{width:100%;min-width:0}
  #page-party label.pt-sl span:last-child{text-align:right;color:var(--text-muted);font-variant-numeric:tabular-nums}
  #page-party .pt-live{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
  #page-party .pt-live button{height:64px;border-radius:12px;border:1px solid var(--border-strong);background:var(--bg-0);color:var(--text);font:800 13px var(--sans);cursor:pointer;user-select:none;touch-action:none}
  #page-party .pt-live button.held{background:var(--accent);color:#05110d}
  #page-party .pt-note{font:500 11px var(--sans);color:var(--text-muted);margin:0}
  #page-party select.pt-sel{height:30px;border-radius:8px;border:1px solid var(--border-strong);background:var(--bg-0);color:var(--text);padding:0 8px}
  @media (max-width:640px){#page-party .pt-live{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(el);
  }

  let page = null;
  function mount() {
    if (page) return page;
    const effects = document.getElementById("page-effects");
    const nav = document.querySelector('.nav-link[data-page="effects"]');
    if (!effects || !nav) return null;
    style();
    page = document.createElement("div");
    page.className = "page";
    page.id = "page-party";
    effects.after(page);
    const button = document.createElement("button");
    button.className = "nav-link";
    button.dataset.page = "party";
    button.title = "Lights to the music";
    button.innerHTML = '<span class="nav-icon">♫</span><span class="nav-text">Party</span><b></b>';
    nav.after(button);
    button.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".nav-link").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
      button.classList.add("active");
      page.classList.add("active");
      render();
    });
    document.querySelectorAll(".nav-link[data-page]").forEach((b, i) => { const t = b.querySelector("b"); if (t) t.textContent = String(i + 1).padStart(2, "0"); });
    page.addEventListener("click", click);
    page.addEventListener("input", input);
    page.addEventListener("change", input);
    // Live buttons: held down.
    page.addEventListener("pointerdown", e => {
      const b = e.target.closest("[data-hold]"); if (!b) return;
      hold = b.dataset.hold; b.classList.add("held");
      const up = () => { if (hold === b.dataset.hold) hold = null; b.classList.remove("held"); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
      window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    });
    // Beat dots and tempo, live.
    window.LXSound?.onBeat?.(() => { if (page.classList.contains("active")) dots(); });
    setInterval(() => { if (page.classList.contains("active")) status(); }, 300);
    return page;
  }

  function dots() {
    const s = window.LXSound?.state?.(); if (!s) return;
    const n = ((s.beat % 4) + 4) % 4;
    page.querySelectorAll(".pt-dots i").forEach((d, i) => d.classList.toggle("on", i === n));
    setTimeout(() => page.querySelectorAll(".pt-dots i").forEach(d => d.classList.remove("on")), 110);
  }

  function source() {
    const r = window.LXSound?.raw || {}, s = window.LXSound?.state?.() || {};
    if (s.link) return ["Ableton Link", s.bpm];
    if (r.linkIgnored) return [`⚠ Serato's Link is at ${Math.round(r.link?.bpm || 0)} — press LINK on the deck that's playing (listening for now)`, r.bpm];
    if (s.dj) return ["VirtualDJ", s.bpm];
    if (r.listening && r.bpm) return [`listening${r.grid ? " + Serato" : ""}${r.sure > 0.6 ? " · locked" : " · finding it"}`, r.bpm];
    if (r.listening) return ["listening — finding the beat…", 0];
    if (r.linkOn) return ["waiting for the music…", 0];
    return ["not running", 0];
  }
  function status() {
    const [src, bpm] = source();
    const running = window.LXSound?.partyRunning?.();
    const b = page.querySelector(".pt-bpm"), sEl = page.querySelector(".pt-src"), go = page.querySelector(".pt-go");
    if (b) b.textContent = bpm ? `${Math.round(bpm * 10) / 10} BPM` : "— BPM";
    if (sEl) sEl.textContent = running ? src : "Press Start, then play music (Serato DJ Pro: turn LINK on)";
    if (go) { go.textContent = running ? "■ Stop" : "▶ Start"; go.classList.toggle("on", Boolean(running)); }
  }

  const chip = (attr, on, text, tip = "") => `<button type="button" class="pt-chip${on ? " on" : ""}" ${attr} title="${esc(tip)}">${esc(text)}</button>`;
  const slider = (key, label, min, max, step, shown) => `<label class="pt-sl"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${set[key]}"><span>${shown}</span></label>`;

  function render() {
    if (!mount()) return;
    const groups = (S().groups || []).filter(g => g?.name).map(g => g.name);
    const offset = Number(window.LXSound?.settings?.offset) || 0;
    page.innerHTML = `
      <div class="pt-wrap">
        <div class="pt-top">
          <button type="button" class="pt-go" data-a="go">▶ Start</button>
          <div><div class="pt-bpm">— BPM</div><div class="pt-src"></div></div>
          <div class="pt-dots" title="The beat: 1 2 3 4"><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="pt-grid">
          <section class="pt-card"><h4>Lights</h4>
            <div class="pt-row">${chip('data-lights="all"', set.lights === "all", "All lights")}${chip('data-lights="selected"', set.lights === "selected", "Selected lights")}${groups.length ? chip('data-lights="group"', set.lights === "group", "A group") : ""}</div>
            ${set.lights === "group" ? `<select class="pt-sel" data-k="group">${groups.map(g => `<option${g === set.group ? " selected" : ""}>${esc(g)}</option>`).join("")}</select>` : ""}
            <p class="pt-note">Smoke and haze machines are always left out. Change this, then Stop and Start again.</p>
          </section>
          <section class="pt-card"><h4>Looks</h4>
            <div class="pt-row">${LOOKS.map(([k, n, tip]) => chip(`data-look="${k}"`, set.looks.includes(k), n, tip)).join("")}</div>
            <div class="pt-row"><span class="pt-note">New look every</span>${[1, 2, 4, 8].map(b => chip(`data-lookbars="${b}"`, set.lookBars === b, b === 1 ? "bar" : `${b} bars`)).join("")}</div>
          </section>
          <section class="pt-card"><h4>Colours</h4>
            <div class="pt-row">${Object.keys(PRESETS).map(p => chip(`data-preset="${esc(p)}"`, JSON.stringify(PRESETS[p]) === JSON.stringify(set.colours), p)).join("")}</div>
            <div class="pt-row">${set.colours.map((c, i) => `<span class="pt-sw" data-del="${i}" style="background:${css(c)}" title="Remove"></span>`).join("")}<label class="pt-add" title="Add a colour">＋<input type="color" data-addcolour value="#ff00aa"></label></div>
            <div class="pt-row"><span class="pt-note">New colour every</span>${[[1, "beat"], [2, "2 beats"], [4, "bar"], [8, "2 bars"], [16, "4 bars"]].map(([b, n]) => chip(`data-colourevery="${b}"`, set.colourEvery === b, n)).join("")}</div>
          </section>
          <section class="pt-card"><h4>Feel</h4>
            ${slider("flash", "Soft ↔ Hard", 0, 1, 0.05, set.flash < 0.35 ? "glow" : set.flash > 0.7 ? "flash" : "mix")}
            ${slider("floor", "Background", 0, 0.6, 0.02, `${Math.round(set.floor * 100)}%`)}
            ${slider("brightness", "Brightness", 0.2, 1, 0.05, `${Math.round(set.brightness * 100)}%`)}
            <div class="pt-row">${chip('data-a="drop"', set.dropWhite, "White hit on the drop", "When it's listening to the music and the bass drops back in")}</div>
          </section>
          <section class="pt-card" style="grid-column:1/-1"><h4>Live — hold down</h4>
            <div class="pt-live">
              <button type="button" data-hold="flash">FLASH</button>
              <button type="button" data-hold="white">WHITE</button>
              <button type="button" data-hold="strobe" title="Fast white strobe while held">STROBE</button>
              <button type="button" data-hold="blackout">BLACKOUT</button>
              <button type="button" data-a="next">NEXT LOOK ▸</button>
            </div>
          </section>
          <section class="pt-card"><h4>Timing</h4>
            <label class="pt-sl"><span>Flashes</span><input type="range" data-offset min="-150" max="150" step="5" value="${offset}"><span>${offset === 0 ? "on time" : `${Math.abs(offset)} ms ${offset < 0 ? "earlier" : "later"}`}</span></label>
            <p class="pt-note">If the lights look a bit late (or early) compared to the music, slide this until they hit with the kick.</p>
            <div class="pt-row"><button type="button" class="pt-chip" data-a="linkstatus">Check Ableton Link</button></div>
          </section>
        </div>
      </div>`;
    status();
  }

  function click(e) {
    const t = e.target.closest("button, .pt-sw"); if (!t) return;
    const d = t.dataset;
    if (d.a === "go") return startStop();
    if (d.a === "next") { lookShift++; return say("Next look"); }
    if (d.a === "linkstatus") return window.LXSound?.linkStatus?.();
    if (d.a === "drop") set.dropWhite = !set.dropWhite;
    else if (d.lights) set.lights = d.lights;
    else if (d.look) { set.looks = set.looks.includes(d.look) ? set.looks.filter(k => k !== d.look) : [...set.looks, d.look]; if (!set.looks.length) set.looks = [d.look]; }
    else if (d.lookbars) set.lookBars = Number(d.lookbars);
    else if (d.colourevery) set.colourEvery = Number(d.colourevery);
    else if (d.preset) set.colours = JSON.parse(JSON.stringify(PRESETS[d.preset]));
    else if (d.del != null) { if (set.colours.length > 1) set.colours.splice(Number(d.del), 1); }
    else return;
    if (set.lights === "group" && !set.group) set.group = (S().groups || []).find(g => g?.name)?.name || "";
    save(); render();
  }

  function input(e) {
    const t = e.target;
    if (t.dataset.k) {
      set[t.dataset.k] = t.tagName === "SELECT" ? t.value : Number(t.value);
      save();
      if (e.type === "change") render(); else { const out = t.parentElement.lastElementChild; if (out && t.dataset.k === "floor") out.textContent = `${Math.round(set.floor * 100)}%`; if (out && t.dataset.k === "brightness") out.textContent = `${Math.round(set.brightness * 100)}%`; if (out && t.dataset.k === "flash") out.textContent = set.flash < 0.35 ? "glow" : set.flash > 0.7 ? "flash" : "mix"; }
    } else if (t.dataset.offset != null) {
      const v = Number(t.value);
      if (e.type === "change") window.LXSound?.command?.(`sound offset ${v}`);
      const out = t.parentElement.lastElementChild; if (out) out.textContent = v === 0 ? "on time" : `${Math.abs(v)} ms ${v < 0 ? "earlier" : "later"}`;
    } else if (t.dataset.addcolour != null && e.type === "change") {
      const hex = t.value, r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), dd = max - min;
      let h = 0; if (dd) h = max === r ? ((g - b) / dd) % 6 : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
      set.colours.push({ h: Math.round((h * 60 + 360) % 360), s: Math.round(max ? (dd / max) * 100 : 0) });
      save(); render();
    }
  }

  window.LXParty = { frame, settings: set, render, open: () => document.querySelector('.nav-link[data-page="party"]')?.click(), hold: v => { hold = v || null; } };
  const boot = () => { if (!mount()) setTimeout(boot, 400); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
