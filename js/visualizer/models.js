// Fixture bodies, modelled on the real things: finned LED pars, fresnels
// with ring lenses and barn doors, profiles with shutter handles, moving
// heads with a base, rounded yoke arms and a capsule head, LED bars, strobes,
// blinders and fog machines. Sizes follow the real models.
//
// Each body is built from simple shapes and then merged into one mesh per
// material for each moving part (base, yoke, head), so a whole fixture is a
// handful of draw calls.
//
// Layout: the root sits on the bar at the clamp. The yoke turns around the
// vertical (pan); the head tilts at the pivot, `drop` below the yoke; the
// lens faces the head's +Z.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Shared materials (never disposed per fixture).
export const MATERIALS = {
  body: new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.55, metalness: 0.25 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85, metalness: 0.05 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.35, metalness: 0.65 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.32, metalness: 0.9 }),
  screen: new THREE.MeshBasicMaterial({ color: 0x1d4f8f })
};

// Collects shapes per material, then merges them.
class Part {
  constructor() {
    this.shapes = new Map();
  }
  add(material, geometry, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!this.shapes.has(material)) this.shapes.set(material, []);
    this.shapes.get(material).push(g);
    return this;
  }
  build() {
    const group = new THREE.Group();
    for (const [material, geometries] of this.shapes) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries, false), MATERIALS[material]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

const rbox = (w, h, d, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (r1, r2, length, segments = 24) => new THREE.CylinderGeometry(r1, r2, length, segments).rotateX(Math.PI / 2);
const cylX = (r, length, segments = 18) => new THREE.CylinderGeometry(r, r, length, segments).rotateZ(Math.PI / 2);
// A turned shape around the Z axis from [radius, z] points.
const latheZ = (points, segments = 28) => new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), segments).rotateX(Math.PI / 2);
const handle = (radius, tube) => new THREE.TorusGeometry(radius, tube, 8, 18, Math.PI);

// --- Lens textures ------------------------------------------------------------

const lensCache = new Map();
function lensTexture(kind) {
  if (lensCache.has(kind)) return lensCache.get(kind);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 256);
  const dot = (x, y, r, fill = "#fff") => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  if (kind === "led") {
    // Hex grid of LED emitters with lenslets.
    for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
      const x = 28 + col * 25 + (row % 2) * 12.5, y = 28 + row * 25;
      if ((x - 128) ** 2 + (y - 128) ** 2 > 112 ** 2) continue;
      dot(x, y, 10, "#555"); dot(x, y, 6);
    }
  } else if (kind === "pods") {
    // Wash: big lens pods with a bright centre.
    const pods = [[128, 128]];
    for (let i = 0; i < 6; i++) pods.push([128 + Math.cos((i * Math.PI) / 3) * 62, 128 + Math.sin((i * Math.PI) / 3) * 62]);
    for (let i = 0; i < 12; i++) pods.push([128 + Math.cos((i * Math.PI) / 6 + 0.26) * 108, 128 + Math.sin((i * Math.PI) / 6 + 0.26) * 108]);
    for (const [x, y] of pods) {
      const grad = g.createRadialGradient(x, y, 0, x, y, 22);
      grad.addColorStop(0, "#fff"); grad.addColorStop(0.35, "#bbb"); grad.addColorStop(1, "#111");
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === "fresnel") {
    // Stepped fresnel rings, brightest in the middle.
    for (let r = 124; r > 0; r -= 9) {
      const grad = g.createRadialGradient(128, 128, Math.max(0, r - 9), 128, 128, r);
      const k = 1 - r / 140;
      grad.addColorStop(0, `rgba(255,255,255,${0.55 + 0.45 * k})`);
      grad.addColorStop(1, `rgba(255,255,255,${0.3 * k + 0.25})`);
      g.fillStyle = grad; g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === "tube") {
    // Strobe: a xenon tube in a reflector.
    const grad = g.createLinearGradient(0, 96, 0, 160);
    grad.addColorStop(0, "#222"); grad.addColorStop(0.5, "#fff"); grad.addColorStop(1, "#222");
    g.fillStyle = grad; g.fillRect(10, 96, 236, 64);
  } else if (kind === "lamps") {
    // Strip of round reflector cups (Sunstrip-style).
    for (let i = 0; i < 10; i++) { const x = 13 + i * 25.5; const grad = g.createRadialGradient(x, 128, 0, x, 128, 12); grad.addColorStop(0, "#fff"); grad.addColorStop(0.5, "#999"); grad.addColorStop(1, "#111"); g.fillStyle = grad; g.beginPath(); g.arc(x, 128, 12, 0, Math.PI * 2); g.fill(); }
  } else {
    // Plain lens: bright with a soft falloff to the rim.
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.7, "#ddd"); grad.addColorStop(1, "#555");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  lensCache.set(kind, texture);
  return texture;
}

function lensMesh(geometry, kind, repeat = 1) {
  const map = lensTexture(kind);
  const material = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.08, metalness: 0, emissive: 0x000000, emissiveMap: repeat > 1 ? map.clone() : map });
  if (repeat > 1) {
    material.emissiveMap.wrapS = THREE.RepeatWrapping;
    material.emissiveMap.repeat.set(repeat, 1);
    material.emissiveMap.needsUpdate = true;
  }
  return new THREE.Mesh(geometry, material);
}

