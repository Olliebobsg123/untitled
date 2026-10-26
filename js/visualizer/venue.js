// The venue: the stage, the room and everything in it that isn't a light -
// bars, trusses, booms, drapes, cycs, flats, rostra, steps, speakers, seating,
// people for scale and imported 3D models. It's plain data, saved with the
// show (layout.venue), and theatre.js draws it. Units are metres; the stage's
// front edge is at z = 0 with the audience towards +z.
//
// Every item has { id, kind, name, x, y, z, rx, ry, rz (degrees), color,
// material } plus its kind's own sizes (KINDS[kind].fields). An item's x/y/z is
// where it stands: the bottom of it, except bars and trusses, where y is the
// height of the pipe (or the truss's middle).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// --- What can go in the venue ---------------------------------------------

// fields: the sizes the Build panel shows, as [key, label, step, min, max] or
// [key, label, options] for a choice.
export const KINDS = {
  bar: { label: "Lighting bar", group: "Rigging", icon: "━", hang: true, defaults: { w: 10, y: 7, color: "#55585e", material: "metal" }, fields: [["w", "Length", 0.1, 0.5, 40]] },
  truss: { label: "Truss", group: "Rigging", icon: "▦", hang: true, defaults: { w: 8, size: 0.29, y: 7, color: "#c9cdd2", material: "metal" }, fields: [["w", "Length", 0.1, 0.5, 40], ["size", "Truss size", 0.01, 0.2, 0.6]] },
  boom: { label: "Boom", group: "Rigging", icon: "┃", hang: true, defaults: { h: 3, y: 1, color: "#2a2b2e", material: "metal" }, fields: [["h", "Height", 0.1, 0.5, 8]] },
  drape: { label: "Drape (leg, border, blacks)", group: "Drapes & surfaces", icon: "▥", defaults: { w: 2, h: 7, y: 1, color: "#08080a", material: "velvet", folds: 1 }, fields: [["w", "Width", 0.1, 0.2, 30], ["h", "Height", 0.1, 0.2, 15], ["folds", "Folds", [["1", "Pleated"], ["0", "Flat"]]]] },
  cyc: { label: "Cyclorama", group: "Drapes & surfaces", icon: "▭", defaults: { w: 11, h: 7, y: 1, color: "#e8eaee", material: "matte" }, fields: [["w", "Width", 0.1, 1, 30], ["h", "Height", 0.1, 1, 15]] },
  gauze: { label: "Gauze (scrim)", group: "Drapes & surfaces", icon: "░", defaults: { w: 11, h: 7, y: 1, color: "#1d1d20", material: "matte", opacity: 0.3 }, fields: [["w", "Width", 0.1, 1, 30], ["h", "Height", 0.1, 1, 15], ["opacity", "See-through", 0.05, 0.05, 0.95]] },
  screen: { label: "Video screen", group: "Drapes & surfaces", icon: "▣", defaults: { w: 4, h: 2.25, y: 3, color: "#4f7bd9", material: "matte", glow: 0.5 }, fields: [["w", "Width", 0.1, 0.3, 20], ["h", "Height", 0.1, 0.3, 12], ["glow", "Brightness", 0.05, 0, 3]] },
  flat: { label: "Flat", group: "Scenery", icon: "▯", defaults: { w: 2.4, h: 3.6, d: 0.08, y: 1, color: "#8c7d6a", material: "matte" }, fields: [["w", "Width", 0.05, 0.1, 20], ["h", "Height", 0.05, 0.1, 12], ["d", "Thickness", 0.01, 0.01, 1]] },
  platform: { label: "Rostrum", group: "Scenery", icon: "▬", defaults: { w: 2.4, d: 1.2, h: 0.6, y: 1, color: "#232327", material: "satin" }, fields: [["w", "Width", 0.05, 0.2, 20], ["d", "Depth", 0.05, 0.2, 20], ["h", "Height", 0.05, 0.05, 5]] },
  steps: { label: "Steps", group: "Scenery", icon: "▟", defaults: { w: 1.2, d: 1.2, h: 0.6, y: 1, count: 3, color: "#232327", material: "satin" }, fields: [["w", "Width", 0.05, 0.3, 10], ["d", "Depth", 0.05, 0.3, 10], ["h", "Height", 0.05, 0.1, 5], ["count", "Treads", 1, 1, 20]] },
  box: { label: "Box", group: "Scenery", icon: "■", defaults: { w: 1, h: 1, d: 1, y: 1, color: "#7a7a80", material: "matte" }, fields: [["w", "Width", 0.05, 0.05, 20], ["h", "Height", 0.05, 0.05, 15], ["d", "Depth", 0.05, 0.05, 20]] },
  pillar: { label: "Pillar", group: "Scenery", icon: "●", defaults: { w: 0.6, h: 4, y: 1, color: "#9c9ca3", material: "satin" }, fields: [["w", "Diameter", 0.05, 0.05, 5], ["h", "Height", 0.05, 0.1, 15]] },
  tree: { label: "Tree", group: "Scenery", icon: "▲", defaults: { w: 1.6, h: 3, y: 1, color: "#2c5a3c", material: "matte" }, fields: [["w", "Width", 0.05, 0.3, 6], ["h", "Height", 0.05, 0.5, 10]] },
  model: { label: "3D model…", group: "Scenery", icon: "◆", defaults: { y: 1, scale: 1, color: "#9a9aa2", material: "matte" }, fields: [["scale", "Scale", 0.01, 0.001, 100]] },
  speaker: { label: "Speaker", group: "Sound", icon: "◘", defaults: { y: 0, model: "point", mount: "stand", color: "#1b1b1e", material: "satin" }, fields: [["model", "Type", [["point", "Point source"], ["array", "Line array"], ["sub", "Subwoofer"], ["wedge", "Monitor wedge"], ["column", "Column"]]], ["mount", "Mounted", [["stand", "On a stand"], ["floor", "On the floor"], ["flown", "Flown"]]]] },
  seating: { label: "Seating", group: "Audience", icon: "⑉", defaults: { y: 0, rows: 8, perRow: 14, rise: 0.26, aisle: 1, color: "#3c1216", material: "matte" }, fields: [["rows", "Rows", 1, 1, 40], ["perRow", "Seats a row", 1, 1, 60], ["rise", "Rake (per row)", 0.01, 0, 0.6], ["aisle", "Centre aisle", [["1", "Yes"], ["0", "No"]]]] },
  person: { label: "Person (for scale)", group: "Audience", icon: "♙", defaults: { y: 1, h: 1.75, color: "#bfae9c", material: "matte" }, fields: [["h", "Height", 0.05, 0.5, 2.4]] }
};
export const KIND_GROUPS = ["Rigging", "Drapes & surfaces", "Scenery", "Sound", "Audience"];
export const MATERIALS = [["matte", "Matte"], ["satin", "Satin"], ["gloss", "Gloss"], ["metal", "Metal"], ["velvet", "Velvet"], ["mirror", "Mirror"]];

