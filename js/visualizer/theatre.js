// The room: built from the venue (venue.js) - the stage, the auditorium, the
// proscenium and house tabs, house and work lights, and every item in it
// (bars, drapes, scenery, speakers, seating…). Units are metres; the stage's
// front edge is at z = 0 with the audience towards +z.
//
// STAGE, ROOM, STAGE_TOP and CYC_Z follow the venue as it's edited (other
// files read them live).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { bounds, buildItem, defaultVenue, hangLines, surface } from "./venue.js";

export const STAGE = { width: 12, depth: 9, height: 1, frontZ: 0 };
export let STAGE_TOP = STAGE.height;
export let CYC_Z = -8.4;
export const ROOM = { minX: -11, maxX: 11, minY: 0, maxY: 11, minZ: -10, maxZ: 17 };

let current = defaultVenue();

export function buildTheatre(scene) {
  const solids = []; // everything a beam or a reflection can land on (kept as the same array)
  const structure = new THREE.Group(); // stage, room, proscenium
  const itemsGroup = new THREE.Group(); // the venue's items
  scene.add(structure, itemsGroup);
  const items = new Map(); // id → { group, solids }
  let structureSolids = [];
  let onChange = () => {};

  // House tabs: two halves of pleated velvet just upstage of the proscenium
  // that draw off to the sides (see buildCurtain).
  const curtain = buildCurtain(scene);

  // A faint fill so the room is never pure black (like exit signs and spill).
  scene.add(new THREE.HemisphereLight(0x8c96aa, 0x0c0c10, 0.35));
  let house = [], lamps = [], work = [];
  const lightsGroup = new THREE.Group();
  scene.add(lightsGroup);
  let grid = null;
  const switches = { house: false, work: false, grid: false };

  function collectSolids() {
    solids.length = 0;
    solids.push(...structureSolids);
    if (curtain.shown) solids.push(...curtain.meshes);
    for (const entry of items.values()) solids.push(...entry.solids);
    onChange();
  }

  function buildStructure(venue) {
    for (const child of [...structure.children]) { structure.remove(child); child.traverse(o => o.geometry?.dispose()); }
    structureSolids = [];
    const { stage, room, proscenium } = venue;
    const add = (geometry, material, position, { receive = true, cast = false, solid = true } = {}) => {
      const mesh = new THREE.Mesh(geometry, material);
      if (position) mesh.position.set(...position);
      mesh.receiveShadow = receive;
      mesh.castShadow = cast;
      structure.add(mesh);
      if (solid) structureSolids.push(mesh);
      return mesh;
    };
    // Auditorium floor, room walls and ceiling: dark, so spill and reflections read.
    const width = ROOM.maxX - ROOM.minX, length = ROOM.maxZ - ROOM.minZ, middleZ = (ROOM.maxZ + ROOM.minZ) / 2;
    add(new THREE.PlaneGeometry(width, length), surface("#16151a", "matte"), [0, 0, middleZ]).rotation.x = -Math.PI / 2;
    const wall = surface(room.color, "matte");
    const side = new THREE.PlaneGeometry(length, ROOM.maxY);
    add(side, wall, [ROOM.minX, ROOM.maxY / 2, middleZ]).rotation.y = Math.PI / 2;
    add(side, wall, [ROOM.maxX, ROOM.maxY / 2, middleZ]).rotation.y = -Math.PI / 2;
    const end = new THREE.PlaneGeometry(width, ROOM.maxY);
    add(end, wall, [0, ROOM.maxY / 2, ROOM.maxZ]).rotation.y = Math.PI;
    add(end, wall, [0, ROOM.maxY / 2, ROOM.minZ]);
    add(new THREE.PlaneGeometry(width, length), wall, [0, ROOM.maxY, middleZ]).rotation.x = Math.PI / 2;

    // Stage: black lino with a slight sheen, like a real dance floor.
    const deck = new THREE.MeshStandardMaterial({ color: stage.color, roughness: 0.55, metalness: 0 });
    if (stage.height > 0) {
      add(new THREE.BoxGeometry(stage.width, stage.height, stage.depth), deck, [0, stage.height / 2, -stage.depth / 2]);
      add(new THREE.BoxGeometry(stage.width, 0.04, 0.05), surface("#3a3a3a", "satin"), [0, stage.height + 0.005, -0.025]);
    } else {
      add(new THREE.PlaneGeometry(stage.width, stage.depth), deck, [0, 0.003, -stage.depth / 2]).rotation.x = -Math.PI / 2;
    }

    // Proscenium arch: a header and two side pieces round the opening.
    if (proscenium.show) {
      const black = surface(proscenium.color, "matte");
      const header = Math.max(0.3, ROOM.maxY - proscenium.height);
      add(new THREE.BoxGeometry(width, header, 0.3), black, [0, proscenium.height + header / 2, -0.15], { cast: true });
      const sideWidth = Math.max(0.3, (width - proscenium.width) / 2);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(sideWidth, proscenium.height, 0.3), black, [s * (proscenium.width / 2 + sideWidth / 2), proscenium.height / 2, -0.15], { cast: true });
    }

    // House lights over the audience, work lights over the stage.
    for (const child of [...lightsGroup.children]) lightsGroup.remove(child);
    house = []; work = [];
    for (const x of [-width / 4, 0, width / 4]) {
      for (const z of [ROOM.maxZ * 0.35, ROOM.maxZ * 0.7]) {
        const light = new THREE.PointLight(0xffd2a0, 0, 18, 2);
        light.position.set(x, ROOM.maxY - 0.4, z);
        lightsGroup.add(light);
        house.push(light);
        add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 16), new THREE.MeshBasicMaterial({ color: 0x222222 }), [x, ROOM.maxY - 0.02, z], { solid: false, receive: false }).userData.houseLamp = true;
      }
    }
    lamps = structure.children.filter(o => o.userData.houseLamp);
    for (const x of [-stage.width / 3, 0, stage.width / 3]) {
      const light = new THREE.SpotLight(0xf2f4ff, 0, 22, 1.0, 0.8, 2);
      light.position.set(x, Math.min(9.2, ROOM.maxY - 1.6), -stage.depth / 2 + 1);
      light.target.position.set(x * 0.8, STAGE_TOP, -stage.depth / 2);
      lightsGroup.add(light, light.target);
      work.push(light);
    }
    if (grid) scene.remove(grid);
    const size = Math.ceil(Math.max(width, length) / 2) * 2;
    grid = new THREE.GridHelper(size, size, 0x2e3440, 0x1d2129);
    grid.position.set(0, 0.005, middleZ);
    scene.add(grid);
    applySwitches();
  }

  function applySwitches() {
    // Hidden lights cost nothing; switched-off-but-visible ones still do.
    house.forEach(light => { light.intensity = 30; light.visible = switches.house; });
    lamps.forEach(lamp => lamp.material.color.set(switches.house ? 0xffe2b8 : 0x222222));
    work.forEach(light => { light.intensity = 220; light.visible = switches.work; });
    if (grid) grid.visible = switches.grid;
  }

  function buildOne(item, venue) {
    removeOne(item.id);
    const built = buildItem(item, venue, (it, asset, add) => loadModel(it, asset, object => { add(object); collectSolids(); }));
    itemsGroup.add(built.group);
    items.set(item.id, built);
    return built;
  }
  function removeOne(id) {
    const entry = items.get(id);
    if (!entry) return;
    itemsGroup.remove(entry.group);
    entry.group.traverse(o => { if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose(); });
    items.delete(id);
  }

  let structureKey = "";
  // Draw a venue. changed: just these items' ids (rebuilt, or removed if gone).
  function apply(venue, { changed = null } = {}) {
    current = venue;
    const b = bounds(venue);
    Object.assign(STAGE, b.stage);
    Object.assign(ROOM, b.room);
    STAGE_TOP = STAGE.height;
    CYC_Z = -STAGE.depth + 0.6;
    const key = JSON.stringify([venue.stage, venue.room, venue.proscenium]);
    if (key !== structureKey) { structureKey = key; buildStructure(venue); }
    curtain.fit(venue);
    if (changed) {
      for (const id of changed) {
        const item = venue.items.find(i => i.id === id);
        if (item) buildOne(item, venue); else removeOne(id);
      }
    } else {
      for (const id of [...items.keys()]) removeOne(id);
      for (const item of venue.items) buildOne(item, venue);
    }
    collectSolids();
  }

  apply(current);
  return {
    solids,
    apply,
    items,
    itemsGroup,
    venue: () => current,
    onChange(fn) { onChange = fn; },
    setHouse(on) { switches.house = on; applySwitches(); },
    setWork(on) { switches.work = on; applySwitches(); },
    setGrid(on) { switches.grid = on; applySwitches(); },
    curtain
  };
}

