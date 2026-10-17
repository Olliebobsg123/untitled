// Haze and fog.
//
// The haze level (0-1.5) is what makes beams visible: the room's base haze
// from the toolbar plus whatever patched hazers and fog machines have put
// into the air. Haze builds up over ~20s and takes a minute or two to clear,
// like the real thing. Fog machines also blow visible clouds that roll out
// low along the floor, lit by whatever is on stage.
import * as THREE from "three";
import { glow } from "./gobos.js";

const MAX_PARTICLES = 500;

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
  }
`;
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Atmosphere {
  constructor(shared) {
    this.shared = shared;
    this.machineHaze = 0;
    this.particles = [];
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uColor: { value: new THREE.Color(0.05, 0.05, 0.06) }, uMap: { value: glow() }, uScale: { value: 500 } },
      transparent: true,
      depthWrite: false
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    shared.scene.add(this.points);
    this.carry = 0;
  }

  setViewportHeight(pixels, fov) {
    this.material.uniforms.uScale.value = pixels / (2 * Math.tan((fov * Math.PI) / 360));
  }

  // machines: [{ kind: "fogger"|"hazer", output 0-1, nozzle, direction }]
  // stageLight: average colour/brightness of the light in the room.
  update(dt, machines, baseHaze, stageLight) {
    const target = machines.reduce((sum, m) => sum + m.output * (m.kind === "hazer" ? 0.8 : 0.45), 0);
    const rate = target > this.machineHaze ? 1 / 20 : 1 / 90;
    this.machineHaze += (target - this.machineHaze) * Math.min(1, dt * rate * 3);

    // Fog clouds.
    for (const machine of machines) {
      if (machine.kind !== "fogger" || machine.output < 0.02) continue;
      this.carry += machine.output * 45 * dt;
      while (this.carry >= 1 && this.particles.length < MAX_PARTICLES) {
        this.carry -= 1;
        const spread = new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.15, (Math.random() - 0.5) * 0.5);
        this.particles.push({
          position: machine.nozzle.clone(),
          velocity: machine.direction.clone().multiplyScalar(2.2 + Math.random() * 1.6).add(spread),
          age: 0,
          life: 7 + Math.random() * 5,
          size: 0.25 + Math.random() * 0.2
        });
      }
    }
    let count = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age > p.life) { this.particles.splice(i, 1); continue; }
      p.velocity.multiplyScalar(Math.exp(-0.7 * dt));
      p.velocity.y += (p.position.y > 0.6 ? -0.05 : 0.01) * dt; // heavy fog stays low
      p.position.addScaledVector(p.velocity, dt);
      const life = p.age / p.life;
      this.positions.set([p.position.x, p.position.y, p.position.z], count * 3);
      this.sizes[count] = p.size + life * 2.6;
      this.alphas[count] = Math.min(1, p.age * 3) * (1 - life) * 0.32;
      count++;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, count);
    geometry.attributes.position.needsUpdate = geometry.attributes.aSize.needsUpdate = geometry.attributes.aAlpha.needsUpdate = true;
    // Fog is only visible by the light falling on it.
    this.material.uniforms.uColor.value.setRGB(0.02 + stageLight.r, 0.02 + stageLight.g, 0.025 + stageLight.b);

    return Math.min(1.5, baseHaze + this.machineHaze);
  }

  get busy() {
    return this.particles.length > 0 || this.machineHaze > 0.001;
  }
}
