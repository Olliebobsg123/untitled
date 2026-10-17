// A mirror ball that follows the physics of a real one.
//
// It only exists when a mirror-ball motor is patched, and only throws
// reflections when a fixture's beam actually hits it. Each facet is a small
// flat mirror: light arriving from a fixture leaves in the mirror direction
// and lands on the first wall/floor/stage surface it meets. A spot's size
// grows with distance by the apparent size of the light source (a fixture's
// lens seen from the ball), so far walls get bigger, dimmer spots. The motor
// channel sets the spin; real motors turn at 1-4 RPM.
import * as THREE from "three";
import { glow } from "./gobos.js";
import { ROOM, STAGE, STAGE_TOP, CYC_Z } from "./theatre.js";

const RADIUS = 0.25;
const FACETS = 420;
const MAX_SPOTS = 1600;
const MAX_RPM = 4;

// Surfaces a reflection can land on: axis-aligned rectangles.
const SURFACES = [
  { axis: "y", value: 0, normal: 1, bounds: { x: [ROOM.minX, ROOM.maxX], z: [0, ROOM.maxZ] } },
  { axis: "y", value: STAGE_TOP, normal: 1, bounds: { x: [-STAGE.width / 2, STAGE.width / 2], z: [STAGE.frontZ - STAGE.depth, STAGE.frontZ] } },
  { axis: "y", value: 0, normal: 1, bounds: { x: [ROOM.minX, ROOM.maxX], z: [ROOM.minZ, STAGE.frontZ - STAGE.depth] } },
  { axis: "z", value: STAGE.frontZ, normal: 1, bounds: { x: [-STAGE.width / 2, STAGE.width / 2], y: [0, STAGE_TOP] } },
  { axis: "z", value: CYC_Z, normal: 1, bounds: { x: [-(STAGE.width - 1) / 2, (STAGE.width - 1) / 2], y: [STAGE_TOP, STAGE_TOP + 7] } },
  { axis: "y", value: ROOM.maxY, normal: -1, bounds: { x: [ROOM.minX, ROOM.maxX], z: [ROOM.minZ, ROOM.maxZ] } },
  { axis: "x", value: ROOM.minX, normal: 1, bounds: { y: [0, ROOM.maxY], z: [ROOM.minZ, ROOM.maxZ] } },
  { axis: "x", value: ROOM.maxX, normal: -1, bounds: { y: [0, ROOM.maxY], z: [ROOM.minZ, ROOM.maxZ] } },
  { axis: "z", value: ROOM.maxZ, normal: -1, bounds: { x: [ROOM.minX, ROOM.maxX], y: [0, ROOM.maxY] } },
  { axis: "z", value: ROOM.minZ, normal: 1, bounds: { x: [ROOM.minX, ROOM.maxX], y: [0, ROOM.maxY] } }
];
const AXES = ["x", "y", "z"];

function hitRoom(origin, direction) {
  let best = null;
  for (const surface of SURFACES) {
    const d = direction[surface.axis];
    if (Math.abs(d) < 1e-6 || Math.sign(d) === surface.normal) continue; // must travel towards the surface's face
    const t = (surface.value - origin[surface.axis]) / d;
    if (t <= 1e-3 || (best && t >= best.t)) continue;
    let inside = true;
    for (const axis of AXES) {
      if (axis === surface.axis || !surface.bounds[axis]) continue;
      const v = origin[axis] + direction[axis] * t;
      if (v < surface.bounds[axis][0] || v > surface.bounds[axis][1]) { inside = false; break; }
    }
    if (inside) best = { t, surface };
  }
  if (!best) return null;
  const normal = new THREE.Vector3();
  normal[best.surface.axis] = best.surface.normal;
  return { distance: best.t, normal };
}

