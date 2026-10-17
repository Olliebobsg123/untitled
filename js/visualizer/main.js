// The 3D visualiser window.
//
// The console (js/dmx.js, js/visualizer-link.js) sends the patch
// (SYNC_FIXTURES), DMX for every universe (DMX_UPDATE), the saved layout
// (LOAD_LAYOUT) and the console mode. This window sends back every layout
// change (VIZ_LAYOUT), which the console keeps with the show.
//
// Rendering: the stage is drawn first (keeping its depth); then the beams
// are traced through the haze at half resolution against that depth; then
// the two are added together, given a gentle bloom and tone mapped.
//
// Mouse: drag a fixture to move it (it snaps under the nearest bar; hold
// Shift to move up/down, Alt to place it freely). Select a fixed fixture and
// drag its green handle to aim it. Left-drag the empty room to orbit,
// right-drag to pan, scroll to zoom.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildTheatre, defaultHanging, snapToBar, STAGE, STAGE_TOP } from "./theatre.js";
import { Fixture } from "./fixture-model.js";
import { MirrorBall } from "./mirror-ball.js";
import { Atmosphere } from "./atmosphere.js";
import { archetype, baseAddress, decodeFixture } from "./decode.js";

const $ = id => document.getElementById(id);
const consoleWindow = window.opener;
const send = message => { try { consoleWindow?.postMessage(message, "*"); } catch (_) {} };

// Brightness calibration: candela → scene units, and beam scattering.
const LIGHT_SCALE = 0.1;
const BEAM_SCALE = 0.0007;
let beamResolution = 0.5; // lowered automatically if the frame rate drops
const SHADOW_BUDGET = 8;

const VIEWS = {
  foh: { position: [0, 6.2, 15.5], target: [0, 2.4, -4] },
  close: { position: [0, 2.4, 5.5], target: [0, 3.2, -5] },
  top: { position: [0, 21, -3.2], target: [0, 0, -3.4] },
  side: { position: [-8.5, 6, 4], target: [0, 2.8, -4] }
};
const DEFAULT_SETTINGS = { house: false, work: false, grid: false, beams: true, haze: 0.55 };

// --- Renderer and scene -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn only when a light moves (see shadowsDirty)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.setClearColor(0x000000, 1);
$("viz").appendChild(renderer.domElement);

const scene = new THREE.Scene();
const beamScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 120);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 45;
controls.minDistance = 1.5;
controls.maxPolarAngle = Math.PI * 0.49;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const size = () => renderer.getDrawingBufferSize(new THREE.Vector2());
const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
const beamTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

const shared = {
  scene,
  beamScene,
  camera,
  envMap,
  solids: [],
  shadowsDirty: true,
  lightScale: LIGHT_SCALE,
  beamScale: BEAM_SCALE,
  uniforms: {
    haze: { value: 0.5 },
    time: { value: 0 },
    depth: { value: sceneTarget.depthTexture },
    resolution: { value: new THREE.Vector2(1, 1) },
    projectionInverse: { value: camera.projectionMatrixInverse }
  }
};

const theatre = buildTheatre(scene);
shared.solids = theatre.solids;
const atmosphere = new Atmosphere(shared);

const composer = new EffectComposer(renderer);
const composite = new ShaderPass({
  uniforms: { tScene: { value: null }, tBeams: { value: null } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform sampler2D tScene; uniform sampler2D tBeams; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tScene, vUv).rgb + texture2D(tBeams, vUv).rgb, 1.0); }"
}, null);
// Set after construction: ShaderPass copies its uniforms, and render-target
// textures can't be copied.
composite.uniforms.tScene.value = sceneTarget.texture;
composite.uniforms.tBeams.value = beamTarget.texture;
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.85);
composer.addPass(composite);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const { x, y } = size();
  sceneTarget.setSize(x, y);
  const bx = Math.max(1, Math.round(x * beamResolution));
  const by = Math.max(1, Math.round(y * beamResolution));
  beamTarget.setSize(bx, by);
  shared.uniforms.resolution.value.set(bx, by);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(x, y);
  atmosphere.setViewportHeight(y, camera.fov);
}
window.addEventListener("resize", resize);

// --- State ----------------------------------------------------------------

let library = {};
let patch = [];
let patchSignature = "";
let layout = { version: 2, positions: {}, aims: {}, settings: { ...DEFAULT_SETTINGS } };
let dmx = new Uint8Array(5120);
const fixtures = new Map(); // id → Fixture
let ball = null; // { model: MirrorBall, fixture }
let selected = null;

const settings = () => ({ ...DEFAULT_SETTINGS, ...layout.settings });
const definitionOf = fixture => library[fixture?.name] || fixture?.definition || null;

function setStatus(text) { $("status").textContent = text; }

