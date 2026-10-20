"use strict";
// Copies the three.js add-ons the visualiser uses (and what they import) into
// js/visualizer/vendor/three-addons. They live in three/examples/jsm, and the
// app packager leaves every "examples" folder in node_modules out of the
// installed app, so the visualiser can't load them from there.
//   node scripts/vendor-three-addons.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules/three/examples/jsm");
const out = path.join(root, "js/visualizer/vendor/three-addons");
const used = new Set();
for (const f of fs.readdirSync(path.join(root, "js/visualizer"))) {
  if (!f.endsWith(".js")) continue;
  for (const m of fs.readFileSync(path.join(root, "js/visualizer", f), "utf8").matchAll(/from\s+["']three\/addons\/([^"']+)["']/g)) used.add(m[1]);
}
const queue = [...used], done = new Set();
while (queue.length) {
  const rel = path.normalize(queue.shift());
  if (done.has(rel)) continue;
  done.add(rel);
  const text = fs.readFileSync(path.join(src, rel), "utf8");
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.writeFileSync(path.join(out, rel), text);
  for (const m of text.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) queue.push(path.join(path.dirname(rel), m[1]));
}
console.log(`three add-ons: ${done.size} files → ${path.relative(root, out)}`);
