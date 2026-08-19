"use strict";

// ✅ Define these properly — use global State values or set defaults
// (We read live from State inside functions so changes take effect instantly)

window.renderChases = function() {
  const list = document.getElementById('chaseList');
  if (!list) return; 
  list.innerHTML = '';
  if (!Array.isArray(State.chases)) State.chases = [];
  State.chases.forEach((ch, i) => {
    if (!ch) return;
    const el = document.createElement('div');
    el.className = `cue-item ${i === State.currentChase ? 'active' : ''}`;
    const stepCount = Array.isArray(ch.steps) ? ch.steps.length : 0;
    el.innerHTML = `<strong>${i + 1}. ${ch.name || `Chase ${i + 1}`}</strong><div style="font-size:11px;color:var(--text-muted);">${stepCount} steps · ${ch.loop ? '🔁 Loop' : '→ Run once'}</div>`;
    el.addEventListener('click', e => { 
      e.preventDefault(); 
      log(`Chase ${i + 1}: ${ch.name || `Chase ${i + 1}`} — ${stepCount} steps`); 
    });
    list.appendChild(el);
  });
};

window.startChase = function(idx) {
  stopChase(false);
  const ch = State.chases[idx];
  if (!ch || !Array.isArray(ch.steps) || !ch.steps.length) { 
    log('Chase empty or missing', 'warn'); 
    return; 
  }
  State.currentChase = idx;
  let step = 0;

  // ✅ READ LIVE EVERY RUN — so changing values mid‑chase works
  const currentFade = State.chaseFade ?? 800;
  const currentWait = State.chaseWait ?? 500;

  function run() {
    if (State.currentChase !== idx) return;
    const cueIdx = ch.steps[step];
    if (State.cues[cueIdx]) {
      const target = { ...State.current, ...State.cues[cueIdx].state };

      // ✅ 0 FADE = COMPLETELY SKIP FADE ENGINE — INSTANT SNAP ONLY
      if (currentFade <= 0) {
        // Kill any stray running fade
        if (State.fading) cancelAnimationFrame(State.fading);
        State.fading = null;

        // DIRECT HARD APPLY — NO ANIMATION, NO BLENDING
        Object.assign(State.current, target);
        State.fixtures.forEach(f => {
          State.fixtureStates.set(f.id, { ...State.current });
        });
        updateDMX();
        if (typeof syncCueControls === 'function') syncCueControls(target);
      } else {
        // Only use smooth fade when explicitly wanted
        fadeTo(target, currentFade);
        if (typeof syncCueControls === 'function') syncCueControls(target);
      }

      State.currentCue = cueIdx;
      renderCues();
      log(`Chase ${idx + 1} Step ${step + 1}: Cue ${cueIdx + 1}`);
    }

    step++;
    if (step >= ch.steps.length) { 
      if (ch.loop) step = 0; 
      else { stopChase(); return; } 
    }

    // Hold time — works fast or slow with no fade fighting
    State.chaseTimer = setTimeout(run, currentWait);
  }

  run(); 
  renderChases();
  log(`▶ Started Chase ${idx + 1}: ${ch.name || `Chase ${idx + 1}`} — ${currentFade <=0 ? 'INSTANT JUMP MODE' : `smooth ${currentFade}ms fade`}`);
};

window.stopChase = function(writeLog = true) {
  if (State.chaseTimer) clearTimeout(State.chaseTimer);
  State.chaseTimer = null; 
  State.currentChase = -1;
  renderChases();
  if (writeLog) log('⏹ Chase stopped');
};

window.saveChase = function(name, cueIndices, loop = true) {
  if (!Array.isArray(State.chases)) State.chases = [];
  if (!Array.isArray(cueIndices)) cueIndices = [];
  const steps = cueIndices.map(i => Number(i) - 1).filter(i => Number.isInteger(i) && State.cues[i]);
  if (!steps.length) { 
    log('No valid cues selected for chase', 'warn'); 
    return false; 
  }
  const chaseName = String(name || '').trim() || `Chase ${State.chases.length + 1}`;
  State.chases.push({ name: chaseName, steps, loop: !!loop });
  renderChases();
  log(`✅ Saved Chase: ${chaseName} (${steps.length} steps)`, 'ok');
  return true;
};