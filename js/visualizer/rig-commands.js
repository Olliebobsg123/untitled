// Typed commands to make the visualiser match the real stage, without
// dragging anything: the stage size, the bars, which lights hang where and
// where each one is focused. Typed in the console as "viz …" (forwarded here
// as one line of text by js/more-commands.js):
//
//   viz stage 10 by 6            the stage, wide by deep (metres)
//   viz stage height 0.6         how high the stage is off the floor
//   viz bars                     the bars and where they are
//   viz bar LX 1 height 5.5      how high a bar is
//   viz bar LX 1 upstage 2       a bar over the stage, 2 m back from the front edge
//   viz bar FOH out 4            a bar over the audience, 4 m out from the front edge
//   viz bar LX 2 width 9         how long it is
//   viz add bar LX 4 height 5 upstage 6     a new bar
//   viz delete bar LX 3
//   viz hang 1 thru 10 on FOH    spread along the bar, house left → house right
//   viz hang 4 + 7 on floor      on the floor in front of the stage
//   viz hang 31 + 32 on stage    on the stage floor, at the sides
//   viz focus 2 at DSL           DSL DSC DSR · CSL CS CSR · USL USC USR · cyc · audience
//   viz focus 21 thru 28 across cyc       spread along the back wall (or across DS/CS/US)
//   viz focus 1 thru 10 straight          back to pointing straight at the stage
//
// Stage left is the actors' left as they face the audience (house right).
// Areas are thirds of the stage: downstage is the third nearest the audience.
import * as THREE from "three";
import { STAGE, STAGE_TOP, CYC_Z } from "./theatre.js";