// --- The default venue: the theatre the visualiser always had --------------

let counter = 0;
export const newId = () => `v${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeItem(kind, fields = {}) {
  const spec = KINDS[kind];
  return { id: newId(), kind, name: spec.label.replace(/…$/, ""), x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...spec.defaults, ...fields };
}

export function defaultVenue(template = "proscenium") {
  const stage = { width: 12, depth: 9, height: 1, color: "#3b3b40" };
  if (template === "blackbox") {
    const items = [
      ...[-3, -1, 1, 3].map((z, i) => makeItem("bar", { name: `LX ${i + 1}`, w: 12, y: 6, z: z - 4 })),
      makeItem("drape", { name: "Back blacks", w: 14, h: 6, y: 0, z: -8.5 }),
      makeItem("seating", { name: "Seating", z: 2.5, rows: 6, perRow: 16, rise: 0.3 })
    ];
    return normaliseVenue({ version: 1, stage: { width: 12, depth: 9, height: 0, color: "#232327" }, room: { width: 18, height: 8, house: 10, backstage: 0.6, color: "#0d0d10" }, proscenium: { show: false }, tabs: { show: false }, items, assets: {} });
  }
  const items = [
    makeItem("bar", { name: "FOH", w: 12, y: 7.6, z: 6 }),
    makeItem("bar", { name: "LX 1", w: 11, y: 7.2, z: -1.2 }),
    makeItem("bar", { name: "LX 2", w: 11, y: 7.2, z: -3.8 }),
    makeItem("bar", { name: "LX 3", w: 11, y: 7.2, z: -6.4 }),
    makeItem("drape", { name: "Back wall blacks", w: 11, h: 7, y: 1, z: -8.4, folds: 0, color: "#0b0b0c" })
  ];
  [-2.5, -5.1, -7.6].forEach((z, i) => {
    for (const side of [-1, 1]) items.push(makeItem("drape", { name: `Leg ${i + 1} ${side < 0 ? "SR" : "SL"}`, w: 1.4, h: 7.5, y: 1, x: side * 5.45, z, color: "#070708" }));
    items.push(makeItem("drape", { name: `Border ${i + 1}`, w: 12, h: 1.2, y: 7.7, z, color: "#070708" }));
  });
  items.push(makeItem("seating", { name: "Stalls", z: 3 }));
  return normaliseVenue({ version: 1, stage, room: { width: 22, height: 11, house: 17, backstage: 1, color: "#101014" }, proscenium: { show: true, width: 12, height: 8.4, color: "#070708" }, tabs: { show: true, color: "#5a0710" }, items, assets: {} });
}

// --- Keeping saved venues sane ---------------------------------------------

const num = (value, fallback, min = -Infinity, max = Infinity) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const colour = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback);

export function normaliseVenue(venue) {
  if (!venue || typeof venue !== "object" || !Array.isArray(venue.items)) return null;
  const s = venue.stage || {}, r = venue.room || {}, p = venue.proscenium || {}, t = venue.tabs || {};
  const stage = { width: num(s.width, 12, 1, 60), depth: num(s.depth, 9, 1, 60), height: num(s.height, 1, 0, 4), color: colour(s.color, "#3b3b40") };
  const room = { width: num(r.width, 22, 4, 120), height: num(r.height, 11, 3, 40), house: num(r.house, 17, 2, 120), backstage: num(r.backstage, 1, 0, 30), color: colour(r.color, "#101014") };
  room.width = Math.max(room.width, stage.width + 1);
  const proscenium = { show: p.show !== false, width: num(p.width, stage.width, 1, room.width), height: num(p.height, 8.4, 1, room.height), color: colour(p.color, "#070708") };
  const tabs = { show: t.show !== false && proscenium.show, color: colour(t.color, "#5a0710") };
  const items = [];
  for (const raw of venue.items) {
    if (!raw || !KINDS[raw.kind]) continue;
    const spec = KINDS[raw.kind];
    const item = { ...spec.defaults, ...raw };
    item.id = String(item.id || newId()).slice(0, 40);
    item.name = String(item.name || spec.label).slice(0, 60);
    for (const key of ["x", "y", "z"]) item[key] = num(item[key], 0, -200, 200);
    for (const key of ["rx", "ry", "rz"]) item[key] = num(item[key], 0, -360, 360);
    item.color = colour(item.color, spec.defaults.color || "#808080");
    if (!MATERIALS.some(([m]) => m === item.material)) item.material = spec.defaults.material || "matte";
    for (const [key, , step, min, max] of spec.fields) {
      if (Array.isArray(step)) item[key] = step.some(([v]) => v === String(item[key])) ? String(item[key]) : String(spec.defaults[key]);
      else item[key] = num(item[key], spec.defaults[key], min, max);
    }
    item.hidden = Boolean(item.hidden);
    item.locked = Boolean(item.locked);
    items.push(item);
  }
  const assets = {};
  for (const [id, asset] of Object.entries(venue.assets || {})) {
    if (asset && typeof asset.data === "string" && /^(glb|gltf|obj|stl)$/.test(asset.type)) assets[id] = { name: String(asset.name || "model").slice(0, 80), type: asset.type, data: asset.data };
  }
  return { version: 1, stage, room, proscenium, tabs, items, assets };
}

// The room's edges and the stage's, from a venue (theatre.js keeps STAGE and ROOM in step).
export function bounds(venue) {
  const { stage, room } = venue;
  return {
    stage: { width: stage.width, depth: stage.depth, height: stage.height, frontZ: 0 },
    room: { minX: -room.width / 2, maxX: room.width / 2, minY: 0, maxY: room.height, minZ: -(stage.depth + room.backstage), maxZ: room.house }
  };
}

// --- Where lights hang -----------------------------------------------------

// Bars and trusses: a line fixtures hang under. Booms: a vertical line they
// clamp to. → [{ item, kind: "line"|"upright", a, b (world points) }]
export function hangLines(venue) {
  const lines = [];
  for (const item of venue.items) {
    if (!KINDS[item.kind]?.hang || item.hidden) continue;
    const matrix = itemMatrix(item);
    if (item.kind === "boom") {
      lines.push({ item, kind: "upright", a: new THREE.Vector3(0, 0.25, 0).applyMatrix4(matrix), b: new THREE.Vector3(0, item.h, 0).applyMatrix4(matrix) });
    } else {
      const drop = item.kind === "truss" ? item.size / 2 + 0.08 : 0.08;
      lines.push({ item, kind: "line", a: new THREE.Vector3(-item.w / 2 + 0.2, -drop, 0).applyMatrix4(matrix), b: new THREE.Vector3(item.w / 2 - 0.2, -drop, 0).applyMatrix4(matrix) });
    }
  }
  return lines;
}

export function itemMatrix(item) {
  const object = new THREE.Object3D();
  placeObject(object, item);
  object.updateMatrix();
  return object.matrix.clone();
}

export function placeObject(object, item) {
  object.position.set(item.x, item.y, item.z);
  object.rotation.set(THREE.MathUtils.degToRad(item.rx || 0), THREE.MathUtils.degToRad(item.ry || 0), THREE.MathUtils.degToRad(item.rz || 0), "YXZ");
}

// --- Drawing an item ---------------------------------------------------------

const materialCache = new Map();
export function surface(color, kind = "matte", extra = {}) {
  const key = `${color}|${kind}|${JSON.stringify(extra)}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const base = { color: new THREE.Color(color), ...extra };
  let material;
  if (kind === "velvet") material = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.85, metalness: 0, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25), side: THREE.DoubleSide });
  else if (kind === "metal") material = new THREE.MeshStandardMaterial({ ...base, roughness: 0.38, metalness: 0.85 });
  else if (kind === "mirror") material = new THREE.MeshStandardMaterial({ ...base, roughness: 0.04, metalness: 1 });
  else material = new THREE.MeshStandardMaterial({ ...base, roughness: { matte: 0.92, satin: 0.55, gloss: 0.18 }[kind] ?? 0.9, metalness: 0 });
  materialCache.set(key, material);
  return material;
}

