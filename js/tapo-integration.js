"use strict";

/* Tapo L900-10 Wi-Fi fixture integration. */
(function initialiseTapoIntegration() {
  const TAPO_NAME = "Tapo L900-10 (Wi-Fi RGB)";
  const TAPO_FIXTURE = {
    type: "wifi-rgb",
    transport: "tapo",
    channels: 0,
    map: { intensity: 0, dimmer: 0, hue: 0, sat: 0, r: 0, g: 0, b: 0 },
    capabilities: ["power", "intensity", "colour"],
    photometrics: { verified: true, sourceType: "LED", ratedLumens: null, manufacturer: "TP-Link Tapo", model: "L900-10" }
  };

  const waitFor = (test, done, attempts = 120) => {
    if (test()) return done();
    if (attempts <= 0) return;
    setTimeout(() => waitFor(test, done, attempts - 1), 100);
  };

  const ensureFixtureDefinition = () => {
    if (!window.FixtureLibrary) return false;
    if (!window.FixtureLibrary[TAPO_NAME]) window.FixtureLibrary[TAPO_NAME] = TAPO_FIXTURE;
    return true;
  };

  const getSelected = () => {
    const state = window.State;
    if (!state?.fixtures) return [];
    const ids = new Set();
    if (state.selected instanceof Set) state.selected.forEach(id => ids.add(String(id)));
    if (!ids.size && state.selectedFixtureId != null) ids.add(String(state.selectedFixtureId));
    return state.fixtures.filter(f => ids.has(String(f?.id)));
  };

  const getAllTapoFixtures = () => {
    const state = window.State;
    if (!state?.fixtures) return [];
    return state.fixtures.filter(isTapo);
  };

  const isTapo = fixture => {
    const def = fixture && (window.FixtureLibrary?.[fixture.name] || fixture.definition);
    return def?.transport === "tapo" || fixture?.transport === "tapo";
  };

  const getState = fixture => {
    if (!fixture) return null;
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    if (!(window.State.fixtureStates instanceof Map)) window.State.fixtureStates = new Map();
    if (!window.State.fixtureStates.has(fixture.id)) window.State.fixtureStates.set(fixture.id, { ...(window.State.current || {}) });
    return window.State.fixtureStates.get(fixture.id);
  };

  const hslToHex = (h, s, l) => {
    h = ((Number(h) || 0) % 360 + 360) % 360;
    s = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
    l = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const byte = value => Math.round((value + m) * 255).toString(16).padStart(2, "0");
    return `#${byte(r)}${byte(g)}${byte(b)}`;
  };

  let lastSent = new Map();
  const pending = new Map();
  let sending = false;

  const sendState = async fixture => {
    if (!isTapo(fixture) || !window.Tapo?.setState) return;
    const state = getState(fixture);
    const config = fixture.tapo || {};
    if (!config.ip || !config.email || !config.password) return;

    const intensity = Math.max(0, Math.min(100, Number(state.intensity ?? 100)));
    const hue = Number(state.hue ?? 0);
    const sat = Math.max(0, Math.min(100, Number(state.sat ?? 100)));
    const light = Math.max(0, Math.min(100, Number(state.light ?? 50)));

    // Tapo is a live network output, so its safety state must follow the
    // console rather than only the DMX buffer. BLIND deliberately produces
    // no physical Tapo output; switching back to LIVE causes the next update
    // to be sent immediately.
    const mode = String(document.documentElement?.dataset.consoleMode || "LIVE").toUpperCase();
    const blackout = Boolean(window.State?.blackout);
    if (mode === "BLIND") return;

    const on = !blackout && intensity > 0;
    const colour = hslToHex(hue, sat, light);
    const signature = JSON.stringify([config.ip, config.email, on, intensity, colour, mode, blackout]);
    if (lastSent.get(fixture.id) === signature) return;

    pending.set(String(fixture.id), { fixture, config: { ...config }, on, intensity, colour, signature });
    if (sending) return;

    sending = true;
    try {
      while (pending.size) {
        const [id, item] = pending.entries().next().value;
        pending.delete(id);
        try {
          await window.Tapo.setState(item.config, {
            on: item.on,
            brightness: item.intensity,
            colour: item.colour,
            immediate: true
          });
          lastSent.set(item.fixture.id, item.signature);
        } catch (error) {
          window.log?.(`Tapo ${item.fixture.name}: ${error.message}`, "error");
        }
      }
    } finally {
      sending = false;
    }
  };

  window.sendTapoState = () => getSelected().filter(isTapo).forEach(sendState);

  const installOutputHook = () => {
    if (typeof window.updateDMX !== "function" || window.updateDMX.__tapoOutputHook) return false;
    const original = window.updateDMX;
    const hooked = function tapoOutputHook(...args) {
      const result = original.apply(this, args);
      getAllTapoFixtures().forEach(sendState);
      return result;
    };
    hooked.__tapoOutputHook = true;
    window.updateDMX = hooked;
    return true;
  };

  const installDmxGuard = () => {
    if (typeof window.updateDMX !== "function" || window.updateDMX.__tapoGuard) return false;
    const original = window.updateDMX;
    const guarded = function tapoSafeUpdateDMX(...args) {
      const state = window.State;
      if (!state?.fixtures?.length) return original.apply(this, args);
      const all = state.fixtures;
      const dmxFixtures = all.filter(f => !isTapo(f));
      if (dmxFixtures.length === all.length) return original.apply(this, args);
      state.fixtures = dmxFixtures;
      try { return original.apply(this, args); }
      finally { state.fixtures = all; }
    };
    guarded.__tapoGuard = true;
    window.updateDMX = guarded;
    return true;
  };

  const installOutputIntegration = () => {
    installDmxGuard();
    installOutputHook();
  };

  const injectSetup = () => {
    const patchPanel = document.querySelector("#page-patch .page-grid .panel:nth-child(2) .panel-body");
    if (!patchPanel || document.getElementById("tapoSetup")) return;
    const setup = document.createElement("div");
    setup.id = "tapoSetup";
    setup.className = "toolbar-card";
    setup.style.marginTop = "16px";
    setup.innerHTML = `
      <div class="section-divider"><span>TAPO WI-FI</span></div>
      <div class="form-grid">
        <div class="form-row form-span"><label>Device IP</label><input id="tapoIp" type="text" placeholder="192.168.1.100" autocomplete="off"></div>
        <div class="form-row"><label>Tapo Email</label><input id="tapoEmail" type="email" placeholder="Tapo account email" autocomplete="off"></div>
        <div class="form-row"><label>Tapo Password</label><input id="tapoPassword" type="password" placeholder="Tapo account password" autocomplete="off"></div>
      </div>
      <div class="action-row"><button class="btn-secondary" id="tapoTest">Test Tapo Connection</button></div>
      <small style="display:block;margin-top:8px;opacity:.65">The L900-10 must be on the same local network as this computer. Credentials are kept in the current app session.</small>`;
    patchPanel.appendChild(setup);

    document.getElementById("tapoTest")?.addEventListener("click", async () => {
      const config = {
        ip: document.getElementById("tapoIp")?.value.trim(),
        email: document.getElementById("tapoEmail")?.value.trim(),
        password: document.getElementById("tapoPassword")?.value
      };
      if (!config.ip || !config.email || !config.password) return window.log?.("Enter Tapo IP, email and password first", "warn");
      window.__tapoSessionConfig = config;
      try {
        await window.Tapo.test(config);
        window.log?.("Tapo L900-10 responding", "ok");
      } catch (error) {
        window.log?.(`Tapo connection failed: ${error.message}`, "error");
      }
    });
  };

  const wireFixturePatching = () => {
    const button = document.getElementById("btnPatch");
    if (!button || button.dataset.tapoPatched === "1") return !!button;
    button.dataset.tapoPatched = "1";
    button.addEventListener("click", () => {
      if (document.getElementById("patchName")?.value !== TAPO_NAME) return;
      const config = window.__tapoSessionConfig || {
        ip: document.getElementById("tapoIp")?.value.trim(),
        email: document.getElementById("tapoEmail")?.value.trim(),
        password: document.getElementById("tapoPassword")?.value
      };
      if (!config.ip || !config.email || !config.password) return window.log?.("Configure the Tapo connection before patching the L900-10", "warn");
      window.__tapoSessionConfig = config;
      const before = new Set((window.State.fixtures || []).map(f => String(f.id)));
      setTimeout(() => {
        const fixture = (window.State.fixtures || []).find(f => !before.has(String(f.id)) && f.name === TAPO_NAME);
        if (!fixture) return;
        fixture.transport = "tapo";
        fixture.tapo = { ...config };
        fixture.addr = null;
        fixture.uni = null;
        const state = getState(fixture);
        state.intensity = Number(state.intensity ?? 100);
        state.hue = Number(state.hue ?? 0);
        state.sat = Number(state.sat ?? 100);
        state.light = Number(state.light ?? 50);
        window.State.fixtureStates.set(fixture.id, state);
        window.updateDMX?.();
        window.updateParameterVisibility?.();
        window.renderFixtures?.();
        window.log?.(`Tapo patched: #${fixture.fixtureNumber} ${TAPO_NAME}`, "ok");
        sendState(fixture);
      }, 0);
    }, true);
    return true;
  };

  const wireRendererControls = () => {
    if (document.documentElement.dataset.tapoControls === "1") return;
    document.documentElement.dataset.tapoControls = "1";

    let scheduled = false;
    const sendSelectedTapo = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        getSelected().filter(isTapo).forEach(sendState);
      });
    };

    document.addEventListener("input", event => {
      const id = event.target?.id;
      if (id === "intensity" || id === "hue" || id === "sat" || id === "light") sendSelectedTapo();
    }, true);

    document.addEventListener("change", event => {
      const id = event.target?.id;
      if (id === "intensity" || id === "hue" || id === "sat" || id === "light") sendSelectedTapo();
    }, true);

    const wireColourWheel = () => {
      const wheel = document.getElementById("colourWheel");
      if (!wheel || wheel.dataset.tapoColourWheel === "1") return !!wheel;
      wheel.dataset.tapoColourWheel = "1";
      ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend"].forEach(type => {
        wheel.addEventListener(type, sendSelectedTapo, true);
      });
      return true;
    };

    let attempts = 0;
    const waitForWheel = () => {
      if (wireColourWheel()) return;
      if (++attempts < 150) setTimeout(waitForWheel, 100);
    };
    waitForWheel();

    document.querySelectorAll("[data-hue]").forEach(button => button.addEventListener("click", () => setTimeout(sendSelectedTapo, 0)));
    document.querySelectorAll("[data-v]").forEach(button => button.addEventListener("click", () => setTimeout(sendSelectedTapo, 0)));
  };

  const start = () => {
    ensureFixtureDefinition();
    injectSetup();
    wireFixturePatching();
    wireRendererControls();
    installOutputIntegration();
    window.renderLibrary?.();
  };

  waitFor(() => !!window.FixtureLibrary && !!document.getElementById("fixtureList"), start);
})();
