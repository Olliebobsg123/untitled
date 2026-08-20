"use strict";

(() => {
  const MODE_KEY = "consoleMode";
  let mode = localStorage.getItem(MODE_KEY) === "blind" ? "BLIND" : "LIVE";

  const $ = id => document.getElementById(id);

  function sendVisualizerMode() {
    const viz = window.visualizerWindow;
    if (viz && !viz.closed) {
      viz.postMessage({ type: "CONSOLE_MODE", mode }, "*");
    }
  }

  function updateUI() {
    const live = $("consoleModeLive");
    const blind = $("consoleModeBlind");
    if (!live || !blind) return;

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

    sendVisualizerMode();
  }

  function setMode(next) {
    mode = String(next).toUpperCase() === "BLIND" ? "BLIND" : "LIVE";
    localStorage.setItem(MODE_KEY, mode.toLowerCase());

    if (window.ArtNet) {
      window.ArtNet.outputMode = mode;
      if (mode === "BLIND") {
        window.ArtNet.send?.();
      } else {
        window.ArtNet.send?.();
      }
    }

    updateUI();
    console.log(`🎛 Console mode: ${mode}`);
  }

  function install() {
    const live = $("consoleModeLive");
    const blind = $("consoleModeBlind");
    if (!live || !blind) return;

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