// A fabric hanging in soft folds: a plane w x h, bottom edge at y = 0.
function drapeGeometry(w, h, pleated) {
  const segments = pleated ? Math.max(8, Math.round(w * 10)) : 1;
  const geometry = new THREE.PlaneGeometry(w, h, segments, 1);
  if (pleated) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) position.setZ(i, Math.sin(position.getX(i) * Math.PI * 2 * 2.2) * 0.06);
    geometry.computeVertexNormals();
  }
  geometry.translate(0, h / 2, 0);
  return geometry;
}

// A box truss along x: four chords and zig-zag lacing on each face, in one geometry.
function trussGeometry(length, size) {
  const parts = [];
  const r = Math.max(0.012, size * 0.085);
  const h = size / 2;
  for (const [y, z] of [[h, h], [h, -h], [-h, h], [-h, -h]]) {
    const chord = new THREE.CylinderGeometry(r, r, length, 8);
    chord.rotateZ(Math.PI / 2);
    chord.translate(0, y, z);
    parts.push(chord);
  }
  const bays = Math.max(1, Math.round(length / size));
  const step = length / bays;
  const brace = (a, b) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(r * 0.55, r * 0.55, d.length(), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  };
  for (let i = 0; i < bays; i++) {
    const x0 = -length / 2 + i * step, x1 = x0 + step, flip = i % 2 ? -1 : 1;
    brace(new THREE.Vector3(x0, h, h * flip), new THREE.Vector3(x1, h, -h * flip));     // top
    brace(new THREE.Vector3(x0, -h, h * flip), new THREE.Vector3(x1, -h, -h * flip));   // bottom
    brace(new THREE.Vector3(x0, h * flip, h), new THREE.Vector3(x1, -h * flip, h));     // front
    brace(new THREE.Vector3(x0, h * flip, -h), new THREE.Vector3(x1, -h * flip, -h));   // back
  }
  return mergeGeometries(parts);
}

