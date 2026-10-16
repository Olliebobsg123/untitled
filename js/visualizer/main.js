// The 3D visualiser window: draws the theatre and every patched fixture from the
// console's DMX frames. Opened by the console (js/dmx.js), which sends it the
// patch (SYNC_FIXTURES), DMX (DMX_FRAME), the saved layout (LOAD_LAYOUT) and the
// console mode; the visualiser sends back layout changes (VIZ_LAYOUT).
//
// Mouse: drag a fixture to move it along its bar (hold Shift to move it up or
// down); drag the lens of a fixed fixture to aim it; right-drag or scroll to
// look around.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildTheatre, defaultHanging } from "./theatre.js";
import { createFixture } from "./fixture-model.js";
import { decodeFixture } from "./decode.js";

const $ = id => document.getElementById(id);
const console_ = window.opener;
const send = message => console_?.postMessage(message, "*");

// --- Scene ---

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
$("viz").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
scene.fog = new THREE.Fog(0x07080a, 45, 95);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
const HOME_VIEW = { position: [0, 7.5, 15], target: [0, 3, -5] };
camera.position.set(...HOME_VIEW.position);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...HOME_VIEW.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 70;
controls.minDistance = 2;
controls.maxPolarAngle = Math.PI * 0.495;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const theatre = buildTheatre(scene);

// --- State ---

const fixtures = new Map(); // id → fixture model
const frames = new Map(); // universe → Uint8Array(512)
let patch = [];
let library = {};
let layout = { positions: {}, rotations: {}, gridOn: true, houseOn: false, workOn: false, beamsOn: true };
let dirty = true;
let animating = false;
let selected = null;

const frameFor = universe => frames.get(universe) || new Uint8Array(512);
const universeOf = fixture => {
  const n = Number(fixture?.uni ?? fixture?.universe ?? 1);
  return Number.isInteger(n) ? n : 1;
};
const baseOf = fixture => {
  const n = Number(fixture?.addr ?? fixture?.address);
  return Number.isFinite(n) && n >= 1 && n <= 512 ? n - 1 : -1;
};
const definitionOf = fixture => library[fixture?.name] || fixture?.definition || null;

function setStatus(text) {
  $("status").textContent = text;
}

// --- Fixtures ---

function rebuild() {
  for (const model of fixtures.values()) {
    scene.remove(model.root);
    model.dispose();
  }
  fixtures.clear();
  selected = null;
  patch.forEach((fixture, index) => {
    const def = definitionOf(fixture);
    if (!def) return;
    const saved = layout.positions[String(fixture.id)];
    const model = createFixture(fixture, def, saved || defaultHanging(index, patch.length));
    scene.add(model.root);
    const aim = layout.rotations[String(fixture.id)];
    if (aim) model.setAim(aim);
    else model.aimAt(new THREE.Vector3(model.root.position.x * 0.6, 1.2, -4)); // default: down onto the stage
    fixtures.set(model.id, model);
  });
  setStatus(`${fixtures.size} fixture${fixtures.size === 1 ? "" : "s"}${patch.length > fixtures.size ? ` (${patch.length - fixtures.size} without a profile)` : ""}`);
  updateFixtures();
}

function updateFixtures() {
  animating = false;
  for (const model of fixtures.values()) {
    const base = baseOf(model.fixture);
    const decoded = base < 0
      ? { intensity: 0, rgb: [0, 0, 0], strobeRate: 0, beamAngle: 25, softness: 0.5, frost: 0, pan: null, tilt: null }
      : decodeFixture(model.def, frameFor(universeOf(model.fixture)), base, model.fixture.name);
    if (model.update(decoded, layout.beamsOn)) animating = true;
  }
  dirty = true;
}

// --- Layout (sent back to the console, which keeps it with the show) ---

let layoutTimer = null;
function layoutChanged() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => send({ type: "VIZ_LAYOUT", layout }), 150);
}

function applyLayout(next) {
  layout = { positions: {}, rotations: {}, gridOn: true, houseOn: false, workOn: false, beamsOn: true, ...(next || {}) };
  theatre.setGrid(layout.gridOn !== false);
  theatre.setHouse(Boolean(layout.houseOn));
  theatre.setWork(Boolean(layout.workOn));
  showToggles();
  rebuild();
}

// --- Buttons ---

