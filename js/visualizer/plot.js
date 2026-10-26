// The lighting plot: a plan of the rig as drawn for a production - the stage
// and the setting line, a metre grid measured from centre, bars, trusses and
// booms with their names, the set in outline, and every light as a symbol
// with its number, type and DMX address, pointing where it's focused. Opens in
// its own window to print (or save as SVG for the rest of the team).
import * as THREE from "three";
import { KINDS } from "./venue.js";

const escape = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f2 = n => Number(n).toFixed(2);

// Each light type its own shape, as on a paper plot.
const SYMBOLS = {
  profile: "M -0.17 -0.12 L 0.17 -0.12 L 0.12 0.14 L -0.12 0.14 Z",
  wash: "circle",
  par: "circle",
  moving: "moving",
  strip: "M -0.3 -0.07 L 0.3 -0.07 L 0.3 0.07 L -0.3 0.07 Z",
  fogger: "M -0.18 -0.12 L 0.18 -0.12 L 0.18 0.12 L -0.18 0.12 Z",
  hazer: "M -0.18 -0.12 L 0.18 -0.12 L 0.18 0.12 L -0.18 0.12 Z"
};
// kind: the visualiser's archetype (decode.js).
function symbolFor(kind) {
  if (/^moving/.test(kind)) return "moving";
  if (kind === "profile") return "profile";
  if (kind === "bar" || kind === "blinder") return "strip";
  if (kind === "fogger") return "fogger";
  if (kind === "hazer") return "hazer";
  return "par"; // pars, fresnels, washes, strobes
}

