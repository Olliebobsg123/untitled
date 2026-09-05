"use strict";

/*
 * Visualizer show-load reliability patch.
 *
 * The show data is already stored by showfile.js. This layer only reapplies
 * the saved visualizer state after the visualizer has finished rebuilding its
 * fixture objects, which prevents saved positions from being overwritten by
 * the normal visualizer startup/render cycle.
 */
(function installVisualizerShowLoadFix() {
  const clone = value => {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      try { out[key] = clone(item); } catch (_) {}
    });
    return out;
  };

  const getViz = () => window.S || window.VizState || null;

  const normalise = viz => {
    const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
    const byId = new Map(fixtures.map((fixture, index) => [String(fixture?.id), index]));

    const positions = Array.isArray(viz?.fixturePositions) ? viz.fixturePositions : [];
    const rotations = Array.isArray(viz?.fixtureManualRot) ? viz.fixtureManualRot : [];

    return {
      positions: positions.map(saved => ({
        ...clone(saved),
        fixtureIndex: saved?.fixtureId != null && byId.has(String(saved.fixtureId))
          ? byId.get(String(saved.fixtureId))
          : Number(saved?.fixtureIndex)
      })).filter(saved => Number.isInteger(saved.fixtureIndex) && saved.fixtureIndex >= 0 && saved.fixtureIndex < fixtures.length),
      rotations: rotations.map(saved => ({
        ...clone(saved),
        fixtureIndex: saved?.fixtureId != null && byId.has(String(saved.fixtureId))
          ? byId.get(String(saved.fixtureId))
          : Number(saved?.fixtureIndex)
      })).filter(saved => Number.isInteger(saved.fixtureIndex) && saved.fixtureIndex >= 0 && saved.fixtureIndex < fixtures.length)
    };
  };

  const apply = viz => {
    if (!viz || typeof viz !== "object") return false;
    const Viz = getViz();
    if (!Viz) return false;

    try {
      const { positions, rotations } = normalise(viz);

      if (typeof Viz.applyLoadedPositions === "function") {
        // The visualizer's native loader uses fixtureIndex. Convert saved
        // fixture IDs to the current fixture order before calling it.
        Viz.applyLoadedPositions(clone(positions), clone(rotations));
      } else {
        if (!(Viz.fixturePositions instanceof Map)) Viz.fixturePositions = new Map();
        if (!(Viz.fixtureManualRot instanceof Map)) Viz.fixtureManualRot = new Map();

        Viz.fixturePositions.clear();
        Viz.fixtureManualRot.clear();

        positions.forEach(saved => {
          const x = Number(saved.x);
          const y = Number(saved.y);
          const z = Number(saved.z);
          if ([x, y, z].every(Number.isFinite)) {
            Viz.fixturePositions.set(saved.fixtureIndex, { x, y, z });
          }
        });

        rotations.forEach(saved => {
          const pan = Number(saved.pan);
          const tilt = Number(saved.tilt);
          if ([pan, tilt].every(Number.isFinite)) {
            Viz.fixtureManualRot.set(saved.fixtureIndex, { pan, tilt });
          }
        });

        Viz.rebuildFixtures?.();
      }

      if (Viz.grid) Viz.grid.visible = viz.gridOn !== false;
      return true;
    } catch (error) {
      console.warn("[SHOW] Visualizer position reapply failed:", error);
      return false;
    }
  };

  const retry = viz => {
    let attempts = 0;
    const run = () => {
      attempts++;
      const applied = apply(viz);

      // Do not stop after the first successful apply. The visualizer can
      // rebuild its fixture list immediately after a show load, so reapply
      // for a short window to ensure the saved positions survive that rebuild.
      if (attempts < 20) {
        setTimeout(run, attempts < 5 ? 50 : 100);
      } else if (!applied) {
        console.warn("[SHOW] Visualizer positions could not be restored");
      }
    };
    run();
  };

  document.addEventListener("lx-show-loaded", event => {
    const viz = event.detail?.visualizer;
    if (viz) {
      window.__pendingShowVisualizerState = clone(viz);
      retry(window.__pendingShowVisualizerState);
    }
  });

  window.addEventListener("lx-show-visualizer-ready", () => {
    const pending = window.__pendingShowVisualizerState;
    if (!pending) return;
    retry(pending);
  });

  window.LXShowVisualizerFix = Object.freeze({ apply, retry });
})();