// Evenly spread facet directions (Fibonacci sphere).
function facetNormals() {
  const normals = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < FACETS; i++) {
    const y = 1 - (i / (FACETS - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    normals.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return normals;
}

function facetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = "#000";
  g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

// A ray in the haze: brightest at the ball, fading towards the wall.
function rayTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  const gradient = g.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(255,255,255,1)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(canvas);
}

const tmp = {
  dirIn: new THREE.Vector3(), normal: new THREE.Vector3(), reflect: new THREE.Vector3(), facet: new THREE.Vector3(),
  toEye: new THREE.Vector3(), hit: new THREE.Vector3(), matrix: new THREE.Matrix4(), quat: new THREE.Quaternion(),
  scale: new THREE.Vector3(), colour: new THREE.Color(), up: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1)
};

export class MirrorBall {
  constructor(shared) {
    this.shared = shared;
    this.angle = 0;
    this.normals = facetNormals();
    this.group = new THREE.Group();

    const bump = facetTexture();
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 64, 40),
      new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.18, bumpMap: bump, bumpScale: 2.5, envMap: shared.envMap, envMapIntensity: 0.35 })
    );
    this.ball.castShadow = true;
    this.group.add(this.ball);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 1, roughness: 0.4 }));
    this.chain = chain;
    this.group.add(chain);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }));
    motor.position.y = RADIUS + 0.06;
    this.group.add(motor);
    shared.scene.add(this.group);

    // Spots where reflections land, rays through the haze, and glints.
    const spotMaterial = new THREE.MeshBasicMaterial({ map: glow(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: true });
    this.spots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), spotMaterial, MAX_SPOTS);
    this.spots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spots.setColorAt(0, new THREE.Color(0, 0, 0));
    this.spots.frustumCulled = false;
    this.spots.count = 0;
    shared.scene.add(this.spots);

    // A ray starts as wide as a facet at the ball and spreads to the spot's
    // size at the far end (radius 1 there; scaled per ray).
    const rayGeometry = new THREE.CylinderGeometry(1, 0.08, 1, 6, 1, true).translate(0, 0.5, 0);
    const rayMaterial = new THREE.MeshBasicMaterial({ map: rayTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.rays = new THREE.InstancedMesh(rayGeometry, rayMaterial, MAX_SPOTS);
    this.rays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rays.setColorAt(0, new THREE.Color(0, 0, 0));
    this.rays.frustumCulled = false;
    this.rays.count = 0;
    shared.scene.add(this.rays);

    this.glintPositions = new Float32Array(FACETS * 3);
    this.glintColours = new Float32Array(FACETS * 3);
    const glintGeometry = new THREE.BufferGeometry();
    glintGeometry.setAttribute("position", new THREE.BufferAttribute(this.glintPositions, 3));
    glintGeometry.setAttribute("color", new THREE.BufferAttribute(this.glintColours, 3));
    this.glints = new THREE.Points(glintGeometry, new THREE.PointsMaterial({ size: 0.12, map: glow(), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.glints.frustumCulled = false;
    shared.scene.add(this.glints);

    this.root = this.group; // for picking/moving like a fixture
    this.group.userData.mirrorBall = true;
  }

  place(position) {
    this.group.position.set(position.x, position.y, position.z);
    const drop = ROOM.maxY - position.y - RADIUS;
    this.chain.scale.y = Math.max(0.01, drop);
    this.chain.position.y = RADIUS + drop / 2;
  }

  // lights: [{ apex, axis, halfAngle, candela, rgb, level, lensRadius }]
  update(dt, speed, lights, haze) {
    this.angle += (speed * MAX_RPM / 60) * dt * Math.PI * 2;
    this.ball.rotation.y = this.angle;
    const spin = tmp.quat.setFromAxisAngle(tmp.up, this.angle).clone();
    const centre = this.group.position;
    const eye = this.shared.camera.position;
    let spots = 0;
    let glints = 0;

    for (const light of lights) {
      if (!(light.level > 0.001)) continue;
      const toBall = tmp.dirIn.copy(centre).sub(light.apex);
      const distance = toBall.length();
      toBall.divideScalar(distance);
      // Is the ball inside this fixture's beam? (soft edge)
      const off = Math.acos(Math.min(1, toBall.dot(light.axis)));
      const edge = light.halfAngle * 1.2;
      if (off > edge) continue;
      const profile = 1 - THREE.MathUtils.smoothstep(off, light.halfAngle * 0.8, edge);
      const lux = (light.candela * profile) / (distance * distance);
      // Apparent size of the source from the ball: how fast each reflection spreads.
      const spread = Math.max(0.004, (light.lensRadius * 2) / distance);
      const facetArea = (4 * Math.PI * RADIUS * RADIUS) / FACETS;

      for (const local of this.normals) {
        const normal = tmp.normal.copy(local).applyQuaternion(spin);
        const facing = -toBall.dot(normal);
        if (facing <= 0) continue;
        const facet = tmp.facet.copy(centre).addScaledVector(normal, RADIUS);
        const reflect = tmp.reflect.copy(toBall).addScaledVector(normal, 2 * facing);
        // Reflected intensity (candela) of this facet's little beam.
        const intensity = (lux * facetArea * facing * 0.85) / (spread * spread * Math.PI / 4);

        const toEye = tmp.toEye.copy(eye).sub(facet).normalize();
        const alignment = toEye.dot(reflect);
        if (alignment > 0.995 && glints < FACETS) {
          const k = Math.min(30, intensity * 1e-4 * Math.pow((alignment - 0.995) / 0.005, 2)) * light.level;
          this.glintPositions.set([facet.x, facet.y, facet.z], glints * 3);
          this.glintColours.set([light.rgb[0] * k, light.rgb[1] * k, light.rgb[2] * k], glints * 3);
          glints++;
        }

        if (spots >= MAX_SPOTS) continue;
        const hit = hitRoom(facet, reflect);
        if (!hit) continue;
        const size = 0.03 + hit.distance * spread;
        const incidence = Math.abs(reflect.dot(hit.normal));
        const illuminance = (intensity * incidence) / (hit.distance * hit.distance);
        const brightness = Math.min(40, illuminance * this.shared.lightScale * 1.5);
        const point = tmp.hit.copy(facet).addScaledVector(reflect, hit.distance).addScaledVector(hit.normal, 0.01);

        tmp.matrix.compose(point, new THREE.Quaternion().setFromUnitVectors(tmp.z, hit.normal), tmp.scale.setScalar(size / Math.sqrt(Math.max(0.25, incidence))));
        this.spots.setMatrixAt(spots, tmp.matrix);
        this.spots.setColorAt(spots, tmp.colour.setRGB(light.rgb[0] * brightness, light.rgb[1] * brightness, light.rgb[2] * brightness));

        // Light scattered out of a thin ray is faint: it only shows in haze.
        const rayStrength = Math.min(0.6, intensity * haze * 2.5e-5);
        tmp.matrix.compose(facet, new THREE.Quaternion().setFromUnitVectors(tmp.up, reflect), tmp.scale.set(size * 0.35, hit.distance, size * 0.35));
        this.rays.setMatrixAt(spots, tmp.matrix);
        this.rays.setColorAt(spots, tmp.colour.setRGB(light.rgb[0] * rayStrength, light.rgb[1] * rayStrength, light.rgb[2] * rayStrength));
        spots++;
      }
    }

    this.spots.count = spots;
    this.rays.count = spots;
    if (spots) {
      this.spots.instanceMatrix.needsUpdate = this.rays.instanceMatrix.needsUpdate = true;
      this.spots.instanceColor.needsUpdate = this.rays.instanceColor.needsUpdate = true;
    }
    this.glints.geometry.setDrawRange(0, glints);
    this.glints.geometry.attributes.position.needsUpdate = true;
    this.glints.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    const scene = this.shared.scene;
    scene.remove(this.group, this.spots, this.rays, this.glints);
    [this.ball, this.chain, this.spots, this.rays, this.glints].forEach(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
