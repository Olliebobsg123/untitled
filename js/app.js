"use strict";

document.addEventListener("DOMContentLoaded", () => {
  console.log("Lighting control initialising...");

  if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
  if (!Array.isArray(State.fixtures)) State.fixtures = [];
  if (!Array.isArray(State.cues)) State.cues = [];
  if (!Array.isArray(State.chases)) State.chases = [];
  if (typeof State.chaseFade !== "number") State.chaseFade = 800;
  if (typeof State.chaseWait !== "number") State.chaseWait = 500;

  const $ = id => document.getElementById(id);

  // The fixture number is the console channel/fader number. It is deliberately
  // separate from the DMX start address and can be chosen by the programmer.
  function ensureFixtureNumberField() {
    if ($("patchFixtureNumber")) return;
    const patchButton = $("btnPatch");
    const panel = patchButton?.closest(".panel");
    const grid = panel?.querySelector(".form-grid");
    if (!grid) return;

    const row = document.createElement("div");
    row.className = "form-row";
    row.innerHTML = '<label>Fixture Number</label><input type="number" id="patchFixtureNumber" min="1" step="1">';
    const addrRow = $("patchAddr")?.closest(".form-row");
    grid.insertBefore(row, addrRow || null);

    const nextFixtureNumber = () => {
      const used = new Set((State.fixtures || []).map(f => Number(f?.fixtureNumber)).filter(Number.isInteger));
      let n = 1;
      while (used.has(n)) n++;
      return n;
    };

    const input = $("patchFixtureNumber");
    if (input) input.value = String(nextFixtureNumber());
  }

  function button(id, fn) {
    const el = $(id);
    if (!el) return;

    el.type = "button";
    el.onclick = e => {
      e.preventDefault();
      try {
        fn(e);
      } catch (err) {
        console.error(`${id}:`, err);
        if (typeof log === "function") log(`${id}: ${err.message}`, "error");
      }
    };
  }

  function getFixture(id) {
    return State.fixtures.find(f => f?.id === id) || null;
  }

  function activeFixture() {
    if (State.selectedFixtureId != null) {
      const fixture = getFixture(State.selectedFixtureId);
      if (fixture) return fixture;
    }

    if (State.selected instanceof Set && State.selected.size) {
      const ids = [...State.selected];
      return getFixture(ids[ids.length - 1]);
    }

    return null;
  }

  function getSelectedFixtures() {
    const fixtures = [];

    if (State.selected instanceof Set && State.selected.size) {
      State.selected.forEach(id => {
        const fixture = getFixture(id);
        if (fixture) fixtures.push(fixture);
      });
    }

    if (!fixtures.length) {
      const fixture = activeFixture();
      if (fixture) fixtures.push(fixture);
    }

    return fixtures;
  }

  function getFixtureDefinition(fixture) {
    if (!fixture) return null;

    if (typeof window.getFixtureDefinition === "function") {
      return window.getFixtureDefinition(fixture) || null;
    }

    return window.FixtureLibrary?.[fixture.name] || null;
  }

  function getFixtureState(fixture) {
    if (!fixture) return null;

    if (typeof ensureFixtureState === "function") {
      return ensureFixtureState(fixture.id);
    }

    if (!State.fixtureStates.has(fixture.id)) {
      State.fixtureStates.set(fixture.id, {
        ...(State.current || {}),
        pan: 128,
        tilt: 128,
        zoom: 0,
        intensity: 100
      });
    }

    return State.fixtureStates.get(fixture.id);
  }

  function updateSelected(property, value) {
    value = Number(value);
    if (!Number.isFinite(value)) return;

    getSelectedFixtures().forEach(fixture => {
      const state = getFixtureState(fixture);
      if (!state) return;

      state[property] = value;
      State.fixtureStates.set(fixture.id, state);
    });

    State.current ||= {};
    State.current[property] = value;

    if (typeof updateDMX === "function") updateDMX();
    if (typeof sendToVisualizer === "function") sendToVisualizer();
  }

  function setFader(id, property, valueId) {
    const el = $(id);
    if (!el) return;

    const update = () => {
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;

      if (valueId) $(valueId)?.replaceChildren(String(value));
      updateSelected(property, value);
    };

    el.addEventListener("input", update);
    el.addEventListener("change", update);
  }

  [
    ["hue", "hue", "hueVal"],
    ["sat", "sat", "satVal"],
    ["light", "light", "lightVal"],
    ["intensity", "intensity", "intensityVal"],
    ["strobe", "strobe", "strobeVal"],
    ["gobo", "gobo", "goboVal"],
    ["prism", "prism", "prismVal"],
    ["focus", "focus", "focusVal"],
    ["zoom", "zoom", "zoomVal"],
    ["master", "master", "masterVal"]
  ].forEach(args => setFader(...args));

  function updateXYDot(pan, tilt) {
    const dot = $("xy");
    if (!dot) return;

    pan = Math.max(0, Math.min(255, Number(pan) || 0));
    tilt = Math.max(0, Math.min(255, Number(tilt) || 0));

    dot.style.left = `${(pan / 255) * 100}%`;
    dot.style.top = `${(1 - tilt / 255) * 100}%`;
  }

  function syncControlsFromSelection() {
    const fixture = activeFixture();
    const state = fixture ? getFixtureState(fixture) : State.current || {};
    if (!state) return;

    const values = {
      master: State.current?.master ?? 100,
      zoom: state.zoom,
      hue: state.hue,
      sat: state.sat,
      light: state.light,
      intensity: state.intensity,
      strobe: state.strobe,
      gobo: state.gobo,
      prism: state.prism,
      focus: state.focus
    };

    Object.entries(values).forEach(([id, value]) => {
      const el = $(id);
      if (!el) return;

      const n = Number(value);
      if (!Number.isFinite(n)) return;

      el.value = n;
      $(`${id}Val`)?.replaceChildren(String(n));
    });

    updateXYDot(state.pan ?? 128, state.tilt ?? 128);
    updateColourUI(state.hue ?? 0, state.sat ?? 100);
  }

  // updateColourUI/setFader are declared inside this DOMContentLoaded
  // closure, so nothing outside app.js (e.g. midi.js, running as a
  // separate plain script) could ever reach them — a MIDI-driven
  // colour/parameter change updated the real fixture state correctly,
  // but the colour wheel, its hue/sat sliders and the other faders
  // never got told to redraw, leaving them stale or (since the wheel
  // math depends on both hue AND sat together) visibly wrong until
  // the next real click-driven refresh.
  window.syncControlsFromSelection = syncControlsFromSelection;

  /* ==========================================================
     XY PAD
  ========================================================== */

  const xyPad = document.querySelector(".xy-pad");

  if (xyPad) {
    let dragging = false;
    let pointerId = null;

    xyPad.style.touchAction = "none";
    xyPad.style.userSelect = "none";

    function getPointerPosition(e) {
      const rect = xyPad.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      const touch = e.touches?.[0] || e.changedTouches?.[0];

      const clientX = Number(e.clientX ?? touch?.clientX);
      const clientY = Number(e.clientY ?? touch?.clientY);

      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return null;
      }

      return {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      };
    }

    function moveXY(e) {
      if (e.cancelable) e.preventDefault();

      const position = getPointerPosition(e);
      if (!position) return;

      const fixture = activeFixture();

      if (!fixture) {
        log?.("Select a fixture first", "warn");
        return;
      }

      const map = getFixtureDefinition(fixture)?.map || {};

      if (typeof map.pan !== "number" || typeof map.tilt !== "number") {
        log?.(`${fixture.name} does not have pan/tilt channels`, "warn");
        return;
      }

      const state = getFixtureState(fixture);
      if (!state) return;

      const pan = Math.round(position.x * 255);
      const tilt = Math.round((1 - position.y) * 255);

      state.pan = pan;
      state.tilt = tilt;

      State.fixtureStates.set(fixture.id, state);
      State.current ||= {};
      State.current.pan = pan;
      State.current.tilt = tilt;

      updateXYDot(pan, tilt);
      updateDMX?.();
      sendToVisualizer?.();
    }

    if (window.PointerEvent) {
      xyPad.addEventListener("pointerdown", e => {
        if (e.button !== undefined && e.button !== 0) return;

        e.preventDefault();
        dragging = true;
        pointerId = e.pointerId;

        try {
          xyPad.setPointerCapture(e.pointerId);
        } catch {}

        moveXY(e);
      });

      xyPad.addEventListener("pointermove", e => {
        if (!dragging || e.pointerId !== pointerId) return;
        moveXY(e);
      });

      const stop = e => {
        if (pointerId !== null && e.pointerId !== pointerId) return;

        dragging = false;

        try {
          xyPad.releasePointerCapture(e.pointerId);
        } catch {}

        pointerId = null;
      };

      xyPad.addEventListener("pointerup", stop);
      xyPad.addEventListener("pointercancel", stop);
      xyPad.addEventListener("lostpointercapture", () => {
        dragging = false;
        pointerId = null;
      });
    } else {
      xyPad.addEventListener("mousedown", e => {
        e.preventDefault();
        dragging = true;
        moveXY(e);
      });

      window.addEventListener("mousemove", e => {
        if (dragging) moveXY(e);
      });

      window.addEventListener("mouseup", () => {
        dragging = false;
      });
    }
  }

  function updateControlVisibility() {
    const pad = document.querySelector(".xy-pad");
    if (!pad) return;

    const fixture = activeFixture();

    if (!fixture) {
      pad.style.display = "none";
      return;
    }

    const map = getFixtureDefinition(fixture)?.map || {};

    pad.style.display =
      typeof map.pan === "number" || typeof map.tilt === "number"
        ? ""
        : "none";
  }

  /* ==========================================================
     PATCH
  ========================================================== */

  button("btnPatch", () => {
    ensureFixtureNumberField();
    const name = $("patchName")?.value;
    const uni = Number($("patchUni")?.value || 1);
    const addr = Number($("patchAddr")?.value || 1);
    const fixtureNumber = Number($("patchFixtureNumber")?.value || 0);

    if (!name || !FixtureLibrary?.[name]) {
      return log("Select a valid fixture first", "warn");
    }

    if (!Number.isInteger(uni) || uni < 0) {
      return log("Invalid universe", "warn");
    }

    if (!Number.isInteger(addr) || addr < 1 || addr > 512) {
      return log("Invalid DMX address", "warn");
    }

    if (!Number.isInteger(fixtureNumber) || fixtureNumber < 1) {
      return log("Invalid fixture number", "warn");
    }

    if (State.fixtures.some(f => Number(f?.fixtureNumber) === fixtureNumber)) {
      return log(`Fixture number ${fixtureNumber} is already patched`, "warn");
    }

    const definition = FixtureLibrary[name];
    const channels = Number(definition.channels || 1);
    const end = addr + channels - 1;

    if (end > 512) {
      return log("Fixture extends beyond DMX address 512", "warn");
    }

    const overlap = State.fixtures.some(fixture => {
      if (Number(fixture.uni) !== uni) return false;

      const existing = FixtureLibrary[fixture.name];
      if (!existing) return false;

      const start = Number(fixture.addr);
      const finish = start + Number(existing.channels || 1) - 1;

      return addr <= finish && end >= start;
    });

    if (
      overlap &&
      !confirm(`DMX ${addr}-${end} is already used. Overwrite?`)
    ) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    State.fixtures.push({ id, name, uni, addr, fixtureNumber });

    const initialState = {
      ...(State.current || {}),
      pan: Number(State.current?.pan ?? 128),
      tilt: Number(State.current?.tilt ?? 128),
      zoom: Number($("zoom")?.value ?? 0),
      intensity: Number($("intensity")?.value ?? 100)
    };

    State.fixtureStates.set(
      id,
      typeof createFixtureState === "function"
        ? createFixtureState(initialState)
        : initialState
    );

    State.selectedFixtureId = id;
    State.selected ||= new Set();
    State.selected.clear();
    State.selected.add(id);

    renderFixtures?.();
    updateControlVisibility();
    syncControlsFromSelection();
    updateDMX?.();
    sendToVisualizer?.();

    log(`Patched: #${fixtureNumber} ${name} → Uni ${uni} Addr ${addr}`, "ok");
    ensureFixtureNumberField();
  });

  /* ==========================================================
     COLOUR WHEEL
  ========================================================== */

  const wheel = $("colourWheel");
  const indicator = $("colourIndicator");
  const preview = $("colourPreview");

  function updateColourUI(hue, sat) {
    if ($("hue")) $("hue").value = hue;
    if ($("sat")) $("sat").value = sat;

    if (preview) {
      preview.style.background = `hsl(${hue},${sat}%,50%)`;
    }

    if (!wheel || !indicator) return;

    const size = wheel.width;
    const centre = size / 2;
    const radius = centre * (sat / 100);
    const angle = hue * Math.PI / 180;

    indicator.style.left =
      `${centre + Math.cos(angle) * radius - 8}px`;

    indicator.style.top =
      `${centre + Math.sin(angle) * radius - 8}px`;
  }

  if (wheel && indicator && preview) {
    const ctx = wheel.getContext("2d");
    const size = wheel.width;
    const centre = size / 2;

    function drawWheel() {
  const image = ctx.createImageData(size, size);

  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.hypot(dx, dy);

      if (distance > centre) continue;

      const hue =
        (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;

      const sat =
        Math.min(100, (distance / centre) * 100);

      const [r, g, b] = hslToRgb(hue, sat, 50);

      const i = (y * size + x) * 4;

      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

    function colourAt(e) {
      const rect = wheel.getBoundingClientRect();
      const touch = e.touches?.[0] || e.changedTouches?.[0];

      let x = (e.clientX ?? touch?.clientX) - rect.left;
      let y = (e.clientY ?? touch?.clientY) - rect.top;

      x = Math.max(0, Math.min(rect.width, x));
      y = Math.max(0, Math.min(rect.height, y));

      const px = x / rect.width * size;
      const py = y / rect.height * size;

      const dx = px - centre;
      const dy = py - centre;

      const hue =
        (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;

      const sat =
        Math.min(100, Math.hypot(dx, dy) / centre * 100);

      updateSelected("hue", Math.round(hue));
      updateSelected("sat", Math.round(sat));
      updateColourUI(hue, sat);

      // A selection mixing a true-RGB and a true-CMY fixture at once,
      // with this wheel the active control (js/controls.js's
      // colourMixMode === "rgb"): updateSelected above already drove
      // the RGB fixture via hue/sat, but does nothing for the CMY one
      // (js/dmx.js never derives cyan/magenta/yellow from hue). No-op
      // when there's no CMY-capable fixture in the selection, so this
      // is safe to call on every pick regardless.
      window.applyRGBWheelToCMYFixtures?.(hue, sat);
    }

    drawWheel();

    let dragging = false;

    wheel.addEventListener("mousedown", e => {
      dragging = true;
      colourAt(e);
    });

    window.addEventListener("mousemove", e => {
      if (dragging) colourAt(e);
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  /* ==========================================================
     NAVIGATION / COMMANDS
  ========================================================== */

  $("fixtureSearch")?.addEventListener(
    "input",
    e => renderLibrary?.(e.target.value)
  );

  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();

      document
        .querySelectorAll(".nav-link")
        .forEach(x => x.classList.remove("active"));

      document
        .querySelectorAll(".page")
        .forEach(x => x.classList.remove("active"));

      btn.classList.add("active");
      $(`page-${btn.dataset.page}`)?.classList.add("active");

      log?.(`View: ${btn.dataset.page}`);
    });
  });

  $("cmdInput")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;

    e.preventDefault();

    const command = e.target.value.trim();
    if (command) parseCommand?.(command);

    e.target.value = "";
  });

  document.querySelectorAll("[data-action]").forEach(btn => {
    btn.onclick = e => {
      e.preventDefault();
      parseCommand?.(btn.dataset.action);
    };
  });

  document.querySelectorAll("[data-hue]").forEach(btn => {
    btn.onclick = () => {
      updateSelected("hue", Number(btn.dataset.hue));
      updateSelected("sat", Number(btn.dataset.sat ?? 100));
    };
  });

  document.querySelectorAll("[data-v]").forEach(btn => {
    btn.onclick = () => {
      updateSelected("intensity", Number(btn.dataset.v));
    };
  });

  /* ==========================================================
     ARTNET
  ========================================================== */

  button("artnetStart", () => ArtNet?.start());
  button("artnetStop", () => ArtNet?.stop());

  $("artnetIp")?.addEventListener("change", e => {
    if (window.ArtNet) ArtNet.ip = e.target.value.trim();
  });

  $("artnetUni")?.addEventListener("change", e => {
    if (window.ArtNet) ArtNet.universe = Number(e.target.value) || 0;
  });

  /* ==========================================================
     CUES
  ========================================================== */

  button("btnCueGo", () => {
    if (typeof goNextCue === "function") {
      goNextCue();
    } else {
      parseCommand?.("go");
    }
  });

  button("btnCueBack", () => {
    if (typeof goPreviousCue === "function") {
      goPreviousCue();
    } else {
      parseCommand?.("back");
    }
  });

  button("btnRecordCue", () => {
    const number = State.cues.length + 1;
    const name = prompt("Cue name:", `Cue ${number}`);

    if (name === null) return;

    const fadeRaw = prompt("Fade time (ms):", "800");
    if (fadeRaw === null) return;

    const followRaw = prompt(
      "Follow time in seconds (0 = immediate):",
      "0"
    );

    if (followRaw === null) return;

    const fade = Math.max(0, Number(fadeRaw) || 0);
    const follow = Math.max(0, Number(followRaw) || 0);
    const followEnabled = followRaw.trim() !== "";

    if (typeof recordCue === "function") {
      recordCue(
        number,
        name,
        fade,
        follow,
        followEnabled
      );
    }
  });

  button("btnClearProgrammer", () => {
    if (typeof clearProgrammer === "function") clearProgrammer();
  });

  button("btnDelCue", () => {
    const number = prompt("Cue number to delete:");
    if (number && typeof deleteCue === "function") {
      deleteCue(number);
    }
  });

  /* ==========================================================
     CHASES
  ========================================================== */

  // Chase buttons and the speed slider are wired by js/chases.js.

  /* ==========================================================
     SAVE / LOAD
  ========================================================== */

  button("btnSaveShow", () => saveShow?.());

  button("btnLoadShow", () => {
    const input = document.createElement("input");

    input.type = "file";
    input.accept = ".json";

    input.onchange = e => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();

      reader.onload = event => {
        if (typeof loadShow === "function") {
          loadShow(event.target.result);
        }
      };

      reader.readAsText(file);
    };

    input.click();
  });

  /* ==========================================================
     GROUP
  ========================================================== */

  $("btnNewGroup")?.addEventListener("click", () => {
    const nums = Object.keys(Groups || {})
      .map(Number)
      .filter(Number.isFinite);

    const number = nums.length
      ? Math.max(...nums) + 1
      : 1;

    parseCommand?.(`group ${number} = 1 thru 10`);
    $("cmdInput")?.focus();
  });

  /* ==========================================================
     CUE INSPECTOR
  ========================================================== */

  window.updateInspectorList = function () {
    const select = $("inspectCueSelect");
    if (!select) return;

    select.replaceChildren();

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "— Pick a cue to inspect —";
    select.appendChild(empty);

    State.cues.forEach((cue, index) => {
      if (!cue) return;

      const option = document.createElement("option");

      option.value = index;
      option.textContent =
        `${index + 1}. ${cue.name || `Cue ${index + 1}`}`;

      select.appendChild(option);
    });
  };

  $("inspectCueSelect")?.addEventListener("change", e => {
    const index = Number(e.target.value);
    const cue = State.cues?.[index];
    const content = $("inspectorContent");

    if (!cue) {
      if (content) content.style.display = "none";
      return;
    }

    const state = cue.globalState || cue.state || {};

    if (content) content.style.display = "block";

    const values = {
      inspectCueName: cue.name || `Cue ${index + 1}`,
      inspectMaster: state.master ?? 100,
      inspectIntensity: state.intensity ?? 100,
      inspectHue: state.hue ?? 0,
      inspectSat: state.sat ?? 100,
      inspectPan: state.pan ?? 128,
      inspectTilt: state.tilt ?? 128,
      inspectStrobe: state.strobe ?? 0,
      inspectGobo: state.gobo ?? 0,
      inspectPrism: state.prism ?? 0,
      inspectFocus: state.focus ?? 0,
      inspectZoom: state.zoom ?? 0,
      inspectFollow: cue.follow ?? 0
    };

    Object.entries(values).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.value = value;
    });

    const followEnabled = $("inspectFollowEnabled");
    if (followEnabled) {
      followEnabled.checked = Boolean(cue.followEnabled);
    }
  });

  button("btnUpdateCue", () => {
    const index = Number($("inspectCueSelect")?.value);
    const cue = State.cues?.[index];

    if (!cue) {
      return log("No cue selected", "warn");
    }

    cue.globalState ||= {
      ...(cue.state || State.current || {})
    };

    cue.name =
      $("inspectCueName")?.value.trim() ||
      `Cue ${index + 1}`;

    const value = id => {
      const number = Number($(id)?.value);
      return Number.isFinite(number) ? number : 0;
    };

    Object.assign(cue.globalState, {
      master: value("inspectMaster"),
      intensity: value("inspectIntensity"),
      hue: value("inspectHue"),
      sat: value("inspectSat"),
      pan: value("inspectPan"),
      tilt: value("inspectTilt"),
      strobe: value("inspectStrobe"),
      gobo: value("inspectGobo"),
      prism: value("inspectPrism"),
      focus: value("inspectFocus"),
      zoom: value("inspectZoom")
    });

    cue.state = { ...cue.globalState };

    if ($("inspectFollow")) {
      cue.follow = Math.max(
        0,
        Number($("inspectFollow").value) || 0
      );
    }

    if ($("inspectFollowEnabled")) {
      cue.followEnabled =
        $("inspectFollowEnabled").checked;
    }

    renderCues?.();
    updateInspectorList();

    if ($("inspectCueSelect")) {
      $("inspectCueSelect").value = String(index);
    }

    log(
      `Updated Cue ${index + 1}: ${cue.name}`,
      "ok"
    );
  });

  button("btnApplyCue", () => {
    const index = Number($("inspectCueSelect")?.value);

    if (
      State.cues?.[index] &&
      typeof goToCue === "function"
    ) {
      goToCue(index, 800);
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Shift" && !e.repeat) {
      e.preventDefault();
      parseCommand("go");
    }
  });

  /* ==========================================================
     STARTUP
  ========================================================== */

  ensureFixtureNumberField();
  renderLibrary?.();
  renderFixtures?.();
  renderGroups?.();
  renderCues?.();
  renderChases?.();
  initFixtureStates?.();
  // Auto-opening the visualizer popup here meant a focus-stealing new
  // window opened at the exact moment the license bootstrap (main.js)
  // and license.js's own boot()/validate() were racing to complete,
  // which made a Pro license intermittently read as Free until that
  // popup was closed. The visualizer is one "viz"/"visualizer" command
  // away — open it when you actually want it.
  updateDMX?.();

  updateControlVisibility();
  updateInspectorList();
  syncControlsFromSelection();

  log?.(
    `System ready — patched fixtures: ${State.fixtures.length}`
  );
});