// --- Yokes and clamps ------------------------------------------------------

// A hook clamp round the pipe, and a flat U bracket down to the tilt pivot.
function clampPart(part) {
  part.add("metal", rbox(0.05, 0.075, 0.06, 0.008), [0, 0.0, 0]);
  part.add("metal", cylZ(0.008, 0.008, 0.09, 10), [0, 0.02, 0]);
  part.add("dark", cylX(0.014, 0.03, 12), [0.035, -0.02, 0]);
  return part;
}

function bracket(part, span, drop, { width = 0.04, thick = 0.012, knob = 0.022 } = {}) {
  part.add("body", box(span + thick * 2, thick, width), [0, -0.035, 0]);
  for (const side of [-1, 1]) {
    part.add("body", box(thick, drop, width), [(side * (span + thick)) / 2, -0.035 - drop / 2, 0]);
    part.add("dark", cylX(knob, 0.025, 16), [side * (span / 2 + thick + 0.012), -0.035 - drop, 0]);
  }
  return part;
}

// --- Bodies ------------------------------------------------------------------

function scaleFor(kind, name) {
  const n = name.toLowerCase();
  if (kind.startsWith("moving")) {
    if (/phantom 50|spot 60|wipe 100|home fixture|generic/.test(n)) return 0.72;
    if (/phantom 130|wipe 150|230|wash 120/.test(n)) return 0.92;
    if (/7r|9r|12r|17r|wash 280|350/.test(n)) return 1.12;
    if (/solaframe|vl3000|cyberlight|colorwash 1200/.test(n)) return 1.32;
    return 1;
  }
  if (kind === "par") {
    if (/par 7|helix s50|generic rgb\b/.test(n)) return 0.82;
    if (/par 64|54x3|18x12|2000/.test(n)) return 1.15;
    return 1;
  }
  return 1;
}

function parBody(s, led) {
  const head = new Part();
  head.add("body", latheZ([[0, -0.1], [0.05, -0.104], [0.08, -0.096], [0.092, -0.07], [0.1, 0.03], [0.106, 0.055], [0.1, 0.068], [0.09, 0.068]].map(([r, z]) => [r * s, z * s])));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    head.add("body", box(0.004 * s, 0.024 * s, 0.075 * s), [Math.cos(a) * 0.1 * s, Math.sin(a) * 0.1 * s, -0.045 * s], [0, 0, a + Math.PI / 2]);
  }
  head.add("trim", new THREE.TorusGeometry(0.096 * s, 0.007 * s, 8, 32), [0, 0, 0.066 * s]);
  head.add("dark", box(0.06 * s, 0.03 * s, 0.01 * s), [0, -0.05 * s, -0.103 * s]);
  const lens = lensMesh(new THREE.CircleGeometry(0.088 * s, 32), led ? "led" : "plain");
  lens.position.z = 0.069 * s;
  return { head, lens, lensRadius: 0.088 * s, lensZ: 0.069 * s, drop: 0.16 * s, span: 0.24 * s };
}