function applySettings() {
  const s = settings();
  theatre.setHouse(s.house);
  theatre.setWork(s.work);
  theatre.setGrid(s.grid);
  for (const [id, key] of [["house", "house"], ["work", "work"], ["grid", "grid"], ["beams", "beams"]]) $(id).classList.toggle("on", Boolean(s[key]));
  $("haze").value = String(Math.round(s.haze * 100));
  $("hazeValue").textContent = `${Math.round(s.haze * 100)}%`;
}

// --- Building the rig -----------------------------------------------------

function defaultFloorSpot(index) {
  const spots = [[-5, -1.2], [5, -1.2], [-5, -7.5], [5, -7.5]];
  const [x, z] = spots[index % spots.length];
  return { x, y: STAGE_TOP, z };
}

function defaultAim(position) {
  if (position.z > 2) return new THREE.Vector3(position.x * 0.6, STAGE_TOP + 1.2, -2);
  return new THREE.Vector3(position.x * 0.85, STAGE_TOP, Math.min(position.z + 1.5, -0.5));
}

function rebuild() {
  for (const model of fixtures.values()) model.dispose();
  fixtures.clear();
  if (ball) { ball.model.dispose(); ball = null; }
  select(null);

  const entries = patch.map(fixture => ({ fixture, def: definitionOf(fixture) })).filter(e => e.def);
  const hung = entries.filter(e => !["fogger", "hazer", "mirrorBall"].includes(archetype(e.def, e.fixture.name)));
  let floorIndex = 0;
  let shadows = 0;
  // Shadows (needed for gobo projection) go to fixtures that can shape light first.
  const wantsShadow = e => { const m = e.def.map || {}; return Number.isInteger(m.gobo) || Number.isInteger(m.shutter1Insert) || ["profile", "fresnel", "movingSpot"].includes(archetype(e.def, e.fixture.name)); };
  const shadowed = new Set([...hung.filter(wantsShadow), ...hung.filter(e => !wantsShadow(e))].slice(0, SHADOW_BUDGET).map(e => String(e.fixture.id)));

  for (const { fixture, def } of entries) {
    const id = String(fixture.id);
    const kind = archetype(def, fixture.name);
    const saved = layout.positions[id];
    if (kind === "mirrorBall") {
      if (ball) continue; // one ball in the room
      ball = { model: new MirrorBall(shared), fixture };
      ball.model.place(saved || { x: 0, y: 6.4, z: -2.6 });
      ball.model.group.traverse(o => { o.userData.fixtureId = id; });
      continue;
    }
    const model = new Fixture(fixture, def, shared, { castShadow: shadowed.has(id) });
    if (shadowed.has(id)) shadows++;
    const position = saved || (model.onFloor ? defaultFloorSpot(floorIndex++) : defaultHanging(hung.findIndex(e => e.fixture === fixture), hung.length));
    const aim = layout.aims[id];
    model.target.copy(aim ? new THREE.Vector3(aim.x, aim.y, aim.z) : model.onFloor ? new THREE.Vector3(0, STAGE_TOP, -4) : defaultAim(position));
    model.place(position);
    fixtures.set(id, model);
  }
  shared.shadowsDirty = true;
  const missing = patch.length - entries.length;
  setStatus(`${fixtures.size + (ball ? 1 : 0)} fixture${fixtures.size + (ball ? 1 : 0) === 1 ? "" : "s"}${missing ? ` · ${missing} without a profile` : ""}`);
}

// Positions and aims of everything, so adding a fixture later never moves the others.
function saveLayout() {
  for (const [id, model] of fixtures) {
    const p = model.root.position;
    layout.positions[id] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
    if (!model.moving) layout.aims[id] = { x: +model.target.x.toFixed(3), y: +model.target.y.toFixed(3), z: +model.target.z.toFixed(3) };
  }
  if (ball) {
    const p = ball.model.group.position;
    layout.positions[String(ball.fixture.id)] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
  }
  send({ type: "VIZ_LAYOUT", layout: JSON.parse(JSON.stringify(layout)) });
}

// --- Per-frame update -----------------------------------------------------

const clock = new THREE.Clock();
const stageLight = new THREE.Color();
let frames = 0;
let fpsTime = 0;

