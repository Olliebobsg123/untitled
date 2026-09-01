"use strict";

/* Target system: reusable pan/tilt points with create, aim, capture and release. */
(function () {
  const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");

  function state() {
    window.State = window.State || {};
    if (!Array.isArray(State.targets)) State.targets = [];
    if (!(State.selected instanceof Set)) State.selected = new Set();
    if (!State.current || typeof State.current !== "object") State.current = {};
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
    return State;
  }

  function findTarget(name) {
    state();
    const wanted = clean(name).toLowerCase();
    if (/^\d+$/.test(wanted)) return State.targets[Number(wanted) - 1] || null;
    return State.targets.find(t => clean(t.name).toLowerCase() === wanted) || null;
  }

  function selectedFixtures() {
    state();
    return (State.fixtures || []).filter(f => State.selected.has(f.id));
  }

  function create(name) {
    state();
    const targetName = clean(name);
    if (!targetName) return { ok: false, message: "Target name cannot be empty." };
    if (findTarget(targetName)) return { ok: false, message: `Target \"${targetName}\" already exists.` };

    const pan = Number(State.current.pan);
    const tilt = Number(State.current.tilt);
    if (!Number.isFinite(pan) || !Number.isFinite(tilt)) {
      return { ok: false, message: "Current pan/tilt values are not available." };
    }

    const target = {
      id: `target-${Date.now()}`,
      name: targetName,
      pan: Math.max(0, Math.min(255, pan)),
      tilt: Math.max(0, Math.min(255, tilt)),
      captures: [],
      createdAt: new Date().toISOString()
    };
    State.targets.push(target);
    render();
    window.log?.(`Created target \"${target.name}\" at P${target.pan} T${target.tilt}`, "ok");
    return { ok: true, target };
  }

  function aim(name) {
    state();
    const target = findTarget(name);
    if (!target) return { ok: false, message: `Target \"${clean(name)}\" not found.` };
    if (!selectedFixtures().length) return { ok: false, message: "Select at least one fixture before aiming at a target." };

    const values = { pan: target.pan, tilt: target.tilt };
    Object.assign(State.current, values);
    selectedFixtures().forEach(fixture => {
      const current = typeof window.ensureFixtureState === "function"
        ? window.ensureFixtureState(fixture.id)
        : (State.fixtureStates.get(fixture.id) || {});
      Object.assign(current, values);
      if (!State.fixtureStates.has(fixture.id)) State.fixtureStates.set(fixture.id, current);
    });

    if (typeof window.fadeTo === "function") window.fadeTo(values, 300);
    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.renderFixtures === "function") window.renderFixtures();
    if (typeof window.buildControls === "function") window.buildControls();
    window.log?.(`Aimed ${selectedFixtures().length} fixture(s) at target \"${target.name}\"`, "ok");
    return { ok: true, target };
  }

  function capture(name) {
    state();
    const target = findTarget(name);
    if (!target) return { ok: false, message: `Target \"${clean(name)}\" not found.` };
    const fixtures = selectedFixtures();
    if (!fixtures.length) return { ok: false, message: "Select at least one fixture before capturing a target." };

    const pan = Number(State.current.pan);
    const tilt = Number(State.current.tilt);
    if (!Number.isFinite(pan) || !Number.isFinite(tilt)) {
      return { ok: false, message: "Current pan/tilt values are not available." };
    }

    target.pan = Math.max(0, Math.min(255, pan));
    target.tilt = Math.max(0, Math.min(255, tilt));
    target.captures = fixtures.map(f => ({ fixtureId: f.id, pan, tilt }));
    target.updatedAt = new Date().toISOString();
    render();
    window.log?.(`Captured target \"${target.name}\" from current fixture positions`, "ok");
    return { ok: true, target };
  }

  function release(name) {
    state();
    const target = findTarget(name);
    if (!target) return { ok: false, message: `Target \"${clean(name)}\" not found.` };
    const selected = selectedFixtures();
    const ids = new Set(selected.map(f => f.id));
    if (selected.length) target.captures = (target.captures || []).filter(c => !ids.has(c.fixtureId));
    else target.captures = [];
    target.updatedAt = new Date().toISOString();
    render();
    window.log?.(`Released ${selected.length ? `${selected.length} selected fixture(s) from` : "all fixtures from"} target \"${target.name}\"`, "ok");
    return { ok: true, target };
  }

  function remove(name) {
    state();
    const target = findTarget(name);
    if (!target) return { ok: false, message: `Target \"${clean(name)}\" not found.` };
    State.targets.splice(State.targets.indexOf(target), 1);
    render();
    window.log?.(`Deleted target \"${target.name}\"`, "ok");
    return { ok: true, target };
  }

  function list() {
    state();
    return State.targets;
  }

  function injectStyles() {
    if (document.getElementById("targetUiStyles")) return;
    const style = document.createElement("style");
    style.id = "targetUiStyles";
    style.textContent = `
      .target-launch{width:100%;margin-top:7px;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #263238;border-radius:8px;background:#10171b;color:#b9c5c2;cursor:pointer;font-size:9px;font-weight:850;letter-spacing:.7px;text-align:left;transition:.14s ease}
      .target-launch:hover{background:#172026;border-color:rgba(25,214,163,.3);color:#54f2c8;transform:translateY(-1px)}
      .target-launch span:last-child{color:#4f5d59;font-family:monospace;font-size:8px}
      .target-modal{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(3,6,8,.76);backdrop-filter:blur(8px)}
      .target-modal.open{display:flex}.target-window{width:min(760px,94vw);max-height:88vh;overflow:auto;background:#0b1114;border:1px solid #2b383f;border-radius:12px;box-shadow:0 28px 80px rgba(0,0,0,.55)}
      .target-head{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #202a30}.target-title{font-size:12px;font-weight:850;letter-spacing:.7px}.target-title small{display:block;margin-top:3px;color:#596764;font-size:7px;letter-spacing:1px}.target-close{width:30px;height:30px;border:1px solid #202a30;border-radius:7px;background:#10171b;color:#7d8987;cursor:pointer}.target-close:hover{color:#fff;background:#172026}
      .target-toolbar{display:flex;gap:7px;padding:12px 17px;border-bottom:1px solid #202a30}.target-toolbar input{flex:1;min-width:0;height:36px;padding:0 10px;background:#0d1418;border:1px solid #2b383f;border-radius:7px;color:#edf4f2}.target-toolbar button{height:36px;padding:0 12px;border:1px solid #2b383f;border-radius:7px;background:#10171b;color:#c6d0ce;cursor:pointer;font-weight:800;font-size:8px;letter-spacing:.5px}.target-toolbar button:hover{border-color:#19d6a3;color:#54f2c8}
      .target-list{padding:15px 17px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}.target-card{padding:11px;border:1px solid #202a30;border-radius:8px;background:#10171b;color:#b9c5c2}.target-card:hover{border-color:#39474d}.target-card strong{display:block;color:#edf4f2;font-size:10px}.target-coords{margin-top:5px;color:#61706c;font:8px monospace}.target-card-actions{display:flex;gap:5px;margin-top:9px}.target-card-actions button{flex:1;height:28px;border:1px solid #28343a;border-radius:6px;background:#0d1418;color:#9aa7a3;cursor:pointer;font-size:7px;font-weight:850;letter-spacing:.6px}.target-card-actions button:hover{color:#54f2c8;border-color:rgba(25,214,163,.4)}.target-empty{grid-column:1/-1;padding:30px;text-align:center;border:1px dashed #2b383f;color:#53615e;font-size:9px}
      @media(max-width:650px){.target-modal{padding:10px}.target-window{max-height:94vh}.target-toolbar{flex-wrap:wrap}.target-toolbar input{flex-basis:100%}}
    `;
    document.head.appendChild(style);
  }

  function open() { document.getElementById("targetModal")?.classList.add("open"); render(); }
  function close() { document.getElementById("targetModal")?.classList.remove("open"); }

  function render() {
    state();
    const listEl = document.querySelector("[data-target-list]");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!State.targets.length) {
      listEl.innerHTML = '<div class="target-empty">No targets created yet. Create one from the current pan/tilt position.</div>';
      return;
    }
    State.targets.forEach((target, index) => {
      const card = document.createElement("div");
      card.className = "target-card";
      card.innerHTML = `<strong>${index + 1}. ${clean(target.name)}</strong><div class="target-coords">PAN ${Math.round(target.pan)} · TILT ${Math.round(target.tilt)} · ${target.captures?.length || 0} CAPTURED</div><div class="target-card-actions"><button data-action="aim">AIM</button><button data-action="capture">CAPTURE</button><button data-action="release">RELEASE</button><button data-action="delete">DELETE</button></div>`;
      card.querySelector('[data-action="aim"]').onclick = () => { const r = aim(target.name); if (r.ok) close(); };
      card.querySelector('[data-action="capture"]').onclick = () => capture(target.name);
      card.querySelector('[data-action="release"]').onclick = () => release(target.name);
      card.querySelector('[data-action="delete"]').onclick = () => remove(target.name);
      listEl.appendChild(card);
    });
  }

  function createUI() {
    if (document.getElementById("targetModal")) return;
    injectStyles();
    const quickPanel = document.querySelector("#page-live .quick-panel .panel-body");
    if (quickPanel && !document.getElementById("targetLaunch")) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "targetLaunch";
      button.className = "target-launch";
      button.innerHTML = '<span>TARGETS</span><span>AIM / CAPTURE ↗</span>';
      button.onclick = open;
      quickPanel.appendChild(button);
    }
    const modal = document.createElement("div");
    modal.id = "targetModal";
    modal.className = "target-modal";
    modal.innerHTML = `<div class="target-window" role="dialog" aria-modal="true" aria-label="Target library"><div class="target-head"><div class="target-title">TARGET LIBRARY<small>POSITION CONTROL</small></div><button type="button" class="target-close">×</button></div><div class="target-toolbar"><input id="targetNameInput" placeholder="Target name e.g. Centre Stage"><button type="button" id="targetCreateButton">＋ CREATE TARGET</button></div><div class="target-list" data-target-list></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector(".target-close").onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.querySelector("#targetCreateButton").onclick = () => {
      const input = modal.querySelector("#targetNameInput");
      const result = create(input.value);
      if (result.ok) input.value = "";
      else window.log?.(result.message, "warn");
    };
    render();
  }

  function installCommands() {
    if (window.__targetCommandsInstalled || typeof window.parseCommand !== "function") return;
    const previous = window.parseCommand;
    window.parseCommand = function (raw) {
      const command = clean(raw);
      let m;
      if ((m = command.match(/^target\s+create\s+(.+)$/i))) { const r = create(m[1]); if (!r.ok) window.log?.(r.message, "warn"); return r; }
      if ((m = command.match(/^target\s+aim\s+(.+)$/i))) { const r = aim(m[1]); if (!r.ok) window.log?.(r.message, "warn"); return r; }
      if ((m = command.match(/^target\s+capture\s+(.+)$/i))) { const r = capture(m[1]); if (!r.ok) window.log?.(r.message, "warn"); return r; }
      if ((m = command.match(/^target\s+release\s+(.+)$/i))) { const r = release(m[1]); if (!r.ok) window.log?.(r.message, "warn"); return r; }
      if ((m = command.match(/^target\s+delete\s+(.+)$/i))) { const r = remove(m[1]); if (!r.ok) window.log?.(r.message, "warn"); return r; }
      if (/^targets$/i.test(command)) { return list(); }
      return previous.apply(this, arguments);
    };
    window.__targetCommandsInstalled = true;
  }

  window.Targets = { create, aim, capture, release, delete: remove, list, open, refresh: render };

  function boot() {
    state();
    createUI();
    installCommands();
    setInterval(() => { if (!document.getElementById("targetModal")) createUI(); installCommands(); }, 500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