// --- Imported 3D models ----------------------------------------------------

const parsed = new Map(); // asset id → Promise<Object3D>
function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function parseAsset(id, asset) {
  if (!parsed.has(id)) {
    parsed.set(id, new Promise((resolve, reject) => {
      const buffer = decode(asset.data);
      if (asset.type === "glb" || asset.type === "gltf") new GLTFLoader().parse(buffer, "", gltf => resolve(gltf.scene), reject);
      else if (asset.type === "obj") resolve(new OBJLoader().parse(new TextDecoder().decode(buffer)));
      else if (asset.type === "stl") {
        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        resolve(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.7 })));
      } else reject(new Error("Unknown model type"));
    }));
  }
  return parsed.get(id);
}

// A copy of the model, sized by the item's scale, standing on its base at the
// item's origin. STL models (no colours of their own) take the item's colour.
function loadModel(item, asset, add) {
  if (!asset) return;
  parseAsset(item.assetId, asset).then(model => {
    const object = model.clone(true);
    object.scale.setScalar((asset.unit || 1) * item.scale);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const centre = box.getCenter(new THREE.Vector3());
    object.position.set(-centre.x, -box.min.y, -centre.z);
    object.traverse(o => {
      if (!o.isMesh) return;
      o.userData.sharedGeometry = true;
      if (asset.type === "stl") o.material = surface(item.color, item.material);
      else if (o.material && !o.material.isMeshStandardMaterial) {
        // Lit like everything else (OBJ files come with Phong materials).
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        o.material = new THREE.MeshStandardMaterial({ color: m.color || item.color, map: m.map || null, roughness: 0.8 });
      }
    });
    add(object);
  }).catch(error => console.warn("Couldn't load model", error));
}

