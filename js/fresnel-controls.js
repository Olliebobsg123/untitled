"use strict";

/* Showtec Performer 1500 Fresnel controls. */
(function initialiseFresnelControls() {
  const $ = id => document.getElementById(id);

  const getSelectedFixtures = () => {
    const state = window.State;
    if (!state || !Array.isArray(state.fixtures)) return [];

    const ids = new Set();

    if (state.selected instanceof Set) {
      state.selected.forEach(id => ids.add(String(id)));
    }

    document.querySelectorAll("#fixtureList .sel[data-fixture-id]").forEach(el => {
      ids.add(String(el.dataset.fixtureId));
    });

    if (!ids.size && state.selectedFixtureId != null) {
      ids.add(String(state.selectedFixtureId));
    }

    return state.fixtures.filter(f => ids.has(String(f?.id)));
  };

  const getDefinition = fixture => {
    if (!fixture) return null;
    if (typeof window.getFixtureDefinition === "function") return window.getFixtureDefinition(fixture) || null;
    return window.FixtureLibrary?.[fixture.name] || null;
  };

  const getState = fixture => {
    if (!fixture) return null;
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    return null;
  };

  const isFresnel = fixture => {
    const map = getDefinition(fixture)?.map || {};
    return typeof map.warmWhite === "number" || typeof map.naturalWhite === "number" || typeof map.coolWhite === "number";
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const cctToDmx = cct => Math.round(((clamp(cct, 2700, 4500) - 2700) / 1800) * 255);
  const dmxToCct = value => Math.round(2700 + (clamp(value, 0, 255) / 255) * 1800);

  function injectStyles() {
    if ($("fresnelControlStyles")) return;
    const style = document.createElement("style");
    style.id = "fresnelControlStyles";
    style.textContent = `
      .fresnel-controls { display:grid; gap:10px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border,#223038); }
      .fresnel-title { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:2px; }
      .fresnel-title strong { letter-spacing:.08em; text-transform:uppercase; font-size:13px; }
      .fresnel-title small { color:var(--text-muted); font-size:9px; letter-spacing:.14em; text-transform:uppercase; }
      .fresnel-control { padding:11px 12px; border:1px solid var(--border,#223038); border-radius:10px; background:rgba(255,255,255,.018); }
      .fresnel-control .control-heading { margin-bottom:7px; }
      .fresnel-note { color:var(--text-muted); font-size:10px; line-height:1.4; }
      .fresnel-placeholder { color:var(--text-muted); font-size:11px; padding:10px 0; }
    `;
    document.head.appendChild(style);
  }

  function getHost() {
    let host = $("dynamicControls");
    if (host) return host;

    const panel = $("controlPanel");
    if (!panel) return null;

    host = document.createElement("div");
    host.id = "dynamicControls";
    host.className = "dynamic-controls";
    panel.appendChild(host);
    return host;
  }

  function sliderMarkup(id, label, value, min = 0, max = 255, suffix = "") {
    return `
      <div class="fresnel-control">
        <div class="control-heading">
          <div><span class="control-label">${label}</span><small>0–255 DMX</small></div>
          <strong class="fader-val"><span id="${id}Val">${value}</span>${suffix}</strong>
        </div>
        <div class="fader"><input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}"></div>
      </div>`;
  }

  function renderFresnelControls(fixture) {
    const host = getHost();
    if (!host) return;

    const def = getDefinition(fixture);
    const map = def?.map || {};
    const state = getState(fixture) || {};
    const isEightChannel = typeof map.naturalWhite === "number" || typeof map.cct === "number";
    const isThreeChannel = typeof map.warmWhite === "number" && typeof map.coolWhite === "number";
    const warm = clamp(state.warmWhite ?? 255, 0, 255);
    const secondWhite = clamp(isThreeChannel ? (state.coolWhite ?? 0) : (state.naturalWhite ?? 0), 0, 255);
    const cct = clamp(state.cctKelvin ?? dmxToCct(state.cct ?? 0), 2700, 4500);

    let html = `<div class="fresnel-controls" id="fresnelControls">
      <div class="fresnel-title"><strong>Performer 1500 Fresnel</strong><small>${def?.channels || "?"}ch ${isEightChannel ? "STD.P" : isThreeChannel ? "VW.D" : "FRESNEL"}</small></div>`;

    if (typeof map.warmWhite === "number") html += sliderMarkup("fresnelWarmWhite", "Warm White", warm);
    if (isThreeChannel) html += sliderMarkup("fresnelCoolWhite", "Cool White", secondWhite);
    else if (typeof map.naturalWhite === "number") html += sliderMarkup("fresnelNaturalWhite", "Natural White", secondWhite);

    if (typeof map.cct === "number") {
      html += `<div class="fresnel-control">
        <div class="control-heading"><div><span class="control-label">CCT</span><small>2700–4500 K</small></div>
        <strong class="fader-val"><span id="fresnelCctVal">${Math.round(cct)}</span>K</strong></div>
        <div class="fader"><input type="range" id="fresnelCct" min="2700" max="4500" step="50" value="${Math.round(cct)}"></div>
      </div>`;
    }

    html += `<div class="fresnel-note">These controls write directly to the Fresnel's mapped white/CCT channels.</div></div>`;
    host.replaceChildren();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    host.appendChild(wrapper.firstElementChild);
    bindControls();
  }

  function bindControls() {
    const bind = (id, property, transform = value => value) => {
      const input = $(id);
      if (!input || input.dataset.fresnelBound === "1") return;
      input.dataset.fresnelBound = "1";
      const apply = () => {
        const value = transform(input.value);
        const fixtures = getSelectedFixtures();
        for (const selected of fixtures) {
          if (!isFresnel(selected)) continue;
          const state = getState(selected);
          if (!state) continue;
          state[property] = value;
          window.State.fixtureStates.set(selected.id, state);
        }
        if (!fixtures.length) return;
        window.State.current ||= {};
        window.State.current[property] = value;
        $(id + "Val")?.replaceChildren(String(value));
        window.updateDMX?.();
        window.sendToVisualizer?.();
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", apply);
    };

    bind("fresnelWarmWhite", "warmWhite", value => clamp(value, 0, 255));
    bind("fresnelNaturalWhite", "naturalWhite", value => clamp(value, 0, 255));
    bind("fresnelCoolWhite", "coolWhite", value => clamp(value, 0, 255));

    const cct = $("fresnelCct");
    if (cct && cct.dataset.fresnelBound !== "1") {
      cct.dataset.fresnelBound = "1";
      const applyCct = () => {
        const kelvin = clamp(cct.value, 2700, 4500);
        const dmxValue = cctToDmx(kelvin);
        const fixtures = getSelectedFixtures();
        for (const selected of fixtures) {
          if (!isFresnel(selected)) continue;
          const state = getState(selected);
          if (!state) continue;
          state.cct = dmxValue;
          state.cctKelvin = kelvin;
          window.State.fixtureStates.set(selected.id, state);
        }
        if (!fixtures.length) return;
        window.State.current ||= {};
        window.State.current.cct = dmxValue;
        window.State.current.cctKelvin = kelvin;
        $("fresnelCctVal")?.replaceChildren(String(Math.round(kelvin)));
        window.updateDMX?.();
        window.sendToVisualizer?.();
      };
      cct.addEventListener("input", applyCct);
      cct.addEventListener("change", applyCct);
    }
  }

  function hideGenericColourControls(hidden) {
    ["colourGroup", "zoomGroup", "xyGroup"].forEach(id => {
      const el = $(id);
      if (el) el.style.display = hidden ? "none" : "";
    });
  }

  function refreshUI() {
    const fixtures = getSelectedFixtures();
    const host = getHost();
    if (!host) return;

    // Fresnel-specific controls only make sense for a single selected Fresnel.
    // When ALL/multiple fixtures are selected, keep the normal console controls
    // visible instead of switching the whole control panel to Fresnel mode.
    if (fixtures.length !== 1 || !isFresnel(fixtures[0])) {
      $("fresnelControls")?.remove();
      hideGenericColourControls(false);
      return;
    }

    hideGenericColourControls(true);
    renderFresnelControls(fixtures[0]);
  }

  function install() {
    injectStyles();
    refreshUI();

    if (!window.__fresnelSelectionObserver) {
      window.__fresnelSelectionObserver = true;
      const list = $("fixtureList");
      if (list) {
        new MutationObserver(refreshUI).observe(list, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"]
        });
      }
    }

    if (!window.__fresnelSelectionTimer) {
      window.__fresnelSelectionTimer = setInterval(refreshUI, 250);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
