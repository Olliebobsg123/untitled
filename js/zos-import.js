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
 * In a cue, each light lists channel values: field 0x11 = the channel's index
 * in its fixture type (the type's channel list, field 0; not always
 * brightness), field 0x10 = the value, 0–65535. Cues hold only what changed.
 *
 * Opening brings in every light (number, name, type, address, universe), the
 * fixture types (matched to Light Spark's library, or rebuilt from the show's
 * own channel list), groups, palette names, and cues with times, brightness
 * and colour.
 *
 * Saving writes Light Spark's patch addresses and cues (the exact DMX of every
 * look, per channel) into the FLX show opened last, keeping its setup, fixture
 * types and palettes. Segment checks: a = rot(unpacked), b = rot(packed),
 * where rot adds each byte then rotates left by one. Re-saving a desk file
 * unchanged gives the same bytes.
 *
 * App menu → Open FLX show (.zos)… / Save as FLX show (.zos)…, or
 * "open flx" / "save flx".
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
      const node = { field, kind, section, raw };
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
      list.push({ index: int(one(c, 0)) ?? 0, offset, label, code: int(one(c, 9)), code2: int(one(c, 0x11)), group: int(one(c, 2)) });
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
    if (exact) {
      // Channels the desk uses that Light Spark's version doesn't drive
      // (e.g. amber / lime on some profiles): add them so cues look the same.
      const libMap = lib[exact].map || {};
      const extra = {};
      for (const c of type.list) {
        const a = attribute(c.label, c.code, c.code2);
        if (a && !(a in libMap) && !(a in extra) && a !== "strobe") extra[a] = c.offset - 1;
      }
      if (!Object.keys(extra).length) return { key: exact, matched: true };
      return { key: `${exact} [FLX]`, matched: false, definition: { ...JSON.parse(JSON.stringify(lib[exact])), map: { ...libMap, ...extra }, custom: true, fromZerOS: true } };
    }
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
            const params = {};
            for (const pv of kidsOf(one(fx, 0, { kind: 0x11 }))) {
              const param = int(kidsOf(pv).find(k => k.field === 0x11 && k.value)) ?? 0;
              const value = int(kidsOf(pv).find(k => k.field === 0x10 && k.value));
              if (value != null) params[param] = value;
            }
            if (Object.keys(params).length) levels.push({ number: fixture.number, params });
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

  // r, g, b (0-255) → Light Spark's hue / sat / light (light 50 = full colour).
  function hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, sat = 0;
    if (max !== min) {
      const d = max - min;
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    const r1 = x => Math.round(x * 100) / 100;
    return { hue: r1(h), sat: r1(sat * 100), light: r1(l * 100) };
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
      // Cues on the desk only hold what changed (tracking): carry each light's
      // state forward so colour mixes stay whole.
      const byNumber = new Map(z.fixtures.map(f => [f.number, f]));
      const tracked = new Map();
      for (const c of [...pb.cues].sort((a, b) => a.number - b.number)) {
        const states = [];
        for (const l of c.levels) {
          const f = byNumber.get(l.number);
          if (!f || !have.has(l.number)) continue;
          const st = tracked.get(l.number) || { intensity: 0, rgb: null };
          for (const [idx, v] of Object.entries(l.params)) {
            const ch = f.type?.list.find(x => x.index === Number(idx));
            const a = ch ? attribute(ch.label, ch.code, ch.code2) : null;
            const b8 = Math.round(v / 257);
            if (a === "dimmer") st.intensity = Math.round(v / 65.535) / 10;
            else if (a === "r" || a === "g" || a === "b") { st.rgb = st.rgb || [0, 0, 0]; st.rgb["rgb".indexOf(a)] = b8; }
            else if (a && a !== "strobe") st[a] = b8;
          }
          if (!f.type?.list.some(x => attribute(x.label, x.code, x.code2) === "dimmer") && st.rgb) st.intensity = 100;
          tracked.set(l.number, st);
          const out = { intensity: st.intensity };
          if (st.rgb) Object.assign(out, hsl(st.rgb));
          for (const [k, v] of Object.entries(st)) if (k !== "intensity" && k !== "rgb") out[k] = v;
          states.push([`zos-${l.number}`, out]);
        }
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
    const bytes = new Uint8Array(await file.arrayBuffer());
    const z = read(bytes);
    const r = toShow(z);
    const others = z.playbacks.filter(p => p.cues.length && p !== r.playback).length;
    const ok = await window.LXAsk?.(`Open FLX show “${z.name}”`, [], {
      ok: "Open",
      safe: true,
      message: `${z.fixtures.length} lights, ${r.show.groups.length} groups, ${r.show.cues.length} cues${r.playback ? ` (from playback ${r.playback.number}${r.playback.name ? ` “${r.playback.name}”` : ""})` : ""}, ${z.palettes.filter(p => p.kind !== "Intensity").length} palette names (names only for now). This replaces the show that's open now — save it first if you want to keep it. Brightness and colour come across.`
    });
    if (window.LXAsk && !ok) { say("Open FLX show cancelled — nothing was changed", "info"); return null; }
    try { for (const [k, d] of Object.entries(r.custom)) window.FixtureLibrary[k] = JSON.parse(JSON.stringify(d)); } catch (_) {}
    window.LXShowCommands?.restore?.(r.show);
    keepBase(bytes, z.name);
    try { window.renderLibrary?.(); } catch (_) {}
    say(`Opened FLX show “${z.name}”: ${r.show.fixtures.length} lights (${r.matched} fixture type${r.matched === 1 ? "" : "s"} from Light Spark's library, ${r.rebuilt} rebuilt from the show), ${r.show.groups.length} groups, ${r.show.cues.length} cues`, "ok");
    if (r.skipped) say(`${r.skipped} light${r.skipped === 1 ? " wasn't" : "s weren't"} patched on the desk, so ${r.skipped === 1 ? "it was" : "they were"} left out`, "warn");
    if (others) say(`${others} more playback${others === 1 ? "" : "s"} with cues on the desk — only the first came across`, "info");
    return { z, r };
  }


  // =====================================================================
  // Saving: write a ZerOS show. Light Spark keeps the FLX show it opened
  // (or one you pick) as the base, and writes its patch and cues into it, so
  // everything else the desk expects (setup, fixture types, palettes) stays.
  // =====================================================================

  // Unix compress (16 bit, block mode) — byte-for-byte what the desk writes.
  function lzwEncode(src) {
    const MAXBITS = 16, MAXMAX = 1 << MAXBITS, HSIZE = 69001;
    const htab = new Int32Array(HSIZE).fill(-1), codetab = new Uint16Array(HSIZE);
    const out = [];
    let nBits = 9, maxcode = 511, freeEnt = 257, offset = 0;
    const buf = new Uint8Array(MAXBITS + 2);
    const flush = n => { for (let i = 0; i < n; i++) out.push(buf[i]); buf.fill(0); };
    function output(code) {
      if (code >= 0) {
        const r = offset & 7;
        let bp = offset >> 3, c = code, bits = nBits;
        buf[bp] |= (c << r) & 0xff; c >>= 8 - r; bits -= 8 - r; bp++;
        while (bits > 0) { buf[bp++] |= c & 0xff; c >>= 8; bits -= 8; }
        offset += nBits;
        if (offset === nBits << 3) { flush(nBits); offset = 0; }
        if (freeEnt > maxcode) {
          if (offset > 0) { flush(nBits); offset = 0; }
          nBits++;
          maxcode = nBits === MAXBITS ? MAXMAX : (1 << nBits) - 1;
        }
      } else if (offset > 0) { flush((offset + 7) >> 3); offset = 0; }
    }
    if (!src.length) return new Uint8Array(0);
    let ent = src[0];
    for (let i = 1; i < src.length; i++) {
      const c = src[i], fcode = (c << MAXBITS) + ent;
      let h = ((c << 8) ^ ent) % HSIZE, found = false;
      while (htab[h] !== -1) {
        if (htab[h] === fcode) { ent = codetab[h]; found = true; break; }
        h -= h === 0 ? 1 : HSIZE - h;
        h = (h + HSIZE) % HSIZE;
      }
      if (found) continue;
      output(ent);
      ent = c;
      if (freeEnt < MAXMAX) { codetab[h] = freeEnt++; htab[h] = fcode; }
    }
    output(ent); output(-1);
    return Uint8Array.from(out);
  }

  // The desk's check: add each byte, then rotate left by one.
  function rot(bytes) { let c = 0; for (let i = 0; i < bytes.length; i++) { c = (c + bytes[i]) >>> 0; c = ((c << 1) | (c >>> 31)) >>> 0; } return c; }
  const le32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
  function joinBytes(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // Records back to bytes: children (or the value) first, then the 8-byte tag.
  function serialize(nodes, parts) {
    let total = 0;
    for (const n of nodes) {
      const t = new Uint8Array(8);
      if (n.open) { t.set([0xff, 0xff, 0xff, 0xff]); parts.push(t); total += 8; continue; }
      let len;
      if (n.kids) len = serialize(n.kids, parts);
      else { parts.push(n.value); len = n.value.length; }
      const group = n.kids ? 0x80000000 : ((n.raw ?? 0) & 0x80000000);
      t[0] = n.field; t[1] = n.kind; t[2] = n.section & 0xff; t[3] = n.section >> 8;
      new DataView(t.buffer).setUint32(4, (len | group) >>> 0, true);
      parts.push(t);
      total += len + 8;
    }
    return total;
  }

  function dosTime(d = new Date()) {
    return (((((((d.getFullYear() - 1999) << 4 | (d.getMonth() + 1)) << 5 | d.getDate()) << 5 | d.getHours()) << 6 | d.getMinutes()) << 5) | (d.getSeconds() >> 1)) >>> 0;
  }

  // A whole Z88B block: the base's 16-byte header, the records, a fresh trailer.
  function writeData(base, top, keepTime = false) {
    const parts = [base.subarray(0, 16)];
    const len = serialize(top, parts) + 16 + 0x20;
    const trailer = base.slice(base.length - 0x20);
    const dv = new DataView(trailer.buffer);
    if (!keepTime) dv.setUint32(0, dosTime(), true);
    dv.setUint32(8, len, true);
    parts.push(trailer);
    return joinBytes(parts);
  }

  // Pack into a Z88C container, 16 KB segments, as the desk does.
  function pack(raw) {
    const SEG = 0x4000, parts = [new Uint8Array(8)], starts = [];
    let pos = 8;
    for (let i = 0; i < raw.length || i === 0; i += SEG) {
      const chunk = raw.subarray(i, i + SEG);
      const body = joinBytes([Uint8Array.of(3), le32(chunk.length), lzwEncode(chunk)]);
      const head = joinBytes([le32((body.length & 0xffff) | (chunk.length << 16)), le32(rot(chunk)), le32(rot(body))]);
      starts.push(pos);
      parts.push(head, body);
      pos += head.length + body.length;
      if (!raw.length) break;
    }
    const table = joinBytes(starts.map(le32));
    const total = pos + table.length + 0x20;
    const trailer = joinBytes([le32(total), le32(SEG << 16), le32(pos), le32(starts.length), le32(raw.length), le32(2), le32(2), Uint8Array.of(0x5a, 0x38, 0x38, 0x43)]);
    parts.push(table, trailer);
    const out = joinBytes(parts);
    out.set([0x5a, 0x38, 0x38, 0x43], 0);
    out.set(le32(total), 4);
    return out;
  }

  const intBytes = v => { v = Math.max(0, Math.round(Number(v) || 0)); const b = []; do { b.push(v & 0xff); v = Math.floor(v / 256); } while (v > 0); return Uint8Array.from(b); };
  const clone = n => n.open ? { open: true } : n.kids ? { ...n, kids: n.kids.map(clone) } : { ...n, value: n.value.slice() };
  const setInt = (n, field, v, extra) => { const k = one(n, field, extra); if (k) k.value = intBytes(v); return !!k; };

  // The base show: the FLX show opened last (kept on this Mac).
  let base = null;
  const BASE_KEY = "lx-zos-base";
  function keepBase(bytes, name) {
    base = { bytes: bytes.slice(), name };
    try {
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      localStorage.setItem(BASE_KEY, JSON.stringify({ name, data: btoa(bin) }));
    } catch (_) {}
  }
  function loadBase() {
    if (base) return base;
    try {
      const saved = JSON.parse(localStorage.getItem(BASE_KEY) || "null");
      if (saved?.data) { const bin = atob(saved.data); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); base = { bytes: b, name: saved.name }; }
    } catch (_) {}
    return base;
  }

  // Light Spark's show written into the base show's records.
  function build(baseBytes, opts = {}) {
    const S = window.State || {};
    const raw = isTag(baseBytes, 0, "C") ? unpack(baseBytes).data : baseBytes;
    const top = parse(raw, 16, raw.length - 0x20);
    const z = read(raw);
    const main = top.find(n => n.section === 0x10 && n.kids);
    const sec = id => main ? kidsOf(main, { section: id }).find(k => k.kids) : null;
    const name = String(opts.name || window.LXShowCommands?.name?.() || z.name).replace(/\.json$/i, "").replace(/[^\x20-\x7e]/g, "").slice(0, 31) || z.name;
    const nameNode = top.find(n => n.section === 0 && n.field === 2 && n.value);
    if (nameNode) nameNode.value = new TextEncoder().encode(name);

    // Patch: pair each light on the desk with a Light Spark light of the
    // same type — at the same address first, then with the same number. A
    // desk light is never moved onto a light of another type, and nothing is
    // written if two lights would end up on the same channels.
    const words = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const lsLights = (S.fixtures || []).filter(f => f && f.addr != null);
    // looseName: at the same address, the same channel count is enough
    // (names differ between libraries, e.g. "MKII" / "MKIII").
    const sameType = (d, ls, looseName = false) => {
      if (!d.type) return false;
      const def = window.getFixtureDefinition?.(ls) || window.FixtureLibrary?.[ls.name] || {};
      const chans = Number(def.channels ?? def.channelCount);
      if (Number.isFinite(chans) && chans !== d.type.channels) return false;
      if (looseName && Number.isFinite(chans)) return true;
      const model = words(d.type.name);
      return words(ls.name).includes(model) || words(def.model).includes(model) || (/^dimmer$/.test(model) && chans === 1 && /dimmer/.test(words(ls.name)));
    };
    const at = f => `${Math.max(1, Number(f.uni) || 1)}/${Number(f.addr)}`;
    const pair = new Map(); // desk fixture → Light Spark fixture
    const used = new Set();
    for (const d of z.fixtures) {
      if (!d.addr) continue;
      const ls = lsLights.find(l => !used.has(l) && at(l) === at(d) && sameType(d, l, true));
      if (ls) { pair.set(d, ls); used.add(ls); }
    }
    for (const d of z.fixtures) {
      if (pair.has(d)) continue;
      const ls = lsLights.find(l => !used.has(l) && Number(l.fixtureNumber) === d.number && sameType(d, l));
      if (ls) { pair.set(d, ls); used.add(ls); }
    }
    // Desk lights Light Spark doesn't have are unpatched (kept in the list,
    // since the desk's palettes and groups still refer to them, but given no
    // address), so the desk ends up with just Light Spark's lights patched.
    const nodeByNumber = new Map(kidsOf(sec(0x1c)).map(n => [int(one(n, 8)), n]));
    let unpatched = 0;
    for (const d of z.fixtures) {
      if (!d.addr || pair.has(d)) continue;
      const node = nodeByNumber.get(d.number);
      if (!node?.kids) continue;
      node.kids = node.kids.filter(k => !(k.field === 6 && k.kids));
      d.addr = null;
      unpatched++;
    }
    // Where every desk light will be, and whether any overlap.
    const place = new Map([...pair].map(([d, ls]) => [d, { uni: Math.max(1, Number(ls.uni) || 1), addr: Number(ls.addr) }]));
    const spans = [...place].map(([d, p]) => ({ d, uni: p.uni, from: p.addr, to: p.addr + Math.max(1, d.type?.channels || 1) - 1 })).sort((a, b) => a.uni - b.uni || a.from - b.from);
    const clashes = [];
    for (let i = 1; i < spans.length; i++) {
      const a = spans[i - 1], b = spans[i];
      if (a.uni === b.uni && b.from <= a.to) clashes.push(`${a.d.number} and ${b.d.number} (address ${b.from})`);
    }
    if (clashes.length) throw new Error(`lights would share DMX channels on the desk: ${clashes.slice(0, 6).join(", ")}${clashes.length > 6 ? "…" : ""}. Light Spark and the FLX show have different lights at those addresses — patch the desk to match (or fix the patch here), then try again`);
    let moved = 0;
    for (const [d, ls] of pair) {
      const p = place.get(d);
      if (p.addr === d.addr && p.uni === d.uni) continue;
      const patch = kidsOf(one(nodeByNumber.get(d.number), 6))[0];
      if (!patch || !setInt(patch, 1, p.addr)) throw new Error(`couldn't move light ${d.number} on the desk patch`);
      if (!setInt(patch, 2, p.uni - 1) && p.uni > 1) throw new Error(`couldn't move light ${d.number} to universe ${p.uni}`);
      d.addr = p.addr; d.uni = p.uni; moved++;
    }
    const renumbered = [...pair].filter(([d, ls]) => Number(ls.fixtureNumber) !== d.number).map(([d, ls]) => `${ls.fixtureNumber}→${d.number}`);
    const missing = lsLights.filter(l => !used.has(l)).map(l => l.fixtureNumber);

    // Cues: into the playback that has the most cues.
    const stacks = top.find(n => n.section === 0x50 && n.kids);
    const pbs = kidsOf(stacks).filter(pb => !/^grand master$/i.test(text(one(pb, 2))) && one(pb, 0, { kind: 0x10 }));
    const pb = pbs.sort((a, b) => kidsOf(one(b, 0, { kind: 0x10 })).length - kidsOf(one(a, 0, { kind: 0x10 })).length)[0];
    const list = pb ? one(pb, 0, { kind: 0x10 }) : null;
    const proto = list ? kidsOf(list)[0] : null;
    if (!proto) throw new Error("the FLX show needs at least one cue in a playback to copy from — record one cue on the desk, save, and use that file");

    // Shapes to copy: a cue's "lights" holder, one light, one channel value.
    let entryProto = null, paramProto = null;
    for (const c of kidsOf(list)) for (const h of kidsOf(one(c, 0xf))) for (const e of kidsOf(h)) {
      const pg = one(e, 0, { kind: 0x11 });
      const pr = kidsOf(pg).find(r => kidsOf(r).length === 2 && one(r, 0x11) && one(r, 0x10));
      if (!entryProto && pg) entryProto = e;
      if (!paramProto && pr) paramProto = pr;
    }
    if (!entryProto || !paramProto) throw new Error("couldn't find a lit light in the FLX show's cues to copy the layout from");

    const looks = (S.cues || []).map((cue, i) => ({ cue, i })).filter(x => x.cue);
    const fixturesForCue = z.fixtures.filter(f => f.type && f.addr && pair.has(f));
    const newCues = [];
    for (const { cue, i } of looks) {
      const look = window.cueLook?.(i)?.fixtureMap || new Map();
      const dmx = window.LXAscii?.dmxFor?.(look);
      if (!dmx) throw new Error("couldn't work out the cue levels");
      const c = clone(proto);
      const number = Number(window.cueLabel ? window.cueLabel(i) : i + 1) || (i + 1);
      setInt(c, 1, Math.round(number * 100));
      const timing = cue.timing && typeof cue.timing === "object" ? cue.timing : {};
      const up = timing.up ?? cue.fade ?? 3000, down = timing.down ?? cue.fade ?? 3000;
      setInt(c, 0xd, up); setInt(c, 0x1e, down); setInt(c, 0xb, up);
      const holder = kidsOf(one(c, 0xf))[0];
      const entries = [];
      for (const f of fixturesForCue.sort((a, b) => a.index - b.index)) {
        const baseAddr = (f.uni - 1) * 512 + f.addr - 1;
        const params = [];
        for (const ch of f.type.list) {
          if (!attribute(ch.label, ch.code, ch.code2)) continue;
          const at = baseAddr + ch.offset - 1;
          const v = ch.width === 2 ? dmx[at] * 256 + dmx[at + 1] : dmx[at] * 257;
          const r = clone(paramProto);
          setInt(r, 0x11, ch.index); setInt(r, 0x10, v);
          params.push(r);
        }
        if (!params.length) continue;
        const e = clone(entryProto);
        setInt(e, 1, f.index);
        const pg = one(e, 0, { kind: 0x11 });
        pg.kids = [{ open: true }, ...params];
        entries.push(e);
      }
      holder.kids = [{ open: true }, ...entries];
      newCues.push({ number, node: c });
    }
    // The desk writes cues last-first.
    newCues.sort((a, b) => b.number - a.number);
    list.kids = [{ open: true }, ...newCues.map(x => x.node)];

    const data = writeData(raw, top);
    return { bytes: pack(data), name, cues: newCues.length, lights: fixturesForCue.length, moved, missing, renumbered, unpatched };
  }

  function download(bytes, file) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function saveWith(b) {
    const ok = await window.LXAsk?.("Save as FLX show", [], {
      ok: "Save .zos",
      message: `Saves your cues and patch into “${b.name}” (the FLX show you opened last), keeping its setup, fixture types and palettes. Each light is matched to a light of the same type on the desk (same address, or same number); lights the desk show doesn't have are left out, and nothing is saved if two lights would share channels. Test it on the desk with the school's show saved to USB first — loading replaces the whole show on the desk.`
    });
    if (window.LXAsk && !ok) return null;
    try {
      const r = build(b.bytes);
      const file = `${r.name.replace(/[^\w .-]/g, "") || "Light Spark"}.zos`;
      download(r.bytes, file);
      say(`${file} saved to your Downloads folder: ${r.cues} cues for ${r.lights} lights${r.moved ? `, ${r.moved} address change${r.moved === 1 ? "" : "s"}` : ""}${r.unpatched ? `, ${r.unpatched} desk light${r.unpatched === 1 ? "" : "s"} Light Spark doesn't have unpatched` : ""}. Copy it to a USB stick → FLX S: Setup → Load File`, "ok");
      if (r.renumbered.length) say(`Some lights have different numbers on the desk (Light Spark → desk): ${r.renumbered.slice(0, 12).join(", ")}${r.renumbered.length > 12 ? "…" : ""}`, "info");
      if (r.missing.length) say(`Light${r.missing.length === 1 ? "" : "s"} ${r.missing.slice(0, 12).join(", ")}${r.missing.length > 12 ? "…" : ""} ${r.missing.length === 1 ? "isn't" : "aren't"} in the FLX show, so ${r.missing.length === 1 ? "it was" : "they were"} left out — patch ${r.missing.length === 1 ? "it" : "them"} on the desk, save, open that here, then save again`, "warn");
      return r;
    } catch (e) {
      console.error("[ZOS] save", e);
      say(`Couldn't save the FLX show: ${e.message || e}`, "error");
      return null;
    }
  }

  function save() {
    const b = loadBase();
    if (b) return saveWith(b);
    say("Pick an FLX show from the desk to save into (it keeps the desk's setup and fixture types)", "info");
    pickFile(async file => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      read(bytes);
      keepBase(bytes, file.name.replace(/\.zos$/i, ""));
      saveWith(base);
    });
  }

  function pickFile(then) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zos";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (file) Promise.resolve(then(file)).catch(e => { console.error("[ZOS]", e); say(`Couldn't use that FLX show: ${e.message || e}`, "error"); });
    });
    document.body.appendChild(input);
    input.click();
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
    if (/^(save|export) (as )?(flx|zeros|zos)( show)?$/.test(c)) { save(); return true; }
    return false;
  }

  window.LXZos = { lzw, lzwEncode, unpack, parse, read, toShow, serialize, writeData, pack, build, open: choose, openFile, save, command, base: loadBase };
})();
