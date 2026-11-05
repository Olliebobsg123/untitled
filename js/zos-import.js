"use strict";

/*
 * Open a Zero 88 ZerOS show file (.zos — FLX S, FLX, ORB, Solution, Phantom ZerOS).
 *
 * How the file works (worked out from the show files themselves and how
 * Phantom ZerOS reads them):
 *
 *   Z88C — a packed container. "Z88C", u32 total length, then segments of up
 *   to 16 KB, each: a header (v1/v2: u32 = packed length | unpacked length << 16;
 *   v3: u32 packed length, u32 unpacked length), 8 bytes of checks, then a
 *   method byte: 0 = stored, 2 / 3 = LZW exactly as the old Unix `compress`
 *   (9 → 16 bit codes, code 256 = clear, LSB first), then u32 unpacked size and
 *   the data. A 0x20 (v3: 0x24) byte trailer with the segment table ends it,
 *   finishing with "Z88C" again. Containers can sit inside the data.
 *
 *   Z88B — the unpacked data: tagged records written value-first, so they're
 *   read backwards from the end. Each record ends with an 8-byte tag:
 *   u8 field, u8 kind, u16 section, u32 length (top bit set = a group whose
 *   children are the `length` bytes before it). A ff/ff/ffff record opens
 *   each group.
 *
 *   Sections found so far (section id → what):
 *     0x10 the show · 0x12 desk setup · 0x18 fixture types (with full channel
 *     lists) · 0x1c patch · 0x1f groups · 0x1d palettes · 0xc0 network ·
 *     0x50 / 0x51 playbacks, their cues and 0x71 the fixture values in a cue.
 *
 * What comes across: every light (number, name, type, address, universe), the
 * fixture types (matched to Light Spark's library, or rebuilt from the
 * show's own channel list), groups, palette names, and cues with their times
 * and brightness. Colour / position values in cues aren't decoded yet.
 *
 * App menu → Open FLX show (.zos)…, or "open flx".
 */
