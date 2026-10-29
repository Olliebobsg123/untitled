"use strict";

/*
 * Multi-console: run Light Spark on several computers as one desk.
 *
 *   PRIMARY   the main desk. It has the show and drives the lights.
 *   BACKUP    follows the primary exactly (show, cue, fades, effects) with
 *             its output held. If the primary stops answering for the
 *             take-over time it takes over the lights from the same place —
 *             or press Take over. The primary can take control back.
 *   CLIENT    a second programming station: everything is live and
 *             editable, and GO / chases / effects run on the primary.
 *   MIRROR    view only: shows what the primary is doing (e.g. for a
 *             designer at the tech table). Nothing can be changed.
 *   STANDALONE  just this computer (the default).
 *
 * Choose on the start screen or in Preferences → Multi-Console.
 *
 * How it works: whichever console is IN CONTROL (the primary, or a backup
 * that took over) sends the show when it changes and the live state ~25
 * times a second; the others apply it. Clients send their edits and
 * playback requests to the primary, which passes them to whoever is in
 * control. The network part is session-link.js in the main process.
 *
 *   LXSession.role()  .inControl()  .takeOver()  .handBack()  .status()
 */
(function () {
  if (window.LXSession) return;
  const link = window.LXSessionLink;
  const S = () => window.State;
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;
  const say = (m, l = "info") => window.log?.(`🖧 ${m}`, l);
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NAMES = { standalone: "Standalone", primary: "Primary", backup: "Backup", client: "Client", mirror: "Mirror" };

  let role = "standalone";       // what this console is
  let inControl = true;          // drives the lights and the show
  let controller = "self";       // primary only: "self" or the peer id in control
  let started = false;
  let info = {};                 // from session-link.js
  let joined = false;            // got the show from the primary
  let lastFromController = 0;    // when the in-control console was last heard
  let lastLive = null;           // the last live frame applied (for take-over)
  let startedAt = 0;

  // ------------------------------------------------------------ output

  function holdOutput(hold) {
    window.__lxOutputHeld = Boolean(hold);
    try { window.__refreshOutputMode?.(); } catch (_) {}
    document.documentElement.dataset.sessionHeld = hold ? "on" : "off";
  }

  // --------------------------------------------------------- show sync

  const PARTS = ["fixtures", "groups", "cues", "chases", "savedEffects", "palettes", "targets", "visualizer", "effectTargetMode", "effectTargetIds"];
  const synced = {};             // part -> JSON last sent or received
  let applying = false;          // applying incoming data: don't echo it back

  function snapshotParts() {
    const snap = window.LXShowCommands?.snapshot?.();
    if (!snap) return null;
    const out = {};
    for (const p of PARTS) out[p] = snap[p];
    // Tracked cues' looks are rebuilt from the list, so the list is enough.
    return out;
  }

  function sendShow(force = false, to = null) {
    const parts = snapshotParts();
    if (!parts) return;
    const changed = {};
    for (const p of PARTS) {
      const text = JSON.stringify(parts[p] ?? null);
      if (force || text !== synced[p]) { changed[p] = parts[p]; synced[p] = text; }
    }
    if (Object.keys(changed).length) link.send({ type: "show", parts: changed }, to);
  }

  function applyShow(parts) {
    const s = S();
    applying = true;
    try {
      for (const [p, value] of Object.entries(parts || {})) {
        synced[p] = JSON.stringify(value ?? null);
        if (p === "fixtures") { s.fixtures = Array.isArray(value) ? value : []; try { window.initFixtureStates?.(); window.renderFixtures?.(); } catch (_) {} }
        else if (p === "groups") { s.groups = value || []; window.renderGroups?.(); }
        else if (p === "cues") { s.cues = value || []; window.LXTracking?.remember?.(); window.renderCues?.(); window.updateInspectorList?.(); }
        else if (p === "chases") { s.chases = value || []; window.renderChases?.(); }
        else if (p === "savedEffects") { s.savedEffects = value || {}; window.renderEffectsList?.(); }
        else if (p === "palettes") { s.palettes = value || []; window.Palettes?.refresh?.(); }
        else if (p === "targets") { s.targets = value || []; window.Targets?.refresh?.(); }
        else if (p === "visualizer") { if (value) s.visualizer = value; }
        else if (p === "effectTargetMode") s.effectTargetMode = value || "selected";
        else if (p === "effectTargetIds") s.effectTargetIds = new Set(Array.isArray(value) ? value : []);
      }
    } finally { applying = false; }
  }

  // --------------------------------------------------------- live sync

  const sentStates = new Map();  // id -> JSON last sent (controller)
  let sentKey = "", lastBeat = 0;
  let fadeInfo = null;           // { index, start, fade } of the cue fading in

  // 2 decimal places is far finer than DMX, and keeps updates small on Wi-Fi.
  const round = (k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v);
  function sendLive(force = false) {
    const s = S();
    if (!s?.fixtureStates) return;
    const states = [];
    s.fixtureStates.forEach((st, id) => {
      const text = JSON.stringify(st, round);
      if (force || sentStates.get(id) !== text) { states.push([id, JSON.parse(text)]); sentStates.set(id, text); }
    });
    const head = {
      current: s.current || {}, currentCue: s.currentCue ?? -1, nextCue: s.nextCue ?? null, currentChase: s.currentChase ?? -1,
      activeEffect: s.activeEffect ? { ...s.activeEffect } : null, blackout: Boolean(s.blackout),
      effects: (s.effects || []).map(e => ({ id: e.id, type: e.type, name: e.name, speed: e.speed, fixtureIds: e.ids instanceof Set ? [...e.ids] : e.fixtureIds || [], levels: e.levels instanceof Map ? Object.fromEntries(e.levels) : e.levels || {} })),
      fade: fadeInfo && performance.now() - fadeInfo.start < fadeInfo.fade ? { index: fadeInfo.index, left: fadeInfo.fade - (performance.now() - fadeInfo.start) } : null,
      tc: window.LXTimecode?.now?.() ?? null,
      view: viewState()
    };
    const key = JSON.stringify(head);
    const now = performance.now();
    if (!states.length && key === sentKey && !force && now - lastBeat < 300) return;
    sentKey = key; lastBeat = now;
    link.send({ type: "live", states, ...head, full: force });
  }

  // What the operator sees on the console in control: the selection, the
  // page and the floating windows. Mirrors copy it.
  function viewState() {
    const s = S(), W = window.LXWindows;
    const iw = window.innerWidth || 1, ih = window.innerHeight || 1;
    return {
      selected: [...(s.selected || [])], selectedId: s.selectedFixtureId ?? null,
      page: document.querySelector(".nav-link.active[data-page]")?.dataset.page || null,
      pages: window.LXCustomPages?.list?.() || [],
      windows: (W?.floating?.() || []).filter(id => id !== "prefs").map(id => {
        const r = W.rectOf(id);
        return [id, r ? [r.x / iw, r.y / ih, r.w / iw, r.h / ih].map(v => Math.round(v * 1000) / 1000) : null];
      })
    };
  }

  // Each part is only applied when the console in control changes it, so a
  // mirror can still look around between changes.
  const shownView = {};
  function applyView(view) {
    if (!view || role !== "mirror") return;
    const s = S(), W = window.LXWindows;
    const changed = key => { const text = JSON.stringify(view[key] ?? null); if (shownView[key] === text) return false; shownView[key] = text; return true; };
    try {
      if (changed("selected") | changed("selectedId")) {
        s.selected = new Set(view.selected || []);
        if (view.selectedId != null) s.selectedFixtureId = view.selectedId;
        window.renderFixtures?.();
      }
      if (changed("pages")) { window.LXCustomPages?.adopt?.(view.pages || []); shownView.page = null; }
      if (changed("page") && view.page) {
        const custom = /^custom-(.+)$/.exec(view.page);
        if (custom) window.LXCustomPages?.show?.(custom[1]);
        else document.querySelector(`.nav-link[data-page="${CSS.escape(view.page)}"]`)?.click();
      }
      if (changed("windows") && W) {
        const want = new Map(view.windows || []);
        for (const id of W.floating?.() || []) if (id !== "prefs" && !want.has(id)) W.close(id);
        const iw = window.innerWidth, ih = window.innerHeight;
        for (const [id, f] of want) {
          if (!W.isOpen(id) || W.hostOf(id)) W.open(id, { quiet: true });
          if (f) W.place(id, { x: f[0] * iw, y: f[1] * ih, w: f[2] * iw, h: f[3] * ih });
        }
      }
    } catch (e) { console.warn("[SESSION] mirror view", e); }
  }

  // Client: what the primary last said for each light, so local changes show up as differences.
  const applied = new Map();     // id -> state object as applied
  const touched = new Map();     // id -> { key: when changed here }

  function applyLive(msg) {
    const s = S();
    if (!s) return;
    lastFromController = performance.now();
    lastLive = msg;
    const now = performance.now();
    for (const [id, st] of msg.states || []) {
      let next = st;
      const mine = touched.get(id);
      if (mine) {
        // Keep values changed here a moment ago, until the primary has them.
        next = { ...st };
        for (const [k, at] of Object.entries(mine)) if (now - at < 600) next[k] = s.fixtureStates.get(id)?.[k];
      }
      s.fixtureStates.set(id, { ...next });
      applied.set(id, { ...next });
    }
    s.current = { ...(msg.current || {}) };
    const cueChanged = s.currentCue !== msg.currentCue;
    s.currentCue = msg.currentCue;
    s.nextCue = msg.nextCue;
    s.currentChase = msg.currentChase;
    s.activeEffect = msg.activeEffect;
    // What's running on the console in control (shown here; it runs there).
    s.effects = (msg.effects || []).map(e => ({ ...e, ids: new Set(e.fixtureIds || []), levels: new Map(Object.entries(e.levels || {})) }));
    window.renderRunningEffects?.();
    s.blackout = msg.blackout;
    applyView(msg.view);
    try { window.updateDMX?.(); window.sendToVisualizer?.(); } catch (_) {}
    if (cueChanged) window.renderCues?.();
  }

  // Client: send what's been changed here.
  function sendLocalChanges() {
    const s = S();
    if (!s?.fixtureStates || !joined) return;
    const out = [];
    const now = performance.now();
    s.fixtureStates.forEach((st, id) => {
      const was = applied.get(id);
      if (!was) return;
      const part = {};
      for (const k of Object.keys(st)) {
        const a = st[k], b = was[k];
        if (typeof a === "number" ? !(typeof b === "number" && Math.abs(a - b) < 1e-6) : JSON.stringify(a) !== JSON.stringify(b)) part[k] = a;
      }
      if (Object.keys(part).length) {
        out.push([id, part]);
        applied.set(id, { ...was, ...part });
        const t = touched.get(id) || {};
        for (const k of Object.keys(part)) t[k] = now;
        touched.set(id, t);
      }
    });
    if (out.length) link.send({ type: "states", states: out });
    if (s.nextCue !== (lastLive?.nextCue ?? null) && s.nextCue !== sentNext) { sentNext = s.nextCue; link.send({ type: "next", value: s.nextCue }); }
  }
  let sentNext;

  // ----------------------------------------------- playback: who runs it

  // Map/Set don't survive JSON: pack them.
  const pack = v => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Map ? { __map: [...x] } : x instanceof Set ? { __set: [...x] } : x)));
  const unpack = v => JSON.parse(JSON.stringify(v), (k, x) => (x && typeof x === "object" && x.__map ? new Map(x.__map) : x && typeof x === "object" && x.__set ? new Set(x.__set) : x));

  const PLAYBACK = ["goToCue", "goNextCue", "goPreviousCue", "startChase", "stopChase", "applySavedEffect", "startEffect", "stopEffect", "clearProgrammer", "consoleBlackout", "emergencyWhite"];
  const EDITS = ["recordCue", "updateCue", "deleteCue", "recordNextCue", "saveChase", "recordSnapshotChase", "fadeTo"];
  const originals = {};
  let warned = 0;
  const viewOnly = () => role === "mirror" || (role === "backup" && !inControl);
  // Edits and playback go to whoever is in control (a client, or a primary a backup took over from).
  const forwards = () => role === "client" || (role === "primary" && !inControl);
  // This console runs cues itself (MSC and timecode check this too).
  const drives = () => role === "standalone" || (inControl && (role === "primary" || role === "backup"));

  function blocked(name) {
    if (Date.now() - warned > 1500) {
      warned = Date.now();
      say(role === "mirror" ? "This is a mirror — it only shows what the primary is doing" : "This is the backup — it follows the primary. Take over to run the show from here.", "warn");
    }
    return false;
  }

  function wrapAll() {
    for (const name of [...PLAYBACK, ...EDITS]) {
      const fn = window[name];
      if (typeof fn !== "function" || fn.__lxSession) continue;
      originals[name] = fn;
      const wrapped = function (...args) {
        if (role === "standalone" || inControl && role !== "client") return fn.apply(this, args);
        if (viewOnly()) return blocked(name);
        if (forwards() && PLAYBACK.includes(name)) {
          link.send({ type: "call", fn: name, args: pack(args), selected: [...(S().selected || [])] }, role === "primary" ? controller : null);
          return true;
        }
        return fn.apply(this, args); // a client's edits run here; the show change is sent on
      };
      Object.assign(wrapped, fn);
      wrapped.__lxSession = true;
      window[name] = wrapped;
    }
    // Remember where a cue fade is, so a backup can finish it.
    const go = window.goToCue;
    if (typeof go === "function" && !go.__lxSessionFade) {
      const wrapped = function (index, forceFade = null) {
        const r = go.apply(this, arguments);
        const cue = S().cues?.[index];
        if (r && cue && inControl) fadeInfo = { index: Number(index), start: performance.now(), fade: forceFade != null ? Number(forceFade) : Number(cue.fade ?? 800) };
        return r;
      };
      Object.assign(wrapped, go);
      wrapped.__lxSessionFade = true;
      window.goToCue = wrapped;
    }
  }

  // The in-control console runs a playback request from a client.
  function runCall(msg) {
    const fn = originals[msg.fn] || window[msg.fn];
    if (!PLAYBACK.includes(msg.fn) || typeof fn !== "function") return;
    const s = S();
    const keep = s.selected;
    if (Array.isArray(msg.selected)) s.selected = new Set(msg.selected);
    try { fn.apply(window, unpack(msg.args || [])); }
    catch (e) { console.warn("[SESSION] call failed", msg.fn, e); }
    finally { s.selected = keep; }
  }

  // Edits from a client: levels, colours… and the next cue.
  function applyStates(states) {
    const s = S();
    for (const [id, part] of states || []) {
      const st = window.ensureFixtureState?.(id) || s.fixtureStates.get(id);
      if (st) Object.assign(st, part);
    }
    window.LXFixtureInfo?.act("manual", "Client console", "changed on another computer", 600, (states || []).map(x => x[0]));
    try { window.updateDMX?.(); window.sendToVisualizer?.(); } catch (_) {}
  }

  // ------------------------------------------------------ take-over etc.

  function stopEnginesQuietly() {
    try { (originals.stopEffect || window.stopEffect)?.(true); } catch (_) {}
    try { (originals.stopChase || window.stopChase)?.(false); } catch (_) {}
    try { window.stopCueTimers?.(); } catch (_) {}
  }

  // Carry on from where the last console left off.
  function resume(from) {
    const live = from || lastLive;
    if (!live) return;
    const s = S();
    try {
      if (live.fade && S().cues?.[live.fade.index]) (originals.goToCue || window.goToCue)(live.fade.index, Math.max(0, live.fade.left));
      if (live.currentChase >= 0 && s.chases?.[live.currentChase]) (originals.startChase || window.startChase)(live.currentChase);
      const effects = live.effects?.length ? live.effects : live.activeEffect?.type ? [live.activeEffect] : [];
      s.effects = [];
      for (const e of effects) (originals.startEffect || window.startEffect)(e.type, { ...e, fixtureMode: "custom", fixtureIds: e.fixtureIds });
      if (!effects.length && s.currentCue >= 0) window.startCueEffectIfNeeded?.(s.cues[s.currentCue]);
    } catch (e) { console.warn("[SESSION] resume failed", e); }
  }

  function setControl(on, why) {
    // Following again: the console in control gets a full take-over window
    // from now, not from when it was last heard (maybe before it crashed).
    if (inControl && !on) lastFromController = performance.now();
    if (inControl && !on) window.LXScreenMirror?.stopAll();
    inControl = Boolean(on);
    link.setInControl(inControl);
    holdOutput(!inControl || role === "client" || role === "mirror");
    renderBadge();
    renderPanel();
    if (why) say(why, inControl ? "ok" : "info");
  }

  function takeOver(reason = "by hand") {
    if (role !== "backup" || inControl) return false;
    setControl(true, `Backup took over the lights (${reason}) — this console is running the show`);
    link.send({ type: "control", inControl: true });
    resume();
    sendShow(true);
    sendLive(true);
    return true;
  }

  // On the backup: the primary wants control back.
  function release() {
    if (!inControl || role !== "backup") return;
    stopEnginesQuietly();
    sendLive(true);
    setControl(false, "The primary took control back — this backup is following again");
    link.send({ type: "control", inControl: false });
  }

  // On the primary: ask the backup that took over to give control back.
  function handBack() {
    if (role !== "primary" || controller === "self") return false;
    link.send({ type: "handback" }, controller);
    say("Asking the backup to hand control back…");
    return true;
  }

  // ---------------------------------------------------------- messages

  function onMessage(from, msg) {
    if (!msg || typeof msg !== "object") return;
    if (role === "primary") return primaryMessage(from, msg);
    peerMessage(msg);
  }

  function primaryMessage(from, msg) {
    switch (msg.type) {
      case "joined":
        say(`${NAMES[msg.role] || msg.role} “${msg.name}” connected`, "ok");
        if (msg.inControl) {
          controller = from; stopEnginesQuietly();
          joined = false; // wait for its show before sending anything
          setControl(false, `Backup “${msg.name}” is running the show — press Take control back when you're ready`);
          link.send({ type: "show-request" }, from); // we've just started: get the show from it
        }
        else { sendShow(true, from); if (controller === "self") sendLive(true); else link.send({ type: "show-request" }, controller); }
        renderPanel();
        return;
      case "left": {
        const wasController = controller === from;
        say(`A console disconnected${wasController ? " — it was running the show, so this primary takes over again" : ""}`, wasController ? "warn" : "info");
        if (wasController) { controller = "self"; setControl(true); resume(); link.send({ type: "rtc-again" }); }
        renderPanel();
        return;
      }
      case "control":
        link.send({ type: "rtc-again" }, null, from); // mirrors: the picture comes from someone else now
        if (msg.inControl) { controller = from; stopEnginesQuietly(); setControl(false, "A backup took over the lights — this primary is following it now"); joined = true; }
        else if (controller === from) { controller = "self"; setControl(true, "Control is back on this primary"); resume(); sendLive(true); }
        return;
      case "show":
        applyShow(msg.parts);
        if (from === controller) joined = true;
        link.send(msg, null, from);           // everyone else gets it too
        return;
      case "live":
        if (from === controller) { applyLive(msg); link.send(msg, null, from); }
        return;
      case "rtc":
      case "rtc-want":
        // Screen mirror set-up: between a mirror and the console in control.
        if (from === controller && msg.peer) { const { peer, ...rest } = msg; link.send(rest, peer); }
        else if (controller === "self") window.LXScreenMirror?.onSignal(from, msg);
        else link.send({ ...msg, peer: from }, controller);
        return;
      case "call":
      case "states":
      case "next":
        if (controller === "self") {
          if (msg.type === "call") runCall(msg);
          else if (msg.type === "states") applyStates(msg.states);
          else window.LXCueList?.setNext?.(msg.value);
        } else link.send(msg, controller);  // pass it to whoever is in control
        return;
    }
  }

  function peerMessage(msg) {
    switch (msg.type) {
      case "welcome":
        say(`Connected to the primary “${msg.name}” as ${NAMES[role].toLowerCase()}`, "ok");
        if (role === "mirror") window.LXScreenMirror?.startWatching(msg.name);
        renderPanel();
        return;
      case "denied":
        say(`The primary refused: ${msg.reason}`, "warn");
        return;
      case "lost":
        say("Lost the primary", "warn");
        if (role === "mirror") window.LXScreenMirror?.stopWatching();
        renderBadge(); renderPanel();
        return;
      case "show":
        if (!joined) stopEnginesQuietly();
        applyShow(msg.parts);
        joined = true;
        return;
      case "live":
        if (inControl) return;              // we're running the show; ignore old frames
        applyLive(msg);
        return;
      case "handback":
        release();
        return;
      case "rtc-again":
        if (role === "mirror") window.LXScreenMirror?.restart();
        return;
      case "rtc":
      case "rtc-want":
        if (inControl && role === "backup") window.LXScreenMirror?.onSignal(msg.peer, msg);
        else if (role === "mirror") window.LXScreenMirror?.onSignal("primary", msg);
        return;
      case "show-request":
        if (inControl) { sendShow(true); sendLive(true); }
        return;
      case "call":
      case "states":
      case "next":
        // Passed on by the primary while this backup is in control.
        if (!inControl) return;
        if (msg.type === "call") runCall(msg);
        else if (msg.type === "states") applyStates(msg.states);
        else window.LXCueList?.setNext?.(msg.value);
        return;
    }
  }

  // -------------------------------------------------------------- loop

  setInterval(() => {
    if (!started || role === "standalone") return;
    const connected = role === "primary" ? (info.peers || []).length > 0 : info.connected;
    if (!connected) return;
    // Whoever's in control sends the show and the live state.
    if (inControl && role !== "client" && role !== "mirror") {
      if (!applying) sendShow();
      sendLive();
    } else if (forwards() && joined && Object.keys(synced).length) {
      // Only after we have the show: an empty new show must never be sent over the real one.
      sendLocalChanges();
      if (!applying) sendShow();
    }
  }, 40);

  // The show changes rarely; check it less often than the live state.
  // (sendShow above compares JSON, so it's cheap when nothing changed — but
  // big shows make the JSON itself the cost, so it's throttled here.)
  const sendShowFast = sendShow;
  let lastShowCheck = 0;
  sendShow = function (force = false, to = null) {
    if (!force && performance.now() - lastShowCheck < 400) return;
    lastShowCheck = performance.now();
    return sendShowFast(force, to);
  };

  // Backup: take over if the primary goes quiet.
  setInterval(() => {
    if (role !== "backup" || inControl || !joined || !pref("sessionAutoTakeover", true)) return;
    const quiet = performance.now() - lastFromController;
    if (lastFromController && quiet > Math.max(500, Number(pref("sessionTakeoverMs", 2000)) || 2000)) takeOver(`no word from the primary for ${(quiet / 1000).toFixed(1)} s`);
  }, 100);

  // ------------------------------------------------------------- start

  async function start(next = {}) {
    if (!link) return say("Multi-console needs the desktop app", "warn");
    for (const [k, v] of Object.entries(next)) window.LXPrefs?.set(k, v);
    role = pref("sessionRole", "standalone");
    window.LXScreenMirror?.stopWatching(); window.LXScreenMirror?.stopAll();
    joined = role === "primary" || role === "standalone";
    controller = "self";
    lastFromController = 0;
    lastLive = null;
    Object.keys(synced).forEach(k => delete synced[k]);
    sentStates.clear(); applied.clear(); touched.clear();
    startedAt = performance.now();
    // A primary waits a moment before driving the lights, in case a backup
    // that took over while it was gone is about to reconnect.
    const startInControl = role === "primary" || role === "standalone";
    inControl = startInControl;
    holdOutput(!startInControl || role === "primary");
    if (role === "primary") setTimeout(() => { if (role === "primary" && controller === "self") holdOutput(false); }, 1500);
    wrapAll();
    info = await link.start({ role, name: pref("sessionName", "") || undefined, port: Number(pref("sessionPort", 8850)) || 8850, pin: pref("sessionPin", ""), host: pref("sessionHost", ""), inControl });
    link.setInControl(inControl);
    started = true;
    document.documentElement.dataset.session = role;
    renderBadge(); renderPanel();
    if (role !== "standalone") say(`This console is the ${NAMES[role].toLowerCase()}${role === "primary" ? "" : ` — connecting to ${pref("sessionHost", "")}`}`, "info");
    return info;
  }

  if (link) {
    link.onMessage(onMessage);
    link.onStatus(next => { info = next || {}; renderBadge(); renderPanelSoft(); });
  }

  // ------------------------------------------------------------ top bar

  function renderBadge() {
    let el = $("lxSessionPill");
    if (!started || role === "standalone") { el?.remove(); return; }
    if (!el) {
      const status = document.querySelector(".topbar-status");
      if (!status) return;
      el = document.createElement("button");
      el.type = "button";
      el.id = "lxSessionPill";
      el.className = "status-pill lx-session-pill";
      el.addEventListener("click", () => window.LXPrefs?.open("network"));
      status.prepend(el);
    }
    const peers = (info.peers || []).length;
    let text, tone;
    if (role === "primary") { text = controller === "self" ? `PRIMARY · ${peers} connected` : "PRIMARY · BACKUP IN CONTROL"; tone = controller === "self" ? "ok" : "warn"; }
    else if (!info.connected) { text = `${NAMES[role].toUpperCase()}${inControl ? " · IN CONTROL" : ""} · NO PRIMARY`; tone = inControl ? "warn" : "bad"; }
    else { text = role === "backup" ? (inControl ? "BACKUP · IN CONTROL" : "BACKUP · FOLLOWING") : `${NAMES[role].toUpperCase()} · CONNECTED`; tone = role === "backup" && inControl ? "warn" : "ok"; }
    if (el.textContent !== text) el.textContent = text;
    el.dataset.tone = tone;
    el.title = "Multi-console — click for settings";
  }

  // ------------------------------------------------------- preferences

  async function renderPanel() {
    const P = window.LXPrefs;
    if (!P?.addPanel || !P.kit) return;
    const { row, seg, check, number, esc: e } = P.kit;
    const found = link ? await link.discovered() : [];
    const peers = info.peers || [];
    const live = !started ? "" : role === "standalone" ? "Not connected to other consoles." :
      role === "primary" ? `Listening on ${e((info.addresses || []).join(", ") || "this computer")} port ${info.port || pref("sessionPort", 8850)}${info.error ? ` — <b>${e(info.error)}</b>` : ""}.<br>${peers.length ? peers.map(p => `${e(NAMES[p.role] || p.role)} “${e(p.name)}” (${e(p.address)})${p.inControl ? " — <b>in control</b>" : ""}`).join("<br>") : "No other consoles connected yet."}` :
      `${info.connected ? `Connected to ${e(pref("sessionHost", ""))}.` : `Not connected${info.error ? ` — ${e(info.error)}` : ""}.`}${role === "backup" ? ` ${inControl ? "<b>This backup is running the show.</b>" : "Following the primary; output held."}` : ""}`;
    const buttons = [
      role === "backup" && !inControl ? `<button type="button" class="btn-danger-soft" data-session="takeover">Take over now</button>` : "",
      role === "primary" && controller !== "self" ? `<button type="button" class="btn-primary" data-session="handback">Take control back</button>` : "",
      `<button type="button" class="btn-secondary" data-session="apply">${started && role !== "standalone" ? "Reconnect with these settings" : "Start"}</button>`
    ].join("");
    const section = P.addPanel("network", "prefNetwork", "Multi-Console", "NETWORK",
      row("This console is", "Primary runs the show. Backup follows it and takes over if it fails. Client is a second programming station. Mirror only shows what's happening.", seg("sessionRole", [["standalone", "Standalone"], ["primary", "Primary"], ["backup", "Backup"], ["client", "Client"], ["mirror", "Mirror"]])) +
      row("Name", "How this console shows up on the others.", `<input class="lx-num" style="width:180px" data-pref="sessionName" placeholder="${e(navigator.platform || "This computer")}">`) +
      row("Primary's address", "For a backup, client or mirror: the primary computer's IP address. Primaries found on this network are listed below.", `<input class="lx-num" style="width:180px" data-pref="sessionHost" placeholder="192.168.1.20">`) +
      row("Port", "The same on every console.", number("sessionPort", 1024, 65535, 1, "")) +
      row("PIN", "Optional. If the primary has one, the others need it to join.", `<input class="lx-num" style="width:120px" data-pref="sessionPin" placeholder="none">`) +
      row("Take over automatically", "A backup takes over the lights if the primary stops answering.", check("sessionAutoTakeover")) +
      row("Take over after", "How long the primary can be silent before the backup takes over.", number("sessionTakeoverMs", 0.5, 30, 0.1, "s", 1000)) +
      `<div class="lx-pref-note">${found.length ? `Primaries on this network: ${found.map(f => `<button type="button" class="btn-secondary" data-session-host="${e(f.host)}" data-session-port="${f.port}">${e(f.name)} · ${e(f.host)}${f.pin ? " 🔒" : ""}</button>`).join(" ")}` : "No primaries found on this network yet."}</div>
       <div class="lx-pref-note" data-session-live>${live}</div>
       <div class="action-row">${buttons}</div>`);
    if (section && !section.dataset.wired) {
      section.dataset.wired = "1";
      section.addEventListener("click", ev => {
        const host = ev.target.closest("[data-session-host]");
        if (host) { window.LXPrefs.set("sessionHost", host.dataset.sessionHost); window.LXPrefs.set("sessionPort", Number(host.dataset.sessionPort) || 8850); window.LXPrefs.sync(); return; }
        const a = ev.target.closest("[data-session]")?.dataset.session;
        if (a === "takeover") takeOver("by hand");
        else if (a === "handback") handBack();
        else if (a === "apply") start();
      });
    }
  }
  setInterval(() => { if (document.getElementById("prefNetwork")?.closest('[data-settings-tab="network"]:not([data-settings-hidden])') || $("prefNetwork")?.offsetParent) renderPanelSoft(); }, 1500);
  let panelKey = "";
  async function renderPanelSoft() {
    const found = link ? await link.discovered() : [];
    const key = JSON.stringify([found, info, inControl, controller, role]);
    if (key === panelKey) return;
    panelKey = key;
    if (document.activeElement?.closest?.("#prefNetwork")) return; // don't rebuild while typing
    renderPanel();
  }

  // ------------------------------------------------------- start screen

  function installSplash() {
    const chooser = $("splashChooser");
    if (!chooser || $("splashRole")) return;
    const box = document.createElement("div");
    box.id = "splashRole";
    box.className = "splash-role";
    box.innerHTML = `
      <div class="splash-chooser-label">This console is</div>
      <div class="splash-role-seg">${Object.entries(NAMES).map(([k, v]) => `<button type="button" data-role="${k}" title="${v}">${k === "standalone" ? "Solo" : v}</button>`).join("")}</div>
      <div class="splash-role-help"></div>
      <div class="splash-connect" hidden>
        <div class="splash-chooser-label">Connect to a primary</div>
        <div class="splash-found"></div>
        <div class="splash-connect-row"><input id="splashHost" placeholder="Address, e.g. 192.168.1.20"><input id="splashPin" placeholder="PIN"><button type="button" class="splash-new-show" id="splashConnect">Connect</button></div>
      </div>`;
    chooser.prepend(box);
    const help = {
      standalone: "Solo (standalone): just this computer, no other consoles.",
      primary: "Runs the show and drives the lights. Backups, clients and mirrors connect to it.",
      backup: "Follows the primary with its output held, and takes over the lights if the primary fails.",
      client: "A second programming station: everything is editable; GO runs on the primary.",
      mirror: "View only: shows what the primary is doing."
    };
    const showList = [...chooser.children].filter(el => el !== box);
    const pick = r => {
      box.dataset.role = r;
      box.querySelectorAll("[data-role]").forEach(b => b.classList.toggle("on", b.dataset.role === r));
      box.querySelector(".splash-role-help").textContent = help[r];
      const connecting = ["backup", "client", "mirror"].includes(r);
      box.querySelector(".splash-connect").hidden = !connecting;
      showList.forEach(el => { el.hidden = connecting; });
    };
    pick(pref("sessionRole", "standalone"));
    $("splashHost").value = pref("sessionHost", "");
    $("splashPin").value = pref("sessionPin", "");
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-role]");
      if (b) pick(b.dataset.role);
      const f = e.target.closest("[data-found]");
      if (f) { $("splashHost").value = f.dataset.found; $("splashPin").focus(); }
    });
    const dismiss = () => {
      const screen = $("splashScreen");
      if (!screen) return;
      screen.classList.add("splash-hidden");
      setTimeout(() => screen.remove(), 500);
    };
    $("splashConnect").addEventListener("click", () => {
      const host = $("splashHost").value.trim();
      if (!host) { $("splashHost").focus(); return; }
      const [h, p] = host.split(":");
      start({ sessionRole: box.dataset.role, sessionHost: h, sessionPort: Number(p) || Number(pref("sessionPort", 8850)) || 8850, sessionPin: $("splashPin").value.trim() });
      dismiss();
    });
    // Opening or starting a show starts the session as standalone or primary.
    chooser.addEventListener("click", e => {
      if (!e.target.closest("#splashShows .splash-show-item, #splashNewShow")) return;
      const r = box.dataset.role === "primary" ? "primary" : "standalone";
      setTimeout(() => start({ sessionRole: r }), 50);
    }, true);
    // Primaries found on the LAN.
    const refresh = async () => {
      if (!box.isConnected) return;
      const list = link ? await link.discovered() : [];
      const host = box.querySelector(".splash-found");
      const html = list.length ? list.map(f => `<button type="button" class="splash-show-item" data-found="${esc(f.host)}${f.port !== 8850 ? `:${f.port}` : ""}"><span class="splash-show-name">${esc(f.name)}</span><span class="splash-show-meta">${esc(f.host)}${f.pin ? " · PIN" : ""}</span></button>`).join("") : '<div class="splash-shows-empty">Looking for primaries on this network…</div>';
      if (host.innerHTML !== html) host.innerHTML = html;
      setTimeout(refresh, 1000);
    };
    refresh();
  }

  function injectStyles() {
    if ($("lxSessionStyles")) return;
    const style = document.createElement("style");
    style.id = "lxSessionStyles";
    style.textContent = `
      .lx-session-pill{font-family:var(--mono,monospace);cursor:pointer;letter-spacing:.6px}
      .lx-session-pill[data-tone="ok"]{color:#6fe08e;border-color:rgba(74,201,108,.45)}
      .lx-session-pill[data-tone="warn"]{color:#ffd27a;border-color:rgba(255,173,31,.55);box-shadow:0 0 12px rgba(255,173,31,.15)}
      .lx-session-pill[data-tone="bad"]{color:#ff98a3;border-color:rgba(255,79,98,.55)}
      .splash-role{margin-bottom:14px}
      .splash-role-seg{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin:6px 0}
      .splash-role-seg button{min-width:0;height:32px;padding:0 4px;border:1px solid #2b383f;border-radius:6px;background:#0e1519;color:#a7b2af;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .splash-role-seg button.on{background:var(--accent,#19d6a3);border-color:var(--accent-2,#54f2c8);color:#04140e}
      .splash-role-help{color:#a7b2af;font-size:14px;min-height:16px}
      .splash-connect{margin-top:12px}
      .splash-found{display:flex;flex-direction:column;gap:4px;margin:6px 0 10px}
      .splash-connect-row{display:flex;gap:6px;width:100%}
      .splash-connect-row input{flex:1;min-width:0;height:34px;padding:0 10px;background:#0a1013;border:1px solid #2b383f;border-radius:6px;color:#e7f0ee;font-size:14px}
      .splash-connect-row .splash-new-show{flex:none;width:auto;padding:0 16px;margin:0}
      .splash-connect-row #splashPin{flex:none;width:80px!important}
      html[data-session="mirror"] #controlPanel,html[data-session="backup"][data-session-held="on"] #controlPanel{opacity:.75}
    `;
    document.head.appendChild(style);
  }

  // The command line: "take over" / "take control back", and on a mirror
  // or a following backup only commands that look (not change) get through.
  // Handled on the box itself rather than by wrapping parseCommand, which
  // other scripts re-wrap all the time.
  const LOOK_ONLY = /^(cue list|cuelist|help|\?|commands|info(\s+\d+)?|\d+\s+info|timecode|tc|focus|viz|visuali[sz]er|undo|redo)$/i;
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target?.id !== "cmdInput") return;
    const c = String(e.target.value || "").trim().toLowerCase();
    const done = () => { e.preventDefault(); e.stopImmediatePropagation(); e.target.value = ""; };
    if (c === "take over") { done(); if (!takeOver("by hand")) say(role === "backup" ? "This backup is already running the show" : "Only a backup can take over", "warn"); return; }
    if (c === "take control" || c === "take control back") { done(); if (!handBack()) say(role === "primary" ? "This primary is already in control" : "Only the primary can take control back", "warn"); return; }
    if (c && viewOnly() && !LOOK_ONLY.test(c)) { done(); blocked("command"); }
  }, true);

  // Mirror / following backup: the Control Deck can't be moved.
  document.addEventListener("input", e => {
    if (!viewOnly() || !e.target.closest?.("#controlPanel, .lx-rgbw")) return;
    e.stopImmediatePropagation();
    blocked("deck");
    setTimeout(() => window.syncControlsFromSelection?.(), 0);
  }, true);
  document.addEventListener("pointerdown", e => {
    if (!viewOnly() || !e.target.closest?.("#controlPanel .xy-pad, #controlPanel .colour-wheel")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    blocked("deck");
  }, true);

  function boot() {
    injectStyles();
    setTimeout(() => {
      if (typeof commandDefs !== "undefined" && !commandDefs.__lxSession) {
        commandDefs.__lxSession = true;
        commandDefs.push({ cmd: "take over", hint: "— backup: run the show from this console" }, { cmd: "take control back", hint: "— primary: take the show back from the backup" });
      }
    }, 1200);
    installSplash();
    wrapAll();
    // Other scripts wrap these functions too; stay on the outside.
    setInterval(wrapAll, 1000);
    // No start screen (it was skipped): start with the saved role.
    setTimeout(() => { if (!started && !$("splashScreen")) start(); }, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
  else boot();
  window.addEventListener("load", () => setTimeout(() => { wrapAll(); renderPanel(); }, 1600));

  window.LXSession = Object.freeze({
    start, takeOver, handBack, release,
    role: () => role, inControl: () => inControl, joined: () => joined, drives,
    status: () => ({ role, inControl, controller, joined, info, lastFromController }),
    // Screen mirror messages: a mirror sends to the primary; the console in
    // control answers a mirror (a backup in control goes via the primary).
    signal: (peer, msg) => {
      if (role === "primary") return link.send(msg, peer);
      if (role === "backup" && inControl) return link.send({ ...msg, peer });
      return link.send(msg);
    }
  });
})();
