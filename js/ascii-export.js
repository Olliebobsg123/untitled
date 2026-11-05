"use strict";

/*
 * Export for FLX S (Zero 88 ZerOS) and other desks: a USITT ASCII show file.
 *
 * The FLX S loads ASCII show files from a USB stick (Setup → Load File). The
 * plain ASCII format only knows dimmer levels, so there are two ways to send
 * a show:
 *
 *   Brightness only (tidy): channel = Light Spark's fixture number, patched
 *     to the DMX address of that light's dimmer (its first channel if it has
 *     none). Cues carry each light's brightness.
 *
 *   Full look (exact): as above, plus every other DMX channel of every light
 *     (colour, pan, tilt, gobo…) patched as its own extra channel, numbered
 *     from 101 (or the next hundred above the highest fixture number). Each
 *     cue then carries the exact DMX the console would send, so the stage
 *     looks the same. On the desk those extra channels are plain dimmers
 *     (no colour picker), and levels are whole percentages, so positions can
 *     be slightly off (about 1/255 of the pan range per step).
 *
 * Both send every cue (number, name, up / down times, delay, follow, link,
 * the whole look with tracking worked out) and groups. Effects and chases
 * don't fit in ASCII.
 *
 * App menu → Export for FLX S…, or "export flx" (asks), "export flx full",
 * "export flx simple".
 */
