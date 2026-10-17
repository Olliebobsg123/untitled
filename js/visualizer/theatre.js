// The room: a proscenium stage with a black back wall, black masking, lighting
// bars, raked seating, house and work lights. Units are metres; the stage's
// front edge is at z = 0 with the audience towards +z.
import * as THREE from "three";

export const STAGE = { width: 12, depth: 9, height: 1, frontZ: 0 };
export const STAGE_TOP = STAGE.height;
export const CYC_Z = -8.4;
export const ROOM = { minX: -11, maxX: 11, minY: 0, maxY: 11, minZ: -10, maxZ: 17 };
export const BARS = [
  { name: "FOH", y: 7.6, z: 6, length: 12 },
  { name: "LX 1", y: 7.2, z: -1.2, length: 11 },
  { name: "LX 2", y: 7.2, z: -3.8, length: 11 },
  { name: "LX 3", y: 7.2, z: -6.4, length: 11 }
];

const matte = (color, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

export function buildTheatre(scene) {
  const solids = []; // everything a beam or a reflection can land on
  const add = (geometry, material, position, { receive = true, cast = false, solid = true } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    mesh.receiveShadow = receive;
    mesh.castShadow = cast;
    scene.add(mesh);
    if (solid) solids.push(mesh);
    return mesh;
  };

  // Auditorium floor, room walls and ceiling: dark, so spill and reflections read.
  const floor = add(new THREE.PlaneGeometry(ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ), matte(0x16151a, 0.95), [0, 0, (ROOM.maxZ + ROOM.minZ) / 2]);
  floor.rotation.x = -Math.PI / 2;
  const wall = matte(0x101014, 0.97);
  const sideWall = new THREE.PlaneGeometry(ROOM.maxZ - ROOM.minZ, ROOM.maxY);
  const left = add(sideWall, wall, [ROOM.minX, ROOM.maxY / 2, (ROOM.maxZ + ROOM.minZ) / 2]);
  left.rotation.y = Math.PI / 2;
  const right = add(sideWall, wall, [ROOM.maxX, ROOM.maxY / 2, (ROOM.maxZ + ROOM.minZ) / 2]);
  right.rotation.y = -Math.PI / 2;
  const endWall = new THREE.PlaneGeometry(ROOM.maxX - ROOM.minX, ROOM.maxY);
  const back = add(endWall, wall, [0, ROOM.maxY / 2, ROOM.maxZ]);
  back.rotation.y = Math.PI;
  add(endWall, wall, [0, ROOM.maxY / 2, ROOM.minZ]);
  const ceiling = add(new THREE.PlaneGeometry(ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ), wall, [0, ROOM.maxY, (ROOM.maxZ + ROOM.minZ) / 2]);
  ceiling.rotation.x = Math.PI / 2;

  // Stage: black lino with a slight sheen, like a real dance floor.
  const stageCentreZ = STAGE.frontZ - STAGE.depth / 2;
  add(new THREE.BoxGeometry(STAGE.width, STAGE.height, STAGE.depth),
    new THREE.MeshStandardMaterial({ color: 0x3b3b40, roughness: 0.55, metalness: 0 }),
    [0, STAGE.height / 2, stageCentreZ]);
  add(new THREE.BoxGeometry(STAGE.width, 0.04, 0.05), matte(0x3a3a3a, 0.6), [0, STAGE.height + 0.005, STAGE.frontZ - 0.025]);

  // Back wall: black serge, like the masking, so beams and gobos read
  // against it the way they do in a blacked-out theatre.
  add(new THREE.PlaneGeometry(STAGE.width - 1, 7), matte(0x0b0b0c, 0.98), [0, STAGE.height + 3.5, CYC_Z]);

  // Black masking: proscenium, legs and borders.
  const black = matte(0x070708, 0.98);
  add(new THREE.BoxGeometry(STAGE.width + 8, 2.6, 0.3), black, [0, 9.7, STAGE.frontZ - 0.15], { cast: true });
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(4, 11, 0.3), black, [side * (STAGE.width / 2 + 2), 5.5, STAGE.frontZ - 0.15], { cast: true });
    for (const z of [-2.5, -5.1, -7.6]) {
      add(new THREE.BoxGeometry(1.4, 7.5, 0.06), black, [side * (STAGE.width / 2 - 0.55), STAGE.height + 3.75, z], { cast: true });
    }
  }
  for (const z of [-2.5, -5.1, -7.6]) add(new THREE.BoxGeometry(STAGE.width, 1.2, 0.06), black, [0, 8.3, z], { cast: true });

  // Lighting bars: steel pipe.
  const steel = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.4, metalness: 0.8 });
  for (const bar of BARS) {
    const pipe = add(new THREE.CylinderGeometry(0.024, 0.024, bar.length, 12), steel, [0, bar.y, bar.z], { solid: false, receive: false });
    pipe.rotation.z = Math.PI / 2;
  }

  // Raked seating as instances (cheap to draw).
  const rows = 8;
  const perRow = 14;
  const RISE = 0.26; // a gentle rake so the stage stays visible from the back
  const riser = matte(0x121216);
  const seatMaterial = matte(0x3c1216, 0.85);
  for (let r = 0; r < rows; r++) add(new THREE.BoxGeometry(16, RISE, 1.1), riser, [0, r * RISE + RISE / 2, 3 + r * 1.1]);
  const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), seatMaterial, rows * perRow);
  const backRest = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.55, 0.08), seatMaterial, rows * perRow);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < perRow; s++) {
      const x = (s - (perRow - 1) / 2) * 0.62 + (s < perRow / 2 ? -0.5 : 0.5); // centre aisle
      const top = (r + 1) * RISE;
      dummy.position.set(x, top + 0.21, 3 + r * 1.1);
      dummy.updateMatrix();
      seat.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, top + 0.55, 3 + r * 1.1 + 0.26);
      dummy.updateMatrix();
      backRest.setMatrixAt(i, dummy.matrix);
      i++;
    }
  }
  seat.receiveShadow = backRest.receiveShadow = true;
  scene.add(seat, backRest);

  // A faint fill so the room is never pure black (like exit signs and spill).
  const ambient = new THREE.HemisphereLight(0x8c96aa, 0x0c0c10, 0.35);
  scene.add(ambient);

  // House lights: warm downlights over the audience.
  const house = [];
  for (const x of [-5, 0, 5]) {
    for (const z of [6, 12]) {
      const light = new THREE.PointLight(0xffd2a0, 0, 18, 2);
      light.position.set(x, 10.6, z);
      scene.add(light);
      house.push(light);
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 16), new THREE.MeshBasicMaterial({ color: 0x222222 }), [x, 10.98, z], { solid: false, receive: false }).userData.houseLamp = true;
    }
  }

  // Work lights: plain cool white over the stage.
  const work = [];
  for (const x of [-4, 0, 4]) {
    const light = new THREE.SpotLight(0xf2f4ff, 0, 22, 1.0, 0.8, 2);
    light.position.set(x, 9.2, stageCentreZ + 1);
    light.target.position.set(x * 0.8, STAGE_TOP, stageCentreZ);
    scene.add(light, light.target);
    work.push(light);
  }

  const grid = new THREE.GridHelper(40, 40, 0x2e3440, 0x1d2129);
  grid.position.y = 0.005;
  scene.add(grid);

  const lamps = scene.children.filter(o => o.userData.houseLamp);
  return {
    solids,
    setHouse(on) {
      // Hidden lights cost nothing; switched-off-but-visible ones still do.
      house.forEach(light => { light.intensity = 30; light.visible = on; });
      lamps.forEach(lamp => lamp.material.color.set(on ? 0xffe2b8 : 0x222222));
    },
    setWork(on) { work.forEach(light => { light.intensity = 220; light.visible = on; }); },
    setGrid(on) { grid.visible = on; }
  };
}

// Where a new fixture hangs until it is moved: spread along the over-stage
// bars in patch order (up to 8 a bar), then the FOH bar.
export function defaultHanging(index, count) {
  const order = [BARS[1], BARS[2], BARS[3], BARS[0]];
  const PER_BAR = 8;
  const barIndex = Math.min(order.length - 1, Math.floor(index / PER_BAR));
  const bar = order[barIndex];
  const onThisBar = barIndex === order.length - 1 ? Math.max(1, count - barIndex * PER_BAR) : Math.min(PER_BAR, count - barIndex * PER_BAR);
  const slot = index - barIndex * PER_BAR;
  const spacing = Math.min(1.3, (bar.length - 1.5) / Math.max(1, onThisBar - 1));
  return { x: (slot - (onThisBar - 1) / 2) * spacing, y: bar.y - 0.08, z: bar.z };
}

// Snap a dragged fixture under the nearest bar when it's close to one.
export function snapToBar(position) {
  for (const bar of BARS) {
    if (Math.abs(position.y - bar.y) < 0.5 && Math.abs(position.z - bar.z) < 0.5 && Math.abs(position.x) < bar.length / 2) {
      return { x: position.x, y: bar.y - 0.08, z: bar.z };
    }
  }
  return position;
}
