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

  function install() {
    const live = $("consoleModeLive");
    const blind = $("consoleModeBlind");
    if (!live || !blind) return;

    installModeStyles();

    live.onclick = () => setMode("LIVE");
    blind.onclick = () => setMode("BLIND");

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
