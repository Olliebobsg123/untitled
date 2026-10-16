"use strict";

// The console's clock. Fades, effects and chases step on this rather than on the
// screen's frame rate (requestAnimationFrame), which macOS stops for a window
// that is minimised or hidden behind another one: a fade must finish whether or
// not anyone is looking at it.
//
//   const id = LXClock.frame(now => { ... });   // once, on the next tick (like requestAnimationFrame)
//   LXClock.cancel(id);
(() => {
  const TICK_MS = 25; // 40 steps a second, the same rate the DMX output runs at
  const waiting = new Map();
  let nextId = 1;
  let timer = null;

  function tick() {
    const now = performance.now();
    const due = [...waiting.values()];
    waiting.clear();
    for (const callback of due) {
      try { callback(now); } catch (err) { console.error("[CLOCK]", err); }
    }
    if (!waiting.size) { clearInterval(timer); timer = null; }
  }

  window.LXClock = Object.freeze({
    frame(callback) {
      const id = nextId++;
      waiting.set(id, callback);
      if (!timer) timer = setInterval(tick, TICK_MS);
      return id;
    },
    cancel(id) {
      if (id != null) waiting.delete(id);
    }
  });
})();
