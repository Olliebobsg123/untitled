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
 * Opening: each light gets the desk's own channel layout (so every channel
 * lines up), starts at the desk's home values (field 8 of each channel —
 * colour channels are usually full), and every cue holds the light's whole
 * state, worked out from the desk's tracking.
 *
 * Saving: only lights that came from this file are matched (id zos-i<position>,
 * or zos-<number> from older versions); nothing is matched by guessing. Each
 * cue starts as the desk's own cue with that number, and only channel values
 * that differ from what the desk would output are written — effects, macros
 * and everything Light Spark doesn't control stay exactly as they were.
 * A patch where lights would share channels is refused. Segment checks:
 * a = rot(unpacked), b = rot(packed), where rot adds each byte then rotates
 * left by one. Saving with nothing changed gives the desk's file back.
 *
 * App menu → Open FLX show (.zos)… / Save as FLX show (.zos)…, or
 * "open flx" / "save flx".
 */
(function () {
  if (window.LXZos) return;
  const say = (m, t = "ok") => window.log?.(m, t);

  // ---------- Unix compress LZW (as ZerOS reads it) ----------
  function lzw(src, limit) {
    limit = Math.max(0, Math.min(Number(limit) || 0, MAX_SEGMENT));
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
      // A code past the next free one can't be in a real file: it's damaged
      // (and following it could loop for ever).
      if (code > freeEnt || (code === freeEnt && old < 0)) throw new Error("the show file is damaged (bad packed data)");
      if (code >= freeEnt) { stack[sp++] = fin; code = old; }
      while (code >= 256) {
        if (sp >= MAXMAX) throw new Error("the show file is damaged (bad packed data)");
        stack[sp++] = suffix[code]; code = prefix[code];
      }
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

  // Limits, so a damaged (or deliberately odd) file can't use up memory or
  // send the reader past the end: real shows unpack to well under 4 MB, in
  // segments of at most 64 KB.
  const MAX_SHOW = 64 * 1024 * 1024, MAX_SEGMENT = 0x10000, MAX_SEGMENTS = 4096;

  // Unpack a Z88C container. damaged: segments whose desk checks don't match.
  function unpack(b, at = 0, depth = 0) {
    if (depth > 4) throw new Error("the show file is nested too deeply to be real");
    if (!isTag(b, at, "C") || at + 8 > b.length) throw new Error("not a Z88C container");
    const total = u32(b, at + 4), end = at + total;
    if (total < 0x28 || end > b.length || !isTag(b, end - 4, "C")) throw new Error("the show file is cut short or damaged");
    const version = u32(b, end - 8);
    const tr = version >= 3 ? end - 0x24 : end - 0x20;
    if (tr < at + 8) throw new Error("the show file is damaged (its index is missing)");
    const count = u32(b, tr + (version >= 3 ? 16 : 12));
    const usize = u32(b, tr + (version >= 3 ? 20 : 16));
    if (count > MAX_SEGMENTS || usize > MAX_SHOW) throw new Error("the show file says it's far bigger than any real show — it's damaged");
    const out = new Uint8Array(usize);
    const damaged = [];
    let pos = at + 8, o = 0;
    for (let n = 0; n < count; n++) {
      let c, h, sumRaw, sumPacked;
      if (version >= 3) { c = u32(b, pos); h = 16; sumRaw = u32(b, pos + 8); sumPacked = u32(b, pos + 12); }
      else { c = u32(b, pos) & 0xffff; h = 12; sumRaw = u32(b, pos + 4); sumPacked = u32(b, pos + 8); }
      if (c < 5 || pos + h + c > tr) throw new Error(`the show file is damaged (part ${n + 1} runs past the end)`);
      const packed = b.subarray(pos + h, pos + h + c);
      const method = packed[0], size = u32(packed, 1);
      if (size > MAX_SEGMENT || o + size > usize) throw new Error(`the show file is damaged (part ${n + 1} is the wrong size)`);
      const body = packed.subarray(5);
      let part;
      if (method === 0) part = body.subarray(0, size);
      else if (method === 2 || method === 3) part = lzw(body, size);
      else throw new Error(`unknown packing (${method}) — a newer ZerOS version?`);
      if (part.length !== size || rot(packed) !== sumPacked || rot(part) !== sumRaw) damaged.push(n + 1);
      out.set(part.subarray(0, Math.min(part.length, usize - o)), o);
      o += part.length;
      pos += h + c;
    }
    if (o !== usize) damaged.push("size");
    return { data: out.subarray(0, Math.min(o, usize)), total, damaged };
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

  // ---------- Palettes and cue values ----------
  // A palette holds values per light: kids → [0x71 holder] → light entries
  // (field 1 = the light's position) → channel records (0x11 = channel
  // index, 0x10 = value). A cue value with field 0x12 is a reference: 0x12
  // = palette kind (1 colour, 2 beam, 3 position, 4 effect, 5 intensity),
  // 0x10 = the palette's number.
  const PALETTE_KIND = { 1: 0x10, 2: 0x20, 3: 0x30, 4: 0x40, 5: 0x50 };
  function paletteValues(main) {
    const out = new Map(); // "kind:id" → Map(light position → Map(channel → value))
    const sec = main ? kidsOf(main, { section: 0x1d }).find(k => k.kids) : null;
    for (const group of kidsOf(sec)) {
      if (!group.kids) continue;
      for (const e of kidsOf(group)) {
        const id = int(one(e, 1));
        const lights = new Map();
        for (const holder of kidsOf(one(e, 0xa))) for (const fx of kidsOf(holder).filter(k => k.kids)) {
          const m = new Map();
          for (const r of kidsOf(one(fx, 0, { kind: 0x11 }))) {
            const v = int(kidsOf(r).find(k => k.field === 0x10 && k.value));
            if (v != null && !kidsOf(r).some(k => k.field === 0x12)) m.set(int(kidsOf(r).find(k => k.field === 0x11 && k.value)) ?? 0, v);
          }
          lights.set(int(one(fx, 1)) ?? 0, m);
        }
        out.set(`${group.kind}:${id}`, lights);
      }
    }
    return out;
  }
  // A cue's channel record → its value (looking palettes up), or null.
  function recordValue(r, light, palettes) {
    const param = int(kidsOf(r).find(k => k.field === 0x11 && k.value)) ?? 0;
    const raw = int(kidsOf(r).find(k => k.field === 0x10 && k.value));
    const ref = kidsOf(r).find(k => k.field === 0x12 && k.value);
    if (raw == null) return { param, value: null };
    if (!ref) return { param, value: raw };
    const kind = PALETTE_KIND[int(ref)];
    const v = kind != null ? palettes.get(`${kind}:${raw}`)?.get(light)?.get(param) : undefined;
    return { param, value: v ?? null, palette: { kind: int(ref), id: raw } };
  }

  // Palette kinds Light Spark has (Colour / Beam / Position) and the
  // channels each holds.
  const PALETTE_CATEGORY = { 0x10: "Colour", 0x20: "Beam", 0x30: "Position" };
  const PALETTE_ATTRS = {
    0x10: new Set(["r", "g", "b", "w", "amber", "lime", "uv", "cyan", "magenta", "yellow", "cto", "warmWhite", "coolWhite"]),
    0x20: new Set(["strobe", "gobo", "gobo2", "gobor", "prism", "prismr", "focus", "zoom", "frost", "iris"]),
    0x30: new Set(["pan", "tilt", "panf", "tiltf"])
  };

  // ---------- Effects ----------
  // A cue value can run an effect: field 0x20 = the desk's effect palette
  // (by number: "Circle", "Rainbow - cool"…), 0x30 speed, 0x40 size,
  // 0x50 / 0x60 the desk's other effect settings, 0x70 this channel's
  // phase (how a rainbow spreads over red, green and blue). 0 = no effect.
  const FX_FIELDS = [0x20, 0x60, 0x30, 0x40, 0x50, 0x70]; // the desk's own order
  const FX_DEFAULT = { 0x20: 0, 0x30: 32768, 0x40: 0, 0x50: 0, 0x60: 32768, 0x70: 0 };
  // A setting can instead point at an effect palette (field + 2 = 4): the
  // desk stores a cue that way when an effect palette was tapped. Then the
  // value is the palette's number, and the setting is the palette's own for
  // that light (a recorded palette), or the desk's default for one of its
  // built-in effects.
  const FX_BUILT_IN = { 0x30: 41301, 0x40: 65535, 0x60: 39359, 0x70: 0 };
  const fxOfRecord = (r, fxPalettes = null, light = 0) => {
    if (!kidsOf(r).some(k => k.field === 0x20 && k.value)) return null;
    const param = int(kidsOf(r).find(k => k.field === 0x11 && k.value)) ?? 0;
    const o = {};
    for (const f of FX_FIELDS) {
      let v = int(kidsOf(r).find(k => k.field === f && k.value));
      if (v != null && int(kidsOf(r).find(k => k.field === f + 2 && k.value)) === 4) {
        const own = fxPalettes?.get(v)?.lights?.get(light)?.get(param);
        v = own ? own[f] : f === 0x20 ? v : FX_BUILT_IN[f] ?? FX_DEFAULT[f];
      }
      o[f] = v ?? FX_DEFAULT[f];
    }
    return o;
  };
  const fxKey = o => o && o[0x20] ? FX_FIELDS.map(f => o[f]).join(",") : "";
  // Desk effect names → Light Spark effect types (and back).
  // The desk's colour effects: which Light Spark effect looks like each, and its colours.
  const W = (h, s = 0, l = 100) => ({ h, s, l });
  const FX_LOOK = n => {
    n = String(n || "").toLowerCase();
    const hue = { red: 0, orange: 30, yellow: 55, green: 120, cyan: 180, blue: 230, magenta: 300, white: null };
    const col = name => name === "white" ? W(0) : hue[name] ?? null;
    let m;
    if (n === "rainbow - cool") return { type: "colourfade", options: { colours: [170, 195, 220, 245, 270, 245, 220, 195] } };
    if (n === "rainbow - warm") return { type: "colourfade", options: { colours: [0, 15, 30, 45, 60, 45, 30, 15] } };
    if (n === "rainbow - pastel") return { type: "colourfade", options: { colours: [0, 60, 120, 180, 240, 300].map(h => W(h, 100, 75)) } };
    if (n === "kaleidoscope") return { type: "colourstep", options: { colours: [0, 60, 120, 180, 240, 300] } };
    if ((m = n.match(/^fade - (\w+)\/(\w+)/)) && col(m[1]) != null && col(m[2]) != null) return { type: "colourfade", options: { colours: [col(m[1]), col(m[2])] } };
    if ((m = n.match(/^sparkle - (\w+)/)) && col(m[1]) != null) return { type: "sparkle", options: { hue: col(m[1]) } };
    if (n === "fireworks") return { type: "sparkle", options: { hues: [0, 30, 55, 120, 230, 300, W(0)], density: 0.35 } };
    if (n === "emergency - red/blue") return { type: "police", options: { colours: [0, 230] } };
    if (n === "emergency - blue") return { type: "police", options: { colours: [230, 230] } };
    if (n === "warning") return { type: "alternate", options: { hue: 38 } };
    return null;
  };
  const FX_OPTIONS_OF = name => ({ ...(FX_LOOK(name)?.options || {}) });
  const FX_TYPE_OF = name => {
    const n = String(name || "").toLowerCase();
    if (/^no effect/.test(n)) return null;
    if (FX_LOOK(n)?.type) return FX_LOOK(n).type;
    if (/rainbow|kaleidoscope/.test(n)) return "rainbow";
    if (/chaser/.test(n)) return "chase";
    if (/^smooth/.test(n)) return "sine";
    if (/ramp/.test(n)) return "ramp";
    if (/lightning/.test(n)) return "lightning";
    if (/candle/.test(n)) return "flicker";
    if (/double blink/.test(n)) return "heartbeat";
    if (/figure ?8/.test(n)) return "figure8";
    if (/ballyhoo/.test(n)) return "ballyhoo";
    if (/fly (in|out)/.test(n)) return "fan";
    if (/circle|square|triangle/.test(n)) return "circle";
    if (/vert/.test(n)) return "tiltsweep";
    if (/horiz/.test(n)) return "pansweep";
    if (/sparkle|fireworks/.test(n)) return "sparkle";
    if (/^fade/.test(n)) return "colourfade";
    if (/emergency/.test(n)) return "police";
    if (/warning/.test(n)) return "alternate";
    if (/^fire/.test(n)) return "fire";
    if (/iris/.test(n)) return "irispulse";
    if (/zoom|focus/.test(n)) return "zoompulse";
    return "sine";
  };
  // Speed: the desk's 0-65535 (32768 = its normal speed) ↔ Light Spark's
  // cycles per second (1 = normal), doubling every 8192.
  // Speed: 41301 is the desk's own default (shown as speed 20), taken as
  // Light Spark's speed 1; each 8192 doubles it.
  const FX_SPEED_1 = 41301;
  const fxSpeed = raw => Math.round(Math.pow(2, ((raw ?? FX_SPEED_1) - FX_SPEED_1) / 8192) * 1000) / 1000;
  const fxRaw = speed => Math.max(0, Math.min(65535, Math.round(FX_SPEED_1 + 8192 * Math.log2(Math.max(1 / 16, Math.min(16, Number(speed) || 1))))));
  // The desk's offset for light k of n in an effect ("Forward offset").
  const fxSpread = (k, n) => 65535 - Math.floor(k * 65535 / n);
  // What a saved effect is, to tell whether it changed since it came from the desk.
  const fxSig = e => JSON.stringify([e.name, e.type, Number(e.speed) || 1, e.fixtureMode || "", e.fixtureIds || []]);
  // Recorded effect palettes: id → light → channel → effect settings.
  function fxPaletteValues(main) {
    const out = new Map();
    const sec = main ? kidsOf(main, { section: 0x1d }).find(k => k.kids) : null;
    const group = kidsOf(sec).find(g => g.kids && g.kind === 0x40);
    for (const e of kidsOf(group)) {
      if (one(e, 0xe) || !one(e, 0xa)) continue; // the desk's built-in effects
      const lights = new Map();
      for (const holder of kidsOf(one(e, 0xa))) for (const l of kidsOf(holder).filter(k => k.kids)) {
        const m = new Map();
        for (const r of kidsOf(one(l, 0, { kind: 0x11 }))) { const o = fxOfRecord(r); if (o) m.set(int(kidsOf(r).find(k => k.field === 0x11 && k.value)) ?? 0, o); }
        if (m.size) lights.set(int(one(l, 1)) ?? 0, m);
      }
      out.set(int(one(e, 1)), { name: text(one(e, 0xb)), lights });
    }
    return out;
  }
  // Which channels a Light Spark effect type moves, by attribute.
  // Light Spark effects the desk has nothing exactly like: the closest desk effect.
  const FX_NEAREST = {
    strobe: /^lightning/, pulse: /^smooth/, wave: /^smooth/, bounce: /^chaser - 1\/4/, build: /^ramp up/,
    random: /^sparkle/, colourstep: /^rainbow$/, disco: /^rainbow$/, water: /^rainbow - cool/, aurora: /^rainbow - cool/,
    snowfall: /^sparkle - blue/, iceshimmer: /^sparkle - blue/, blizzard: /^sparkle/, fireplace: /^fire$/,
    freeze: /^fade - blue\/white/, search: /^ballyhoo/, chase: /^chaser - 1\/4/
  };
  const FX_ATTRS = type => ["circle", "figure8", "pansweep", "tiltsweep", "ballyhoo", "fan", "search"].includes(type) ? new Set(["pan", "tilt"])
    : ["rainbow", "colourfade", "colourstep", "police", "disco", "water"].includes(type) ? new Set(["r", "g", "b"])
    : type === "zoompulse" ? new Set(["zoom", "focus"]) : type === "irispulse" ? new Set(["iris"]) : new Set(["dimmer"]);

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
      list.push({ index: int(one(c, 0)) ?? 0, offset, label, code: int(one(c, 9)), code2: int(one(c, 0x11)), group: int(one(c, 2)), home: int(one(c, 8)) ?? 0 });
    }
    list.sort((a, b) => a.offset - b.offset);
    list.forEach((c, i) => { c.width = Math.max(1, Math.min(2, (list[i + 1]?.offset ?? channels + 1) - c.offset)); });
    channels = Math.max(channels, ...list.map(c => c.offset + c.width - 1), 1);
    return { id, name, mode, maker, channels, list };
  }

  // Spare Light Spark channel names for desk channels it has no control for
  // (colour macros, dimmer curves, fans…): written out as they are, so the
  // light does exactly what the desk would. Not fog / haze (those have a
  // safety cut-out).
  const SPARE = ["colmacro", "macro", "effect", "speed", "preset", "mode", "zone", "shake", "rot", "fana", "blueMix", "amberMix", "magentaMix", "shutter1Insert", "shutter1Rotate", "shutter2Insert", "shutter2Rotate", "shutter3Insert", "shutter3Rotate", "shutter4Insert", "shutter4Rotate"];
  // Desk attributes Light Spark drives directly (others go to SPARE slots).
  const DIRECT = new Set(["dimmer", "r", "g", "b", "w", "amber", "lime", "uv", "cyan", "magenta", "yellow", "cto", "warmWhite", "coolWhite", "pan", "tilt", "panf", "tiltf", "strobe", "gobo", "gobo2", "gobor", "prism", "prismr", "focus", "zoom", "frost", "iris"]);

  // Every named desk channel → the Light Spark state key that drives it.
  function deskSlots(type) {
    const slots = new Map(), map = {};
    let spare = 0;
    // Light Spark mixes red, green and blue together; a light with only some
    // of them gets plain channels instead.
    const named = new Set(type.list.map(c => attribute(c.label, c.code, c.code2)));
    const trio = ["r", "g", "b"].every(k => named.has(k));
    for (const c of type.list) {
      let a = attribute(c.label, c.code, c.code2);
      if (!a || !DIRECT.has(a) || a in map || (!trio && (a === "r" || a === "g" || a === "b" || a === "w"))) { while (spare < SPARE.length && SPARE[spare] in map) spare++; a = spare < SPARE.length ? SPARE[spare++] : null; }
      if (!a) continue;
      map[a] = c.offset - 1;
      slots.set(c.index, a);
    }
    return { slots, map };
  }

  // The Light Spark fixture for a desk fixture type: always the desk's own
  // channel layout (so every channel lines up with the desk), named after the
  // type; a matching Light Spark library fixture lends its beam and photometrics.
  function definitionFor(type) {
    const lib = window.FixtureLibrary || {};
    const words = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const model = words(type.name), maker = words(type.maker);
    const keys = Object.keys(lib).filter(k => words(k).includes(model) && (!maker || maker === "generic" || words(k).includes(maker) || words(lib[k]?.manufacturer).includes(maker)));
    const like = lib[keys.find(k => Number(lib[k]?.channels) === type.channels) || keys[0]] || null;
    const { map } = deskSlots(type);
    if (typeof map.dimmer === "number") map.intensity = map.dimmer;
    const rgb = ["r", "g", "b"].every(k => typeof map[k] === "number");
    const key = `${type.maker} ${type.name}${type.mode ? ` (${type.mode})` : ""} [FLX]`.replace(/\s+/g, " ").trim();
    return {
      key, matched: Boolean(like),
      definition: {
        type: typeof map.pan === "number" ? "moving" : rgb ? "rgb" : (like?.type || "dimmer"),
        channels: type.channels, map,
        photometrics: like?.photometrics ? JSON.parse(JSON.stringify(like.photometrics)) : { verified: false, sourceType: "LED", ratedLumens: null, beamAngle: null, outputScale: 1 },
        manufacturer: type.maker, model: type.name, custom: true, fromZerOS: true,
        channelNames: type.list.map(c => ({ offset: c.offset, name: c.label }))
      }
    };
  }

  // A desk light's channel values (index → 0-65535) as Light Spark state.
  function stateFor(f, values) {
    const { slots } = deskSlots(f.type);
    const out = {};
    let rgb = null, hasDimmer = false;
    for (const ch of f.type.list) {
      const key = slots.get(ch.index);
      if (!key) continue;
      const v = values.get(ch.index) ?? ch.home ?? 0;
      if (key === "dimmer") { hasDimmer = true; out.intensity = Math.round(v / 65.535) / 10; }
      else if (key === "r" || key === "g" || key === "b") { rgb = rgb || [255, 255, 255]; rgb["rgb".indexOf(key)] = v / 257; }
      else out[key] = Math.round(v / 257);
    }
    if (!hasDimmer) out.intensity = 100;
    if (rgb) Object.assign(out, hsl(rgb));
    return out;
  }

  // ---------- Read a whole show ----------
  // A playback the desk runs as a chase (Playback Setup → Turn into Chase):
  // field 0x19 = 1 (older shows: 0x19 = 0 with field 3 set). A chase also has
  // its speed in beats per minute × 1000 (0x27) and how many times it runs
  // (0x24 "Shots", 0 = round and round).
  function isChaseNode(pb) {
    const f = one(pb, 0x19);
    if (!f) return false;
    return int(f) === 1 || Boolean(int(one(pb, 3)));
  }
  // What a palette is, to tell whether it changed since it came from the desk.
  const palSig = p => JSON.stringify([p.name, p.category, p.values || {}, p.fixtures || [], p.perFixture || {}]);
  // Light Spark chases aren't saved into FLX shows, and the desk's playbacks
  // aren't opened as chases.
  const FLX_CHASES = false;
  // What a chase is, to tell whether it changed since it came from the desk.
  const chaseSig = c => JSON.stringify([c.name, c.mode, c.loop !== false, Number(window.LXChaseSpeed?.bpmOf?.(c) ?? c.bpm) || 0, c.fixtureIds || [], c.snapshots || [], c.steps || [], (c.steps || []).map(i => window.State?.cues?.[i] || null), Number(c.fade) || 0]);
  // The main cue list: the playback with the most cues (ties: the lowest
  // number) that isn't a chase. Opening and saving both pick it this way.
  const mainOf = list => [...list].filter(p => p.cues.length && !p.chase).sort((a, b) => b.cues.length - a.cues.length || (a.number ?? 0) - (b.number ?? 0))[0] || null;

  function read(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let damaged = [];
    let raw = bytes;
    if (isTag(bytes, 0, "C")) ({ data: raw, damaged } = unpack(bytes));
    if (raw.length < 0x30 || !isTag(raw, 0, "B") || !isTag(raw, raw.length - 4, "B")) throw new Error("this isn't a ZerOS show file (or it's damaged)");
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
      members.sort((a, b) => a.order - b.order);   // the desk's own order
      groups.push({ id: int(one(g, 1)), name: text(one(g, 2)), members: members.map(m => m.num), auto: int(one(g, 7)) === 1 });
    }
    groups.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    const palettes = [];
    const KINDS = { 0x50: "Intensity", 0x10: "Colour", 0x20: "Beam", 0x30: "Position", 0x40: "Effect" };
    for (const p of kidsOf(sec(0x1d))) {
      const kind = KINDS[p.kind];
      if (!kind || !p.kids) continue;
      for (const e of kidsOf(p)) { const n = text(one(e, 0xb)); if (n) palettes.push({ kind, code: p.kind, id: int(one(e, 1)), name: n }); }
    }

    const paletteMap = paletteValues(main);
    const fxPalettes = fxPaletteValues(main);
    // The colour each colour palette was picked as on the desk: hue, saturation,
    // brightness (fractions) and white temperature.
    const swatches = new Map();
    {
      const psec = kidsOf(main, { section: 0x1d }).find(k => k.kids);
      for (const e of kidsOf(kidsOf(psec).find(g => g.kids && g.kind === 0x10))) {
        const b = one(e, 0x10); if (!b?.kids) continue;
        const v = f => { const x = one(b, f)?.value; return x && x.length >= 4 ? (x[0] | (x[1] << 8) | (x[2] << 16) | (x[3] << 24)) >>> 0 : null; };
        if ([0, 1, 2, 3].every(f => v(f) != null)) swatches.set(int(one(e, 1)), { h: v(0) / 4294967296, s: v(1) / 65535, v: v(2) / 65535, k: v(3) });
      }
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
            const params = {}, effects = {};
            for (const pv of kidsOf(one(fx, 0, { kind: 0x11 }))) {
              const { param, value } = recordValue(pv, fixture.index ?? 0, paletteMap);
              if (value != null) params[param] = value;
              if (kidsOf(pv).some(k => k.field === 0x20)) effects[param] = fxOfRecord(pv, fxPalettes, fixture.index ?? 0) || { ...FX_DEFAULT };
            }
            if (Object.keys(params).length || Object.keys(effects).length) levels.push({ number: fixture.number, index: fixture.index ?? 0, params, effects });
          }
        }
        // Times in ms. Up Time[0..] / Up Delay[0..] per attribute group,
        // Down Time / Delay; trigger 1 = Go, 6 = Auto with previous cue,
        // 0 = Auto after previous cue, with its wait time (field 4).
        const t = f => int(one(c, f));
        cues.push({
          number: n != null ? n / 100 : cues.length + 1, name: text(one(c, 2)),
          up: t(0xa) ?? 0, upDelay: t(0x6) ?? 0, down: t(0x1c) ?? 0, downDelay: t(0x1d) ?? 0,
          colour: t(0xb) ?? 0, colourDelay: t(0x7) ?? 0, beam: t(0xc) ?? 0, beamDelay: t(0x8) ?? 0,
          focus: t(0xd) ?? 0, focusDelay: t(0x9) ?? 0,
          trigger: t(0x3) ?? 1, wait: t(0x4) ?? 0, levels
        });
      }
      const chase = isChaseNode(pb);
      playbacks.push({ number: int(one(pb, 1)), name: label, cues, chase, bpm: chase ? (int(one(pb, 0x27)) || 60000) / 1000 : null, shots: chase ? int(one(pb, 0x24)) ?? 0 : null });
    }
    playbacks.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    return { name, fixtures, types: [...types.values()], groups, palettes, paletteMap, fxPalettes, swatches, playbacks, damaged };
  }

  // What an extra emitter adds to the colour you see (r, g, b per full level).
  const EMITTER_TINT = { amber: [1, 0.75, 0], lime: [0.75, 1, 0], cyan: [0, 1, 1], w: [1, 1, 1], warmWhite: [1, 0.78, 0.55], coolWhite: [0.86, 0.9, 1], uv: [0.4, 0, 1] };
  // A desk colour-picker swatch → Light Spark's hue / sat / light.
  function swatchColour(sw) {
    // Whites as Light Spark's own warm / cool white.
    if (sw.s < 0.02) return sw.k === 3200 ? { hue: 32, sat: 70, light: 82 } : sw.k === 10000 ? { hue: 210, sat: 45, light: 88 } : { hue: 0, sat: 0, light: Math.round(sw.v * 100) };
    const l = sw.v * (1 - sw.s / 2), sl = l > 0 && l < 1 ? (sw.v - l) / Math.min(l, 1 - l) : 0;
    const r1 = x => Math.round(x * 100) / 100;
    return { hue: r1(sw.h * 360), sat: r1(sl * 100), light: r1(l * 100) };
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
        if (d.matched) matched++; else rebuilt++;
        custom[d.key] = d.definition;
      }
      fixtures.push({ id: `zos-i${f.index}`, name: d.key, uni: f.uni, addr: f.addr, fixtureNumber: f.number, label: f.label && f.label !== f.type.name ? f.label : undefined });
    }
    const have = new Set(fixtures.map(f => f.fixtureNumber));
    const lightByIndexAll = new Map(z.fixtures.filter(f => f.type && f.addr && have.has(f.number)).map(f => [f.index ?? 0, f]));
    // Your groups first, then the desk's automatic ones ("All - …", "Odd - …"),
    // marked deskAuto so saving leaves those to the desk.
    const groups = [
      ...z.groups.filter(g => g.name && !g.auto).map(g => ({ name: g.name, members: g.members.filter(n => have.has(n)) })),
      ...z.groups.filter(g => g.name && g.auto).map(g => ({ name: g.name, members: g.members.filter(n => have.has(n)), deskAuto: true }))
    ].filter(g => g.members.length);
    const cues = [];
    const pb = mainOf(z.playbacks);
    if (pb) {
      // Desk cues hold only what changed, and a light starts at its home
      // values (colour channels are usually full, so white). Work out every
      // light's whole state cue by cue, and give each Light Spark cue the
      // lights whose state changed (all of them in the first cue).
      const lights = z.fixtures.filter(f => f.type && f.addr && have.has(f.number));
      const values = new Map(lights.map(f => [f.number, new Map(f.type.list.map(ch => [ch.index, ch.home ?? 0]))]));
      const before = new Map();
      const fxNow = new Map(lights.map(f => [f.index ?? 0, new Map()])); // light → channel → desk effect
      const fxNames = new Map(z.palettes.filter(p => p.code === 0x40).map(p => [p.id, p.name]));
      for (const c of [...pb.cues].sort((a, b) => a.number - b.number)) {
        for (const l of c.levels) {
          const m = values.get(l.number); if (m) for (const [i, v] of Object.entries(l.params)) m.set(Number(i), v);
          const e = fxNow.get(l.index); if (e) for (const [i, o] of Object.entries(l.effects || {})) { if (o[0x20]) e.set(Number(i), o); else e.delete(Number(i)); }
        }
        // Effects running in this cue: lights sharing an effect, speed and size together.
        const groupsFx = new Map();
        for (const f of lights) for (const [param, o] of fxNow.get(f.index ?? 0) || []) {
          const type = FX_TYPE_OF(fxNames.get(o[0x20]));
          if (!type) continue;
          const k = `${o[0x20]}|${o[0x30]}|${o[0x40]}`;
          const g = groupsFx.get(k) || { type, o, ids: new Set(), params: {}, lights: {} };
          g.ids.add(`zos-i${f.index}`);
          (g.params[f.index] = g.params[f.index] || {})[param] = o[0x70];
          g.lights[f.index] = { f50: o[0x50], f60: o[0x60] };
          groupsFx.set(k, g);
        }
        const cueEffects = [...groupsFx.values()].map(g => ({
          ...FX_OPTIONS_OF(fxNames.get(g.o[0x20])), type: g.type, speed: fxSpeed(g.o[0x30]), fixtureMode: "custom", fixtureIds: [...g.ids], name: fxNames.get(g.o[0x20]) || g.type,
          zos: { effect: g.o[0x20], speed: g.o[0x30], size: g.o[0x40], params: g.params, lights: g.lights }
        }));
        const states = [];
        for (const f of lights) {
          const out = stateFor(f, values.get(f.number));
          const key = JSON.stringify(out);
          if (before.get(f.number) === key) continue;
          before.set(f.number, key);
          states.push([`zos-i${f.index}`, out]);
        }
        cues.push({
          name: c.name || `Cue ${c.number}`, number: c.number, fade: c.up,
          timing: { up: c.up, down: c.down, upDelay: c.upDelay, downDelay: c.downDelay, colour: c.colour, colourDelay: c.colourDelay, beam: c.beam, beamDelay: c.beamDelay, focus: c.focus, focusDelay: c.focusDelay },
          follow: 0, followEnabled: false, mode: "track", fixtureStates: states, state: {}, globalState: {},
          effects: cueEffects, zosTrigger: c.trigger
        });
        // This cue runs by itself: the one before it follows on.
        const prev = cues[cues.length - 2];
        if (prev && (c.trigger === 6 || c.trigger === 0)) Object.assign(prev, { followEnabled: true, followMode: c.trigger === 6 ? "go" : "complete", follow: Math.round((c.wait || 0) / 10) / 100 });
      }
    }
    // Chases: each desk chase playback becomes a recorded chase, one look a
    // step, for the lights it uses.
    const chases = [];
    // Chases stay out of FLX shows (FLX_CHASES): the desk's own playbacks are left as they are.
    for (const p of z.playbacks.filter(p => FLX_CHASES && p.chase && p.cues.length).sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
      const steps = [...p.cues].sort((a, b) => a.number - b.number);
      const usedBy = new Set(steps.flatMap(c => c.levels.map(l => l.number)));
      const mine = z.fixtures.filter(f => f.type && f.addr && have.has(f.number) && usedBy.has(f.number));
      if (!mine.length) continue;
      const values = new Map(mine.map(f => [f.number, new Map(f.type.list.map(ch => [ch.index, ch.home ?? 0]))]));
      const snapshots = steps.map(c => {
        for (const l of c.levels) { const m = values.get(l.number); if (m) for (const [i, v] of Object.entries(l.params)) m.set(Number(i), v); }
        return { globalState: {}, fixtureStates: mine.map(f => [`zos-i${f.index}`, stateFor(f, values.get(f.number))]) };
      });
      chases.push({ name: p.name || `Chase ${p.number}`, mode: "snapshot", steps: [], snapshots, fixtureIds: mine.map(f => `zos-i${f.index}`), loop: !p.shots, bpm: Math.max(6, Math.min(1200, p.bpm || 60)), fade: 0, zos: { playback: p.number } });
    }
    // The effects the desk's cues run, on the Effects page too: one per
    // effect and set of lights, named as on the desk.
    const savedEffects = {};
    const seenFx = new Map();
    const fxNamesAll = new Map(z.palettes.filter(p => p.code === 0x40).map(p => [p.id, p.name]));
    for (const [id, fp] of z.fxPalettes || []) {
      const ids = [], params = {}, lights = {};
      let first = null;
      for (const [index, m] of fp.lights) {
        const f = lightByIndexAll.get(index); if (!f) continue;
        ids.push(`zos-i${index}`);
        for (const [param, o] of m) { first = first || o; (params[index] = params[index] || {})[param] = o[0x70]; lights[index] = { f50: o[0x50], f60: o[0x60] }; }
      }
      // An effect recorded from another recorded effect points at that one: follow it to the desk's own effect.
      let effectId = first?.[0x20];
      for (let hop = 0; hop < 4 && effectId != null && !FX_TYPE_OF(fxNamesAll.get(effectId)) && z.fxPalettes.get(effectId); hop++) {
        const inner = [...z.fxPalettes.get(effectId).lights.values()][0]?.values().next().value;
        effectId = inner?.[0x20];
      }
      if (first && effectId != null) first = { ...first, 0x20: effectId };
      const type = first && FX_TYPE_OF(fxNamesAll.get(first[0x20]));
      if (!type || !ids.length) continue;
      const name = fp.name || `Effect ${id}`;
      savedEffects[name] = { ...FX_OPTIONS_OF(fxNamesAll.get(first[0x20])), name, type, speed: fxSpeed(first[0x30]), fixtureMode: "custom", fixtureIds: ids, zos: { kind: 0x40, id, effect: first[0x20], speed: first[0x30], size: first[0x40], params, lights } };
    }
    for (const c of cues) for (const e of c.effects || []) {
      const key = `${e.zos?.effect}|${e.speed}|${[...e.fixtureIds].sort()}`;
      if (seenFx.has(key)) continue;
      let name = e.name || e.type, k = 2;
      while (savedEffects[name]) name = `${e.name || e.type} (${k++})`;
      seenFx.set(key, name);
      savedEffects[name] = { ...e, name, type: e.type, speed: e.speed, fixtureMode: "custom", fixtureIds: [...e.fixtureIds], zos: { ...e.zos, cue: true } };
    }
    // The desk's own effects (Circle, Rainbow, Fly in…), as on its Effects
    // page: they run on whatever is selected, like on the desk.
    for (const p of z.palettes.filter(p => p.code === 0x40).sort((a, b) => a.id - b.id)) {
      if (z.fxPalettes?.has(p.id)) continue; // recorded ones are above
      const type = FX_TYPE_OF(p.name);
      if (!type || savedEffects[p.name]) continue;
      savedEffects[p.name] = { ...FX_OPTIONS_OF(p.name), name: p.name, type, speed: 1, fixtureMode: "selected", fixtureIds: [], zos: { kind: 0x40, id: p.id, effect: p.id, builtin: true } };
    }
    // Palettes: colour, beam and position, each light's own values.
    const lsPalettes = [];
    const lightByIndex = new Map(z.fixtures.filter(f => f.type && f.addr && have.has(f.number)).map(f => [f.index ?? 0, f]));
    for (const p of z.palettes) {
      const category = PALETTE_CATEGORY[p.code];
      if (!category) continue;
      const perFixture = {};
      // The colour the desk's colour picker made this palette as, if it did.
      const sw = p.code === 0x10 ? z.swatches?.get(p.id) : null;
      const picked = sw ? swatchColour(sw) : null;
      for (const [index, chans] of z.paletteMap.get(`${p.code}:${p.id}`) || []) {
        const f = lightByIndex.get(index);
        if (!f) continue;
        const { slots } = deskSlots(f.type);
        const st = {};
        let rgb = null;
        const mix = [0, 0, 0];
        for (const ch of f.type.list) {
          if (!chans.has(ch.index)) continue;
          const key = slots.get(ch.index), a = attribute(ch.label, ch.code, ch.code2);
          if (!key || !PALETTE_ATTRS[p.code].has(a)) continue;
          const v = chans.get(ch.index);
          if (key === "r" || key === "g" || key === "b") { rgb = rgb || f.type.list.filter(c => ["r", "g", "b"].includes(slots.get(c.index))).reduce((acc, c) => { acc["rgb".indexOf(slots.get(c.index))] = (chans.get(c.index) ?? c.home ?? 0) / 257; return acc; }, [255, 255, 255]); }
          else st[key] = Math.round(v / 257);
          // What each emitter adds to the colour you see.
          const tint = EMITTER_TINT[a];
          if (tint) tint.forEach((t, j) => { mix[j] += t * v / 257; });
        }
        if (picked) {
          // Made with the desk's colour picker: that colour, with the desk's own
          // amber / lime / white levels on top (the desk mixes those in, Light
          // Spark wouldn't from red, green and blue alone).
          Object.assign(st, picked);
        } else if (rgb) {
          const seen = rgb.map((x, j) => x + mix[j]);
          const top = Math.max(...seen);
          Object.assign(st, hsl(top > 255 ? seen.map(x => x * 255 / top) : seen));
        }
        if (Object.keys(st).length) perFixture[`zos-i${f.index}`] = st;
      }
      const ids = Object.keys(perFixture);
      if (!ids.length) continue;
      lsPalettes.push({ id: `zos-palette-${p.code}-${p.id}`, name: p.name, category, values: picked ? { ...perFixture[ids[0]], ...picked } : { ...perFixture[ids[0]] }, fixtures: ids, perFixture, zos: { kind: p.code, id: p.id }, createdAt: new Date().toISOString() });
    }
    return {
      show: {
        format: "lx-console-show", version: 8, savedAt: new Date().toISOString(), fromZerOS: true,
        fixtures, groups, cues, chases, savedEffects, palettes: lsPalettes, fixtureStates: [], selected: [],
        current: { __lxCustomFixtures: custom }, currentCue: -1
      },
      custom, matched, rebuilt, playback: pb, skipped: z.fixtures.length - fixtures.length
    };
  }

  async function openFile(file) {
    return openBytes(new Uint8Array(await file.arrayBuffer()), file.name, "");
  }

  async function openBytes(bytes, label, filePath) {
    const z = read(bytes);
    if (z.damaged?.length) {
      const go = await window.LXAsk?.("This FLX file is damaged", [], { ok: "Open anyway", safe: true, message: `Part of “${z.name}” doesn't match the desk's own checks (${z.damaged.join(", ")}), so some lights or cues may be wrong. Use another copy if you have one (the Backups folder in your Shows folder, or the desk's USB stick).` });
      if (window.LXAsk && !go) { say("Didn't open the damaged FLX file", "info"); return null; }
      say(`“${z.name}” is damaged — check it before using it on the desk`, "warn");
    }
    const r = toShow(z);
    const others = z.playbacks.filter(p => p.cues.length && p !== r.playback && !p.chase).length;
    const ok = await window.LXAsk?.(`Open FLX show “${z.name}”`, [], {
      ok: "Open",
      safe: true,
      message: `${z.fixtures.length} lights, ${r.show.groups.length} groups, ${r.show.cues.length} cues${r.show.chases.length ? `, ${r.show.chases.length} chase${r.show.chases.length === 1 ? "" : "s"}` : ""}${r.playback ? ` (from playback ${r.playback.number}${r.playback.name ? ` “${r.playback.name}”` : ""})` : ""}, ${r.show.palettes.length} palettes, ${Object.keys(r.show.savedEffects).length} effects. This replaces the show that's open now — save it first if you want to keep it. Brightness and colour come across.`
    });
    if (window.LXAsk && !ok) { say("Open FLX show cancelled — nothing was changed", "info"); return null; }
    try { for (const [k, d] of Object.entries(r.custom)) window.FixtureLibrary[k] = JSON.parse(JSON.stringify(d)); } catch (_) {}
    window.LXShowCommands?.restore?.(r.show);
    for (const c of window.State?.chases || []) if (c?.zos) c.zos.sig = chaseSig(c);
    for (const p of window.State?.palettes || []) if (p?.zos) { p.zos.sig = palSig(p); p.zos.lightSigs = Object.fromEntries(Object.entries(p.perFixture || {}).map(([id, st]) => [id, JSON.stringify({ ...(p.values || {}), ...st })])); }
    for (const e of Object.values(window.State?.savedEffects || {})) if (e?.zos?.kind === 0x40) e.zos.sig = fxSig(e);
    keepBase(bytes, String(label || z.name).replace(/\.zos$/i, ""), filePath, [...(r.show.palettes || []).map(p => `${p.zos.kind}:${p.zos.id}`), ...Object.values(r.show.savedEffects || {}).filter(e => e.zos?.kind === 0x40 && !e.zos.builtin).map(e => `64:${e.zos.id}`)], (r.show.chases || []).map(c => c.zos.playback));
    openPath = filePath || "";
    try { window.LXShowCommands?.markSaved?.(); } catch (_) {}
    try { window.renderLibrary?.(); } catch (_) {}
    say(`Opened FLX show “${z.name}”: ${r.show.fixtures.length} lights (${r.matched} fixture type${r.matched === 1 ? "" : "s"} from Light Spark's library, ${r.rebuilt} rebuilt from the show), ${r.show.groups.length} groups, ${r.show.cues.length} cues${r.show.chases.length ? `, ${r.show.chases.length} chase${r.show.chases.length === 1 ? "" : "s"}` : ""}`, "ok");
    if (r.skipped) say(`${r.skipped} light${r.skipped === 1 ? " wasn't" : "s weren't"} patched on the desk, so ${r.skipped === 1 ? "it was" : "they were"} left out`, "warn");
    if (others) say(`${others} more playback${others === 1 ? "" : "s"} with cues on the desk — only the first came across`, "info");
    const spans = z.fixtures.filter(f => f.addr && f.type).map(f => ({ n: f.number, uni: f.uni, from: f.addr, to: f.addr + f.type.channels - 1 })).sort((a, b) => a.uni - b.uni || a.from - b.from);
    const overlap = [];
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length && spans[j].uni === spans[i].uni && spans[j].from <= spans[i].to; j++) overlap.push(`${spans[i].n} & ${spans[j].n}`);
    if (overlap.length) say(`This FLX show has lights patched on top of each other (${overlap.slice(0, 6).join(", ")}${overlap.length > 6 ? "…" : ""}), so it won't look right on the desk. An earlier Light Spark may have damaged it — the copy from before is in the Backups folder in your Shows folder (App menu → Show my files), or for saves before this update in Finder → Go → Go to Folder → ~/Library/Application Support/Lighting Console/FLX Backups`, "warn");
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

  // The base: the FLX file this Light Spark show came from. It travels inside
  // the Light Spark show file (State.zos, saved by js/showfile.js), so a
  // show is only ever saved into its own FLX file — never into whichever FLX
  // file happened to be opened last.
  const b64 = bytes => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const unb64 = text => { const bin = atob(text); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
  let base = null;
  // palettes: the desk palettes ("kind:id") this show has, so only those
  // can be deleted from the desk by deleting them here.
  // chases: the desk chase playbacks (numbers) this show has, likewise.
  function keepBase(bytes, name, filePath = "", palettes, chases) {
    base = { bytes: bytes.slice(), name, path: filePath };
    const S = window.State || (window.State = {});
    S.zos = { name, path: filePath, data: b64(bytes), savedAt: new Date().toISOString(), palettes: palettes || S.zos?.palettes || [], chases: chases || S.zos?.chases || [] };
  }
  function loadBase() {
    const z = window.State?.zos;
    if (z?.data) {
      if (!base || base.name !== z.name || base.path !== (z.path || "") || base.data !== z.data) {
        try { base = { bytes: unb64(z.data), name: z.name, path: z.path || "", data: z.data }; } catch (_) { base = null; }
      }
      return base;
    }
    return null;
  }

  // Light Spark's show written into the base show's records.
  function build(baseBytes, opts = {}) {
    const S = window.State || {};
    const raw = isTag(baseBytes, 0, "C") ? unpack(baseBytes).data : baseBytes;
    const top = parse(raw, 16, raw.length - 0x20);
    const z = read(raw);
    const main = top.find(n => n.section === 0x10 && n.kids);
    const sec = id => main ? kidsOf(main, { section: id }).find(k => k.kids) : null;
    const clean = n => String(n || "").replace(/\.(zos|json)$/ig, "").replace(/\.(zos|json)$/ig, "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 31);
    const name = clean(opts.name) || clean(window.LXShowCommands?.name?.()) || clean(z.name) || "FLX show";
    const nameNode = top.find(n => n.section === 0 && n.field === 2 && n.value);
    if (nameNode) nameNode.value = new TextEncoder().encode(name);

    // ---- Which Light Spark light is which desk light ----
    // Only lights that came from this FLX file (their id says which desk
    // light: zos-i<position>, or zos-<number> from older versions), plus a
    // light added in Light Spark with the desk's own type at a desk light's
    // own address. Nothing is matched by guessing.
    const defOf = ls => window.getFixtureDefinition?.(ls) || window.FixtureLibrary?.[ls.name] || null;
    const uniOf = l => Math.max(1, Number(l.uni) || 1);
    const lsLights = (S.fixtures || []).filter(f => f && f.addr != null);
    const deskByIndex = new Map(z.fixtures.map(d => [d.index ?? 0, d]));
    const deskByNumber = new Map(z.fixtures.map(d => [d.number, d]));
    const pair = new Map(), used = new Set();
    for (const ls of lsLights) {
      const id = String(ls.id || "");
      let m, d = null;
      if ((m = /^zos-i(\d+)$/.exec(id))) d = deskByIndex.get(Number(m[1]));
      else if ((m = /^zos-(\d+)$/.exec(id))) d = deskByNumber.get(Number(m[1]));
      if (!d || !d.type || pair.has(d)) continue;
      pair.set(d, ls); used.add(ls);
    }
    for (const ls of lsLights) {
      if (used.has(ls)) continue;
      const def = defOf(ls);
      const d = z.fixtures.find(x => !pair.has(x) && x.type && x.addr === Number(ls.addr) && x.uni === uniOf(ls) && String(ls.name) === definitionFor(x.type).key && Number(def?.channels) === x.type.channels);
      if (d) { pair.set(d, ls); used.add(ls); }
    }
    // Every matched light must be the desk light's type, or this show
    // doesn't belong to this FLX file: stop rather than write the wrong lights.
    const wrongType = [];
    for (const [d, ls] of pair) {
      const chans = Number(defOf(ls)?.channels);
      if (Number.isFinite(chans) && chans !== d.type.channels) wrongType.push(`${ls.fixtureNumber} (${ls.name} is ${chans} channels, the desk's ${d.type.name} is ${d.type.channels})`);
    }
    if (wrongType.length) throw new Error(`this show's lights don't match the FLX file “${z.name}”: ${wrongType.slice(0, 4).join("; ")}${wrongType.length > 4 ? "…" : ""}. Open the FLX file this show came from, or use Save As FLX to pick it — nothing was saved`);
    const missing = lsLights.filter(l => !used.has(l)).map(l => l.fixtureNumber);
    // Desk lights unpatched in Light Spark (still in the show, no address) or
    // deleted from it are unpatched on the desk too — only when this show came
    // from this file (its lights carry the file's ids), so a show that
    // doesn't belong here can never unpatch a rig.
    const allLs = (S.fixtures || []).filter(Boolean);
    const idOf = d => `zos-i${d.index ?? 0}`;
    const fromThisFile = allLs.some(l => /^zos-i\d+$/.test(String(l.id || "")) && deskByIndex.has(Number(String(l.id).slice(5))));
    const lsById = new Map(allLs.map(l => [String(l.id || ""), l]));
    const toUnpatch = new Set(fromThisFile ? z.fixtures.filter(d => d.addr && !pair.has(d) && (!lsById.has(idOf(d)) || lsById.get(idOf(d)).addr == null)) : []);

    // ---- New lights: added in Light Spark, of a type the desk already has ----
    // A copy of a desk light of that type, at the end of the desk's list.
    const fixSec = sec(0x1c);
    const nodeOfIndex = i => kidsOf(fixSec).find(n => (int(one(n, 1)) ?? 0) === i);
    const patchedNode = kidsOf(fixSec).find(n => kidsOf(one(n, 6))[0]);
    const newLights = [];
    let nextIndex = Math.max(-1, ...z.fixtures.map(d => d.index ?? 0)) + 1;
    for (const ls of lsLights) {
      if (used.has(ls)) continue;
      const type = z.types.find(t => definitionFor(t).key === String(ls.name) && Number(defOf(ls)?.channels) === t.channels);
      const like = type && (z.fixtures.find(d => d.type === type && kidsOf(one(nodeOfIndex(d.index ?? 0), 6))[0]) || z.fixtures.find(d => d.type === type));
      const likeNode = like && nodeOfIndex(like.index ?? 0);
      if (!likeNode || !patchedNode) continue;
      const node = clone(likeNode);
      if (!kidsOf(one(node, 6))[0]) { node.kids = node.kids.filter(k => !(k.field === 6 && k.kids)); node.kids.splice(node.kids.findIndex(k => k.field === 4) + 1, 0, clone(one(patchedNode, 6))); }
      const index = nextIndex++;
      setInt(node, 1, index);
      const d = { index, number: like.number, label: like.label, type, addr: Number(ls.addr), uni: uniOf(ls), added: true };
      const patch = kidsOf(one(node, 6))[0];
      setInt(patch, 1, d.addr);
      if (!setInt(patch, 2, d.uni - 1) && d.uni > 1) continue;
      fixSec.kids.splice(1, 0, node);           // the desk lists lights last-first
      z.fixtures.push(d); deskByIndex.set(index, d);
      pair.set(d, ls); used.add(ls); newLights.push(ls.fixtureNumber);
    }
    const missingType = lsLights.filter(l => !used.has(l)).map(l => l.fixtureNumber);
    missing.length = 0; missing.push(...missingType);

    // ---- Patch: addresses you changed in Light Spark ----
    const nodeByIndex = new Map(kidsOf(sec(0x1c)).map(n => [int(one(n, 1)) ?? 0, n]));
    const size = d => Math.max(1, d.type?.channels || 1);
    const where = new Map(z.fixtures.filter(d => d.addr && !toUnpatch.has(d)).map(d => [d, { uni: d.uni, addr: d.addr }]));
    const notMoved = [];
    for (const [d, ls] of pair) {
      const want = { uni: uniOf(ls), addr: Number(ls.addr) };
      if (want.addr === d.addr && want.uni === d.uni) continue;
      const chans = Number(defOf(ls)?.channels);
      if (Number.isFinite(chans) && chans !== d.type.channels) { notMoved.push(d.number); continue; }
      where.set(d, want);
    }
    const spans = [...where].map(([d, p]) => ({ d, uni: p.uni, from: p.addr, to: p.addr + size(d) - 1 })).sort((a, b) => a.uni - b.uni || a.from - b.from);
    const clashes = [];
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length && spans[j].uni === spans[i].uni && spans[j].from <= spans[i].to; j++) clashes.push(`${spans[i].d.number} and ${spans[j].d.number} (from address ${spans[j].from})`);
    if (clashes.length) throw new Error(`lights would share DMX channels on the desk: ${clashes.slice(0, 6).join(", ")}${clashes.length > 6 ? "…" : ""}. Fix the patch first — nothing was saved`);
    let unpatched = 0;
    for (const d of toUnpatch) {
      const node = nodeByIndex.get(d.index ?? 0);
      if (!node?.kids) continue;
      node.kids = node.kids.filter(k => !(k.field === 6 && k.kids));
      unpatched++;
    }
    let moved = 0;
    for (const [d, p] of where) {
      if (p.addr === d.addr && p.uni === d.uni) continue;
      const patch = kidsOf(one(nodeByIndex.get(d.index ?? 0), 6))[0];
      if (!patch || !setInt(patch, 1, p.addr)) throw new Error(`couldn't move light ${d.number} on the desk patch — nothing was saved`);
      if (!setInt(patch, 2, p.uni - 1) && p.uni > 1) throw new Error(`couldn't move light ${d.number} to universe ${p.uni} — nothing was saved`);
      d.addr = p.addr; d.uni = p.uni; moved++;
    }

    // ---- Fixture numbers you changed (and the desk's groups with them) ----
    // Light Spark's numbers win. A desk light Light Spark doesn't show (an
    // unpatched one) that holds a number you've given to another light moves
    // to a free number. Each change stands on its own: one that can't be
    // made doesn't stop the others.
    const finalNumber = new Map(z.fixtures.map(d => [d, d.number]));
    const shown = new Set([...pair.keys(), ...toUnpatch].filter(d => lsById.has(idOf(d)) || pair.has(d)));
    const wanted = new Map();
    for (const d of shown) {
      const ls = pair.get(d) || lsById.get(idOf(d));
      const n = Number(ls?.fixtureNumber);
      if (Number.isInteger(n) && n > 0 && n <= 9999) wanted.set(d, n);
    }
    const numberClash = [];
    const byWanted = new Map();
    for (const [d, n] of wanted) { if (byWanted.has(n)) numberClash.push(n); else byWanted.set(n, d); }
    for (const [n, d] of byWanted) finalNumber.set(d, n);
    let spare = Math.max(0, ...z.fixtures.map(d => d.number), ...byWanted.keys());
    for (const d of z.fixtures) if (!byWanted.has(finalNumber.get(d)) || byWanted.get(finalNumber.get(d)) !== d) { if (byWanted.has(finalNumber.get(d))) finalNumber.set(d, ++spare); }
    const renumbered = [];
    const change = new Map();
    for (const [d, n] of finalNumber) if (n !== d.number && setInt(nodeByIndex.get(d.index ?? 0), 8, n)) { change.set(d.number, n); renumbered.push(`${d.number}→${n}`); }
    if (change.size) for (const g of kidsOf(sec(0x1f))) for (const m of kidsOf(one(g, 0, { kind: 0x11 }))) {
      const ref = kidsOf(m).find(k => k.kids);
      const num = ref ? kidsOf(ref).find(x => x.field === 1 && x.value) : null;
      if (num && change.has(int(num))) num.value = intBytes(change.get(int(num)));
    }
    for (const [d, n] of finalNumber) d.number = n;

    // ---- Light names ----
    const cleanText = (t, n = 31) => String(t || "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, n);
    let renamed = 0;
    const wantLabel = d => cleanText(pair.get(d)?.label) || d.type.name;
    for (const [d] of pair) {
      const node = nodeByIndex.get(d.index ?? 0) || nodeOfIndex(d.index ?? 0);
      const now = text(one(node, 3));
      if (now === wantLabel(d)) continue;
      const leaf = one(node, 3);
      if (leaf) leaf.value = new TextEncoder().encode(wantLabel(d));
      renamed++;
    }

    // ---- Groups: Light Spark's (not its automatic ones) replace the desk's own ----
    // The desk's automatic groups ("Odd - …", "All - …") are left alone.
    const gsec = sec(0x1f);
    const deskNumbers = new Set([...pair.keys()].map(d => d.number));
    const memberNumber = m => { const f = allLs.find(x => String(x.id) === String(m)); return f ? Number(f.fixtureNumber) : Number(m); };
    const lsGroups = (S.groups || []).filter(g => g && g.name && !g.deskAuto)
      .map(g => ({ name: cleanText(g.name), members: [...new Set((g.members || []).map(memberNumber))].filter(n => deskNumbers.has(n)) }))
      .filter(g => g.name)
      // One desk group per name (the desk matches groups by name); the first wins.
      .filter((g, i, all) => all.findIndex(x => x.name.trim().toLowerCase() === g.name.trim().toLowerCase()) === i);
    const userGroups = kidsOf(gsec).filter(g => int(one(g, 7)) !== 1);
    const groupLike = userGroups[0] || kidsOf(gsec).find(g => kidsOf(one(g, 0, { kind: 0x11 })).length) || null;
    const memberLike = (() => { for (const g of kidsOf(gsec)) { const m = kidsOf(one(g, 0, { kind: 0x11 }))[0]; if (m) return m; } return null; })();
    const memberNums = g => kidsOf(one(g, 0, { kind: 0x11 })).map(m => ({ order: int(one(m, 0x12)) ?? 0, n: int(kidsOf(kidsOf(m).find(k => k.kids)).find(x => x.field === 1 && x.value)) })).sort((a, b) => a.order - b.order).map(x => x.n);
    const setMembers = (g, nums) => {
      const list = one(g, 0, { kind: 0x11 });
      // The desk writes members last-first, each with its place (0x12).
      list.kids = [{ open: true }, ...nums.map((n, i) => { const m = clone(memberLike); const ref = kidsOf(m).find(k => k.kids); kidsOf(ref).find(x => x.field === 1 && x.value).value = intBytes(n); setInt(m, 0x12, i); return m; }).reverse()];
    };
    let groupsAdded = 0, groupsChanged = 0, groupsRemoved = 0;
    if (gsec && (lsGroups.length || userGroups.length)) {
      if ((!groupLike || !memberLike) && lsGroups.length) throw new Error("the FLX show has no group to copy the layout from — make one group on the desk, save, and use that file. Nothing was saved");
      const byName = new Map(lsGroups.map(g => [g.name.toLowerCase(), g]));
      const done = new Set();
      for (const g of userGroups) {
        const want = byName.get(text(one(g, 2)).trim().toLowerCase());
        if (!want || done.has(want)) { gsec.kids = gsec.kids.filter(k => k !== g); groupsRemoved++; continue; }
        done.add(want);
        const now = memberNums(g);
        if (now.join(",") !== want.members.join(",")) { setMembers(g, want.members); groupsChanged++; }
      }
      let nextId = Math.max(0, ...kidsOf(gsec).map(g => int(one(g, 1)) ?? 0));
      for (const want of lsGroups) {
        if (done.has(want)) continue;
        const g = clone(groupLike);
        g.kids = g.kids.filter(k => k.open || k.kids || k.field !== 7);
        setInt(g, 1, ++nextId);
        one(g, 2).value = new TextEncoder().encode(want.name);
        setMembers(g, want.members);
        gsec.kids.splice(1, 0, g);              // last-first, like the desk
        groupsAdded++;
      }
    }

    // ---- Palettes: colour, beam and position ----
    // Light Spark's palettes, each light's values worked out from what
    // Light Spark would output for it. Channels Light Spark doesn't control
    // in a palette stay as they were.
    const palSec = sec(0x1d);
    const lsOfDesk = new Map([...pair].map(([d, ls]) => [String(ls.id), d]));
    const KIND = { Colour: 0x10, Beam: 0x20, Position: 0x30 };
    const recProto = (() => { // a light entry and a channel record to copy
      for (const g of kidsOf(palSec)) for (const e of kidsOf(g)) for (const h of kidsOf(one(e, 0xa))) for (const l of kidsOf(h).filter(k => k.kids)) {
        const r = kidsOf(one(l, 0, { kind: 0x11 })).find(x => kidsOf(x).length === 2 && one(x, 0x11) && one(x, 0x10));
        if (r) return { light: l, rec: r };
      }
      return null;
    })();
    const deskOff = (d, ls, ch) => {
      const def = defOf(ls);
      if (def?.fromZerOS && Number(def.channels) === d.type.channels) return ch.offset - 1;
      const a = attribute(ch.label, ch.code, ch.code2);
      return a && typeof def?.map?.[a] === "number" ? def.map[a] : null;
    };
    function paletteWant(p, kind) {
      const states = new Map();
      for (const id of new Set([...(p.fixtures || []), ...Object.keys(p.perFixture || {})])) if (lsOfDesk.has(String(id))) states.set(String(id), { intensity: 100, ...(p.values || {}), ...(p.perFixture?.[id] || {}) });
      const want = new Map();
      if (!states.size) return want;
      const dmx = window.LXAscii?.dmxFor?.(states);
      if (!dmx) throw new Error("couldn't work out palette values — nothing was saved");
      for (const id of states.keys()) {
        const d = lsOfDesk.get(id), ls = pair.get(d);
        const lsBase = (uniOf(ls) - 1) * 512 + Number(ls.addr) - 1;
        const m = new Map();
        for (const ch of d.type.list) {
          if (!PALETTE_ATTRS[kind].has(attribute(ch.label, ch.code, ch.code2))) continue;
          const off = deskOff(d, ls, ch);
          if (off == null) continue;
          const c = dmx[lsBase + off] ?? 0;
          m.set(ch.index, ch.width === 2 ? c * 256 : c * 257);
        }
        if (m.size) want.set(d.index ?? 0, m);
      }
      return want;
    }
    const lightsOf = e => kidsOf(kidsOf(one(e, 0xa))[0]).filter(k => k.kids);
    const valuesOf = l => new Map(kidsOf(one(l, 0, { kind: 0x11 })).filter(r => one(r, 0x10) && !one(r, 0x12)).map(r => [int(one(r, 0x11)) ?? 0, int(one(r, 0x10))]));
    const homeOf = (i, param) => { const d = z.fixtures.find(x => (x.index ?? 0) === i); return d?.type?.list.find(c => c.index === param)?.home ?? 0; };
    // Does a desk palette light hold any channel Light Spark controls here?
    const managed = (i, m, kind) => { const d = z.fixtures.find(x => (x.index ?? 0) === i); const ls = d && pair.get(d); return !!ls && d.type.list.some(ch => m.has(ch.index) && PALETTE_ATTRS[kind].has(attribute(ch.label, ch.code, ch.code2)) && deskOff(d, ls, ch) != null); };
    const EMITTERS = new Set(["r", "g", "b", "w", "amber", "lime", "cyan", "uv", "warmWhite", "coolWhite"]);
    const emitterParam = (i, p) => { const d = z.fixtures.find(x => (x.index ?? 0) === i); const ch = d?.type?.list.find(c => c.index === p); return Boolean(ch) && EMITTERS.has(attribute(ch.label, ch.code, ch.code2)); };
    function samePalette(e, want, kind) {
      const now = new Map(lightsOf(e).map(l => [int(one(l, 1)) ?? 0, valuesOf(l)]));
      for (const [i, m] of want) {
        const n = now.get(i); if (!n) return false;
        for (const [p, v] of m) {
          // The desk's own palettes always hold every emitter channel; one left out (by an older Light Spark) needs writing.
          if (!n.has(p) && kind === 0x10 && emitterParam(i, p)) return false;
          if (Math.abs(((n.get(p) ?? homeOf(i, p)) >> 8) - (v >> 8)) > 1) return false;
        }
      }
      for (const [i, m] of now) if (!want.has(i) && managed(i, m, kind)) return false;
      return true;
    }
    function writePalette(e, want, exact = false) {
      const holder = kidsOf(one(e, 0xa))[0];
      const keep = lightsOf(e).filter(l => { const i = int(one(l, 1)) ?? 0; return !want.has(i) && !managed(i, valuesOf(l), e.__kind); });
      const lights = new Map(lightsOf(e).map(l => [int(one(l, 1)) ?? 0, l]));
      const out = [...keep];
      for (const [i, m] of want) {
        const l = lights.get(i) || (() => { const n = clone(recProto.light); setInt(n, 1, i); one(n, 0, { kind: 0x11 }).kids = [{ open: true }]; return n; })();
        const pg = one(l, 0, { kind: 0x11 });
        for (const [param, v] of m) {
          let r = kidsOf(pg).find(x => (int(one(x, 0x11)) ?? 0) === param);
          // Every channel the palette sets is written, even one at its default
          // (red at full in pink): leaving it out would let the colour before
          // it show through, the way the desk's own palettes never do.
          if (r) { r.kids = r.kids.filter(k => k.open || k.field !== 0x12); if (one(r, 0x10)) setInt(r, 0x10, v); else { const vn = clone(one(recProto.rec, 0x10)); vn.value = intBytes(v); r.kids.push(vn); } }
          else { r = clone(recProto.rec); setInt(r, 0x11, param); setInt(r, 0x10, v); pg.kids.splice(1, 0, r); }
        }
        out.push(l);
      }
      holder.kids = [{ open: true }, ...out.sort((a, b) => (int(one(a, 1)) ?? 0) - (int(one(b, 1)) ?? 0))];
    }
    // The colour strip the desk shows for a colour palette (field 0x10):
    // 0 hue (a fraction of a turn, 32-bit), 1 saturation, 2 brightness
    // (0-65535), 3 colour temperature for whites (K), 4 always full.
    const u32 = v => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    function swatchOf(p) {
      const name = String(p.name || "").toLowerCase();
      const first = Object.values(p.perFixture || {})[0] || {};
      const v = { ...first, ...(p.values || {}) };
      if (/white/.test(name) && !/blue|pink|green|red/.test(name)) return [0, 0, 65535, /warm/.test(name) ? 3200 : /cool/.test(name) ? 10000 : 6600];
      let hue = Number(v.hue), sat = Number(v.sat ?? v.saturation), light = Number(v.light ?? v.lightness);
      if (!Number.isFinite(hue) && [v.r, v.g, v.b].some(x => Number.isFinite(Number(x)))) {
        const hs = hsl([Number(v.r) || 0, Number(v.g) || 0, Number(v.b) || 0]); hue = hs.hue; sat = hs.sat; light = hs.light;
      }
      if (!Number.isFinite(hue)) return null;
      sat = Number.isFinite(sat) ? sat / 100 : 1; light = Number.isFinite(light) ? light / 100 : 0.5;
      // HSL → the desk's hue / saturation / brightness (HSV).
      const val = light + sat * Math.min(light, 1 - light), sv = val ? 2 * (1 - light / val) : 0;
      return [Math.round((((hue % 360) + 360) % 360) / 360 * 4294967296) >>> 0, Math.round(Math.max(0, Math.min(1, sv)) * 65535), 65535, 6600];
    }
    function setSwatch(e, p) {
      const block = one(e, 0x10); if (!block?.kids) return;
      const sw = swatchOf(p); if (!sw) return;
      sw.forEach((v, f) => { const k = one(block, f); if (k) k.value = u32(v); });
      const four = one(block, 4); if (four) four.value = u32(65535);
    }
    // The desk's own colour-picker palettes: its exact values for each
    // fixture type at that colour. The desk only shows a palette's colour
    // strip when every light's values are exactly what its colour picker
    // works out, so a Light Spark palette of the same colour borrows them.
    const u32of = v => v && v.length >= 4 ? (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0 : null;
    const colourRefs = [];
    {
      const cg = kidsOf(palSec).find(g => g.kids && g.kind === 0x10);
      for (const e of kidsOf(cg)) {
        const block = one(e, 0x10); if (!block?.kids) continue;
        const sw = [0, 1, 2, 3, 4].map(f => u32of(one(block, f)?.value));
        if (sw.some(v => v == null)) continue;
        const byType = new Map();
        for (const [i, m] of z.paletteMap.get(`16:${int(one(e, 1))}`) || []) {
          const d = z.fixtures.find(x => (x.index ?? 0) === i);
          if (d?.type && !byType.has(d.type.id)) byType.set(d.type.id, new Map(m));
        }
        if (byType.size) colourRefs.push({ sw, byType, raw: kidsOf(block).map(k => ({ field: k.field, value: k.value.slice() })) });
      }
    }
    // The desk's colour picker for plain RGB and RGBW lights (checked against
    // every value in the desk's own palettes): HSV, scaled by the white point
    // (colour temperature), white = the smallest of red, green and blue.
    const WHITE_POINT = { 6600: [65535, 65535, 65535], 10000: [51636, 56787, 65535], 3200: [65535, 47101, 18819] };
    function pickerValues(type, sw) {
      const L = type.list, find = c => L.find(x => x.code === c || x.code2 === c);
      const R = find(86), G = find(87), B = find(88), W = find(35);
      if (!R || !G || !B || L.some(x => [60, 67, 78, 77, 62].includes(x.code) || [60, 67, 78].includes(x.code2))) return null;
      const wp = WHITE_POINT[sw[3]]; if (!wp) return null;
      const h = sw[0] / 4294967296, sat = sw[1] / 65535, v = sw[2] / 65535;
      let i = Math.floor(h * 6); const f = h * 6 - i; i %= 6;
      const pp = v * (1 - sat), q = v * (1 - sat * f), t = v * (1 - sat * (1 - f));
      const rgb = [[v, t, pp], [q, v, pp], [pp, v, t], [pp, q, v], [t, pp, v], [v, pp, q]][i].map((x, j) => Math.round(x * wp[j]));
      const m = W ? Math.min(...rgb) : 0;
      const out = new Map([[R.index, rgb[0] - m], [G.index, rgb[1] - m], [B.index, rgb[2] - m]]);
      if (W) out.set(W.index, m);
      return out;
    }
    function deskColour(p, want) {
      const sw = swatchOf(p); if (!sw) return null;
      const hueDeg = sw[0] / 4294967296 * 360, sat = sw[1] / 65535;
      const near = colourRefs.find(r => {
        const rs = r.sw[1] / 65535;
        if (sat < 0.05 || rs < 0.05) return sat < 0.05 && rs < 0.05 && r.sw[3] === sw[3];
        const dh = Math.abs(((r.sw[0] / 4294967296 * 360 - hueDeg) % 360 + 540) % 360 - 180);
        return dh <= 10 && Math.abs(rs - sat) <= 0.12;
      });
      const ref = near || { sw: [...sw, 65535], byType: new Map(), raw: [0, 1, 2, 3, 4].map(f => ({ field: f, value: u32([...sw, 65535][f]) })) };
      // Only a palette that's one colour on every light (not one with lights
      // set to different colours).
      const same = (x, y) => {
        if (!x || !y) return false;
        const xs = x[1] / 65535, ys = y[1] / 65535;
        if (xs < 0.05 || ys < 0.05) return xs < 0.05 && ys < 0.05 && x[3] === y[3];
        const dh = Math.abs(((x[0] - y[0]) / 4294967296 * 360 % 360 + 540) % 360 - 180);
        return dh <= 3 && Math.abs(xs - ys) <= 0.04;
      };
      for (const id of Object.keys(p.perFixture || {})) if (!same(swatchOf({ name: p.name, values: { ...(p.values || {}), ...p.perFixture[id] } }), sw)) return null;
      const out = new Map();
      for (const [i] of want) {
        const d = z.fixtures.find(x => (x.index ?? 0) === i);
        const m = d?.type && (ref.byType.get(d.type.id) || pickerValues(d.type, ref.sw));
        if (!m) return null; // a fixture type whose colour mixing isn't known here
        out.set(i, new Map(m));
      }
      return { want: out, ref };
    }
    function setSwatchRaw(e, ref) {
      const block = one(e, 0x10); if (!block?.kids) return;
      for (const r of ref.raw) { const k = one(block, r.field); if (k) k.value = r.value.slice(); }
    }
    let palAdded = 0, palChanged = 0, palRemoved = 0, palStrips = 0;
    const palWant = [];
    if (palSec && recProto) for (const kind of [0x10, 0x20, 0x30]) {
      const group = kidsOf(palSec).find(g => g.kids && g.kind === kind);
      if (!group) continue;
      const mine = (S.palettes || []).filter(p => p && KIND[p.category] === kind && p.name);
      const brought = new Set((S.zos?.palettes || []).filter(k => k.startsWith(`${kind}:`)));
      const matched = new Set();
      for (const p of mine) {
        // A palette that hasn't changed since it came from the desk stays exactly as the desk has it.
        const own = p.zos?.kind === kind && p.zos.sig && p.zos.sig === palSig(p) ? kidsOf(group).find(x => int(one(x, 1)) === p.zos.id && !matched.has(x)) : null;
        if (own) {
          matched.add(own);
          palWant.push({ kind, id: p.zos.id, name: text(one(own, 0xb)), want: new Map([...(z.paletteMap.get(`${kind}:${p.zos.id}`) || [])].filter(([i]) => [...pair.keys()].some(d => (d.index ?? 0) === i))) });
          continue;
        }
        let want = paletteWant(p, kind);
        if (!want.size) continue;
        // A palette from the desk with some lights changed here: the lights not
        // changed keep the desk's exact values.
        if (p.zos?.kind === kind && p.zos.lightSigs) {
          const desk = z.paletteMap.get(`${kind}:${p.zos.id}`);
          for (const [i] of want) {
            const ls = [...pair].find(([d]) => (d.index ?? 0) === i)?.[1]; if (!ls) continue;
            const id = String(ls.id), before = p.zos.lightSigs[id];
            if (before && before === JSON.stringify({ ...(p.values || {}), ...(p.perFixture?.[id] || {}) }) && desk?.get(i)) want.set(i, new Map(desk.get(i)));
          }
        }
        const desk = kind === 0x10 ? deskColour(p, want) : null;
        if (desk) want = desk.want;
        const pname = cleanText(p.name);
        let e = (p.zos?.kind === kind && kidsOf(group).find(x => int(one(x, 1)) === p.zos.id && !matched.has(x))) || kidsOf(group).find(x => !matched.has(x) && text(one(x, 0xb)).trim().toLowerCase() === pname.toLowerCase());
        if (e) e.__kind = kind;
        const isNew = !e;
        if (!e) {
          const like = kidsOf(group).find(x => one(x, 0xa));
          if (!like) continue;
          e = clone(like); e.__kind = kind;
          setInt(e, 1, Math.max(0, ...kidsOf(group).map(x => int(one(x, 1)) ?? 0)) + 1);
          kidsOf(one(e, 0xa))[0].kids = [{ open: true }];
          group.kids.splice(1, 0, e);
          writePalette(e, want, Boolean(desk));
          if (desk) { setSwatchRaw(e, desk.ref); palStrips++; } else if (kind === 0x10) setSwatch(e, p);
          palAdded++;
        } else if (!samePalette(e, want, kind)) { writePalette(e, want, Boolean(desk)); if (desk) { setSwatchRaw(e, desk.ref); palStrips++; } else if (kind === 0x10) setSwatch(e, p); palChanged++; }
        if (text(one(e, 0xb)) !== pname && one(e, 0xb)) { one(e, 0xb).value = new TextEncoder().encode(pname); if (!isNew) palChanged++; }
        matched.add(e);
        delete e.__kind;
        palWant.push({ kind, id: int(one(e, 1)), name: pname, want });
      }
      for (const e of kidsOf(group)) if (!matched.has(e) && brought.has(`${kind}:${int(one(e, 1))}`)) { group.kids = group.kids.filter(k => k !== e); palRemoved++; }
    }

    // ---- Cues: only what's different from the desk's show is written ----
    const stacks = top.find(n => n.section === 0x50 && n.kids);
    const pbs = kidsOf(stacks).filter(pb => !/^grand master$/i.test(text(one(pb, 2))) && one(pb, 0, { kind: 0x10 }) && !isChaseNode(pb));
    const pb = pbs.sort((a, b) => kidsOf(one(b, 0, { kind: 0x10 })).length - kidsOf(one(a, 0, { kind: 0x10 })).length || (int(one(a, 1)) ?? 0) - (int(one(b, 1)) ?? 0))[0];
    const list = pb ? one(pb, 0, { kind: 0x10 }) : null;
    const proto = list ? kidsOf(list)[0] : null;
    if (!proto) throw new Error("the FLX show needs at least one cue in a playback to copy from — record one cue on the desk, save, and use that file");
    let entryProto = null, paramProto = null;
    for (const c of kidsOf(list)) for (const h of kidsOf(one(c, 0xf))) for (const e of kidsOf(h)) {
      const pg = one(e, 0, { kind: 0x11 });
      const pr = kidsOf(pg).find(r => kidsOf(r).length === 2 && one(r, 0x11) && one(r, 0x10));
      if (!entryProto && pg) entryProto = e;
      if (!paramProto && pr) paramProto = pr;
    }
    if (!entryProto || !paramProto) throw new Error("couldn't find a lit light in the FLX show's cues to copy the layout from");

    const paletteMap = paletteValues(main);
    const holderOf = c => kidsOf(one(c, 0xf))[0] || null;
    const entriesOf = h => kidsOf(h).filter(k => k.kids);
    const paramOf = r => int(kidsOf(r).find(x => x.field === 0x11 && x.value)) ?? 0;
    const valueOf = r => int(kidsOf(r).find(x => x.field === 0x10 && x.value));
    const homes = () => new Map(z.fixtures.filter(d => d.type).map(d => [d.index ?? 0, new Map(d.type.list.map(ch => [ch.index, ch.home ?? 0]))]));
    const copyState = st => new Map([...st].map(([i, m]) => [i, new Map(m)]));
    const applyCue = (st, c) => {
      const h = holderOf(c); if (!h) return;
      for (const e of entriesOf(h)) {
        const m = st.get(int(one(e, 1)) ?? 0); if (!m) continue;
        for (const r of kidsOf(one(e, 0, { kind: 0x11 }))) { const { param, value } = recordValue(r, int(one(e, 1)) ?? 0, paletteMap); if (value != null) m.set(param, value); }
      }
    };
    function setParam(h, idx, param, v) {
      let e = entriesOf(h).find(k => (int(one(k, 1)) ?? 0) === idx);
      if (!e) {
        e = clone(entryProto); setInt(e, 1, idx);
        one(e, 0, { kind: 0x11 }).kids = [{ open: true }];
        h.kids = [{ open: true }, ...[...entriesOf(h), e].sort((a, b) => (int(one(a, 1)) ?? 0) - (int(one(b, 1)) ?? 0))];
      }
      const pg = one(e, 0, { kind: 0x11 });
      const r = kidsOf(pg).find(k => paramOf(k) === param);
      if (r) {
        // A palette reference becomes a plain value (the palette is left alone).
        r.kids = r.kids.filter(k => k.open || k.field !== 0x12);
        if (one(r, 0x10)) setInt(r, 0x10, v);
        else { const vn = clone(one(paramProto, 0x10)); vn.value = intBytes(v); const at = r.kids.indexOf(one(r, 0x11)); r.kids.splice(at >= 0 ? at + 1 : r.kids.length, 0, vn); }
        return;
      }
      const nr = clone(paramProto); setInt(nr, 0x11, param); setInt(nr, 0x10, v);
      pg.kids.push(nr);
    }

    // Set a cue's setting, adding it (after the cue number) if the cue has none.
    function setLeaf(c, field, v) {
      if (setInt(c, field, v)) return;
      const like = kidsOf(c).find(k => k.value && k.field === 1);
      const leaf = { field, kind: like?.kind ?? 0x11, section: like?.section ?? 0x51, raw: 0, value: intBytes(v) };
      const at = c.kids.indexOf(kidsOf(c).find(k => k.field === 3) || like);
      c.kids.splice(at >= 0 ? at + 1 : c.kids.length, 0, leaf);
    }
    // ---- Effects ----
    const fxNames = new Map(z.palettes.filter(p => p.code === 0x40).map(p => [p.id, p.name]));
    const FX_PREFER = { colourfade: /^fade/, colourstep: /^kaleidoscope/, sparkle: /^sparkle - blue/, police: /^emergency - red/ };
    const fxIdFor = type => (FX_PREFER[type] && [...fxNames].sort((a, b) => a[0] - b[0]).find(([, n]) => FX_TYPE_OF(n) === type && FX_PREFER[type].test(n.toLowerCase()))?.[0])
      || [...fxNames].sort((a, b) => a[0] - b[0]).find(([, n]) => FX_TYPE_OF(n) === type)?.[0]
      || (FX_NEAREST[type] && [...fxNames].sort((a, b) => a[0] - b[0]).find(([, n]) => FX_NEAREST[type].test(n.toLowerCase()))?.[0]) || null;
    // (Shows opened before the desk's colour effects had their own looks call them all "rainbow".)
    const fxFits = (id, type) => { const n = fxNames.get(id); return Boolean(n) && (FX_TYPE_OF(n) === type || Boolean(FX_NEAREST[type]?.test(n.toLowerCase())) || (type === "rainbow" && /rainbow|kaleidoscope/i.test(n))); };
    const fxSubstituted = new Map();
    const applyFx = (st, c) => {
      const h = holderOf(c); if (!h) return;
      for (const e of entriesOf(h)) {
        const m = st.get(int(one(e, 1)) ?? 0); if (!m) continue;
        for (const r of kidsOf(one(e, 0, { kind: 0x11 }))) if (kidsOf(r).some(k => k.field === 0x20)) { const o = fxOfRecord(r, z.fxPalettes, int(one(e, 1)) ?? 0); if (o && o[0x20]) m.set(paramOf(r), o); else m.delete(paramOf(r)); }
      }
    };
    const fxParamsFor = (d, ls, type) => {
      const want = FX_ATTRS(type), out = [];
      for (const ch of d.type.list) { const a = attribute(ch.label, ch.code, ch.code2); if (want.has(a) && deskOff(d, ls, ch) != null) out.push([ch.index, a === "r" ? 32768 : a === "g" ? 54399 : a === "b" ? 10367 : 0]); } // the desk's own rainbow phases
      return out;
    };
    const unsupportedFx = new Set();
    function wantedFx(cue) {
      const list = Array.isArray(cue.effects) && cue.effects.length ? cue.effects : (cue.effect?.type ? [cue.effect] : []);
      const out = new Map();
      for (const e of list) {
        if (!e || !e.type) continue;
        const sameType = e.zos?.effect && fxFits(e.zos.effect, e.type);
        const effectId = sameType ? e.zos.effect : fxIdFor(e.type);
        if (!effectId) { unsupportedFx.add(e.name || e.type); continue; }
        const deskType = FX_TYPE_OF(fxNames.get(effectId));
        const sameSpeed = sameType && e.zos.speed != null && Math.abs(fxSpeed(e.zos.speed) - Number(e.speed ?? 1)) < 1e-3;
        const ids = e.fixtureMode === "all" ? [...pair.values()].map(l => String(l.id)) : (e.fixtureIds || []).map(String);
        // As the desk records an effect: full size, the lights spread out
        // one after another (Forward offset), its second speed setting
        // following the speed.
        const onDesk = ids.filter(id => lsOfDesk.has(id));
        let k = -1;
        for (const id of ids) {
          const d = lsOfDesk.get(id); if (!d) continue;
          k++;
          const spread = fxSpread(k, onDesk.length);
          let params = sameType && e.zos.params?.[d.index ?? 0] ? Object.entries(e.zos.params[d.index ?? 0]).map(([p, ph]) => [Number(p), ph]) : fxParamsFor(d, pair.get(d), deskType);
          let useId = effectId;
          // A light without what this effect moves (a rainbow on a white-only
          // light): pulse its brightness with the desk's Smooth instead.
          if (!params.length && deskType !== "sine") {
            const smooth = fxIdFor("sine");
            if (smooth) { params = fxParamsFor(d, pair.get(d), "sine"); useId = smooth; if (params.length) fxSubstituted.set(`${e.name || e.type} on light ${d.number}`, fxNames.get(smooth)); }
          }
          if (useId === effectId && params.length && deskType !== e.type) fxSubstituted.set(e.name || e.type, fxNames.get(effectId));
          const m = out.get(d.index ?? 0) || new Map();
          const per = (sameType && e.zos.lights?.[d.index ?? 0]) || {};
          const speedRaw = sameSpeed ? e.zos.speed : fxRaw(e.speed);
          for (const [param, phase] of params) m.set(param, { 0x20: useId, 0x30: speedRaw, 0x40: sameType && e.zos.size ? e.zos.size : 65535, 0x50: per.f50 ?? spread, 0x60: per.f60 ?? Math.max(0, Math.min(65535, Math.round(21616 + 0.4296 * speedRaw))), 0x70: phase });
          out.set(d.index ?? 0, m);
        }
      }
      return out;
    }
    function setFx(h, idx, param, o) {
      let e = entriesOf(h).find(k => (int(one(k, 1)) ?? 0) === idx);
      if (!e) {
        e = clone(entryProto); setInt(e, 1, idx);
        one(e, 0, { kind: 0x11 }).kids = [{ open: true }];
        h.kids = [{ open: true }, ...[...entriesOf(h), e].sort((a, b) => (int(one(a, 1)) ?? 0) - (int(one(b, 1)) ?? 0))];
      }
      const pg = one(e, 0, { kind: 0x11 });
      let r = kidsOf(pg).find(k => paramOf(k) === param);
      if (!r) { r = clone(paramProto); setInt(r, 0x11, param); r.kids = r.kids.filter(k => k.open || k.field === 0x11); pg.kids.push(r); }
      for (const f of FX_FIELDS) {
        let leaf = kidsOf(r).find(k => k.field === f && k.value);
        if (!leaf) { leaf = { ...clone(one(paramProto, 0x10)), field: f }; r.kids.push(leaf); }
        leaf.value = intBytes(o[f]);
      }
    }
    let fxState = new Map(z.fixtures.filter(d => d.type).map(d => [d.index ?? 0, new Map()]));
    const fxWanted = new Map(); // cue (hundredths) → light → channel → effect
    let fxChanged = 0;

    const baseByNumber = new Map(kidsOf(list).map(c => [int(one(c, 1)) ?? 0, c]));
    const lsCues = (S.cues || []).map((cue, i) => ({ cue, i })).filter(x => x.cue)
      .map(x => ({ ...x, number: Number(window.cueLabel ? window.cueLabel(x.i) : x.i + 1) || x.i + 1 }))
      .sort((a, b) => a.number - b.number);
    const seen = new Map();
    for (const x of lsCues) {
      const key = Math.round(x.number * 100);
      if (key < 1 || key > 99999) throw new Error(`cue ${x.number} can't be stored on the desk (cues go from 0.01 to 999.99) — nothing was saved`);
      if (seen.has(key)) throw new Error(`cues ${seen.get(key)} and ${x.number} would both be cue ${key / 100} on the desk (it keeps two decimal places) — renumber one, nothing was saved`);
      seen.set(key, x.number);
    }
    let state = homes(), changed = 0, kept = 0, added = 0, named = 0;
    const nameFor = (cue, number) => {
      const label = String(cue.name || "").trim();
      const placeholder = new RegExp(`^cue\\s*${String(Math.round(number * 100) / 100).replace(".", "\\.")}$`, "i");
      return !label || placeholder.test(label) ? "" : label.replace(/[^\x20-\x7e]/g, "").slice(0, 31);
    };
    const lsOutput = new Map(); // cue (hundredths) → Light Spark's DMX for it
    const lightsChanged = new Set();
    const newCues = [];
    for (const { cue, i, number } of lsCues) {
      const key = Math.round(number * 100);
      const baseCue = baseByNumber.get(key);
      const c = clone(baseCue || proto);
      setInt(c, 1, key);
      const h = holderOf(c);
      if (!baseCue && h) h.kids = [{ open: true }];
      // Its name (none for Light Spark's own "Cue 5" placeholder).
      const wantName = nameFor(cue, number);
      if (text(one(c, 2)) !== wantName) {
        c.kids = c.kids.filter(k => k.open || k.kids || k.field !== 2);
        if (wantName) {
          const like = kidsOf(c).find(k => k.value && k.field === 1);
          c.kids.splice(c.kids.indexOf(like) + 1, 0, { field: 2, kind: like?.kind ?? 0x11, section: like?.section ?? 0x51, raw: 0, value: new TextEncoder().encode(wantName) });
        }
        named++;
      }
      // Times: fade up / down and their delays, colour, beam and position.
      const timing = cue.timing && typeof cue.timing === "object" ? cue.timing : {};
      const fade = Number(cue.fade ?? 0) || 0, wait = Number(cue.delay ?? 0) || 0;
      const part = (k, d) => { const v = Number(timing[k]); return Number.isFinite(v) && timing[k] !== "" && timing[k] != null ? v : d; };
      const want = { 0xa: part("up", fade), 0x6: part("upDelay", wait), 0x1c: part("down", fade), 0x1d: part("downDelay", wait), 0xb: part("colour", fade), 0x7: part("colourDelay", wait), 0xc: part("beam", fade), 0x8: part("beamDelay", wait), 0xd: part("focus", fade), 0x9: part("focusDelay", wait) };
      for (const [f, v] of Object.entries(want)) if (Math.abs((int(one(c, Number(f))) ?? 0) - v) > 50) setLeaf(c, Number(f), Math.round(v));
      // Trigger: this cue goes by itself when the one before follows on.
      const prev = lsCues[lsCues.indexOf(lsCues.find(x => x.i === i)) - 1]?.cue;
      const trig = prev?.followEnabled === true ? (prev.followMode === "go" ? 6 : 0) : 1;
      const waitMs = trig === 1 ? 0 : Math.round(Math.max(0, Number(prev.follow) || 0) * 1000);
      if ((int(one(c, 3)) ?? 1) !== trig) setLeaf(c, 3, trig);
      if (trig === 1) c.kids = c.kids.filter(k => k.open || k.kids || k.field !== 4);
      else if ((int(one(c, 4)) ?? 0) !== waitMs) setLeaf(c, 4, waitMs);
      if (baseCue) kept++; else added++;
      if (h) {
        const expect = copyState(state); applyCue(expect, c);
        const dmx = window.LXAscii?.dmxFor?.(window.cueLook?.(i)?.fixtureMap || new Map());
        if (!dmx) throw new Error("couldn't work out the cue levels — nothing was saved");
        lsOutput.set(key, dmx);
        for (const [d, ls] of pair) {
          const m = expect.get(d.index ?? 0); if (!m) continue;
          const def = defOf(ls), own = def?.fromZerOS && Number(def.channels) === d.type.channels;
          const lsBase = (uniOf(ls) - 1) * 512 + Number(ls.addr) - 1;
          for (const ch of d.type.list) {
            let off = null;
            if (own) off = ch.offset - 1;
            else { const a = attribute(ch.label, ch.code, ch.code2); if (a && typeof def?.map?.[a] === "number") off = def.map[a]; }
            if (off == null) continue;
            const coarse = dmx[lsBase + off] ?? 0;
            if (Math.abs(((m.get(ch.index) ?? ch.home ?? 0) >> 8) - coarse) <= 1) continue;
            setParam(h, d.index ?? 0, ch.index, ch.width === 2 ? coarse * 256 + (own ? (dmx[lsBase + off + 1] ?? 0) : 0) : coarse * 257);
            changed++; lightsChanged.add(d.number);
          }
        }
      }
      // Effects: what Light Spark runs in this cue against what the desk would.
      if (h) {
        const expectFx = new Map([...fxState].map(([i, m]) => [i, new Map(m)])); applyFx(expectFx, c);
        const want = wantedFx(cue);
        fxWanted.set(key, want);
        for (const [d] of pair) {
          const i = d.index ?? 0, now = expectFx.get(i) || new Map(), w = want.get(i) || new Map();
          for (const [param, o] of w) if (fxKey(now.get(param)) !== fxKey(o)) { setFx(h, i, param, o); fxChanged++; lightsChanged.add(d.number); }
          for (const [param] of now) if (!w.has(param)) { setFx(h, i, param, { ...FX_DEFAULT }); fxChanged++; lightsChanged.add(d.number); }
        }
      }
      applyCue(state, c);
      applyFx(fxState, c);
      newCues.push({ number, node: c });
    }
    const removed = [...baseByNumber.keys()].filter(k => !lsCues.some(x => Math.round(x.number * 100) === k)).length;
    // The desk writes cues last-first.
    newCues.sort((a, b) => b.number - a.number);
    list.kids = [{ open: true }, ...newCues.map(x => x.node)];
    const fixturesForCue = [...pair.keys()];

    // ---- The Effects page: each saved effect is a recorded effect palette ----
    // Laid out as the desk records one (Effects → pick an effect → Record →
    // a palette): every light, every channel the effect moves, with the
    // effect, its speed, size and each light's offset. Effects that came
    // from the desk's cues (zos.cue) stay in their cues only, and an effect
    // that hasn't changed since it came from the desk is left as it was.
    const fxGroup = kidsOf(palSec).find(g => g.kids && g.kind === 0x40);
    const fxBrought = new Set((S.zos?.palettes || []).filter(k => String(k).startsWith("64:")));
    const fxPalWant = [], fxSkipped = [], fxAssign = [];
    let fxPalAdded = 0, fxPalChanged = 0, fxPalRemoved = 0;
    if (fxGroup) {
      const builtIn = x => Boolean(one(x, 0xe)) || !one(x, 0xa);
      const tag = kidsOf(fxGroup)[0];
      const leafLike = one(tag, 1);
      const leaf = (field, v, kind = leafLike?.kind ?? 0, section = leafLike?.section ?? 0x1d) => ({ field, kind, section, raw: 0, value: typeof v === "string" ? new TextEncoder().encode(v) : intBytes(v) });
      const grp = (field, kind, section, kids) => ({ field, kind, section, raw: 0x80000000, kids: [{ open: true }, ...kids] });
      const lightNode = (index, m) => grp(0, 0x10, 0x71, [
        leaf(1, index, 0x10, 0x71),
        grp(0, 0x11, 0x71, [...m].sort((a, b) => b[0] - a[0]).map(([param, o]) => grp(0x10, 0x11, 0x71, [leaf(0x11, param, 0x11, 0x71), ...FX_FIELDS.map(f => leaf(f, o[f], 0x12, 0x71))])))
      ]);
      const nowOf = x => fxPaletteValues({ kids: [{ section: 0x1d, kids: [{ kind: 0x40, kids: [x] }] }] }).get(int(one(x, 1)))?.lights || new Map();
      const sameFx = (a, b) => a.size === b.size && [...b].every(([i, m]) => { const n = a.get(i); return n && n.size === m.size && [...m].every(([p, o]) => fxKey(n.get(p)) === fxKey(o)); });
      const matchedFx = new Set();
      for (const e of Object.values(S.savedEffects || {})) {
        if (!e || !e.type || e.zos?.cue || (e.zos?.builtin && e.fixtureMode !== "all" && !(e.fixtureIds || []).length)) continue;
        const name = cleanText(e.name || e.type);
        const own = e.zos?.kind === 0x40 ? kidsOf(fxGroup).find(x => int(one(x, 1)) === e.zos.id && !builtIn(x) && !matchedFx.has(x)) : null;
        if (own && e.zos.sig && e.zos.sig === fxSig(e)) {
          matchedFx.add(own);
          fxPalWant.push({ id: e.zos.id, name, want: nowOf(own) });
          fxAssign.push({ e, id: e.zos.id });
          continue;
        }
        const ids = e.fixtureMode === "all" ? [...pair.values()].map(l => String(l.id)) : (e.fixtureIds || []).map(String);
        const want = ids.length ? wantedFx({ effects: [{ ...e, fixtureMode: "custom", fixtureIds: ids }] }) : new Map();
        if (!want.size) { fxSkipped.push(name); continue; }
        let node = own || kidsOf(fxGroup).find(x => !builtIn(x) && !matchedFx.has(x) && text(one(x, 0xb)).trim().toLowerCase() === name.toLowerCase());
        if (!node) {
          const id = Math.max(45, ...kidsOf(fxGroup).map(x => int(one(x, 1)) ?? 0)) + 1;
          node = { ...tag, kids: [{ open: true }, leaf(1, id), leaf(0xb, name), leaf(0xc, 4), grp(0xa, leafLike?.kind ?? 0, leafLike?.section ?? 0x1d, [grp(0, 0, 0x71, [])])] };
          fxGroup.kids.splice(1, 0, node);
          fxPalAdded++;
        } else if (!sameFx(nowOf(node), want) || text(one(node, 0xb)) !== name) {
          if (one(node, 0xb)) one(node, 0xb).value = new TextEncoder().encode(name);
          fxPalChanged++;
        }
        matchedFx.add(node);
        const holder = kidsOf(one(node, 0xa))[0];
        if (!sameFx(nowOf(node), want)) holder.kids = [{ open: true }, ...[...want].sort((a, b) => a[0] - b[0]).map(([i, m]) => lightNode(i, m))];
        fxPalWant.push({ id: int(one(node, 1)), name, want });
        fxAssign.push({ e, id: int(one(node, 1)) });
      }
      // Recorded effects that came from this FLX file and were deleted here.
      for (const x of kidsOf(fxGroup)) if (!builtIn(x) && !matchedFx.has(x) && fxBrought.has(`64:${int(one(x, 1))}`)) { fxGroup.kids = fxGroup.kids.filter(k => k !== x); fxPalRemoved++; }
    }

    // ---- Chases: each Light Spark chase is a chase playback on the desk ----
    // One step (cue) per look, holding every channel of the chase's lights,
    // run at the chase's speed in beats per minute, round and round or once.
    // A chase that hasn't changed since it came from the desk is left alone.
    const chaseNodes = new Map(kidsOf(stacks).filter(isChaseNode).map(n => [int(one(n, 1)) ?? 0, n]));
    const chaseNumbers = new Set((S.zos?.chases || []).map(Number));
    const takenNumbers = new Set(kidsOf(stacks).map(n => int(one(n, 1)) ?? 0));
    const nextNumber = () => { let n = 1; while (takenNumbers.has(n)) n++; takenNumbers.add(n); return n; };
    const chaseWant = [], chaseAssign = [];
    let chasesKept = 0, chasesWritten = 0, chasesRemoved = 0;
    const keptChases = new Set();
    function chaseLooks(chase) {
      const all = [...pair.values()].map(l => String(l.id));
      const ids = (Array.isArray(chase.fixtureIds) && chase.fixtureIds.length ? chase.fixtureIds.map(String) : all).filter(id => lsOfDesk.has(id));
      const idSet = new Set(ids);
      const pick = (m, id) => { for (const [k, st] of m || []) if (String(k) === id) return [k, st]; return null; };
      if (chase.mode === "snapshot") {
        return { ids, looks: (chase.snapshots || []).map(sn => new Map((sn?.fixtureStates || []).filter(x => Array.isArray(x) && x.length > 1 && idSet.has(String(x[0]))).map(([k, st]) => [k, st]))) };
      }
      const steps = (chase.steps || []).map(Number).filter(i => S.cues?.[i]);
      const lookOf = i => window.cueLook?.(i)?.fixtureMap || new Map();
      return { ids, looks: steps.map((_, k) => {
        const out = new Map();
        ids.forEach((id, j) => { const hit = pick(lookOf(chase.mode === "spread" ? steps[(j + k) % steps.length] : steps[k]), id); if (hit) out.set(hit[0], hit[1]); });
        return out;
      }) };
    }
    // Every channel's desk value for a light, from Light Spark's DMX.
    function lightValues(d, ls, dmx) {
      const def = defOf(ls), own = def?.fromZerOS && Number(def.channels) === d.type.channels;
      const lsBase = (uniOf(ls) - 1) * 512 + Number(ls.addr) - 1;
      const out = new Map();
      for (const ch of d.type.list) {
        const off = deskOff(d, ls, ch);
        if (off == null) continue;
        const coarse = dmx[lsBase + off] ?? 0;
        out.set(ch.index, ch.width === 2 ? coarse * 256 + (own ? (dmx[lsBase + off + 1] ?? 0) : 0) : coarse * 257);
      }
      return out;
    }
    function setPbLeaf(node, field, v) {
      if (setInt(node, field, v)) return;
      const like = one(node, 1);
      const leaf = { field, kind: like?.kind ?? 0, section: like?.section ?? 0x51, raw: 0, value: intBytes(v) };
      const at = node.kids.indexOf(one(node, 0, { kind: 0x10 }));
      node.kids.splice(at >= 0 ? at : node.kids.length, 0, leaf);
    }
    const lsChases = FLX_CHASES ? (S.chases || []).filter(Boolean) : [];
    for (const chase of lsChases) {
      const old = chase.zos?.playback != null && chaseNumbers.has(Number(chase.zos.playback)) ? chaseNodes.get(Number(chase.zos.playback)) : null;
      if (old && chase.zos.sig && chase.zos.sig === chaseSig(chase)) { chasesKept++; keptChases.add(old); chaseAssign.push({ chase, number: Number(chase.zos.playback), kept: true }); continue; }
      const { ids, looks } = chaseLooks(chase);
      if (!ids.length || !looks.length) continue;
      if (looks.length > 999) throw new Error(`chase “${chase.name}” has more than 999 steps, more than the desk can hold — nothing was saved`);
      const number = old ? Number(chase.zos.playback) : nextNumber();
      const node = clone(old || pb);
      setInt(node, 1, number);
      // Its name, after the playback number.
      node.kids = node.kids.filter(k => k.open || k.kids || k.field !== 2);
      const pname = String(chase.name || "").replace(/[^\x20-\x7e]/g, "").slice(0, 31);
      if (pname) { const like = one(node, 1); node.kids.splice(node.kids.indexOf(like) + 1, 0, { field: 2, kind: like?.kind ?? 0, section: like?.section ?? 0x51, raw: 0, value: new TextEncoder().encode(pname) }); }
      const bpm = Math.max(1, Math.min(600, Number(window.LXChaseSpeed?.bpmOf?.(chase) ?? chase.bpm) || 60));
      // The desk's own chase settings, in its own order (Playback Setup → Chase).
      const settings = old
        ? [[0x27, Math.round(bpm * 1000)], [0x0e, Math.round(bpm)], [0x24, chase.loop === false ? 1 : 0]]
        : [[0x19, 1], [0x03, 1], [0x08, 0], [0x2c, 0], [0x27, Math.round(bpm * 1000)], [0x04, 3], [0x09, 0], [0x0e, Math.round(bpm)], [0x24, chase.loop === false ? 1 : 0], [0x25, 1000], [0x32, 0], [0x26, 0], [0x0b, 0]];
      for (const [f, v] of settings) setPbLeaf(node, f, v);
      // Its steps.
      const stepList = one(node, 0, { kind: 0x10 });
      const fadeMs = Math.round(Math.max(0, Math.min(60000 / bpm, Number(chase.fade) || 0)));
      const want = [];
      const steps = looks.map((look, k) => {
        const c = clone(proto);
        setInt(c, 1, (k + 1) * 100);
        c.kids = c.kids.filter(x => x.open || x.kids || (x.field !== 2 && x.field !== 4));
        for (const f of [0xa, 0x1c, 0xb, 0xc, 0xd]) setLeaf(c, f, fadeMs);
        for (const f of [0x6, 0x1d, 0x7, 0x8, 0x9]) setLeaf(c, f, 0);
        if ((int(one(c, 3)) ?? 1) !== 1) setLeaf(c, 3, 1);
        const h = holderOf(c);
        if (!h) throw new Error("couldn't find how the desk stores a cue's levels — nothing was saved");
        h.kids = [{ open: true }];
        const dmx = window.LXAscii?.dmxFor?.(look);
        if (!dmx) throw new Error(`couldn't work out the levels for chase “${chase.name}” — nothing was saved`);
        const stepWant = new Map();
        for (const id of ids) {
          const d = lsOfDesk.get(id), ls = pair.get(d);
          const vals = lightValues(d, ls, dmx);
          for (const [ch, v] of vals) setParam(h, d.index ?? 0, ch, v);
          stepWant.set(d.index ?? 0, vals);
        }
        want.push(stepWant);
        return c;
      });
      // The desk writes cues last-first.
      stepList.kids = [{ open: true }, ...steps.reverse()];
      if (old) { stacks.kids[stacks.kids.indexOf(old)] = node; keptChases.add(old); }
      else stacks.kids.push(node);
      keptChases.add(node);
      chaseWant.push({ name: chase.name, number, bpm, loop: chase.loop !== false, steps: want });
      chaseAssign.push({ chase, number });
      chasesWritten++;
    }
    // Chases that came from this FLX file and were deleted in Light Spark.
    if (FLX_CHASES) for (const [n, node] of chaseNodes) if (chaseNumbers.has(n) && !keptChases.has(node)) { stacks.kids = stacks.kids.filter(k => k !== node); chasesRemoved++; }
    // The desk keeps playbacks highest number first.
    if (chasesWritten || chasesRemoved) stacks.kids = [{ open: true }, ...kidsOf(stacks).sort((a, b) => (int(one(b, 1)) ?? 0) - (int(one(a, 1)) ?? 0))];

    const data = writeData(raw, top);
    const bytes = pack(data);

    // ---- Self-check: read the new file back as the desk would and play
    // every cue; each matched light must output what Light Spark does. ----
    const z2 = read(bytes);
    if (z2.damaged.length) throw new Error("the new file failed its own checks — nothing was saved");
    const pb2 = mainOf(z2.playbacks);
    const cues2 = pb2 ? [...pb2.cues].sort((a, b) => a.number - b.number) : [];
    if (cues2.length !== lsCues.length || cues2.some((c, k) => Math.round(c.number * 100) !== Math.round(lsCues[k].number * 100)))
      throw new Error(`self-check: the desk would see ${cues2.length} cues, Light Spark has ${lsCues.length} — nothing was saved`);
    const byIndex2 = new Map(z2.fixtures.map(f => [f.index ?? 0, f]));
    const track = new Map(z2.fixtures.filter(f => f.type).map(f => [f.index ?? 0, new Map(f.type.list.map(ch => [ch.index, ch.home ?? 0]))]));
    const problems = [];
    for (const d of toUnpatch) { const f2 = byIndex2.get(d.index ?? 0); if (f2?.addr) problems.push(`light ${d.number} would still be patched on the desk`); }
    for (const pw of palWant) {
      const got = z2.paletteMap.get(`${pw.kind}:${pw.id}`);
      for (const [i, m] of pw.want) for (const [param, v] of m) {
        const g = got?.get(i)?.get(param) ?? (got?.get(i) ? homeOf(i, param) : null);
        if ((g == null || Math.abs((g >> 8) - (v >> 8)) > 1) && problems.length < 6) problems.push(`palette “${pw.name}” light ${byIndex2.get(i)?.number}: desk ${g == null ? "nothing" : g >> 8}, Light Spark ${v >> 8}`);
      }
    }
    for (const [d] of pair) { const f2 = byIndex2.get(d.index ?? 0); if (f2 && (f2.label || "") !== wantLabel(d)) problems.push(`light ${d.number} would be called “${f2.label}” on the desk, “${wantLabel(d)}” here`); }
    {
      const deskG = z2.groups.filter(g => !g.auto).map(g => `${g.name.trim().toLowerCase()}:${[...g.members].sort((a, b) => a - b)}`).sort();
      const lsG = [...new Map(lsGroups.map(g => [g.name.toLowerCase(), g])).values()].map(g => `${g.name.trim().toLowerCase()}:${[...g.members].sort((a, b) => a - b)}`).sort();
      if (deskG.join("|") !== lsG.join("|")) problems.push(`the desk's groups wouldn't match Light Spark's (${deskG.length} vs ${lsG.length})`);
    }
    for (const [d, n] of wanted) { const f2 = byIndex2.get(d.index ?? 0); if (!numberClash.includes(n) && f2 && f2.number !== n) problems.push(`light ${n} would be number ${f2.number} on the desk`); }
    const used2 = new Map();
    for (const f2 of z2.fixtures) { if (used2.has(f2.number)) problems.push(`two desk lights would both be number ${f2.number}`); used2.set(f2.number, f2); }
    lsCues.forEach((x, k) => {
      const want = nameFor(x.cue, x.number);
      if ((cues2[k]?.name || "") !== want && problems.length < 6) problems.push(`cue ${x.number} would be called “${cues2[k]?.name || ""}” on the desk, “${want}” here`);
    });
    for (const [d, ls] of pair) {
      const f2 = byIndex2.get(d.index ?? 0);
      if (!f2 || f2.addr !== Number(ls.addr) || f2.uni !== uniOf(ls)) problems.push(`light ${ls.fixtureNumber} would be at ${f2 ? `${f2.uni}/${f2.addr}` : "nowhere"} on the desk, ${uniOf(ls)}/${ls.addr} here`);
    }
    const fxTrack = new Map(z2.fixtures.map(f => [f.index ?? 0, new Map()]));
    for (const c2 of cues2) {
      for (const l of c2.levels) {
        const m = track.get(l.index); if (m) for (const [p, v] of Object.entries(l.params)) m.set(Number(p), v);
        const e = fxTrack.get(l.index); if (e) for (const [p, o] of Object.entries(l.effects || {})) { if (o[0x20]) e.set(Number(p), o); else e.delete(Number(p)); }
      }
      const fw = fxWanted.get(Math.round(c2.number * 100));
      if (fw) for (const [d, ls] of pair) {
        const now = fxTrack.get(d.index ?? 0) || new Map(), w = fw.get(d.index ?? 0) || new Map();
        const a = [...now].filter(([, o]) => o[0x20]).map(([p, o]) => `${p}:${fxKey(o)}`).sort().join(";"), b = [...w].map(([p, o]) => `${p}:${fxKey(o)}`).sort().join(";");
        if (a !== b && problems.length < 6) problems.push(`cue ${c2.number}, light ${ls.fixtureNumber}: the desk's effect wouldn't match Light Spark's`);
      }
      const dmx = lsOutput.get(Math.round(c2.number * 100));
      if (!dmx) continue;
      for (const [d, ls] of pair) {
        const m = track.get(d.index ?? 0); if (!m) continue;
        const def = defOf(ls), own = def?.fromZerOS && Number(def.channels) === d.type.channels;
        const lsBase = (uniOf(ls) - 1) * 512 + Number(ls.addr) - 1;
        for (const ch of d.type.list) {
          let off = null;
          if (own) off = ch.offset - 1;
          else { const a = attribute(ch.label, ch.code, ch.code2); if (a && typeof def?.map?.[a] === "number") off = def.map[a]; }
          if (off == null) continue;
          const desk = (m.get(ch.index) ?? ch.home ?? 0) >> 8, here = dmx[lsBase + off] ?? 0;
          if (Math.abs(desk - here) > 1 && problems.length < 6) problems.push(`cue ${c2.number}, light ${ls.fixtureNumber} ${ch.label}: desk ${desk}, Light Spark ${here}`);
        }
      }
    }
    // The Effects page: each saved effect a recorded effect palette with the same settings.
    for (const fw of fxPalWant) {
      const got = z2.fxPalettes.get(fw.id)?.lights || new Map();
      for (const [i, m] of fw.want) for (const [param, o] of m) if (fxKey(got.get(i)?.get(param)) !== fxKey(o) && problems.length < 6) problems.push(`effect “${fw.name}” light ${byIndex2.get(i)?.number}: the desk's effect wouldn't match Light Spark's`);
    }
    // Chases: each one a chase playback on the desk, its speed, how it
    // repeats, and every step's values.
    const chases2 = new Map(z2.playbacks.filter(p => p.chase).map(p => [p.number, p]));
    if (pb2 && pb2.number !== (int(one(pb, 1)) ?? 0)) problems.push("the desk would pick a different playback as the main cue list");
    for (const cw of chaseWant) {
      const p2 = chases2.get(cw.number);
      if (!p2) { problems.push(`chase “${cw.name}” wouldn't be a chase on the desk`); continue; }
      if (Math.abs(p2.bpm - Math.round(cw.bpm * 1000) / 1000) > 0.01 || !p2.shots !== cw.loop) problems.push(`chase “${cw.name}” wouldn't run at the right speed on the desk`);
      const steps2 = [...p2.cues].sort((a, b) => a.number - b.number);
      if (steps2.length !== cw.steps.length) { problems.push(`chase “${cw.name}” would have ${steps2.length} steps on the desk, ${cw.steps.length} here`); continue; }
      steps2.forEach((st, k) => {
        const got = new Map(st.levels.map(l => [l.index, l.params]));
        for (const [i, vals] of cw.steps[k]) for (const [ch, v] of vals) {
          const g = got.get(i)?.[ch];
          if ((g == null || Math.abs((g >> 8) - (v >> 8)) > 1) && problems.length < 6) problems.push(`chase “${cw.name}” step ${k + 1}, light ${byIndex2.get(i)?.number}: desk ${g == null ? "nothing" : g >> 8}, Light Spark ${v >> 8}`);
        }
      });
    }
    if (FLX_CHASES) for (const [n] of chaseNodes) if (chaseNumbers.has(n) && !chaseAssign.some(a => a.number === n) && chases2.has(n)) problems.push(`a deleted chase would still be on the desk`);
    if (problems.length) throw new Error(`self-check failed, so nothing was saved: ${problems.join("; ")}`);

    return { bytes, name, palStrips, fxAssign, fxPalAdded, fxPalChanged, fxPalRemoved, fxSkipped, palettesNowFx: fxPalWant.map(f => `64:${f.id}`), fxSubstituted: [...fxSubstituted].map(([a, b]) => `${a} → ${b}`), chaseAssign, chasesNow: chaseAssign.map(a => a.number), chasesKept, chasesWritten, chasesRemoved, fxChanged, unsupportedFx: [...unsupportedFx], palettesNow: palWant.map(p => `${p.kind}:${p.id}`), palAdded, palChanged, palRemoved, groupsChanged: false, groupsAdded, groupsEdited: groupsChanged, groupsRemoved, renamed, newLights, cues: newCues.length, lights: fixturesForCue.length, moved, missing, renumbered, unpatched, clashes: [], changed, named, lightsChanged: lightsChanged.size, kept, added, removed, notMoved, numberClash, checked: true };
  }

  function download(bytes, file) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const bridge = () => (window.LXShowFiles?.zosSave ? window.LXShowFiles : null);
  const fileName = p => String(p || "").split(/[\\/]/).pop();
  const baseName = p => fileName(p).replace(/\.zos$/i, "");
  let openPath = "";          // the FLX file the open show came from: Save writes back to it

  function report(r, where) {
    const what = r.changed ? `${r.changed} value${r.changed === 1 ? "" : "s"} changed on ${r.lightsChanged} light${r.lightsChanged === 1 ? "" : "s"}` : "no light levels changed";
    say(`Saved FLX show “${where}”: ${r.cues} cues (${what}${r.added ? `, ${r.added} new cue${r.added === 1 ? "" : "s"}` : ""}${r.removed ? `, ${r.removed} cue${r.removed === 1 ? "" : "s"} deleted` : ""})${r.moved ? `, ${r.moved} address change${r.moved === 1 ? "" : "s"}` : ""}${r.unpatched ? `, ${r.unpatched} light${r.unpatched === 1 ? "" : "s"} unpatched` : ""}${r.named ? `, ${r.named} cue name${r.named === 1 ? "" : "s"}` : ""}${r.renumbered?.length ? `, ${r.renumbered.length} fixture number${r.renumbered.length === 1 ? "" : "s"}` : ""}. Everything else is exactly as the desk had it${r.checked ? ". Checked: every cue plays on the desk exactly as it does here" : ""}`, "ok");
    if (r.renumbered.length) say(`Fixture numbers changed on the desk (old → new): ${r.renumbered.slice(0, 12).join(", ")}${r.renumbered.length > 12 ? "…" : ""} — the desk's groups were updated to match`, "info");
    if (r.numberClash?.length) say(`Fixture number${r.numberClash.length === 1 ? "" : "s"} ${r.numberClash.slice(0, 8).join(", ")} ${r.numberClash.length === 1 ? "is" : "are"} used by two lights in Light Spark, so ${r.numberClash.length === 1 ? "that one wasn't" : "those weren't"} changed on the desk — every other number was`, "warn");
    if (r.notMoved?.length) say(`Light${r.notMoved.length === 1 ? "" : "s"} ${r.notMoved.slice(0, 12).join(", ")} kept ${r.notMoved.length === 1 ? "its" : "their"} desk address — the Light Spark fixture has a different number of channels`, "warn");
    const extra = [r.newLights?.length ? `${r.newLights.length} new light${r.newLights.length === 1 ? "" : "s"} (${r.newLights.slice(0, 8).join(", ")})` : "", r.renamed ? `${r.renamed} light name${r.renamed === 1 ? "" : "s"}` : "", r.groupsAdded ? `${r.groupsAdded} new group${r.groupsAdded === 1 ? "" : "s"}` : "", r.groupsEdited ? `${r.groupsEdited} group${r.groupsEdited === 1 ? "" : "s"} changed` : "", r.groupsRemoved ? `${r.groupsRemoved} group${r.groupsRemoved === 1 ? "" : "s"} deleted` : "", r.palAdded ? `${r.palAdded} new palette${r.palAdded === 1 ? "" : "s"}` : "", r.palChanged ? `${r.palChanged} palette change${r.palChanged === 1 ? "" : "s"}` : "", r.palRemoved ? `${r.palRemoved} palette${r.palRemoved === 1 ? "" : "s"} deleted` : "", r.fxChanged ? `${r.fxChanged} effect change${r.fxChanged === 1 ? "" : "s"} in cues` : "", r.fxPalAdded ? `${r.fxPalAdded} new effect${r.fxPalAdded === 1 ? "" : "s"} from the Effects page` : "", r.fxPalChanged ? `${r.fxPalChanged} effect${r.fxPalChanged === 1 ? "" : "s"} changed` : "", r.fxPalRemoved ? `${r.fxPalRemoved} effect${r.fxPalRemoved === 1 ? "" : "s"} deleted` : "", r.chasesWritten ? `${r.chasesWritten} chase${r.chasesWritten === 1 ? "" : "s"} (playback${r.chasesWritten === 1 ? "" : "s"} ${(r.chaseAssign || []).filter(x => !x.kept).map(x => x.number).join(", ")})` : "", r.chasesRemoved ? `${r.chasesRemoved} chase${r.chasesRemoved === 1 ? "" : "s"} deleted` : ""].filter(Boolean);
    if (r.unsupportedFx?.length) say(`The desk show has no effect like ${r.unsupportedFx.slice(0, 4).map(n => `“${n}”`).join(", ")}, so ${r.unsupportedFx.length === 1 ? "it wasn't" : "those weren't"} saved into the FLX file`, "warn");
    if (extra.length) say(`Also saved: ${extra.join(", ")}`, "ok");
    if (r.palAdded + r.palChanged > (r.palStrips || 0) && r.palStrips != null) say(`${r.palStrips} of the new or changed colour palettes show the desk's colour strip. The others work the same but show no strip: the desk only draws one when a palette matches its own colour picker, and Light Spark can only match it for RGB and RGBW lights or the desk's own colours`, "info");
    if (r.fxSkipped?.length) say(`${r.fxSkipped.slice(0, 6).map(n => `“${n}”`).join(", ")} ${r.fxSkipped.length === 1 ? "has" : "have"} no lights of ${r.fxSkipped.length === 1 ? "its" : "their"} own (set to run on whatever is selected), so ${r.fxSkipped.length === 1 ? "it wasn't" : "they weren't"} saved to the desk — pick lights for ${r.fxSkipped.length === 1 ? "it" : "them"} on the Effects page`, "warn");
    if (r.fxSubstituted?.length) say(`The desk has no effect exactly like ${r.fxSubstituted.length === 1 ? "this one" : "these"}, so the closest desk effect was used: ${r.fxSubstituted.slice(0, 6).join(", ")}`, "info");
    if (r.missing.length) say(`Light${r.missing.length === 1 ? "" : "s"} ${r.missing.slice(0, 12).join(", ")}${r.missing.length > 12 ? "…" : ""} ${r.missing.length === 1 ? "is a" : "are"} type${r.missing.length === 1 ? "" : "s"} the desk show doesn't have yet, so ${r.missing.length === 1 ? "it was" : "they were"} left out — patch one light of that type on the desk, save, open that here, then save again`, "warn");
  }

  // Write to a file (Light Spark app), or download it (no file access).
  async function writeTo(filePath, r) {
    const b = bridge();
    if (b && filePath) {
      let out;
      try { out = await b.zosSave(filePath, r.bytes); }
      catch (e) {
        const why = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        const perm = /EPERM|EACCES|not permitted|read-only|EROFS/i.test(why);
        say(`Couldn't write “${filePath}”: ${why}${perm ? " — on a Mac, allow Light Spark in System Settings → Privacy & Security → Files and Folders → Removable Volumes, or pick another place" : ""}`, "error");
        const target = await b.zosSaveDialog(baseName(filePath), "");
        if (!target) return null;
        out = await b.zosSave(target, r.bytes);
      }
      openPath = out.filePath;
      keepBase(r.bytes, baseName(out.filePath), out.filePath, [...(r.palettesNow || []), ...(r.palettesNowFx || [])], r.chasesNow);
      // The effects now on the desk, so saving again updates them in place.
      for (const a of r.fxAssign || []) { a.e.zos = { ...(a.e.zos || {}), kind: 0x40, id: a.id }; delete a.e.zos.cue; a.e.zos.sig = fxSig(a.e); }
      // The chases now on the desk, so saving again updates them in place.
      for (const a of r.chaseAssign || []) { a.chase.zos = { playback: a.number }; a.chase.zos.sig = chaseSig(a.chase); }
      window.LXShowCommands?.markSaved?.();
      report(r, out.filePath);
      if (out.verified) say(`Checked: the file on disk is exactly what was saved (${Math.round(out.bytes / 1024)} KB)`, "ok");
      if (out.backup) say(`The previous version is kept in Backups, in your Shows folder`, "info");
      return r;
    }
    const file = `${(r.name || "FLX show").replace(/[^\w .-]/g, "") || "FLX show"}.zos`;
    download(r.bytes, file);
    report(r, `${file}” in your Shows folder, “${file}`);
    return r;
  }

  function buildFrom(b, name) {
    return build(b.bytes, { name });
  }

  // Save: back into the FLX file that's open (or ask where, the first time).
  async function save() {
    const b = loadBase();
    if (!b) return saveAs();
    try {
      if (openPath && bridge()) return await writeTo(openPath, buildFrom(b, baseName(openPath)));
      return await saveAs();
    } catch (e) {
      console.error("[ZOS] save", e);
      say(`Couldn't save the FLX show: ${e.message || e}`, "error");
      return null;
    }
  }

  async function saveAs() {
    let b = loadBase();
    if (!b) {
      say("Pick an FLX show from the desk to save into — it keeps the desk's setup, fixture types and palettes", "info");
      b = await pickBase();
      if (!b) return null;
    }
    try {
      const suggested = (window.LXShowCommands?.name?.() || "").replace(/\.(json|zos)$/ig, "") || baseName(openPath) || b.name || "FLX show";
      const br = bridge();
      if (br) {
        const dir = openPath ? openPath.replace(/[\\/][^\\/]*$/, "") : "";
        const target = await br.zosSaveDialog(suggested, dir);
        if (!target) return null;
        return await writeTo(target, buildFrom(b, baseName(target)));
      }
      return await writeTo("", buildFrom(b, suggested));
    } catch (e) {
      console.error("[ZOS] save", e);
      say(`Couldn't save the FLX show: ${e.message || e}`, "error");
      return null;
    }
  }

  // Choose an FLX file: the app's own dialog (knows where the file is), or the browser's.
  function pickFile() {
    const br = bridge();
    if (br) return br.zosOpenDialog().then(r => r ? { bytes: new Uint8Array(r.data), path: r.filePath, name: fileName(r.filePath) } : null);
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zos";
      input.style.display = "none";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        resolve(file ? { bytes: new Uint8Array(await file.arrayBuffer()), path: "", name: file.name } : null);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function pickBase() {
    const f = await pickFile();
    if (!f) return null;
    read(f.bytes);
    keepBase(f.bytes, f.name.replace(/\.zos$/i, ""), f.path);
    return base;
  }

  async function choose() {
    try {
      const f = await pickFile();
      if (f) await openBytes(f.bytes, f.name, f.path);
    } catch (e) { console.error("[ZOS]", e); say(`Couldn't open that FLX show: ${e.message || e}`, "error"); }
  }

  function command(c) {
    if (/^(open|load|import) (flx|zeros|zos)( show)?$/.test(c)) { choose(); return true; }
    if (/^(save|export) as (flx|zeros|zos)( show)?$/.test(c)) { saveAs(); return true; }
    if (/^(save|export) (flx|zeros|zos)( show)?( as)?$/.test(c)) { if (/ as$/.test(c)) saveAs(); else save(); return true; }
    return false;
  }

  window.LXZos = { lzw, lzwEncode, unpack, parse, read, toShow, serialize, writeData, pack, build, open: choose, openFile, openBytes, save, saveAs, command, base: loadBase, isOpen: () => Boolean(openPath), path: () => openPath, detach: () => { openPath = ""; } };
})();
