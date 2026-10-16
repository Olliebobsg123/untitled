"use strict";

// The console's own commands (selection, groups, levels, colours, cues, chases)
// and the command line's autocomplete. Other features add theirs through
// LXCommands (js/command-registry.js).

const FrozenColours = {
  elsa: { hue: 210, sat: 70 }, ice: { hue: 195, sat: 60 }, snow: { hue: 200, sat: 20 }, sky: { hue: 220, sat: 50 },
  aurora: { hue: 280, sat: 65 }, castle: { hue: 45, sat: 40 }, kristoff: { hue: 30, sat: 60 }, sven: { hue: 25, sat: 70 },
  olaf: { hue: 50, sat: 80 }, forest: { hue: 140, sat: 55 }, night: { hue: 260, sat: 45 }
};
const cueColours = {
  red: { hue: 0, sat: 100 }, green: { hue: 120, sat: 100 }, blue: { hue: 240, sat: 100 }, white: { hue: 0, sat: 0 },
  yellow: { hue: 60, sat: 100 }, cyan: { hue: 180, sat: 100 }, magenta: { hue: 300, sat: 100 }, orange: { hue: 30, sat: 100 },
  ...FrozenColours
};
const COLOUR_PATTERN = new RegExp(`\\b(${Object.keys(cueColours).join("|")})\\b`);

[
  ["artnet", ""], ["clear", ""], ["release", ""], ["blackout", ""], ["full", ""], ["all", "[25/50/75/half]"],
  ["group", "[number] = [fixtures] / [name] / at [value] / colour [name]"], ["delete group", "[name]"],
  ["record cue", "[number] [name]"], ["delete cue", "[number]"], ["update cue", "[number] / name [name] / fade [seconds] / follow [seconds|off]"],
  ["rename cue", "[number] [name]"], ["follow cue", "[number] [seconds/off]"], ["copy cue", "[from] to [to] [name]"], ["move cue", "[from] to [to]"],
  ["cue", "[number]"], ["fade", "[number] [seconds]"], ["go", "[number]"], ["next", ""], ["back", ""], ["previous", ""], ["prev", ""],
  ["at", "[0-100]"], ["colour", "[name]"], ["color", "[name]"], ["strobe", "[0-255/off]"], ["reset", ""], ["visualizer", ""], ["viz", ""],
  ["list groups", ""], ["list cues", ""], ["status", ""], ["run chase", "[number]"], ["stop chase", ""], ["halt chase", ""], ["new chase", ""]
].forEach(([cmd, hint]) => LXCommands.describe(cmd, hint));

// --- Selection ---

function updateControlsForSelection() {
  window.buildControls?.();
  window.updateColourWheel?.();
}

