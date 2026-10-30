// More than one view at once, like Capture: the 3D view (with beams, bloom
// and haze) plus flat technical views — Plan (from above), Front and Side —
// drawn in the same window. Each flat view zooms (wheel), pans (drag) and
// double-click puts it back. 1, 2 or 4 views: the buttons in the toolbar.
//
// The flat views are a "clay" model: everything in light grey, so the set
// and the rig read clearly, with the stage light (colour, where it lands,
// shadows) on it and a soft working light, like Capture's technical views.
// No beams, lens glows or labels. The room's ceiling and the audience side
// are cut away so you see the stage.
import * as THREE from "three";

const KEY = "vizSplit";
const GAP = 4;

export function createViews({ renderer, scene, venue, wake, onLayout }) {
  let split = 1;
  try { split = Number(localStorage.getItem(KEY)) || 1; } catch (_) {}
  if (![1, 2, 4].includes(split)) split = 1;
  let forcedSingle = false; // Build mode works in one view

  // Each flat view: which way it looks, and where it's centred / how much it shows.
  const flat = {
    plan: { label: "Plan", centre: null, half: null },
    front: { label: "Front", centre: null, half: null },
    side: { label: "Side", centre: null, half: null }
  };
  // Off (0) except while the flat views draw: always in the scene, so the
  // 3D view's materials don't recompile when it comes and goes.
  const fill = new THREE.HemisphereLight(0xdde4ec, 0x2a2824, 0);
  scene.add(fill);
  const clay = new THREE.MeshStandardMaterial({ color: 0xa3a6ab, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const cameras = Object.fromEntries(Object.keys(flat).map(k => [k, new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)]));

  // What fits the stage, from the venue's size.
  function home(kind) {
    const v = venue();
    const sw = v?.stage?.width || 12, sd = v?.stage?.depth || 9;
    const h = (v?.room?.height || 11);
    if (kind === "plan") return { centre: [0, -sd / 2 + 1.5], half: Math.max(sd, sw * 0.6) * 0.75 };
    if (kind === "front") return { centre: [0, Math.min(h, 9) / 2 + 0.5], half: Math.max(5, Math.min(h, 9) / 2 + 1) };
    return { centre: [-sd / 2 + 2, Math.min(h, 9) / 2 + 0.5], half: Math.max(5, Math.min(h, 9) / 2 + 1) };
  }
  for (const k of Object.keys(flat)) Object.assign(flat[k], home(k));

  function place(kind, rect) {
    const cam = cameras[kind], f = flat[kind], v = venue();
    const aspect = rect.w / Math.max(1, rect.h);
    cam.left = -f.half * aspect; cam.right = f.half * aspect; cam.top = f.half; cam.bottom = -f.half;
    const roomH = v?.room?.height || 11, house = v?.room?.house || 17, halfW = (v?.room?.width || 22) / 2;
    const stageHalf = (v?.stage?.width || 12) / 2;
    if (kind === "plan") {
      // From just under the ceiling, looking down; upstage at the top.
      cam.position.set(f.centre[0], roomH - 0.3, f.centre[1]);
      cam.up.set(0, 0, -1);
      cam.lookAt(f.centre[0], 0, f.centre[1]);
      cam.near = 0.05; cam.far = roomH + 2;
    } else if (kind === "front") {
      // From the back of the house, with the audience cut away (only what's
      // upstage of just in front of the stage edge shows).
      cam.position.set(f.centre[0], f.centre[1], house - 0.3);
      cam.up.set(0, 1, 0);
      cam.lookAt(f.centre[0], f.centre[1], -100);
      cam.near = Math.max(0.05, house - 0.3 - 0.6); cam.far = house + 40;
    } else {
      // From the stage-right wall, cut just outside the stage.
      cam.position.set(-halfW + 0.3, f.centre[1], f.centre[0]);
      cam.up.set(0, 1, 0);
      cam.lookAt(100, f.centre[1], f.centre[0]);
      cam.near = Math.max(0.05, halfW - 0.3 - stageHalf - 0.4); cam.far = halfW * 2 + 2;
    }
    cam.updateProjectionMatrix();
  }

  // Where each view is on screen (CSS pixels, from the top left), below the toolbar.
  function rects() {
    const W = innerWidth, H = innerHeight;
    const bar = document.body.classList.contains("bar-hidden") ? 0 : Math.ceil((document.querySelector(".bar")?.getBoundingClientRect().bottom || 0) + 6);
    const n = forcedSingle ? 1 : split;
    if (n === 1) return { main: { x: 0, y: 0, w: W, h: H } };
    const top = bar, h = H - top;
    if (n === 2) {
      const mw = Math.round(W * 0.6);
      return { main: { x: 0, y: top, w: mw - GAP / 2, h }, plan: { x: mw + GAP / 2, y: top, w: W - mw - GAP / 2, h } };
    }
    const hw = Math.round(W / 2), hh = Math.round(h / 2);
    return {
      main: { x: 0, y: top, w: hw - GAP / 2, h: hh - GAP / 2 },
      plan: { x: hw + GAP / 2, y: top, w: W - hw - GAP / 2, h: hh - GAP / 2 },
      front: { x: 0, y: top + hh + GAP / 2, w: hw - GAP / 2, h: h - hh - GAP / 2 },
      side: { x: hw + GAP / 2, y: top + hh + GAP / 2, w: W - hw - GAP / 2, h: h - hh - GAP / 2 }
    };
  }

  // A label and the mouse for each flat view (on top of the canvas, so the
  // 3D view's mouse controls don't see clicks there).
  const overlays = {};
  for (const kind of Object.keys(flat)) {
    const el = document.createElement("div");
    el.className = "viz-flat";
    el.innerHTML = `<span class="viz-flat-label">${flat[kind].label}</span><button type="button" class="viz-flat-home" title="Fit the stage (or double-click)">⤢</button>`;
    el.hidden = true;
    document.body.appendChild(el);
    overlays[kind] = el;
    let dragFrom = null;
    el.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      dragFrom = { x: e.clientX, y: e.clientY, centre: [...flat[kind].centre] };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", e => {
      if (!dragFrom) return;
      const r = el.getBoundingClientRect();
      const perPx = (flat[kind].half * 2) / Math.max(1, r.height);
      const dx = (e.clientX - dragFrom.x) * perPx, dy = (e.clientY - dragFrom.y) * perPx;
      // Plan: across and depth (upstage at the top). Front: across and up. Side: depth and up.
      if (kind === "plan") flat[kind].centre = [dragFrom.centre[0] - dx, dragFrom.centre[1] - dy];
      else if (kind === "front") flat[kind].centre = [dragFrom.centre[0] - dx, dragFrom.centre[1] + dy];
      else flat[kind].centre = [dragFrom.centre[0] + dx, dragFrom.centre[1] + dy];
      wake();
    });
    const end = () => { dragFrom = null; };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", e => {
      e.preventDefault();
      flat[kind].half = Math.max(1, Math.min(40, flat[kind].half * Math.exp(e.deltaY * 0.0015)));
      wake();
    }, { passive: false });
    const reset = () => { Object.assign(flat[kind], home(kind)); wake(); };
    el.addEventListener("dblclick", reset);
    el.querySelector(".viz-flat-home").addEventListener("click", reset);
  }

  function showOverlays() {
    const r = rects();
    for (const [kind, el] of Object.entries(overlays)) {
      const rect = r[kind];
      el.hidden = !rect;
      if (rect) Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    }
    document.body.dataset.split = String(forcedSingle ? 1 : split);
    document.querySelectorAll("[data-split]").forEach(b => b.classList.toggle("on", Number(b.dataset.split) === split));
  }

  function setSplit(n) {
    split = [1, 2, 4].includes(n) ? n : 1;
    try { localStorage.setItem(KEY, String(split)); } catch (_) {}
    showOverlays();
    onLayout();
    wake();
  }
  function setForcedSingle(on) {
    if (forcedSingle === on) return;
    forcedSingle = on;
    showOverlays();
    onLayout();
    wake();
  }

  // Draw the flat views (after the 3D view), each in its own part of the canvas.
  const toneWas = { mapping: THREE.NoToneMapping, exposure: 1 };
  function draw(exposure = 1) {
    const r = rects();
    const kinds = Object.keys(flat).filter(k => r[k]);
    if (!kinds.length) return;
    const H = innerHeight;
    toneWas.mapping = renderer.toneMapping; toneWas.exposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.75 * exposure;
    fill.intensity = 0.8;
    // Clay for the solids; glows, labels, lines and particles hidden.
    const swapped = [];
    scene.traverseVisible(o => {
      if (o.isSprite || o.isPoints || o.isLine) { swapped.push([o, null]); return; }
      if (o.isMesh && o.material && !Array.isArray(o.material) && !o.material.isShaderMaterial) swapped.push([o, o.material]);
    });
    for (const [o, m] of swapped) { if (m) o.material = clay; else o.visible = false; }
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    for (const kind of kinds) {
      const rect = r[kind];
      place(kind, rect);
      renderer.setViewport(rect.x, H - rect.y - rect.h, rect.w, rect.h);
      renderer.setScissor(rect.x, H - rect.y - rect.h, rect.w, rect.h);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, cameras[kind]);
    }
    for (const [o, m] of swapped) { if (m) o.material = m; else o.visible = true; }
    fill.intensity = 0;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, H);
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = toneWas.mapping;
    renderer.toneMappingExposure = toneWas.exposure;
  }

  // The toolbar buttons.
  document.querySelectorAll("[data-split]").forEach(b => b.addEventListener("click", () => setSplit(Number(b.dataset.split))));
  window.addEventListener("resize", showOverlays);
  showOverlays();

  return { rects, draw, setSplit, setForcedSingle, split: () => (forcedSingle ? 1 : split), refresh: showOverlays };
}
