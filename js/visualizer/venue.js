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
import { liveTexture } from "./live-video.js";

// --- What can go in the venue ---------------------------------------------

// fields: the sizes the Build panel shows, as [key, label, step, min, max] or
// [key, label, options] for a choice.
const POSES = [["stand", "Standing"], ["arms", "Arms up"], ["sit", "Sitting"], ["walk", "Walking"]];
export const KINDS = {
  bar: { label: "Lighting bar", group: "Rigging", icon: "━", hang: true, defaults: { w: 10, y: 7, color: "#55585e", material: "metal" }, fields: [["w", "Length", 0.1, 0.5, 40]] },
  truss: { label: "Truss", group: "Rigging", icon: "▦", hang: true, defaults: { w: 8, size: 0.29, y: 7, color: "#c9cdd2", material: "metal" }, fields: [["w", "Length", 0.1, 0.5, 40], ["size", "Truss size", 0.01, 0.2, 0.6]] },
  boom: { label: "Boom", group: "Rigging", icon: "┃", hang: true, defaults: { h: 3, y: 1, color: "#2a2b2e", material: "metal" }, fields: [["h", "Height", 0.1, 0.5, 8]] },
  drape: { label: "Drape (leg, border, blacks)", group: "Drapes & surfaces", icon: "▥", defaults: { w: 2, h: 7, y: 1, color: "#08080a", material: "velvet", folds: 1 }, fields: [["w", "Width", 0.1, 0.2, 30], ["h", "Height", 0.1, 0.2, 15], ["folds", "Folds", [["1", "Pleated"], ["0", "Flat"]]]] },
  cyc: { label: "Cyclorama", group: "Drapes & surfaces", icon: "▭", defaults: { w: 11, h: 7, y: 1, color: "#e8eaee", material: "matte" }, fields: [["w", "Width", 0.1, 1, 30], ["h", "Height", 0.1, 1, 15]] },
  gauze: { label: "Gauze (scrim)", group: "Drapes & surfaces", icon: "░", defaults: { w: 11, h: 7, y: 1, color: "#1d1d20", material: "matte", opacity: 0.3 }, fields: [["w", "Width", 0.1, 1, 30], ["h", "Height", 0.1, 1, 15], ["opacity", "See-through", 0.05, 0.05, 0.95]] },
  screen: { label: "Video screen", group: "Drapes & surfaces", icon: "▣", defaults: { w: 4, h: 2.25, y: 3, color: "#4f7bd9", material: "matte", glow: 0.5 }, fields: [["w", "Width", 0.1, 0.3, 20], ["h", "Height", 0.1, 0.3, 12], ["glow", "Picture brightness", 0.05, 0, 3]] },
  flat: { label: "Flat", group: "Scenery", icon: "▯", defaults: { w: 2.4, h: 3.6, d: 0.08, y: 1, color: "#8c7d6a", material: "matte" }, fields: [["w", "Width", 0.05, 0.1, 20], ["h", "Height", 0.05, 0.1, 12], ["d", "Thickness", 0.01, 0.01, 1]] },
  platform: { label: "Rostrum", group: "Scenery", icon: "▬", defaults: { w: 2.4, d: 1.2, h: 0.6, y: 1, color: "#232327", material: "satin" }, fields: [["w", "Width", 0.05, 0.2, 20], ["d", "Depth", 0.05, 0.2, 20], ["h", "Height", 0.05, 0.05, 5]] },
  steps: { label: "Steps", group: "Scenery", icon: "▟", defaults: { w: 1.2, d: 1.2, h: 0.6, y: 1, count: 3, color: "#232327", material: "satin" }, fields: [["w", "Width", 0.05, 0.3, 10], ["d", "Depth", 0.05, 0.3, 10], ["h", "Height", 0.05, 0.1, 5], ["count", "Treads", 1, 1, 20]] },
  box: { label: "Box", group: "Scenery", icon: "■", defaults: { w: 1, h: 1, d: 1, y: 1, color: "#7a7a80", material: "matte" }, fields: [["w", "Width", 0.05, 0.05, 20], ["h", "Height", 0.05, 0.05, 15], ["d", "Depth", 0.05, 0.05, 20]] },
  pillar: { label: "Pillar", group: "Scenery", icon: "●", defaults: { w: 0.6, h: 4, y: 1, color: "#9c9ca3", material: "satin" }, fields: [["w", "Diameter", 0.05, 0.05, 5], ["h", "Height", 0.05, 0.1, 15]] },
  door: { label: "Door", group: "Scenery", icon: "▯", defaults: { w: 0.9, h: 2.1, y: 1, open: 0, color: "#6b4f3a", material: "satin" }, fields: [["w", "Width", 0.05, 0.5, 3], ["h", "Height", 0.05, 1.5, 4], ["open", "Open (°)", 5, 0, 110]] },
  arch: { label: "Arch", group: "Scenery", icon: "∩", defaults: { w: 3, h: 3.5, d: 0.3, t: 0.4, y: 1, color: "#b9b2a6", material: "matte" }, fields: [["w", "Width", 0.05, 1, 15], ["h", "Height", 0.05, 1, 12], ["d", "Thickness", 0.05, 0.05, 2], ["t", "Side width", 0.05, 0.1, 3]] },
  window: { label: "Window flat", group: "Scenery", icon: "⊞", defaults: { w: 2.4, h: 3, d: 0.08, ww: 1.2, wh: 1.4, y: 1, color: "#8c7d6a", material: "matte" }, fields: [["w", "Width", 0.05, 0.5, 20], ["h", "Height", 0.05, 0.5, 12], ["ww", "Window width", 0.05, 0.2, 10], ["wh", "Window height", 0.05, 0.2, 10]] },
  rock: { label: "Rock / ice", group: "Scenery", icon: "◭", defaults: { w: 1.4, h: 1, d: 1.1, y: 1, style: "ice", color: "#cfe6ff", material: "gloss" }, fields: [["w", "Width", 0.05, 0.1, 10], ["h", "Height", 0.05, 0.1, 8], ["d", "Depth", 0.05, 0.1, 10], ["style", "Kind", [["ice", "Ice"], ["rock", "Rock"]]]] },
  tree: { label: "Tree", group: "Scenery", icon: "▲", defaults: { w: 1.6, h: 3, y: 1, color: "#2c5a3c", material: "matte" }, fields: [["w", "Width", 0.05, 0.3, 6], ["h", "Height", 0.05, 0.5, 10]] },
  model: { label: "3D model…", group: "Scenery", icon: "◆", defaults: { y: 1, scale: 1, color: "#9a9aa2", material: "matte" }, fields: [["scale", "Scale", 0.01, 0.001, 100]] },
  table: { label: "Table", group: "Furniture", icon: "╥", defaults: { w: 1.6, d: 0.8, h: 0.75, y: 1, color: "#7a5a40", material: "satin" }, fields: [["w", "Width", 0.05, 0.3, 6], ["d", "Depth", 0.05, 0.3, 3], ["h", "Height", 0.05, 0.3, 1.5]] },
  chair: { label: "Chair", group: "Furniture", icon: "╓", defaults: { y: 1, color: "#6b4f3a", material: "satin" }, fields: [] },
  bench: { label: "Bench", group: "Furniture", icon: "▭", defaults: { w: 1.8, y: 1, color: "#6b4f3a", material: "satin" }, fields: [["w", "Length", 0.05, 0.6, 6]] },
  bed: { label: "Bed", group: "Furniture", icon: "▬", defaults: { w: 1.5, d: 2.1, y: 1, color: "#5a4636", material: "satin" }, fields: [["w", "Width", 0.05, 0.8, 3], ["d", "Length", 0.05, 1.5, 3]] },
  speaker: { label: "Speaker", group: "Sound", icon: "◘", defaults: { y: 0, model: "point", mount: "stand", color: "#1b1b1e", material: "satin" }, fields: [["model", "Type", [["point", "Point source"], ["array", "Line array"], ["sub", "Subwoofer"], ["wedge", "Monitor wedge"], ["column", "Column"]]], ["mount", "Mounted", [["stand", "On a stand"], ["floor", "On the floor"], ["flown", "Flown"]]]] },
  seating: { label: "Seating", group: "Audience", icon: "⑉", defaults: { y: 0, rows: 8, perRow: 14, rise: 0.26, aisle: 1, color: "#3c1216", material: "matte" }, fields: [["rows", "Rows", 1, 1, 40], ["perRow", "Seats a row", 1, 1, 60], ["rise", "Rake (per row)", 0.01, 0, 0.6], ["aisle", "Centre aisle", [["1", "Yes"], ["0", "No"]]]] },
  person: { label: "Person", group: "People", icon: "♙", defaults: { y: 1, h: 1.75, pose: "stand", color: "#bfae9c", material: "matte" }, fields: [["h", "Height", 0.05, 0.5, 2.4], ["pose", "Pose", POSES]] },
  crowd: { label: "Group of people", group: "People", icon: "♙♙", defaults: { y: 1, count: 6, spacing: 0.8, h: 1.7, color: "#bfae9c", material: "matte" }, fields: [["count", "People", 1, 1, 40], ["spacing", "Apart (m)", 0.05, 0.4, 3], ["h", "Height", 0.05, 0.5, 2.4]] }
};
// Kinds that can show a picture (a painted cloth, a backdrop, a photo of the set).
export const PICTURE_KINDS = new Set(["flat", "cyc", "drape", "gauze", "screen", "box"]);
export const KIND_GROUPS = ["Rigging", "Drapes & surfaces", "Scenery", "Furniture", "People", "Sound", "Audience"];
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
    item.picture = PICTURE_KINDS.has(item.kind) && typeof item.picture === "string" ? item.picture.slice(0, 40) : "";
    // A video screen showing a live screen or window (live-video.js): { name, id, screen }.
    item.live = item.kind === "screen" && item.live && typeof item.live.name === "string" && item.live.name
      ? { name: item.live.name.slice(0, 200), id: String(item.live.id || "").slice(0, 120), screen: Boolean(item.live.screen) } : null;
    item.hidden = Boolean(item.hidden);
    item.locked = Boolean(item.locked);
    items.push(item);
  }
  const assets = {};
  for (const [id, asset] of Object.entries(venue.assets || {})) {
    if (!asset || typeof asset.data !== "string") continue;
    // 3D models (with the unit they were drawn in) and pictures for scenery.
    if (/^(glb|gltf|obj|stl)$/.test(asset.type)) assets[id] = { name: String(asset.name || "model").slice(0, 80), type: asset.type, data: asset.data, unit: [1, 0.01, 0.001].includes(Number(asset.unit)) ? Number(asset.unit) : 1 };
    else if (asset.type === "image" && /^image\/(png|jpeg|webp|gif)$/.test(asset.mime)) assets[id] = { name: String(asset.name || "picture").slice(0, 80), type: "image", mime: asset.mime, data: asset.data };
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

// --- Pictures ------------------------------------------------------------

const textures = new Map(); // asset id → texture
let pictureReady = () => {};
// Called when a picture has loaded (the visualiser redraws).
export function onPictureReady(fn) { pictureReady = fn; }
function pictureTexture(id, asset) {
  if (!asset || asset.type !== "image") return null;
  if (!textures.has(id)) {
    const image = new Image();
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    image.onload = () => { texture.needsUpdate = true; pictureReady(); };
    image.src = `data:${asset.mime};base64,${asset.data}`;
    textures.set(id, texture);
  }
  return textures.get(id);
}
// The item's surface with its picture on it (white, so the picture's own colours show).
function pictured(item, venue, extra = {}) {
  const texture = item.picture ? pictureTexture(item.picture, venue?.assets?.[item.picture]) : null;
  if (!texture) return null;
  const base = { map: texture, color: 0xffffff, ...extra };
  if (item.material === "velvet") return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x666666) });
  return new THREE.MeshStandardMaterial({ ...base, roughness: { satin: 0.55, gloss: 0.18, metal: 0.38, mirror: 0.05 }[item.material] ?? 0.9, metalness: item.material === "metal" ? 0.6 : 0 });
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

