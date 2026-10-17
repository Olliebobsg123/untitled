"use strict";

// A drop-in for requestAnimationFrame that keeps running when the window is
// minimised or hidden. Browsers pause requestAnimationFrame for hidden
// windows, which froze fades, effects and chases (and so the DMX output)
// mid-way whenever the console was minimised during a show.
(() => {
  if (window.LXClock) return;
  const TICK_MS = 25; // 40 frames a second, matching the DMX output rate
  let nextId = 1;
  let pending = new Map();
  let timer = null;

  function tick() {
    if (!pending.size) {
      clearInterval(timer);
      timer = null;
      return;
    }
    const now = performance.now();
    const due = pending;
    pending = new Map();
    for (const callback of due.values()) {
      try { callback(now); } catch (err) { console.error("[LXClock]", err); }
    }
  }

  window.LXClock = Object.freeze({
    frame(callback) {
      const id = nextId++;
      pending.set(id, callback);
      if (!timer) timer = setInterval(tick, TICK_MS);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    }
  });
})();