function stepsGeometry(w, d, h, count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const rise = (h * (i + 1)) / count;
    const depth = d * (1 - i / count);
    const box = new THREE.BoxGeometry(w, rise, depth);
    box.translate(0, rise / 2, -d / 2 + depth / 2 - (d - depth));
    parts.push(box);
  }
  // Treads go up away from the audience: front tread lowest.
  const merged = mergeGeometries(parts);
  merged.translate(0, 0, d / 2);
  merged.rotateY(Math.PI);
  return merged;
}

function personGeometry(height) {
  const k = height / 1.75;
  const parts = [];
  const add = (g, x, y, z) => { g.translate(x * k, y * k, z * k); parts.push(g); };
  add(new THREE.CapsuleGeometry(0.075 * k, 0.72 * k, 4, 10), -0.1, 0.45, 0);  // legs
  add(new THREE.CapsuleGeometry(0.075 * k, 0.72 * k, 4, 10), 0.1, 0.45, 0);
  add(new THREE.CapsuleGeometry(0.18 * k, 0.42 * k, 4, 12), 0, 1.15, 0);     // body
  add(new THREE.CapsuleGeometry(0.05 * k, 0.55 * k, 4, 8), -0.26, 1.08, 0);  // arms
  add(new THREE.CapsuleGeometry(0.05 * k, 0.55 * k, 4, 8), 0.26, 1.08, 0);
  add(new THREE.SphereGeometry(0.115 * k, 16, 12), 0, 1.6, 0);              // head
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}