function update() {
  const dt = Math.min(0.1, clock.getDelta());
  const time = clock.elapsedTime;
  shared.uniforms.time.value = time;
  const s = settings();
  const machines = [];
  const lights = [];
  stageLight.setRGB(0, 0, 0);

  for (const model of fixtures.values()) {
    const base = baseAddress(model.fixture);
    const state = decodeFixture(model.def, dmx, base, model.fixture.name, model.fixture.manualShutters);
    if (base < 0) state.intensity = 0;
    const fog = model.update(state, time, dt, s);
    if (model.onFloor) {
      model.root.updateMatrixWorld(true);
      const nozzle = model.head.localToWorld(model.lensLocal.clone());
      machines.push({ kind: model.kind, output: base < 0 ? 0 : fog, nozzle, direction: model.head.getWorldDirection(new THREE.Vector3()) });
    } else if (model.state?.level > 0) {
      lights.push({ ...model.state, lensRadius: model.lensRadius });
      const k = Math.min(0.08, (model.state.candela * LIGHT_SCALE) / 4000);
      stageLight.r += model.state.rgb[0] * k;
      stageLight.g += model.state.rgb[1] * k;
      stageLight.b += model.state.rgb[2] * k;
    }
  }
  if (s.work) stageLight.r += 0.05, stageLight.g += 0.05, stageLight.b += 0.055;
  const haze = atmosphere.update(dt, machines, s.haze, stageLight);
  shared.uniforms.haze.value = haze;
  if (ball) {
    const state = decodeFixture(definitionOf(ball.fixture), dmx, baseAddress(ball.fixture), ball.fixture.name);
    ball.model.update(dt, state.speed, lights, haze);
  }
  if (selected) showSelection();

  frames++;
  fpsTime += dt;
  if (fpsTime > 1) {
    const fps = frames / fpsTime;
    $("fps").textContent = `${Math.round(fps)} fps`;
    adjustQuality(fps);
    frames = 0;
    fpsTime = 0;
  }
}

// Keep it smooth: trace beams at a lower resolution when the GPU is struggling,
// and go back up when there's headroom.
let slowSeconds = 0;
let fastSeconds = 0;
function adjustQuality(fps) {
  slowSeconds = fps < 24 ? slowSeconds + 1 : 0;
  fastSeconds = fps > 50 ? fastSeconds + 1 : 0;
  let next = beamResolution;
  if (slowSeconds >= 3 && beamResolution > 0.26) next = beamResolution - 0.12;
  if (fastSeconds >= 5 && beamResolution < 0.5) next = beamResolution + 0.12;
  if (next !== beamResolution) {
    beamResolution = Math.round(next * 100) / 100;
    slowSeconds = fastSeconds = 0;
    resize();
  }
}

function render() {
  controls.update();
  update();
  if (shared.shadowsDirty) {
    renderer.shadowMap.needsUpdate = true;
    shared.shadowsDirty = false;
  }
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(beamTarget);
  renderer.render(beamScene, camera);
  renderer.setRenderTarget(null);
  composer.render();
}

// --- Selection and dragging ------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
let drag = null; // { kind: "move"|"aim", id, vertical }

const handle = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshBasicMaterial({ color: 0x19d6a3, depthTest: false, transparent: true, opacity: 0.9 }));
handle.renderOrder = 10;
handle.visible = false;
scene.add(handle);
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x19d6a3, dashSize: 0.15, gapSize: 0.1, depthTest: false, transparent: true }));
aimLine.renderOrder = 10;
aimLine.visible = false;
scene.add(aimLine);

function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

function pickables() {
  const list = [];
  for (const model of fixtures.values()) list.push(...model.parts, model.lens);
  if (ball) list.push(ball.model.ball);
  return list;
}

function modelFor(id) {
  if (fixtures.has(id)) return fixtures.get(id);
  if (ball && String(ball.fixture.id) === id) return ball.model;
  return null;
}

function select(id) {
  if (selected && fixtures.get(selected)) fixtures.get(selected).setSelected(false);
  selected = id;
  const model = id ? fixtures.get(id) : null;
  model?.setSelected(true);
  handle.visible = aimLine.visible = Boolean(model && !model.moving && !model.onFloor);
  $("selection").hidden = !id;
  if (id) showSelection();
}

function showSelection() {
  const model = fixtures.get(selected);
  const fixture = model?.fixture || (ball && String(ball.fixture.id) === selected ? ball.fixture : null);
  if (!fixture) return;
  const level = model?.state ? Math.round(model.state.level * 100) : null;
  const rgb = model?.state?.rgb;
  $("selName").textContent = `#${fixture.fixtureNumber ?? "?"} ${fixture.name}`;
  $("selPatch").textContent = baseAddress(fixture) >= 0 ? `Universe ${fixture.uni ?? 1} · address ${fixture.addr}` : "Not on DMX";
  $("selLevel").textContent = level == null ? "" : `${level}%`;
  $("selSwatch").style.background = rgb ? `rgb(${rgb.map(v => Math.round(Math.pow(v, 1 / 2.2) * 255)).join(",")})` : "transparent";
  if (handle.visible) {
    handle.position.copy(model.target);
    const from = model.head.getWorldPosition(new THREE.Vector3());
    aimLine.geometry.setFromPoints([from, model.target]);
    aimLine.computeLineDistances();
  }
}

