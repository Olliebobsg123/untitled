"use strict";

// Extra command/button layer for effect + chase programming.
// Kept separate so the existing engines remain untouched.
(function installEffectChaseCommands() {
  function log(message, type = "info") {
    if (typeof window.log === "function") window.log(message, type);
    else console.log(`[FX/CHASE ${type}]`, message);
  }

  function effectCards() {
    return [...document.querySelectorAll("#effectsList .effect-card")];
  }

  function selectEffectByNumber(number) {
    const index = Number(number) - 1;
    const cards = effectCards();
    const card = cards[index];
    if (!card) return null;
    card.click();
    return card;
  }

  function chaseCards() {
    return [...document.querySelectorAll("#chaseList .cue-item")];
  }

  function selectChaseByNumber(number) {
    const index = Number(number) - 1;
    const cards = chaseCards();
    const card = cards[index];
    if (!card) return null;
    card.click();
    return card;
  }

  function deleteChase(number) {
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1 || !Array.isArray(window.State?.chases) || !window.State.chases[n - 1]) {
      log(`Chase ${number} not found`, "warn");
      return false;
    }

    const chase = window.State.chases[n - 1];
    if (Number(window.State.currentChase) === n - 1 && typeof window.stopChase === "function") {
      window.stopChase(false);
    }

    window.State.chases.splice(n - 1, 1);
    if (Number.isInteger(window.State.currentChase) && window.State.currentChase >= n) {
      window.State.currentChase -= 1;
    }

    window.renderChases?.();

    // The chase engine keeps its selected index private, so select the first
    // remaining card to keep the Run button's selection in sync.
    const first = chaseCards()[0];
    if (first) first.click();

    log(`Deleted Chase ${n}: ${chase.name || `Chase ${n}`}`, "ok");
    return true;
  }

  function addDeleteChaseButton() {
    const run = document.getElementById("btnRunChase");
    if (!run || document.getElementById("btnDeleteChase")) return;
    const stop = document.getElementById("btnStopChase");
    const button = document.createElement("button");
    button.id = "btnDeleteChase";
    button.type = "button";
    button.className = "btn-danger-soft";
    button.textContent = "Delete Chase";
    button.addEventListener("click", () => {
      const cards = chaseCards();
      const selected = cards.findIndex(card => card.classList.contains("active"));
      if (selected < 0) return log("Select a chase to delete", "warn");
      if (!confirm(`Delete Chase ${selected + 1}?`)) return;
      deleteChase(selected + 1);
    });
    (stop?.parentElement || run.parentElement)?.appendChild(button);
  }

  function runEffect(number) {
    const card = selectEffectByNumber(number);
    if (!card) {
      log(`Effect ${number} not found`, "warn");
      return false;
    }
    document.getElementById("btnRunEffect")?.click();
    return true;
  }

  function deleteEffect(number) {
    const n = Number(number);
    const cards = effectCards();
    const card = cards[n - 1];
    if (!card) {
      log(`Effect ${number} not found`, "warn");
      return false;
    }
    card.click();
    const name = document.getElementById("effectName")?.value.trim();
    if (!name || !window.State?.savedEffects?.[name]) {
      log(`Effect ${number} could not be selected`, "warn");
      return false;
    }
    document.getElementById("btnDeleteEffect")?.click();
    return true;
  }

  function installCommandWrapper() {
    if (window.__effectChaseCommandLayer) return;
    if (typeof window.parseCommand !== "function") return setTimeout(installCommandWrapper, 50);

    const original = window.parseCommand.bind(window);
    window.parseCommand = function effectChaseCommandWrapper(raw) {
      const c = String(raw || "").trim().toLowerCase();
      let m;

      if (c === "new effect") {
        document.getElementById("btnNewEffect")?.click();
        log("New Effect menu opened", "ok");
        return;
      }
      if (c === "stop effect" || c === "stop effects" || c === "halt effect") {
        document.getElementById("btnStopEffect")?.click();
        return;
      }
      if ((m = c.match(/^run\s+effect\s+(\d+)$/))) return runEffect(Number(m[1]));
      if ((m = c.match(/^effect\s+(\d+)$/))) {
        if (!selectEffectByNumber(Number(m[1]))) log(`Effect ${m[1]} not found`, "warn");
        else log(`Selected Effect ${m[1]}`, "ok");
        return;
      }
      if ((m = c.match(/^delete\s+effect\s+(\d+)$/))) return deleteEffect(Number(m[1]));
      if ((m = c.match(/^delete\s+effect\s+(.+)$/))) {
        const name = m[1].trim();
        const index = Object.values(window.State?.savedEffects || {}).findIndex(effect => String(effect?.name).toLowerCase() === name);
        if (index < 0) return log(`Effect "${name}" not found`, "warn");
        return deleteEffect(index + 1);
      }

      if ((m = c.match(/^delete\s+chase\s+(\d+)$/))) return deleteChase(Number(m[1]));
      if ((m = c.match(/^chase\s+(\d+)$/))) {
        if (!selectChaseByNumber(Number(m[1]))) log(`Chase ${m[1]} not found`, "warn");
        else log(`Selected Chase ${m[1]}`, "ok");
        return;
      }

      return original(raw);
    };

    window.__effectChaseCommandLayer = true;
  }

  // Home selected moving fixtures: centre both pan and tilt at DMX 128.
  // Other fixture attributes are deliberately left untouched.
  function getSelectedMovingFixtures() {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures)) return [];

    const ids = new Set();
    if (state.selected instanceof Set) state.selected.forEach(id => ids.add(String(id)));
    document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el => ids.add(String(el.dataset.fixtureId)));

    return state.fixtures.filter(fixture => {
      if (!ids.has(String(fixture?.id))) return false;
      const definition = typeof window.getFixtureDefinition === "function"
        ? window.getFixtureDefinition(fixture)
        : window.FixtureLibrary?.[fixture?.name];
      const map = definition?.map || {};
      return typeof map.pan === "number" || typeof map.tilt === "number";
    });
  }

  function homeSelectedFixtures() {
    const state = window.State;
    if (!state) return false;

    const fixtures = getSelectedMovingFixtures();
    if (!fixtures.length) {
      log("Select at least one moving fixture first", "warn");
      return false;
    }

    if (!(state.fixtureStates instanceof Map)) state.fixtureStates = new Map();

    let homed = 0;
    for (const fixture of fixtures) {
      let fixtureState = typeof window.ensureFixtureState === "function"
        ? window.ensureFixtureState(fixture.id)
        : state.fixtureStates.get(fixture.id);
      if (!fixtureState) {
        fixtureState = { ...(state.current || {}) };
      }

      const definition = typeof window.getFixtureDefinition === "function"
        ? window.getFixtureDefinition(fixture)
        : window.FixtureLibrary?.[fixture?.name];
      const map = definition?.map || {};

      if (typeof map.pan === "number") fixtureState.pan = 128;
      if (typeof map.tilt === "number") fixtureState.tilt = 128;
      state.fixtureStates.set(fixture.id, fixtureState);
      homed++;
    }

    state.current ||= {};
    state.current.pan = 128;
    state.current.tilt = 128;

    const dot = document.getElementById("xy");
    if (dot) {
      dot.style.left = "50%";
      dot.style.top = "50%";
    }

    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();

    log(`Homed ${homed} selected fixture${homed === 1 ? "" : "s"} to centre`, "ok");
    return true;
  }

  function addHomeButton() {
    if (document.getElementById("btnHomePanTilt")) return true;

    const pad = document.querySelector(".xy-pad");
    if (!pad) return false;

    const button = document.createElement("button");
    button.id = "btnHomePanTilt";
    button.type = "button";
    button.className = "btn-secondary";
    button.textContent = "⌂ HOME";
    button.title = "Centre Pan and Tilt on all selected moving fixtures";
    button.setAttribute("aria-label", "Home selected fixtures pan and tilt");
    button.addEventListener("click", homeSelectedFixtures);

    const wrapper = document.createElement("div");
    wrapper.className = "xy-home-control";
    wrapper.style.cssText = "display:flex;justify-content:center;margin-top:10px;";
    wrapper.appendChild(button);
    pad.insertAdjacentElement("afterend", wrapper);
    return true;
  }

  function init() {
    addDeleteChaseButton();
    addHomeButton();
    installCommandWrapper();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  window.addEventListener("load", init);
  setTimeout(init, 250);
  setTimeout(init, 1000);
  setTimeout(init, 2000);
})();