// Speaker cabinets: a dark box with a grille on the audience side (+z).
function speakerParts(item, add, mat) {
  const grille = surface("#0c0c0d", "matte");
  const cabinet = (w, h, d, x, y, z, tilt = 0) => {
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.9), grille);
    face.position.z = d / 2 + 0.002;
    group.add(box, face);
    group.position.set(x, y, z);
    group.rotation.x = tilt;
    add(group);
    return group;
  };
  const { model, mount } = item;
  const sizes = { point: [0.38, 0.62, 0.36], sub: [0.62, 0.56, 0.72], wedge: [0.55, 0.32, 0.42], column: [0.16, 1.1, 0.16], array: [0.9, 0.25, 0.5] };
  const [w, h, d] = sizes[model] || sizes.point;
  const lift = mount === "stand" ? (model === "sub" ? 0 : 1.6) : 0;
  if (mount === "stand" && model !== "sub" && model !== "wedge") {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, lift, 8), surface("#2a2a2c", "metal"));
    pole.position.y = lift / 2;
    add(pole);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6), surface("#2a2a2c", "metal"));
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.28, 0.25, Math.sin(a) * 0.28);
      leg.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      add(leg);
    }
  }
  if (model === "array") {
    // A curved hang of six boxes, flown from its top.
    let y = mount === "flown" ? -h / 2 : lift + h * 6 - h / 2, z = 0, tilt = 0;
    for (let i = 0; i < 6; i++) {
      cabinet(w, h, d, 0, y, z, tilt);
      tilt += 0.07 * i;
      y -= h * Math.cos(tilt);
      z += h * Math.sin(tilt) * 0.5;
    }
  } else if (model === "wedge") {
    cabinet(w, h, d, 0, h / 2, 0, -0.5);
  } else {
    const y = mount === "flown" ? -h / 2 : lift + h / 2;
    cabinet(w, h, d, 0, y, 0, mount === "flown" ? 0.25 : 0);
  }
}

function seatingParts(item, add) {
  const rows = Math.round(item.rows), perRow = Math.round(item.perRow);
  const rise = item.rise, aisle = item.aisle === "1";
  const riser = surface("#121216", "matte");
  const width = perRow * 0.62 + (aisle ? 1 : 0) + 1.2;
  if (rise > 0) for (let r = 0; r < rows; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(width, rise * (r + 1), 1.1), riser);
    step.position.set(0, (rise * (r + 1)) / 2, r * 1.1);
    add(step);
  }
  const seatMaterial = surface(item.color, item.material);
  const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), seatMaterial, rows * perRow);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.55, 0.08), seatMaterial, rows * perRow);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < perRow; s++) {
      const x = (s - (perRow - 1) / 2) * 0.62 + (aisle ? (s < perRow / 2 ? -0.5 : 0.5) : 0);
      const top = (r + 1) * rise;
      dummy.position.set(x, top + 0.21, r * 1.1);
      dummy.updateMatrix();
      seat.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, top + 0.55, r * 1.1 + 0.26);
      dummy.updateMatrix();
      back.setMatrixAt(i, dummy.matrix);
      i++;
    }
  }
  add(seat);
  add(back);
}