// A figure 1.75 m tall (scaled to height), facing the audience (+z).
// Poses: stand, arms (up), sit (on something 0.45 m high), walk.
function personGeometry(height, pose = "stand") {
  const k = height / 1.75;
  const parts = [];
  // A part: made, tilted (about x, then z), then put in place.
  const add = (g, x, y, z, rx = 0, rz = 0) => { if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x * k, y * k, z * k); parts.push(g); };
  const limb = (r, len) => new THREE.CapsuleGeometry(r * k, len * k, 4, 10);
  const head = () => new THREE.SphereGeometry(0.115 * k, 16, 12);
  if (pose === "sit") {
    add(limb(0.075, 0.34), -0.1, 0.47, 0.2, Math.PI / 2);   // thighs, forward
    add(limb(0.075, 0.34), 0.1, 0.47, 0.2, Math.PI / 2);
    add(limb(0.07, 0.36), -0.1, 0.24, 0.4);                  // shins, down
    add(limb(0.07, 0.36), 0.1, 0.24, 0.4);
    add(limb(0.18, 0.42), 0, 0.87, 0);                       // body
    add(limb(0.05, 0.5), -0.26, 0.82, 0.05, 0.25);           // arms, on the lap
    add(limb(0.05, 0.5), 0.26, 0.82, 0.05, 0.25);
    add(head(), 0, 1.32, 0);
  } else {
    const swing = pose === "walk" ? 0.32 : 0;
    add(limb(0.075, 0.72), -0.1, 0.45, 0, swing);           // legs
    add(limb(0.075, 0.72), 0.1, 0.45, 0, -swing);
    add(limb(0.18, 0.42), 0, 1.15, 0);                       // body
    if (pose === "arms") {
      add(limb(0.05, 0.55), -0.3, 1.66, 0, 0, 0.35);         // arms up
      add(limb(0.05, 0.55), 0.3, 1.66, 0, 0, -0.35);
    } else {
      add(limb(0.05, 0.55), -0.26, 1.08, 0, -swing);         // arms
      add(limb(0.05, 0.55), 0.26, 1.08, 0, swing);
    }
    add(head(), 0, 1.6, 0);
  }
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}

