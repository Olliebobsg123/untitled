// Haze and fog.
//
// The haze level is what makes beams visible: the room's base haze from the
// toolbar plus whatever patched hazers and fog machines have put into the
// air (a hazer at full roughly quadruples it). Haze builds up in about ten
// seconds and takes a minute or two to clear, like the real thing, and as
// it builds the whole room goes milky in the colour of the light on stage.
//
// Fog machines blow clouds that roll out low and spread across the floor;
// hazers breathe a thin plume. Every puff is lit by the beams that pass
// through it (in their colour), plus a little of the general stage light.
import * as THREE from "three";
import { glow } from "./gobos.js";

const MAX_PARTICLES = 1400;
const HAZE_CAP = 3.5;

// The puffs are drawn into the beams' low-resolution layer (main.js), added
// on like the beams: fog is a lot of big soft sprites, and drawing them at
// full resolution was the slowest part of a smoky stage. They test against
// the stage's depth themselves and fade out just before a surface (soft
// particles), so there's no hard line where a cloud meets the floor.
const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vDistance;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
    vDistance = length(mv.xyz);
  }
`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform mat4 uProjectionInverse;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vDistance;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.002) discard;
    vec2 uv = gl_FragCoord.xy / uResolution;
    float depth = texture2D(uSceneDepth, uv).x;
    vec4 view = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    float surface = length(view.xyz / view.w);
    a *= clamp((surface - vDistance + 0.15) / 0.6, 0.0, 1.0);
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

const tmp = new THREE.Vector3();

export class Atmosphere {
  constructor(shared) {
    this.shared = shared;
    this.machineHaze = 0;
    this.particles = [];
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uMap: { value: glow() }, uScale: { value: 500 }, uSceneDepth: shared.uniforms.depth, uResolution: shared.uniforms.resolution, uProjectionInverse: shared.uniforms.projectionInverse },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    (shared.beamScene || shared.scene).add(this.points);
    // The air itself: distant things fade into lit haze as the room fills.
    this.air = new THREE.FogExp2(0x000000, 0);
    shared.scene.fog = this.air;
    this.carry = 0;
    this.hazeCarry = 0;
  }

  setViewportHeight(pixels, fov) {
    this.material.uniforms.uScale.value = pixels / (2 * Math.tan((fov * Math.PI) / 360));
  }

  // machines: [{ kind: "fogger"|"hazer", output 0-1, nozzle, direction }]
  // stageLight: average colour/brightness of the light in the room.
  // lights: lit fixtures [{ level, rgb, candela, apex, axis, halfAngle }]
  update(dt, machines, baseHaze, stageLight, lights = []) {
    const target = machines.reduce((sum, m) => sum + m.output * (m.kind === "hazer" ? 2.4 : 1.1), 0);
    const rate = target > this.machineHaze ? 1 / 8 : 1 / 90;
    this.machineHaze += (target - this.machineHaze) * Math.min(1, dt * rate * 3);

    for (const machine of machines) {
      if (machine.output < 0.02) continue;
      if (machine.kind === "hazer") {
        // A thin plume that drifts up and spreads into the room.
        this.hazeCarry += machine.output * 16 * dt;
        while (this.hazeCarry >= 1 && this.particles.length < MAX_PARTICLES) {
          this.hazeCarry -= 1;
          const spread = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
          this.particles.push({
            position: machine.nozzle.clone(),
            velocity: machine.direction.clone().multiplyScalar(1.4 + Math.random() * 0.8).add(spread),
            age: 0, life: 12 + Math.random() * 8, size: 0.5 + Math.random() * 0.4, faint: true
          });
        }
        continue;
      }
      // Fog: a fast jet that slows, sinks and rolls out across the floor.
      this.carry += machine.output * 75 * dt;
      while (this.carry >= 1 && this.particles.length < MAX_PARTICLES) {
        this.carry -= 1;
        const spread = new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.2, (Math.random() - 0.5) * 0.9);
        this.particles.push({
          position: machine.nozzle.clone(),
          velocity: machine.direction.clone().multiplyScalar(2.8 + Math.random() * 2.2).add(spread),
          age: 0,
          life: 18 + Math.random() * 12,
          size: 0.35 + Math.random() * 0.3,
          // Each puff wanders its own way once the jet dies down, so the cloud spreads wide.
          drift: new THREE.Vector3((Math.random() - 0.5) * 1.3, 0, (Math.random() - 0.3) * 1.1) // spreads out, and downstage
        });
      }
    }

    // Light falling on the smoke from each beam: its colour, over distance
    // squared, full inside the cone and fading out just past its edge.
    const beams = [];
    for (const l of lights) {
      if (!(l.level > 0) || !l.apex || !l.axis || !l.rgb) continue;
      const k = (l.candela || 0) * (this.shared.beamScale || 1) * 1.1;
      if (k <= 0) continue;
      const half = l.spread || l.halfAngle || 0.2; // where the light reaches (the field angle)
      beams.push({ apex: l.apex, axis: l.axis, cos: Math.cos(Math.min(1.4, half * 1.15)), cosIn: Math.cos(Math.min(1.4, half * 0.7)), r: l.rgb[0] * k, g: l.rgb[1] * k, b: l.rgb[2] * k });
    }
    const ambR = 0.01 + stageLight.r * 0.3, ambG = 0.01 + stageLight.g * 0.3, ambB = 0.012 + stageLight.b * 0.3; // a little general light; the beams themselves do most of it

    let count = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age > p.life) { this.particles.splice(i, 1); continue; }
      p.velocity.multiplyScalar(Math.exp(-0.8 * dt));
      if (p.faint) p.velocity.y += 0.05 * dt; // haze rises and spreads
      else {
        p.velocity.y += (p.position.y > 0.4 ? -0.12 : 0.02) * dt; // fog is heavy: it sinks and hugs the floor
        if (p.drift) p.position.addScaledVector(p.drift, dt * Math.min(1, p.age / 3));
      }
      p.position.addScaledVector(p.velocity, dt);
      if (p.position.y < 0.05) { p.position.y = 0.05; p.velocity.y = Math.abs(p.velocity.y) * 0.2; }
      const life = p.age / p.life;

      let r = ambR, g = ambG, b = ambB;
      for (const beam of beams) {
        tmp.copy(p.position).sub(beam.apex);
        const d = tmp.length();
        if (d < 0.05) continue;
        const c = tmp.dot(beam.axis) / d;
        if (c <= beam.cos) continue;
        const edge = c >= beam.cosIn ? 1 : (c - beam.cos) / (beam.cosIn - beam.cos);
        const f = edge / (d * d + 0.12);
        r += beam.r * f; g += beam.g * f; b += beam.b * f;
      }
      const o = count * 3;
      this.positions[o] = p.position.x; this.positions[o + 1] = p.position.y; this.positions[o + 2] = p.position.z;
      this.colors[o] = Math.min(4, r); this.colors[o + 1] = Math.min(4, g); this.colors[o + 2] = Math.min(4, b);
      this.sizes[count] = p.size + life * (p.faint ? 6 : 7);
      // Stays thick for most of its life, then thins away.
      this.alphas[count] = Math.min(1, p.age * 2.5) * (1 - life * life) * (p.faint ? 0.14 : 0.55);
      count++;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, count);
    for (const name of ["position", "aSize", "aAlpha", "aColor"]) geometry.attributes[name].needsUpdate = true;

    // The air goes milky in the colour of the light on stage as haze builds.
    // Kept subtle: a real hazy room stays dark; it's the beams that pop.
    const thick = Math.min(1, this.machineHaze / 2.4);
    const glowLevel = 0.12 + 0.45 * thick;
    this.air.density = this.machineHaze < 0.01 ? 0 : 0.004 + 0.022 * thick;
    this.air.color.setRGB(Math.min(0.06, stageLight.r * glowLevel), Math.min(0.06, stageLight.g * glowLevel), Math.min(0.07, stageLight.b * glowLevel));

    return Math.min(HAZE_CAP, baseHaze + this.machineHaze);
  }

  get busy() {
    return this.particles.length > 0 || this.machineHaze > 0.001;
  }
}