// "1 thru 10", "1-10", "1–10", "1, 3, 5" → fixture numbers.
function parseSelection(text) {
  if (!text) return [];
  const numbers = new Set();
  for (const token of String(text).trim().toLowerCase().replace(/–/g, "-").split(/\s*,\s*/).filter(Boolean)) {
    const range = token.match(/^\s*(\d+)\s*(?:thru|through|-)\s*(\d+)\s*$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let n = a; ; n += a <= b ? 1 : -1) {
        numbers.add(n);
        if (n === b) break;
      }
      continue;
    }
    for (const part of token.split(/\s+/)) {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0) numbers.add(n);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

// Fixture numbers are what the operator types; they aren't positions in the patch list.
function getFixtureByNumber(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return null;
  return State.fixtures.find(f => Number(f?.fixtureNumber) === n) || State.fixtures[n - 1] || null;
}

function selectFixtureNumbers(numbers) {
  const selected = new Set();
  for (const number of numbers) {
    const fixture = getFixtureByNumber(number);
    if (fixture) selected.add(fixture.id);
  }
  State.selected = selected;
  return selected.size;
}

function setIntensityUI(value) {
  const slider = document.getElementById("intensity");
  const label = document.getElementById("intVal") || document.getElementById("intensityVal");
  if (slider) slider.value = value;
  if (label) label.textContent = String(value);
}

function selectGroup(group) {
  State.selected.clear();
  let found = 0;
  for (const number of group.members || []) {
    const fixture = getFixtureByNumber(number);
    if (fixture) { State.selected.add(fixture.id); found++; }
  }
  window.renderFixtures?.();
  updateControlsForSelection();
  updateDMX();
  return found;
}

function applyColour(colour) {
  Object.assign(State.current, colour);
  fadeTo(colour, 300);
  window.renderFixtures?.();
  updateControlsForSelection();
}

function applyLevel(value) {
  Object.assign(State.current, { intensity: value });
  fadeTo({ intensity: value }, 300);
  setIntensityUI(value);
  window.renderFixtures?.();
  updateControlsForSelection();
}

const findGroup = name => State.groups.find(group => String(group.name).toLowerCase() === String(name).trim().toLowerCase());
const numberedGroup = number => State.groups.find(group => group.name === `Group ${number}`);
const NUMBER_LIST = "((?:\\d+\\s*(?:thru|–|-)\\s*\\d+|\\d+(?:\\s*,\\s*\\d+)*|\\d+))";

// --- The commands nobody else claimed ---

LXCommands.setFallback(raw => {
  const text = String(raw ?? "").trim();
  if (!text) return log("Empty command", "warn");
  const c = text.toLowerCase();
  let m;

  if (c === "new chase") {
    const button = document.getElementById("btnSaveChase");
    if (!button) return log("New Chase button not found", "warn");
    button.click();
    return log("New Chase menu opened", "ok");
  }
  if (/^(visualizer|visualiser|viz)$/.test(c)) {
    connectVisualizer();
    return log("Visualiser opened", "ok");
  }
  if (c === "artnet") {
    document.querySelector('.nav-link[data-page="settings"]')?.click();
    return log("Opened output settings", "ok");
  }
  if (/^(clear|release)$/.test(c)) {
    State.selected.clear();
    window.renderFixtures?.();
    return log("Cleared selection", "ok");
  }
  if (c === "blackout") {
    Object.assign(State.current, { intensity: 0, strobe: 0 });
    fadeTo({ intensity: 0, strobe: 0 }, 500);
    setIntensityUI(0);
    return log("Blackout — all lights off", "ok");
  }
  if (/^(full|all)$/.test(c)) {
    Object.assign(State.current, { intensity: 100, strobe: 0 });
    fadeTo({ intensity: 100, strobe: 0 }, 500);
    setIntensityUI(100);
    return log("Full On — all lights 100%", "ok");
  }
  if ((m = c.match(/^all (half|25|50|75)$/))) {
    const level = m[1] === "half" ? 50 : Number(m[1]);
    applyLevel(level);
    return log(`All @ ${level}%`, "ok");
  }
  if (c === "reset") {
    State.current = { ...State.current, intensity: 100, hue: 0, sat: 0, strobe: 0, master: 100, pan: 128, tilt: 128 };
    updateDMX();
    return log("Reset to default", "ok");
  }
  if (c === "status") return log(`Selected: ${State.selected.size} | Groups: ${State.groups.length} | Cues: ${State.cues.length}`, "ok");
  if (c === "list groups") return log(State.groups.map(g => g.name).join(", ") || "No groups saved", "ok");
  if (c === "list cues") {
    return log(State.cues.map((cue, i) => (cue ? `${i + 1}: ${cue.name || "Cue"} (${cue.fade ?? 800}ms${cue.followEnabled ? ` · Follow ${cue.follow ?? 0}s` : ""})` : `${i + 1}: [empty]`)).join(", ") || "No cues saved", "ok");
  }

  // Groups
  const named = findGroup(c);
  if (named) return log(`Selected "${named.name}": ${selectGroup(named)}/${named.members.length}`, "ok");
  if ((m = c.match(/^group\s+(\d+)\s*=\s*(.+)$/))) {
    const members = parseSelection(m[2]);
    if (!members.length) return log("No valid fixture numbers", "warn");
    const existing = numberedGroup(m[1]);
    if (existing) existing.members = members;
    else State.groups.push({ name: `Group ${m[1]}`, members });
    window.renderGroups?.();
    return log(`Group ${m[1]} saved: ${members.join(", ")}`, "ok");
  }
  if ((m = c.match(/^group\s+(\d+)\s+name\s+(.+)$/))) {
    const group = numberedGroup(m[1]);
    const name = text.slice(text.toLowerCase().indexOf(" name ") + 6).trim();
    if (!group) return log(`Group ${m[1]} not found — create it first`, "warn");
    if (!name) return log("Name cannot be empty", "warn");
    group.name = name;
    window.renderGroups?.();
    return log(`Group ${m[1]} renamed → "${name}"`, "ok");
  }
  if ((m = c.match(/^delete\s+group\s+(.+)$/))) {
    const name = m[1].trim();
    const index = State.groups.findIndex(g => String(g.name).toLowerCase() === name || g.name === `Group ${name}`);
    if (index < 0) return log(`Group "${name}" not found`, "warn");
    State.groups.splice(index, 1);
    window.renderGroups?.();
    return log(`Deleted group: ${name}`, "ok");
  }
  if ((m = c.match(/^group\s+(\d+)$/))) {
    const group = numberedGroup(m[1]);
    if (!group) return log(`Group ${m[1]} not defined`, "warn");
    const found = selectGroup(group);
    if (!found) return log("No fixtures found — check patch numbers", "warn");
    setIntensityUI(State.current.intensity ?? 100);
    return log(`Selected Group ${m[1]}: ${found}/${group.members.length}`, "ok");
  }
  if ((m = c.match(/^group\s+(\d+)\s+at\s+(\d+\.?\d*)$/))) {
    const group = numberedGroup(m[1]);
    if (!group) return log("Group not found", "warn");
    selectGroup(group);
    const level = Math.max(0, Math.min(100, Number(m[2])));
    applyLevel(level);
    return log(`Group ${m[1]} @ ${level}%`, "ok");
  }
  if ((m = c.match(/^group\s+(\d+)\s+colou?r\s+(\w+)$/))) {
    const group = numberedGroup(m[1]);
    const colour = cueColours[m[2]];
    if (!group) return log("Group not found", "warn");
    if (!colour) return log(`Unknown colour: ${m[2]}`, "warn");
    selectGroup(group);
    applyColour(colour);
    return log(`Group ${m[1]} → ${m[2]}`, "ok");
  }
  if ((m = c.match(/^(.*?)\s+at\s+(\d+\.?\d*)$/)) && findGroup(m[1])) {
    const group = findGroup(m[1]);
    const level = Math.max(0, Math.min(100, Number(m[2])));
    selectGroup(group);
    applyLevel(level);
    return log(`"${group.name}" @ ${level}%`, "ok");
  }
  if ((m = c.match(/^(.*?)\s+colou?r\s+(\w+)$/)) && findGroup(m[1])) {
    const group = findGroup(m[1]);
    const colour = cueColours[m[2]];
    if (!colour) return log(`Unknown colour: ${m[2]}`, "warn");
    selectGroup(group);
    applyColour(colour);
    return log(`"${group.name}" → ${m[2]}`, "ok");
  }

  // Chases
  if ((m = c.match(/^run\s+chase\s+(\d+)$/))) {
    const index = Number(m[1]) - 1;
    if (!State.chases?.[index]) return log(`Chase ${m[1]} not found`, "warn");
    return startChase(index);
  }
  if (/^(stop|halt)\s+chase(?:\s+\d+)?$/.test(c)) {
    stopChase();
    return log("Chase stopped", "ok");
  }

  // Cues
  if ((m = text.match(new RegExp(`^record\\s+cue\\s+${NUMBER_LIST}(?:\\s+(.+))?$`, "i")))) {
    const numbers = parseSelection(m[1]);
    const name = m[2]?.trim() || "Cue";
    numbers.forEach(n => recordCue(n, numbers.length > 1 ? `${name} ${n}` : name));
    return log(`Recorded: ${numbers.join(", ")}`, "ok");
  }
  if ((m = c.match(new RegExp(`^delete\\s+cue\\s+${NUMBER_LIST}$`)))) {
    const numbers = parseSelection(m[1]);
    numbers.forEach(n => deleteCue(n));
    return log(`Deleted cues: ${numbers.join(", ")}`, "ok");
  }
  if ((m = c.match(/^fade\s+(\d+)\s+(\d*\.?\d+)$/))) {
    const cue = State.cues[Number(m[1]) - 1];
    const seconds = parseFloat(m[2]);
    if (seconds < 0) return log("Fade time cannot be negative", "warn");
    if (!cue) return log(`Cue ${m[1]} not found`, "warn");
    cue.fade = Math.round(seconds * 1000);
    renderCues();
    return log(`Cue ${m[1]} fade set to ${seconds}s = ${cue.fade}ms`, "ok");
  }
  if ((m = c.match(/^(?:fade|go)\s+(\d+)$/))) {
    const index = Number(m[1]) - 1;
    if (!State.cues[index]) return log(`Cue ${m[1]} not found`, "warn");
    goToCue(index);
    return log(`Fading to Cue ${m[1]} (${State.cues[index].fade ?? 800}ms)`, "ok");
  }
  if (/^(go|next)$/.test(c)) return goNextCue();
  if (/^(back|previous|prev)$/.test(c)) return goPreviousCue();

  // Fixture numbers, then levels/colours/strobe for the selection
  if ((m = c.match(new RegExp(`^${NUMBER_LIST}$`)))) {
    const count = selectFixtureNumbers(parseSelection(m[1]));
    if (count) {
      window.renderFixtures?.();
      return log(`Selected ${count} fixture(s)`, "ok");
    }
  }
  if ((m = c.match(/at\s+(\d+\.?\d*)/)) && State.selected.size) {
    const level = Math.max(0, Math.min(100, parseFloat(m[1])));
    applyLevel(level);
    return log(`@ ${level}%`, "ok");
  }
  if ((m = c.match(COLOUR_PATTERN)) && State.selected.size) {
    applyColour(cueColours[m[1]]);
    return log(`Colour: ${m[1]}`, "ok");
  }
  if ((m = c.match(/strobe\s+(\d+|off)/)) && State.selected.size) {
    const value = m[1] === "off" ? 0 : Math.max(0, Math.min(255, Number(m[1])));
    State.current.strobe = value;
    updateDMX();
    return log(value === 0 ? "Strobe off" : `Strobe ${value}`, "ok");
  }
  return log(`Unknown command: ${text} — type "status" to see what's loaded`, "warn");
});

// --- Editing cues from the command line ---

(() => {
  const cueAt = n => State.cues[Number(n) - 1];
  const cueExists = n => Number.isInteger(Number(n)) && Number(n) >= 1 && Boolean(cueAt(n));
  const refresh = () => {
    renderCues();
    window.updateInspectorList?.();
  };
  const clone = value => {
    try { return structuredClone(value); } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  };

  LXCommands.add(raw => {
    const text = String(raw ?? "").trim();
    const c = text.toLowerCase();
    let m;
    if ((m = c.match(/^update\s+cue\s+(\d+)$/))) {
      if (!cueExists(m[1])) return log(`Cue ${m[1]} not found`, "warn");
      return updateCue(Number(m[1])) ? log(`Updated Cue ${m[1]} from current programmer state`, "ok") : undefined;
    }
    if ((m = c.match(/^(?:update\s+cue\s+(\d+)\s+name|rename\s+cue\s+(\d+))\s+(.+)$/))) {
      const n = m[1] || m[2];
      const name = text.slice(-m[3].length).trim();
      if (!cueExists(n)) return log(`Cue ${n} not found`, "warn");
      if (!name) return log("Cue name cannot be empty", "warn");
      cueAt(n).name = name;
      refresh();
      return log(`Cue ${n} renamed → "${name}"`, "ok");
    }
    if ((m = c.match(/^update\s+cue\s+(\d+)\s+fade\s+(\d*\.?\d+)$/))) {
      // Only the fade time changes: the cue's look stays as recorded.
      const seconds = Number(m[2]);
      if (!cueExists(m[1])) return log(`Cue ${m[1]} not found`, "warn");
      cueAt(m[1]).fade = Math.round(seconds * 1000);
      refresh();
      return log(`Cue ${m[1]} fade updated to ${seconds}s`, "ok");
    }
    if ((m = c.match(/^(?:update\s+cue\s+(\d+)\s+follow|follow\s+cue\s+(\d+))\s+(off|\d*\.?\d+)$/))) {
      const n = m[1] || m[2];
      if (!cueExists(n)) return log(`Cue ${n} not found`, "warn");
      const cue = cueAt(n);
      if (m[3] === "off") {
        cue.follow = 0;
        cue.followEnabled = false;
        refresh();
        return log(`Cue ${n} follow disabled`, "ok");
      }
      cue.follow = Number(m[3]);
      cue.followEnabled = true;
      refresh();
      return log(`Cue ${n} follow set to ${cue.follow}s`, "ok");
    }
    if ((m = c.match(/^copy\s+cue\s+(\d+)\s+to\s+(\d+)(?:\s+(.+))?$/))) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (!cueExists(from)) return log(`Cue ${from} not found`, "warn");
      if (to < 1) return log("Destination cue must be 1 or higher", "warn");
      const copy = clone(cueAt(from));
      copy.name = (m[3] ? text.slice(-m[3].length) : copy.name || `Cue ${to}`).trim() || `Cue ${to}`;
      while (State.cues.length < to) State.cues.push(null);
      State.cues[to - 1] = copy;
      refresh();
      return log(`Copied Cue ${from} → Cue ${to}`, "ok");
    }
    if ((m = c.match(/^move\s+cue\s+(\d+)\s+to\s+(\d+)$/))) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (!cueExists(from)) return log(`Cue ${from} not found`, "warn");
      if (to < 1) return log("Destination cue must be 1 or higher", "warn");
      while (State.cues.length < to) State.cues.push(null);
      State.cues[to - 1] = State.cues[from - 1];
      State.cues[from - 1] = null;
      if (State.currentCue === from - 1) State.currentCue = to - 1;
      refresh();
      return log(`Moved Cue ${from} → Cue ${to}`, "ok");
    }
    if ((m = c.match(/^cue\s+(\d+)(?:\s+go)?$/))) {
      if (!cueExists(m[1])) return log(`Cue ${m[1]} not found`, "warn");
      return goToCue(Number(m[1]) - 1);
    }
    return LXCommands.NOT_MINE;
  });
})();

