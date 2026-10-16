"use strict";

// Effect and chase commands for the command line, and the Delete Chase button.
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
    // Cues that run a chase point at it by position: keep them pointing at the same chases.
    for (const cue of window.State.cues || []) {
      if (!cue?.chase) continue;
      const index = Number(cue.chase.index);
      if (index === n - 1) cue.chase.index = -1;
      else if (index > n - 1) cue.chase.index = index - 1;
    }
    window.renderCues?.();

    window.renderChases?.();

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

  LXCommands.add(raw => {
    const c = String(raw || "").trim().toLowerCase();
    let m;
    if (c === "new effect") {
      document.getElementById("btnNewEffect")?.click();
      return log("New Effect menu opened", "ok");
    }
    if (c === "stop effect" || c === "stop effects" || c === "halt effect") return document.getElementById("btnStopEffect")?.click();
    if ((m = c.match(/^run\s+effect\s+(\d+)$/))) return runEffect(Number(m[1]));
    if ((m = c.match(/^effect\s+(\d+)$/))) {
      if (!selectEffectByNumber(Number(m[1]))) return log(`Effect ${m[1]} not found`, "warn");
      return log(`Selected Effect ${m[1]}`, "ok");
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
      if (!selectChaseByNumber(Number(m[1]))) return log(`Chase ${m[1]} not found`, "warn");
      return log(`Selected Chase ${m[1]}`, "ok");
    }
    return LXCommands.NOT_MINE;
  });
  [["new effect", ""], ["run effect", "[number]"], ["stop effect", ""], ["effect", "[number]"], ["delete effect", "[number]"], ["delete chase", "[number]"], ["chase", "[number]"]]
    .forEach(([cmd, hint]) => LXCommands.describe(cmd, hint));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addDeleteChaseButton, { once: true });
  else addDeleteChaseButton();
})();
