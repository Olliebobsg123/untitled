"use strict";

function updateControlVisibility() {
  const xyPad = document.querySelector('.xy-pad');
  if (!State.selected.size || !xyPad) { if (xyPad) xyPad.style.display = 'none'; return; }
  const f = State.fixtures.find(x => State.selected.has(x.id)); if (!f) return;
  const def = FixtureLibrary[f.name] || { map: {} }; const map = def.map || {};
  xyPad.style.display = (typeof map.pan === 'number' || typeof map.tilt === 'number') ? '' : 'none';
}

// Colour wheel, XY pad, sliders, presets all live in app.js now — this file holds only visibility logic