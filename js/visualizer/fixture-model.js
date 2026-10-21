// One patched fixture in the visualiser: its body, its volumetric beam(s),
// lens glow, and a description of its light for the stage-lighting pool
// (main.js gives the brightest fixtures a real spotlight each).
//
// Every fixture hangs from a clamp. A yoke turns around the vertical (pan)
// and the head tilts at the pivot; the lens points along the head's +Z.
// Moving heads take pan/tilt from DMX and travel there at a real fixture's
// speed; fixed fixtures are aimed by hand.
import * as THREE from "three";
import { BeamVolume } from "./beam.js";
import { FixtureMask, glow, poolDisc } from "./gobos.js";
import { archetype, ratedLumens, wheelColour } from "./decode.js";
import { buildModel, MATERIALS } from "./models.js";

const MOVING = new Set(["movingSpot", "movingWash", "movingBeam"]);
const ON_FLOOR = new Set(["fogger", "hazer"]);
const PAN_SPEED = 7.5; // rad/s, ~430°/s like a fast modern moving head
const TILT_SPEED = 6.3;
const POOL_PLANE = new THREE.PlaneGeometry(1, 1);
const tmpU = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
const PRISM_FACETS = 3;
const PRISM_SPREAD = 0.11; // rad between the centre line and each copy

// How bright a fixture reads. Physically, candela = lumens / beam solid angle,
// so a 1kW fresnel is ~7x a small LED par and a 4° beam light is ~100x a
// 30° wash. Eyes (and cameras) compress that range a lot, so we do too:
// brightness grows gently with lumens and with how narrow the beam is,
// relative to a 3000 lm, 25° reference, and is capped so a tight beam light
// reads punchy (up to ~4x a par) rather than blinding.
const REFERENCE_LUMENS = 3000;
const REFERENCE_SOLID_ANGLE = 2 * Math.PI * (1 - Math.cos((12.5 * Math.PI) / 180));
const REFERENCE_CANDELA = REFERENCE_LUMENS / REFERENCE_SOLID_ANGLE;
export function perceivedCandela(lumens, halfAngle) {
  const solidAngle = 2 * Math.PI * (1 - Math.cos(Math.max(halfAngle, 0.01)));
  const gain = Math.pow(lumens / REFERENCE_LUMENS, 0.4) * Math.pow(REFERENCE_SOLID_ANGLE / solidAngle, 0.3);
  return REFERENCE_CANDELA * Math.min(4, gain);
}

// How hard a beam's edge is when it's in focus, by kind of light (0 = razor
// sharp, 1 = very soft). Profiles and spots image a sharp aperture; pars and
// washes have a natural soft edge; a fresnel's lens is made to be soft.
const EDGE = { profile: 0.05, movingSpot: 0.06, movingBeam: 0.04, par: 0.2, movingWash: 0.28, bar: 0.3, fresnel: 0.5, strobe: 0.4, blinder: 0.4 };

// Edge softness for this throw. A focus channel moves the focal plane from
// near (0) to far (1): it's sharp when that matches the distance to the
// surface the beam lands on, and goes soft either side of it. A fixture
// focused by hand is taken as focused, or set in the console (edge).
export function edgeSoftness(kind, { focus, frost }, throwDistance, manualEdge = null) {
  let soft = manualEdge != null ? manualEdge : EDGE[kind] ?? 0.2;
  if (focus != null && manualEdge == null) {
    const ideal = Math.min(1, Math.max(0, (throwDistance - 2) / 18));
    soft += Math.abs(focus - ideal) * 0.35;
  }
  return Math.min(1, soft + (frost || 0) * 0.7);
}

// Barn doors on fresnels: four leaves hinged round the lens that fold in as
// the blades close.
function buildBarnDoors(head, lensZ) {
  const leaves = [];
  const leafGeometry = new THREE.PlaneGeometry(0.3, 0.17).rotateX(Math.PI / 2).translate(0, 0, 0.085);
  const material = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const hinge = new THREE.Group();
    hinge.rotation.z = (i * Math.PI) / 2;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.155, lensZ + 0.012);
    const leaf = new THREE.Mesh(leafGeometry, material);
    leaf.castShadow = true;
    pivot.add(leaf);
    hinge.add(pivot);
    head.add(hinge);
    leaves.push({ hinge, pivot });
  }
  return leaves;
}