function fresnelBody(led) {
  const head = new Part();
  head.add("body", rbox(0.3, 0.3, 0.3, 0.03), [0, 0, -0.03]);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) head.add("dark", box(0.004, 0.012, 0.2), [side * 0.151, -0.08 + i * 0.04, -0.03]);
  for (let i = 0; i < 5; i++) head.add("dark", box(0.2, 0.004, 0.012), [0, 0.151, -0.12 + i * 0.04]);
  head.add("trim", rbox(0.32, 0.32, 0.03, 0.01), [0, 0, 0.13]);
  head.add("metal", box(0.31, 0.012, 0.01), [0, 0.15, 0.15]);
  head.add("metal", box(0.31, 0.012, 0.01), [0, -0.15, 0.15]);
  head.add("metal", handle(0.07, 0.008), [0, 0.15, -0.03], [Math.PI / 2, 0, 0]);
  head.add("dark", cylZ(0.018, 0.018, 0.04, 14), [0, -0.165, 0.02], [Math.PI / 2, 0, 0]);
  const lens = lensMesh(new THREE.CircleGeometry(0.12, 40), led ? "led" : "fresnel");
  lens.position.z = 0.146;
  return { head, lens, lensRadius: 0.12, lensZ: 0.146, drop: 0.25, span: 0.36, knob: 0.034 };
}

function profileBody() {
  const head = new Part();
  head.add("body", rbox(0.2, 0.24, 0.24, 0.02), [0, 0, -0.2]);
  for (let i = 0; i < 6; i++) head.add("dark", box(0.004, 0.18, 0.012), [0.101, 0, -0.29 + i * 0.035]);
  head.add("metal", handle(0.06, 0.007), [0, 0.12, -0.2], [Math.PI / 2, 0, 0]);
  head.add("body", rbox(0.17, 0.17, 0.08, 0.01), [0, 0, -0.045]);
  // Shutter handles sticking out of the gate.
  [[0.1, 0, 0, Math.PI / 2], [-0.1, 0, 0, Math.PI / 2], [0, 0.1, 0, 0], [0, -0.1, 0, 0]].forEach(([x, y, , rz], i) => {
    head.add("metal", new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6), [x * 1.2, y * 1.2, -0.045 + (i % 2) * 0.012], [0, 0, rz]);
    head.add("dark", new THREE.SphereGeometry(0.01, 8, 6), [x * 1.55, y * 1.55, -0.045 + (i % 2) * 0.012]);
  });
  head.add("body", latheZ([[0.07, -0.005], [0.075, 0.1], [0.082, 0.3], [0.09, 0.36], [0.086, 0.372]]));
  head.add("trim", new THREE.TorusGeometry(0.086, 0.006, 8, 32), [0, 0, 0.365]);
  head.add("dark", cylZ(0.012, 0.012, 0.03, 12), [0, -0.085, 0.12], [Math.PI / 2, 0, 0]);
  head.add("dark", cylZ(0.012, 0.012, 0.03, 12), [0, -0.088, 0.24], [Math.PI / 2, 0, 0]);
  head.add("metal", box(0.2, 0.2, 0.006), [0, 0, 0.38]);
  const lens = lensMesh(new THREE.CircleGeometry(0.078, 32), "plain");
  lens.position.z = 0.373;
  return { head, lens, lensRadius: 0.078, lensZ: 0.373, drop: 0.2, span: 0.28 };
}