const TOGGLES = { house: "houseOn", work: "workOn", grid: "gridOn", beams: "beamsOn" };
const TOGGLE_LABELS = { house: "House lights", work: "Work lights", grid: "Grid", beams: "Beams" };
function showToggles() {
  for (const [id, key] of Object.entries(TOGGLES)) {
    const button = $(id);
    const on = key === "gridOn" || key === "beamsOn" ? layout[key] !== false : Boolean(layout[key]);
    button.classList.toggle("on", on);
    button.textContent = `${TOGGLE_LABELS[id]}: ${on ? "on" : "off"}`;
  }
}
for (const [id, key] of Object.entries(TOGGLES)) {
  $(id).addEventListener("click", () => {
    const on = key === "gridOn" || key === "beamsOn" ? layout[key] === false : !layout[key];
    layout[key] = on;
    theatre.setGrid(layout.gridOn !== false);
    theatre.setHouse(Boolean(layout.houseOn));
    theatre.setWork(Boolean(layout.workOn));
    showToggles();
    updateFixtures();
    layoutChanged();
  });
}
$("resetView").addEventListener("click", () => {
  camera.position.set(...HOME_VIEW.position);
  controls.target.set(...HOME_VIEW.target);
  dirty = true;
});
$("resetLayout").addEventListener("click", () => {
  if (!confirm("Put every fixture back in its default place and aim?")) return;
  layout.positions = {};
  layout.rotations = {};
  rebuild();
  layoutChanged();
});

// --- Mouse: move and aim fixtures ---

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
const hit = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.2);
let drag = null; // { model, mode: "move" | "aim", vertical }

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = [];
  for (const model of fixtures.values()) targets.push(model.lens, ...model.bodies);
  const found = raycaster.intersectObjects(targets, false)[0];
  return found ? { model: fixtures.get(found.object.userData.fixtureId), aim: Boolean(found.object.userData.aimHandle) } : null;
}

function select(model) {
  selected?.setSelected(false);
  selected = model;
  selected?.setSelected(true);
  $("selection").textContent = model ? `#${model.fixture.fixtureNumber ?? "?"} ${model.fixture.name} · universe ${universeOf(model.fixture)}, address ${model.fixture.addr ?? "–"}` : "";
  dirty = true;
}

renderer.domElement.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const found = pick(event);
  if (!found) {
    select(null);
    return;
  }
  select(found.model);
  controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  if (found.aim && !found.model.moving) {
    drag = { model: found.model, mode: "aim" };
  } else {
    const vertical = event.shiftKey;
    dragPlane.setFromNormalAndCoplanarPoint(vertical ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), found.model.root.position);
    raycaster.ray.intersectPlane(dragPlane, hit);
    dragOffset.copy(found.model.root.position).sub(hit);
    drag = { model: found.model, mode: "move" };
  }
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!drag) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (drag.mode === "aim") {
    if (raycaster.ray.intersectPlane(floorPlane, hit)) layout.rotations[drag.model.id] = drag.model.aimAt(hit);
  } else if (raycaster.ray.intersectPlane(dragPlane, hit)) {
    const position = hit.add(dragOffset);
    position.y = Math.max(0.6, Math.min(14, position.y));
    drag.model.root.position.copy(position);
    layout.positions[drag.model.id] = { x: position.x, y: position.y, z: position.z };
  }
  updateFixtures();
});

const endDrag = () => {
  if (!drag) return;
  drag = null;
  controls.enabled = true;
  layoutChanged();
};
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);
window.addEventListener("keydown", event => {
  if (event.key === "Escape") select(null);
});

// --- Messages from the console ---

window.addEventListener("message", event => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  switch (message.type) {
    case "SYNC_FIXTURES":
      patch = Array.isArray(message.fixtures) ? message.fixtures : [];
      library = message.fixtureLibrary || {};
      rebuild();
      break;
    case "LOAD_LAYOUT":
      applyLayout(message.layout);
      break;
    case "DMX_FRAME":
      for (const [universe, values] of Object.entries(message.universes || {})) frames.set(Number(universe), Uint8Array.from(values));
      updateFixtures();
      break;
    case "DMX_UPDATE": // older consoles: one universe
      if (message.dmx) frames.set(1, Uint8Array.from(message.dmx));
      updateFixtures();
      break;
    case "CONSOLE_MODE":
      $("mode").hidden = message.mode !== "BLIND";
      break;
  }
});

// --- Drawing ---

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  dirty = true;
});
controls.addEventListener("change", () => { dirty = true; });

function frame() {
  requestAnimationFrame(frame);
  controls.update();
  if (animating) {
    const seconds = performance.now() / 1000;
    for (const model of fixtures.values()) model.render(seconds);
    dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
}

showToggles();
frame();
setStatus("Waiting for the console…");
send({ type: "VISUALIZER_READY" });
