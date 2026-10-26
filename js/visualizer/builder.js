// Build mode: design the venue in the visualiser, like Capture's design
// mode. Add bars, trusses, booms, drapes, cycs, flats, rostra, steps,
// speakers, seating, people for scale and imported 3D models; move and turn
// them with handles or typed numbers; set the stage and room sizes, the
// proscenium and the house tabs. Lights hanging on a bar, truss or boom
// move with it. Everything saves with the show (layout.venue).
//
// Keys (in Build mode): G move · R rotate · Delete remove · ⌘/Ctrl+D
// duplicate · ⌘/Ctrl+Z undo (⇧ to redo) · arrows nudge (⇧ more) · Page
// Up/Down raise/lower · Esc deselect.
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { KINDS, KIND_GROUPS, MATERIALS, defaultVenue, itemMatrix, makeItem, newId, normaliseVenue } from "./venue.js";
import { hangsOn, modelUnit, STAGE, STAGE_TOP } from "./theatre.js";

const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const escape = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const deg = THREE.MathUtils.radToDeg;
const round = (n, places = 3) => +Number(n).toFixed(places);

// ctx: { scene, camera, renderer, controls, theatre, venue(), commit(venue, changed), fixtures, saveLayout, wake }
export function createBuilder(ctx) {
  let active = false;
  let selectedId = null;
  const undo = [];
  const redo = [];
  let snap = 0.05;
  let designLit = true;

  const transform = new TransformControls(ctx.camera, ctx.renderer.domElement);
  transform.setTranslationSnap(snap);
  transform.setRotationSnap(THREE.MathUtils.degToRad(15));
  transform.setSize(0.85);
  transform.visible = false;
  transform.enabled = false;
  ctx.scene.add(transform);
  // While building, a soft even light so the set can be seen whatever the rig is doing.
  const designLight = new THREE.HemisphereLight(0xdfe6ff, 0x30302c, 1.4);
  designLight.visible = false;
  ctx.scene.add(designLight);
  const outline = new THREE.BoxHelper(undefined, 0xffc23d);
  outline.visible = false;
  outline.material.depthTest = false;
  outline.material.transparent = true;
  outline.renderOrder = 9;
  ctx.scene.add(outline);

  // --- Panel ---------------------------------------------------------------

  const panel = document.createElement("div");
  panel.id = "buildPanel";
  panel.hidden = true;
  document.body.appendChild(panel);
  const fileInput = Object.assign(document.createElement("input"), { type: "file", accept: ".glb,.gltf,.obj,.stl", hidden: true });
  const stageFileInput = Object.assign(document.createElement("input"), { type: "file", accept: ".json,.lsstage", hidden: true });
  document.body.append(fileInput, stageFileInput);
  // Keys typed in the panel stay in the panel.
  panel.addEventListener("keydown", event => event.stopPropagation());

  const venue = () => ctx.venue();
  const item = id => venue().items.find(i => i.id === id);

  function render() {
    if (!active) return;
    const v = venue();
    const selected = item(selectedId);
    const field = (key, label, value, step = 0.05, attrs = "") => `<label class="bf"><span>${label}</span><input data-k="${key}" type="number" step="${step}" value="${value}" ${attrs}></label>`;
    const choice = (key, label, options, value) => `<label class="bf"><span>${label}</span><select data-k="${key}">${options.map(([v2, l]) => `<option value="${v2}"${String(v2) === String(value) ? " selected" : ""}>${escape(l)}</option>`).join("")}</select></label>`;
    const add = KIND_GROUPS.map(group => `
      <div class="bgroup"><div class="blabel">${group}</div><div class="badd">
        ${Object.entries(KINDS).filter(([, k]) => k.group === group).map(([kind, k]) => `<button data-add="${kind}" title="Add a ${escape(k.label.replace(/…$/, "").toLowerCase())}"><b>${k.icon}</b>${escape(k.label)}</button>`).join("")}
      </div></div>`).join("");
    let selectedHtml = "";
    if (selected) {
      const spec = KINDS[selected.kind];
      selectedHtml = `
        <div class="bsection bsel">
          <div class="bhead"><b>${spec.icon}</b><input data-k="name" class="bname" value="${escape(selected.name)}"></div>
          <div class="brow">
            ${field("x", "Across", round(selected.x, 2))}
            ${field("y", spec.hang && selected.kind !== "boom" ? "Height" : "Base height", round(selected.y, 2))}
            ${field("z", "Depth", round(selected.z, 2))}
          </div>
          <div class="brow">
            ${field("ry", "Turn °", round(selected.ry, 1), 5)}
            ${field("rx", "Tilt °", round(selected.rx, 1), 5)}
            ${field("rz", "Roll °", round(selected.rz, 1), 5)}
          </div>
          <div class="brow">
            ${spec.fields.map(([key, label, step, min, max]) => Array.isArray(step) ? choice(key, label, step, selected[key]) : field(key, label, selected[key], step, `min="${min}" max="${max}"`)).join("")}
          </div>
          <div class="brow">
            <label class="bf"><span>Colour</span><input data-k="color" type="color" value="${selected.color}"></label>
            ${choice("material", "Finish", MATERIALS, selected.material)}
          </div>
          <div class="brow bchecks">
            <label><input data-k="hidden" type="checkbox"${selected.hidden ? " checked" : ""}> Hidden</label>
            <label><input data-k="locked" type="checkbox"${selected.locked ? " checked" : ""}> Locked</label>
          </div>
          <div class="brow">
            <button data-act="duplicate" title="⌘/Ctrl+D">Duplicate</button>
            <button data-act="focus" title="F">Look at it</button>
            <button data-act="delete" class="danger" title="Delete">Delete</button>
          </div>
          ${spec.hang ? `<div class="bnote">Lights hung on it move with it.</div>` : ""}
        </div>`;
    }
    const s = v.stage, r = v.room, p = v.proscenium, t = v.tabs;
    panel.innerHTML = `
      <div class="btop">
        <b>Build the stage</b>
        <div class="bmodes">
          <button data-mode="translate" class="${transform.mode === "translate" ? "on" : ""}" title="G">Move</button>
          <button data-mode="rotate" class="${transform.mode === "rotate" ? "on" : ""}" title="R">Rotate</button>
          <select data-snap title="Snap moves to a grid">
            ${[[0, "No snap"], [0.05, "Snap 5cm"], [0.1, "Snap 10cm"], [0.25, "Snap 25cm"], [0.5, "Snap 50cm"]].map(([value, label]) => `<option value="${value}"${value === snap ? " selected" : ""}>${label}</option>`).join("")}
          </select>
          <button data-act="undo" title="⌘/Ctrl+Z"${undo.length ? "" : " disabled"}>↶</button>
          <button data-act="redo" title="⇧⌘/Ctrl+Z"${redo.length ? "" : " disabled"}>↷</button>
          <button data-act="light" class="${designLit ? "on" : ""}" title="A soft light over everything while you build">💡 Light</button>
          <button data-act="close" title="Esc twice">Done</button>
        </div>
      </div>
      ${selectedHtml}
      <details class="bsection" ${selected ? "" : "open"}><summary>Add to the stage</summary>${add}</details>
      <details class="bsection"><summary>Everything in the room (${v.items.length})</summary>
        <div class="blist">${v.items.map(i => `<button data-pick="${escape(i.id)}" class="${i.id === selectedId ? "on" : ""}${i.hidden ? " dim" : ""}"><b>${KINDS[i.kind].icon}</b>${escape(i.name)}${i.locked ? " 🔒" : ""}</button>`).join("")}</div>
      </details>
      <details class="bsection"><summary>Stage &amp; room</summary>
        <div class="blabel">Stage</div>
        <div class="brow" data-part="stage">
          ${field("width", "Width", s.width, 0.1)}${field("depth", "Depth", s.depth, 0.1)}${field("height", "Height", s.height, 0.05)}
          <label class="bf"><span>Floor</span><input data-k="color" type="color" value="${s.color}"></label>
        </div>
        <div class="blabel">Room</div>
        <div class="brow" data-part="room">
          ${field("width", "Width", r.width, 0.5)}${field("height", "Height", r.height, 0.5)}${field("house", "Audience depth", r.house, 0.5)}${field("backstage", "Behind stage", r.backstage, 0.5)}
          <label class="bf"><span>Walls</span><input data-k="color" type="color" value="${r.color}"></label>
        </div>
        <div class="blabel">Proscenium arch</div>
        <div class="brow" data-part="proscenium">
          <label class="bcheck"><input data-k="show" type="checkbox"${p.show ? " checked" : ""}> Show</label>
          ${field("width", "Opening width", p.width, 0.1)}${field("height", "Opening height", p.height, 0.1)}
          <label class="bf"><span>Colour</span><input data-k="color" type="color" value="${p.color}"></label>
        </div>
        <div class="blabel">House tabs (front curtain)</div>
        <div class="brow" data-part="tabs">
          <label class="bcheck"><input data-k="show" type="checkbox"${t.show ? " checked" : ""}${p.show ? "" : " disabled"}> Show</label>
          <label class="bf"><span>Colour</span><input data-k="color" type="color" value="${t.color}"></label>
        </div>
        <div class="blabel">Start again from</div>
        <div class="brow">
          <button data-template="proscenium">Proscenium theatre</button>
          <button data-template="blackbox">Black box studio</button>
          <button data-template="empty">Empty stage</button>
        </div>
        <div class="blabel">Save this stage for another show</div>
        <div class="brow">
          <button data-act="export">Save stage file…</button>
          <button data-act="import">Load stage file…</button>
        </div>
      </details>
      <div class="bhint">Click something to select it · drag the handles · lights still drag as normal · G move, R rotate, ⌘/Ctrl+D duplicate, Delete, ⌘/Ctrl+Z undo</div>`;
  }

  // --- Changing the venue ------------------------------------------------------

  // Every change goes through here, so it can be undone (with where the lights were).
  function change(mutate, changed = null, { record = true, positions = ctx.positions() } = {}) {
    const before = venue();
    const next = clone({ ...before, assets: {} });
    next.assets = before.assets; // (models aren't copied for undo)
    const ids = mutate(next);
    const normalised = normaliseVenue(next);
    normalised.assets = next.assets;
    if (record) {
      undo.push({ venue: before, positions });
      if (undo.length > 60) undo.shift();
      redo.length = 0;
    }
    ctx.commit(normalised, changed === "all" ? null : ids || changed);
    attach();
    render();
  }

  function restore(from, to) {
    if (!from.length) return;
    to.push({ venue: venue(), positions: ctx.positions() });
    const entry = from.pop();
    ctx.commit(entry.venue, null);
    ctx.restorePositions(entry.positions);
    if (!item(selectedId)) selectedId = null;
    attach();
    render();
  }

  // Lights hanging on an item move with it: from where the item was to where it is.
  function carryLights(fromItem, toItem) {
    const from = itemMatrix(fromItem), to = itemMatrix(toItem);
    const move = to.multiply(from.invert());
    let moved = 0;
    for (const model of ctx.fixtures.values()) {
      const p = model.root.position;
      if (!hangsOn(fromItem, p)) continue;
      const next = p.clone().applyMatrix4(move);
      model.place({ x: next.x, y: next.y, z: next.z });
      moved++;
    }
    return moved;
  }

  function addItem(kind) {
    if (kind === "model") { fileInput.value = ""; fileInput.click(); return; }
    const target = ctx.controls.target;
    const onStage = target.z < 0 && target.z > -STAGE.depth && Math.abs(target.x) < STAGE.width / 2;
    const floor = onStage ? STAGE_TOP : 0;
    const spec = KINDS[kind];
    const place = { x: round(Math.max(-STAGE.width / 2, Math.min(STAGE.width / 2, target.x)), 2), z: round(onStage ? target.z : -STAGE.depth / 2, 2) };
    if (kind === "bar" || kind === "truss") Object.assign(place, { x: 0 });
    else if (kind === "seating") Object.assign(place, { x: 0, z: 3, y: 0 });
    else if (kind === "speaker") Object.assign(place, { x: STAGE.width / 2 + 0.8, z: 0.6, y: 0 });
    else if (kind === "screen") place.y = floor + 2;
    else if (spec.defaults.y === 1) place.y = floor;
    // Not on top of something already there: step across until there's room.
    if (place.x !== undefined && kind !== "bar" && kind !== "truss" && kind !== "seating") {
      for (let tries = 0; tries < 12 && venue().items.some(i => !KINDS[i.kind].hang && i.kind !== "seating" && Math.hypot(i.x - place.x, i.z - place.z) < 0.9); tries++) {
        place.x = round(place.x + (tries % 2 ? -1 : 1) * 1.2 * (tries + 1), 2);
      }
    }
    if (kind === "bar" || kind === "truss") {
      // Upstage of the last bar over the stage.
      const bars = venue().items.filter(i => (i.kind === "bar" || i.kind === "truss") && i.z < 0);
      place.z = bars.length ? round(Math.max(-STAGE.depth + 0.5, Math.min(...bars.map(i => i.z)) - 1.3), 2) : -1.2;
    }
    const fresh = makeItem(kind, place);
    // Numbered names: "LX 4", "Flat 2"…
    const same = venue().items.filter(i => i.kind === kind).length;
    if (kind === "bar") fresh.name = `LX ${venue().items.filter(i => i.kind === "bar" && /^LX \d+/.test(i.name)).length + 1}`;
    else if (same) fresh.name = `${fresh.name} ${same + 1}`;
    selectedId = fresh.id;
    change(next => { next.items.push(fresh); return [fresh.id]; });
  }

  async function importModel(file) {
    if (!file) return;
    if (file.size > MAX_MODEL_BYTES) { alert(`That model is ${(file.size / 1048576).toFixed(0)} MB. Models up to 25 MB can go in a show (try exporting it with fewer polygons).`); return; }
    const type = (file.name.split(".").pop() || "").toLowerCase();
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const assetId = newId();
    const asset = { name: file.name, type, data };
    try { asset.unit = await modelUnit(assetId, asset); } catch (error) { alert(`Couldn't read ${file.name}: ${error.message || error}`); return; }
    const target = ctx.controls.target;
    const fresh = makeItem("model", { name: file.name.replace(/\.[^.]+$/, ""), assetId, x: round(target.x, 2), z: round(Math.min(-0.5, target.z), 2), y: STAGE_TOP });
    selectedId = fresh.id;
    change(next => {
      next.assets = { ...next.assets, [assetId]: asset };
      next.items.push(fresh);
      return [fresh.id];
    });
  }
  fileInput.addEventListener("change", () => importModel(fileInput.files[0]));

  function exportStage() {
    const blob = new Blob([JSON.stringify({ lightSparkStage: 1, venue: venue() })], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "stage.lsstage" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  stageFileInput.addEventListener("change", async () => {
    const file = stageFileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const loaded = normaliseVenue(data.venue || data);
      if (!loaded) throw new Error("not a stage file");
      if (!confirm(`Replace this stage with “${file.name}”? (Undo puts it back.)`)) return;
      selectedId = null;
      change(next => { Object.assign(next, loaded); return null; }, "all");
    } catch (error) { alert(`Couldn't load ${file.name}: ${error.message}`); }
  });

  // --- Selecting and the handles ---------------------------------------------

  function attach() {
    const entry = selectedId ? ctx.theatre.items.get(selectedId) : null;
    const selected = item(selectedId);
    if (entry && active && selected && !selected.locked && !selected.hidden) {
      transform.attach(entry.group);
      transform.visible = transform.enabled = true;
    } else {
      transform.detach();
      transform.visible = transform.enabled = false;
    }
    if (entry && active) {
      outline.setFromObject(entry.group);
      outline.visible = true;
    } else outline.visible = false;
    ctx.wake();
  }

  function select(id) {
    selectedId = id;
    attach();
    render();
  }

  let dragStart = null; // the item as it was when a handle drag began
  let dragPositions = null; // …and where the lights were
  transform.addEventListener("dragging-changed", event => {
    ctx.controls.enabled = !event.value;
    const selected = item(selectedId);
    if (!selected) return;
    if (event.value) {
      dragStart = clone(selected);
      dragPositions = ctx.positions();
      return;
    }
    // Drag over: keep it (undoable), with its lights where they've been carried.
    const moved = clone(selected);
    Object.assign(selected, dragStart); // (so undo has the old place)
    dragStart = null;
    change(next => {
      const target = next.items.find(i => i.id === moved.id);
      Object.assign(target, { x: moved.x, y: moved.y, z: moved.z, rx: moved.rx, ry: moved.ry, rz: moved.rz });
      return [];
    }, [], { positions: dragPositions });
    ctx.saveLayout();
  });
  transform.addEventListener("objectChange", () => {
    const selected = item(selectedId);
    const entry = ctx.theatre.items.get(selectedId);
    if (!selected || !entry) return;
    const g = entry.group;
    const before = clone(selected);
    Object.assign(selected, { x: round(g.position.x), y: round(g.position.y), z: round(g.position.z), rx: round(deg(g.rotation.x), 2), ry: round(deg(g.rotation.y), 2), rz: round(deg(g.rotation.z), 2) });
    if (KINDS[selected.kind].hang) carryLights(before, selected);
    outline.setFromObject(g);
    ctx.moved();
    // Live numbers in the panel.
    for (const key of ["x", "y", "z", "rx", "ry", "rz"]) {
      const input = panel.querySelector(`.bsel [data-k="${key}"]`);
      if (input && document.activeElement !== input) input.value = round(selected[key], key.startsWith("r") ? 1 : 2);
    }
  });

  // --- Panel events ----------------------------------------------------------

  panel.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.add) return addItem(button.dataset.add);
    if (button.dataset.pick) return select(button.dataset.pick);
    if (button.dataset.mode) { transform.setMode(button.dataset.mode); render(); return; }
    if (button.dataset.template) {
      if (!confirm("Start the stage again? Lights stay where they are: Reset layout (in the toolbar) hangs them on the new bars. Undo puts the stage back.")) return;
      const template = button.dataset.template;
      const fresh = template === "empty" ? { ...defaultVenue("proscenium"), items: [] } : defaultVenue(template);
      selectedId = null;
      change(next => { Object.assign(next, fresh, { assets: next.assets }); return null; }, "all");
      return;
    }
    const act = button.dataset.act;
    if (act === "undo") restore(undo, redo);
    else if (act === "redo") restore(redo, undo);
    else if (act === "close") toggle(false);
    else if (act === "light") { designLit = !designLit; designLight.visible = designLit; ctx.wake(); render(); }
    else if (act === "delete") remove();
    else if (act === "duplicate") duplicate();
    else if (act === "focus") focus();
    else if (act === "export") exportStage();
    else if (act === "import") { stageFileInput.value = ""; stageFileInput.click(); }
  });

  panel.addEventListener("change", event => {
    const input = event.target;
    if (input.dataset.snap !== undefined) {
      snap = Number(input.value);
      transform.setTranslationSnap(snap || null);
      return;
    }
    const key = input.dataset.k;
    if (!key) return;
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    if (input.type === "number" && !Number.isFinite(value)) return;
    const part = input.closest("[data-part]")?.dataset.part;
    if (part) {
      change(next => { next[part] = { ...next[part], [key]: value }; return null; }, []);
      return;
    }
    const selected = item(selectedId);
    if (!selected) return;
    const placeOnly = ["x", "y", "z", "rx", "ry", "rz"].includes(key);
    const before = clone(selected);
    change(next => {
      const target = next.items.find(i => i.id === selectedId);
      target[key] = value;
      if (placeOnly && KINDS[target.kind].hang) carryLights(before, { ...target });
      return [selectedId];
    });
    if (placeOnly || key === "w" || key === "h") ctx.saveLayout();
  });

  function remove() {
    const selected = item(selectedId);
    if (!selected) return;
    const id = selectedId;
    selectedId = null;
    change(next => { next.items = next.items.filter(i => i.id !== id); return [id]; });
  }
  function duplicate() {
    const selected = item(selectedId);
    if (!selected) return;
    // Beside the original (along its own length for bars).
    const offset = selected.kind === "bar" || selected.kind === "truss" ? { z: -1 } : selected.kind === "seating" ? { z: 2 } : { x: Math.max(0.5, (selected.w || 1) + 0.2) };
    const copy = { ...clone(selected), id: newId(), name: `${selected.name} copy`, x: selected.x + (offset.x || 0), z: selected.z + (offset.z || 0), locked: false };
    selectedId = copy.id;
    change(next => { next.items.push(copy); return [copy.id]; });
  }
  function focus() {
    const entry = ctx.theatre.items.get(selectedId);
    if (!entry) return;
    const box = new THREE.Box3().setFromObject(entry.group);
    if (!box.isEmpty()) ctx.controls.target.copy(box.getCenter(new THREE.Vector3()));
    ctx.controls.update();
    ctx.wake();
  }
  function nudge(dx, dy, dz) {
    const selected = item(selectedId);
    if (!selected || selected.locked) return;
    const step = snap || 0.05;
    const before = clone(selected);
    change(next => {
      const target = next.items.find(i => i.id === selectedId);
      target.x = round(target.x + dx * step); target.y = round(target.y + dy * step); target.z = round(target.z + dz * step);
      if (KINDS[target.kind].hang) carryLights(before, { ...target });
      return [selectedId];
    });
    ctx.saveLayout();
  }

  // --- Mouse and keys (main.js asks first in Build mode) -------------------------

  const raycaster = new THREE.Raycaster();
  function pointerDown(event, pointerRay) {
    if (!active) return false;
    if (transform.dragging || transform.axis) return true; // on a handle
    raycaster.ray.copy(pointerRay);
    const hits = raycaster.intersectObjects(ctx.theatre.itemsGroup.children, true).filter(h => h.object.visible && h.object.userData.venueId);
    const fixtureHit = ctx.fixtureHitDistance();
    const hit = hits[0];
    // A light in front of the scenery wins (so lights can still be dragged).
    if (hit && !(fixtureHit != null && fixtureHit < hit.distance)) {
      select(hit.object.userData.venueId);
      return true;
    }
    if (selectedId && !hit && fixtureHit == null) select(null);
    return false;
  }

  function keyDown(event) {
    if (!active) return false;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (mod && key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) restore(redo, undo); else restore(undo, redo); return true; }
    if (mod && key.toLowerCase() === "y") { event.preventDefault(); restore(redo, undo); return true; }
    if (mod && key.toLowerCase() === "d") { event.preventDefault(); duplicate(); return true; }
    if (mod) return false;
    if (key === "Escape") { if (selectedId) select(null); else toggle(false); return true; }
    if (!selectedId) return ["g", "r"].includes(key);
    if (key === "Delete" || key === "Backspace") { remove(); return true; }
    if (key === "g") { transform.setMode("translate"); render(); return true; }
    if (key === "r") { transform.setMode("rotate"); render(); return true; }
    if (key === "f") { focus(); return true; }
    const big = event.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-big, 0, 0], ArrowRight: [big, 0, 0], ArrowUp: [0, 0, -big], ArrowDown: [0, 0, big], PageUp: [0, big, 0], PageDown: [0, -big, 0] };
    if (arrows[key]) { event.preventDefault(); nudge(...arrows[key]); return true; }
    return false;
  }

  function toggle(on = !active) {
    active = Boolean(on);
    panel.hidden = !active;
    document.body.classList.toggle("building", active);
    designLight.visible = active && designLit;
    if (!active) { selectedId = null; ctx.controls.enabled = true; }
    attach();
    render();
    ctx.onToggle?.(active);
  }

  return {
    toggle,
    get active() { return active; },
    pointerDown,
    keyDown,
    // The venue changed from outside (a show loaded): forget what was selected.
    refresh() { if (!item(selectedId)) selectedId = null; undo.length = redo.length = 0; attach(); render(); },
    transform
  };
}