function movingBody(kind, s) {
  const wash = kind === "movingWash";
  const beam = kind === "movingBeam";
  const base = new Part();
  // Base (hung upside down under the clamp): body, display, handles, omega plate.
  const bw = 0.38 * s, bh = 0.15 * s, bd = 0.3 * s;
  base.add("metal", box(0.3 * s, 0.008, 0.06), [0, -0.012, 0]);
  base.add("body", rbox(bw, bh, bd, 0.03 * s), [0, -0.02 - bh / 2, 0]);
  base.add("dark", rbox(0.07 * s, 0.05 * s, 0.03 * s, 0.01), [0, -0.02 - bh / 2, bd / 2 + 0.008]);
  for (const side of [-1, 1]) base.add("dark", rbox(0.02, 0.04 * s, 0.16 * s, 0.008), [side * (bw / 2 + 0.008), -0.02 - bh / 2, 0]);
  base.add("screen", new THREE.PlaneGeometry(0.06 * s, 0.03 * s), [0, -0.02 - bh / 2, bd / 2 + 0.0245]);
  const baseDrop = 0.02 + bh;

  // Head: a rounded capsule, wider and shorter for a wash, slim for a beam.
  const r = (wash ? 0.15 : beam ? 0.105 : 0.125) * s;
  const back = (wash ? 0.1 : 0.17) * s;
  const front = (wash ? 0.12 : beam ? 0.2 : 0.16) * s;
  const lensR = (wash ? 0.13 : beam ? 0.05 : 0.085) * s;
  const head = new Part();
  head.add("body", latheZ([[0.001, -back], [r * 0.45, -back * 0.98], [r * 0.8, -back * 0.8], [r, -back * 0.45], [r, front * 0.55], [beam ? r * 0.75 : r * 0.98, front * 0.9], [beam ? lensR * 1.5 : r * 0.92, front]], 32));
  head.add("trim", new THREE.TorusGeometry(beam ? lensR * 1.35 : r * 0.9, 0.008 * s, 8, 32), [0, 0, front - 0.004]);
  head.add("dark", new THREE.CircleGeometry(beam ? lensR * 1.4 : r * 0.9, 32), [0, 0, front - 0.003]);
  for (const side of [-1, 1]) head.add("trim", cylX(0.055 * s, 0.03 * s, 20), [side * (r + 0.015 * s), 0, 0]);
  head.add("dark", box(0.004, r * 0.8, back * 0.6), [r * 0.995, 0, -back * 0.4]);
  head.add("dark", box(0.004, r * 0.8, back * 0.6), [-r * 0.995, 0, -back * 0.4]);
  const lens = lensMesh(new THREE.CircleGeometry(lensR, 32), wash ? "pods" : "plain");
  lens.position.z = front;

  // Yoke: rounded arms from a turntable to the tilt hubs.
  const armSpan = r * 2 + 0.06 * s;
  const armLen = r + 0.11 * s;
  const yoke = new Part();
  yoke.add("trim", cylZ(0.1 * s, 0.1 * s, 0.02, 28), [0, -0.01, 0], [Math.PI / 2, 0, 0]);
  yoke.add("body", rbox(armSpan + 0.06 * s, 0.05 * s, 0.13 * s, 0.02 * s), [0, -0.045 * s, 0]);
  for (const side of [-1, 1]) {
    yoke.add("body", rbox(0.055 * s, armLen, 0.13 * s, 0.022 * s), [(side * (armSpan + 0.0)) / 2 + side * 0.012 * s, -0.045 * s - armLen / 2, 0]);
    yoke.add("dark", box(0.004, armLen * 0.6, 0.06 * s), [(side * armSpan) / 2 + side * 0.04 * s, -0.045 * s - armLen / 2, 0]);
  }
  return { base, yoke, head, lens, lensRadius: lensR, lensZ: front + 0.001, drop: 0.045 * s + armLen, baseDrop };
}

function barBody(name) {
  const lamps = /sunstrip/i.test(name);
  const head = new Part();
  head.add("body", rbox(1.0, 0.09, 0.11, 0.015));
  for (const side of [-1, 1]) head.add("trim", rbox(0.02, 0.1, 0.12, 0.006), [side * 0.505, 0, 0]);
  head.add("dark", box(0.96, 0.068, 0.004), [0, 0, 0.055]);
  const lens = lensMesh(new THREE.PlaneGeometry(0.94, lamps ? 0.06 : 0.05), lamps ? "lamps" : "led", lamps ? 1 : 12);
  lens.position.z = 0.058;
  return { head, lens, lensRadius: 0.035, lensZ: 0.058, drop: 0.13, span: 1.04 };
}