// The 3D object for one item: a group placed at the item, holding meshes
// tagged with userData.venueId. solid: meshes beams and pools land on.
// Imported models fill in once loaded (loadModel).
export function buildItem(item, venue, loadModel) {
  const group = new THREE.Group();
  group.userData.venueId = item.id;
  placeObject(group, item);
  const solids = [];
  const mat = surface(item.color, item.material);
  const add = (object, { solid = true, cast = true } = {}) => {
    object.traverse(o => {
      if (!o.isMesh) return;
      o.userData.venueId = item.id;
      o.castShadow = cast;
      o.receiveShadow = true;
      if (solid) solids.push(o);
    });
    group.add(object);
    return object;
  };
  const mesh = (geometry, material = mat, options) => add(new THREE.Mesh(geometry, material), options);
  switch (item.kind) {
    case "bar": {
      const pipe = new THREE.CylinderGeometry(0.024, 0.024, item.w, 12);
      pipe.rotateZ(Math.PI / 2);
      mesh(pipe, mat, { solid: false, cast: false });
      break;
    }
    case "truss":
      mesh(trussGeometry(item.w, item.size), mat, { solid: false, cast: true });
      break;
    case "boom": {
      const pole = new THREE.CylinderGeometry(0.024, 0.024, item.h, 10);
      pole.translate(0, item.h / 2, 0);
      mesh(pole, mat, { solid: false });
      mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 24).translate(0, 0.01, 0), mat, { solid: false });
      break;
    }
    case "drape":
      mesh(drapeGeometry(item.w, item.h, item.folds === "1"), surface(item.color, item.material, { side: THREE.DoubleSide }));
      break;
    case "cyc":
      mesh(new THREE.PlaneGeometry(item.w, item.h).translate(0, item.h / 2, 0), surface(item.color, item.material, { side: THREE.DoubleSide }));
      break;
    case "gauze": {
      const material = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.95, transparent: true, opacity: 1 - item.opacity, side: THREE.DoubleSide, depthWrite: false });
      mesh(new THREE.PlaneGeometry(item.w, item.h).translate(0, item.h / 2, 0), material, { solid: false, cast: false });
      break;
    }
    case "screen": {
      mesh(new THREE.BoxGeometry(item.w + 0.08, item.h + 0.08, 0.1).translate(0, item.h / 2, -0.05), surface("#111114", "satin"));
      const glow = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(item.color), emissiveIntensity: item.glow, roughness: 0.3 });
      mesh(new THREE.PlaneGeometry(item.w, item.h).translate(0, item.h / 2, 0.001), glow);
      break;
    }
    case "flat":
      mesh(new THREE.BoxGeometry(item.w, item.h, item.d).translate(0, item.h / 2, 0));
      break;
    case "platform":
      mesh(new THREE.BoxGeometry(item.w, item.h, item.d).translate(0, item.h / 2, 0));
      break;
    case "steps":
      mesh(stepsGeometry(item.w, item.d, item.h, Math.round(item.count)));
      break;
    case "box":
      mesh(new THREE.BoxGeometry(item.w, item.h, item.d).translate(0, item.h / 2, 0));
      break;
    case "pillar":
      mesh(new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32).translate(0, item.h / 2, 0));
      break;
    case "tree": {
      mesh(new THREE.CylinderGeometry(item.w * 0.06, item.w * 0.09, item.h * 0.35, 10).translate(0, item.h * 0.175, 0), surface("#4a3424", "matte"));
      for (let i = 0; i < 3; i++) {
        const r = item.w / 2 * (1 - i * 0.25), height = item.h * 0.42;
        mesh(new THREE.ConeGeometry(r, height, 16).translate(0, item.h * 0.3 + i * item.h * 0.2 + height / 2, 0));
      }
      break;
    }
    case "person":
      mesh(personGeometry(item.h));
      break;
    case "speaker":
      speakerParts(item, object => add(object), mat);
      break;
    case "seating":
      seatingParts(item, object => add(object));
      break;
    case "model":
      if (loadModel) loadModel(item, venue?.assets?.[item.assetId], object => add(object));
      break;
  }
  group.visible = !item.hidden;
  return { group, solids: item.hidden ? [] : solids };
}