// Simple furniture, built from boxes and legs, sitting on y = 0.
function legsAt(points, height, radius = 0.022) {
  return points.map(([x, z]) => new THREE.CylinderGeometry(radius, radius, height, 8).translate(x, height / 2, z));
}
function furnitureGeometry(item) {
  const parts = [];
  if (item.kind === "table") {
    const { w, d, h } = item, ix = w / 2 - 0.06, iz = d / 2 - 0.06;
    parts.push(new THREE.BoxGeometry(w, 0.04, d).translate(0, h - 0.02, 0), ...legsAt([[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]], h - 0.04));
  } else if (item.kind === "chair") {
    parts.push(new THREE.BoxGeometry(0.45, 0.04, 0.44).translate(0, 0.45, 0), new THREE.BoxGeometry(0.45, 0.48, 0.03).translate(0, 0.71, -0.205), ...legsAt([[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]], 0.43, 0.018));
  } else if (item.kind === "bench") {
    const w = item.w;
    parts.push(new THREE.BoxGeometry(w, 0.05, 0.38).translate(0, 0.45, 0), new THREE.BoxGeometry(0.05, 0.43, 0.34).translate(-w / 2 + 0.12, 0.215, 0), new THREE.BoxGeometry(0.05, 0.43, 0.34).translate(w / 2 - 0.12, 0.215, 0));
  }
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}

