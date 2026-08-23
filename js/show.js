"use strict";

function getMultiOutputShowState() {
  try {
    const raw = localStorage.getItem("lighting-multi-outputs");
    const outputs = JSON.parse(raw || "[]");
    return Array.isArray(outputs) ? outputs : [];
  } catch (_) {
    return [];
  }
}

function restoreMultiOutputShowState(outputs) {
  if (!Array.isArray(outputs)) return;
  try {
    localStorage.setItem("lighting-multi-outputs", JSON.stringify(outputs));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent("show-multi-output-restore", { detail: { outputs } }));
}

function saveShow() {
  try {
    const vizState = {};
    const Viz = window.S || window.VizState || (window.opener && (window.opener.S || window.opener.VizState));

    if (Viz) {
      console.log("=== SAVING VISUALIZER POSITIONS ===");
      const posList = [];
      State.fixtures.forEach((fx, idx) => {
        const pos = Viz.fixturePositions.get(idx);
        if (pos) {
          posList.push({ fixtureIndex: idx, fixtureId: fx.id, x: pos.x, y: pos.y, z: pos.z });
          console.log(`💾 SAVE Fixture ${idx} (${fx.id}) | X:${pos.x.toFixed(2)} Y:${pos.y.toFixed(2)} Z:${pos.z.toFixed(2)}`);
        } else {
          console.log(`⚠️ No saved position for fixture ${idx}`);
        }
      });
      console.log(`✅ Total positions saved: ${posList.length}`);

      const rotList = [];
      State.fixtures.forEach((fx, idx) => {
        const rot = Viz.fixtureManualRot.get(idx);
        if (rot) {
          rotList.push({ fixtureIndex: idx, fixtureId: fx.id, pan: rot.pan, tilt: rot.tilt });
          console.log(`💾 SAVE ROT ${idx} | Pan:${rot.pan.toFixed(2)} Tilt:${rot.tilt.toFixed(2)}`);
        }
      });

      vizState.fixturePositions = posList;
      vizState.fixtureManualRot = rotList;
      vizState.gridOn = typeof gridOn !== 'undefined' ? gridOn : true;
      vizState.houseOn = typeof houseOn !== 'undefined' ? houseOn : false;
      vizState.workOn = typeof workOn !== 'undefined' ? workOn : false;
    } else {
      console.warn("❌ saveShow: Visualizer state NOT FOUND — open/load visualizer first!");
    }

    const activeEffectCopy = State.activeEffect ? { ...State.activeEffect } : null;
    const cuesWithEffects = State.cues.map(cue => {
      if (cue && cue.effect) return { ...cue, effect: { ...cue.effect } };
      return cue;
    });

    const multiOutputs = getMultiOutputShowState();

    const showData = {
      fixtures: State.fixtures || [],
      groups: State.groups || [],
      cues: cuesWithEffects,
      chases: State.chases || [],
      visualizer: vizState,
      activeEffect: activeEffectCopy,
      multiOutputs,
      savedAt: new Date().toISOString()
    };

    const json = JSON.stringify(showData, null, 2);
    console.log("✅ FINAL SAVED JSON:", JSON.stringify(vizState, null, 2));
    console.log(`💾 Saved ${multiOutputs.length} multi-universe outputs`);
    if (activeEffectCopy) console.log("💾 Saved active effect:", activeEffectCopy);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LightingShow_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log(`Show saved — ${Viz ? 'includes positions/aims' : 'no viz data'}${activeEffectCopy ? ' + effect' : ''} + ${multiOutputs.length} universe outputs`, 'ok');
  } catch (e) {
    console.error('Save failed:', e);
    log('Failed to save show', 'warn');
  }
}

