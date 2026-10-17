// The shape of a beam's cross-section: a round lens aperture, an optional
// gobo pattern and the framing shutters / barn doors. One small texture per
// fixture, used both by the volumetric beam (so the pattern shows in the
// haze) and by the fixture's spotlight (so it projects onto the stage).
import * as THREE from "three";

const SIZE = 256;


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

// Cache keys are rounded so small slider changes reuse textures instead of
// making hundreds.
function framingKey(framing) {
  if (!framing?.active) return "";
  const blades = framing.blades.map(b => Math.round(b * 50)).join(",");
  const angles = (framing.angles || []).map(([a, b]) => `${Math.round(a * 20)}:${Math.round(b * 20)}`).join(",");
  return `${blades}|${angles}|${Math.round((framing.rotation || 0) * 36)}`;
}

// Each fixture draws its own mask: gobo wheel 1 and 2 (or the effect wheel)
// at their current angles, the framing shutters/barn doors, focus/frost blur,
// and, for the stage pool, the three images a prism makes. The same picture
// shapes the beam in the haze and the light on stage, so a spinning gobo
// spins in both. It's only redrawn when something visibly changes (angles
// are rounded to 2°).
const STEP = Math.PI / 90;

export class FixtureMask {
  constructor() {
    this.key = null;
    this.poolKey = null;
  }

  canvasTexture(name) {
    if (!this[name]) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = SIZE;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      this[name] = texture;
    }
    return this[name];
  }

  // Returns { beam, pool } textures, or nulls when the beam is a plain circle.
  update({ gobo, gobo2, effect, framing, blur, rotation, rotation2, prism, prismAngle }) {
    if (!gobo && !gobo2 && !effect && !framing?.active) return { beam: null, pool: null };
    const blurPx = Math.round(blur * 4) * 3;
    const key = [gobo, gobo2, effect > 0 ? 1 : 0, framingKey(framing), blurPx, Math.round(rotation / STEP), Math.round(rotation2 / STEP)].join("|");
    const beam = this.canvasTexture("beamTexture");
    if (key !== this.key) {
      this.key = key;
      this.poolKey = null;
      drawMask(beam.image.getContext("2d"), { gobo, gobo2, effect, framing, blurPx, rotation, rotation2 });
      beam.needsUpdate = true;
    }
    if (!prism) return { beam, pool: beam };
    const pool = this.canvasTexture("poolTexture");
    const poolKey = `${key}|${Math.round(prismAngle / STEP)}`;
    if (poolKey !== this.poolKey) {
      this.poolKey = poolKey;
      const g = pool.image.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#000";
      g.fillRect(0, 0, SIZE, SIZE);
      g.globalCompositeOperation = "lighter";
      const r = SIZE / 2;
      const size = SIZE * 0.6;
      for (let k = 0; k < 3; k++) {
        const angle = prismAngle + (k * Math.PI * 2) / 3;
        g.drawImage(beam.image, r + Math.cos(angle) * r * 0.38 - size / 2, r + Math.sin(angle) * r * 0.38 - size / 2, size, size);
      }
      g.globalCompositeOperation = "source-over";
      pool.needsUpdate = true;
    }
    return { beam, pool };
  }

  dispose() {
    this.beamTexture?.dispose();
    this.poolTexture?.dispose();
  }
}

let secondCanvas = null;
function secondLayer() {
  if (!secondCanvas) {
    secondCanvas = document.createElement("canvas");
    secondCanvas.width = secondCanvas.height = SIZE;
  }
  return secondCanvas;
}

function drawMask(g, { gobo, gobo2, effect, framing, blurPx, rotation, rotation2 }) {
  const r = SIZE / 2;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.filter = "none";
  g.fillStyle = "#000";
  g.fillRect(0, 0, SIZE, SIZE);
  g.translate(r, r);
  g.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
  g.fillStyle = "#fff";
  g.save();
  g.beginPath();
  g.arc(0, 0, r * 0.98, 0, Math.PI * 2);
  g.clip();
  // Gobo wheel 1 (or the open aperture).
  g.save();
  g.rotate(rotation);
  const pattern = PATTERNS[gobo % PATTERNS.length];
  if (pattern) pattern(g, r * 0.98);
  else g.fillRect(-r, -r, SIZE, SIZE);
  g.restore();
  // Gobo wheel 2 / effect wheel: light only passes where both let it through.
  const second = gobo2 ? PATTERNS[((gobo2 + 3) % (PATTERNS.length - 1)) + 1] : effect > 0 ? PATTERNS[2] : null;
  if (second) {
    // Drawn on its own layer first: "destination-in" keeps only what one
    // drawing call covers, and patterns are many separate shapes.
    const layer = secondLayer();
    const l = layer.getContext("2d");
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, SIZE, SIZE);
    l.translate(r, r);
    l.rotate(rotation2);
    l.fillStyle = l.strokeStyle = "#fff";
    second(l, r * 0.98);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(layer, 0, 0);
    g.restore();
    g.globalCompositeOperation = "source-over";
  }
  g.restore();
  // Framing shutters / barn doors: each blade pushes in from its side; A/B
  // angles let a blade sit at a slant.
  if (framing?.active) {
    g.save();
    g.rotate(framing.rotation || 0);
    g.fillStyle = "#000";
    const span = SIZE * 1.5;
    framing.blades.forEach((insert, i) => {
      if (insert <= 0) return;
      const [a, b] = framing.angles?.[i] || [0.5, 0.5];
      const depthA = -r + insert * SIZE + (a - 0.5) * r * 0.8;
      const depthB = -r + insert * SIZE + (b - 0.5) * r * 0.8;
      g.save();
      g.rotate((i * Math.PI) / 2); // top, right, bottom, left
      g.beginPath();
      g.moveTo(-span, -span);
      g.lineTo(span, -span);
      g.lineTo(span, depthB);
      g.lineTo(-span, depthA);
      g.closePath();
      g.fill();
      g.restore();
    });
    g.restore();
  }
  // Areas the second wheel cleared are transparent: make them black.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = "none";
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = "#000";
  g.fillRect(0, 0, SIZE, SIZE);
  g.globalCompositeOperation = "source-over";
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
