"use strict";

/*
 * Show-file visualizer bridge.
 *
 * The visualizer runs in its own window, so its S/VizState cannot be read
 * directly by the console window. This bridge mirrors the visualizer state
 * into the console and reapplies loaded positions back into the visualizer.
 */
(function () {
  if (window.__lxShowFileVisualizerFix) return;
  window.__lxShowFileVisualizerFix = true;

  const clone = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      try { out[key] = clone(item); } catch (_) {}
    }
    return out;
  };

  const serialise = () => {
    try {
      const viz = window.S || window.VizState;
      if (!viz) return null;
      const fixtures = Array.isArray(viz.fixtures)
        ? viz.fixtures
        : Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
      const positions = viz.fixturePositions instanceof Map ? viz.fixturePositions : new Map();
      const rotations = viz.fixtureManualRot instanceof Map ? viz.fixtureManualRot : new Map();
      return {
        fixturePositions: fixtures.flatMap((fx, index) => {
          const p = positions.get(index);
          return p && [p.x, p.y, p.z].every(Number.isFinite)
            ? [{ fixtureIndex: index, fixtureId: fx?.id, x: Number(p.x), y: Number(p.y), z: Number(p.z) }]
            : [];
        }),
        fixtureManualRot: fixtures.flatMap((fx, index) => {
          const r = rotations.get(index);
          return r && [r.pan, r.tilt].every(Number.isFinite)
            ? [{ fixtureIndex: index, fixtureId: fx?.id, pan: Number(r.pan), tilt: Number(r.tilt) }]
            : [];
        }),
        gridOn: viz.gridOn !== undefined ? Boolean(viz.gridOn) : true,
        houseOn: viz.houseOn !== undefined ? Boolean(viz.houseOn) : false,
        workOn: viz.workOn !== undefined ? Boolean(viz.workOn) : false
      };
    } catch (_) {
      return null;
    }
  };

  const apply = state => {
    if (!state || typeof state !== "object") return false;
    const Viz = window.S || window.VizState;
    if (!Viz) return false;
    try {
      const fixtures = Array.isArray(window.State?.fixtures)
        ? window.State.fixtures
        : Array.isArray(Viz.fixtures) ? Viz.fixtures : [];
      const byId = new Map(fixtures.map((fx, index) => [String(fx?.id), index]));
      if (!(Viz.fixturePositions instanceof Map)) Viz.fixturePositions = new Map();
      if (!(Viz.fixtureManualRot instanceof Map)) Viz.fixtureManualRot = new Map();

      Viz.fixturePositions.clear();
      Viz.fixtureManualRot.clear();

      for (const saved of Array.isArray(state.fixturePositions) ? state.fixturePositions : []) {
        const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId))
          ? byId.get(String(saved.fixtureId))
          : Number(saved?.fixtureIndex);
        const x = Number(saved?.x), y = Number(saved?.y), z = Number(saved?.z);
        if (Number.isInteger(index) && index >= 0 && index < fixtures.length && [x, y, z].every(Number.isFinite)) {
          Viz.fixturePositions.set(index, { x, y, z });
        }
      }

      for (const saved of Array.isArray(state.fixtureManualRot) ? state.fixtureManualRot : []) {
        const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId))
          ? byId.get(String(saved.fixtureId))
          : Number(saved?.fixtureIndex);
        const pan = Number(saved?.pan), tilt = Number(saved?.tilt);
        if (Number.isInteger(index) && index >= 0 && index < fixtures.length && [pan, tilt].every(Number.isFinite)) {
          Viz.fixtureManualRot.set(index, { pan, tilt });
        }
      }

      if (fixtures.length) Viz.fixtures = fixtures;
      if (Viz.grid) Viz.grid.visible = state.gridOn !== false;
      if (Viz.houseOn !== undefined) Viz.houseOn = state.houseOn !== false;
      if (Viz.workOn !== undefined) Viz.workOn = state.workOn !== false;
      Viz.rebuildFixtures?.();
      return true;
    } catch (error) {
      console.warn("[SHOW] Visualizer state apply failed:", error);
      return false;
    }
  };

  const updateConsoleMirror = state => {
    if (window.opener) return;
    if (!window.__showFileVisualizerMirror) {
      window.__showFileVisualizerMirror = {
        fixtures: [],
        fixturePositions: new Map(),
        fixtureManualRot: new Map(),
        gridOn: true,
        houseOn: false,
        workOn: false
      };
    }
    const mirror = window.__showFileVisualizerMirror;
    const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
    const byId = new Map(fixtures.map((fx, index) => [String(fx?.id), index]));
    mirror.fixtures = fixtures;
    mirror.fixturePositions.clear();
    mirror.fixtureManualRot.clear();
    (state?.fixturePositions || []).forEach(saved => {
      const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId)) ? byId.get(String(saved.fixtureId)) : Number(saved?.fixtureIndex);
      const x = Number(saved?.x), y = Number(saved?.y), z = Number(saved?.z);
      if (Number.isInteger(index) && index >= 0 && index < fixtures.length && [x,y,z].every(Number.isFinite)) mirror.fixturePositions.set(index, {x,y,z});
    });
    (state?.fixtureManualRot || []).forEach(saved => {
      const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId)) ? byId.get(String(saved.fixtureId)) : Number(saved?.fixtureIndex);
      const pan = Number(saved?.pan), tilt = Number(saved?.tilt);
      if (Number.isInteger(index) && index >= 0 && index < fixtures.length && [pan,tilt].every(Number.isFinite)) mirror.fixtureManualRot.set(index, {pan,tilt});
    });
    mirror.gridOn = state?.gridOn !== false;
    mirror.houseOn = state?.houseOn !== false;
    mirror.workOn = state?.workOn !== false;
    if (!window.S && !window.VizState) window.S = mirror;
  };

  const sendStateToOpener = () => {
    const state = serialise();
    if (!state || !window.opener || window.opener.closed) return;
    try { window.opener.postMessage({ type: "VISUALIZER_STATE_UPDATE", state }, "*"); } catch (_) {}
  };

  // Visualizer window: receive loaded show positions and report its current state.
  if (window.opener) {
    let pending = null;

    const receive = state => {
      pending = clone(state);
      if (apply(pending)) pending = null;
    };

    window.addEventListener("message", event => {
      if (event.data?.type === "LOAD_VISUALIZER_STATE") receive(event.data.state);
      if (event.data?.type === "REQUEST_VISUALIZER_STATE") sendStateToOpener();
    });

    const retry = () => {
      if (pending && apply(pending)) pending = null;
    };

    window.addEventListener("load", () => {
      try { window.opener.postMessage({ type: "VISUALIZER_READY" }, "*"); } catch (_) {}
      sendStateToOpener();
      setTimeout(retry, 100);
      setTimeout(retry, 500);
      setTimeout(retry, 1500);
    });

    window.addEventListener("beforeunload", sendStateToOpener);
    setInterval(sendStateToOpener, 500);
    setInterval(retry, 100);
    return;
  }

  // Console window: remember the latest visualizer state so showfile.js can
  // include it in snapshotShow() even though the visualizer has its own window.
  window.addEventListener("message", event => {
    if (event.data?.type === "VISUALIZER_STATE_UPDATE" && event.data.state) {
      window.__latestVisualizerState = clone(event.data.state);
      updateConsoleMirror(window.__latestVisualizerState);
      return;
    }

    if (event.data?.type === "VISUALIZER_READY") {
      const saved = window.__loadedShowVisualizerState;
      if (saved) updateConsoleMirror(saved);
      if (saved && event.source) {
        try {
          event.source.postMessage({ type: "LOAD_VISUALIZER_STATE", state: clone(saved) }, "*");
        } catch (_) {}
      }
      try { event.source?.postMessage({ type: "REQUEST_VISUALIZER_STATE" }, "*"); } catch (_) {}
    }
  });

  const installWindowBridge = () => {
    const originalOpen = window.open;
    if (typeof originalOpen === "function" && !originalOpen.__lxShowFileVisualizerFix) {
      const wrappedOpen = function (...args) {
        const child = originalOpen.apply(this, args);
        installChild(child);
        return child;
      };
      wrappedOpen.__lxShowFileVisualizerFix = true;
      wrappedOpen.__lxShowFileVisualizerFixOriginal = originalOpen;
      window.open = wrappedOpen;
    }

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const fn = window.openViz;
      if (typeof fn === "function" && !fn.__lxShowFileVisualizerFix) {
        const wrapped = function (...args) {
          const child = fn.apply(this, args);
          installChild(child);
          return child;
        };
        wrapped.__lxShowFileVisualizerFix = true;
        wrapped.__lxShowFileVisualizerFixOriginal = fn;
        window.openViz = wrapped;
      }
      if (attempts >= 100) clearInterval(timer);
    }, 100);
  };

  const installChild = child => {
    if (!child || child.__lxShowFileVisualizerFixChild) return;
    try { child.__lxShowFileVisualizerFixChild = true; } catch (_) {}
    const inject = () => {
      try {
        if (!child.document?.documentElement) return false;
        if (child.document.getElementById("__lxShowFileVisualizerFixChildScript")) return true;
        const script = child.document.createElement("script");
        script.id = "__lxShowFileVisualizerFixChildScript";
        script.src = new URL("js/showfile-visualizer-fix.js", child.location.href).href;
        child.document.documentElement.appendChild(script);
        return true;
      } catch (_) {
        return false;
      }
    };
    const timer = setInterval(() => { if (inject()) clearInterval(timer); }, 100);
    setTimeout(() => clearInterval(timer), 15000);
  };

  installWindowBridge();

  // Keep the console's cached state fresh even if the visualizer was opened
  // before this patch finished installing.
  window.__lxRequestVisualizerState = () => {
    try {
      for (const name of ["openViz"]) {
        const candidate = window[name];
        if (candidate?.postMessage) candidate.postMessage({ type: "REQUEST_VISUALIZER_STATE" }, "*");
      }
    } catch (_) {}
  };

  window.__lxGetLatestVisualizerState = () => clone(window.__latestVisualizerState || null);
})();