const round = v => Math.round(v * 1000) / 1000;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// "1 thru 10", "1 + 4 + 7", "1,2,3", "1-4", "21 thru 24 + 30"
export function parseNumbers(text) {
  const out = [];
  const t = String(text || "").toLowerCase().replace(/\s*(?:thru|through|to|>)\s*/g, "-").replace(/\s*(?:\+|,|and)\s*/g, " ").trim();
  for (const part of t.split(/\s+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = +m[1], b = +(m[2] ?? m[1]);
    const step = a <= b ? 1 : -1;
    for (let n = a; step > 0 ? n <= b : n >= b; n += step) if (!out.includes(n)) out.push(n);
  }
  return out.length ? out : null;
}

export function createRigCommands(ctx) {
  // ctx: fixtures (id → model), patch(), venue(), commit(venue), saveLayout(), defaultAim(position), wake()
  const venue = () => JSON.parse(JSON.stringify(ctx.venue()));
  const bars = v => v.items.filter(i => (i.kind === "bar" || i.kind === "truss") && !i.hidden);
  const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const findBar = (v, name) => {
    const k = key(name);
    return bars(v).find(b => key(b.name) === k) || bars(v).find(b => key(b.name).startsWith(k)) || null;
  };
  const barList = v => bars(v).map(b => `${b.name} (${b.y} m high, ${b.z > 0 ? `${round(b.z)} m out` : `${round(-b.z)} m upstage`}, ${b.w} m long)`).join(" · ");

  function modelsFor(numbers) {
    const byNumber = new Map(ctx.patch().map(f => [Number(f.fixtureNumber), String(f.id)]));
    const found = [], missing = [];
    for (const n of numbers) { const m = ctx.fixtures.get(byNumber.get(n)); if (m) found.push(m); else missing.push(n); }
    return { found, missing };
  }
  const missingNote = missing => (missing.length ? ` (no light ${missing.join(", ")})` : "");

  // Lights hanging on a bar now (so they move with it).
  const hangingOn = bar => [...ctx.fixtures.values()].filter(m => Math.abs(m.root.position.z - bar.z) < 0.35 && Math.abs(m.root.position.y - (bar.y - 0.08)) < 0.4 && Math.abs(m.root.position.x - bar.x) <= bar.w / 2 + 0.3);

  function moveLights(list, dx, dy, dz, keepAim = true) {
    for (const m of list) {
      const p = m.root.position;
      const to = { x: round(p.x + dx), y: round(p.y + dy), z: round(p.z + dz) };
      if (keepAim) m.move(to); else m.place(to);
    }
  }

  // ------------------------------------------------------------- the stage

  function stage(rest) {
    const v = venue();
    let m = /^height\s+(\d*\.?\d+)\s*m?$/.exec(rest);
    if (m) {
      const h = Math.max(0, Math.min(4, Number(m[1]))), dy = h - v.stage.height;
      v.stage.height = h;
      // Things standing on the stage, and lights on its floor, go up or down with it.
      for (const item of v.items) if (item.z < 0 && Math.abs(item.y - (h - dy)) < 0.05) item.y = h;
      const onStage = [...ctx.fixtures.values()].filter(f => f.root.position.z < 0 && f.root.position.y < h - dy + 1);
      ctx.commit(v);
      moveLights(onStage, 0, dy, 0);
      for (const f of ctx.fixtures.values()) if (!f.moving && f.target.z < 0 && Math.abs(f.target.y - (h - dy)) < 0.05) f.aimAt(new THREE.Vector3(f.target.x, h, f.target.z));
      ctx.saveLayout();
      return `Stage ${h} m high`;
    }
    m = /^(\d*\.?\d+)\s*m?\s*(?:by|x|×)\s*(\d*\.?\d+)\s*m?$/.exec(rest);
    if (!m) return `The stage is ${v.stage.width} m wide, ${v.stage.depth} m deep, ${v.stage.height} m high. Change it: viz stage 10 by 6 · viz stage height 0.6`;
    const w = Math.max(2, Math.min(60, Number(m[1]))), d = Math.max(2, Math.min(60, Number(m[2])));
    const sx = w / v.stage.width, sz = d / v.stage.depth;
    // Everything on and over the stage keeps its place relative to the stage.
    for (const item of v.items) {
      if (item.kind === "seating") continue;
      item.x = round(item.x * sx);
      if (item.z < 0) item.z = round(item.z * sz);
      if ((item.kind === "bar" || item.kind === "truss" || (item.kind === "drape" && item.w > 3)) && item.z < 0.5) item.w = round(item.w * sx);
    }
    v.stage.width = w; v.stage.depth = d;
    v.proscenium.width = w;
    v.room.width = Math.max(v.room.width, w + 6);
    ctx.commit(v);
    for (const f of ctx.fixtures.values()) {
      const p = f.root.position;
      f.place({ x: round(p.x * sx), y: p.y, z: round(p.z < 0 ? p.z * sz : p.z) });
      if (!f.moving) f.aimAt(new THREE.Vector3(f.target.x * sx, f.target.y, f.target.z < 0 ? f.target.z * sz : f.target.z));
    }
    ctx.saveLayout();
    return `Stage ${w} m wide, ${d} m deep — the bars, drapes and lights moved with it`;
  }

  // -------------------------------------------------------------- the bars

  // "height 5.5", "upstage 2", "out 4", "width 9" (any of them, in any order)
  function barFields(text) {
    const f = {};
    const re = /(height|high|upstage|in|out|downstage|width|long|length)\s+(-?\d*\.?\d+)\s*m?/g;
    let m, used = "";
    while ((m = re.exec(text))) {
      used += m[0];
      const n = Number(m[2]);
      if (m[1] === "height" || m[1] === "high") f.y = Math.max(0.5, Math.min(30, n));
      else if (m[1] === "upstage" || m[1] === "in") f.z = -Math.abs(n);
      else if (m[1] === "out" || m[1] === "downstage") f.z = Math.abs(n);
      else f.w = Math.max(0.5, Math.min(60, n));
    }
    return used.replace(/\s/g, "") === text.replace(/\s/g, "") ? f : null;
  }

  function bar(rest) {
    const v = venue();
    const m = /^(.+?)\s+((?:height|high|upstage|in|out|downstage|width|long|length)\b.*)$/.exec(rest);
    if (!m) return `Try: viz bar LX 1 height 5.5 · viz bar LX 1 upstage 2 · viz bar FOH out 4. Bars: ${barList(v) || "none"}`;
    const b = findBar(v, m[1]);
    if (!b) return `There's no bar called “${m[1]}”. Bars: ${barList(v) || "none"} (viz add bar … to make one)`;
    const f = barFields(m[2]);
    if (!f) return `Try: viz bar ${b.name} height 5.5 upstage 2 (metres)`;
    const lights = hangingOn(b);
    const dy = f.y != null ? f.y - b.y : 0, dz = f.z != null ? f.z - b.z : 0;
    if (f.y != null) b.y = f.y;
    if (f.z != null) b.z = f.z;
    if (f.w != null) b.w = f.w;
    ctx.commit(v);
    moveLights(lights, 0, dy, 0, false);
    // Moving up or downstage, the lights keep pointing at the same spot
    // moved by the same amount; up or down, at the same spot.
    for (const l of lights) { if (dz) l.move({ x: l.root.position.x, y: l.root.position.y, z: round(l.root.position.z + dz) }); else l.place(l.root.position); }
    ctx.saveLayout();
    return `${b.name}: ${b.y} m high, ${b.z > 0 ? `${round(b.z)} m out over the audience` : `${round(-b.z)} m upstage of the front edge`}, ${b.w} m long${lights.length ? ` — its ${lights.length} light${lights.length === 1 ? "" : "s"} moved with it` : ""}`;
  }

  function addBar(rest) {
    const v = venue();
    const m = /^(.+?)(?:\s+((?:height|high|upstage|in|out|downstage|width|long|length)\b.*))?$/.exec(rest);
    if (!m) return "Try: viz add bar LX 4 height 5 upstage 6";
    if (findBar(v, m[1]) && key(findBar(v, m[1]).name) === key(m[1])) return `There's already a bar called ${m[1]}`;
    const f = m[2] ? barFields(m[2]) : {};
    if (!f) return "Try: viz add bar LX 4 height 5 upstage 6";
    const item = { id: `v${Date.now().toString(36)}r`, kind: "bar", name: m[1].replace(/\b\w/g, c => c.toUpperCase()).replace(/^lx/i, "LX").replace(/^foh$/i, "FOH"), x: 0, y: f.y ?? 7, z: f.z ?? -2, w: f.w ?? Math.min(v.stage.width, 12), rx: 0, ry: 0, rz: 0, color: "#55585e", material: "metal", hidden: false, locked: false, picture: "", live: null };
    v.items.push(item);
    ctx.commit(v);
    ctx.saveLayout();
    return `Added ${item.name}: ${item.y} m high, ${item.z > 0 ? `${item.z} m out` : `${-item.z} m upstage`}, ${item.w} m long`;
  }

  function deleteBar(rest) {
    const v = venue();
    const b = findBar(v, rest);
    if (!b) return `There's no bar called “${rest}”. Bars: ${barList(v) || "none"}`;
    const lights = hangingOn(b).length;
    v.items = v.items.filter(i => i.id !== b.id);
    ctx.commit(v);
    ctx.saveLayout();
    return `Deleted ${b.name}${lights ? ` — ${lights} light${lights === 1 ? " is" : "s are"} left where ${lights === 1 ? "it was" : "they were"}: hang them on another bar` : ""}`;
  }

  // ----------------------------------------------------------- the lights

  function hang(rest) {
    const m = /^(.+?)\s+on\s+(?:the\s+)?(.+)$/.exec(rest);
    const numbers = m && parseNumbers(m[1]);
    if (!numbers) return "Try: viz hang 1 thru 10 on FOH · viz hang 4 + 7 on floor · viz hang 31 + 32 on stage";
    const { found, missing } = modelsFor(numbers);
    if (!found.length) return `No lights ${m[1]} in the visualiser`;
    const where = m[2].trim();
    const spread = (list, from, to, y, z) => list.forEach((model, i) => {
      const t = list.length === 1 ? 0.5 : i / (list.length - 1);
      const position = { x: round(from + (to - from) * t), y, z };
      model.place(position);
      if (!model.moving) model.aimAt(ctx.defaultAim(position));
    });
    const half = STAGE.width / 2;
    if (/^(?:floor|house floor|front)$/i.test(where)) {
      // On the floor just in front of the stage, pointing up at it.
      spread(found, -half * 0.75, half * 0.75, 0.45, round(STAGE.frontZ + 1));
      for (const f of found) if (!f.moving) f.aimAt(new THREE.Vector3(f.root.position.x * 0.5, STAGE_TOP + 1.6, -STAGE.depth / 3));
    } else if (/^(?:stage|stage floor|deck)$/i.test(where)) {
      // On the stage floor, at the sides, pointing across.
      spread(found, -half + 0.6, half - 0.6, round(STAGE_TOP + 0.45), round(-STAGE.depth / 2));
      for (const f of found) if (!f.moving) f.aimAt(new THREE.Vector3(-f.root.position.x * 0.3, STAGE_TOP + 1.5, -STAGE.depth / 2));
    } else {
      const v = venue();
      const b = findBar(v, where);
      if (!b) return `There's no bar called “${where}”. Bars: ${barList(v) || "none"} · or floor, stage`;
      // Lights already on the bar stay (in their order, house left first) and
      // these go after them; the whole bar is spread out again.
      const others = hangingOn(b).filter(m => !found.includes(m)).sort((p, q) => p.root.position.x - q.root.position.x);
      const all = [...others, ...found];
      const reach = Math.max(0.2, b.w / 2 - 0.3);
      const gap = Math.min(1.3, (2 * reach) / Math.max(1, all.length - 1));
      const span = gap * (all.length - 1) / 2;
      others.forEach((model, i) => model.move({ x: round(b.x - span + gap * i), y: round(b.y - 0.08), z: b.z }));
      found.forEach((model, i) => {
        const position = { x: round(b.x - span + gap * (others.length + i)), y: round(b.y - 0.08), z: b.z };
        model.place(position);
        if (!model.moving) model.aimAt(ctx.defaultAim(position));
      });
      ctx.saveLayout();
      return `Hung ${found.length} light${found.length === 1 ? "" : "s"} on ${b.name}${others.length ? ` after the ${others.length} already there (${all.length} on it now)` : ""}, house left to house right${missingNote(missing)} — focus them with viz focus … at DSL`;
    }
    ctx.saveLayout();
    return `Put ${found.length} light${found.length === 1 ? "" : "s"} on the ${/^(?:stage|stage floor|deck)$/i.test(where) ? "stage floor" : "floor in front of the stage"}${missingNote(missing)}`;
  }

  // Stage areas: thirds across and up/down the stage.
  function areaPoint(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    const third = STAGE.width / 3, depth = STAGE.depth;
    const row = { d: -depth / 6, c: -depth / 2, u: -depth * 5 / 6 };
    const side = { l: third, c: 0, r: -third, "": 0 };
    const named = { centre: "cs", center: "cs", c: "cs", centrestage: "cs", ds: "dsc", us: "usc", downstage: "dsc", upstage: "usc", dscentre: "dsc", uscentre: "usc" };
    const a = named[w] || w;
    const m = /^([dcu])s([lcr]?)$/.exec(a);
    if (m) return new THREE.Vector3(side[m[2]], STAGE_TOP, STAGE.frontZ + row[m[1]]);
    if (/^(cyc|backwall|back|wall)$/.test(w)) return new THREE.Vector3(0, STAGE_TOP + 3, CYC_Z + 0.05);
    if (/^(audience|house|crowd)$/.test(w)) return new THREE.Vector3(0, 1.2, 6);
    return null;
  }

  function focus(rest) {
    let m = /^(.+?)\s+(at|across|on|straight|down)\b\s*(.*)$/.exec(rest);
    const numbers = m && parseNumbers(m[1]);
    if (!numbers) return "Try: viz focus 2 at DSL · viz focus 21 thru 28 across cyc · viz focus 1 thru 10 straight";
    const { found, missing } = modelsFor(numbers);
    const fixed = found.filter(f => !f.moving);
    if (!fixed.length) return found.length ? "Moving lights are focused by their pan and tilt from the console" : `No lights ${m[1]} in the visualiser`;
    const how = m[2], where = m[3].trim();
    if (how === "straight" || how === "down") {
      for (const f of fixed) f.aimAt(ctx.defaultAim(f.root.position));
      ctx.saveLayout();
      return `${fixed.length} light${fixed.length === 1 ? "" : "s"} pointing straight at the stage${missingNote(missing)}`;
    }
    const point = areaPoint(where);
    if (!point) return `Where is “${where}”? Try DSL, DSC, DSR, CSL, CS, CSR, USL, USC, USR, cyc or audience`;
    if (how === "across") {
      // Spread along that row (or the cyc) in the order given, house left → house right.
      const span = STAGE.width / 2 - 1;
      fixed.forEach((f, i) => {
        const t = fixed.length === 1 ? 0.5 : i / (fixed.length - 1);
        f.aimAt(new THREE.Vector3(round(-span + 2 * span * t), point.y, point.z));
      });
    } else {
      // Several lights on one area: a little apart so the pools blend, not stack.
      fixed.forEach((f, i) => {
        const off = fixed.length === 1 ? 0 : (i / (fixed.length - 1) - 0.5) * Math.min(1.5, 0.5 * fixed.length);
        f.aimAt(new THREE.Vector3(round(point.x + off), point.y, point.z));
      });
    }
    ctx.saveLayout();
    return `${fixed.length} light${fixed.length === 1 ? "" : "s"} focused ${how} ${where.toUpperCase()}${missingNote(missing)}`;
  }

  function run(text) {
    const t = String(text || "").trim().replace(/\s+/g, " ");
    const lower = t.toLowerCase();
    let m;
    if ((m = /^stage\b\s*(.*)$/i.exec(t))) return stage(m[1].toLowerCase());
    if (/^bars$/.test(lower)) { const v = venue(); return `Bars: ${barList(v) || "none"}`; }
    if ((m = /^add (?:bar|truss) (.+)$/i.exec(t))) return addBar(m[1].replace(/\b(height|high|upstage|in|out|downstage|width|long|length)\b/gi, s => s.toLowerCase()));
    if ((m = /^(?:delete|remove) bar (.+)$/i.exec(t))) return deleteBar(m[1]);
    if ((m = /^bar (.+)$/i.exec(t))) return bar(m[1].replace(/\b(height|high|upstage|in|out|downstage|width|long|length)\b/gi, s => s.toLowerCase()));
    if ((m = /^hang (.+)$/i.exec(t))) return hang(m[1]);
    if ((m = /^focus (.+)$/i.exec(t))) return focus(m[1].replace(/\b(at|across|on|straight|down)\b/gi, s => s.toLowerCase()));
    return null;
  }

  return { run };
}
