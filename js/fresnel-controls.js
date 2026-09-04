"use strict";

/*
 * Showtec Performer 1500 Fresnel controls.
 *
 * The fixture library and dmx.js already describe the Fresnel DMX
 * personalities. This file supplies the missing UI and maps the UI
 * values directly onto those fixture-state properties.
 */
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

  const isFresnel = fixture => {
    const def = getDefinition(fixture);
    const map = def?.map || {};
    return typeof map.warmWhite === "number" ||
      typeof map.naturalWhite === "number" ||
      typeof map.coolWhite === "number";
  };

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, Number(value) || 0));

  const cctToDmx = cct => {
    const value = clamp(cct, 2700, 4500);
    return Math.round(((value - 2700) / 1800) * 255);
  };

  const dmxToCct = value =>
    Math.round(2700 + (clamp(value, 0, 255) / 255) * 1800);

  function injectStyles() {
    if ($("fresnelControlStyles")) return;

    const style = document.createElement("style");
    style.id = "fresnelControlStyles";
    style.textContent = `
      .fresnel-controls {
        display: grid;
        gap: 10px;
        margin-top: 4px;
      }
      .fresnel-title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 2px;
      }
      .fresnel-title strong {
        letter-spacing: .08em;
        text-transform: uppercase;
        font-size: 13px;
      }
      .fresnel-title small {
        color: var(--text-muted);
        font-size: 9px;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      .fresnel-control {
        padding: 11px 12px;
        border: 1px solid var(--border, #223038);
        border-radius: 10px;
        background: rgba(255,255,255,.018);
      }
      .fresnel-control .control-heading {
        margin-bottom: 7px;
      }
      .fresnel-value {
        font-variant-numeric: tabular-nums;
      }
      .fresnel-note {
        color: var(--text-muted);
        font-size: 10px;
        line-height: 1.4;
        margin-top: 1px;
      }
    `;
    document.head.appendChild(style);
  }

  function sliderMarkup(id, label, value, min = 0, max = 255, suffix = "") {
    return `
      <div class="fresnel-control">
        <div class="control-heading">
          <div>
            <span class="control-label">${label}</span>
            <small>0–255 DMX</small>
          </div>
          <strong class="fader-val"><span id="${id}Val">${value}</span>${suffix}</strong>
        </div>
        <div class="fader">
          <input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}">
        </div>
      </div>
    `;
  }

  function renderFresnelControls(fixture) {
    const host = $("dynamicControls");
    if (!host) return;

    const def = getDefinition(fixture);
    const map = def?.map || {};
    const state = getState(fixture) || {};

    const isEightChannel =
      typeof map.naturalWhite === "number" ||
      typeof map.cct === "number";

    const isThreeChannel =
      typeof map.warmWhite === "number" &&
      typeof map.coolWhite === "number";

    const warm = clamp(state.warmWhite ?? 255, 0, 255);
    const secondWhite = clamp(
      isThreeChannel
        ? (state.coolWhite ?? 0)
        : (state.naturalWhite ?? 0),
      0,
      255
    );

    const cct = clamp(
      state.cctKelvin ?? dmxToCct(state.cct ?? 0),
      2700,
      4500
    );

    let html = `
      <div class="fresnel-controls" id="fresnelControls">
        <div class="fresnel-title">
          <strong>Performer 1500 Fresnel</strong>
          <small>${def?.channels || "?"}ch ${isEightChannel ? "STD.P" : isThreeChannel ? "VW.D" : "DIMMER"}</small>
        </div>
    `;

    if (typeof map.warmWhite === "number") {
      html += sliderMarkup("fresnelWarmWhite", "Warm White", warm);
    }

    if (isThreeChannel) {
      html += sliderMarkup("fresnelCoolWhite", "Cool White", secondWhite);
    } else if (typeof map.naturalWhite === "number") {
      html += sliderMarkup("fresnelNaturalWhite", "Natural White", secondWhite);
    }

    if (typeof map.cct === "number") {
      html += `
        <div class="fresnel-control">
          <div class="control-heading">
            <div>
              <span class="control-label">CCT</span>
              <small>2700–4500 K</small>
            </div>
            <strong class="fader-val"><span id="fresnelCctVal">${Math.round(cct)}</span>K</strong>
          </div>
          <div class="fader">
            <input type="range" id="fresnelCct" min="2700" max="4500" step="50" value="${Math.round(cct)}">
          </div>
        </div>
      `;
    }

    html += `
        <div class="fresnel-note">
          Warm/cool or warm/natural white is sent to the fixture's white channels;
          CCT is converted to the fixture's 0–255 CCT DMX range.
        </div>
      </div>
    `;

    host.innerHTML = html;
    bindControls(fixture);
  }

  function bindControls(fixture) {
    const bind = (id, property, transform = value => value) => {
      const input = $(id);
      if (!input || input.dataset.fresnelBound === "1") return;
      input.dataset.fresnelBound = "1";

      const apply = () => {
        const value = transform(input.value);
        const fixtures = getSelectedFixtures();
        if (!fixtures.length) return;

        for (const selected of fixtures) {
          if (!isFresnel(selected)) continue;
          const state = getState(selected);
          if (!state) continue;
          state[property] = value;
          window.State.fixtureStates.set(selected.id, state);
        }

        window.State.current ||= {};
        window.State.current[property] = value;

        const valueEl = $(id + "Val");
        if (valueEl) valueEl.textContent = String(value);

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
        if (!fixtures.length) return;

        for (const selected of fixtures) {
          if (!isFresnel(selected)) continue;
          const state = getState(selected);
          if (!state) continue;
          state.cct = dmxValue;
          state.cctKelvin = kelvin;
          window.State.fixtureStates.set(selected.id, state);
        }

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
      if (!el) return;
      el.style.display = hidden ? "none" : "";
    });
  }

  function refreshUI() {
    const fixtures = getSelectedFixtures();
    const fresnel = fixtures.find(isFresnel);
    if (!fresnel) {
      $("fresnelControls")?.remove();
      hideGenericColourControls(false);
      return;
    }

    hideGenericColourControls(true);
    renderFresnelControls(fresnel);
  }

  function patchDMX() {
    if (window.__fresnelDMXPatched || typeof window.updateDMX !== "function") return;
    window.__fresnelDMXPatched = true;

    const originalUpdateDMX = window.updateDMX;
    window.updateDMX = function fresnelAwareUpdateDMX(...args) {
      originalUpdateDMX.apply(this, args);

      const state = window.State;
      if (!state?.dmx || !Array.isArray(state.fixtures)) return;

      const write = (base, offset, value) => {
        if (typeof offset !== "number") return;
        const channel = base + offset;
        if (channel < 0 || channel >= state.dmx.length) return;
        state.dmx[channel] = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
      };

      for (const fixture of state.fixtures) {
        if (!isFresnel(fixture)) continue;
        const def = getDefinition(fixture);
        const map = def?.map || {};
        const base = Math.max(0, Number(fixture.addr || 1) - 1);
        const saved = getState(fixture) || {};
        const master = clamp(saved.master ?? state.current?.master ?? 100, 0, 100) / 100;
        const intensity = clamp(saved.intensity ?? 100, 0, 100) / 100;
        const level = state.blackout ? 0 : master * intensity;

        if (typeof map.warmWhite === "number") {
          write(base, map.warmWhite, (saved.warmWhite ?? 255) * level);
        }
        if (typeof map.warmWhiteFine === "number") {
          write(base, map.warmWhiteFine, 0);
        }
        if (typeof map.naturalWhite === "number") {
          write(base, map.naturalWhite, (saved.naturalWhite ?? 0) * level);
        }
        if (typeof map.naturalWhiteFine === "number") {
          write(base, map.naturalWhiteFine, 0);
        }
        if (typeof map.coolWhite === "number") {
          write(base, map.coolWhite, (saved.coolWhite ?? 0) * level);
        }
        if (typeof map.cct === "number") {
          write(base, map.cct, saved.cct ?? cctToDmx(saved.cctKelvin ?? 2700));
        }
      }

      if (window.ArtNet?.enabled) window.ArtNet.send();
      window.sendToVisualizer?.();
    };
  }

  function install() {
    injectStyles();
    patchDMX();
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