function strobeBody() {
  const head = new Part();
  head.add("body", rbox(0.52, 0.2, 0.16, 0.02));
  head.add("trim", rbox(0.48, 0.15, 0.01, 0.005), [0, 0, 0.08]);
  for (let i = 0; i < 9; i++) head.add("dark", box(0.004, 0.14, 0.004), [-0.2 + i * 0.05, 0, 0.088]);
  const lens = lensMesh(new THREE.PlaneGeometry(0.44, 0.12), "tube");
  lens.position.z = 0.086;
  return { head, lens, lensRadius: 0.08, lensZ: 0.086, drop: 0.17, span: 0.56 };
}

function blinderBody() {
  const head = new Part();
  head.add("body", rbox(0.5, 0.25, 0.15, 0.02));
  for (const x of [-0.12, 0.12]) {
    head.add("trim", latheZ([[0.03, 0.0], [0.09, 0.06], [0.1, 0.075]], 24), [x, 0, 0.0]);
    head.add("trim", new THREE.TorusGeometry(0.1, 0.006, 6, 24), [x, 0, 0.077]);
  }
  const twin = mergeGeometries([new THREE.CircleGeometry(0.095, 28).translate(-0.12, 0, 0), new THREE.CircleGeometry(0.095, 28).translate(0.12, 0, 0)], false);
  const lens = lensMesh(twin, "plain");
  lens.position.z = 0.07;
  return { head, lens, lensRadius: 0.1, lensZ: 0.07, drop: 0.2, span: 0.54 };
}

function machineBody(kind) {
  const hazer = kind === "hazer";
  const head = new Part();
  const h = hazer ? 0.34 : 0.26;
  head.add("body", rbox(0.48, h, 0.32, 0.03), [0, h / 2 + 0.02, 0]);
  head.add("metal", handle(0.1, 0.01), [0, h + 0.02, 0], [0, 0, 0]);
  for (const x of [-0.2, 0.2]) for (const z of [-0.12, 0.12]) head.add("dark", box(0.04, 0.02, 0.04), [x, 0.01, z]);
  if (hazer) head.add("dark", new THREE.CircleGeometry(0.1, 24), [0, h / 2 + 0.02, 0.161]);
  else head.add("metal", cylZ(0.022, 0.03, 0.08, 14), [0, h * 0.45, 0.2]);
  head.add("screen", new THREE.PlaneGeometry(0.08, 0.04), [0.15, h * 0.7, 0.1605]);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  lens.position.set(0, h * 0.45, 0.241);
  return { head, lens, lensRadius: 0.02, lensZ: 0.241, nozzleY: h * 0.45, drop: 0, onFloor: true };
}

// Build the body for one fixture. Returns three.js groups to hang on the
// fixture's root / yoke / head, plus lens and geometry facts.
export function buildModel(kind, def, name = "") {
  const led = ["rgb", "rgbw", "rgbal", "rgbalc", "bar", "wash"].includes(def?.type) || /led/i.test(name);
  let body;
  switch (kind) {
    case "movingSpot":
    case "movingWash":
    case "movingBeam": body = movingBody(kind, scaleFor(kind, name)); break;
    case "fresnel": body = fresnelBody(led && !/tungsten/i.test(name)); break;
    case "profile": body = profileBody(); break;
    case "bar": body = barBody(name); break;
    case "strobe": body = strobeBody(); break;
    case "blinder": body = blinderBody(); break;
    case "fogger":
    case "hazer": body = machineBody(kind); break;
    default: body = parBody(scaleFor("par", name), led);
  }

  const result = { ...body, kind };
  result.head = body.head.build();
  result.head.add(body.lens);
  if (body.onFloor) return result;

  const clamp = clampPart(new Part());
  if (body.base) {
    body.base.add("metal", rbox(0.05, 0.075, 0.06, 0.008), [0, 0.0, 0]);
    result.base = body.base.build();
    result.yoke = body.yoke.build();
    result.yokeY = -body.baseDrop;
  } else {
    result.base = clamp.build();
    result.yoke = bracket(new Part(), body.span, body.drop, { knob: body.knob || 0.022 }).build();
    result.yokeY = -0.03;
    result.drop = body.drop + 0.035;
  }
  return result;
}
