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
  try { localStorage.setItem("lighting-multi-outputs", JSON.stringify(outputs)); } catch (_) {}
  window.dispatchEvent(new CustomEvent("show-multi-output-restore", { detail: { outputs } }));
}

function saveShow() {
  try {
    const vizState = {};
    const Viz = window.S || window.VizState || (window.opener && (window.opener.S || window.opener.VizState));
    if (Viz) {
      const posList = [];
      State.fixtures.forEach((fx, idx) => {
        const pos = Viz.fixturePositions.get(idx);
        if (pos) posList.push({ fixtureIndex: idx, fixtureId: fx.id, x: pos.x, y: pos.y, z: pos.z });
      });
      const rotList = [];
      State.fixtures.forEach((fx, idx) => {
        const rot = Viz.fixtureManualRot.get(idx);
        if (rot) rotList.push({ fixtureIndex: idx, fixtureId: fx.id, pan: rot.pan, tilt: rot.tilt });
      });
      vizState.fixturePositions = posList;
      vizState.fixtureManualRot = rotList;
      vizState.gridOn = typeof gridOn !== 'undefined' ? gridOn : true;
      vizState.houseOn = typeof houseOn !== 'undefined' ? houseOn : false;
      vizState.workOn = typeof workOn !== 'undefined' ? workOn : false;
    }

    const activeEffectCopy = State.activeEffect ? { ...State.activeEffect } : null;
    const cuesWithEffects = State.cues.map(cue => cue && cue.effect ? { ...cue, effect: { ...cue.effect } } : cue);
    const multiOutputs = getMultiOutputShowState();
    const showData = {
      fixtures: State.fixtures || [], groups: State.groups || [], cues: cuesWithEffects,
      chases: State.chases || [], visualizer: vizState, activeEffect: activeEffectCopy,
      multiOutputs, savedAt: new Date().toISOString()
    };
    const json = JSON.stringify(showData, null, 2);
    console.log("[SHOW] save started", { fixtures: showData.fixtures.length, outputs: multiOutputs.length });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LightingShow_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log("[SHOW] save completed");
    if (typeof log === "function") log(`Show saved + ${multiOutputs.length} universe outputs`, "ok");
  } catch (e) {
    console.error("[SHOW] save failed", e);
    if (typeof log === "function") log("Failed to save show", "warn");
  }
}

function loadShow(jsonData) {
  try {
    const data = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
    if (!data || typeof data !== "object") throw new Error("Invalid show object");
    State.fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
    State.groups = Array.isArray(data.groups) ? data.groups : [];
    State.cues = Array.isArray(data.cues) ? data.cues.filter(Boolean) : [];
    State.chases = Array.isArray(data.chases) ? data.chases : [];
    State.currentCue = -1; State.currentChase = -1;

    if (data.activeEffect && data.activeEffect.type && typeof startEffect === "function") {
      setTimeout(() => startEffect(data.activeEffect.type, data.activeEffect), 300);
    }
    if (Array.isArray(data.multiOutputs)) {
      restoreMultiOutputShowState(data.multiOutputs);
      console.log("[SHOW] restored multi-output universes", data.multiOutputs);
    }

    const Viz = window.S || window.VizState || (window.opener && (window.opener.S || window.opener.VizState));
    if (data.visualizer && Viz) {
      const viz = data.visualizer;
      Viz.fixturePositions.clear();
      Viz.fixtureManualRot.clear();
      if (Array.isArray(viz.fixturePositions)) viz.fixturePositions.forEach(saved => Viz.fixturePositions.set(saved.fixtureIndex, new THREE.Vector3(saved.x, saved.y, saved.z)));
      if (Array.isArray(viz.fixtureManualRot)) viz.fixtureManualRot.forEach(saved => Viz.fixtureManualRot.set(saved.fixtureIndex, { pan: saved.pan, tilt: saved.tilt }));
    }

    if (typeof renderFixtures === "function") renderFixtures();
    if (typeof renderGroups === "function") renderGroups();
    if (typeof renderCues === "function") renderCues();
    if (typeof renderChases === "function") renderChases();
    if (typeof updateInspectorList === "function") updateInspectorList();
    if (typeof rebuildFixtures === "function") setTimeout(() => rebuildFixtures(), 100);
    console.log("[SHOW] load completed", { fixtures: State.fixtures.length, outputs: Array.isArray(data.multiOutputs) ? data.multiOutputs.length : 0 });
    if (typeof log === "function") log("Show loaded successfully", "ok");
  } catch (e) {
    console.error("[SHOW] load failed", e);
    if (typeof log === "function") log("Load failed: invalid file", "warn");
  }
}

function initShowFileControls() {
  const settingsPage = document.getElementById("page-settings");
  if (!settingsPage) {
    console.warn("[SHOW] Settings page not found yet");
    return false;
  }

  let panel = document.getElementById("showFileControls");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "showFileControls";
    panel.className = "panel";
    panel.style.marginTop = "16px";
    panel.innerHTML = `<div class="panel-header"><div><span class="eyebrow">SHOW</span> Show File</div><span class="panel-meta">SAVE / LOAD</span></div><div class="panel-body"><div class="action-row"><button class="btn-primary" id="btnSaveShow" type="button">💾 Save Show</button><button class="btn-secondary" id="btnLoadShow" type="button">📂 Load Show</button></div><input id="showFileInput" type="file" accept=".json,application/json" style="display:none"></div>`;
    settingsPage.appendChild(panel);
    console.log("[SHOW] Settings show controls created");
  }

  const saveButton = document.getElementById("btnSaveShow");
  const loadButton = document.getElementById("btnLoadShow");
  const fileInput = document.getElementById("showFileInput");

  if (!saveButton || !loadButton || !fileInput) {
    console.error("[SHOW] Controls missing", { saveButton: !!saveButton, loadButton: !!loadButton, fileInput: !!fileInput });
    return false;
  }

  if (saveButton.dataset.showWired !== "1") {
    saveButton.dataset.showWired = "1";
    saveButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      console.log("[SHOW] Save Show clicked");
      saveShow();
    });
    console.log("[SHOW] Save button wired");
  }

  if (loadButton.dataset.showWired !== "1") {
    loadButton.dataset.showWired = "1";
    loadButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      console.log("[SHOW] Load Show clicked - opening file picker");
      fileInput.click();
    });
    console.log("[SHOW] Load button wired");
  }

  if (fileInput.dataset.showWired !== "1") {
    fileInput.dataset.showWired = "1";
    fileInput.addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        console.warn("[SHOW] File picker closed without selection");
        return;
      }
      console.log("[SHOW] File selected", file.name, file.size);
      try {
        const text = await file.text();
        console.log("[SHOW] File read, loading JSON");
        loadShow(text);
      } catch (error) {
        console.error("[SHOW] Could not read selected file", error);
      } finally {
        fileInput.value = "";
      }
    });
    console.log("[SHOW] File input wired");
  }
  return true;
}

function startShowFileControlWatcher() {
  console.log("[SHOW] show.js loaded");
  if (initShowFileControls()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (initShowFileControls() || attempts >= 100) {
      clearInterval(timer);
      if (attempts >= 100) console.error("[SHOW] Could not initialise show controls after 10 seconds");
    }
  }, 100);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startShowFileControlWatcher, { once: true });
else startShowFileControlWatcher();

window.addEventListener("show-multi-output-restore", event => {
  console.log("[SHOW] Multi-output restore event", event.detail?.outputs?.length || 0);
});
