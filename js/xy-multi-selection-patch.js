"use strict";

// XY pad patch: dragging the dot applies pan/tilt to EVERY currently selected
// fixture.  The pad itself never reacts to ordinary mouse movement/clicks.
(function installXYMultiSelectionPatch(){
  if (window.__xyMultiSelectionPatch) return;
  window.__xyMultiSelectionPatch = true;

  const getSelectedFixtures = () => {
    const state = window.State;
    if (!state || !(state.selected instanceof Set) || !state.selected.size) return [];
    return Array.from(state.selected)
      .map(id => state.fixtures?.find(f => String(f?.id) === String(id)))
      .filter(Boolean);
  };

  const getFixtureState = fixture => {
    if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
    if (!(window.State.fixtureStates instanceof Map)) window.State.fixtureStates = new Map();
    if (!window.State.fixtureStates.has(fixture.id)) {
      window.State.fixtureStates.set(fixture.id, { ...(window.State.current || {}), pan: 128, tilt: 128 });
    }
    return window.State.fixtureStates.get(fixture.id);
  };

  const supportsPanTilt = fixture => {
    const def = typeof window.getFixtureDefinition === "function"
      ? window.getFixtureDefinition(fixture)
      : window.FixtureLibrary?.[fixture?.name];
    const map = def?.map || fixture?.map || {};
    return typeof map.pan === "number" || typeof map.tilt === "number";
  };

  const position = (pad, e) => {
    const r = pad.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = Number(e.clientX), y = Number(e.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return {
      pan: Math.round(Math.max(0, Math.min(1, (x-r.left)/r.width)) * 255),
      tilt: Math.round((1-Math.max(0, Math.min(1, (y-r.top)/r.height))) * 255)
    };
  };

  function attach(){
    const pad = document.querySelector('.xy-pad');
    const dot = document.getElementById('xy');
    if (!pad || !dot || pad.dataset.xyMultiPatch === '1') return;
    pad.dataset.xyMultiPatch = '1';
    dot.style.pointerEvents = 'auto';
    pad.style.touchAction = 'none';

    let dragging = false;
    let pointerId = null;

    const apply = e => {
      const p = position(pad,e);
      if (!p) return;
      const fixtures = getSelectedFixtures();
      if (!fixtures.length) return;

      let changed = 0;
      for (const fixture of fixtures) {
        if (!supportsPanTilt(fixture)) continue;
        const s = getFixtureState(fixture);
        if (!s) continue;
        s.pan = p.pan;
        s.tilt = p.tilt;
        window.State.fixtureStates.set(fixture.id,s);
        changed++;
      }
      if (!changed) return;

      window.State.current ||= {};
      window.State.current.pan = p.pan;
      window.State.current.tilt = p.tilt;
      dot.style.left = `${p.pan/255*100}%`;
      dot.style.top = `${(1-p.tilt/255)*100}%`;
      window.updateDMX?.();
      window.sendToVisualizer?.();
    };

    pad.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      // ONLY the dot starts a drag. Clicking the grid does nothing.
      if (!(e.target === dot || e.target.closest?.('#xy') === dot)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dragging = true;
      pointerId = e.pointerId;
      try { pad.setPointerCapture(pointerId); } catch (_) {}
      apply(e);
    }, true);

    pad.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pointerId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      apply(e);
    }, true);

    const stop = e => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      dragging = false;
      try { if (pointerId !== null) pad.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
    };
    pad.addEventListener('pointerup', stop, true);
    pad.addEventListener('pointercancel', stop, true);
    pad.addEventListener('lostpointercapture', () => { dragging=false; pointerId=null; }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, {once:true});
  else attach();
  window.addEventListener('load', attach, {once:true});
})();
