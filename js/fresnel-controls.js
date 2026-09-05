"use strict";

/*
 * Fixture capability UI.
 *
 * This intentionally lives alongside controls.js rather than replacing it.
 * controls.js owns the common controls; this layer makes capability detection
 * reliable and keeps Fresnel-specific controls in their own host so a later
 * generic refresh cannot wipe them out.
 */
(function initialiseFixtureCapabilityControls() {
  const $ = id => document.getElementById(id);

  const getFixtures = () => {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures)) return [];

    const ids = new Set();
    if (state.selected instanceof Set) {
      state.selected.forEach(id => ids.add(String(id)));
    }

    if (!ids.size && state.selectedFixtureId != null) {
      ids.add(String(state.selectedFixtureId));
    }

    // Some older selection rendering uses the .sel marker. Only use it when
    // State.selected has not supplied a selection, avoiding accidental UNION
    // with stale DOM classes.
    if (!ids.size) {
      document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el => {
        ids.add(String(el.dataset.fixtureId));
      });
    }

    return state.fixtures.filter(f => ids.has(String(f?.id)));
  };

  const getDefinition = fixture => {
    if (!fixture) return null;
    if (typeof window.getFixtureDefinition === "function") {
      return window.getFixtureDefinition(fixture) || null;
    }
    return window.FixtureLibrary?.[fixture.name] || null;
  };

  const getState = fixture => {
    if (!fixture) return null;
    if (typeof window.ensureFixtureState === "function") {
      return window.ensureFixtureState(fixture.id);
    }
    return null;
  };

  const hasMap = (fixture, names) => {
    const map = getDefinition(fixture)?.map || {};
    return names.some(name => typeof map[name] === "number");
  };

  const CAPABILITIES = {
    intensity: ["intensity", "dimmer", "dim"],
    strobe: ["strobe", "shutter"],
    zoom: ["zoom"],
    // IMPORTANT: fixture maps use r/g/b, not red/green/blue.
    colour: [
      "hue", "sat", "saturation",
      "r", "g", "b", "w", "white",
      "red", "green", "blue", "amber", "a", "lime", "l",
      "cyan", "c", "magenta", "uv", "colour", "color"
    ],
    xy: ["pan", "tilt"]
  };

  const DYNAMIC = [
    ["gobo", "Gobo", "GOBO"],
    ["gobo2", "Gobo 2", "GOBO 2"],
    ["gobor", "Gobo Rotation", "GOBO ROTATION"],
    ["gobo2r", "Gobo 2 Rotation", "GOBO 2 ROTATION"],
    ["prism", "Prism", "PRISM"],
    ["prismr", "Prism Rotation", "PRISM ROTATION"],
    ["focus", "Focus", "FOCUS"],
    ["zoom", "Zoom", "LENS"],
    ["frost", "Frost", "FROST"],
    ["iris", "Iris", "IRIS"],
    ["rot", "Rotation", "ROTATION"],
    ["effect", "Effect", "EFFECT"],
    ["speed", "Speed", "SPEED"],
    ["macro", "Macro", "MACRO"],
    ["preset", "Preset", "PRESET"],
    ["shake", "Shake", "SHAKE"],
    ["mode", "Mode", "MODE"],
    ["zone", "Zone", "ZONE"],
    ["fog", "Fog", "FOG"],
    ["fana", "Fan", "FAN"],
    ["haze", "Haze", "HAZE"],
    ["fluid", "Fluid", "FLUID"],
    ["colmacro", "Colour Macro", "COLOUR MACRO"]
  ];

  const clamp255 = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

  function injectStyles() {
    if ($("fixtureCapabilityStyles")) return;
    const style = document.createElement("style");
    style.id = "fixtureCapabilityStyles";
    style.textContent = `
      #fixtureDynamicControls,
      #fresnelControlsHost { display:grid; gap:10px; }
      #fixtureDynamicControls { margin-top:10px; }
      .fixture-dynamic-card,
      .fresnel-control {
        padding:11px 12px;
        border:1px solid var(--border,#223038);
        border-radius:10px;
        background:rgba(255,255,255,.018);
      }
      .fixture-dynamic-card .fader,
      .fresnel-control .fader { width:100%; }
      .fixture-capability-title,
      .fresnel-title {
        display:flex;
        align-items:baseline;
        justify-content:space-between;
        gap:10px;
        margin-bottom:7px;
      }
      .fixture-capability-title strong,
      .fresnel-title strong {
        letter-spacing:.08em;
        text-transform:uppercase;
        font-size:13px;
      }
      .fixture-capability-title small,
      .fresnel-title small,
      .fresnel-note {
        color:var(--text-muted);
        font-size:9px;
        letter-spacing:.12em;
        text-transform:uppercase;
      }
      .fresnel-controls {
        display:grid;
        gap:10px;
        padding-top:12px;
        border-top:1px solid var(--border,#223038);
      }
      .fresnel-note { line-height:1.4; letter-spacing:.02em; text-transform:none; }
    `;
    document.head?.appendChild(style);
  }

  function setGroupVisibility(id, visible) {
    const group = $(id);
    if (group) group.style.display = visible ? "" : "none";
  }

  function setInputGroupVisibility(id, visible) {
    const input = $(id);
    if (!input) return;
    const group = input.closest(".control-group");
    if (group) group.style.display = visible ? "" : "none";
  }

  function selectedCapability(name, fixtures) {
    const names = CAPABILITIES[name] || [name];
    return fixtures.some(fixture => hasMap(fixture, names));
  }

  function ensureHosts() {
    const panel = $("controlPanel");
    if (!panel) return null;

    let dynamic = $("fixtureDynamicControls");
    if (!dynamic) {
      dynamic = document.createElement("div");
      dynamic.id = "fixtureDynamicControls";
      dynamic.className = "dynamic-controls";
      const old = $("dynamicControls");
      if (old) old.insertAdjacentElement("afterend", dynamic);
      else panel.appendChild(dynamic);
    }

    let fresnel = $("fresnelControlsHost");
    if (!fresnel) {
      fresnel = document.createElement("div");
      fresnel.id = "fresnelControlsHost";
      fresnel.className = "fresnel-controls-host";
      dynamic.insertAdjacentElement("afterend", fresnel);
    }

    return { dynamic, fresnel };
  }

  function applyDynamic(key, value) {
    const number = clamp255(value);
    const fixtures = getFixtures();
    let changed = false;

    for (const fixture of fixtures) {
      const map = getDefinition(fixture)?.map || {};
      if (typeof map[key] !== "number") continue;
      const state = getState(fixture);
      if (!state) continue;
      state[key] = number;
      window.State.fixtureStates.set(fixture.id, state);
      changed = true;
    }

    if (!changed) return;
    window.State.current ||= {};
    window.State.current[key] = number;
    $("dynamic-" + key + "-val")?.replaceChildren(String(number));
    $("fixture-dynamic-" + key + "-val")?.replaceChildren(String(number));
    window.updateDMX?.();
    window.sendToVisualizer?.();
  }

  function renderDynamic(fixtures, host) {
    if (!host) return;
    host.replaceChildren();

    const supported = DYNAMIC.filter(([key]) =>
      fixtures.some(f => typeof getDefinition(f)?.map?.[key] === "number")
    );

    for (const [key, label, sub] of supported) {
      const card = document.createElement("div");
      card.className = "control-group parameter-card fixture-dynamic-card";

      const heading = document.createElement("div");
      heading.className = "control-heading";
      heading.innerHTML = `<div><span class="control-label">${label}</span><small>${sub}</small></div><strong class="fader-val"><span id="fixture-dynamic-${key}-val">0</span></strong>`;

      const fader = document.createElement("div");
      fader.className = "fader";
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "255";
      input.step = "1";
      input.value = "0";
      input.id = `fixture-dynamic-${key}`;
      input.addEventListener("input", () => applyDynamic(key, input.value));
      input.addEventListener("change", () => applyDynamic(key, input.value));
      fader.appendChild(input);

      card.append(heading, fader);
      host.appendChild(card);

      const representative = fixtures.find(f => typeof getDefinition(f)?.map?.[key] === "number");
      const state = representative ? getState(representative) : null;
      const value = state?.[key] ?? window.State?.current?.[key] ?? 0;
      input.value = clamp255(value);
      $("fixture-dynamic-" + key + "-val")?.replaceChildren(String(clamp255(value)));
    }
  }

  const cctToDmx = kelvin =>
    Math.round(((Math.max(2700, Math.min(4500, Number(kelvin) || 2700)) - 2700) / 1800) * 255);

  const dmxToCct = value =>
    Math.round(2700 + (clamp255(value) / 255) * 1800);

  function fresnelFixture(fixture) {
    const map = getDefinition(fixture)?.map || {};
    return typeof map.warmWhite === "number" ||
      typeof map.naturalWhite === "number" ||
      typeof map.coolWhite === "number";
  }

  function fresnelSlider(id, label, value, min = 0, max = 255, suffix = "") {
    return `<div class="fresnel-control"><div class="control-heading"><div><span class="control-label">${label}</span><small>${min === 0 && max === 255 ? "0–255 DMX" : `${min}–${max}`}</small></div><strong class="fader-val"><span id="${id}Val">${value}</span>${suffix}</strong></div><div class="fader"><input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}"></div></div>`;
  }

  function applyFresnel(property, value) {
    const number = clamp255(value);
    const fixtures = getFixtures();
    let changed = false;
    for (const fixture of fixtures) {
      if (!fresnelFixture(fixture)) continue;
      const map = getDefinition(fixture)?.map || {};
      if (typeof map[property] !== "number") continue;
      const state = getState(fixture);
      if (!state) continue;
      state[property] = number;
      window.State.fixtureStates.set(fixture.id, state);
      changed = true;
    }
    if (!changed) return;
    window.State.current ||= {};
    window.State.current[property] = number;
    $(`fresnel${property[0].toUpperCase()}${property.slice(1)}Val`)?.replaceChildren(String(number));
    window.updateDMX?.();
    window.sendToVisualizer?.();
  }

  function bindRange(id, fn) {
    const input = $(id);
    if (!input || input.dataset.capabilityBound === "1") return;
    input.dataset.capabilityBound = "1";
    input.addEventListener("input", () => fn(input.value));
    input.addEventListener("change", () => fn(input.value));
  }

  function renderFresnel(fixtures, host) {
    if (!host) return;
    host.replaceChildren();
    const fresnels = fixtures.filter(fresnelFixture);
    if (!fresnels.length) return;

    const representative = fresnels[fresnels.length - 1];
    const def = getDefinition(representative);
    const map = def?.map || {};
    const state = getState(representative) || {};
    const threeChannel = typeof map.warmWhite === "number" && typeof map.coolWhite === "number";
    const warm = clamp255(state.warmWhite ?? 255);
    const second = clamp255(threeChannel ? (state.coolWhite ?? 0) : (state.naturalWhite ?? 0));
    const cct = Math.max(2700, Math.min(4500, Number(state.cctKelvin ?? dmxToCct(state.cct ?? 0)) || 2700));

    const root = document.createElement("div");
    root.className = "fresnel-controls";
    root.id = "fresnelControls";
    root.dataset.selectionKey = fresnels.map(f => String(f.id)).join(",");
    root.innerHTML = `<div class="fresnel-title"><strong>Performer 1500 Fresnel</strong><small>${def?.channels || "?"}ch</small></div>`;

    if (typeof map.warmWhite === "number") root.insertAdjacentHTML("beforeend", fresnelSlider("fresnelWarmWhite", "Warm White", warm));
    if (threeChannel) root.insertAdjacentHTML("beforeend", fresnelSlider("fresnelCoolWhite", "Cool White", second));
    else if (typeof map.naturalWhite === "number") root.insertAdjacentHTML("beforeend", fresnelSlider("fresnelNaturalWhite", "Natural White", second));
    if (typeof map.cct === "number") root.insertAdjacentHTML("beforeend", `<div class="fresnel-control"><div class="control-heading"><div><span class="control-label">CCT</span><small>2700–4500 K</small></div><strong class="fader-val"><span id="fresnelCctVal">${Math.round(cct)}</span>K</strong></div><div class="fader"><input type="range" id="fresnelCct" min="2700" max="4500" step="50" value="${Math.round(cct)}" aria-label="CCT"></div></div>`);
    root.insertAdjacentHTML("beforeend", `<div class="fresnel-note">Fresnel controls affect only the selected Fresnel fixtures.</div>`);
    host.appendChild(root);

    bindRange("fresnelWarmWhite", value => applyFresnel("warmWhite", value));
    bindRange("fresnelNaturalWhite", value => applyFresnel("naturalWhite", value));
    bindRange("fresnelCoolWhite", value => applyFresnel("coolWhite", value));

    const cctInput = $("fresnelCct");
    if (cctInput) {
      cctInput.addEventListener("input", () => {
        const kelvin = Math.max(2700, Math.min(4500, Number(cctInput.value) || 2700));
        for (const fixture of getFixtures()) {
          if (!fresnelFixture(fixture)) continue;
          const state = getState(fixture);
          if (!state) continue;
          state.cct = cctToDmx(kelvin);
          state.cctKelvin = kelvin;
          window.State.fixtureStates.set(fixture.id, state);
        }
        window.State.current ||= {};
        window.State.current.cct = cctToDmx(kelvin);
        window.State.current.cctKelvin = kelvin;
        $("fresnelCctVal")?.replaceChildren(String(Math.round(kelvin)));
        window.updateDMX?.();
        window.sendToVisualizer?.();
      });
    }
  }

  function refresh() {
    const fixtures = getFixtures();
    const hosts = ensureHosts();
    if (!hosts) return;

    setInputGroupVisibility("intensity", fixtures.length ? selectedCapability("intensity", fixtures) : false);
    setGroupVisibility("strobeGroup", fixtures.length ? selectedCapability("strobe", fixtures) : false);
    setGroupVisibility("zoomGroup", fixtures.length ? selectedCapability("zoom", fixtures) : false);
    setGroupVisibility("colourGroup", fixtures.length ? selectedCapability("colour", fixtures) : false);
    setGroupVisibility("xyGroup", fixtures.length ? selectedCapability("xy", fixtures) : false);

    renderDynamic(fixtures, hosts.dynamic);

    const key = fixtures.filter(fresnelFixture).map(f => String(f.id)).join(",");
    if ((hosts.fresnel.firstElementChild?.dataset.selectionKey || "") !== key) {
      renderFresnel(fixtures, hosts.fresnel);
    }
  }

  function install() {
    injectStyles();
    refresh();

    const list = $("fixtureList");
    if (list && !list.dataset.capabilityObserver) {
      list.dataset.capabilityObserver = "1";
      new MutationObserver(refresh).observe(list, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "data-fixture-id"]
      });
    }

    // Selection state can change without a DOM mutation. This is deliberately
    // light-weight and only refreshes when the selection signature changes.
    let last = "";
    setInterval(() => {
      const signature = getFixtures().map(f => String(f.id)).join(",");
      if (signature !== last) {
        last = signature;
        refresh();
      }
    }, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();