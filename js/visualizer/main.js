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
// Shift to move up/down, Option/Cmd on a Mac or Alt/Ctrl on Windows to place
// it freely). Select a fixed fixture and
// drag its green handle to aim it. Left-drag the empty room to orbit,
// right-drag to pan, scroll to zoom.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildTheatre, defaultHanging, hangsOn, snapToBar, ROOM, STAGE, STAGE_TOP } from "./theatre.js";
import { KINDS, defaultVenue, normaliseVenue, onPictureReady } from "./venue.js";
import { createBuilder } from "./builder.js";
import { drawPlot, outlineOf } from "./plot.js";
import { liveActive, onLiveChange } from "./live-video.js";
import { Fixture } from "./fixture-model.js";
import { LightPool } from "./light-pool.js";
import { hazeNoiseTexture } from "./beam.js";
import { MirrorBall } from "./mirror-ball.js";
import { Atmosphere } from "./atmosphere.js";
import { archetype, baseAddress, decodeFixture } from "./decode.js";
import { createViews } from "./views.js";
import { createLightsTable } from "./lights-table.js";
import { createCapture } from "./capture.js";

const $ = id => document.getElementById(id);
const consoleWindow = window.opener;
const send = message => { try { consoleWindow?.postMessage(message, "*"); } catch (_) {} };

// Brightness calibration. Everything is in real units (candela, lux) and
// multiplied by one exposure, as a camera would see it:
//   LIGHT_SCALE  scene brightness per lux at Exposure 0
//   BEAM_SCALE   = LIGHT_SCALE x σs / 4π: haze scatters σs ≈ 0.045 per metre
//                  per unit of haze (a hazer at full ≈ 0.1/m: typical
//                  theatre haze is 0.02-0.15/m)
// The Exposure slider moves both by the same number of stops.
const LIGHT_SCALE = 0.055;
const BEAM_SCALE = LIGHT_SCALE * 0.045 / (4 * Math.PI);
// Light bouncing off the stage lights everything else a little: the room's
// surfaces (~500 m², reflecting ~15% on average) share what the lit
// surfaces reflect.
const ROOM_AREA = 500;
const ROOM_REFLECTANCE = 0.15;

// Quality presets. "Auto" starts at Medium and moves down (or up) with the
// frame rate. The big costs are pixels (resolution), real stage lights and
// their shadows, and steps through the haze per beam pixel.
const QUALITY = {
  low: { label: "Low", pixelRatio: 0.75, beamResolution: 0.25, steps: 10, pool: 6, shadows: 1, shadowSize: 512, bloom: false },
  medium: { label: "Medium", pixelRatio: 1, beamResolution: 0.35, steps: 14, pool: 10, shadows: 3, shadowSize: 512, bloom: true },
  high: { label: "High", pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), beamResolution: 0.5, steps: 22, pool: 16, shadows: 6, shadowSize: 1024, bloom: true }
};
const LEVELS = ["low", "medium", "high"];
let quality = "medium";
let beamResolution = QUALITY.medium.beamResolution;

const VIEWS = {
  foh: { position: [0, 6.2, 15.5], target: [0, 2.4, -4] },
  close: { position: [0, 2.4, 5.5], target: [0, 3.2, -5] },
  top: { position: [0, 21, -3.2], target: [0, 0, -3.4] },
  side: { position: [-8.5, 6, 4], target: [0, 2.8, -4] }
};
// Beams only show in haze, as in a real room: with no hazer, fog machine or
// room haze there are no beams, just the light landing on stage.
const DEFAULT_SETTINGS = { house: false, work: false, grid: false, targets: true, haze: 0, exposure: 0, curtain: 1, quality: "auto" };

// --- Renderer and scene -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(QUALITY.medium.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // pools clipped at a closed curtain
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn only when a light moves (see shadowsDirty)
renderer.toneMapping = THREE.NoToneMapping; // done by toneMap below, after the bloom
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

const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
const beamTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

const shared = {
  scene,
  beamScene,
  camera,
  envMap,
  solids: [],
  shadowsDirty: true,
  beamSteps: QUALITY.medium.steps,
  lightScale: LIGHT_SCALE,
  beamScale: BEAM_SCALE,
  uniforms: {
    haze: { value: 0.5 },
    time: { value: 0 },
    depth: { value: sceneTarget.depthTexture },
    noise: { value: hazeNoiseTexture() },
    resolution: { value: new THREE.Vector2(1, 1) },
    projectionInverse: { value: camera.projectionMatrixInverse }
  }
};

const theatre = buildTheatre(scene);
shared.solids = theatre.solids;
// The venue changed (Build mode, a show loading): beams re-find what they land on.
theatre.onChange(() => { shared.solidsVersion++; shared.shadowsDirty = true; wake(); });
onPictureReady(() => wake(600));
onLiveChange(() => { wake(600); window.LXViz?.builder?.liveChanged(); });
const atmosphere = new Atmosphere(shared);
window.__atmosphere = atmosphere; // for tests: how much haze is in the room
const lightPool = new LightPool(scene);
const bounce = new THREE.HemisphereLight(0x000000, 0x000000, 1);
scene.add(bounce);
const bounceColour = new THREE.Color();
let shownMachineHaze = -1;

