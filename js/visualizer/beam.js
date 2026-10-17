// Volumetric light beams.
//
// Each beam is a cone mesh (drawn from the inside, so it works with the camera
// inside the beam too). For every pixel the shader finds where the view ray
// enters and leaves the cone, stops it at the nearest solid surface (from the
// scene's depth buffer, so beams end on the stage instead of passing through
// it), and adds up the light that the haze scatters towards the camera:
//
//   light at a point  = intensity (candela) x beam profile / distance²
//   scattered to eye  = that x haze density x phase(angle) x drifting haze
//
// The phase function (Henyey-Greenstein) is why a real beam looks brighter
// when you look up it towards the fixture. The fixture's mask (gobos,
// effect wheel, framing; see gobos.js) shapes the cross-section, so
// patterns show in the haze as well as on stage.
// The number of steps along each ray is set by the quality preset.
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform vec3 uApex;
  uniform vec3 uAxis;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uTanHalf;
  uniform float uLength;
  uniform float uStart;
  uniform vec3 uColor;
  uniform float uSoft;
  uniform float uHaze;
  uniform float uTime;
  uniform float uHasMask;
  uniform sampler2D uMask;
  uniform sampler3D uNoise;
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform mat4 uProjectionInverse;
  varying vec3 vWorld;

  // Slowly drifting haze from a small tiling noise texture.
  float haze(vec3 p) {
    vec3 drift = vec3(uTime * 0.035, uTime * 0.012, -uTime * 0.025);
    float n = texture(uNoise, p * 0.11 + drift).r * 0.65 + texture(uNoise, p * 0.31 - drift * 1.7).r * 0.35;
    return 0.45 + 0.9 * n;
  }

  // Where the scene's nearest surface is along this pixel's view ray.
  float sceneDistance(vec2 uv) {
    float depth = texture2D(uSceneDepth, uv).x;
    vec4 view = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return length(view.xyz / view.w);
  }

  bool insideCone(vec3 p) {
    vec3 local = p - uApex;
    float h = dot(local, uAxis);
    if (h < 0.0 || h > uLength) return false;
    return length(local - uAxis * h) <= h * uTanHalf;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    float tExit = distance(vWorld, ro);

    // Where the ray enters the cone: the camera itself if it's inside,
    // otherwise the nearer intersection with the cone's side or end cap.
    float tEnter = tExit;
    if (insideCone(ro)) {
      tEnter = 0.0;
    } else {
      vec3 co = ro - uApex;
      float cos2 = 1.0 / (1.0 + uTanHalf * uTanHalf);
      float dv = dot(rd, uAxis);
      float cv = dot(co, uAxis);
      float a = dv * dv - cos2;
      float b = 2.0 * (dv * cv - dot(rd, co) * cos2);
      float c = cv * cv - dot(co, co) * cos2;
      float disc = b * b - 4.0 * a * c;
      if (disc >= 0.0 && abs(a) > 1e-6) {
        float s = sqrt(disc);
        for (int k = 0; k < 2; k++) {
          float t = (-b + (k == 0 ? -s : s)) / (2.0 * a);
          float h = cv + t * dv;
          if (t > 0.0 && t < tEnter && h >= 0.0 && h <= uLength) tEnter = t;
        }
      }
      if (abs(dv) > 1e-6) {
        float t = (uLength - cv) / dv;
        vec3 capOffset = ro + rd * t - uApex - uAxis * uLength;
        if (t > 0.0 && t < tEnter && length(capOffset) <= uLength * uTanHalf) tEnter = t;
      }
    }

    // Stop at the first solid surface (stage, set, masking).
    tExit = min(tExit, sceneDistance(gl_FragCoord.xy / uResolution));
    if (tExit <= tEnter) discard;

    float dt = (tExit - tEnter) / float(STEPS);
    // Per-pixel jitter hides banding between the steps.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float g = 0.35;
    float gg = g * g;
    float total = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float t = tEnter + (float(i) + jitter) * dt;
      vec3 p = ro + rd * t;
      vec3 local = p - uApex;
      float h = dot(local, uAxis);
      if (h < uStart) continue;
      vec3 radial = local - uAxis * h;
      float radius = h * uTanHalf;
      float r = length(radial) / radius;
      if (r > 1.0) continue;
      // Soft edge, plus the brighter centre real optics give.
      float profile = (1.0 - smoothstep(1.0 - uSoft, 1.0, r)) * (1.0 - 0.35 * r * r);
      if (uHasMask > 0.5) {
        vec2 uv = vec2(dot(radial, uRight), dot(radial, uUp)) / radius * 0.5 + 0.5;
        profile *= texture2D(uMask, uv).r;
      }
      // Inverse square, softened right at the lens.
      float light = profile / (h * h + 0.12);
      float mu = dot(local / max(length(local), 1e-4), -rd);
      float phase = (1.0 - gg) / pow(1.0 + gg - 2.0 * g * mu, 1.5);
      total += light * phase * haze(p);
    }
    gl_FragColor = vec4(uColor * uHaze * total * dt, 1.0);
  }
