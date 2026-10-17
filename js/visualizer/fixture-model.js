// One patched fixture in the visualiser: its body, the real spotlight that
// lights the stage, the volumetric beam in the haze and the lens glow.
//
// Every fixture hangs from a clamp point. A yoke turns around the vertical
// (pan) and the head tilts inside it; the lens points along the head's +Z.
// Moving heads take pan/tilt from DMX; fixed fixtures are aimed by hand.
import * as THREE from "three";
import { BeamVolume } from "./beam.js";
import { beamMask, glow, ledLens } from "./gobos.js";
import { archetype, ratedLumens } from "./decode.js";

const black = () => new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.55, metalness: 0.35 });
const cylinderZ = (r1, r2, length, segments = 24) => new THREE.CylinderGeometry(r1, r2, length, segments).rotateX(Math.PI / 2);

const MOVING = new Set(["movingSpot", "movingWash", "movingBeam"]);
const ON_FLOOR = new Set(["fogger", "hazer"]);
const LED_TYPES = new Set(["rgb", "rgbw", "rgbal", "rgbalc", "bar", "wash", "blinder"]);

// Body geometry for each kind of fixture. Returns the yoke's drop below the
// clamp, the head parts, and where the lens is.
function buildBody(kind, def) {
  const head = new THREE.Group();
  const parts = [];
  const add = (geometry, position, material = black()) => {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    mesh.castShadow = true;
    head.add(mesh);
    parts.push(mesh);
    return mesh;
  };
  let lensRadius = 0.1;
  let lensZ = 0.15;
  let lensShape = "round";
  let drop = 0.22; // clamp to tilt pivot
  let base = null;

  switch (kind) {
    case "movingSpot":
    case "movingBeam":
    case "movingWash": {
      const wash = kind === "movingWash";
      const beam = kind === "movingBeam";
      lensRadius = wash ? 0.13 : beam ? 0.07 : 0.085;
      const length = wash ? 0.26 : 0.36;
      add(cylinderZ(lensRadius + 0.03, lensRadius + 0.05, length, 28), [0, 0, 0]);
      add(cylinderZ(lensRadius + 0.035, lensRadius + 0.035, 0.03, 28), [0, 0, length / 2 - 0.015], new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.6 }));
      lensZ = length / 2 + 0.001;
      base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.3), black());
      base.position.y = -0.07;
      drop = 0.42;
      break;
    }
    case "fresnel":
      add(new THREE.BoxGeometry(0.3, 0.3, 0.32), [0, 0, 0]);
      lensRadius = 0.12;
      lensZ = 0.161;
      break;
    case "profile":
      add(new THREE.BoxGeometry(0.22, 0.24, 0.26), [0, 0, -0.18]);
      add(cylinderZ(0.075, 0.09, 0.42), [0, 0, 0.13]);
      lensRadius = 0.07;
      lensZ = 0.341;
      break;
    case "bar":
      add(new THREE.BoxGeometry(1, 0.09, 0.11), [0, 0, 0]);
      lensRadius = 0.04;
      lensZ = 0.056;
      lensShape = "strip";
      drop = 0.14;
      break;
    case "strobe":
      add(new THREE.BoxGeometry(0.5, 0.2, 0.16), [0, 0, 0]);
      lensRadius = 0.08;
      lensZ = 0.081;
      lensShape = "panel";
      drop = 0.18;
      break;
    case "blinder":
      add(new THREE.BoxGeometry(0.52, 0.26, 0.14), [0, 0, 0]);
      lensRadius = 0.1;
      lensZ = 0.071;
      lensShape = "twin";
      break;
    case "fogger":
    case "hazer":
      add(new THREE.BoxGeometry(0.5, 0.28, 0.32), [0, 0.14, 0], new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.6, metalness: 0.3 }));
      add(cylinderZ(0.03, 0.03, 0.08), [0, 0.16, 0.2]);
      lensRadius = 0.03;
      lensZ = 0.24;
      drop = 0;
      break;
    default: // LED / can par
      add(cylinderZ(0.11, 0.12, 0.24, 28), [0, 0, 0]);
      lensRadius = 0.1;
      lensZ = 0.121;
  }

  // The lens: glows with the fixture's colour, which the bloom picks up.
  const led = LED_TYPES.has(def?.type) || lensShape === "strip";
  const lensMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, map: led ? ledLens() : null });
  let lensGeometry;
  if (lensShape === "strip") {
    lensGeometry = new THREE.PlaneGeometry(0.94, 0.06);
    lensMaterial.map = ledLens().clone();
    lensMaterial.map.wrapS = THREE.RepeatWrapping;
    lensMaterial.map.repeat.set(12, 1);
    lensMaterial.map.needsUpdate = true;
  } else if (lensShape === "panel") lensGeometry = new THREE.PlaneGeometry(0.42, 0.13);
  else if (lensShape === "twin") lensGeometry = new THREE.CircleGeometry(lensRadius, 24).translate(-0.12, 0, 0).toNonIndexed();
  else lensGeometry = new THREE.CircleGeometry(lensRadius, 32);
  const lens = new THREE.Mesh(lensGeometry, lensMaterial);
  lens.position.z = lensZ;
  head.add(lens);
  if (lensShape === "twin") {
    const second = lens.clone();
    second.position.x = 0.24;
    head.add(second);
    lens.userData.twin = second;
  }

  return { head, parts, lens, lensRadius, lensZ, drop, base };
}

