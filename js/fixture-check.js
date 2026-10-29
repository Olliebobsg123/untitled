// Fixture check: step through the rig one light at a time before a show.
//
// The light being checked goes to full, open white, pointing straight
// (pan/tilt centred), with everything else off, so you can see whether it
// works and where it is. Mark the ones that don't, and when you finish
// every light goes back exactly as it was, with a list of the faulty ones.
//
//   fixture check  /  check fixtures  /  rig check      open it
//   fixture check 12                                    start at fixture 12
//
// Keys while the window has focus: → or Space next, ← back, X not working.
// Hazers and fog machines are listed but never fired.
(function () {
  if (window.LXFixtureCheck) return;
  const S = () => window.State || {};
  const say = (m, l = "ok") => window.log?.(`🔦 ${m}`, l);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const smoke = f => { const m = defOf(f).map || {}; return typeof m.haze === "number" || typeof m.fog === "number"; };
  const moves = f => { const m = defOf(f).map || {}; return typeof m.pan === "number" || typeof m.tilt === "number"; };
  const COLOURS = { white: { hue: 0, sat: 0, light: 100 }, red: { hue: 0, sat: 100, light: 50 }, green: { hue: 120, sat: 100, light: 50 }, blue: { hue: 240, sat: 100, light: 50 } };

  let run = null;   // { list, index, saved, faulty:Set, colour, auto, moveTimer }
  let body = null;

  const fixtures = () => (S().fixtures || []).filter(Boolean).slice().sort((a, b) => (Number(a.fixtureNumber) || 0) - (Number(b.fixtureNumber) || 0));
  const where = f => {
    const base = typeof window.getFixtureBaseAddress === "function" ? window.getFixtureBaseAddress(f) : -1;
    return f.addr == null || base < 0 ? "not patched" : `universe ${Number(f.uni) || 1} · address ${f.addr}`;
  };

  function output() {
    try { window.updateDMX?.(); } catch (e) { console.warn("[CHECK]", e); }
    try { window.sendToVisualizer?.(); } catch (_) {}
  }

  // Everything off, then the light being checked in the test look.
  function show() {
    if (!run) return;
    clearInterval(run.moveTimer); run.moveTimer = null;
    const f = run.list[run.index];
    for (const other of run.list) {
      const st = window.ensureFixtureState?.(other.id);
      if (st) st.intensity = 0;
    }
    if (f && !smoke(f)) {
      const st = window.ensureFixtureState?.(f.id);
      if (st) Object.assign(st, window.DEFAULT_FIXTURE_STATE || {}, COLOURS[run.colour] || COLOURS.white, { intensity: 100, master: 100 });
    }
    output();
    render();
  }

  function start(fromNumber) {
    const list = fixtures();
    if (!list.length) return say("No fixtures patched yet — nothing to check", "warn");
    if (!run) {
      window.finishFade?.();
      if ((S().effects || []).length) { window.stopEffect?.(true, false); say("Effects stopped for the fixture check", "info"); }
      window.stopChase?.();
      // A copy of every light as it is now, to put back at the end.
      const saved = new Map();
      for (const f of list) { const st = window.ensureFixtureState?.(f.id); if (st) saved.set(f.id, JSON.parse(JSON.stringify(st))); }
      run = { list, index: 0, saved, faulty: new Set(), colour: "white", auto: 0, autoTimer: null, moveTimer: null };
      if (S().blackout) say("Blackout is on — press BLACKOUT to see the lights during the check", "warn");
      if (window.getConsoleMode?.() === "BLIND") say("The console is in BLIND — switch to LIVE to see the lights during the check", "warn");
    }
    if (fromNumber != null) {
      const i = run.list.findIndex(f => Number(f.fixtureNumber) === Number(fromNumber));
      if (i < 0) say(`There's no fixture ${fromNumber} — starting at the first`, "warn"); else run.index = i;
    }
    window.LXWindows?.open("fixturecheck");
    show();
  }

  function step(by) {
    if (!run) return;
    const n = run.list.length;
    if (by > 0 && run.index === n - 1 && !run.auto) return render(true);
    run.index = (run.index + by + n) % n;
    show();
  }

  function setColour(name) { if (!run) return; run.colour = name; show(); }

  // Swing a moving light left-right then up-down, to check it moves.
  function wiggle() {
    if (!run) return;
    const f = run.list[run.index];
    if (!moves(f)) return say(`#${f.fixtureNumber} doesn't move`, "info");
    const st = window.ensureFixtureState?.(f.id);
    if (!st) return;
    const path = [[88, 128], [168, 128], [128, 128], [128, 88], [128, 168], [128, 128]];
    let i = 0;
    clearInterval(run.moveTimer);
    run.moveTimer = setInterval(() => {
      if (!run || run.list[run.index] !== f || i >= path.length) { clearInterval(run?.moveTimer); if (run) run.moveTimer = null; return; }
      [st.pan, st.tilt] = path[i++];
      output();
    }, 700);
  }

  function toggleFault() {
    if (!run) return;
    const id = run.list[run.index].id;
    if (run.faulty.has(id)) run.faulty.delete(id); else run.faulty.add(id);
    render();
  }

  function setAuto(seconds) {
    if (!run) return;
    run.auto = seconds;
    clearInterval(run.autoTimer); run.autoTimer = null;
    if (seconds > 0) run.autoTimer = setInterval(() => step(1), seconds * 1000);
    render();
  }

  // Put every light back as it was, with a short fade, and report.
  function finish(fromClose = false) {
    if (!run) return;
    const r = run; run = null;
    clearInterval(r.autoTimer); clearInterval(r.moveTimer);
    const targets = [];
    for (const [id, was] of r.saved) {
      const st = window.ensureFixtureState?.(id);
      if (st) targets.push([id, { ...st, ...was }]);
    }
    if (typeof window.fadeTo === "function" && targets.length) { window.finishFade?.(); window.fadeTo({}, 400, targets); }
    else { for (const [id, was] of targets) Object.assign(window.ensureFixtureState(id), was); output(); }
    const bad = r.list.filter(f => r.faulty.has(f.id));
    if (bad.length) say(`Fixture check done: ${r.list.length - bad.length} OK, ${bad.length} not working — ${bad.map(f => `#${f.fixtureNumber} ${f.name || ""}`.trim()).join(", ")}`, "warn");
    else say(`Fixture check done: all ${r.list.length} marked OK. Lights put back as they were.`);
    if (!fromClose) window.LXWindows?.close("fixturecheck");
    body = null;
  }

  // ------------------------------------------------------------ window

  function render(atEnd = false) {
    if (!body) return;
    if (!run) { body.innerHTML = `<div class="fxc"><p class="fxc-note">Steps through every light one at a time — full, open white, pointing straight — with everything else off.</p><div class="fxc-row"><button type="button" class="btn-primary" data-fxc="start">Start the check</button></div></div>`; return; }
    const f = run.list[run.index];
    const bad = run.faulty.has(f.id);
    const faultyList = run.list.filter(x => run.faulty.has(x.id));
    body.innerHTML = `
      <div class="fxc">
        <div class="fxc-head">
          <div class="fxc-num">#${esc(f.fixtureNumber)}</div>
          <div class="fxc-info"><b>${esc(f.name || "Fixture")}</b><span>${esc(where(f))}</span><span>${run.index + 1} of ${run.list.length}${smoke(f) ? " · hazer / fog machine — not fired" : ""}</span></div>
          <div class="fxc-state ${bad ? "bad" : ""}">${bad ? "✗ NOT WORKING" : ""}</div>
        </div>
        ${atEnd ? `<p class="fxc-note">That's the last light. Press <b>Finish</b> to put everything back, or ← to go back.</p>` : ""}
        <div class="fxc-row">
          <button type="button" class="btn-secondary" data-fxc="back">◀ Back</button>
          <button type="button" class="btn-primary fxc-next" data-fxc="next">Next ▶</button>
          <button type="button" class="btn-secondary ${bad ? "fxc-on" : ""}" data-fxc="fault" title="X">✗ Not working</button>
        </div>
        <div class="fxc-row">
          ${Object.keys(COLOURS).map(c => `<button type="button" class="btn-secondary fxc-col ${run.colour === c ? "fxc-on" : ""}" data-fxc-col="${c}"><i style="background:${c === "white" ? "#fff" : c}"></i>${c[0].toUpperCase() + c.slice(1)}</button>`).join("")}
          ${moves(f) ? `<button type="button" class="btn-secondary" data-fxc="wiggle">↔ Move test</button>` : ""}
        </div>
        <div class="fxc-row">
          <span class="fxc-label">Auto step</span>
          ${[0, 2, 3, 5].map(s => `<button type="button" class="btn-secondary ${run.auto === s ? "fxc-on" : ""}" data-fxc-auto="${s}">${s ? `${s} s` : "Off"}</button>`).join("")}
          <span class="fxc-grow"></span>
          <button type="button" class="btn-primary" data-fxc="finish">Finish</button>
        </div>
        <div class="fxc-faulty">${faultyList.length ? `Not working: ${faultyList.map(x => `#${esc(x.fixtureNumber)}`).join(", ")}` : "Keys: → or Space next · ← back · X not working"}</div>
      </div>`;
  }

  function build(host) {
    body = host;
    host.tabIndex = 0;
    host.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      const a = b.dataset.fxc;
      if (a === "start") start();
      else if (a === "next") step(1);
      else if (a === "back") step(-1);
      else if (a === "fault") toggleFault();
      else if (a === "wiggle") wiggle();
      else if (a === "finish") finish();
      else if (b.dataset.fxcCol) setColour(b.dataset.fxcCol);
      else if (b.dataset.fxcAuto != null) setAuto(Number(b.dataset.fxcAuto));
    });
    host.addEventListener("keydown", e => {
      if (!run || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key.toLowerCase() === "x") { e.preventDefault(); toggleFault(); }
    });
    render();
    setTimeout(() => host.focus?.(), 50);
  }

  function registerWindow() {
    const W = window.LXWindows;
    if (!W) return setTimeout(registerWindow, 300);
    if (!W.list().includes("fixturecheck")) W.register({ id: "fixturecheck", title: "Fixture Check", build, onClose: () => { if (run) finish(true); body = null; }, w: 540, h: 250 });
  }

  // "fixture check", "check fixtures", "rig check", "fixture check 12" on the command line.
  document.addEventListener("keydown", e => {
    const input = e.target;
    if (e.key !== "Enter" || input?.id !== "cmdInput") return;
    const m = String(input.value).trim().toLowerCase().match(/^(?:fixture check|check fixtures|rig check|check rig)(?:\s+(\d+))?$/);
    if (!m) return;
    e.preventDefault(); e.stopImmediatePropagation();
    input.value = "";
    start(m[1] != null ? Number(m[1]) : undefined);
  }, true);

  const style = document.createElement("style");
  style.textContent = `
    .fxc{display:flex;flex-direction:column;gap:10px;padding:4px;font-size:14px;color:var(--text,#dfe7e5);outline:none}
    .fxc-head{display:flex;align-items:center;gap:14px}
    .fxc-num{font:800 34px/1 system-ui;color:#ffd98a;min-width:70px}
    .fxc-info{display:flex;flex-direction:column;gap:2px;min-width:0}
    .fxc-info b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fxc-info span{color:#a4b0b5;font-size:13px}
    .fxc-state{margin-left:auto;font-weight:800;font-size:13px;letter-spacing:.06em}
    .fxc-state.bad{color:#ff98a3}
    .fxc-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .fxc-row button{height:28px;font-size:13px}
    .fxc-next{min-width:110px}
    .fxc-on{border-color:#ffd98a !important;color:#ffd98a !important}
    .fxc-col i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px}
    .fxc-label{color:#a4b0b5;font-size:13px;margin-right:2px}
    .fxc-grow{flex:1}
    .fxc-note{margin:0;color:#b6c3c8}
    .fxc-faulty{color:#a4b0b5;font-size:13px}`;
  document.head.appendChild(style);

  window.LXFixtureCheck = Object.freeze({ start, next: () => step(1), back: () => step(-1), fault: toggleFault, finish, colour: setColour, running: () => Boolean(run), current: () => run?.list[run.index]?.fixtureNumber ?? null, faulty: () => (run ? run.list.filter(f => run.faulty.has(f.id)).map(f => f.fixtureNumber) : []) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", registerWindow, { once: true });
  else registerWindow();
})();