// A wall piece with an opening: an arch (round top) or a window (square, with bars).
function openingGeometry(item) {
  const shape = new THREE.Shape();
  shape.moveTo(-item.w / 2, 0); shape.lineTo(item.w / 2, 0); shape.lineTo(item.w / 2, item.h); shape.lineTo(-item.w / 2, item.h); shape.closePath();
  const hole = new THREE.Path();
  if (item.kind === "arch") {
    const r = Math.max(0.1, item.w / 2 - item.t), top = Math.max(r + 0.1, item.h - item.t);
    hole.moveTo(-r, 0); hole.lineTo(r, 0); hole.lineTo(r, top - r);
    hole.absarc(0, top - r, r, 0, Math.PI, false);
    hole.lineTo(-r, 0);
  } else {
    const hw = Math.min(item.ww, item.w - 0.2) / 2, hh = Math.min(item.wh, item.h - 0.2), y0 = Math.max(0.1, (item.h - hh) * 0.55);
    hole.moveTo(-hw, y0); hole.lineTo(hw, y0); hole.lineTo(hw, y0 + hh); hole.lineTo(-hw, y0 + hh); hole.closePath();
  }
  shape.holes.push(hole);
  const depth = item.d;
  const wall = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, -depth / 2);
  if (item.kind !== "window") return wall;
  // Glazing bars across the window.
  const hw = Math.min(item.ww, item.w - 0.2) / 2, hh = Math.min(item.wh, item.h - 0.2), y0 = Math.max(0.1, (item.h - hh) * 0.55);
  const bars = [new THREE.BoxGeometry(0.04, hh, 0.04).translate(0, y0 + hh / 2, 0), new THREE.BoxGeometry(hw * 2, 0.04, 0.04).translate(0, y0 + hh / 2, 0)];
  return mergeGeometries([wall, ...bars.map(b => b.toNonIndexed())].map(g => { g.clearGroups(); return g; }));
}

