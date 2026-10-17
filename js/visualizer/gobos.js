// The shape of a beam's cross-section: a round lens aperture, an optional
// gobo pattern and the framing shutters / barn doors. One small texture per
// fixture, used both by the volumetric beam (so the pattern shows in the
// haze) and by the fixture's spotlight (so it projects onto the stage).
import * as THREE from "three";

const SIZE = 256;
const cache = new Map();

// Gobo patterns, drawn white (light passes) on black.
const PATTERNS = [
  null,
  // 1: ring of dots
  (g, r) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; dot(g, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.17); } dot(g, 0, 0, r * 0.18); },
  // 2: breakup (leaves)
  (g, r) => { let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 26; i++) { const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r * 0.8; g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * (0.06 + rand() * 0.1), r * (0.03 + rand() * 0.06), rand() * Math.PI, 0, Math.PI * 2); g.fill(); } },
  // 3: star
  (g, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, d = i % 2 ? r * 0.36 : r * 0.92; g.lineTo(Math.cos(a) * d, Math.sin(a) * d); } g.closePath(); g.fill(); },
  // 4: bars
  (g, r) => { for (let i = -3; i <= 3; i++) g.fillRect(i * r * 0.28 - r * 0.07, -r, r * 0.14, r * 2); },
  // 5: rings
  (g, r) => { g.lineWidth = r * 0.1; g.strokeStyle = "#fff"; for (const k of [0.25, 0.5, 0.78]) { g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); } },
  // 6: triangles of dots
  (g, r) => { for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 - Math.PI / 2; dot(g, Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.3); } },
  // 7: cross
  (g, r) => { g.fillRect(-r, -r * 0.12, r * 2, r * 0.24); g.fillRect(-r * 0.12, -r, r * 0.24, r * 2); },
  // 8: flower
  (g, r) => { for (let i = 0; i < 6; i++) { g.save(); g.rotate((i / 6) * Math.PI * 2); g.beginPath(); g.ellipse(0, r * 0.45, r * 0.18, r * 0.4, 0, 0, Math.PI * 2); g.fill(); g.restore(); } }
];

function dot(g, x, y, radius) { g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill(); }

// key: "gobo|blade1|blade2|blade3|blade4|rotation", rounded so small slider
// changes reuse textures instead of making hundreds.
function keyFor(gobo, framing) {
  const blades = framing?.active ? framing.blades.map(b => Math.round(b * 50)).join(",") : "";
  const rotation = framing?.active ? Math.round((framing.rotation || 0) * 36) : 0;
  return `${gobo}|${blades}|${rotation}`;
}

export function beamMask(gobo, framing) {
  if (!gobo && !framing?.active) return null;
  const key = keyFor(gobo, framing);
  if (cache.has(key)) return cache.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  const r = SIZE / 2;
  g.fillStyle = "#000";
  g.fillRect(0, 0, SIZE, SIZE);
  g.translate(r, r);
  g.fillStyle = "#fff";

  const pattern = PATTERNS[gobo % PATTERNS.length];
  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.98, 0, Math.PI * 2);
  g.clip();
  if (pattern) pattern(g, r * 0.98);
  else g.fillRect(-r, -r, SIZE, SIZE);
  g.restore();

  // Shutter blades: each pushes in from one side of the (rotated) frame.
  if (framing?.active) {
    g.save();
    g.rotate(framing.rotation || 0);
    g.fillStyle = "#000";
    const [top, right, bottom, left] = framing.blades;
    const span = SIZE * 1.5;
    if (top > 0) g.fillRect(-span, -span, span * 2, span - r + top * SIZE);
    if (bottom > 0) g.fillRect(-span, r - bottom * SIZE, span * 2, span);
    if (left > 0) g.fillRect(-span, -span, span - r + left * SIZE, span * 2);
    if (right > 0) g.fillRect(r - right * SIZE, -span, span, span * 2);
    g.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, texture);
  return texture;
}

// Soft round sprite used for lens glows, mirror-ball spots and glints.
let glowTexture = null;
export function glow() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

// LED lens: a grid of emitters, so LED fixtures read as LED fixtures.
let ledTexture = null;
export function ledLens() {
  if (ledTexture) return ledTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  g.fillStyle = "#151515";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#fff";
  for (let y = 12; y < 128; y += 21) for (let x = 12 + ((y / 21) % 2) * 10; x < 128; x += 21) { const dx = x - 64, dy = y - 64; if (dx * dx + dy * dy < 56 * 56) dot(g, x, y, 7); }
  ledTexture = new THREE.CanvasTexture(canvas);
  return ledTexture;
}
