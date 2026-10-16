// The room: stage, masking, a cyclorama to show colour on, lighting bars,
// audience seating, house and work lights, and a floor grid.
import * as THREE from "three";

// Where things are (metres; the stage's front edge is at z = 2, audience towards +z).
export const STAGE = { width: 22, depth: 14, height: 1.2, frontZ: 2 };
export const STAGE_TOP = STAGE.height;
export const BARS = [
  { name: "FOH", z: 9, y: 8.5, length: 26 },
  { name: "LX 1", z: -0.5, y: 9.5, length: 24 },
  { name: "LX 2", z: -4.5, y: 9.5, length: 24 },
  { name: "LX 3", z: -8.5, y: 9.5, length: 24 }
];

const material = (color, roughness = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

export function buildTheatre(scene) {
  const add = (geometry, mat, position, shadows = true) => {
    const mesh = new THREE.Mesh(geometry, mat);
    if (position) mesh.position.set(...position);
    mesh.receiveShadow = shadows;
    scene.add(mesh);
    return mesh;
  };

  // Auditorium floor and the stage.
  const floor = add(new THREE.PlaneGeometry(80, 80), material(0x1a1a1d, 0.95));
  floor.rotation.x = -Math.PI / 2;
  const stageCentreZ = STAGE.frontZ - STAGE.depth / 2;
  add(new THREE.BoxGeometry(STAGE.width, STAGE.height, STAGE.depth), material(0x2b2723, 0.8), [0, STAGE.height / 2, stageCentreZ]);
  add(new THREE.BoxGeometry(STAGE.width, 0.06, 0.08), material(0x6a6a6a, 0.5), [0, STAGE.height + 0.01, STAGE.frontZ - 0.04]); // nosing

  // Cyclorama: a pale backdrop that shows the colour of whatever lights it.
  const backZ = STAGE.frontZ - STAGE.depth;
  add(new THREE.PlaneGeometry(STAGE.width - 1, 9), material(0xd8d8dc, 0.95), [0, STAGE.height + 4.5, backZ + 0.3]);

  // Black masking: proscenium, legs, border.
  const black = material(0x0b0b0d, 0.95);
  add(new THREE.BoxGeometry(STAGE.width + 4, 1.4, 0.4), black, [0, 10.6, STAGE.frontZ - 0.2]);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(2, 11, 0.4), black, [side * (STAGE.width / 2 + 1), 5.5, STAGE.frontZ - 0.2]);
    for (const z of [-2.5, -6.5, -10.5]) add(new THREE.BoxGeometry(1.6, 9, 0.1), black, [side * (STAGE.width / 2 - 1.2), STAGE.height + 4.5, z]);
  }

  // Lighting bars.
  const steel = material(0x5a5d63, 0.35, { metalness: 0.8 });
  for (const bar of BARS) {
    const pipe = add(new THREE.CylinderGeometry(0.05, 0.05, bar.length, 10), steel, [0, bar.y, bar.z], false);
    pipe.rotation.z = Math.PI / 2;
  }

  // Raked seating, built as instances so it stays cheap to draw.
  const rows = 8;
  const seatsPerRow = 16;
  const riser = material(0x141418, 0.95);
  const seatMaterial = material(0x3a1013, 0.9);
  for (let r = 0; r < rows; r++) add(new THREE.BoxGeometry(22, 0.45, 1.4), riser, [0, r * 0.45 + 0.225, 6 + r * 1.4]);
  const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.4, 0.8), seatMaterial, rows * seatsPerRow);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.8, 0.12), seatMaterial, rows * seatsPerRow);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < seatsPerRow; s++) {
      const x = (s - (seatsPerRow - 1) / 2) * 1.15;
      const top = (r + 1) * 0.45;
      dummy.position.set(x, top + 0.2, 6 + r * 1.4);
      dummy.updateMatrix();
      seat.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, top + 0.6, 6 + r * 1.4 + 0.45);
      dummy.updateMatrix();
      back.setMatrixAt(i, dummy.matrix);
      i++;
    }
  }
  seat.receiveShadow = back.receiveShadow = true;
  scene.add(seat, back);

  // Soft ambient light so the room is never pitch black.
  scene.add(new THREE.HemisphereLight(0x8890a0, 0x101014, 0.6));

  // House lights: warm, over the audience.
  const house = [];
  for (const x of [-8, -3, 3, 8]) {
    for (const z of [8, 13]) {
      const light = new THREE.PointLight(0xffd9a8, 0, 22, 1.6);
      light.position.set(x, 9, z);
      scene.add(light);
      house.push(light);
    }
  }

  // Work lights: plain white over the stage.
  const work = [];
  for (const x of [-7, 0, 7]) {
    const light = new THREE.SpotLight(0xfff4e0, 0, 30, 0.9, 0.7, 1.4);
    light.position.set(x, 10.5, stageCentreZ + 2);
    light.target.position.set(x * 0.6, 0, stageCentreZ);
    scene.add(light, light.target);
    work.push(light);
  }

  const grid = new THREE.GridHelper(80, 40, 0x3a3a40, 0x26262b);
  grid.position.y = 0.01;
  scene.add(grid);

  return {
    grid,
    setHouse(on) { house.forEach(light => { light.intensity = on ? 18 : 0; }); },
    setWork(on) { work.forEach(light => { light.intensity = on ? 60 : 0; }); },
    setGrid(on) { grid.visible = on; }
  };
}

// Where a new fixture hangs by default: up to eight on each over-stage bar, in
// patch order, spaced evenly along it.
export function defaultHanging(index, count) {
  const PER_BAR = 8;
  const bars = BARS.slice(1);
  const barIndex = Math.min(bars.length - 1, Math.floor(index / PER_BAR));
  const bar = bars[barIndex];
  const onThisBar = barIndex === bars.length - 1 ? count - barIndex * PER_BAR : Math.min(PER_BAR, count - barIndex * PER_BAR);
  const slot = index - barIndex * PER_BAR;
  const spacing = Math.min(2.6, (bar.length - 4) / Math.max(1, onThisBar - 1));
  return { x: (slot - (onThisBar - 1) / 2) * spacing, y: bar.y - 0.35, z: bar.z };
}
