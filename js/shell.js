"use strict";

// The console's frame: the status lights at the top (QLab, MIDI), the page title,
// the master read-out, and the Unpatch window.

window.updateQLabStatus = (message, connected) => {
  const status = document.getElementById("qlabStatus");
  if (status) {
    status.className = `qlab-status ${connected ? "connected" : "disconnected"}`;
    status.textContent = `${connected ? "✅" : "❌"} ${message}`;
  }
  setStatusLight("topQlabStatus", connected);
};

window.updateTopMidiStatus = connected => setStatusLight("topMidiStatus", connected);

function setStatusLight(id, online) {
  const pill = document.getElementById(id);
  if (!pill) return;
  pill.classList.toggle("is-online", Boolean(online));
  const dot = pill.querySelector(".status-dot");
  if (dot) dot.className = `status-dot ${online ? "online" : "offline"}`;
}

document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);

  // MIDI: js/midi.js writes its state as text; the top light follows it.
  const midi = $("midiStatus");
  if (midi) {
    const read = () => {
      const text = (midi.textContent || "").toLowerCase();
      window.updateTopMidiStatus(/connected|active|ready/.test(text) && !/not connected|disconnected/.test(text));
    };
    new MutationObserver(read).observe(midi, { childList: true, subtree: true, characterData: true });
    read();
  }

  // Output: the top light shows whether DMX is actually going out.
  window.LXOutput?.onStatus(status => setStatusLight("topOutputStatus", status.live && status.outputs.some(o => o.enabled && o.connected)));
  window.LXOutput?.status().then(status => setStatusLight("topOutputStatus", status.live && status.outputs.some(o => o.enabled && o.connected)));

  // The page title follows the menu.
  const titles = { live: "LIVE CONTROL", patch: "PATCH", inspector: "CUE INSPECTOR", chases: "CHASES & SEQUENCES", effects: "EFFECTS", qlab: "QLAB CONTROL", settings: "SETTINGS" };
  const title = $("topPageTitle");
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      if (title) title.textContent = titles[link.dataset.page] || "LIGHT SPARK";
    });
  });

  // The master fader's value in the top bar.
  const master = $("master");
  const topMaster = $("topMasterVal");
  if (master && topMaster) {
    const show = () => { topMaster.textContent = master.value; };
    master.addEventListener("input", show);
    show();
  }

  const speed = $("chaseSpeed");
  const speedValue = $("chaseSpeedVal");
  if (speed && speedValue) {
    const show = () => { speedValue.textContent = speed.value; };
    speed.addEventListener("input", show);
    show();
  }

  // Unpatch: pick a fixture to remove from the show.
  const modal = $("unpatchModal");
  const list = $("unpatchFixtureList");
  const close = () => { modal.style.display = "none"; };
  $("btnUnpatchSingle")?.addEventListener("click", () => {
    if (!State.fixtures.length) return window.log?.("No fixtures patched yet", "warn");
    list.replaceChildren();
    State.fixtures.forEach((fixture, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "unpatch-fixture-item";
      item.textContent = `${fixture.fixtureNumber ?? index + 1}. ${fixture.name || `Fixture ${index + 1}`} — Universe ${fixture.uni ?? 1}, address ${fixture.addr ?? "–"}`;
      item.addEventListener("click", () => {
        State.fixtures.splice(State.fixtures.indexOf(fixture), 1);
        State.fixtureStates.delete(fixture.id);
        State.selected.delete(fixture.id);
        window.renderFixtures?.();
        window.renderGroups?.();
        window.updateDMX?.();
        window.log?.(`Unpatched: ${fixture.name || "fixture"}`, "ok");
        close();
      });
      list.appendChild(item);
    });
    modal.style.display = "block";
  });
  document.querySelector(".unpatch-close")?.addEventListener("click", close);
  modal?.addEventListener("click", event => { if (event.target === modal) close(); });
});
