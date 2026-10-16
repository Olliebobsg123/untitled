// One fixture in the 3D scene: its body, lens, light and beam, driven by the
// decoded DMX (decode.js). Hung from a mount point; the head points straight
// down (local -Y) before panning (yoke, about Y) and tilting (head, about X).
import * as THREE from "three";
import { STAGE, STAGE_TOP } from "./theatre.js";

const BODY = new THREE.MeshStandardMaterial({ color: 0x2d3036, roughness: 0.45, metalness: 0.6 });
const BODY_SELECTED = new THREE.MeshStandardMaterial({ color: 0x2d3036, roughness: 0.45, metalness: 0.6, emissive: 0x19d6a3, emissiveIntensity: 0.5 });
const YOKE = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 });
const MAX_BEAM = 30;
const tmpPosition = new THREE.Vector3();
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// A cone of light in haze: brightest along the middle of the beam and near the lens.
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { colour: { value: new THREE.Color(1, 1, 1) }, strength: { value: 0 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        vAlong = 0.5 - position.y;                 // 0 at the lens, 1 at the far end
        vec4 world = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-world.xyz);
        gl_Position = projectionMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 colour;
      uniform float strength;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float fade = (1.0 - vAlong) * (1.0 - vAlong) * 0.85 + 0.15;
        gl_FragColor = vec4(colour * strength * facing * fade, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

// The fixture number, floating above it.
function label(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(8,12,14,0.78)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 88, 40, 10);
  ctx.fill();
  ctx.fillStyle = "#e8f4f0";
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 48, 25);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }));
  sprite.scale.set(0.7, 0.35, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// How far the beam goes before it hits the stage, the floor or the back wall.
function beamLength(origin, direction) {
  if (direction.y >= -0.02) return MAX_BEAM;
  const backZ = STAGE.frontZ - STAGE.depth + 0.3;
  let length = (origin.y - 0) / -direction.y;
  const onStage = (origin.y - STAGE_TOP) / -direction.y;
  const hit = origin.clone().addScaledVector(direction, onStage);
  if (Math.abs(hit.x) <= STAGE.width / 2 && hit.z <= STAGE.frontZ && hit.z >= backZ) length = onStage;
  if (direction.z < 0) {
    const toBack = (backZ - origin.z) / direction.z;
    if (toBack > 0) length = Math.min(length, toBack);
  }
  return Math.max(0.5, Math.min(MAX_BEAM, length));
}

export function createFixture(fixture, def, position) {
  const moving = def?.type === "moving" || (Number.isInteger(def?.map?.pan) && Number.isInteger(def?.map?.tilt));
  const strip = /sunstrip|strip|bar|wipe/i.test(fixture.name || "") && !moving;

  const root = new THREE.Group();
  root.position.set(position.x, position.y, position.z);
  root.userData.fixtureId = String(fixture.id);

  // Clamp to the bar.
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), YOKE);
  clamp.position.y = 0.25;
  root.add(clamp);

  const yoke = new THREE.Group();
  root.add(yoke);
  const head = new THREE.Group();
  head.position.y = moving ? -0.45 : -0.1;
  yoke.add(head);

  // Bodies: a moving head (base, arms, head), a long strip, or a can (par/fresnel/profile).
  const bodies = [];
  let lensY;
  let lensRadius;
  if (moving) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), BODY);
    base.position.y = 0.05;
    root.add(base);
    bodies.push(base);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.16), YOKE);
      arm.position.set(side * 0.24, -0.2, 0);
      yoke.add(arm);
    }
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 24), BODY);
    head.add(shell);
    bodies.push(shell);
    lensY = -0.22;
    lensRadius = 0.15;
  } else if (strip) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 0.14), BODY);
    head.add(box);
    bodies.push(box);
    lensY = -0.075;
    lensRadius = 0.06;
  } else {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.4, 24), BODY);
    can.position.y = -0.1;
    head.add(can);
    bodies.push(can);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.05), YOKE);
      arm.position.set(side * 0.2, -0.02, 0);
      yoke.add(arm);
    }
    lensY = -0.31;
    lensRadius = 0.14;
  }
  bodies.forEach(body => { body.userData.fixtureId = String(fixture.id); });

  const lensMaterial = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const lens = new THREE.Mesh(strip ? new THREE.BoxGeometry(0.96, 0.02, 0.1) : new THREE.CircleGeometry(lensRadius, 24), lensMaterial);
  if (!strip) lens.rotation.x = Math.PI / 2;
  lens.position.y = lensY - 0.002;
  lens.userData.fixtureId = String(fixture.id);
  lens.userData.aimHandle = !moving;
  head.add(lens);

  const light = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 8, 0.5, 2);
  light.position.y = lensY;
  light.target.position.set(0, lensY - 10, 0);
  light.visible = false;
  head.add(light, light.target);

  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), beamMaterial());
  beam.visible = false;
  beam.renderOrder = 2;
  head.add(beam);

  const tag = label(String(fixture.fixtureNumber ?? ""));
  tag.position.y = 0.75;
  root.add(tag);

  const p = def?.photometrics || {};
  const lumens = (Number(p.ratedLumens) || (moving ? 3000 : 2000)) * (Number(p.outputScale) || 0.8);
  const brightness = Math.max(0.35, Math.min(4, lumens / 2500));

  const state = { intensity: 0, colour: new THREE.Color(), beamAngle: 25, rate: 0 };

  return {
    id: String(fixture.id),
    fixture,
    def,
    moving,
    root,
    yoke,
    head,
    bodies,
    lens,
    label: tag,

    // The fixture's own aim for fixtures that don't move: { pan, tilt } in radians.
    setAim(aim) {
      if (moving || !aim) return;
      yoke.rotation.y = aim.pan;
      head.rotation.x = aim.tilt;
    },
    aim: () => ({ pan: yoke.rotation.y, tilt: head.rotation.x }),

    // Point a fixed fixture at a spot in the room.
    aimAt(point) {
      if (moving) return null;
      lens.getWorldPosition(tmpPosition);
      const d = tmpDirection.subVectors(point, tmpPosition).normalize();
      const tilt = Math.acos(Math.max(-1, Math.min(1, -d.y)));
      const pan = Math.sin(tilt) > 1e-4 ? Math.atan2(-d.x, -d.z) : 0;
      yoke.rotation.y = pan;
      head.rotation.x = tilt;
      return { pan, tilt };
    },

    setSelected(selected) {
      bodies.forEach(body => { body.material = selected ? BODY_SELECTED : BODY; });
    },

    // decoded: from decode.js. Returns whether it changes over time (strobe), so the scene keeps redrawing.
    update(decoded, beamsOn) {
      state.intensity = decoded.intensity;
      state.colour.setRGB(...decoded.rgb);
      state.beamAngle = Math.max(2, Math.min(80, decoded.beamAngle));
      state.rate = decoded.intensity > 0 ? decoded.strobeRate : 0;
      if (moving && decoded.pan != null) yoke.rotation.y = decoded.pan;
      if (moving && decoded.tilt != null) head.rotation.x = decoded.tilt;
      light.angle = THREE.MathUtils.degToRad(state.beamAngle / 2) * (1 + decoded.frost * 0.6);
      light.penumbra = Math.min(1, decoded.softness + decoded.frost * 0.4);
      this.beamsOn = beamsOn;
      this.render(performance.now() / 1000);
      return state.rate > 0;
    },

    // Per frame: strobing, and the beam's length to whatever it hits.
    render(seconds) {
      const flash = state.rate > 0 ? ((seconds * state.rate) % 1 < 0.25 ? 1 : 0) : 1;
      const level = state.intensity * flash;
      const on = level > 0.002;
      light.visible = on;
      light.intensity = level * level * 1400 * brightness * (25 / Math.max(8, state.beamAngle));
      light.color.copy(state.colour);
      lensMaterial.color.copy(state.colour).multiplyScalar(on ? 0.25 + level * 0.9 : 0.02);
      beam.visible = on && this.beamsOn !== false;
      if (beam.visible) {
        head.updateWorldMatrix(true, false);
        lens.getWorldPosition(tmpPosition);
        head.getWorldQuaternion(tmpQuaternion);
        const direction = tmpDirection.copy(DOWN).applyQuaternion(tmpQuaternion);
        const length = beamLength(tmpPosition, direction);
        const radius = Math.tan(light.angle) * length;
        beam.scale.set(radius, length, radius);
        beam.position.y = lensY - length / 2; // the cone's point (its +Y end) sits on the lens
        beam.material.uniforms.colour.value.copy(state.colour);
        beam.material.uniforms.strength.value = Math.min(1.2, level * 0.55 * Math.sqrt(brightness));
      }
    },

    dispose() {
      root.traverse(object => {
        object.geometry?.dispose();
        if (object.material && ![BODY, BODY_SELECTED, YOKE].includes(object.material)) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      light.dispose();
    }
  };
}