// How big a model file is drawn at scale 1: files are made in metres,
// centimetres or millimetres; guessed from its size.
export async function modelUnit(id, asset) {
  const model = await parseAsset(id, asset);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const biggest = Math.max(size.x, size.y, size.z);
  return biggest > 200 ? 0.001 : biggest > 30 ? 0.01 : 1;
}

// --- House tabs -------------------------------------------------------------

function buildCurtain(scene) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x5a0710, roughness: 0.82, metalness: 0,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xb02a3a), // velvet: a soft bright rim where light skims it
    side: THREE.DoubleSide
  });
  const C = { z: -0.45, bottom: 1, top: 8.7, edge: 7.05, overlap: 0.08, gathered: 1.0, pleats: 26, segments: 104 };
  let halves = [];
  let shown = -1;
  let fitKey = "";
  const api = { meshes: [], shown: true, line: C.z - 0.3, set, get: () => shown, fit }; // behind line = behind the curtain

  // Open (1) to closed (0).
  function set(open, force = false) {
    open = Math.max(0, Math.min(1, Number(open) || 0));
    if (!force && Math.abs(open - shown) < 1e-4) return false;
    shown = open;
    const closedWidth = C.edge + C.overlap;
    const width = closedWidth + (C.gathered - closedWidth) * open;
    // Gathered fabric folds deeper; a closed curtain still hangs in soft pleats.
    const depth = 0.07 + 0.16 * open;
    for (const mesh of halves) {
      const side = mesh.userData.side;
      const position = mesh.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const u = mesh.userData.across[i] + 0.5; // 0..1 across the cloth, left to right
        const along = side < 0 ? 1 - u : u;      // 0 = leading (onstage) edge, 1 = offstage edge
        const x = side * (C.edge - (1 - along) * width);
        const fold = Math.sin(along * C.pleats * Math.PI * 2) * depth * (0.6 + 0.4 * Math.sin(along * 7.3));
        position.setX(i, x);
        position.setZ(i, C.z + fold);
      }
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeBoundingBox();
    }
    return true;
  }

  // Sized to the proscenium opening, in the venue's tab colour.
  function fit(venue) {
    const key = JSON.stringify([venue.stage.height, venue.proscenium, venue.tabs]);
    if (key === fitKey) return;
    fitKey = key;
    C.bottom = venue.stage.height;
    C.top = venue.proscenium.height + 0.3;
    C.edge = venue.proscenium.width / 2 + 1.05;
    C.pleats = Math.max(8, Math.round(venue.proscenium.width * 2.2));
    material.color.set(venue.tabs.color);
    material.sheenColor.set(venue.tabs.color).lerp(new THREE.Color(0xffffff), 0.3);
    for (const mesh of halves) { scene.remove(mesh); mesh.geometry.dispose(); }
    const height = C.top - C.bottom;
    halves = [-1, 1].map(side => {
      const geometry = new THREE.PlaneGeometry(1, height, C.segments, 1);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, C.bottom + height / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.side = side;
      mesh.userData.curtain = true;
      mesh.userData.across = Float32Array.from(geometry.attributes.position.array.filter((_, k) => k % 3 === 0));
      mesh.visible = venue.tabs.show;
      scene.add(mesh);
      return mesh;
    });
    api.meshes = halves;
    api.shown = venue.tabs.show;
    set(shown < 0 ? 1 : shown, true);
  }
  return api;
}