// A rock or a block of ice: a lumpy, faceted stone, the same shape every
// time for the same piece.
function rockGeometry(item) {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  let seed = 0;
  for (const ch of String(item.id || "rock")) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pos = g.attributes.position, seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, 0.82 + rand() * (item.style === "ice" ? 0.45 : 0.3));
    const f = seen.get(key);
    pos.setXYZ(i, pos.getX(i) * f, Math.max(-0.5, pos.getY(i) * f), pos.getZ(i) * f);
  }
  g.scale(item.w, item.h, item.d);
  g.translate(0, item.h / 2, 0);
  g.computeVertexNormals();
  return g;
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

// A box with its picture on the audience side (+z) only.
function facePicture(item, venue, plain) {
  const front = pictured(item, venue);
  return front ? [plain, plain, plain, plain, front, plain] : plain;
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
      mesh(drapeGeometry(item.w, item.h, item.folds === "1"), pictured(item, venue, { side: THREE.DoubleSide }) || surface(item.color, item.material, { side: THREE.DoubleSide }));
      break;
    case "cyc":
      mesh(new THREE.PlaneGeometry(item.w, item.h).translate(0, item.h / 2, 0), pictured(item, venue, { side: THREE.DoubleSide }) || surface(item.color, item.material, { side: THREE.DoubleSide }));
      break;
    case "gauze": {
      // (A painted gauze: the picture shows when lit from the front, see-through from behind.)
      const material = pictured(item, venue, { side: THREE.DoubleSide, transparent: true, opacity: 1 - item.opacity, depthWrite: false }) ||
        new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.95, transparent: true, opacity: 1 - item.opacity, side: THREE.DoubleSide, depthWrite: false });
      mesh(new THREE.PlaneGeometry(item.w, item.h).translate(0, item.h / 2, 0), material, { solid: false, cast: false });
      break;
    }
    case "screen": {
      mesh(new THREE.BoxGeometry(item.w + 0.08, item.h + 0.08, 0.1).translate(0, item.h / 2, -0.05), surface("#111114", "satin"));
      // Showing live video (QLab's output…) or a picture: the screen glows with
      // it. Nothing on it: a switched-off screen, dark, that stage light lands on.
      const shown = item.live ? liveTexture(item.live) : item.picture ? pictureTexture(item.picture, venue?.assets?.[item.picture]) : null;
      const face = shown
        ? new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: shown, emissiveIntensity: item.glow, roughness: 0.3 })
        : new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.55, metalness: 0 });
      mesh(new THREE.PlaneGeometry(item.w, item.h).translate(0, item.h / 2, 0.001), face);
      break;
    }
    case "flat":
      mesh(new THREE.BoxGeometry(item.w, item.h, item.d).translate(0, item.h / 2, 0), facePicture(item, venue, mat));
      break;
    case "platform":
      mesh(new THREE.BoxGeometry(item.w, item.h, item.d).translate(0, item.h / 2, 0));
      break;
    case "steps":
      mesh(stepsGeometry(item.w, item.d, item.h, Math.round(item.count)));
      break;
    case "box":
      mesh(new THREE.BoxGeometry(item.w, item.h, item.d).translate(0, item.h / 2, 0), facePicture(item, venue, mat));
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
      mesh(personGeometry(item.h, item.pose));
      break;
    case "crowd": {
      // In a loose line across, every other one a step back, different poses.
      const poses = ["stand", "arms", "walk", "stand"];
      for (let i = 0; i < item.count; i++) {
        const x = (i - (item.count - 1) / 2) * item.spacing;
        const g = personGeometry(item.h * (0.92 + ((i * 37) % 9) / 100), poses[i % poses.length]);
        g.translate(x, 0, i % 2 ? -0.45 : 0);
        mesh(g);
      }
      break;
    }
    case "table": case "chair": case "bench":
      mesh(furnitureGeometry(item));
      break;
    case "bed": {
      mesh(new THREE.BoxGeometry(item.w, 0.32, item.d).translate(0, 0.16, 0));
      mesh(new THREE.BoxGeometry(item.w - 0.06, 0.16, item.d - 0.1).translate(0, 0.4, 0.03), surface("#e4e0d8", "matte"));
      mesh(new THREE.BoxGeometry(item.w, 0.95, 0.06).translate(0, 0.475, -item.d / 2 + 0.03));
      mesh(new THREE.BoxGeometry(item.w * 0.32, 0.1, 0.36).translate(-item.w * 0.22, 0.53, -item.d / 2 + 0.3), surface("#f2efe8", "matte"));
      mesh(new THREE.BoxGeometry(item.w * 0.32, 0.1, 0.36).translate(item.w * 0.22, 0.53, -item.d / 2 + 0.3), surface("#f2efe8", "matte"));
      break;
    }
    case "door": {
      const t = 0.07;
      mesh(new THREE.BoxGeometry(t, item.h + t, 0.12).translate(-item.w / 2 - t / 2, (item.h + t) / 2, 0));   // frame
      mesh(new THREE.BoxGeometry(t, item.h + t, 0.12).translate(item.w / 2 + t / 2, (item.h + t) / 2, 0));
      mesh(new THREE.BoxGeometry(item.w + t * 2, t, 0.12).translate(0, item.h + t / 2, 0));
      // The door, hinged on the left, opening upstage.
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(item.w - 0.01, item.h - 0.01, 0.045).translate((item.w - 0.01) / 2, (item.h - 0.01) / 2, 0), mat);
      const hinge = new THREE.Group();
      hinge.position.set(-item.w / 2, 0, 0);
      hinge.rotation.y = -(Number(item.open) || 0) * Math.PI / 180;
      hinge.add(leaf);
      add(hinge);
      break;
    }
    case "arch": case "window":
      mesh(openingGeometry(item), item.kind === "window" ? facePicture(item, venue, mat) : mat);
      break;
    case "rock": {
      const ice = item.style === "ice";
      const material = ice ? new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.82, emissive: new THREE.Color(item.color), emissiveIntensity: 0.02 }) : mat;
      mesh(rockGeometry(item), material, { solid: true, cast: !ice });
      break;
    }
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