const composer = new EffectComposer(renderer);
const composite = new ShaderPass({
  uniforms: { tScene: { value: null }, tBeams: { value: null }, tDepth: { value: null }, beamSize: { value: new THREE.Vector2(1, 1) }, cameraNear: { value: 0.1 }, cameraFar: { value: 120 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  // Beams pass through unchanged up to a knee, then roll off smoothly
  // (never quite flat), so a beam light that's far brighter than a wash -
  // as it really is - still shows its falloff instead of a flat bar.
  // The beams are drawn at a fraction of the resolution. Where a beam meets
  // the edge of something in front (a fixture, a leg), a plain stretch gives
  // stair-steps and a halo, so there each pixel takes the beam from the
  // nearby low-resolution pixel at the same depth as itself.
  fragmentShader: `uniform sampler2D tScene; uniform sampler2D tBeams; uniform sampler2D tDepth;
    uniform vec2 beamSize; uniform float cameraNear; uniform float cameraFar; varying vec2 vUv;
    float linearDepth(vec2 uv) {
      float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
      return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
    }
    vec3 upsampledBeams() {
      vec2 texel = 1.0 / beamSize;
      vec2 base = (floor(vUv * beamSize - 0.5) + 0.5) * texel;
      float here = linearDepth(vUv);
      float best = 1e9, spread = 0.0;
      vec2 bestUv = vUv;
      for (int i = 0; i < 4; i++) {
        vec2 c = base + vec2(float(i - (i / 2) * 2), float(i / 2)) * texel;
        float diff = abs(linearDepth(c) - here);
        spread = max(spread, diff);
        if (diff < best) { best = diff; bestUv = c; }
      }
      // No edge here: the smooth stretch.
      if (spread < 0.04 * here) return texture2D(tBeams, vUv).rgb;
      return texture2D(tBeams, bestUv).rgb;
    }
    void main() {
      vec3 beams = upsampledBeams();
      float l = max(max(beams.r, beams.g), beams.b);
      float knee = 0.6;
      float over = l - knee;
      float rolled = l < knee ? l : knee + over / (1.0 + over / 2.0);
      beams *= l > 0.0 ? rolled / l : 0.0;
      // Capped far above white (tone mapping makes anything past ~6 white
      // anyway) so the bloom doesn't smear a tiny, very bright spot into
      // blocky squares.
      gl_FragColor = vec4(min(texture2D(tScene, vUv).rgb + beams, vec3(8.0)), 1.0);
    }`
}, null);
// Set after construction: ShaderPass copies its uniforms, and render-target
// textures can't be copied.
composite.uniforms.tScene.value = sceneTarget.texture;
composite.uniforms.tBeams.value = beamTarget.texture;
composite.uniforms.tDepth.value = sceneTarget.depthTexture;
composite.uniforms.cameraNear.value = camera.near;
composite.uniforms.cameraFar.value = camera.far;
// Only genuinely hot things (lenses, the hottest part of a pool) glow.
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.3, 1.4);
// Tone mapping, as a camera: a filmic curve on the brightest of R, G and B,
// so a colour keeps its hue and saturation (a deep red LED stays red rather
// than going orange or pink, as ACES and AgX make it), and only light far
// past white desaturates towards it, as a camera sensor clips.
const toneMap = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    float filmic(float x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec3 c = max(texture2D(tDiffuse, vUv).rgb, 0.0);
      float m = max(max(c.r, c.g), c.b);
      if (m <= 1e-6) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec3 hue = c / m;
      float white = 0.75 * clamp((m - 1.2) / 8.0, 0.0, 1.0);
      gl_FragColor = vec4(mix(hue, vec3(1.0), white) * filmic(m), 1.0);
    }`
});
composer.addPass(composite);
composer.addPass(bloom);
composer.addPass(toneMap);
composer.addPass(new OutputPass());

// The 3D view's part of the window: all of it, or a half or quarter when
// the flat views are showing too (views.js).
let views = null;
const mainRect = () => views ? views.rects().main : { x: 0, y: 0, w: innerWidth, h: innerHeight };

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const m = mainRect();
  camera.aspect = m.w / Math.max(1, m.h);
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  const x = Math.max(1, Math.round(m.w * pr)), y = Math.max(1, Math.round(m.h * pr));
  sceneTarget.setSize(x, y);
  const bx = Math.max(1, Math.round(x * beamResolution));
  const by = Math.max(1, Math.round(y * beamResolution));
  beamTarget.setSize(bx, by);
  composite.uniforms.beamSize.value.set(bx, by);
  shared.uniforms.resolution.value.set(bx, by);
  composer.setSize(m.w, m.h);
  bloom.setSize(x, y);
  atmosphere.setViewportHeight(by, camera.fov); // drawn in the beams' layer
}
window.addEventListener("resize", () => { resize(); wake(); });

function applyQuality(level) {
  const q = QUALITY[level];
  quality = level;
  renderer.setPixelRatio(q.pixelRatio);
  beamResolution = q.beamResolution;
  shared.beamSteps = q.steps;
  for (const model of fixtures.values()) model.setBeamSteps(q.steps);
  lightPool.configure(q);
  bloom.enabled = q.bloom;
  shared.shadowsDirty = true;
  resize();
  slowSeconds = fastSeconds = 0;
  showQuality();
}

function showQuality() {
  $("quality").value = settings().quality;
}

// Rendering only when something changes: DMX, the camera, a drag, or
// anything animating on its own. Otherwise the haze drifts at 10 fps.
let activeUntil = 0;
let lastFrame = 0;
let skippedThisSecond = false;
const wake = (ms = 400) => { activeUntil = Math.max(activeUntil, performance.now() + ms); };
controls.addEventListener("change", () => wake());

// --- State ----------------------------------------------------------------

let library = {};
let patch = [];
let patchSignature = "";
// venue: the stage design (venue.js), or null for the default theatre.
let layout = { version: 2, positions: {}, aims: {}, settings: { ...DEFAULT_SETTINGS }, venue: null };
views = createViews({ renderer, scene, venue: () => layout.venue || theatre.venue(), wake: ms => wake(ms), onLayout: () => resize() });
let dmx = new Uint8Array(5120);
const fixtures = new Map(); // id → Fixture
let ball = null; // { model: MirrorBall, fixture }
// House tabs: where they are (0 closed … 1 open), where they're going, and
// how fast (a full open or close takes CURTAIN_SECONDS unless told otherwise).
const CURTAIN_SECONDS = 4;
const curtain = { now: 1, target: 1, perSecond: 1 / CURTAIN_SECONDS, loaded: false };
shared.solidsVersion = 0;
let selected = null;

const settings = () => {
  const saved = { ...(layout.settings || {}) };
  // Layouts from before beams came from haze kept 55% room haze and a Beams switch.
  if (saved.hazeFromMachines !== true) { saved.haze = 0; saved.hazeFromMachines = true; if (layout.settings) layout.settings = { ...layout.settings, haze: 0, hazeFromMachines: true }; }
  delete saved.beams;
  return { ...DEFAULT_SETTINGS, ...saved, beams: true };
};
const definitionOf = fixture => library[fixture?.name] || fixture?.definition || null;

const exposureText = ev => { ev = Number(ev) || 0; return ev === 0 ? "0" : `${ev > 0 ? "+" : "−"}${Math.abs(ev).toFixed(1)}`; };
function setStatus(text) { $("status").textContent = text; }

function showCurtain() {
  const b = $("curtain");
  if (!b) return;
  const moving = curtain.now !== curtain.target;
  b.textContent = moving ? (curtain.target > curtain.now ? "Curtain opening…" : "Curtain closing…") : curtain.now >= 1 ? "Curtain: open" : curtain.now <= 0 ? "Curtain: closed" : `Curtain: ${Math.round(curtain.now * 100)}% open`;
  b.classList.toggle("on", curtain.target < 1);
}
// Open (1) or close (0) the tabs, or stop them part way. seconds = how long
// a full open/close takes.
function moveCurtain(target, seconds = CURTAIN_SECONDS, save = true) {
  curtain.target = Math.max(0, Math.min(1, Number(target)));
  curtain.perSecond = 1 / Math.max(0.05, Number(seconds) || CURTAIN_SECONDS);
  if (seconds === 0) curtain.now = curtain.target, theatre.curtain.set(curtain.target), shared.solidsVersion++, shared.shadowsDirty = true;
  if (save) { layout.settings = { ...settings(), curtain: curtain.target }; saveLayout(); }
  showCurtain();
  wake(1000);
}

function applySettings() {
  renderSavedViews();
  const s = settings();
  theatre.setHouse(s.house);
  theatre.setWork(s.work);
  theatre.setGrid(s.grid);
  for (const [id, key] of [["house", "house"], ["work", "work"], ["grid", "grid"], ["targets", "targets"]]) $(id).classList.toggle("on", Boolean(s[key]));
  targetGroup.visible = Boolean(s.targets);
  $("exposure").value = String(Math.round((Number(s.exposure) || 0) * 10));
  $("exposureValue").textContent = exposureText(s.exposure);
  $("haze").value = String(Math.round(s.haze * 100));
  $("hazeValue").textContent = `${Math.round(s.haze * 100)}%`;
  $("quality").value = s.quality;
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
    const model = new Fixture(fixture, def, shared);
    const position = saved || (model.onFloor ? defaultFloorSpot(floorIndex++) : defaultHanging(hung.findIndex(e => e.fixture === fixture), hung.length));
    const aim = layout.aims[id];
    model.target.copy(aim ? new THREE.Vector3(aim.x, aim.y, aim.z) : model.onFloor ? new THREE.Vector3(0, STAGE_TOP, -4) : defaultAim(position));
    model.place(position);
    fixtures.set(id, model);
  }
  shared.shadowsDirty = true;
  wake(1000);
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
let fpsTime = 0; // start of the current one-second fps window

function update() {
  const dt = Math.min(0.1, clock.getDelta());
  const time = clock.elapsedTime;
  shared.uniforms.time.value = time;
  const s = settings();
  const machines = [];
  const lights = [];
  stageLight.setRGB(0, 0, 0);

  if (curtain.now !== curtain.target) {
    // Real time, not the frame time (which is capped when frames are slow).
    const t = performance.now();
    const step = curtain.perSecond * Math.min(0.5, (t - (curtain.at || t)) / 1000);
    curtain.at = t;
    curtain.now = Math.abs(curtain.target - curtain.now) <= step ? curtain.target : curtain.now + Math.sign(curtain.target - curtain.now) * step;
    // Eased like a real traveller: slow away, slow in.
    const shown = curtain.now * curtain.now * (3 - 2 * curtain.now);
    if (theatre.curtain.set(shown)) {
      shared.solidsVersion++; // beams re-find what they land on
      shared.shadowsDirty = true;
    }
    showCurtain();
  } else curtain.at = 0;
  // Mostly closed: lights behind the curtain stay behind it (fixture-model.js).
  shared.curtainLine = curtain.now < 0.5 ? theatre.curtain.line : null;
  const gain = Math.pow(2, Number(s.exposure) || 0);
  shared.exposureGain = gain;
  shared.lightScale = LIGHT_SCALE * gain;
  shared.beamScale = BEAM_SCALE * gain;
  bounceColour.setRGB(0, 0, 0);

  for (const model of fixtures.values()) {
    const base = baseAddress(model.fixture);
    const state = decodeFixture(model.def, dmx, base, model.fixture.name, model.fixture.manualShutters, model.fixture.beamAngle);
    if (base < 0) state.intensity = 0;
    const fog = model.update(state, time, dt, s);
    if (model.onFloor) {
      model.root.updateMatrixWorld(true);
      const nozzle = model.head.localToWorld(model.lensLocal.clone());
      machines.push({ kind: model.kind, output: base < 0 ? 0 : fog, nozzle, direction: model.head.getWorldDirection(new THREE.Vector3()) });
    } else if (model.state?.level > 0) {
      lights.push({ ...model.state, lensRadius: model.lensRadius });
      // Lumens landing on what the beam hits, reflected by its colour.
      if (model.hit) {
        const [r, g, b] = model.state.rgb, a = model.hit.albedo;
        const flux = model.lumens * model.state.level * 0.85 * (model.behindCurtain ? 0.15 : 1); // little gets past a closed curtain
        bounceColour.r += flux * r * a.r; bounceColour.g += flux * g * a.g; bounceColour.b += flux * b * a.b;
      }
      const k = Math.min(0.08, (model.state.candela * shared.lightScale) / 4000);
      stageLight.r += model.state.rgb[0] * k;
      stageLight.g += model.state.rgb[1] * k;
      stageLight.b += model.state.rgb[2] * k;
    }
  }
  if (s.work) stageLight.r += 0.05, stageLight.g += 0.05, stageLight.b += 0.055;
  // Bounce: lux everywhere = reflected lumens / (room area x (1 - reflectance)).
  // Mostly up from the floor, a little from above.
  bounceColour.multiplyScalar(shared.lightScale / (ROOM_AREA * (1 - ROOM_REFLECTANCE)));
  bounce.groundColor.copy(bounceColour);
  bounce.color.copy(bounceColour).multiplyScalar(0.35);
  const haze = atmosphere.update(dt, machines, s.haze, stageLight, lights);
  // The haze the hazers and smoke machines are making, beside the Room Haze
  // slider (which is only extra haze on top).
  const fromMachines = Math.round(Math.min(1, atmosphere.machineHaze || 0) * 100);
  if (fromMachines !== shownMachineHaze) {
    shownMachineHaze = fromMachines;
    const el = document.getElementById("hazeMachines");
    if (el) { el.textContent = machines.length ? `+ hazers ${fromMachines}%` : ""; el.title = machines.length ? "Haze from the hazers and smoke machines in the rig, from their levels" : ""; }
  }
  shared.uniforms.haze.value = haze;
  if (ball) {
    const state = decodeFixture(definitionOf(ball.fixture), dmx, baseAddress(ball.fixture), ball.fixture.name);
    ball.model.update(dt, state.speed, lights, haze);
  }
  if (lightPool.update(fixtures.values(), shared.lightScale)) shared.shadowsDirty = true;
  // Fixtures without a real light draw their pool as a decal instead.
  const lit = new Set(lightPool.owners);
  for (const model of fixtures.values()) model.poolLit = lit.has(model);
  if (selected) showSelection();
}

// Recording a video: draw every frame, not only when something changes.
let keepDrawing = false;
function animating() {
  if (keepDrawing) return true;
  for (const model of fixtures.values()) if (model.animating) return true;
  return Boolean((ball && (ball.model.spots.count > 0 || ball.model.spinning)) || atmosphere.busy || drag || curtain.now !== curtain.target || liveActive());
}

// Auto quality: step down after 3 slow seconds, up after 8 fast ones. Only
// seconds spent drawing continuously count (idle 10 fps isn't "slow").
let slowSeconds = 0;
let fastSeconds = 0;
function adjustQuality(fps) {
  if (settings().quality !== "auto") return;
  slowSeconds = fps < 26 ? slowSeconds + 1 : 0;
  fastSeconds = fps > 55 ? fastSeconds + 1 : 0;
  const index = LEVELS.indexOf(quality);
  if (slowSeconds >= 3 && index > 0) applyQuality(LEVELS[index - 1]);
  else if (fastSeconds >= 8 && index < LEVELS.length - 1) applyQuality(LEVELS[index + 1]);
}

function countFrame(now) {
  frames++;
  if (!fpsTime) fpsTime = now;
  if (now - fpsTime >= 1000) {
    const fps = (frames * 1000) / (now - fpsTime);
    $("fps").textContent = `${Math.round(fps)} fps · ${QUALITY[quality].label}${settings().quality === "auto" ? " (auto)" : ""}`;
    if (!skippedThisSecond) adjustQuality(fps);
    frames = 0;
    fpsTime = now;
    skippedThisSecond = false;
  }
}

function render() {
  const now = performance.now();
  controls.update();
  if (now > activeUntil && !animating() && now - lastFrame < 100) {
    skippedThisSecond = true;
    return;
  }
  lastFrame = now;
  countFrame(now);
  const t0 = performance.now();
  update();
  const t1 = performance.now();
  if (shared.shadowsDirty) {
    renderer.shadowMap.needsUpdate = true;
    shared.shadowsDirty = false;
  }
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(beamTarget);
  renderer.render(beamScene, camera);
  renderer.setRenderTarget(null);
  // The 3D view in its part of the window, then the flat views beside it.
  views.setForcedSingle(Boolean(builder.active)); // Build mode works in one view
  const m = mainRect();
  renderer.setViewport(m.x, innerHeight - m.y - m.h, m.w, m.h);
  composer.render();
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  capture?.afterRender(); // a video being recorded takes the 3D view now
  views.draw();
  // How long the CPU spends per frame (for tests and the Show Log).
  const t2 = performance.now();
  timing.update = timing.update * 0.9 + (t1 - t0) * 0.1;
  timing.draw = timing.draw * 0.9 + (t2 - t1) * 0.1;
}
const timing = { update: 0, draw: 0 };

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
  const canvas = renderer.domElement.getBoundingClientRect(), m = mainRect();
  const x = event.clientX - canvas.left - m.x, y = event.clientY - canvas.top - m.y;
  pointer.set((x / m.w) * 2 - 1, -(y / m.h) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

function pickables() {
  const list = [];
  for (const model of fixtures.values()) list.push(...model.parts);
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
  const root = model?.root || ball?.model.group;
  for (const [field, axis] of [["selX", "x"], ["selY", "y"], ["selZ", "z"]]) {
    const input = $(field);
    if (document.activeElement !== input && root) input.value = root.position[axis].toFixed(2);
  }
  if (handle.visible) {
    handle.position.copy(model.target);
    const from = model.head.getWorldPosition(new THREE.Vector3());
    aimLine.geometry.setFromPoints([from, model.target]);
    aimLine.computeLineDistances();
  }
}

// Dragging. The plane each mode drags on is chosen so it faces the camera:
// a horizontal plane at bar height seen from the audience is almost edge-on,
// where one pixel of mouse movement is metres of depth.
//   plain drag - slide along the bar (x only)
//   Shift      - up/down (height only)
//   Option/Cmd (Mac), Alt/Ctrl (Windows)
//              - anywhere on the horizontal plane (best from the Plan view)
// Nothing moves until the mouse has travelled a few pixels, so clicking to
// select never nudges a fixture.
const DRAG_THRESHOLD = 4;

// Key names follow the computer: a Mac keyboard has Option and Cmd where a
// PC has Alt and Ctrl (Ctrl-click on a Mac is a right click, so not that).
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const freeKey = event => event.altKey || (MAC ? event.metaKey : event.ctrlKey);
document.getElementById("moveKeys").textContent = MAC
  ? "Drag = slide along its bar · ⇧ Shift = up/down · ⌥ Option or ⌘ Cmd = anywhere (easiest in Plan view)"
  : "Drag = slide along its bar · Shift = up/down · Alt or Ctrl = anywhere (easiest in Plan view)";
document.getElementById("viewKeys").textContent = MAC
  ? "Drag a light to slide it along its bar · Drag empty space to look around · ⇧ Shift-drag empty space to pan · Scroll or pinch to zoom"
  : "Drag a light to slide it along its bar · Drag empty space to look around · Right-drag or Shift-drag to pan · Scroll to zoom";

function facingPlane(point, lockAxis) {
  // A plane through `point` that contains the axis we move along and faces
  // the camera as squarely as possible.
  const toCamera = camera.position.clone().sub(point);
  toCamera[lockAxis] = 0;
  if (toCamera.lengthSq() < 1e-6) toCamera.set(0, 0, 1);
  return dragPlane.setFromNormalAndCoplanarPoint(toCamera.normalize(), point);
}

// Point & shoot: in aim mode a click or drag on the stage tells the console
// where to aim its selected moving heads (js/point-shoot.js does the maths).
let aimMode = false;
const aimMarker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), new THREE.MeshBasicMaterial({ color: 0xffad1f, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
aimMarker.renderOrder = 11;
aimMarker.visible = false;
scene.add(aimMarker);
// Targets from the console: a ring on the stage where the target is, a thin
// stalk and the target's name above it. T or the Targets button hides them.
const targetGroup = new THREE.Group();
targetGroup.renderOrder = 10;
scene.add(targetGroup);
let targetKey = "";
function targetLabel(text, sub) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 128;
  const g = canvas.getContext("2d");
  g.font = "800 46px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const w = Math.min(500, Math.max(g.measureText(text).width, sub ? g.measureText(sub).width * 0.62 : 0) + 44);
  g.fillStyle = "rgba(14, 10, 26, 0.86)";
  g.strokeStyle = "rgba(199, 182, 255, 0.9)";
  g.lineWidth = 4;
  g.beginPath(); g.roundRect((512 - w) / 2, 6, w, sub ? 116 : 70, 16); g.fill(); g.stroke();
  g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 256, 42, 480);
  if (sub) { g.font = "700 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"; g.fillStyle = "#c7b6ff"; g.fillText(sub, 256, 92, 480); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Same size on screen however far away it is, and not dimmed by the haze.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false, toneMapped: false, fog: false }));
  sprite.scale.set(0.2, 0.05, 1);
  sprite.renderOrder = 12;
  return sprite;
}
function showTargets(list) {
  const key = JSON.stringify(list);
  if (key === targetKey) return;
  targetKey = key;
  for (const child of [...targetGroup.children]) {
    targetGroup.remove(child);
    child.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
  }
  for (const t of Array.isArray(list) ? list : []) {
    if (![t.x, t.y, t.z].every(Number.isFinite)) continue;
    const marker = new THREE.Group();
    marker.position.set(t.x, t.y + 0.015, t.z);
    const colour = t.captured ? 0xffad1f : 0x9b7bff;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 48), new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), ring.material.clone());
    dot.rotation.x = -Math.PI / 2;
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.035), ring.material.clone());
    cross.rotation.x = -Math.PI / 2;
    const cross2 = cross.clone(); cross2.material = ring.material.clone(); cross2.rotation.z = Math.PI / 2;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 6), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
    stalk.position.y = 0.8;
    const label = targetLabel(t.name || "Target", t.captured ? `${t.captured} locked` : "");
    label.position.y = 1.85;
    marker.add(ring, dot, cross, cross2, stalk, label);
    marker.userData.target = t.name;
    targetGroup.add(marker);
  }
  wake();
}

function setAimMode(on) {
  aimMode = Boolean(on);
  $("aimMode").classList.toggle("on", aimMode);
  $("aimHelp").hidden = !aimMode;
  document.body.classList.toggle("aiming", aimMode);
  if (!aimMode) aimMarker.visible = false;
  wake();
}
function aimAtPointer(phase) {
  const hit = raycaster.intersectObjects(shared.solids, false)[0];
  if (!hit) return;
  const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  aimMarker.position.copy(hit.point).addScaledVector(normal, 0.02);
  aimMarker.lookAt(aimMarker.position.clone().add(normal));
  aimMarker.visible = true;
  send({ type: "VIZ_AIM", phase, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } });
}

// Measuring: click two points (on the stage, the set, a light) for the distance between them.
let measuring = false;
const measure = { points: [], group: new THREE.Group() };
measure.group.renderOrder = 12;
scene.add(measure.group);
function clearMeasure() {
  for (const child of [...measure.group.children]) {
    measure.group.remove(child);
    child.geometry?.dispose(); child.material?.map?.dispose(); child.material?.dispose();
  }
  measure.points = [];
}
function setMeasure(on) {
  measuring = Boolean(on);
  $("measureMode").classList.toggle("on", measuring);
  $("measureHelp").hidden = !measuring;
  document.body.classList.toggle("measuring", measuring);
  if (!measuring) clearMeasure();
  if (measuring) setAimMode(false);
  wake();
}
function measureAt() {
  const hit = raycaster.intersectObjects([...shared.solids, ...theatre.itemsGroup.children, ...pickables()], true).find(h => h.object.visible !== false);
  if (!hit) return;
  if (measure.points.length >= 2) clearMeasure();
  const point = hit.point.clone();
  measure.points.push(point);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffc23d, depthTest: false, toneMapped: false }));
  dot.position.copy(point);
  dot.renderOrder = 12;
  measure.group.add(dot);
  if (measure.points.length === 2) {
    const [a, b] = measure.points;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffc23d, depthTest: false, toneMapped: false }));
    line.renderOrder = 12;
    const d = a.distanceTo(b);
    const label = targetLabel(`${d.toFixed(2)} m`, `across ${Math.abs(b.x - a.x).toFixed(2)} · up ${Math.abs(b.y - a.y).toFixed(2)} · deep ${Math.abs(b.z - a.z).toFixed(2)}`);
    label.position.copy(a).add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.25, 0));
    measure.group.add(line, label);
    setStatus(`Measured ${d.toFixed(2)} m`);
  }
  wake();
}
$("measureMode").addEventListener("click", () => setMeasure(!measuring));

// The lighting plot (plot.js), in a window of its own to print or save.
function openPlot() {
  const venue = layout.venue || theatre.venue();
  const outlines = venue.items.filter(item => !item.hidden && theatre.items.get(item.id)).map(item => {
    const group = theatre.items.get(item.id).group;
    group.updateMatrixWorld(true);
    return outlineOf(item, group);
  });
  const hangers = venue.items.filter(item => KINDS[item.kind]?.hang && !item.hidden);
  const lights = [...fixtures.values()].map(model => {
    const f = model.fixture, p = model.root.position;
    const rgb = model.state?.rgb;
    return {
      number: f.fixtureNumber ?? "?",
      name: f.name,
      kind: archetype(model.def, f.name),
      channels: model.def?.channels || "",
      address: baseAddress(f) >= 0 ? `${f.uni ?? 1}/${f.addr}` : "–",
      position: { x: p.x, z: p.z },
      aim: model.onFloor ? null : { x: model.target.x, z: model.target.z },
      colour: rgb && model.state.level > 0 ? `rgb(${rgb.map(v => Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255)).join(",")})` : "",
      on: hangers.find(item => hangsOn(item, p))?.id || null
    };
  }).sort((a, b) => Number(a.number) - Number(b.number));
  const page = window.open("", "plot", "width=1300,height=900");
  if (!page) return setStatus("Couldn't open the plot window");
  page.document.open();
  page.document.write(drawPlot({ venue, lights, outlines }));
  page.document.close();
}
$("plotButton").addEventListener("click", openPlot);

renderer.domElement.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  setPointer(event);
  if (measuring) { measureAt(); return; }
  if (aimMode) {
    drag = { kind: "point", start: { x: event.clientX, y: event.clientY }, active: true };
    aimAtPointer("start");
    controls.enabled = false;
    renderer.domElement.setPointerCapture(event.pointerId);
    return;
  }
  // Build mode: scenery first (its handles, or picking a piece).
  if (builder.active && builder.pointerDown(event, raycaster.ray)) return;
  const start = { x: event.clientX, y: event.clientY };
  if (handle.visible && raycaster.intersectObject(handle, false).length) {
    drag = { kind: "aim", id: selected, start, active: false };
  } else {
    const hit = raycaster.intersectObjects(pickables(), false)[0];
    const id = hit?.object.userData.fixtureId;
    if (!id) { select(null); return; }
    select(id);
    const model = modelFor(id);
    const root = model.root;
    const mode = freeKey(event) ? "free" : event.shiftKey ? "height" : model.onFloor ? "free" : "bar";
    if (mode === "free") dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), root.position);
    else facingPlane(root.position, mode === "bar" ? "x" : "y");
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) hitPoint.copy(root.position);
    dragOffset.copy(root.position).sub(hitPoint);
    drag = { kind: "move", id, mode, start, active: false, origin: root.position.clone() };
  }
  controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!drag) return;
  wake();
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < DRAG_THRESHOLD) return;
    drag.active = true;
  }
  setPointer(event);
  if (drag.kind === "point") { aimAtPointer("move"); return; }
  const model = modelFor(drag.id);
  if (!model) return;
  if (drag.kind === "aim") {
    const hit = raycaster.intersectObjects(shared.solids, false)[0];
    if (hit) model.aimAt(hit.point);
    return;
  }
  if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;
  const moved = hitPoint.add(dragOffset);
  const origin = drag.origin;
  let position;
  if (drag.mode === "bar") position = { x: moved.x, y: origin.y, z: origin.z };
  else if (drag.mode === "height") position = { x: origin.x, y: moved.y, z: origin.z };
  else position = { x: moved.x, y: origin.y, z: moved.z };
  position.x = Math.max(ROOM.minX + 0.5, Math.min(ROOM.maxX - 0.5, position.x));
  position.y = Math.max(0, Math.min(ROOM.maxY - 0.5, position.y));
  if (model.onFloor) {
    const onStage = Math.abs(position.x) < STAGE.width / 2 && position.z < STAGE.frontZ && position.z > STAGE.frontZ - STAGE.depth;
    position.y = onStage ? STAGE_TOP : 0;
  } else if (drag.mode === "free" && model instanceof Fixture) {
    position = snapToBar(position);
  }
  model.place(position);
});

const endDrag = () => {
  if (!drag) return;
  if (drag.kind === "point") { send({ type: "VIZ_AIM", phase: "end" }); drag = null; controls.enabled = true; return; }
  const changed = drag.active;
  drag = null;
  controls.enabled = true;
  if (changed) saveLayout();
};
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

// Typed positions.
for (const field of ["selX", "selY", "selZ"]) {
  $(field).addEventListener("change", () => {
    const model = modelFor(selected);
    if (!model) return;
    const value = name => { const n = Number($(name).value); return Number.isFinite(n) ? n : 0; };
    const position = { x: Math.max(ROOM.minX + 0.5, Math.min(ROOM.maxX - 0.5, value("selX"))), y: Math.max(0, Math.min(ROOM.maxY - 0.5, value("selY"))), z: Math.max(ROOM.minZ + 0.5, Math.min(ROOM.maxZ - 0.5, value("selZ"))) };
    if (model.onFloor) {
      const onStage = Math.abs(position.x) < STAGE.width / 2 && position.z < STAGE.frontZ && position.z > STAGE.frontZ - STAGE.depth;
      position.y = onStage ? STAGE_TOP : 0;
    }
    model.place(position);
    saveLayout();
  });
  $(field).addEventListener("keydown", event => event.stopPropagation());
}

// The lights as a table (lights-table.js).
const lightsTable = createLightsTable({
  fixtures,
  typeOf: fixture => archetype(definitionOf(fixture), fixture.name),
  patchOf: fixture => (baseAddress(fixture) >= 0 ? `${fixture.uni ?? 1}/${fixture.addr}` : "—"),
  select: id => select(id),
  selected: () => selected,
  place: (id, position) => {
    const model = modelFor(id);
    if (!model) return;
    const p = { x: Math.max(ROOM.minX + 0.5, Math.min(ROOM.maxX - 0.5, position.x)), y: Math.max(0, Math.min(ROOM.maxY - 0.5, position.y)), z: Math.max(ROOM.minZ + 0.5, Math.min(ROOM.maxZ - 0.5, position.z)) };
    model.place(p);
    if (id === selected) showSelection();
    saveLayout();
  },
  wake: () => wake(),
  say: text => setStatus(text)
});
$("lightsButton")?.addEventListener("click", () => lightsTable.toggle());

// Pictures and videos of the stage (capture.js).
const capture = createCapture({
  renderer,
  renderNow: () => { activeUntil = performance.now() + 500; lastFrame = 0; render(); },
  mainRect: () => mainRect(),
  keepDrawing: on => { keepDrawing = on; wake(); },
  say: text => setStatus(text)
});

// --- Toolbar and keys -------------------------------------------------------

function setView(name) {
  const view = VIEWS[name] || VIEWS.foh;
  camera.position.set(...view.position);
  controls.target.set(...view.target);
  controls.update();
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === name));
}

// Your own camera views, saved with the show: ＋ Save view, then a button
// each (right-click one to delete it).
const savedViews = () => (Array.isArray(layout.settings?.views) ? layout.settings.views : []);
function renderSavedViews() {
  const host = $("myViews");
  if (!host) return;
  host.innerHTML = savedViews().map((v, i) => `<button data-myview="${i}" title="Your view — right-click to delete">${String(v.name).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))}</button>`).join("");
}
function saveView(name) {
  const clean = String(name || "").trim().slice(0, 40);
  if (!clean) return;
  const list = savedViews().filter(v => v.name !== clean);
  list.push({ name: clean, position: camera.position.toArray().map(n => +n.toFixed(3)), target: controls.target.toArray().map(n => +n.toFixed(3)) });
  layout.settings = { ...settings(), views: list };
  saveLayout();
  renderSavedViews();
  setStatus(`View “${clean}” saved with the show`);
}
function goToSavedView(i) {
  const v = savedViews()[i];
  if (!v) return;
  camera.position.fromArray(v.position);
  controls.target.fromArray(v.target);
  controls.update();
  document.querySelectorAll("[data-view]").forEach(b => b.classList.remove("on"));
  wake();
}
// Look from the selected light, down its beam.
function viewFromLight() {
  const model = selected != null ? modelFor(selected) : null;
  if (!model) { setStatus("Click a light first, then From light"); return; }
  const axis = model.head.getWorldDirection(new THREE.Vector3());
  const lens = model.head.localToWorld(model.lensLocal ? model.lensLocal.clone() : new THREE.Vector3());
  camera.position.copy(lens).addScaledVector(axis, 0.35);
  controls.target.copy(lens).addScaledVector(axis, 8);
  controls.update();
  document.querySelectorAll("[data-view]").forEach(b => b.classList.remove("on"));
  wake();
}
$("saveView")?.addEventListener("click", () => {
  const box = $("saveViewName");
  box.hidden = false;
  box.value = `View ${savedViews().length + 1}`;
  box.focus(); box.select();
});
$("saveViewName")?.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Enter") { saveView(e.target.value); e.target.hidden = true; }
  if (e.key === "Escape") e.target.hidden = true;
});
$("saveViewName")?.addEventListener("blur", e => { e.target.hidden = true; });
$("myViews")?.addEventListener("click", e => { const b = e.target.closest("[data-myview]"); if (b) goToSavedView(Number(b.dataset.myview)); });
$("myViews")?.addEventListener("contextmenu", e => {
  const b = e.target.closest("[data-myview]");
  if (!b) return;
  e.preventDefault();
  const v = savedViews()[Number(b.dataset.myview)];
  if (!v || !confirm(`Delete the view “${v.name}”?`)) return;
  layout.settings = { ...settings(), views: savedViews().filter(x => x !== v) };
  saveLayout();
  renderSavedViews();
});
$("fromLight")?.addEventListener("click", viewFromLight);
// Build mode works in one view: switch as soon as it's turned on or off.
$("buildMode")?.addEventListener("click", () => setTimeout(() => { views.setForcedSingle(Boolean(builder.active)); wake(); }, 0));

function toggle(key) {
  layout.settings = { ...settings(), [key]: !settings()[key] };
  applySettings();
  saveLayout();
  wake();
}

// Hide the controls to see more of the stage (remembered; B toggles).
function setBarHidden(on) {
  document.body.classList.toggle("bar-hidden", on);
  $("showBar").hidden = !on;
  try { localStorage.setItem("vizBarHidden", on ? "1" : "0"); } catch (_) {}
}
$("hideBar").addEventListener("click", () => setBarHidden(true));
$("showBar").addEventListener("click", () => setBarHidden(false));
try { setBarHidden(localStorage.getItem("vizBarHidden") === "1"); } catch (_) {}
for (const key of ["house", "work", "grid", "targets"]) $(key).addEventListener("click", () => toggle(key));
$("curtain").addEventListener("click", () => moveCurtain(curtain.target >= 0.5 ? 0 : 1));
$("aimMode").addEventListener("click", () => setAimMode(!aimMode));
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
$("quality").addEventListener("change", () => {
  const choice = $("quality").value;
  layout.settings = { ...settings(), quality: choice };
  applyQuality(choice === "auto" ? "medium" : choice);
  saveLayout();
  wake();
});
$("haze").addEventListener("input", () => {
  wake();
  layout.settings = { ...settings(), haze: Number($("haze").value) / 100 };
  $("hazeValue").textContent = `${$("haze").value}%`;
});
$("haze").addEventListener("change", saveLayout);
$("exposure").addEventListener("input", () => {
  wake();
  layout.settings = { ...settings(), exposure: Number($("exposure").value) / 10 };
  $("exposureValue").textContent = exposureText(layout.settings.exposure);
});
$("exposure").addEventListener("change", saveLayout);
$("exposure").addEventListener("dblclick", () => { $("exposure").value = "0"; $("exposure").dispatchEvent(new Event("input")); saveLayout(); });
$("resetLayout").addEventListener("click", () => {
  if (!confirm("Put every fixture back in its default place and aim?")) return;
  layout.positions = {};
  layout.aims = {};
  rebuild();
  saveLayout();
});
window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement) return;
  if (builder.keyDown(event)) return;
  if (event.key === "Escape") { select(null); setAimMode(false); setMeasure(false); }
  if (event.key === "m" || event.key === "M") setMeasure(!measuring);
  if (event.key === "p" || event.key === "P") setAimMode(!aimMode);
  const views = { 1: "foh", 2: "close", 3: "top", 4: "side" };
  if (views[event.key]) setView(views[event.key]);
  if (event.key === "h") toggle("house");
  if (event.key === "w") toggle("work");
  if (event.key === "g") toggle("grid");
  if (event.key === "t") toggle("targets");
  if (event.key === "c") moveCurtain(curtain.target >= 0.5 ? 0 : 1);
  if (event.key === "b" || event.key === "B") setBarHidden(!document.body.classList.contains("bar-hidden"));
  if (event.key === "f" && selected) {
    const model = modelFor(selected);
    if (model) controls.target.copy(model.root.position);
  }
});

// --- Build mode: the stage, the room and the set (builder.js) -----------------

const builder = createBuilder({
  scene, camera, renderer, controls, theatre,
  fixtures,
  venue: () => layout.venue || theatre.venue(),
  commit(venue, changed) {
    layout.venue = venue;
    theatre.apply(venue, { changed });
    saveLayout();
  },
  saveLayout,
  wake,
  // Where every light is, and putting them back (undo in Build mode).
  positions: () => Object.fromEntries([...fixtures].map(([id, m]) => [id, { x: m.root.position.x, y: m.root.position.y, z: m.root.position.z }])),
  restorePositions(saved) {
    for (const [id, p] of Object.entries(saved || {})) fixtures.get(id)?.place(p);
    saveLayout();
  },
  moved() { shared.solidsVersion++; shared.shadowsDirty = true; wake(); },
  fixtureHitDistance: () => raycaster.intersectObjects(pickables(), false)[0]?.distance ?? null,
  // Hung lights (not floor units), in fixture number order.
  fixtureList: () => [...fixtures].filter(([, m]) => !m.onFloor)
    .map(([id, m]) => ({ id, n: Number(m.fixture.fixtureNumber) || 0, label: `${m.fixture.fixtureNumber ?? "?"} · ${m.fixture.name}` }))
    .sort((a, b) => a.n - b.n),
  placeFixture(id, position) {
    const model = fixtures.get(id);
    if (!model) return;
    model.place(position);
    saveLayout();
    wake();
  },
  say: text => setStatus(text),
  onToggle(on) {
    $("buildMode").classList.toggle("on", on);
    if (on) { select(null); setAimMode(false); }
  }
});
$("buildMode").addEventListener("click", () => builder.toggle());

// --- Messages from the console ---------------------------------------------

function normaliseLayout(next) {
  const object = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return { version: 2, positions: object(next?.positions), aims: object(next?.aims), settings: object(next?.settings), venue: normaliseVenue(next?.venue) };
}

window.addEventListener("message", event => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  wake();
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
    case "LOAD_LAYOUT": {
      const before = settings().quality;
      layout = normaliseLayout(message.layout);
      theatre.apply(layout.venue || defaultVenue());
      builder.refresh();
      applySettings();
      // The curtain goes where the show left it: at once on opening, else it travels.
      { const want = Math.max(0, Math.min(1, Number(settings().curtain ?? 1))); if (want !== curtain.target) moveCurtain(want, curtain.loaded ? CURTAIN_SECONDS : 0, false); curtain.loaded = true; }
      if (settings().quality !== before) applyQuality(settings().quality === "auto" ? "medium" : settings().quality);
      if (patch.length) rebuild();
      break;
    }
    case "CURTAIN":
      moveCurtain(message.open, message.seconds ?? CURTAIN_SECONDS);
      break;
    case "TARGETS":
      showTargets(message.targets);
      break;
    case "AIM_MODE":
      setAimMode(message.on);
      break;
    case "CONSOLE_MODE":
      $("blind").hidden = message.mode !== "BLIND";
      break;
  }
});

// --- Start ------------------------------------------------------------------

applyQuality("medium");
setView("foh");
applySettings();
setStatus(consoleWindow ? "Waiting for the console…" : "Open the visualiser from the console");
renderer.setAnimationLoop(render);
send({ type: "VISUALIZER_READY" });
window.LXViz = { views, lightsTable, capture, timing, curtain, moveCurtain, fixtures, builder, theatre, measure, setMeasure, openPlot, get ball() { return ball; }, layout: () => layout, camera, controls, setView, renderer, scene, shared, lightPool };
