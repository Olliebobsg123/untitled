"use strict";

(function initialiseGroups() {
  if (!window.State || typeof window.State !== "object") window.State = {};
  if (!Array.isArray(State.groups)) State.groups = [];
  if (!window.Groups || typeof window.Groups !== "object") window.Groups = {};

  function getElement(id) {
    return typeof window.$ === "function"
      ? window.$(id)
      : document.getElementById(id);
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
      el.textContent = name;

      el.addEventListener("click", () => {
        if (!(State.selected instanceof Set)) State.selected = new Set();
        State.selected.clear();

        let found = 0;
        members.forEach(value => {
          const index = Number(value) - 1;
          if (!Number.isInteger(index) || index < 0) return;

          const fixture = State.fixtures?.[index];
          if (!fixture?.id) return;

          State.selected.add(fixture.id);
          found += 1;
        });

        const intensity = Number(State.current?.intensity ?? 100);
        const intensityInput = getElement("intensity");
        const intensityValue = getElement("intVal");
        if (intensityInput) intensityInput.value = intensity;
        if (intensityValue) intensityValue.textContent = `${intensity}%`;

        if (typeof window.renderFixtures === "function") window.renderFixtures();
        if (typeof window.updateControlVisibility === "function") window.updateControlVisibility();
        if (typeof window.updateDMX === "function") window.updateDMX();

        if (typeof window.log === "function") {
          window.log(`✅ Selected ${name}: ${found}/${members.length} — DMX active`);
        }
      });

      list.appendChild(el);
    });
  };
})();