// --- Autocomplete above the command line ---

function setupAutocomplete(input) {
  const commandLine = input?.closest(".cmd-line");
  if (!input || !commandLine || input.dataset.autocompleteReady === "1") return;
  input.dataset.autocompleteReady = "1";
  const list = document.createElement("div");
  list.id = "cmdAutocompleteList";
  commandLine.appendChild(list);
  let matches = [];
  let selected = 0;

  const suggestions = () => {
    const items = [
      ...LXCommands.descriptions().map(({ cmd, hint }) => ({ value: cmd, hint })),
      ...Object.keys(cueColours).map(name => ({ value: name, hint: "[COLOUR]" })),
      ...(State.groups || []).filter(g => g?.name).map(g => ({ value: g.name, hint: "[GROUP]" }))
    ];
    const seen = new Set();
    return items.filter(item => {
      const key = String(item.value).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // Only the command word(s) are completed, so "group 1 at" keeps its suggestions.
  const commandPart = () => input.value.trimStart().split(/\s+/).slice(0, 2).join(" ");

  function choose(item) {
    const typed = input.value.trimStart();
    const rest = typed.slice(commandPart().length).replace(/^\s*/, "");
    input.value = `${item.value}${rest ? ` ${rest}` : " "}`;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    render();
  }

  function render() {
    const typed = commandPart().toLowerCase();
    list.replaceChildren();
    matches = typed ? suggestions().filter(item => String(item.value).toLowerCase().startsWith(typed)) : [];
    if (!matches.length) {
      list.classList.remove("is-visible");
      return;
    }
    if (selected >= matches.length) selected = 0;
    matches.slice(0, 20).forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cmd-autocomplete-item${index === selected ? " is-active" : ""}`;
      const command = document.createElement("span");
      command.className = "cmd-autocomplete-command";
      command.textContent = String(item.value).toUpperCase();
      button.appendChild(command);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "cmd-autocomplete-hint";
        hint.textContent = String(item.hint).toUpperCase();
        button.appendChild(hint);
      }
      button.addEventListener("mousedown", event => {
        event.preventDefault();
        choose(item);
      });
      list.appendChild(button);
    });
    list.classList.add("is-visible");
  }

  input.addEventListener("input", () => { selected = 0; render(); });
  input.addEventListener("focus", render);
  input.addEventListener("keydown", event => {
    if (!matches.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if (event.key === "Tab") {
      event.preventDefault();
      choose(matches[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      matches = [];
      list.classList.remove("is-visible");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAutocomplete(document.getElementById("cmdInput"));
  log("SYSTEM ONLINE — COMMAND CONSOLE READY", "ok");
});