renderer.domElement.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  setPointer(event);
  if (handle.visible && raycaster.intersectObject(handle, false).length) {
    drag = { kind: "aim", id: selected };
  } else {
    const hit = raycaster.intersectObjects(pickables(), false)[0];
    const id = hit?.object.userData.fixtureId;
    if (!id) { select(null); return; }
    select(id);
    const model = modelFor(id);
    const root = model.root;
    const vertical = event.shiftKey;
    const normal = vertical ? camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate() : new THREE.Vector3(0, 1, 0);
    dragPlane.setFromNormalAndCoplanarPoint(normal, root.position);
    raycaster.ray.intersectPlane(dragPlane, hitPoint);
    dragOffset.copy(root.position).sub(hitPoint);
    drag = { kind: "move", id, vertical, free: event.altKey };
  }
  controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!drag) return;
  setPointer(event);
  const model = modelFor(drag.id);
  if (!model) return;
  if (drag.kind === "aim") {
    const hit = raycaster.intersectObjects(shared.solids, false)[0];
    if (hit) model.aimAt(hit.point);
    return;
  }
  if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;
  let position = hitPoint.add(dragOffset);
  position = { x: position.x, y: Math.max(0, Math.min(10.5, position.y)), z: position.z };
  if (model.onFloor) {
    const onStage = Math.abs(position.x) < STAGE.width / 2 && position.z < STAGE.frontZ && position.z > STAGE.frontZ - STAGE.depth;
    position.y = onStage ? STAGE_TOP : 0;
  } else if (!drag.free && !drag.vertical && model instanceof Fixture) {
    position = snapToBar(position);
  }
  model.place(position);
});

const endDrag = () => {
  if (!drag) return;
  drag = null;
  controls.enabled = true;
  saveLayout();
};
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

// --- Toolbar and keys -------------------------------------------------------

function setView(name) {
  const view = VIEWS[name] || VIEWS.foh;
  camera.position.set(...view.position);
  controls.target.set(...view.target);
  controls.update();
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === name));
}

function toggle(key) {
  layout.settings = { ...settings(), [key]: !settings()[key] };
  applySettings();
  saveLayout();
}

for (const key of ["house", "work", "grid", "beams"]) $(key).addEventListener("click", () => toggle(key));
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
$("haze").addEventListener("input", () => {
  layout.settings = { ...settings(), haze: Number($("haze").value) / 100 };
  $("hazeValue").textContent = `${$("haze").value}%`;
});
$("haze").addEventListener("change", saveLayout);
$("resetLayout").addEventListener("click", () => {
  if (!confirm("Put every fixture back in its default place and aim?")) return;
  layout.positions = {};
  layout.aims = {};
  rebuild();
  saveLayout();
});
window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "Escape") select(null);
  const views = { 1: "foh", 2: "close", 3: "top", 4: "side" };
  if (views[event.key]) setView(views[event.key]);
  if (event.key === "h") toggle("house");
  if (event.key === "w") toggle("work");
  if (event.key === "g") toggle("grid");
  if (event.key === "b") toggle("beams");
  if (event.key === "f" && selected) {
    const model = modelFor(selected);
    if (model) controls.target.copy(model.root.position);
  }
});

// --- Messages from the console ---------------------------------------------

function normaliseLayout(next) {
  const object = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return { version: 2, positions: object(next?.positions), aims: object(next?.aims), settings: object(next?.settings) };
}

window.addEventListener("message", event => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  switch (message.type) {
    case "SYNC_FIXTURES": {
      library = message.fixtureLibrary || library;
      patch = Array.isArray(message.fixtures) ? message.fixtures : [];
      const signature = patch.map(f => [f.id, f.name, f.uni, f.addr].join("|")).join(",") + `#${Object.keys(library).length}`;
      if (signature !== patchSignature) {
        patchSignature = signature;
        rebuild();
      } else {
        // Same rig: pick up per-fixture settings such as manual barn doors.
        for (const fixture of patch) {
          const model = fixtures.get(String(fixture.id));
          if (model) model.fixture = fixture;
        }
      }
      break;
    }
    case "DMX_UPDATE": {
      const data = message.dmx;
      dmx = data instanceof Uint8Array ? data : Uint8Array.from(Array.isArray(data) ? data : []);
      break;
    }
    case "LOAD_LAYOUT":
      layout = normaliseLayout(message.layout);
      applySettings();
      if (patch.length) rebuild();
      break;
    case "CONSOLE_MODE":
      $("blind").hidden = message.mode !== "BLIND";
      break;
  }
});

// --- Start ------------------------------------------------------------------

resize();
setView("foh");
applySettings();
setStatus(consoleWindow ? "Waiting for the console…" : "Open the visualiser from the console");
renderer.setAnimationLoop(render);
send({ type: "VISUALIZER_READY" });
window.LXViz = { fixtures, get ball() { return ball; }, layout: () => layout, camera, setView, renderer, scene, shared };
