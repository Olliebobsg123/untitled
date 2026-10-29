"use strict";

/*
 * Bar groups from the visualiser: one group per bar, truss or boom, with the
 * lights the visualiser has hanging on it (left to right), plus "Floor" for
 * lights on the deck. Groups come out front to back (FOH, then downstage to
 * upstage), ready for a cue's Sweep.
 *
 * Bars are the stage design's (Build mode), or the standard theatre's (FOH,
 * LX 1-3). Lights not under one are grouped by how far up or downstage they
 * hang. Groups → "Bar groups", or "bar groups" on the command line.
 */
(function () {
  if (window.LXBarGroups) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(m, t);

  // js/visualizer/venue.js defaultVenue("proscenium"): its bars.
  const STANDARD = [
    { kind: "bar", name: "FOH", x: 0, y: 7.6, z: 6, w: 12 },
    { kind: "bar", name: "LX 1", x: 0, y: 7.2, z: -1.2, w: 11 },
    { kind: "bar", name: "LX 2", x: 0, y: 7.2, z: -3.8, w: 11 },
    { kind: "bar", name: "LX 3", x: 0, y: 7.2, z: -6.4, w: 11 }
  ];
  const NEAR = 0.8; // metres from a bar to count as on it

  function rigging() {
    const venue = S().visualizer?.venue;
    const stageTop = Number.isFinite(Number(venue?.stage?.height)) ? Number(venue.stage.height) : 1;
    const items = venue && Array.isArray(venue.items)
      ? venue.items.filter(i => i && !i.hidden && ["bar", "truss", "boom"].includes(i.kind))
      : STANDARD;
    return { items, stageTop };
  }

  // How far a light at p is from a piece of rigging (plan view), or Infinity.
  function distance(p, item) {
    const x = Number(item.x) || 0, y = Number(item.y) || 0, z = Number(item.z) || 0;
    if (item.kind === "boom") {
      const top = y + (Number(item.h) || 3) + 0.5;
      if (p.y < y - 0.3 || p.y > top) return Infinity;
      return Math.hypot(p.x - x, p.z - z);
    }
    // Lights hang under a bar (a little above, for ones sat on a truss).
    if (p.y > y + 0.6 || p.y < y - 2) return Infinity;
    const a = (Number(item.ry) || 0) * Math.PI / 180, half = Math.max(0.1, (Number(item.w) || 10) / 2);
    const dx = Math.cos(a), dz = -Math.sin(a);
    const t = Math.max(-half, Math.min(half, (p.x - x) * dx + (p.z - z) * dz));
    return Math.hypot(p.x - (x + dx * t), p.z - (z + dz * t));
  }

  // The groups it would make: [{ name, members: [fixture ids], z }], and
  // how many lights have no position yet.
  function plan() {
    const { items, stageTop } = rigging();
    const positions = S().visualizer?.positions || {};
    const on = new Map(), loose = [], floor = [];
    let unplaced = 0;
    for (const f of S().fixtures || []) {
      if (!f || f.id == null) continue;
      const p = positions[String(f.id)];
      if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) { unplaced++; continue; }
      let best = null, bestD = NEAR;
      for (const item of items) {
        const d = distance(p, item);
        if (d < bestD) { best = item; bestD = d; }
      }
      if (best) { if (!on.has(best)) on.set(best, []); on.get(best).push({ f, p }); }
      else if (p.y < stageTop + 1.2) floor.push({ f, p });
      else loose.push({ f, p });
    }
    const groups = [];
    const byX = list => list.sort((a, b) => a.p.x - b.p.x || a.p.z - b.p.z).map(e => e.f.id);
    for (const [item, list] of on) groups.push({ name: String(item.name || "Bar"), members: byX(list), z: Number(item.z) || 0, boom: item.kind === "boom", x: Number(item.x) || 0 });
    // Lights not under any bar: one group per depth.
    loose.sort((a, b) => b.p.z - a.p.z);
    const clusters = [];
    for (const e of loose) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(last.z - e.p.z) <= NEAR) { last.list.push(e); last.z = last.list.reduce((s, x) => s + x.p.z, 0) / last.list.length; }
      else clusters.push({ z: e.p.z, list: [e] });
    }
    const taken = new Set(groups.map(g => g.name.toLowerCase()));
    const unique = base => { let name = base, n = 2; while (taken.has(name.toLowerCase())) name = `${base} (${n++})`; taken.add(name.toLowerCase()); return name; };
    const foh = clusters.filter(c => c.z > 0.3), over = clusters.filter(c => c.z <= 0.3);
    foh.slice().reverse().forEach((c, i) => groups.push({ name: unique(foh.length === 1 ? "FOH" : `FOH ${i + 1}`), members: byX(c.list), z: c.z }));
    over.forEach((c, i) => groups.push({ name: unique(`Bar ${i + 1}`), members: byX(c.list), z: c.z }));
    if (floor.length) groups.push({ name: unique("Floor"), members: byX(floor), z: -Infinity, floor: true });
    // Front to back; booms and floor after the bars.
    groups.sort((a, b) => (a.floor ? 2 : a.boom ? 1 : 0) - (b.floor ? 2 : b.boom ? 1 : 0) || (a.boom && b.boom ? a.x - b.x : b.z - a.z));
    return { groups: groups.map(({ name, members }) => ({ name, members })), unplaced };
  }

  // Make (or refresh) them. Groups with other names are left alone.
  function make() {
    const { groups, unplaced } = plan();
    const s = S();
    if (!Array.isArray(s.groups)) s.groups = [];
    let added = 0, updated = 0;
    for (const g of groups) {
      const old = s.groups.find(x => x?.name?.toLowerCase() === g.name.toLowerCase());
      if (old) { old.members = g.members.slice(); updated++; }
      else { s.groups.push({ name: g.name, members: g.members.slice(), bar: true }); added++; }
    }
    window.renderGroups?.();
    return { groups, added, updated, unplaced };
  }

  async function makeAsk() {
    const { groups, unplaced } = plan();
    if (!groups.length) {
      say(unplaced ? `None of the lights have a place in the visualiser yet — open the visualiser (and move one light, or Reset layout) so they're saved, then try again` : "No lights patched", "warn");
      return null;
    }
    const existing = new Set((S().groups || []).map(g => String(g?.name || "").toLowerCase()));
    const list = groups.map(g => `${g.name}: ${g.members.length} light${g.members.length === 1 ? "" : "s"}${existing.has(g.name.toLowerCase()) ? " (replaces that group)" : ""}`).join("  ·  ");
    const ok = await window.LXAsk?.("Bar groups from the visualiser", [], {
      ok: "Make groups",
      message: `${list}${unplaced ? `. ${unplaced} light${unplaced === 1 ? " hasn't" : "s haven't"} been placed in the visualiser yet, so ${unplaced === 1 ? "isn't" : "aren't"} in any.` : ""}`
    });
    if (!ok) return null;
    const r = make();
    say(`Bar groups: ${r.groups.map(g => `${g.name} (${g.members.length})`).join(", ")}${r.unplaced ? ` — ${r.unplaced} not placed yet` : ""}`, "ok");
    return r;
  }

  function command(c) {
    if (/^(make\s+)?bar\s+groups$/.test(c) || c === "groups from bars") { makeAsk(); return true; }
    return false;
  }

  function install(tries = 0) {
    const create = document.getElementById("btnNewGroup");
    if (!create) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if (!document.getElementById("btnBarGroups")) {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "btnBarGroups";
      b.className = "btn-secondary full-width";
      b.textContent = "▦ Bar groups from the visualiser";
      b.title = "One group per bar, truss or boom, with the lights hanging on it";
      b.style.marginTop = "6px";
      b.addEventListener("click", () => makeAsk());
      create.after(b);
    }
  }

  window.LXBarGroups = { plan, make, makeAsk, command };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