(function () {
  if (window.LXZos) return;
  const say = (m, t = "ok") => window.log?.(m, t);

  // ---------- Unix compress LZW (as ZerOS reads it) ----------
  function lzw(src, limit) {
    const MAXBITS = 16, MAXMAX = 1 << MAXBITS;
    const prefix = new Uint16Array(MAXMAX), suffix = new Uint8Array(MAXMAX);
    for (let i = 0; i < 256; i++) suffix[i] = i;
    const out = new Uint8Array(limit);
    let o = 0, inPos = 0;
    let nBits = 9, maxcode = 511, freeEnt = 257, clear = false;
    const buf = new Uint8Array(MAXBITS + 2);
    let offset = 0, size = 0;
    function getcode() {
      if (clear || offset >= size || freeEnt > maxcode) {
        if (freeEnt > maxcode) { nBits++; maxcode = nBits === MAXBITS ? MAXMAX : (1 << nBits) - 1; }
        if (clear) { nBits = 9; maxcode = 511; clear = false; }
        let k = 0;
        while (k < nBits && inPos < src.length) buf[k++] = src[inPos++];
        buf[k] = buf[k + 1] = buf[k + 2] = 0;
        if (k <= 0) return -1;
        offset = 0;
        size = k * 8 - nBits + 1;
      }
      const p = offset >> 3, shift = offset & 7;
      const code = ((buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)) >>> shift) & ((1 << nBits) - 1);
      offset += nBits;
      return code;
    }
    const stack = new Uint8Array(MAXMAX + 1);
    let old = getcode();
    if (old < 0) return out.subarray(0, 0);
    let fin = old;
    out[o++] = old;
    for (let code = getcode(); code >= 0 && o < limit; code = getcode()) {
      if (code === 256) {
        prefix.fill(0, 0, 256);
        clear = true;
        freeEnt = 256;
        code = getcode();
        if (code < 0) break;
      }
      const incode = code;
      let sp = 0;
      if (code >= freeEnt) { stack[sp++] = fin; code = old; }
      while (code >= 256) { stack[sp++] = suffix[code]; code = prefix[code]; }
      fin = suffix[code];
      stack[sp++] = fin;
      while (sp > 0 && o < limit) out[o++] = stack[--sp];
      if (freeEnt < MAXMAX) { prefix[freeEnt] = old; suffix[freeEnt] = fin; freeEnt++; }
      old = incode;
    }
    return out.subarray(0, o);
  }

  // ---------- Z88C container ----------
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const isTag = (b, i, c) => b[i] === 0x5a && b[i + 1] === 0x38 && b[i + 2] === 0x38 && b[i + 3] === c.charCodeAt(0);

  function unpack(b, at = 0) {
    if (!isTag(b, at, "C")) throw new Error("not a Z88C container");
    const total = u32(b, at + 4), end = at + total;
    if (end > b.length || !isTag(b, end - 4, "C")) throw new Error("the show file is cut short");
    const version = u32(b, end - 8);
    const tr = version >= 3 ? end - 0x24 : end - 0x20;
    const count = u32(b, tr + (version >= 3 ? 16 : 12));
    const usize = u32(b, tr + (version >= 3 ? 20 : 16));
    const out = new Uint8Array(usize);
    let pos = at + 8, o = 0;
    for (let n = 0; n < count; n++) {
      let c, h;
      if (version >= 3) { c = u32(b, pos); h = 16; } else { c = u32(b, pos) & 0xffff; h = 12; }
      const method = b[pos + h], size = u32(b, pos + h + 1);
      const body = b.subarray(pos + h + 5, pos + h + c);
      let part;
      if (method === 0) part = body.subarray(0, size);
      else if (method === 2 || method === 3) part = lzw(body, size);
      else throw new Error(`unknown packing (${method}) — a newer ZerOS version?`);
      out.set(part.subarray(0, Math.min(part.length, usize - o)), o);
      o += part.length;
      pos += h + c;
    }
    return { data: out.subarray(0, Math.min(o, usize)), total };
  }

  // ---------- Z88B records (read backwards) ----------
  function parse(b, lo, hi, depth = 0) {
    const items = [];
    let pos = hi;
    while (pos - 8 >= lo) {
      const field = b[pos - 8], kind = b[pos - 7], section = b[pos - 6] | (b[pos - 5] << 8), raw = u32(b, pos - 4);
      const group = raw >>> 31, len = raw & 0x7fffffff, start = pos - 8 - len;
      if (start < lo) break;
      const node = { field, kind, section };
      if (field === 0xff && kind === 0xff && section === 0xffff) node.open = true;
      else if (group && depth < 40) node.kids = parse(b, start, pos - 8, depth + 1);
      else node.value = b.subarray(start, pos - 8);
      items.push(node);
      pos = start;
    }
    return items.reverse();
  }
  const kidsOf = (n, f = {}) => (n?.kids || []).filter(k => !k.open && (f.field == null || k.field === f.field) && (f.kind == null || k.kind === f.kind) && (f.section == null || k.section === f.section));
  const one = (n, field, extra = {}) => kidsOf(n, { field, ...extra })[0] || null;
  const int = v => { if (!v?.value) return null; let n = 0; for (let i = v.value.length - 1; i >= 0; i--) n = n * 256 + v.value[i]; return n; };
  const text = v => v?.value ? new TextDecoder("latin1").decode(v.value).replace(/\0+$/, "") : "";

  // ---------- What a channel is ----------
  const CODES = { 86: "r", 87: "g", 88: "b", 35: "w", 60: "amber", 67: "lime", 78: "cyan", 77: "warmWhite", 62: "coolWhite" };
  function attribute(name, code, code2) {
    const n = name.toLowerCase();
    if (CODES[code]) return CODES[code];
    if (CODES[code2]) return CODES[code2];
    if (code == null && /^(intensity|dimmer)$/.test(n)) return "dimmer";
    if (/^(intensity|dimmer)\b/.test(n) && !/curve|speed|mode/.test(n)) return "dimmer";
    if (/^pan\b/.test(n)) return /fine/.test(n) ? "panf" : "pan";
    if (/^tilt\b/.test(n)) return /fine/.test(n) ? "tiltf" : "tilt";
    if (/strobe|shutter/.test(n)) return "strobe";
    if (/^red\b/.test(n)) return "r";
    if (/^green\b/.test(n)) return "g";
    if (/^blue\b/.test(n)) return "b";
    if (/^white\b/.test(n)) return "w";
    if (/^amber\b/.test(n)) return "amber";
    if (/^lime\b/.test(n)) return "lime";
    if (/^(uv|ultra ?violet)\b/.test(n)) return "uv";
    if (/^cyan\b/.test(n)) return "cyan";
    if (/^magenta\b/.test(n)) return "magenta";
    if (/^yellow\b/.test(n)) return "yellow";
    if (/^cto\b|colour temp|color temp/.test(n)) return "cto";
    if (/^colou?r( wheel)?( ?1)?$/.test(n)) return "colour";
    if (/^gobo( wheel)?( ?1)?$/.test(n)) return "gobo";
    if (/^gobo( wheel)? ?2$/.test(n)) return "gobo2";
    if (/^gobo.*rot/.test(n)) return "gobor";
    if (/^prism\b/.test(n)) return /rot/.test(n) ? "prismr" : "prism";
    if (/^focus\b/.test(n)) return "focus";
    if (/^zoom\b/.test(n)) return "zoom";
    if (/^iris\b/.test(n)) return "iris";
    if (/^frost\b/.test(n)) return "frost";
    if (/^(macro|colour mix|color mix)/.test(n)) return null;
    return null;
  }

  function readType(node) {
    const id = int(one(node, 2));
    const info = one(node, 3);
    if (!info) return null;
    const name = text(one(info, 1)), mode = text(one(info, 3)), maker = text(one(info, 4)) || "Generic";
    const foot = one(info, 9);
    let channels = 0;
    for (const k of kidsOf(foot)) for (const x of kidsOf(k)) if (x.field === 2) channels = Math.max(channels, int(x) || 0);
    const list = [];
    for (const c of kidsOf(one(info, 0xa))) {
      const label = text(one(c, 1));
      if (!label) continue;
      const offset = int(one(c, 4)) ?? 1;
      list.push({ offset, label, code: int(one(c, 9)), code2: int(one(c, 0x11)), group: int(one(c, 2)) });
    }
    list.sort((a, b) => a.offset - b.offset);
    list.forEach((c, i) => { c.width = Math.max(1, Math.min(2, (list[i + 1]?.offset ?? channels + 1) - c.offset)); });
    channels = Math.max(channels, ...list.map(c => c.offset + c.width - 1), 1);
    return { id, name, mode, maker, channels, list };
  }

  // A matching Light Spark fixture, or a definition built from the show.
  function definitionFor(type) {
    const lib = window.FixtureLibrary || {};
    const words = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const model = words(type.name), maker = words(type.maker);
    const keys = Object.keys(lib).filter(k => words(k).includes(model) && (!maker || maker === "generic" || words(k).includes(maker) || words(lib[k]?.manufacturer).includes(maker)));
    const exact = keys.find(k => Number(lib[k]?.channels) === type.channels);
    if (exact) return { key: exact, matched: true };
    if (/^dimmer$/i.test(type.name) || (type.channels === 1 && type.list.every(c => attribute(c.label, c.code, c.code2) === "dimmer"))) {
      const dim = Object.keys(lib).find(k => /^generic dimmer$/i.test(k)) || Object.keys(lib).find(k => Number(lib[k]?.channels) === 1 && /dimmer/i.test(k));
      if (dim) return { key: dim, matched: true };
    }
    const map = {};
    for (const c of type.list) {
      const a = attribute(c.label, c.code, c.code2);
      if (!a || a in map) continue;
      map[a] = c.offset - 1;
      if (c.width === 2) {
        const fine = { dimmer: "dimmerFine", pan: "panf", tilt: "tiltf", r: "rFine", g: "gFine", b: "bFine" }[a];
        if (fine && !(fine in map)) map[fine] = c.offset;
      }
    }
    if (typeof map.dimmer === "number") map.intensity = map.dimmer;
    const rgb = ["r", "g", "b"].every(k => typeof map[k] === "number");
    const key = `${type.maker} ${type.name}${type.mode ? ` (${type.mode})` : ""} [FLX]`.replace(/\s+/g, " ").trim();
    return {
      key, matched: false,
      definition: {
        type: typeof map.pan === "number" ? "moving" : rgb ? "rgb" : "dimmer",
        channels: type.channels, map,
        photometrics: { verified: false, sourceType: "LED", ratedLumens: null, beamAngle: null, outputScale: 1 },
        manufacturer: type.maker, model: type.name, custom: true, fromZerOS: true,
        channelNames: type.list.map(c => ({ offset: c.offset, name: c.label }))
      }
    };
  }

  // ---------- Read a whole show ----------
  function read(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const raw = isTag(bytes, 0, "C") ? unpack(bytes).data : bytes;
    if (!isTag(raw, 0, "B")) throw new Error("this isn't a ZerOS show file");
    const top = parse(raw, 16, raw.length - 0x20);
    const name = text(top.find(n => n.section === 0 && n.field === 2 && n.value)) || "FLX show";
    const main = top.find(n => n.section === 0x10 && n.kids);
    const sec = id => main ? kidsOf(main, { section: id }).find(k => k.kids) : null;

    const types = new Map();
    for (const t of kidsOf(sec(0x18))) { const r = readType(t); if (r) types.set(r.id, r); }

    const fixtures = [];
    for (const f of kidsOf(sec(0x1c))) {
      const index = int(one(f, 1)), number = int(one(f, 8));
      const patch = kidsOf(one(f, 6))[0];
      fixtures.push({
        index, number: number ?? (index + 1), label: text(one(f, 3)), type: types.get(int(one(f, 4))) || null,
        addr: patch ? (int(one(patch, 1)) || null) : null, uni: patch ? (int(one(patch, 2)) || 0) + 1 : 1
      });
    }
    fixtures.sort((a, b) => a.number - b.number);

    const groups = [];
    for (const g of kidsOf(sec(0x1f))) {
      const members = [];
      for (const m of kidsOf(one(g, 0, { kind: 0x11 }))) {
        const ref = kidsOf(m).find(k => k.kids);
        const num = ref ? int(kidsOf(ref).find(x => x.field === 1 && x.value)) : null;
        if (num != null) members.push({ order: int(one(m, 0x12)) ?? 0, num });
      }
      members.sort((a, b) => a.num - b.num);
      groups.push({ id: int(one(g, 1)), name: text(one(g, 2)), members: members.map(m => m.num), auto: int(one(g, 7)) === 1 });
    }
    groups.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    const palettes = [];
    const KINDS = { 0x50: "Intensity", 0x10: "Colour", 0x20: "Beam", 0x30: "Position", 0x40: "Effect" };
    for (const p of kidsOf(sec(0x1d))) {
      const kind = KINDS[p.kind];
      if (!kind || !p.kids) continue;
      for (const e of kidsOf(p)) { const n = text(one(e, 0xb)); if (n) palettes.push({ kind, id: int(one(e, 1)), name: n }); }
    }

    const playbacks = [];
    const stacks = top.find(n => n.section === 0x50 && n.kids);
    const byIndex = new Map(fixtures.map(f => [f.index, f]));
    for (const pb of kidsOf(stacks)) {
      const label = text(one(pb, 2));
      if (/^grand master$/i.test(label)) continue;
      const cues = [];
      for (const c of kidsOf(one(pb, 0, { kind: 0x10 }))) {
        const n = int(one(c, 1));
        const levels = [];
        for (const holder of kidsOf(one(c, 0xf))) {
          for (const fx of kidsOf(holder).filter(k => k.kids)) {
            const fixture = byIndex.get(int(one(fx, 1)));
            if (!fixture) continue;
            for (const pv of kidsOf(one(fx, 0, { kind: 0x11 }))) {
              const param = int(kidsOf(pv).find(k => k.field === 0x11 && k.value));
              const value = int(kidsOf(pv).find(k => k.field === 0x10 && k.value));
              if (param === 0 && value != null) levels.push({ number: fixture.number, intensity: Math.round(value / 655.35) });
            }
          }
        }
        cues.push({
          number: n != null ? n / 100 : cues.length + 1, name: text(one(c, 2)),
          up: int(one(c, 0xd)), down: int(one(c, 0x1e)), levels
        });
      }
      playbacks.push({ number: int(one(pb, 1)), name: label, cues });
    }
    playbacks.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    return { name, fixtures, types: [...types.values()], groups, palettes, playbacks };
  }

  // ---------- Turn it into a Light Spark show ----------
  function toShow(z) {
    const custom = {};
    const defs = new Map();
    let matched = 0, rebuilt = 0;
    const fixtures = [];
    for (const f of z.fixtures) {
      if (!f.type || !f.addr) continue;
      let d = defs.get(f.type.id);
      if (!d) {
        d = definitionFor(f.type);
        defs.set(f.type.id, d);
        if (d.matched) matched++; else { rebuilt++; custom[d.key] = d.definition; }
      }
      fixtures.push({ id: `zos-${f.number}`, name: d.key, uni: f.uni, addr: f.addr, fixtureNumber: f.number, label: f.label && f.label !== f.type.name ? f.label : undefined });
    }
    const have = new Set(fixtures.map(f => f.fixtureNumber));
    const groups = z.groups.filter(g => g.name && !g.auto).map(g => ({ name: g.name, members: g.members.filter(n => have.has(n)) })).filter(g => g.members.length);
    const cues = [];
    const pb = z.playbacks.find(p => p.cues.length) || null;
    if (pb) {
      for (const c of pb.cues) {
        const states = c.levels.filter(l => have.has(l.number)).map(l => [`zos-${l.number}`, { intensity: l.intensity }]);
        cues.push({
          name: c.name || `Cue ${c.number}`, number: c.number, fade: c.up ?? 3000,
          timing: { up: c.up ?? 3000, down: c.down ?? c.up ?? 3000 },
          follow: 0, followEnabled: false, mode: "track", fixtureStates: states, state: {}, globalState: {}
        });
      }
    }
    return {
      show: {
        format: "lx-console-show", version: 8, savedAt: new Date().toISOString(),
        fixtures, groups, cues, chases: [], savedEffects: [], palettes: [], fixtureStates: [], selected: [],
        current: { __lxCustomFixtures: custom }, currentCue: -1
      },
      custom, matched, rebuilt, playback: pb, skipped: z.fixtures.length - fixtures.length
    };
  }

  async function openFile(file) {
    const z = read(await file.arrayBuffer());
    const r = toShow(z);
    const others = z.playbacks.filter(p => p.cues.length && p !== r.playback).length;
    const ok = await window.LXAsk?.(`Open FLX show “${z.name}”`, [], {
      ok: "Open",
      safe: true,
      message: `${z.fixtures.length} lights, ${r.show.groups.length} groups, ${r.show.cues.length} cues${r.playback ? ` (from playback ${r.playback.number}${r.playback.name ? ` “${r.playback.name}”` : ""})` : ""}, ${z.palettes.filter(p => p.kind !== "Intensity").length} palette names (names only for now). This replaces the show that's open now — save it first if you want to keep it. Brightness comes across; colour and position in cues aren't read yet.`
    });
    if (window.LXAsk && !ok) { say("Open FLX show cancelled — nothing was changed", "info"); return null; }
    try { for (const [k, d] of Object.entries(r.custom)) window.FixtureLibrary[k] = JSON.parse(JSON.stringify(d)); } catch (_) {}
    window.LXShowCommands?.restore?.(r.show);
    try { window.renderLibrary?.(); } catch (_) {}
    say(`Opened FLX show “${z.name}”: ${r.show.fixtures.length} lights (${r.matched} fixture type${r.matched === 1 ? "" : "s"} from Light Spark's library, ${r.rebuilt} rebuilt from the show), ${r.show.groups.length} groups, ${r.show.cues.length} cues`, "ok");
    if (r.skipped) say(`${r.skipped} light${r.skipped === 1 ? " wasn't" : "s weren't"} patched on the desk, so ${r.skipped === 1 ? "it was" : "they were"} left out`, "warn");
    if (others) say(`${others} more playback${others === 1 ? "" : "s"} with cues on the desk — only the first came across`, "info");
    return { z, r };
  }

  function choose() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zos,.isf";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (file) openFile(file).catch(e => { console.error("[ZOS]", e); say(`Couldn't open that FLX show: ${e.message || e}`, "error"); });
    });
    document.body.appendChild(input);
    input.click();
  }

  function command(c) {
    if (/^(open|load|import) (flx|zeros|zos)( show)?$/.test(c)) { choose(); return true; }
    return false;
  }

  window.LXZos = { lzw, unpack, parse, read, toShow, open: choose, openFile, command };
})();