(function () {
  if (window.LXAscii) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(m, t);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const definition = f => window.getFixtureDefinition?.(f) || window.FixtureLibrary?.[f?.name] || null;

  // ASCII text: plain characters, no line breaks, not too long.
  const clean = (text, max = 60) => String(text ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const level = v => { const n = Math.round(Math.max(0, Math.min(100, num(v)))); return n >= 100 ? "FL" : String(n); };
  const seconds = ms => { const s = Math.max(0, num(ms)) / 1000; return String(Math.round(s * 10) / 10); };

  // Several "1/FL" style entries to a line (ASCII lines are kept short).
  function lines(keyword, items, perLine = 8) {
    const out = [];
    for (let i = 0; i < items.length; i += perLine) out.push(`${keyword} ${items.slice(i, i + perLine).join(" ")}`);
    return out;
  }

  // Friendly names for a light's channels, for the notes in the file.
  const NAMES = { r: "red", g: "green", b: "blue", w: "white", a: "amber", l: "lime", cct: "CCT", dimmer: "dimmer", intensity: "dimmer", pan: "pan", panf: "pan fine", tilt: "tilt", tiltf: "tilt fine", colour: "colour wheel", strobe: "strobe", shutter: "shutter", gobo: "gobo", focus: "focus", zoom: "zoom", prism: "prism", iris: "iris", frost: "frost", amber: "amber", lime: "lime", uv: "UV", cyan: "cyan", magenta: "magenta", yellow: "yellow", cto: "CTO", speed: "speed", mode: "mode", macro: "macro" };
  function label(key) {
    if (NAMES[key]) return NAMES[key];
    if (/.Fine$/.test(key)) return `${label(key.slice(0, -4))} fine`;
    return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
  function channelName(map, offset) {
    const key = Object.keys(map).find(k => map[k] === offset && k !== "dimmer" && k !== "intensity");
    return key ? label(key) : `ch ${offset + 1}`;
  }


  // Which lights can go across: patched, with a whole fixture number.
  // full: every other DMX channel of each light becomes an extra channel too.
  function channels(full = false) {
    const out = [];
    const used = new Set();
    for (const f of (S().fixtures || []).filter(Boolean)) {
      const n = Number(f.fixtureNumber);
      if (!Number.isInteger(n) || n < 1 || used.has(n) || f.addr == null) continue;
      used.add(n);
      const def = definition(f) || {};
      const map = def.map || {};
      const offset = typeof map.dimmer === "number" ? map.dimmer : typeof map.intensity === "number" ? map.intensity : 0;
      const base = (Math.max(1, num(f.uni) || 1) - 1) * 512 + num(f.addr);
      const footprint = Math.max(1, Math.round(num(def.channels ?? def.channelCount) || 1), ...Object.values(map).filter(v => typeof v === "number").map(v => v + 1));
      out.push({ f, channel: n, dimmer: base + offset, offset, base, footprint, map, extras: [] });
    }
    out.sort((a, b) => a.channel - b.channel);
    if (full) {
      const top = out.reduce((m, c) => Math.max(m, c.channel), 0);
      let next = Math.max(100, Math.ceil((top + 1) / 100) * 100) + 1;
      for (const c of out) {
        for (let o = 0; o < c.footprint; o++) {
          if (o === c.offset) continue;
          c.extras.push({ channel: next++, offset: o, dimmer: c.base + o, name: channelName(c.map, o) });
        }
      }
    }
    return out;
  }

  // The DMX the console would send for a look, worked out without sending
  // anything: output, faders and the haze timer are held still meanwhile.
  function dmxFor(look) {
    const s = S();
    if (typeof window.updateDMX !== "function" || !s.dmx) return null;
    const keep = { states: s.fixtureStates, dmx: new Uint8Array(s.dmx), blackout: s.blackout };
    const swaps = [];
    const swap = (obj, key, value) => { if (obj && key in obj) { swaps.push([obj, key, obj[key]]); try { obj[key] = value; } catch (_) {} } };
    swap(window.ArtNet, "send", () => {});
    swap(window.LXAtmos, "limit", () => {});
    swap(window.LXFaders, "levelFor", () => 0);
    swap(window.LXFaders, "grand", () => 1);
    swap(window.LXFaders, "dmxLevels", null);
    let out = null;
    try {
      const states = new Map();
      look.forEach((st, id) => states.set(id, JSON.parse(JSON.stringify(st || {}))));
      s.fixtureStates = states;
      s.blackout = false;
      window.updateDMX();
      out = new Uint8Array(s.dmx);
    } catch (e) {
      console.warn("[ASCII] couldn't work out the DMX for a cue", e);
    } finally {
      for (const [obj, key, value] of swaps.reverse()) { try { obj[key] = value; } catch (_) {} }
      s.fixtureStates = keep.states;
      s.blackout = keep.blackout;
      s.dmx.set(keep.dmx);
    }
    return out;
  }
  const pct = v => Math.round(num(v) / 2.55);

  function build({ full = false } = {}) {
    const s = S();
    const chans = channels(full);
    const extraCount = chans.reduce((n, c) => n + c.extras.length, 0);
    const byId = new Map(chans.map(c => [c.f.id, c]));
    const showName = clean(window.LXShowCommands?.name?.() || "Light Spark show", 40).replace(/\.json$/i, "");
    const out = [
      "Ident 3:0",
      "Manufacturer Light Spark",
      "Console Light Spark",
      `! ${showName} - exported ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      full ? "! Full look: every DMX channel of every light, so colour, position and beam come across as plain levels." : "! Brightness only: colour, position and beam aren't part of plain ASCII.",
      "Clear All",
      "",
      "! Patch: channel = Light Spark fixture number, dimmer = DMX address",
      ...lines("Patch 1", chans.map(c => `${c.channel}<${c.dimmer}>@FL`), 6),
      ""
    ];
    if (full && extraCount) {
      out.push("! The other channels of each light:");
      for (const c of chans) {
        if (!c.extras.length) continue;
        const first = c.extras[0].channel, last = c.extras[c.extras.length - 1].channel;
        out.push(`! ${first}${last > first ? `-${last}` : ""} = light ${c.channel} ${clean(c.f.name || "", 30)}: ${c.extras.map(e => e.name).join(", ")}`.slice(0, 250));
        out.push(...lines("Patch 1", c.extras.map(e => `${e.channel}<${e.dimmer}>@FL`), 6));
      }
      out.push("");
    }

    let cueCount = 0;
    (s.cues || []).forEach((cue, i) => {
      if (!cue) return;
      const number = window.cueLabel ? window.cueLabel(i) : String(i + 1);
      const look = window.cueLook?.(i)?.fixtureMap || new Map();
      const timing = cue.timing && typeof cue.timing === "object" ? cue.timing : {};
      const up = timing.up ?? cue.fade ?? 800, down = timing.down ?? cue.fade ?? 800;
      const delay = num(cue.delay);
      out.push(`Cue ${number}`);
      out.push(`Up ${seconds(up)}${delay ? ` ${seconds(delay)}` : ""}`);
      out.push(`Down ${seconds(down)}${delay ? ` ${seconds(delay)}` : ""}`);
      if (cue.followEnabled) out.push(`FollowOn ${seconds(num(cue.follow) * 1000)}`);
      if (cue.link != null && cue.link !== "") out.push(`Link ${clean(cue.link, 10)}`);
      const name = clean(cue.name || "", 40);
      if (name) out.push(`Text ${name}`);
      const levels = [];
      const dmx = full ? dmxFor(look) : null;
      if (dmx) {
        for (const c of chans) {
          for (const ch of [{ channel: c.channel, dimmer: c.dimmer }, ...c.extras]) {
            const v = pct(dmx[ch.dimmer - 1]);
            if (v > 0) levels.push([ch.channel, `${ch.channel}/${level(v)}`]);
          }
        }
      } else {
        look.forEach((st, id) => {
          const c = byId.get(id);
          if (c && num(st?.intensity) > 0.5) levels.push([c.channel, `${c.channel}/${level(st.intensity)}`]);
        });
      }
      levels.sort((a, b) => a[0] - b[0]);
      out.push(...lines("Chan", levels.map(l => l[1])));
      out.push("");
      cueCount++;
    });

    let groupCount = 0;
    (s.groups || []).filter(g => g && g.name).forEach(g => {
      const members = (g.members || []).map(m => {
        const f = (s.fixtures || []).find(x => x && (String(x.id) === String(m) || String(x.fixtureNumber) === String(m)));
        return f ? byId.get(f.id) : null;
      }).filter(Boolean);
      if (!members.length) return;
      groupCount++;
      out.push(`Group ${groupCount}`);
      out.push(`Text ${clean(g.name, 40)}`);
      out.push(...lines("Chan", [...new Set(members.map(c => c.channel))].sort((a, b) => a - b).map(c => `${c}/FL`)));
      out.push("");
    });

    out.push("EndData", "");
    const firstExtra = chans.find(c => c.extras.length)?.extras[0].channel ?? null;
    const high = [...chans.map(c => c.dimmer), ...chans.flatMap(c => c.extras.map(e => e.dimmer))].filter(d => d > 512).length;
    return { text: out.join("\r\n"), full, extras: extraCount, firstExtra, universe2: high, lights: chans.length, cues: cueCount, groups: groupCount, name: showName, skipped: (s.fixtures || []).filter(Boolean).length - chans.length };
  }

  function exportFile(full = false) {
    const r = build({ full });
    if (!r.lights) return say("Nothing to export — patch some lights first", "warn");
    const file = `${r.name.replace(/[^\w .-]/g, "") || "Light Spark show"}${full ? " (full look)" : ""}.asc`;
    const url = URL.createObjectURL(new Blob([r.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say(`${file} saved to your Downloads folder: ${r.lights} lights${full ? ` (+${r.extras} colour / position / beam channels from ${r.firstExtra})` : ""}, ${r.cues} cues, ${r.groups} groups. Copy it to a USB stick → FLX S: Setup → Load File`, "ok");
    if (r.skipped) say(`${r.skipped} light${r.skipped === 1 ? " wasn't" : "s weren't"} included (not patched, or no whole fixture number)`, "warn");
    if (r.universe2) say(`${r.universe2} channel${r.universe2 === 1 ? " is" : "s are"} on universe 2 — an FLX S only has universe 1 unless it's been upgraded`, "warn");
    return r;
  }

  async function exportAsk() {
    if (!window.LXAsk) return exportFile(false);
    const a = await window.LXAsk("Export for FLX S", [{
      key: "mode", label: "What to send", type: "select", value: "full",
      options: [["full", "Full look: colour, position, beam too (exact)"], ["simple", "Brightness only (tidy)"]]
    }], {
      ok: "Export",
      message: "Full look sends every DMX channel of every light, so the stage looks the same on the FLX S. Colour and position arrive as plain levels on extra channels (101 up), not as colour pickers. Brightness only keeps the desk tidy: one channel per light. Loading a show file replaces the show on the desk, so save theirs first."
    });
    if (!a) return null;
    return exportFile(a.mode === "full");
  }

  function command(c) {
    const m = c.match(/^export (ascii|flx|flx s|zeros|usitt)(?: (full|simple|levels|brightness))?$/);
    if (!m) return false;
    if (!m[2]) exportAsk();
    else exportFile(m[2] === "full");
    return true;
  }

  window.LXAscii = { build, export: exportAsk, exportFile, command, dmxFor };
})();