// Barn doors on fresnels: four leaves hinged round the lens that fold in as
// the blades close.
function buildBarnDoors(head, lensZ) {
  const leaves = [];
  const material = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const hinge = new THREE.Group();
    hinge.rotation.z = (i * Math.PI) / 2;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.16, lensZ + 0.01);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.16).rotateX(Math.PI / 2).translate(0, 0, 0.08), material);
    leaf.castShadow = true;
    pivot.add(leaf);
    hinge.add(pivot);
    head.add(hinge);
    leaves.push({ hinge, pivot });
  }
  return leaves;
}

const tmpAxis = new THREE.Vector3();
const tmpLens = new THREE.Vector3();
const tmpCamera = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

export class Fixture {
  constructor(fixture, def, shared, { castShadow = false } = {}) {
    this.fixture = fixture;
    this.def = def;
    this.id = String(fixture.id);
    this.kind = archetype(def, fixture.name);
    this.moving = MOVING.has(this.kind);
    this.onFloor = ON_FLOOR.has(this.kind);
    this.emitsLight = !this.onFloor && this.kind !== "mirrorBall";
    this.shared = shared;
    this.lumens = ratedLumens(def);
    this.goboAngle = 0;
    this.lastAxis = new THREE.Vector3();
    this.lastApex = new THREE.Vector3();
    this.beamLength = 12;

    this.root = new THREE.Group();
    this.root.userData.fixtureId = this.id;
    this.yoke = new THREE.Group();
    this.root.add(this.yoke);

    const body = buildBody(this.kind, def);
    this.head = body.head;
    this.lens = body.lens;
    this.lensRadius = body.lensRadius;
    this.lensLocal = new THREE.Vector3(0, 0, body.lensZ);
    this.parts = [...body.parts];

    if (this.onFloor) {
      this.root.add(this.head);
    } else {
      // Clamp and yoke.
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), black());
      clamp.position.y = -0.03;
      this.root.add(clamp);
      this.parts.push(clamp);
      if (body.base) {
        this.root.add(body.base);
        this.parts.push(body.base);
        this.yoke.position.y = -0.14;
      } else this.yoke.position.y = -0.06;
      const span = this.kind === "bar" ? 1.06 : this.kind === "strobe" || this.kind === "blinder" ? 0.58 : 0.36;
      const yokeMaterial = black();
      const arm = new THREE.BoxGeometry(0.035, body.drop, 0.06);
      for (const side of [-1, 1]) {
        const a = new THREE.Mesh(arm, yokeMaterial);
        a.position.set((side * span) / 2, -body.drop / 2, 0);
        a.castShadow = true;
        this.yoke.add(a);
        this.parts.push(a);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(span, 0.03, 0.06), yokeMaterial);
      this.yoke.add(top);
      this.parts.push(top);
      this.head.position.y = -body.drop;
      this.yoke.add(this.head);
    }
    this.parts.forEach(part => { part.userData.fixtureId = this.id; });
    this.lens.userData.fixtureId = this.id;
    this.barnDoors = this.kind === "fresnel" ? buildBarnDoors(this.head, body.lensZ) : null;

    // Light, beam and glow.
    if (this.emitsLight) {
      this.spot = new THREE.SpotLight(0xffffff, 0, 0, 0.3, 0.3, 2);
      this.spot.castShadow = castShadow;
      if (castShadow) {
        this.spot.shadow.mapSize.set(1024, 1024);
        this.spot.shadow.camera.near = 0.3;
        this.spot.shadow.camera.far = 40;
        this.spot.shadow.bias = -0.0004;
        this.spot.shadow.normalBias = 0.02;
      }
      shared.scene.add(this.spot, this.spot.target);
      this.beam = new BeamVolume(shared.uniforms);
      shared.beamScene.add(this.beam.mesh);
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      this.glow.renderOrder = 2;
      shared.scene.add(this.glow);
    }

    this.selection = new THREE.BoxHelper(this.root, 0x19d6a3);
    this.selection.visible = false;
    shared.scene.add(this.selection);
    shared.scene.add(this.root);
    this.target = new THREE.Vector3(0, 1, -4);
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

  // yaw: around the vertical; pitch: 0 = level, +π/2 = straight down.
  setAngles(yaw, pitch) {
    this.yoke.rotation.y = yaw;
    this.head.rotation.x = pitch;
  }

  setSelected(on) {
    this.selection.visible = on;
    if (on) this.selection.update();
  }

  // Apply a decoded DMX state. Returns how much fog the fixture is making.
  update(state, time, dt, settings) {
    if (this.moving && state.pan != null) {
      // Hung upside down: pan turns the yoke, tilt 0 points straight down.
      this.setAngles(state.pan, Math.PI / 2 + (state.tilt ?? 0));
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
    if (!this.emitsLight) return this.onFloor ? state.fog : 0;

    let level = state.intensity;
    if (state.strobeRate > 0) level *= (time * state.strobeRate) % 1 < 0.22 ? 1 : 0;
    if (settings.blackout) level = 0;

    this.root.updateMatrixWorld(true);
    const axis = this.head.getWorldDirection(tmpAxis);
    const lensWorld = this.head.localToWorld(tmpLens.copy(this.lensLocal));
    const halfAngle = ((state.beamAngle * (state.prism ? 1.4 : 1)) * Math.PI) / 360;
    const softness = state.softness + (state.prism ? 0.2 : 0);

    // Candela from lumens spread over the beam's solid angle.
    const solidAngle = 2 * Math.PI * (1 - Math.cos(Math.max(halfAngle, 0.02)));
    const candela = (this.lumens / solidAngle) * level;
    const [r, g, b] = state.rgb;

    // Spotlight: the pool on the stage.
    this.spot.position.copy(lensWorld);
    this.spot.target.position.copy(lensWorld).addScaledVector(axis, 10);
    this.spot.target.updateMatrixWorld();
    this.spot.angle = Math.min(1.5, halfAngle * (1 + softness * 0.35));
    this.spot.penumbra = Math.min(1, 0.15 + softness * 0.85);
    this.spot.color.setRGB(r, g, b);
    this.spot.intensity = candela * this.shared.lightScale;

    // Gobo / framing.
    this.goboAngle += state.goboSpin * dt * Math.PI;
    const mask = beamMask(state.gobo, state.framing);
    if (this.spot.castShadow && this.spot.map !== mask) this.spot.map = mask;

    // Beam length: to the first solid thing along the axis.
    if (this.lastAxis.distanceToSquared(axis) > 1e-7 || this.lastApex.distanceToSquared(lensWorld) > 1e-7) {
      raycaster.set(lensWorld, axis);
      raycaster.far = 60;
      const hit = raycaster.intersectObjects(this.shared.solids, false)[0];
      this.beamLength = hit ? hit.distance + 0.6 : 30;
      this.lastAxis.copy(axis);
      this.lastApex.copy(lensWorld);
      this.shared.shadowsDirty = true;
    }
    if (Math.abs(this.spot.angle - (this.lastAngle ?? 0)) > 1e-4) {
      this.lastAngle = this.spot.angle;
      this.shared.shadowsDirty = true;
    }
    const tanHalf = Math.tan(Math.max(halfAngle, 0.004));
    const back = Math.min(0.6, this.lensRadius / tanHalf);
    const apex = lensWorld.clone().addScaledVector(axis, -back);
    const colour = new THREE.Color(r, g, b).multiplyScalar(settings.beams ? candela * this.shared.beamScale : 0);
    this.beam.update({ apex, axis, halfAngle, length: this.beamLength + back, colour, softness, start: back, mask, maskRotation: this.goboAngle });

    // Lens: emissive in the light's colour; glow flares when you look into it.
    const lensLevel = level * (0.6 + 3 * Math.min(1, this.lumens / 8000));
    this.lens.material.color.setRGB(r * lensLevel * 4, g * lensLevel * 4, b * lensLevel * 4);
    if (this.lens.userData.twin) this.lens.userData.twin.material = this.lens.material;
    const toCamera = tmpCamera.copy(this.shared.camera.position).sub(lensWorld).normalize();
    const facing = Math.max(0, axis.dot(toCamera));
    const flare = level * (0.15 + 2.2 * Math.pow(facing, 8));
    this.glow.position.copy(lensWorld).addScaledVector(axis, 0.02);
    this.glow.material.color.setRGB(r * flare, g * flare, b * flare);
    const size = this.lensRadius * (3 + 9 * Math.pow(facing, 4)) * (0.6 + 0.4 * Math.min(1, this.lumens / 5000));
    this.glow.scale.set(size, size, 1);
    this.glow.visible = flare > 0.002;

    this.state = { level, rgb: state.rgb, candela, axis: axis.clone(), apex: lensWorld.clone(), halfAngle };
    if (this.selection.visible) this.selection.update();
    return 0;
  }

  dispose() {
    const { scene, beamScene } = this.shared;
    scene.remove(this.root, this.selection);
    if (this.spot) { scene.remove(this.spot, this.spot.target, this.glow); this.spot.dispose(); }
    if (this.beam) { beamScene.remove(this.beam.mesh); this.beam.dispose(); }
    this.root.traverse(object => {
      object.geometry?.dispose?.();
      if (object.material && object.material.map !== ledLens()) object.material.dispose?.();
    });
  }
}
