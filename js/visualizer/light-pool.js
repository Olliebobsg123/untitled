// The stage-lighting pool: a fixed number of real spotlights that light the
// room, handed each frame to the brightest fixtures that are on.
//
// Every real light costs the GPU on every lit pixel, and changing how many
// lights, shadows or projected gobos the scene has makes three.js recompile
// its shaders (a visible stutter). So the pool's size never changes while it
// runs: lights are reassigned between fixtures instead. The first few cast
// shadows and project gobos/shutters; fixtures that don't get a light still
// show their beams in the haze.
import * as THREE from "three";

// Shadow-casting lights always carry a map (an open circle when there's no
// gobo) so the number of mapped lights never changes.
let openMask = null;
function open() {
  if (openMask) return openMask;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(32, 32, 31, 0, Math.PI * 2);
  g.fill();
  openMask = new THREE.CanvasTexture(canvas);
  return openMask;
}

export class LightPool {
  constructor(scene) {
    this.scene = scene;
    this.lights = [];
    this.owners = [];
  }

  configure({ pool, shadows, shadowSize }) {
    for (const light of this.lights) {
      this.scene.remove(light, light.target);
      light.dispose();
    }
    this.lights = [];
    for (let i = 0; i < pool; i++) {
      const light = new THREE.SpotLight(0xffffff, 0, 0, 0.3, 0.3, 2);
      if (i < shadows) {
        light.castShadow = true;
        light.shadow.mapSize.set(shadowSize, shadowSize);
        light.shadow.camera.near = 0.3;
        light.shadow.camera.far = 40;
        light.shadow.bias = -0.0004;
        light.shadow.normalBias = 0.02;
        light.map = open();
      }
      this.scene.add(light, light.target);
      this.lights.push(light);
    }
    this.owners = new Array(pool).fill(null);
  }

  // models: fixtures with a `light` description (or null when off).
  // Returns true when a shadow-casting light changed (shadows need redrawing).
  update(models, lightScale) {
    const on = [];
    for (const model of models) if (model.light && model.light.intensity > 0) on.push(model);
    // The shadow-casting lights (the only ones that project gobos and
    // shutters). A light keeps its shadow for as long as it stays on, so
    // shadows don't hop between fixtures as levels change. A free one goes
    // to a fixture shaping its light (gobo/shutters) first, then the
    // brightest; a shaping fixture may take one from a plain light.
    on.sort((a, b) => b.light.intensity - a.light.intensity);
    const shadowCount = this.lights.filter(l => l.castShadow).length;
    const isOn = new Set(on);
    const shadowed = [];
    for (let i = 0; i < shadowCount; i++) { const o = this.owners[i]; if (o && isOn.has(o) && !shadowed.includes(o)) shadowed.push(o); }
    shadowed.sort((a, b) => b.light.intensity - a.light.intensity);
    const want = [...on.filter(m => m.light.mask), ...on.filter(m => !m.light.mask)];
    for (const m of want) {
      if (shadowed.includes(m)) continue;
      if (shadowed.length < shadowCount) { shadowed.push(m); continue; }
      if (!m.light.mask) break;
      // Shaped and no shadow free: take the dimmest plain light's.
      let k = -1;
      for (let j = shadowed.length - 1; j >= 0; j--) if (!shadowed[j].light.mask) { k = j; break; }
      if (k < 0) break;
      shadowed.splice(k, 1, m);
    }
    const rest = on.filter(m => !shadowed.includes(m)).slice(0, this.lights.length - shadowCount);
    // Within each group a fixture keeps the light it had last frame when it
    // can, to avoid needless shadow redraws.
    const groups = [
      { indices: [...this.lights.keys()].filter(i => i < shadowCount), wanted: shadowed },
      { indices: [...this.lights.keys()].filter(i => i >= shadowCount), wanted: rest }
    ];
    const assignment = new Array(this.lights.length).fill(null);
    for (const { indices, wanted } of groups) {
      const left = new Set(wanted);
      for (const i of indices) if (left.has(this.owners[i])) { assignment[i] = this.owners[i]; left.delete(this.owners[i]); }
      const queue = [...left];
      for (const i of indices) if (!assignment[i] && queue.length) assignment[i] = queue.shift();
    }

    let shadowsChanged = false;
    this.lights.forEach((light, i) => {
      const owner = assignment[i];
      if (!owner) {
        if (light.intensity !== 0 && light.castShadow) shadowsChanged = true;
        light.intensity = 0;
        this.owners[i] = null;
        return;
      }
      const l = owner.light;
      const moved = light.position.distanceToSquared(l.position) > 1e-8 || light.target.position.distanceToSquared(l.target) > 1e-8 || Math.abs(light.angle - l.angle) > 1e-4;
      if (light.castShadow && (moved || this.owners[i] !== owner)) shadowsChanged = true;
      light.position.copy(l.position);
      light.target.position.copy(l.target);
      light.target.updateMatrixWorld();
      light.angle = l.angle;
      light.penumbra = l.penumbra;
      light.color.setRGB(l.colour[0], l.colour[1], l.colour[2]);
      light.intensity = l.intensity * lightScale;
      if (light.castShadow) light.map = l.mask || open();
      this.owners[i] = owner;
    });
    return shadowsChanged;
  }

  dispose() {
    this.configure({ pool: 0, shadows: 0, shadowSize: 512 });
  }
}