`;

// A small tiling 3D value-noise texture for the haze (one texture lookup per
// step instead of computing noise in the shader).
export function hazeNoiseTexture(size = 32) {
  const data = new Uint8Array(size * size * size);
  const lattice = new Float32Array(size * size * size).map(() => Math.random());
  const at = (x, y, z) => lattice[((z + size) % size) * size * size + ((y + size) % size) * size + ((x + size) % size)];
  // Smooth the random lattice a little so it reads as soft haze, not static.
  let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy, z + dz);
    data[i++] = Math.round((sum / 27) * 255);
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export function createBeamMaterial(shared, steps) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: { STEPS: steps },
    uniforms: {
      uApex: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, -1, 0) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 0, 1) },
      uTanHalf: { value: 0.2 },
      uLength: { value: 10 },
      uStart: { value: 0 },
      uColor: { value: new THREE.Color(0, 0, 0) },
      uSoft: { value: 0.3 },
      uHaze: shared.haze,
      uTime: shared.time,
      uHasMask: { value: 0 },
      uMask: { value: null },
      uNoise: shared.noise,
      uSceneDepth: shared.depth,
      uResolution: shared.resolution,
      uProjectionInverse: shared.projectionInverse
    },
    side: THREE.BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor
  });
}

// One cone geometry shared by every beam: apex at the origin, opening
// along +Y, height 1 and radius 1 (scaled per beam).
const coneGeometry = new THREE.ConeGeometry(1, 1, 40, 1, false);
coneGeometry.translate(0, -0.5, 0);
coneGeometry.rotateX(Math.PI); // apex at the origin, base at y = +1
const LOCAL_AXIS = new THREE.Vector3(0, 1, 0);

const tmp = new THREE.Vector3();
const quat = new THREE.Quaternion();

// A stable right/up pair around the axis for laying the mask across the beam.
function basis(axis, right, up) {
  const reference = Math.abs(axis.y) > 0.95 ? tmp.set(0, 0, 1) : tmp.set(0, 1, 0);
  right.crossVectors(reference, axis).normalize();
  up.crossVectors(axis, right).normalize();
}

// A beam volume. update() places it: apex (world), unit axis, half angle in
// radians, length to the surface it lands on, colour already scaled by
// candela, softness, start distance (the lens), and the mask.
export class BeamVolume {
  constructor(shared, steps) {
    this.material = createBeamMaterial(shared, steps);
    this.mesh = new THREE.Mesh(coneGeometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setSteps(steps) {
    if (this.material.defines.STEPS === steps) return;
    this.material.defines.STEPS = steps;
    this.material.needsUpdate = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  update({ apex, axis, halfAngle, length, colour, softness, start, mask }) {
    const u = this.material.uniforms;
    const visible = colour.r + colour.g + colour.b > 1e-4;
    this.mesh.visible = visible;
    if (!visible) return;
    const tanHalf = Math.tan(Math.min(halfAngle, 1.45));
    u.uApex.value.copy(apex);
    u.uAxis.value.copy(axis);
    u.uTanHalf.value = tanHalf;
    u.uLength.value = length;
    u.uStart.value = start;
    u.uColor.value.copy(colour);
    u.uSoft.value = Math.max(0.03, Math.min(1, softness));
    u.uHasMask.value = mask ? 1 : 0;
    u.uMask.value = mask;
    basis(axis, u.uRight.value, u.uUp.value);
    // Slightly oversized cone so the faceted mesh fully contains the true
    // cone the shader traces.
    const radius = length * tanHalf * 1.03 + 0.02;
    this.mesh.position.copy(apex);
    this.mesh.quaternion.copy(quat.setFromUnitVectors(LOCAL_AXIS, axis));
    this.mesh.scale.set(radius, length, radius);
  }

  dispose() {
    this.material.dispose();
  }
}