// lights: [{ number, name, kind, address, position, aim, colour }]; items: venue items with
// their plan outlines ([x, z] corners, world); venue: for the stage and room.
export function drawPlot({ venue, lights, outlines, title = "Lighting plot", show = "" }) {
  const { stage } = venue;
  // What's on the plan: the stage, the rig and the set (not the whole auditorium).
  const xs = [-stage.width / 2 - 1, stage.width / 2 + 1], zs = [-stage.depth - 0.5, 1.5];
  for (const l of lights) { xs.push(l.position.x); zs.push(l.position.z); }
  for (const o of outlines) for (const [x, z] of o.points) { xs.push(x); zs.push(z); }
  const pad = 1.6;
  const minX = Math.floor(Math.min(...xs) - pad), maxX = Math.ceil(Math.max(...xs) + pad);
  const minZ = Math.floor(Math.min(...zs) - pad), maxZ = Math.ceil(Math.max(...zs) + pad);
  const width = maxX - minX, height = maxZ - minZ;
  const out = [];
  const line = (x1, z1, x2, z2, cls) => out.push(`<line x1="${f2(x1)}" y1="${f2(z1)}" x2="${f2(x2)}" y2="${f2(z2)}" class="${cls}"/>`);
  const text = (x, z, s, cls, anchor = "middle") => out.push(`<text x="${f2(x)}" y="${f2(z)}" class="${cls}" text-anchor="${anchor}">${escape(s)}</text>`);

  // Metre grid, numbered from centre (across) and from the setting line (depth).
  for (let x = minX; x <= maxX; x++) { line(x, minZ, x, maxZ, x === 0 ? "centre" : "grid"); text(x, minZ + 0.35, x === 0 ? "CL" : String(Math.abs(x)), "gridlabel"); }
  for (let z = minZ; z <= maxZ; z++) { line(minX, z, maxX, z, "grid"); if (z !== minZ) text(minX + 0.15, z - 0.06, z === 0 ? "SL" : `${z < 0 ? "US" : "DS"} ${Math.abs(z)}`, "gridlabel", "start"); }

  // The stage and the setting line (the front of the stage, or the proscenium).
  out.push(`<rect x="${f2(-stage.width / 2)}" y="${f2(-stage.depth)}" width="${f2(stage.width)}" height="${f2(stage.depth)}" class="stage"/>`);
  line(-stage.width / 2 - 0.6, 0, stage.width / 2 + 0.6, 0, "setting");
  if (venue.proscenium?.show) {
    line(minX, -0.15, -venue.proscenium.width / 2, -0.15, "pros");
    line(venue.proscenium.width / 2, -0.15, maxX, -0.15, "pros");
  }

  // The set and the rigging, in outline.
  for (const o of outlines) {
    const kind = KINDS[o.item.kind];
    if (kind?.hang && o.item.kind !== "boom") {
      const [[x1, z1], [x2, z2]] = o.line;
      line(x1, z1, x2, z2, o.item.kind === "truss" ? "truss" : "bar");
      const end = x1 < x2 ? [x1, z1] : [x2, z2];
      text(end[0] - 0.25, end[1] + 0.09, o.item.name, "barname", "end");
      text(Math.max(x1, x2) + 0.25, (x1 < x2 ? z2 : z1) + 0.09, `${f2(o.item.y)} m`, "barheight", "start");
      continue;
    }
    if (o.item.kind === "boom") {
      out.push(`<circle cx="${f2(o.centre[0])}" cy="${f2(o.centre[1])}" r="0.12" class="boom"/>`);
      text(o.centre[0], o.centre[1] + 0.38, o.item.name, "setname");
      continue;
    }
    out.push(`<polygon points="${o.points.map(([x, z]) => `${f2(x)},${f2(z)}`).join(" ")}" class="set ${o.item.kind}"/>`);
    if (o.item.kind !== "seating" && o.item.kind !== "person") text(o.centre[0], o.centre[1] + 0.07, o.item.name, "setname");
  }

  // The lights: a symbol each, number inside, type and address beside it, a line to where it's focused.
  const types = new Map();
  for (const l of lights) {
    const shape = symbolFor(l.kind);
    types.set(l.name, { shape, count: (types.get(l.name)?.count || 0) + 1, channels: l.channels });
    const { x, z } = l.position;
    if (l.aim) {
      const dx = l.aim.x - x, dz = l.aim.z - z, len = Math.hypot(dx, dz);
      if (len > 0.3) line(x, z, x + (dx / len) * Math.min(len, 1.1), z + (dz / len) * Math.min(len, 1.1), "focus");
    }
    out.push(`<g transform="translate(${f2(x)} ${f2(z)})">${symbolSvg(shape, l.colour)}<text y="0.055" class="num" text-anchor="middle">${escape(l.number)}</text></g>`);
    text(x, z + 0.42, l.address, "addr");
  }
  const scale = Math.min(70, 1250 / width); // px per metre on screen
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${width} ${height}" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}">
<style>
  .grid{stroke:#e3e6ea;stroke-width:0.012}.centre{stroke:#9aa3ad;stroke-width:0.02;stroke-dasharray:0.25 0.1 0.05 0.1}
  .gridlabel{font:0.16px sans-serif;fill:#9aa3ad}
  .stage{fill:#f6f7f8;stroke:#222;stroke-width:0.035}.setting{stroke:#222;stroke-width:0.05}.pros{stroke:#222;stroke-width:0.25}
  .bar{stroke:#333;stroke-width:0.05}.truss{stroke:#333;stroke-width:0.24;stroke-opacity:0.35}
  .barname{font:bold 0.24px sans-serif;fill:#111}.barheight{font:0.17px sans-serif;fill:#666}
  .boom{fill:#fff;stroke:#333;stroke-width:0.04}
  .set{fill:#e9ecef;fill-opacity:0.6;stroke:#7b8590;stroke-width:0.02}.set.drape,.set.cyc,.set.gauze{fill:#cfd5db}.set.seating{fill:#f1e4e5;stroke:#c9a9ad}
  .setname{font:italic 0.17px sans-serif;fill:#5c6670}
  .focus{stroke:#888;stroke-width:0.015;stroke-dasharray:0.06 0.04}
  .sym{fill:#fff;stroke:#111;stroke-width:0.03}.num{font:bold 0.16px sans-serif;fill:#111}.addr{font:0.14px sans-serif;fill:#444}
</style>
${out.join("\n")}
</svg>`;
  const key = [...types].map(([name, t]) => `<tr><td><svg viewBox="-0.35 -0.25 0.7 0.5" width="42" height="30">${symbolSvg(t.shape)}</svg></td><td>${escape(name)}</td><td>${t.count}</td><td>${t.channels || ""}</td></tr>`).join("");
  const bars = outlines.filter(o => KINDS[o.item.kind]?.hang).map(o => `<tr><td>${escape(o.item.name)}</td><td>${escape(KINDS[o.item.kind].label)}</td><td>${o.item.kind === "boom" ? `${f2(o.item.h)} m tall` : `${f2(o.item.w)} m long`}</td><td>${f2(o.item.y)} m</td><td>${lights.filter(l => l.on === o.item.id).length}</td></tr>`).join("");
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  body{margin:0;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff}
  header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:18px 24px 10px;border-bottom:2px solid #111}
  h1{margin:0;font-size:22px}header p{margin:2px 0 0;color:#555}
  .tools{display:flex;gap:8px}.tools button{font:600 13px inherit;padding:7px 14px;border-radius:7px;border:1px solid #bbb;background:#f4f4f4;cursor:pointer}
  main{padding:14px 24px}main>svg{max-width:100%;height:auto;display:block;margin:0 auto}
  .tables{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:14px}
  table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #ddd;font-size:12px}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#555}
  .note{color:#666;font-size:11px;margin-top:10px}
  @media print{.tools{display:none}@page{size:A3 landscape;margin:10mm}main{padding:0}}
</style></head><body>
<header><div><h1>${escape(title)}</h1><p>${escape(show ? `${show} · ` : "")}${lights.length} lights · ${date} · drawn by Light Spark</p></div>
<div class="tools"><button onclick="print()">🖨 Print</button><button id="saveSvg">⬇ Save as SVG</button></div></header>
<main>${svg}
<div class="tables"><div><h3>Lights</h3><table><tr><th></th><th>Type</th><th>How many</th><th>Channels</th></tr>${key}</table></div>
<div><h3>Bars, trusses &amp; booms</h3><table><tr><th>Name</th><th>What</th><th>Size</th><th>Height</th><th>Lights</th></tr>${bars || `<tr><td colspan="5">None</td></tr>`}</table></div></div>
<p class="note">Grid in metres: across from centre line (CL), up- and downstage from the setting line (SL, the front of the stage). Each light shows its number, and its universe/address underneath; the dashed line points where it's focused.</p>
</main>
<script>
  document.getElementById("saveSvg").onclick = () => {
    const blob = new Blob([document.querySelector("main > svg").outerHTML], { type: "image/svg+xml" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "lighting-plot.svg" });
    a.click();
  };
</script></body></html>`;
}

function symbolSvg(shape, colour = "") {
  const fill = colour ? ` style="fill:${colour};fill-opacity:0.35"` : "";
  if (shape === "circle" || shape === "wash" || shape === "par") return `<circle r="0.17" class="sym"${fill}/>`;
  if (shape === "moving") return `<rect x="-0.17" y="-0.17" width="0.34" height="0.34" rx="0.06" class="sym"${fill}/><circle r="0.1" class="sym" style="fill:none"/>`;
  return `<path d="${SYMBOLS[shape] || SYMBOLS.profile}" class="sym"${fill}/>`;
}

// The plan outline of a venue item: its footprint corners (world x, z), and for bars
// and trusses the line they run along.
export function outlineOf(item, group) {
  const box = new THREE.Box3().setFromObject(group);
  const centre = [item.x, item.z];
  if (KINDS[item.kind]?.hang && item.kind !== "boom") {
    const half = item.w / 2, a = THREE.MathUtils.degToRad(item.ry || 0);
    const dx = Math.cos(a) * half, dz = -Math.sin(a) * half;
    return { item, centre, line: [[item.x - dx, item.z - dz], [item.x + dx, item.z + dz]], points: [[item.x - dx, item.z - dz], [item.x + dx, item.z + dz]] };
  }
  // The item's own footprint, turned as it stands (from its geometry's extent in its own frame).
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const local = new THREE.Box3();
  group.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox?.();
    if (!o.geometry.boundingBox) return;
    local.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld)));
  });
  if (local.isEmpty()) return { item, centre, points: [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z]] };
  const corners = [[local.min.x, local.min.z], [local.max.x, local.min.z], [local.max.x, local.max.z], [local.min.x, local.max.z]]
    .map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(group.matrixWorld)).map(v => [v.x, v.z]);
  const middle = corners.reduce((s, [x, z]) => [s[0] + x / 4, s[1] + z / 4], [0, 0]);
  return { item, centre: middle, points: corners };
}