// Move `current` towards `target` no faster than `speed` (per second), easing in.
function approach(current, target, speed, dt) {
  const delta = target - current;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), speed * dt, Math.abs(delta) * Math.min(1, dt * 7) + 0.002);
  return current + step;
}

const tmpAxis = new THREE.Vector3();
const tmpLens = new THREE.Vector3();
const tmpCamera = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const raycaster = new THREE.Raycaster();

export class Fixture {
  constructor(fixture, def, shared) {
    this.fixture = fixture;
    this.def = def;
    this.id = String(fixture.id);
    this.kind = archetype(def, fixture.name);
    this.moving = MOVING.has(this.kind);
    this.onFloor = ON_FLOOR.has(this.kind);
    this.emitsLight = !this.onFloor && this.kind !== "mirrorBall";
    this.shared = shared;
    this.lumens = ratedLumens(def);
    this.lastAxis = new THREE.Vector3();
    this.lastApex = new THREE.Vector3();
    this.beamLength = 12;
    this.pan = 0;
    this.tilt = 0;
    this.goboAngle = 0;
    this.gobo2Angle = 0;
    this.prismAngle = 0;
    this.colourPhase = 0;
    this.light = null;
    this.state = null;
    this.mask = new FixtureMask();
    this.target = new THREE.Vector3(0, 1, -4);

    this.root = new THREE.Group();
    this.root.userData.fixtureId = this.id;
    this.yoke = new THREE.Group();
    this.head = new THREE.Group();

    const model = buildModel(this.kind, def, fixture.name);
    this.lens = model.lens;
    this.lensRadius = model.lensRadius;
    this.lensLocal = new THREE.Vector3(0, model.nozzleY ?? 0, model.lensZ);
    this.head.add(model.head);
    if (this.onFloor) {
      this.root.add(this.head);
    } else {
      this.root.add(model.base);
      this.yoke.position.y = model.yokeY;
      this.yoke.add(model.yoke);
      this.head.position.y = -model.drop;
      this.yoke.add(this.head);
      this.root.add(this.yoke);
    }
    this.barnDoors = this.kind === "fresnel" ? buildBarnDoors(this.head, model.lensZ) : null;

    this.parts = [];
    this.root.traverse(object => {
      if (object.isMesh) { object.userData.fixtureId = this.id; this.parts.push(object); }
    });

    if (this.emitsLight) {
      this.beams = Array.from({ length: PRISM_FACETS }, () => new BeamVolume(shared.uniforms, shared.beamSteps));
      this.beams.forEach(beam => shared.beamScene.add(beam.mesh));
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      this.glow.renderOrder = 2;
      shared.scene.add(this.glow);
      // Pool of light where the beam lands, drawn when this fixture isn't
      // one of the few given a real stage light (light-pool.js), so every
      // light still shows on stage however many are on.
      this.poolDecal = new THREE.Mesh(POOL_PLANE, new THREE.MeshBasicMaterial({ map: poolDisc(), color: 0x000000, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      this.poolDecal.matrixAutoUpdate = false;
      this.poolDecal.visible = false;
      this.poolDecal.renderOrder = 1;
      shared.scene.add(this.poolDecal);
      this.poolLit = false; // set by main.js: true while a real light does it
      this.hit = null;
    }

    this.selection = new THREE.BoxHelper(this.root, 0x19d6a3);
    this.selection.visible = false;
    shared.scene.add(this.selection);
    shared.scene.add(this.root);
  }

  setBeamSteps(steps) {
    this.beams?.forEach(beam => beam.setSteps(steps));
  }

  // Hanging/standing position (world).
  place(position) {
    this.root.position.set(position.x, position.y, position.z);
    if (!this.moving) this.aimAt(this.target);
  }

  // Point a fixed fixture at a point in the room.
  aimAt(point) {
    this.target.copy(point);
    if (this.moving) return;
    this.root.updateMatrixWorld(true);
    const pivot = this.head.getWorldPosition(new THREE.Vector3());
    const direction = point.clone().sub(pivot).normalize();
    if (this.onFloor) {
      this.root.rotation.y = Math.atan2(direction.x, direction.z);
      return;
    }
    this.setAngles(Math.atan2(direction.x, direction.z), Math.asin(Math.max(-1, Math.min(1, -direction.y))));
  }

  // The pool decal: lit as a real light would light that surface (diffuse,
  // albedo/π x candela/d² x cos of the angle it lands at), stretched into
  // the ellipse a cone makes on a slanted surface, with the gobo/shutter mask.
  updatePoolDecal(level, rgb, candela, axis, halfAngle, softness, prism, mask) {
    const decal = this.poolDecal, hit = this.hit;
    if (!decal || !hit || level <= 0 || this.poolLit) { if (decal) decal.visible = false; return; }
    const n = hit.normal;
    const cos = Math.max(0.15, Math.abs(axis.dot(n)));
    const radius = hit.distance * Math.tan(Math.min(1.3, halfAngle * (prism ? 1.6 : 1) * (1 + softness * 0.2)));
    const along = tmpU.copy(axis).addScaledVector(n, -axis.dot(n));
    if (along.lengthSq() < 1e-6) along.set(1, 0, 0).addScaledVector(n, -n.x);
    along.normalize();
    const across = tmpV.crossVectors(n, along).normalize();
    decal.matrix.makeBasis(along.multiplyScalar(radius * 2 / cos), across.multiplyScalar(radius * 2), tmpW.copy(n));
    decal.matrix.setPosition(hit.point.x + n.x * 0.01, hit.point.y + n.y * 0.01, hit.point.z + n.z * 0.01);
    decal.matrixWorldNeedsUpdate = true;
    const material = decal.material;
    const map = mask || poolDisc();
    if (material.map !== map) { material.map = map; material.needsUpdate = true; }
    const k = (candela * this.shared.lightScale * cos) / (Math.PI * hit.distance * hit.distance);
    material.color.setRGB(rgb[0] * k * hit.albedo.r, rgb[1] * k * hit.albedo.g, rgb[2] * k * hit.albedo.b);
    decal.visible = true;
  }

  // yaw: around the vertical; pitch: 0 = level, +π/2 = straight down.
  setAngles(yaw, pitch) {
    this.yoke.rotation.y = yaw;
    this.head.rotation.x = pitch;
  }

  setSelected(on) {
    this.selection.visible = on;
    if (on) this.selection.update();
  }

  // Is anything still moving on its own (so the view needs redrawing)?
  get animating() {
    const s = this.state;
    return Boolean(s && (s.slewing || s.strobing || s.turning));
  }

  // Apply a decoded DMX state. Returns how much fog the fixture is making.
  update(state, time, dt, settings) {
    let slewing = false;
    if (this.moving && state.pan != null) {
      // Travel to the DMX position at the fixture's speed. A P/T speed
      // channel (0 = fastest) slows it further.
      const slow = 1 - 0.9 * (Number.isInteger(this.def?.map?.speed) ? state.speed : 0);
      const pan = approach(this.pan, state.pan, PAN_SPEED * slow, dt);
      const tilt = approach(this.tilt, state.tilt ?? 0, TILT_SPEED * slow, dt);
      slewing = Math.abs(pan - state.pan) > 1e-3 || Math.abs(tilt - (state.tilt ?? 0)) > 1e-3;
      this.pan = pan;
      this.tilt = tilt;
      // Hung upside down: pan turns the yoke, tilt 0 points straight down.
      this.setAngles(pan, Math.PI / 2 + tilt);
    }
    if (this.barnDoors) {
      // Leaves sit open at ~20° and fold into the beam as each blade closes.
      // Hinges go top, left, bottom, right; blades are top, right, bottom, left.
      const { blades, rotation } = state.framing;
      const key = `${blades.join(",")}|${rotation}`;
      if (key !== this.lastFraming) { this.lastFraming = key; this.shared.shadowsDirty = true; }
      this.barnDoors.forEach(({ hinge, pivot }, i) => {
        hinge.rotation.z = (i * Math.PI) / 2 + rotation;
        pivot.rotation.x = -0.35 + blades[[0, 3, 2, 1][i]] * 1.05;
      });
    }
    if (!this.emitsLight) {
      this.state = { level: 0 };
      return this.onFloor ? state.fog * (0.5 + 0.5 * state.fan) : 0;
    }

    let level = state.intensity;
    const strobing = state.strobeRate > 0;
    if (strobing) level *= (time * state.strobeRate) % 1 < 0.22 ? 1 : 0;
    if (settings.blackout) level = 0;

    // Colour wheel scroll: step round the wheel's colours over time.
    let rgb = state.rgb;
    if (state.colourScroll > 0) {
      this.colourPhase += state.colourScroll * dt;
      const wheel = Array.isArray(this.def?.colourWheel) && this.def.colourWheel.length ? this.def.colourWheel : null;
      const slots = wheel ? wheel.length : 8;
      const slot = Math.floor(this.colourPhase) % slots;
      rgb = wheel ? wheelColour(this.def, (Number(wheel[slot].min) + Number(wheel[slot].max)) / 2) : new THREE.Color().setHSL(slot / slots, 1, 0.5).toArray();
    }

    // Rotations: gobo, second gobo/effect, prism; plus gobo shake.
    const turn = (rotation, angle) => (rotation.speed ? angle + rotation.speed * dt * Math.PI * 2 : rotation.angle);
    this.goboAngle = turn(state.goboRotation, this.goboAngle);
    this.gobo2Angle = state.effect > 0 && !state.gobo2 ? this.gobo2Angle + state.effect * dt * 2.5 : turn(state.gobo2Rotation, this.gobo2Angle);
    this.prismAngle = turn(state.prismRotation, this.prismAngle);
    const shake = state.goboShake ? Math.sin(time * (2 + state.goboShake * 10) * Math.PI * 2) * 0.35 : 0;
    const turning = Boolean(state.goboRotation.speed || state.gobo2Rotation.speed || state.prismRotation.speed || state.goboShake || state.effect || state.colourScroll);

    this.root.updateMatrixWorld(true);
    const axis = this.head.getWorldDirection(tmpAxis).clone();
    const lensWorld = this.head.localToWorld(tmpLens.copy(this.lensLocal)).clone();
    const halfAngle = (state.beamAngle * Math.PI) / 360;
    const softness = edgeSoftness(this.kind, state, this.beamLength, Number.isFinite(this.fixture.edge) ? this.fixture.edge : null);
    const candela = perceivedCandela(this.lumens, halfAngle) * level;
    const [r, g, b] = rgb;

    // Gobo / framing / prism mask, blurred by focus and frost.
    const masks = this.mask.update({
      gobo: state.gobo,
      gobo2: state.gobo2,
      effect: state.effect,
      framing: state.framing,
      blur: Math.min(1, Math.max(0, softness - 0.1) * 1.2),
      rotation: this.goboAngle + shake,
      rotation2: this.gobo2Angle,
      prism: state.prism,
      prismAngle: this.prismAngle
    });

    // Beam length: to the first solid thing along the axis.
    if (this.lastAxis.distanceToSquared(axis) > 1e-7 || this.lastApex.distanceToSquared(lensWorld) > 1e-7) {
      raycaster.set(lensWorld, axis);
      raycaster.far = 60;
      const hit = raycaster.intersectObjects(this.shared.solids, false)[0];
      this.beamLength = hit ? hit.distance + 0.6 : 30;
      this.hit = hit?.face ? {
        point: hit.point.clone(),
        normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld),
        distance: hit.distance,
        albedo: hit.object.material?.color?.clone?.() || new THREE.Color(0.2, 0.2, 0.2)
      } : null;
      this.lastAxis.copy(axis);
      this.lastApex.copy(lensWorld);
      this.shared.shadowsDirty = true;
    }

    // The volumetric beam(s). A prism splits the beam into copies fanned
    // round the axis, each with a share of the light.
    const facets = state.prism ? PRISM_FACETS : 1;
    const beamsOn = level > 0 && this.shared.uniforms.haze.value > 0.005; // no haze, no beam
    for (let i = 0; i < PRISM_FACETS; i++) {
      const beam = this.beams[i];
      if (!beamsOn || i >= facets) { beam.hide(); continue; }
      let beamAxis = axis;
      if (facets > 1) {
        const around = this.prismAngle + (i / facets) * Math.PI * 2;
        const side = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
        side.applyQuaternion(tmpQuat.setFromAxisAngle(axis, around));
        beamAxis = axis.clone().applyQuaternion(tmpQuat.setFromAxisAngle(side, PRISM_SPREAD)).normalize();
      }
      const tanHalf = Math.tan(Math.max(halfAngle, 0.004));
      const back = Math.min(0.6, this.lensRadius / tanHalf);
      const apex = lensWorld.clone().addScaledVector(beamAxis, -back);
      const colour = new THREE.Color(r, g, b).multiplyScalar((candela / facets) * this.shared.beamScale);
      beam.update({ apex, axis: beamAxis, halfAngle, length: this.beamLength + back, colour, softness, start: back, mask: masks.beam, camera: this.shared.camera });
    }

    // What the stage-lighting pool needs to light the room for this fixture.
    this.light = level > 0 ? {
      position: lensWorld,
      target: lensWorld.clone().addScaledVector(axis, 10),
      angle: Math.min(1.5, halfAngle * (state.prism ? 1.6 : 1) * (1 + softness * 0.2)),
      penumbra: Math.min(1, 0.02 + softness * 0.9),
      colour: [r, g, b],
      intensity: candela,
      mask: masks.pool
    } : null;

    this.updatePoolDecal(level, rgb, candela, axis, halfAngle, softness, state.prism, masks.pool);

    // Lens: lit in the light's colour; glow flares when you look into it.
    const lensLevel = level * (1.5 + 3 * Math.min(1, this.lumens / 8000));
    this.lens.material.emissive?.setRGB(r * lensLevel, g * lensLevel, b * lensLevel);
    const toCamera = tmpCamera.copy(this.shared.camera.position).sub(lensWorld).normalize();
    const facing = Math.max(0, axis.dot(toCamera));
    const flare = level * (0.12 + 1.2 * Math.pow(facing, 8));
    this.glow.position.copy(lensWorld).addScaledVector(axis, 0.02);
    this.glow.material.color.setRGB(r * flare, g * flare, b * flare);
    const size = this.lensRadius * (3 + 9 * Math.pow(facing, 4)) * (0.6 + 0.4 * Math.min(1, this.lumens / 5000));
    this.glow.scale.set(size, size, 1);
    this.glow.visible = flare > 0.002;

    this.state = { level, rgb, candela, axis, apex: lensWorld, halfAngle, slewing, strobing, turning };
    if (this.selection.visible) this.selection.update();
    return 0;
  }

  dispose() {
    const { scene, beamScene } = this.shared;
    scene.remove(this.root, this.selection);
    if (this.glow) { scene.remove(this.glow); this.glow.material.dispose(); }
    if (this.poolDecal) { scene.remove(this.poolDecal); this.poolDecal.material.dispose(); }
    this.beams?.forEach(beam => { beamScene.remove(beam.mesh); beam.dispose(); });
    this.mask.dispose();
    const shared = new Set(Object.values(MATERIALS));
    this.root.traverse(object => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      if (!shared.has(object.material)) object.material?.dispose?.();
    });
  }
}
