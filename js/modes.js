"use strict";

(() => {
  const MODE_KEY = "consoleMode";
  let mode = localStorage.getItem(MODE_KEY) === "blind" ? "BLIND" : "LIVE";

  const $ = id => document.getElementById(id);

  function installModeStyles() {
    if (document.getElementById("console-mode-styles")) return;

    const style = document.createElement("style");
    style.id = "console-mode-styles";
    style.textContent = `
      .console-mode-switch {
        display:flex;
        align-items:center;
        gap:3px;
        padding:3px;
        border:1px solid var(--border, #202a30);
        border-radius:9px;
        background:#080d10;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
      }

      .console-mode-switch button {
        min-width:64px;
        height:27px;
        padding:0 12px;
        border:1px solid transparent;
        border-radius:6px;
        background:transparent;
        color:#64716f;
        cursor:pointer;
        font:800 8px/1 var(--mono, monospace);
        letter-spacing:1.1px;
        transition:all .15s ease;
      }

      .console-mode-switch button:hover {
        color:#dce7e4;
        background:rgba(255,255,255,.04);
      }

      .console-mode-switch button.live.active {
        color:#06130e;
        background:#19d6a3;
        border-color:#54f2c8;
        box-shadow:0 0 14px rgba(25,214,163,.22);
      }

      .console-mode-switch button.blind.active {
        color:#07111d;
        background:#5ca8ff;
        border-color:#8bc5ff;
        box-shadow:0 0 14px rgba(92,168,255,.24);
      }

      .safety-controls {
        display:flex;
        align-items:center;
        gap:5px;
        margin-left:4px;
      }

      .safety-control {
        min-width:76px;
        height:30px;
        padding:0 10px;
        border-radius:7px;
        cursor:pointer;
        font:900 8px/1 var(--mono, monospace);
        letter-spacing:.8px;
        transition:transform .12s ease, box-shadow .12s ease, background .12s ease;
      }

      .safety-control:hover { transform:translateY(-1px); }

      .safety-emergency {
        color:#111;
        background:#fff;
        border:2px solid #ff5265;
        box-shadow:0 0 12px rgba(255,255,255,.08);
      }

      .safety-emergency:hover {
        background:#fff;
        box-shadow:0 0 16px rgba(255,255,255,.35);
      }

      .safety-blackout {
        color:#fff;
        background:#190b0e;
        border:1px solid #ff5265;
      }

      .safety-blackout:hover {
        background:#2b0e13;
        box-shadow:0 0 12px rgba(255,82,101,.18);
      }

      .emergency-active .safety-emergency {
        color:#111;
        background:#fff;
        border-color:#111;
        box-shadow:0 0 20px rgba(255,255,255,.95);
      }

      /* Emergency state intentionally switches the console into a bright,
         high-visibility UI so the operator can immediately see the override. */
      html.emergency-active,
      html.emergency-active body {
        background:#fff !important;
        color:#111 !important;
      }

      html.emergency-active body {
        background:#fff !important;
      }

      html.emergency-active .sidebar,
      html.emergency-active .topbar,
      html.emergency-active .panel,
      html.emergency-active .controls,
      html.emergency-active .bottom-row,
      html.emergency-active .cmd-line,
      html.emergency-active .command-line {
        background:#fff !important;
        color:#111 !important;
        border-color:#d5d9dc !important;
        box-shadow:0 4px 20px rgba(0,0,0,.08) !important;
      }

      html.emergency-active .panel-header,
      html.emergency-active .brand,
      html.emergency-active .sidebar-footer,
      html.emergency-active .topbar-divider,
      html.emergency-active .section-divider {
        border-color:#d5d9dc !important;
      }

      html.emergency-active .panel-header,
      html.emergency-active .panel-meta,
      html.emergency-active .sidebar-section-label,
      html.emergency-active .brand-sub,
      html.emergency-active .version,
      html.emergency-active .toolbar-label,
      html.emergency-active .toolbar-hint,
      html.emergency-active .page-kicker,
      html.emergency-active .top-master span {
        color:#596168 !important;
      }

      html.emergency-active .brand-name,
      html.emergency-active .page-title strong,
      html.emergency-active .top-master strong,
      html.emergency-active .nav-link,
      html.emergency-active .fixture-item,
      html.emergency-active .group-item,
      html.emergency-active .cue-item,
      html.emergency-active label,
      html.emergency-active .form-row label {
        color:#111 !important;
      }

      html.emergency-active .nav-link:hover,
      html.emergency-active .fixture-item:hover,
      html.emergency-active .group-item:hover,
      html.emergency-active .cue-item:hover {
        background:#f0f2f4 !important;
        color:#111 !important;
      }

      html.emergency-active .nav-link.active {
        color:#111 !important;
        background:#eef1f3 !important;
        box-shadow:inset 2px 0 0 #111 !important;
      }

      html.emergency-active .status-pill,
      html.emergency-active .console-mode-switch,
      html.emergency-active .btn-secondary,
      html.emergency-active .btn-icon,
      html.emergency-active input,
      html.emergency-active select,
      html.emergency-active textarea {
        background:#f4f5f6 !important;
        color:#111 !important;
        border-color:#cbd0d4 !important;
      }

      html.emergency-active .btn-primary {
        background:#111 !important;
        color:#fff !important;
      }

      html.emergency-active .btn-danger-soft {
        background:#fff0f1 !important;
        color:#b31d31 !important;
        border-color:#ff5265 !important;
      }

      html[data-console-mode="blind"] .topbar {
        border-color:rgba(92,168,255,.35);
        box-shadow:0 0 22px rgba(92,168,255,.06);
      }

      html[data-console-mode="blind"] .sidebar {
        border-color:rgba(92,168,255,.28);
      }

      html[data-console-mode="blind"] .nav-link.active {
        color:#8bc5ff;
        background:linear-gradient(90deg,rgba(92,168,255,.15),rgba(92,168,255,.045));
        box-shadow:inset 2px 0 0 #5ca8ff;
      }

      html[data-console-mode="blind"] .nav-link.active span {
        color:#5ca8ff;
      }

      html[data-console-mode="blind"] .page-kicker {
        color:#5ca8ff;
      }

      html[data-console-mode="blind"] .page-title strong {
        color:#8bc5ff;
      }

      html[data-console-mode="blind"] .quick-panel .panel-meta {
        color:#5ca8ff;
      }

      @media (max-width: 900px) {
        .safety-control { min-width:62px; padding:0 7px; }
        .safety-control span.detail { display:none; }
      }
    `;

    document.head.appendChild(style);
  }

  function sendVisualizerMode() {
    const viz = window.visualizerWindow;
    if (viz && !viz.closed) {
      viz.postMessage({ type: "CONSOLE_MODE", mode }, "*");
    }
  }

  function updateSidebarModeLabel() {
    const liveNav = document.querySelector('.nav-link[data-page="live"]');
    if (!liveNav) return;

    const labelNode = Array.from(liveNav.childNodes)
      .find(node => node.nodeType === Node.TEXT_NODE);

    if (labelNode) {
      labelNode.textContent = mode === "BLIND" ? " Blind Control " : " Live Control ";
    }

    liveNav.setAttribute(
      "aria-label",
      mode === "BLIND" ? "Blind Control" : "Live Control"
    );
  }

  function updateUI() {
    const live = $("consoleModeLive");
    const blind = $("consoleModeBlind");
    if (!live || !blind) return;

    installModeStyles();

    live.classList.toggle("active", mode === "LIVE");
    blind.classList.toggle("active", mode === "BLIND");

    document.body.classList.toggle("console-blind", mode === "BLIND");
    document.documentElement.dataset.consoleMode = mode.toLowerCase();

    const meta = document.querySelector("#page-live .quick-panel .panel-meta");
    if (meta) meta.textContent = mode;

    const title = $("topPageTitle");
    if (title && mode === "BLIND") {
      title.dataset.liveTitle ||= title.textContent;
      title.textContent = "BLIND PROGRAMMER";
    } else if (title) {
      title.textContent = title.dataset.liveTitle || "LIVE CONTROL";
    }

    updateSidebarModeLabel();
    sendVisualizerMode();
  }

  function setMode(next) {
    mode = String(next).toUpperCase() === "BLIND" ? "BLIND" : "LIVE";
    localStorage.setItem(MODE_KEY, mode.toLowerCase());

    if (window.ArtNet) {
      window.ArtNet.outputMode = mode;
      window.ArtNet.send?.();
    }

    updateUI();
    console.log(`🎛 Console mode: ${mode}`);
  }

  function clearEmergencyUI() {
    document.documentElement.classList.remove("emergency-active");
    document.body.classList.remove("emergency-active");
  }

  function stopRunningLooks() {
    if (window.ActiveChase) {
      clearInterval(window.ActiveChase);
      window.ActiveChase = null;
    }
    if (window.State?.fading) {
      cancelAnimationFrame(window.State.fading);
      window.State.fading = null;
    }
    if (typeof window.stopEffects === "function") window.stopEffects();
    if (typeof window.stopAllEffects === "function") window.stopAllEffects();
  }

  function applyAllFixturesState(state) {
    if (!window.State) return;
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();

    const makeState = fixture => {
      const previous = State.fixtureStates.get(fixture.id) || State.current || {};
      return {
        ...previous,
        ...state
      };
    };

    (Array.isArray(State.fixtures) ? State.fixtures : []).forEach(fixture => {
      if (!fixture?.id) return;
      State.fixtureStates.set(fixture.id, makeState(fixture));
    });

    State.current = {
      ...(State.current || {}),
      ...state
    };

    if (typeof window.updateDMX === "function") window.updateDMX();
    if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();
  }

  function emergencyWhite() {
    stopRunningLooks();

    // Emergency White is a deliberate live-output override. If the console
    // was in Blind, switch to Live so the safety state actually reaches Art-Net.
    setMode("LIVE");

    applyAllFixturesState({
      intensity: 100,
      master: 100,
      hue: 0,
      sat: 0,
      light: 50,
      strobe: 0,
      gobo: 0,
      gobo2: 0,
      prism: 0,
      prismr: 0,
      focus: 0,
      zoom: 0,
      frost: 0,
      iris: 0,
      rot: 0,
      effect: 0,
      speed: 0,
      macro: 0,
      preset: 0,
      shake: 0,
      mode: 0
    });

    document.documentElement.classList.add("emergency-active");
    document.body.classList.add("emergency-active");

    const title = $("topPageTitle");
    if (title) title.textContent = "EMERGENCY WHITE";

    if (typeof window.log === "function") {
      window.log("EMERGENCY WHITE — all patched fixtures forced to 100% white", "warn");
    }
  }

  function blackout() {
    stopRunningLooks();
    clearEmergencyUI();

    setMode("LIVE");

    applyAllFixturesState({
      intensity: 0,
      master: 100,
      strobe: 0,
      gobo: 0,
      gobo2: 0,
      prism: 0,
      prismr: 0,
      effect: 0,
      speed: 0,
      macro: 0,
      preset: 0,
      shake: 0,
      mode: 0
    });

    const title = $("topPageTitle");
    if (title) title.textContent = "BLACKOUT";

    if (typeof window.log === "function") {
      window.log("BLACKOUT — all patched fixtures forced to 0%", "warn");
    }
  }

  function installSafetyControls() {
    if (document.getElementById("safetyControls")) return;

    const status = document.querySelector(".topbar-status");
    if (!status) return;

    const wrap = document.createElement("div");
    wrap.id = "safetyControls";
    wrap.className = "safety-controls";
    wrap.setAttribute("aria-label", "Emergency lighting controls");

    const emergency = document.createElement("button");
    emergency.type = "button";
    emergency.id = "btnEmergencyWhite";
    emergency.className = "safety-control safety-emergency";
    emergency.title = "Force all patched fixtures to 100% white";
    emergency.innerHTML = "🚨 WHITE";
    emergency.addEventListener("click", e => {
      e.preventDefault();
      emergencyWhite();
    });

    const black = document.createElement("button");
    black.type = "button";
    black.id = "btnEmergencyBlackout";
    black.className = "safety-control safety-blackout";
    black.title = "Force all patched fixtures to 0%";
    black.textContent = "BLACKOUT";
    black.addEventListener("click", e => {
      e.preventDefault();
      blackout();
    });

    wrap.append(emergency, black);
    status.prepend(wrap);
  }

  function install() {
    const live = $("consoleModeLive");
    const blind = $("consoleModeBlind");
    if (!live || !blind) return;

    installModeStyles();
    installSafetyControls();

    live.onclick = () => {
      clearEmergencyUI();
      setMode("LIVE");
    };

    blind.onclick = () => {
      clearEmergencyUI();
      setMode("BLIND");
    };

    if (window.ArtNet && !window.ArtNet.__blindLiveModePatched) {
      const originalSend = window.ArtNet.send.bind(window.ArtNet);
      window.ArtNet.__blindLiveModePatched = true;
      window.ArtNet.outputMode = mode;
      window.ArtNet.send = function () {
        if (window.ArtNet.outputMode === "BLIND") {
          if (typeof window.sendVisualizerDMX === "function") {
            window.sendVisualizerDMX();
          }
          return;
        }
        return originalSend();
      };
    }

    updateUI();
    sendVisualizerMode();
  }

  window.setConsoleMode = setMode;
  window.getConsoleMode = () => mode;
  window.emergencyWhite = emergencyWhite;
  window.consoleBlackout = blackout;

  window.addEventListener("message", event => {
    if (event.data?.type === "VISUALIZER_READY") {
      sendVisualizerMode();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