// --- Where lights hang ------------------------------------------------------

// Where a new fixture hangs until it is moved: spread along the over-stage
// bars from the front (up to 8 a bar), then the bars over the audience.
export function defaultHanging(index, count) {
  const lines = hangLines(current).filter(line => line.kind === "line");
  if (!lines.length) return { x: (index - (count - 1) / 2) * 0.8, y: Math.min(7, ROOM.maxY - 1), z: -2 };
  const middle = line => (line.a.z + line.b.z) / 2;
  const order = [...lines.filter(l => middle(l) <= 0).sort((p, q) => middle(q) - middle(p)), ...lines.filter(l => middle(l) > 0).sort((p, q) => middle(p) - middle(q))];
  const PER_BAR = 8;
  const barIndex = Math.min(order.length - 1, Math.floor(index / PER_BAR));
  const line = order[barIndex];
  const onThisBar = barIndex === order.length - 1 ? Math.max(1, count - barIndex * PER_BAR) : Math.min(PER_BAR, count - barIndex * PER_BAR);
  const slot = index - barIndex * PER_BAR;
  // Centred, up to 1.3m apart.
  const length = line.a.distanceTo(line.b);
  const spacing = Math.min(1.3, length / Math.max(1, onThisBar - 1));
  const offset = (slot - (onThisBar - 1) / 2) * spacing;
  const p = line.a.clone().lerp(line.b, 0.5 + offset / Math.max(1e-6, length));
  return { x: p.x, y: p.y, z: p.z };
}

// Snap a dragged fixture onto the nearest bar, truss or boom when it's close to one.
export function snapToBar(position) {
  const p = new THREE.Vector3(position.x, position.y, position.z);
  let best = null;
  for (const line of hangLines(current)) {
    const ab = line.b.clone().sub(line.a);
    const t = Math.max(0, Math.min(1, p.clone().sub(line.a).dot(ab) / ab.lengthSq()));
    const on = line.a.clone().addScaledVector(ab, t);
    if (line.kind === "upright") {
      // A boom: clamped beside it, at whatever height the light was dragged to.
      const flat = Math.hypot(p.x - on.x, p.z - on.z);
      if (flat < 0.6 && (!best || flat < best.d)) best = { d: flat, point: { x: on.x, y: Math.max(line.a.y, Math.min(line.b.y, p.y)), z: on.z + 0.12 } };
    } else {
      const d = on.distanceTo(p);
      if (d < 0.5 && (!best || d < best.d)) best = { d, point: { x: on.x, y: on.y, z: on.z } };
    }
  }
  return best ? best.point : position;
}

// Is a fixture at this spot hanging on this item? (So it moves with it.)
export function hangsOn(item, position) {
  const line = hangLines({ items: [item] })[0];
  if (!line) return false;
  const p = new THREE.Vector3(position.x, position.y, position.z);
  const ab = line.b.clone().sub(line.a);
  const t = p.clone().sub(line.a).dot(ab) / ab.lengthSq();
  if (t < -0.15 || t > 1.15) return false;
  const on = line.a.clone().addScaledVector(ab, Math.max(0, Math.min(1, t)));
  return line.kind === "upright" ? Math.hypot(p.x - on.x, p.z - on.z) < 0.35 : on.distanceTo(p) < 0.35;
}