function loadShow(jsonData) {
  try {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

    State.fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
    State.groups = Array.isArray(data.groups) ? data.groups : [];
    State.cues = Array.isArray(data.cues) ? data.cues.filter(Boolean) : [];
    State.chases = Array.isArray(data.chases) ? data.chases : [];
    State.currentCue = -1; State.currentChase = -1;

    const cueEffectCount = State.cues.filter(c => c && c.effect).length;
    if (cueEffectCount > 0) console.log(`✅ ${cueEffectCount} cues have saved effects`);

    if (data.activeEffect && data.activeEffect.type) {
      setTimeout(() => {
        startEffect(data.activeEffect.type, data.activeEffect);
        log(`✅ Restored effect: ${data.activeEffect.type}`, "ok");
      }, 300);
    }

    if (Array.isArray(data.multiOutputs)) {
      restoreMultiOutputShowState(data.multiOutputs);
      console.log(`✅ Restored ${data.multiOutputs.length} multi-universe outputs`);
    }

    const Viz = window.S || window.VizState || (window.opener && (window.opener.S || window.opener.VizState));
    if (data.visualizer && Viz) {
      const viz = data.visualizer;
      Viz.fixturePositions.clear();
      Viz.fixtureManualRot.clear();
      console.log("\n=== LOADING VISUALIZER POSITIONS ===");

      if (Array.isArray(viz.fixturePositions)) {
        viz.fixturePositions.forEach(saved => {
          Viz.fixturePositions.set(saved.fixtureIndex, new THREE.Vector3(saved.x, saved.y, saved.z));
          console.log(`✅ LOAD Fixture ${saved.fixtureIndex} → X:${saved.x.toFixed(2)} Y:${saved.y.toFixed(2)} Z:${saved.z.toFixed(2)}`);
        });
      }

      if (Array.isArray(viz.fixtureManualRot)) {
        viz.fixtureManualRot.forEach(saved => {
          Viz.fixtureManualRot.set(saved.fixtureIndex, { pan: saved.pan, tilt: saved.tilt });
          console.log(`✅ LOAD ROT ${saved.fixtureIndex} → Pan:${saved.pan.toFixed(2)} Tilt:${saved.tilt.toFixed(2)}`);
        });
      }

      if (typeof gridOn !== 'undefined') {
        gridOn = viz.gridOn ?? true;
        const el = document.getElementById("grid") || document.querySelector('[data-toggle="grid"]');
        if (el) { el.textContent = `GRID: ${gridOn ? "ON" : "OFF"}`; el.classList.toggle("on", gridOn); }
        if (Viz.grid) Viz.grid.visible = gridOn;
      }
      if (typeof houseOn !== 'undefined') {
        houseOn = viz.houseOn ?? false;
        const el = document.getElementById("house") || document.querySelector('[data-toggle="house"]');
        if (el) { el.textContent = `HOUSE LIGHTS: ${houseOn ? "ON" : "OFF"}`; el.classList.toggle("on", houseOn); }
        if (Viz.house) Viz.house.forEach(l => l.intensity = houseOn ? 35 : 0);
      }
      if (typeof workOn !== 'undefined') {
        workOn = viz.workOn ?? false;
        const el = document.getElementById("work") || document.querySelector('[data-toggle="work"]');
        if (el) { el.textContent = `WORK LIGHTS: ${workOn ? "ON" : "OFF"}`; el.classList.toggle("on", workOn); }
        if (Viz.work) Viz.work.forEach(l => l.intensity = workOn ? 7 : 0);
      }
    } else {
      console.warn("❌ loadShow: missing viz data OR visualizer not ready");
    }

    renderFixtures();
    renderGroups();
    renderCues();
    renderChases();
    if (typeof updateInspectorList === 'function') updateInspectorList();

    if (window.opener && typeof window.opener.rebuildFixtures === 'function') {
      setTimeout(() => {
        window.opener.rebuildFixtures();
        console.log("✅ rebuildFixtures() ran ON VISUALIZER");
      }, 100);
    } else if (typeof rebuildFixtures === 'function') {
      setTimeout(() => {
        rebuildFixtures();
        console.log("✅ local rebuildFixtures() ran");
        if (window.vizWindow && !window.vizWindow.closed && Viz) {
          const posArray = Array.from(Viz.fixturePositions.entries()).map(([i, p]) => ({ fixtureIndex: i, x: p.x, y: p.y, z: p.z }));
          const rotArray = Array.from(Viz.fixtureManualRot.entries()).map(([i, r]) => ({ fixtureIndex: i, pan: r.pan, tilt: r.tilt }));
          window.vizWindow.postMessage({ type: "LOAD_VIZ_POSITIONS", positions: posArray, rotations: rotArray }, "*");
          console.log(`Sent ${posArray.length} positions, ${rotArray.length} rotations → Visualizer`);
        }
      }, 100);
    }

    log(`✅ Show loaded — ${cueEffectCount} cues with effects restored${Array.isArray(data.multiOutputs) ? ` + ${data.multiOutputs.length} universe outputs` : ''}`, 'ok');
  } catch (e) {
    console.error('❌ Load failed:', e);
    log('Load failed: invalid file', 'warn');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // The Settings page currently has no static show-file controls, so create
  // them here without replacing or altering any existing Settings controls.
  const settingsPage = document.getElementById('page-settings');
  if (settingsPage && !document.getElementById('showFileControls')) {
    const panel = document.createElement('section');
    panel.id = 'showFileControls';
    panel.className = 'panel';
    panel.style.marginTop = '16px';
    panel.innerHTML = `
      <div class="panel-header"><div><span class="eyebrow">SHOW</span> Show File</div><span class="panel-meta">SAVE / LOAD</span></div>
      <div class="panel-body">
        <div class="action-row">
          <button class="btn-primary" id="btnSaveShow" type="button">💾 Save Show</button>
          <button class="btn-secondary" id="btnLoadShow" type="button">📂 Load Show</button>
        </div>
        <input id="showFileInput" type="file" accept=".json,application/json" style="display:none">
      </div>`;
    settingsPage.appendChild(panel);
  }

  const saveButton = document.getElementById('btnSaveShow');
  const loadButton = document.getElementById('btnLoadShow');
  const fileInput = document.getElementById('showFileInput');

  if (saveButton) {
    saveButton.type = 'button';
    saveButton.onclick = e => { e.preventDefault(); saveShow(); };
  }

  if (loadButton && fileInput) {
    loadButton.type = 'button';
    loadButton.onclick = e => { e.preventDefault(); fileInput.click(); };
    fileInput.onchange = async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        loadShow(await file.text());
      } finally {
        fileInput.value = '';
      }
    };
  }
});
