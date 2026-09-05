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

  const apply = viz => {
    if (!viz || typeof viz !== "object") return false;
    const Viz = getViz();
    if (!Viz) return false;

    const positions = Array.isArray(viz.fixturePositions) ? viz.fixturePositions : [];
    const rotations = Array.isArray(viz.fixtureManualRot) ? viz.fixtureManualRot : [];

    try {
      if (typeof Viz.applyLoadedPositions === "function") {
        Viz.applyLoadedPositions(clone(positions), clone(rotations));
      } else {
        if (!(Viz.fixturePositions instanceof Map)) Viz.fixturePositions = new Map();
        if (!(Viz.fixtureManualRot instanceof Map)) Viz.fixtureManualRot = new Map();

        const fixtures = Array.isArray(window.State?.fixtures) ? window.State.fixtures : [];
        const byId = new Map(fixtures.map((fixture, index) => [String(fixture?.id), index]));

        Viz.fixturePositions.clear();
        Viz.fixtureManualRot.clear();

        positions.forEach(saved => {
          const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId))
            ? byId.get(String(saved.fixtureId))
            : Number(saved?.fixtureIndex);
          if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) return;

          const x = Number(saved.x);
          const y = Number(saved.y);
          const z = Number(saved.z);
          if ([x, y, z].every(Number.isFinite)) {
            Viz.fixturePositions.set(index, { x, y, z });
          }
        });

        rotations.forEach(saved => {
          const index = saved?.fixtureId != null && byId.has(String(saved.fixtureId))
            ? byId.get(String(saved.fixtureId))
            : Number(saved?.fixtureIndex);
          if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) return;

          const pan = Number(saved.pan);
          const tilt = Number(saved.tilt);
          if ([pan, tilt].every(Number.isFinite)) {
            Viz.fixtureManualRot.set(index, { pan, tilt });
          }
        });

        Viz.rebuildFixtures?.();
      }

      if (Viz.grid) Viz.grid.visible = viz.gridOn !== false;
      if (Viz.house) Viz.house.visible = viz.houseOn === true;
      if (Viz.work) Viz.work.visible = viz.workOn === true;
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
      if (apply(viz) || attempts >= 30) return;
      setTimeout(run, 100);
    };
    run();
  };

  document.addEventListener("lx-show-loaded", event => {
    const viz = event.detail?.visualizer;
    if (viz) retry(viz);
  });

  window.addEventListener("lx-show-visualizer-ready", () => {
    const pending = window.__pendingShowVisualizerState;
    if (!pending) return;
    delete window.__pendingShowVisualizerState;
    retry(pending);
  });

  window.LXShowVisualizerFix = Object.freeze({ apply, retry });
})();
