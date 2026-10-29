"use strict";

(function initialiseGroups() {
  if (!window.State || typeof window.State !== "object") window.State = {};
  if (!Array.isArray(State.groups)) State.groups = [];
  if (!window.Groups || typeof window.Groups !== "object") window.Groups = {};

  function getElement(id) {
    return typeof window.$ === "function" ? window.$(id) : document.getElementById(id);
  }

  function resolveMember(value) {
    const fixtures = Array.isArray(State.fixtures) ? State.fixtures : [];
    const wanted = String(value ?? "").trim();
    if (!wanted) return null;
    const byId = fixtures.find(fixture => fixture?.id != null && String(fixture.id) === wanted);
    if (byId?.id != null) return byId;
    // Group members are fixture numbers (as typed in "group 1 = 1,2"), which
    // stop matching list positions once fixtures are deleted or renumbered.
    const byNumber = fixtures.find(fixture => fixture?.fixtureNumber != null && String(fixture.fixtureNumber) === wanted);
    if (byNumber) return byNumber;
    const index = Number(value) - 1;
    return Number.isInteger(index) && index >= 0 ? fixtures[index] || null : null;
  }

  function nextFixtureNumber(excludeId = null) {
    const used = new Set(
      (Array.isArray(State.fixtures) ? State.fixtures : [])
        .filter(fixture => fixture?.id !== excludeId)
        .map(fixture => Number(fixture?.fixtureNumber))
        .filter(Number.isInteger)
    );
    let number = 1;
    while (used.has(number)) number += 1;
    return number;
  }

  function normaliseFixtureNumbers() {
    if (!Array.isArray(State.fixtures)) return;

    const used = new Set();
    State.fixtures.forEach(fixture => {
      const number = Number(fixture?.fixtureNumber);
      if (!fixture || !Number.isInteger(number) || number < 1 || used.has(number)) {
        if (fixture) {
          let next = 1;
          while (used.has(next)) next += 1;
          fixture.fixtureNumber = next;
          used.add(next);
        }
        return;
      }
      used.add(number);
      fixture.fixtureNumber = number;
    });

    State.fixtures.sort((a, b) => {
      const an = Number(a?.fixtureNumber);
      const bn = Number(b?.fixtureNumber);
      return (Number.isInteger(an) ? an : Number.MAX_SAFE_INTEGER) -
        (Number.isInteger(bn) ? bn : Number.MAX_SAFE_INTEGER);
    });
  }

  function installFixtureNumberField() {
    if (getElement("patchFixtureNumber")) return;
    const name = getElement("patchName");
    const grid = name?.closest(".form-grid");
    if (!grid) return;

    const row = document.createElement("div");
    row.className = "form-row";
    row.innerHTML = '<label>Fixture Number</label><input type="number" id="patchFixtureNumber" value="1" min="1" step="1">';

    const address = getElement("patchAddr")?.closest(".form-row");
    if (address?.nextElementSibling) grid.insertBefore(row, address.nextElementSibling);
    else grid.appendChild(row);

    const input = getElement("patchFixtureNumber");
    input.value = String(nextFixtureNumber());
  }

  function installPatchNumberCapture() {
    const button = getElement("btnPatch");
    if (!button || button.dataset.fixtureNumberCapture === "1") return;
    button.dataset.fixtureNumberCapture = "1";

    button.addEventListener("click", () => {
      const requested = Number(getElement("patchFixtureNumber")?.value);
      const before = new Set((Array.isArray(State.fixtures) ? State.fixtures : []).map(f => f?.id));

      window.setTimeout(() => {
        const fixtures = Array.isArray(State.fixtures) ? State.fixtures : [];
        const added = fixtures.find(fixture => fixture?.id != null && !before.has(fixture.id));
        if (!added) return;

        let number = Number.isInteger(requested) && requested > 0 ? requested : nextFixtureNumber();
        const conflict = fixtures.some(fixture => fixture !== added && Number(fixture?.fixtureNumber) === number);
        if (conflict) number = nextFixtureNumber(added.id);

        added.fixtureNumber = number;
        normaliseFixtureNumbers();

        if (typeof window.renderFixtures === "function") window.renderFixtures();
        if (typeof window.log === "function") window.log(`Fixture ${number} patched: ${added.name || "Unnamed"}`, "ok");

        const input = getElement("patchFixtureNumber");
        if (input) input.value = String(nextFixtureNumber());
      }, 0);
    });
  }

  function patchFixtureListOrdering() {
    if (window.__fixtureNumberRenderPatched) return;
    if (typeof window.renderFixtures !== "function") return;

    const originalRenderFixtures = window.renderFixtures;
    window.renderFixtures = function renderFixturesWithNumbers(...args) {
      normaliseFixtureNumbers();
      return originalRenderFixtures.apply(this, args);
    };
    window.__fixtureNumberRenderPatched = true;
    normaliseFixtureNumbers();
  }

  // Select a group's lights from the Groups list.
  function selectGroupLights(group) {
    if (!group) return;
    const members = Array.isArray(group.members) ? group.members : [];
    const name = String(group.name || "Group");
    if (!(State.selected instanceof Set)) State.selected = new Set();
    State.selected.clear();
    let found = 0;
    members.forEach(value => {
      const fixture = resolveMember(value);
      if (!fixture?.id) return;
      State.selected.add(fixture.id);
      found += 1;
    });
    const intensity = Number(State.current?.intensity ?? 100);
    const intensityInput = getElement("intensity");
    const intensityValue = getElement("intVal");
    if (intensityInput) intensityInput.value = intensity;
    if (intensityValue) intensityValue.textContent = `${intensity}%`;
    // Selecting a group only changes which fixtures are selected, not
    // any fixture's own data — the full renderFixtures() rebuild (every
    // item torn down and recreated, photometrics/output recalculated
    // for the whole patch) isn't needed here and was expensive enough
    // with a large patch to visibly flash the fixture list.
    if (typeof window.syncFixtureListSelectionClasses === "function") window.syncFixtureListSelectionClasses();
    else if (typeof window.renderFixtures === "function") window.renderFixtures();
    if (typeof window.updateControlVisibility === "function") window.updateControlVisibility();
    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.log === "function") window.log(`✅ Selected ${name}: ${found}/${members.length} — DMX active`);
  }

  window.renderGroups = function renderGroups() {
    const list = getElement("groupList");
    if (!list) return;
    list.replaceChildren();
    State.groups.forEach((group, groupIndex) => {
      if (!group || typeof group !== "object") return;
      const members = Array.isArray(group.members) ? group.members : [];
      const name = String(group.name || `Group ${groupIndex + 1}`);
      const el = document.createElement("div");
      el.className = "group-item";
      // The whole name (it wraps), and how many lights.
      const nameEl = document.createElement("span");
      nameEl.className = "g-name";
      nameEl.textContent = name;
      const count = document.createElement("span");
      count.className = "g-count";
      count.textContent = String(members.length);
      el.append(nameEl, count);
      el.title = `${name} — ${members.length} light${members.length === 1 ? "" : "s"}`;
      el.addEventListener("click", () => selectGroupLights(group));
      list.appendChild(el);
    });
  };

  function installFixtureNumberSupport() {
    installFixtureNumberField();
    installPatchNumberCapture();
    patchFixtureListOrdering();
    normaliseFixtureNumbers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      window.setTimeout(installFixtureNumberSupport, 0);
    }, { once: true });
  } else {
    window.setTimeout(installFixtureNumberSupport, 0);
  }

  window.addEventListener("load", installFixtureNumberSupport, { once: true });
})();
