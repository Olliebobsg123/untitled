"use strict";

/*
 * More commands, so everything on screen can be done from the command line
 * (and from a cue's command, MIDI, the phone remote…).
 *
 *   kill                 the cue list stops: fades, follows, its effects and
 *                        chases stop, every light goes out, and GO starts
 *                        again from the first cue. "kill 3" fades out over 3 s.
 *   kill all / panic     that, plus every chase, effect, timecode, the song
 *                        timeline, fog and haze, and the programmer cleared
 *   pause / resume       hold a fade where it is / carry on
 *   top                  back to the top of the cue list (lights stay)
 *   …and windows, pages, outputs, MIDI, QLab, the phone remote, the
 *   visualiser's toolbar, faders, selection and more. "help" lists them.
 *
 * Asked by js/command-line.js before the older parsers; every pattern here is
 * one no other part of the console understands.
 */
(function () {
  if (window.LXMoreCommands) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => (window.log?.(m, t), true);
  const CUE = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
  const NUM = "(-?\\d*\\.?\\d+)";
  const re = s => new RegExp(`^${s}$`);
  const click = id => { const el = document.getElementById(id); if (!el) return false; el.click(); return true; };
  const cueIndex = n => (typeof window.cueIndexOf === "function" ? window.cueIndexOf(n) : -1);
  const label = i => (window.cueLabel ? window.cueLabel(i) : String(i + 1));
  const onOff = (word, now) => (word === "on" ? true : word === "off" ? false : !now);

  // ------------------------------------------------------------ playback

  // Everything the cue list is doing stops, and its lights go out.
  function kill(seconds = 0, quiet = false) {
    const s = S();
    window.stopCueTimers?.();
    window.stopCueEffect?.();
    if (s.currentChase >= 0 || s.activeChase) window.stopChase?.(false);
    const from = window.snapshotCurrentLighting?.();
    const was = s.currentCue;
    s.currentCue = -1;
    s.nextCue = null;
    if (from) {
      const to = { globalState: { ...from.globalState, intensity: 0 }, fixtureMap: new Map() };
      from.fixtureMap.forEach((st, id) => to.fixtureMap.set(id, { ...st, intensity: 0 }));
      window.fadeLighting?.(from, to, Math.max(0, seconds) * 1000, () => window.updateDMX?.());
    }
    window.renderCues?.();
    window.LXCueList?.refresh?.();
    window.updateInspectorList?.();
    window.dispatchEvent(new CustomEvent("lx-cue-killed"));
    if (!quiet) say(`Killed${was >= 0 && s.cues?.[was] ? ` cue ${label(was)}` : " the cue list"}${seconds ? ` (out over ${seconds} s)` : ""} — GO starts from the first cue`, "warn");
    return true;
  }

  function killAll(seconds = 0) {
    kill(seconds, true);
    window.stopEffect?.(true);
    window.stopChase?.(false);
    window.LXTimecode?.stop?.();
    if (window.LXSong?.playing?.()) window.LXSong.pause?.();
    if (window.LXFixtureCheck?.running?.()) window.LXFixtureCheck.finish?.();
    const hl = window.LXFastProgramming?.highlighting;
    if (typeof hl === "function" ? hl() : hl) window.LXFastProgramming.highlightOff?.();
    window.parseCommand?.("fog 0");
    window.parseCommand?.("haze 0");
    window.clearProgrammer?.({ quiet: true });
    if (S().selected instanceof Set) S().selected.clear();
    window.renderFixtures?.();
    return say(`Killed everything: cues, chases, effects, timecode, fog and haze${seconds ? ` (out over ${seconds} s)` : ""}`, "warn");
  }

  let paused = null;
  function pause() {
    const s = S();
    if (!(s.currentCue >= 0)) return say("Nothing is playing", "warn");
    window.stopCueTimers?.();
    paused = s.currentCue;
    return say(`Paused cue ${label(s.currentCue)} — resume to carry on`);
  }
  function resume() {
    const s = S();
    const i = paused ?? s.currentCue;
    if (!(i >= 0) || !s.cues?.[i]) return say("Nothing to resume", "warn");
    paused = null;
    window.goToCue?.(i);
    return say(`Resumed cue ${label(i)}`);
  }

  function goTo(n, seconds) {
    const i = cueIndex(n);
    if (i < 0) return say(`Cue ${n} not found`, "warn");
    window.goToCue?.(i, seconds == null ? null : seconds * 1000);
    return true;
  }

  // ------------------------------------------------------------ windows & pages

  const WINDOWS = {
    errors: "errors", "error log": "errors", check: "check", "health check": "check",
    "cue stack": "cues", cues: "cues", log: "log", console: "log", "console log": "log", groups: "groups",
    fixtures: "fixtures", control: "control", "control deck": "control", deck: "control", palettes: "palettes",
    magic: "magic", "magic sheet": "magic", effects: "effects", chases: "chases", inspector: "inspector", "cue inspector": "inspector",
    patch: "patch", "patched fixtures": "patch", "fixture check": "fixturecheck", tracking: "tracking", "tracking sheet": "tracking",
    song: "song", timeline: "song", "song timeline": "song", starter: "starter", "show starter": "starter", prefs: "prefs",
    preferences: "prefs", settings: "prefs", "fixture info": "fixtureinfo", info: "fixtureinfo", commands: "commands", help: "commands",
    script: "script", "the script": "script", focus: "focus", "point and shoot": "focus", timecode: "timecode", "cue list": "cuelist", cuelist: "cuelist"
  };
  const PAGES = { live: "live", "live control": "live", patch: "patch", inspector: "inspector", "cue inspector": "inspector", chases: "chases", effects: "effects", qlab: "qlab", faders: "faders", magic: "magic", "magic sheet": "magic" };

  function openWindow(name, open = true) {
    const id = WINDOWS[name] || (window.LXWindows?.list?.() || []).find(w => w === name);
    if (!id) return false; // not a window: maybe "open MyShow.json"
    if (open) window.LXWindows?.open(id);
    else if (!window.LXWindows?.close?.(id)) return say(`${name} isn't open`, "info");
    return say(`${open ? "Opened" : "Closed"} ${name}`);
  }
  function showPage(name) {
    const word = name.replace(/^page\s+/, "");
    const nav = PAGES[word];
    if (nav) { const b = document.querySelector(`.nav-link[data-page="${nav}"]`); if (b) { b.click(); return say(`Page: ${b.textContent.replace(/\d+$/, "").replace(/^\W+/, "").trim()}`); } }
    const pages = window.LXCustomPages?.list?.() || [];
    const n = Number(word);
    const page = Number.isInteger(n) && n >= 1 ? pages[n - 1] : pages.find(p => String(p.name || "").toLowerCase() === word);
    if (page) { window.LXCustomPages.show(page.id ?? pages.indexOf(page)); return say(`Page: ${page.name || `Page ${pages.indexOf(page) + 1}`}`); }
    return say(`No page called “${word}” — pages are: ${[...new Set(Object.values(PAGES))].join(", ")}${pages.length ? `, or 1–${pages.length}` : ""}`, "warn");
  }

  // ------------------------------------------------------------ selection

  const fixtures = () => (S().fixtures || []).filter(f => f && f.id != null);
  function select(ids, what) {
    const s = S();
    if (!(s.selected instanceof Set)) s.selected = new Set();
    s.selected.clear();
    ids.forEach(id => s.selected.add(id));
    window.renderFixtures?.();
    window.updateControlsForSelection?.();
    return say(`Selected ${ids.length} ${what}`);
  }
  const levelOf = f => Number(S().fixtureStates?.get?.(f.id)?.intensity) || 0;

  // ------------------------------------------------------------ the commands

  // [regex, handler(match, raw)]. Checked in order.
  const HANDLERS = [
    // Kill and friends
    [re(`(?:kill|kill cue|kill cue ?list|kill cues|release cue ?list|off cue ?list)(?:\\s+(?:over\\s+|in\\s+)?${NUM}\\s*s?)?`), m => kill(Number(m[1]) || 0)],
    [re(`(?:kill all|kill everything|panic|stop everything)(?:\\s+(?:over\\s+|in\\s+)?${NUM}\\s*s?)?`), m => killAll(Number(m[1]) || 0)],
    [/^kill (?:effects?|fx)$/, () => (window.stopEffect?.(true), say("All effects stopped"))],
    [/^kill chases?$/, () => (window.stopChase?.(false), say("All chases stopped"))],
    [/^stop all$/, () => (window.stopEffect?.(true), window.stopChase?.(false), say("All chases and effects stopped"))],
    [/^(?:pause|hold|halt)(?: cue)?$/, () => pause()],
    [/^(?:resume|continue|unpause)$/, () => resume()],
    [/^(?:top|go to top|goto top|reset cue ?list|rewind)$/, () => { const s = S(); window.stopCueTimers?.(); s.currentCue = -1; s.nextCue = null; window.renderCues?.(); window.LXCueList?.refresh?.(); return say("Back to the top — GO plays the first cue (the lights stay as they are)"); }],
    [/^(?:go first|first cue|go to first cue)$/, () => { const i = (S().cues || []).findIndex(c => c && !c.disabled); return i < 0 ? say("No cues", "warn") : (window.goToCue?.(i), true); }],
    [/^(?:go last|last cue|go to last cue)$/, () => { const c = S().cues || []; let i = c.length - 1; while (i >= 0 && (!c[i] || c[i].disabled)) i--; return i < 0 ? say("No cues", "warn") : (window.goToCue?.(i), true); }],
    [/^(?:again|refire|re-?go|go again)$/, () => { const i = S().currentCue; return i >= 0 ? (window.goToCue?.(i), true) : say("No cue to play again", "warn"); }],
    [re(`(?:go|cue)\\s+${CUE}\\s+(?:in|time|over)\\s+${NUM}\\s*s?`), m => goTo(m[1], Number(m[2]))],
    [re(`snap\\s+(?:to\\s+)?(?:cue\\s+)?${CUE}`), m => goTo(m[1], 0)],
    [re(`go\\s+(?:in|time|over)\\s+${NUM}\\s*s?`), m => (window.goNextCue?.(Number(m[1]) * 1000), true)],
    [/^(?:go )?snap$/, () => (window.goNextCue?.(0), true)],
    [re(`(?:set next|next cue|next is)\\s+(?:cue\\s+)?${CUE}`), m => { const i = cueIndex(m[1]); return i < 0 ? say(`Cue ${m[1]} not found`, "warn") : (window.LXCueList?.setNext?.(i), true); }],
    [/^skip$/, () => { const s = S(); const now = window.LXCueList?.next?.() ?? -1; const from = now >= 0 ? now : s.currentCue + 1; let i = from + 1; while (i < (s.cues || []).length && (!s.cues[i] || s.cues[i].disabled)) i++; if (i >= (s.cues || []).length) return say("Nothing after that to skip to", "warn"); window.LXCueList?.setNext?.(i); return true; }],
    [/^(?:what'?s next|next\?)$/, () => { const n = window.LXCueList?.next?.() ?? -1; return n >= 0 ? say(`Next: cue ${label(n)} “${S().cues[n].name || ""}”${S().cues[n].goNote ? ` — GO on: ${S().cues[n].goNote}` : ""}`, "info") : say("Nothing next — end of the list", "info"); }],
    [/^(?:what'?s live|live\?|current cue|which cue)$/, () => { const i = S().currentCue; return i >= 0 ? say(`Live: cue ${label(i)} “${S().cues[i]?.name || ""}”`, "info") : say("No cue is live", "info"); }],

    // Cues
    [re(`cue\\s+${CUE}\\s+(?:go ?note|gonote)\\s*(.*)`), (m, raw) => { const i = cueIndex(m[1]); if (i < 0) return say(`Cue ${m[1]} not found`, "warn"); const text = raw.replace(/^.*?go\s?note\s*/i, "").trim(); if (text) S().cues[i].goNote = text; else delete S().cues[i].goNote; window.renderCues?.(); window.LXCueList?.refresh?.(); return say(text ? `Cue ${m[1]} GO note: ${text}` : `Cue ${m[1]} GO note cleared`); }],
    [re(`(?:inspect|edit cue|open cue)\\s+${CUE}`), m => { const i = cueIndex(m[1]); if (i < 0) return say(`Cue ${m[1]} not found`, "warn"); showPage("inspector"); window.LXCueInspector?.focus?.(i); return true; }],
    [re(`delete cues?\\s+${CUE}\\s*(?:thru|through|-|>)\\s*${CUE}`), m => {
      const a = Number(m[1]), b = Number(m[2]), lo = Math.min(a, b), hi = Math.max(a, b);
      const list = (S().cues || []).filter(c => c && Number(c.number) >= lo - 1e-6 && Number(c.number) <= hi + 1e-6).map(c => c.number);
      if (!list.length) return say(`No cues between ${lo} and ${hi}`, "warn");
      (window.LXAsk ? window.LXAsk(`Delete ${list.length} cues?`, [], { ok: "Delete", message: `Cues ${lo} to ${hi} are removed.`, safe: true }) : Promise.resolve(confirm(`Delete ${list.length} cues?`))).then(ok => { if (!ok) return; list.slice().reverse().forEach(n => window.deleteCue?.(n)); say(`Deleted ${list.length} cues (${lo}–${hi})`); });
      return true;
    }],
    [/^(?:list scenes|scenes|songs)$/, () => { const seen = []; (S().cues || []).forEach((c, i) => { if (c?.scene && !seen.some(x => x[0] === c.scene)) seen.push([c.scene, label(i)]); }); return say(seen.length ? `Scenes: ${seen.map(([n, c]) => `${n} (${c})`).join(" · ")}` : "No scenes yet — cue 5 scene Act 1", "info"); }],
    [/^(?:go to scene|scene|go to song)\s+(.+)$/, m => { const w = m[1].trim(); const i = (S().cues || []).findIndex(c => c?.scene && c.scene.toLowerCase().startsWith(w)); return i < 0 ? say(`No scene starting “${w}” — list scenes`, "warn") : (window.LXCueList?.setNext?.(i), say(`Next: the start of ${S().cues[i].scene} (cue ${label(i)}) — press GO`)); }],

    // Windows, pages, modes
    [/^(?:open|window)\s+(.+)$/, m => openWindow(m[1].trim())],
    [/^(?:close|hide)\s+(.+)$/, m => (m[1].trim() === "all" || m[1].trim() === "windows" ? ((window.LXWindows?.floating?.() || []).forEach(id => window.LXWindows.close(id)), say("Every window put back")) : openWindow(m[1].trim(), false))],
    [/^(?:windows|list windows)$/, () => say(`Windows: ${(window.LXWindows?.list?.() || []).join(", ")} — open <name>`, "info")],
    [/^(?:dock all|put back|put windows back|reset windows)$/, () => ((window.LXWindows?.floating?.() || []).forEach(id => window.LXWindows.close(id)), say("Every window put back"))],
    [/^page\s+(.+)$/, m => showPage(m[1].trim())],
    [/^(?:pages|list pages)$/, () => say(`Pages: ${[...new Set(Object.values(PAGES))].join(", ")}${(window.LXCustomPages?.list?.() || []).length ? `; yours: ${window.LXCustomPages.list().map((p, i) => `${i + 1} ${p.name || ""}`).join(", ")}` : ""}`, "info")],
    [/^(?:look|appearance|theme)\s+(mac|classic|dark|black|slate)$/, m => { const t = m[1] === "classic" ? "dark" : m[1]; window.LXPrefs?.set?.("theme", t); return say(t === "mac" ? "Mac look on — \"look classic\" to go back" : `Look: ${m[1]}`); }],
    [/^(?:blind|blind mode)$/, () => (click("consoleModeBlind"), say("Blind: changes don't go to the stage"))],
    [/^(?:live|live mode)$/, () => (click("consoleModeLive"), say("Live"))],
    [/^(?:emergency|emergency white|safe white)$/, () => (click("btnEmergencyWhite"), true)],
    [/^(?:ui zoom|screen zoom|screen)\s+(\d+)%?$/, m => (window.LXZoom?.set?.(Number(m[1]) / 100), say(`Screen zoom ${m[1]}%`))],
    [/^(?:bigger|screen bigger)$/, () => (window.LXZoom?.set?.((window.LXZoom.get() || 1) + 0.1), true)],
    [/^(?:smaller|screen smaller)$/, () => (window.LXZoom?.set?.((window.LXZoom.get() || 1) - 0.1), true)],
    [/^(?:screen zoom reset|screen reset|actual size)$/, () => (window.LXZoom?.set?.(1), say("Screen zoom 100%"))],

    // Output and connections
    [/^(?:output|outputs|dmx output|art-?net output)\s+(on|off)$/, m => (click(m[1] === "on" ? "artnetStart" : "artnetStop"), say(`Output ${m[1]}`))],
    [/^(?:start|enable) output$/, () => (click("artnetStart"), say("Output on"))],
    [/^(?:stop|disable) output$/, () => (click("artnetStop"), say("Output off"))],
    [/^qlab\s+(connect|reconnect)$/, () => (click("qlabConnect"), say("Connecting to QLab…", "info"))],
    [/^qlab\s+test$/, () => (click("qlabTest"), say("Test message sent to QLab", "info"))],
    [/^midi\s+(connect|disconnect|refresh|learn|clear)$/, m => (click({ connect: "midiConnect", disconnect: "midiDisconnect", refresh: "midiRefresh", learn: "midiLearn", clear: "midiClearMapping" }[m[1]]), say(`MIDI ${m[1]}`))],
    [/^remote\s+(on|off)$/, m => (window.LXRemote?.setEnabled?.(m[1] === "on"), say(`Phone remote ${m[1]}`))],
    [/^remote(?:\s+info)?$/, async () => { const i = await window.LXRemote?.getInfo?.(); return say(i ? `Phone remote ${i.enabled ? "on" : "off"}${i.url ? ` — ${i.url}` : ""}${i.pin ? ` · PIN ${i.pin}` : ""}` : "The phone remote isn't available here", "info"); }],
    [/^remote new pin$/, async () => { await window.LXRemote?.regeneratePin?.(); return say("New phone remote PIN made — remote to see it"); }],

    // Faders and master
    [re(`(?:grand ?master|gm|master)\\s*(?:@\\s*)?(full|out|\\d+)%?`), m => { const v = m[1] === "full" ? 100 : m[1] === "out" ? 0 : Number(m[1]); window.LXFaders?.setGrand?.(v); return say(`Grand master ${v}%`); }],
    [re(`(?:fader|sub)\\s+(\\d+)\\s*(?:@|at)\\s*(full|out|\\d+)%?`), m => { const v = m[2] === "full" ? 100 : m[2] === "out" ? 0 : Number(m[2]); window.LXFaders?.setFader?.(Number(m[1]), v); return say(`Fader ${m[1]} @ ${v}%`); }],
    [/^(?:fader|sub)\s+(\d+)\s+flash$/, m => { const n = Number(m[1]); window.LXFaders?.flashFader?.(n, true); setTimeout(() => window.LXFaders?.flashFader?.(n, false), 600); return say(`Flash fader ${n}`); }],
    [/^(?:faders|all faders)\s+(?:@\s*)?(?:out|0)$/, () => { for (let n = 1; n <= (window.LXFaders?.count || 0); n++) window.LXFaders.setFader(n, 0); return say("Every fader out"); }],

    // Selection
    [/^select all$/, () => select(fixtures().map(f => f.id), "lights (all)")],
    [/^(?:select none|deselect|deselect all)$/, () => select([], "— nothing")],
    [/^invert(?: selection)?$/, () => { const sel = S().selected || new Set(); return select(fixtures().filter(f => !sel.has(f.id)).map(f => f.id), "lights (the others)"); }],
    [/^select (?:lit|on|active)$/, () => select(fixtures().filter(f => levelOf(f) > 0).map(f => f.id), "lights that are on")],
    [/^select (?:unlit|dark|off)$/, () => select(fixtures().filter(f => levelOf(f) <= 0).map(f => f.id), "lights that are off")],
    [/^select colou?r(?: lights)?$/, () => select(fixtures().filter(f => window.canColour?.(f)).map(f => f.id), "colour lights")],
    [/^select (?:type|kind)\s+(.+)$/, m => select(fixtures().filter(f => String(f.name || "").toLowerCase().includes(m[1])).map(f => f.id), `lights matching “${m[1]}”`)],
    [/^(?:full|flash) selected$/, () => (window.parseCommand?.("@ full"), true)],
    [/^(?:out|zero) selected$/, () => (window.parseCommand?.("@ out"), true)],

    // Info
    [/^(?:what'?s on|lit|on\?|show lit)$/, () => { const on = fixtures().filter(f => levelOf(f) > 0); return say(on.length ? `${on.length} on: ${on.map(f => `${f.fixtureNumber}@${Math.round(levelOf(f))}`).join(", ")}` : "Nothing is on", "info"); }],
    [/^(?:count|how many)(?: lights| fixtures)?$/, () => say(`${fixtures().length} fixtures, ${(S().groups || []).filter(Boolean).length} groups, ${(S().cues || []).filter(Boolean).length} cues, ${(S().palettes || []).filter(Boolean).length} palettes, ${(S().chases || []).filter(Boolean).length} chases`, "info")],
    [/^list chases?$/, () => say((S().chases || []).map((c, i) => c && `${i + 1} ${c.name || ""}`).filter(Boolean).join(", ") || "No chases", "info")],
    [/^list effects?$/, () => say(Object.keys(S().savedEffects || {}).map((n, i) => `${i + 1} ${n}`).join(", ") || "No saved effects", "info")],
    [/^(?:running|what'?s running)$/, () => { const fx = (S().effects || []).map(e => e.name || e.type); const ch = S().currentChase >= 0 ? [`chase ${S().currentChase + 1}`] : []; return say(fx.length || ch.length ? `Running: ${[...ch, ...fx].join(", ")}` : "No chases or effects running", "info"); }],

    // Effects
    [re(`(?:effects?|fx) speed\\s+${NUM}`), m => { const v = Math.max(0.05, Number(m[1])); (S().effects || []).forEach(e => { e.speed = v; if (e.options) e.options.speed = v; delete e.beats; }); window.renderRunningEffects?.(); return say(`Running effects at speed ${v}`); }],

    // Atmosphere
    [/^(?:atmos|atmosphere|smoke) (?:off|out|0)$/, () => (window.parseCommand?.("fog 0"), window.parseCommand?.("haze 0"), say("Fog and haze off"))],

    // Visualiser toolbar
    [/^viz (?:views?|split) (1|2|4)$/, m => vizSay("split", Number(m[1]))],
    [/^viz view (.+)$/, m => vizSay("view", m[1].trim())],
    [/^viz (?:front|foh|plan|top|side|close)$/, (m, raw) => vizSay("view", raw.trim().split(/\s+/)[1].toLowerCase())],
    [/^viz save view (.+)$/, (m, raw) => vizSay("save view", raw.trim().replace(/^viz save view\s+/i, ""))],
    [/^viz (?:picture|photo|screenshot|snapshot)$/, () => vizSay("picture")],
    [/^viz (?:record|rec)$/, () => vizSay("record")],
    [/^viz stop(?: recording)?$/, () => vizSay("stop")],
    [/^viz (lights|lights table)(?: (on|off))?$/, m => vizSay("lights", m[2])],
    [/^viz plot$/, () => vizSay("plot")],
    [/^viz build(?: (on|off))?$/, m => vizSay("build", m[1])],
    [/^viz measure(?: (on|off))?$/, m => vizSay("measure", m[1])],
    [/^viz (house|work|grid|targets)(?: lights)?(?: (on|off))?$/, m => vizSay(m[1], m[2])],
    [re(`viz (haze|exposure)\\s+${NUM}%?`), m => vizSay(m[1], Number(m[2]))],
    [/^viz quality (\w+)$/, m => vizSay("quality", m[1])],
    [/^viz from light$/, () => vizSay("from light")],
    [/^viz (?:bar|toolbar)(?: (on|off))?$/, m => vizSay("bar", m[1])],

    // Show
    [/^(?:save as|save show as)$/, () => (window.LXShowCommands?.saveAs?.(), true)],
    [/^(?:open show|load show|open file)$/, () => (window.LXShowCommands?.open?.(), true)],
    [/^(?:show name|which show|show\?)$/, () => say(`Show: ${window.LXShowCommands?.name?.() || "not saved yet"}${window.LXShowCommands?.isDirty?.() ? " (unsaved changes)" : ""}`, "info")],
    [/^(?:check for updates?|updates?\?)$/, () => (window.LXUpdates?.check?.(), say("Checking for a new Light Spark…", "info"))]
  ];

  function vizSay(action, arg) {
    if (!window.LXVisualizer?.command) return say("The visualiser isn't available", "warn");
    const open = window.LXVisualizer.command(action, arg);
    if (!open) say("Opening the visualiser…", "info");
    return true;
  }

  function command(c, raw = c) {
    for (const [pattern, handler] of HANDLERS) {
      const m = c.match(pattern);
      if (!m) continue;
      const r = handler(m, raw);
      if (r === false) continue; // matched the words, but it's someone else's (e.g. "open MyShow.json")
      if (r && typeof r.then === "function") r.catch(e => say(String(e?.message || e), "warn"));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ suggestions & help

  const COMMANDS = [
    ["kill", "stop the cue list: lights out, GO starts from the top", "Playback"], ["kill <sec>", "…fading out over this long", "Playback"],
    ["kill all", "kill cues, chases, effects, timecode, fog & haze", "Playback"], ["panic", "same as kill all", "Playback"],
    ["kill effects", "stop every effect", "Playback"], ["kill chases", "stop every chase", "Playback"], ["stop all", "stop chases and effects", "Playback"],
    ["pause", "hold the fade where it is", "Playback"], ["resume", "carry on from a pause", "Playback"], ["top", "back to the top of the cue list", "Playback"],
    ["go first", "go to the first cue", "Playback"], ["go last", "go to the last cue", "Playback"], ["again", "play the live cue again", "Playback"],
    ["go <cue> in <sec>", "go to a cue in this many seconds", "Playback"], ["go in <sec>", "the next cue, in this many seconds", "Playback"],
    ["snap <cue>", "go to a cue instantly", "Playback"], ["snap", "the next cue, instantly", "Playback"],
    ["set next <cue>", "which cue GO plays next", "Playback"], ["skip", "skip the next cue", "Playback"],
    ["what's next", "the next cue and its GO note", "Playback"], ["what's live", "the live cue", "Playback"],
    ["cue <cue> gonote <text>", "what the operator GOes on", "Cue options"], ["inspect <cue>", "open a cue in the Cue Inspector", "Cues"],
    ["delete cues <cue> thru <cue>", "remove several cues", "Cues"], ["list scenes", "every scene / song heading", "Cues"], ["go to scene <text>", "GO goes to the start of a scene", "Cues"],
    ["update cue <cue> cue only", "save into this cue, the next cue keeps its look", "Cues"], ["update cue <cue> track", "save into this cue and track on", "Cues"],
    ["cue sheet", "a printable cue sheet", "Cues"], ["clean up show", "tidy out lights that aren't patched", "Cues"], ["tracking sheet", "every light's level in every cue", "Cues"],
    ["timeline", "the song timeline (music + cues)", "Cues"], ["learn", "place cues as the music plays", "Cues"], ["learn off", "stop learning", "Cues"],
    ["show starter", "Frozen colours, song cues, area groups", "Cues"], ["script", "the script from QLab Connect, with the cues on it", "Cues"], ["script refresh", "fetch the script again", "Cues"], ["script notes off", "stop writing GO notes from the script", "Cues"], ["area groups", "a group for each part of the stage", "Select"],
    ["open <window>", "open a window", "Windows"], ["close <window>", "close a window", "Windows"], ["windows", "list the windows", "Windows"], ["dock all", "put every window back", "Windows"],
    ["page <page>", "go to a page", "Windows"], ["pages", "list the pages", "Windows"], ["look mac", "Light Spark looks like a Mac app", "Windows"], ["look classic", "the original look", "Windows"], ["blind", "blind mode: nothing goes to the stage", "Windows"], ["live", "live mode", "Windows"],
    ["screen zoom <pct>", "make the screen bigger or smaller", "Windows"], ["screen zoom reset", "screen back to 100%", "Windows"],
    ["output <onoff>", "DMX output on or off", "Outputs"], ["qlab connect", "connect to QLab", "Outputs"], ["qlab test", "send QLab a test message", "Outputs"],
    ["midi connect", "connect MIDI", "Outputs"], ["midi disconnect", "disconnect MIDI", "Outputs"], ["midi learn", "learn a MIDI control", "Outputs"], ["midi refresh", "look for MIDI devices", "Outputs"],
    ["remote <onoff>", "the phone remote on or off", "Outputs"], ["remote", "the phone remote's address and PIN", "Outputs"], ["remote new pin", "a new PIN for the remote", "Outputs"],
    ["master <level>", "the grand master", "Levels"], ["fader <number> @ <level>", "a fader to a level", "Levels"], ["fader <number> flash", "flash a fader", "Levels"], ["faders out", "every fader to 0", "Levels"],
    ["select all", "every light", "Select"], ["select none", "nothing", "Select"], ["invert", "select the other lights", "Select"],
    ["select lit", "lights that are on", "Select"], ["select unlit", "lights that are off", "Select"], ["select colour", "lights that can change colour", "Select"], ["select type <text>", "lights whose name matches", "Select"],
    ["what's on", "every light that's on, and its level", "Info"], ["count", "how many lights, groups, cues…", "Info"], ["running", "chases and effects running", "Info"],
    ["list chases", "every chase", "Info"], ["list effects", "every saved effect", "Info"], ["show name", "which show is open", "Info"],
    ["tempo <number>", "the BPM effects follow", "Effects"], ["tap", "tap the tempo", "Effects"], ["effects speed <number>", "speed of the running effects", "Effects"],
    ["fog limit <sec>", "longest a fog machine may run", "Stage"], ["haze limit <sec>", "longest a hazer may run", "Stage"], ["fog reset", "let the fog run again", "Stage"], ["atmos off", "fog and haze off", "Stage"],
    ["viz views <split>", "1, 2 or 4 views in the visualiser", "Visualiser"], ["viz view <vizview>", "a camera view (or one you saved)", "Visualiser"], ["viz save view <text>", "save the camera as a view", "Visualiser"],
    ["viz picture", "save a picture of the stage", "Visualiser"], ["viz record", "record a video", "Visualiser"], ["viz stop", "stop recording and save", "Visualiser"],
    ["viz lights", "the lights table", "Visualiser"], ["viz plot", "the lighting plot", "Visualiser"], ["viz build", "build mode", "Visualiser"], ["viz measure", "measure", "Visualiser"],
    ["viz house <onoff>", "house lights", "Visualiser"], ["viz work <onoff>", "work lights", "Visualiser"], ["viz grid <onoff>", "the floor grid", "Visualiser"],
    ["viz haze <level>", "room haze", "Visualiser"], ["viz exposure <number>", "brighter or darker", "Visualiser"], ["viz quality <quality>", "quality", "Visualiser"], ["viz from light", "look from the selected light", "Visualiser"],
    ["save as", "save the show under a new name", "Show"], ["open flx", "open a Zero 88 FLX / ZerOS show file (.zos)", "Show"], ["export flx", "a show file for a Zero 88 FLX S (asks: full look or brightness only)", "Show"], ["export flx full", "FLX S show file with colour, position and beam as extra channels", "Show"], ["export flx simple", "FLX S show file, brightness only", "Show"], ["open show", "open a show file", "Show"], ["check for updates", "look for a new Light Spark", "Show"]
  ];

  function slot(type) {
    switch (type) {
      case "window": return [...new Set(Object.keys(WINDOWS))].map(k => [k, "window", "WINDOW"]);
      case "page": return [...new Set(Object.keys(PAGES))].map(k => [k, "page", "PAGE"]).concat((window.LXCustomPages?.list?.() || []).map((p, i) => [String(i + 1), p.name || "your page", "PAGE"]));
      case "onoff": return [["on", "", "ON"], ["off", "", "OFF"]];
      case "split": return [["1", "just the 3D view", "VIEWS"], ["2", "3D + plan", "VIEWS"], ["4", "3D, plan, front, side", "VIEWS"]];
      case "vizview": return [["front", "front of house", "VIEW"], ["close", "front row", "VIEW"], ["plan", "from above", "VIEW"], ["side", "from the side", "VIEW"], ...((S().visualizer?.settings?.views || []).map(v => [v.name, "your view", "VIEW"]))];
      case "quality": return [["ultra", "sharpest, for a fast Mac", "QUALITY"], ["high", "", "QUALITY"], ["medium", "", "QUALITY"], ["low", "", "QUALITY"], ["auto", "goes with the frame rate", "QUALITY"]];
      default: return null;
    }
  }

  const REFERENCE = [
    ["Playback", [["kill", "stop the cue list: lights out, GO starts from the first cue"], ["kill 3", "…fading out over 3 s"], ["kill all", "kill cues, chases, effects, timecode, fog & haze (also: panic)"], ["pause", "hold a fade where it is"], ["resume", "carry on"], ["top", "back to the top of the list, lights stay"], ["go 5 in 2", "cue 5 in 2 s"], ["snap 5", "cue 5 instantly"], ["set next 7", "GO plays cue 7 next"], ["skip", "skip the next cue"], ["again", "play the live cue again"], ["what's next", "the next cue and its GO note"], ["go to scene let it go", "GO goes to the start of a scene"], ["cue 5 gonote first chorus", "what the operator GOes on"]]],
    ["Windows & pages", [["open palettes", "open a window (cue list, timecode, tracking sheet…)"], ["close palettes", "close it"], ["dock all", "put every window back"], ["page faders", "go to a page (live, patch, inspector, chases, effects, qlab, faders, magic, or 1–4)"], ["blind", "blind mode"], ["live", "live mode"], ["screen zoom 120", "make everything bigger"]]],
    ["Outputs & levels", [["output off", "stop DMX output (output on to start)"], ["qlab connect", "connect to QLab"], ["midi connect", "connect MIDI (also learn, refresh)"], ["remote on", "the phone remote"], ["master 80", "grand master to 80%"], ["fader 3 @ 50", "a fader to 50%"], ["fader 3 flash", "flash it"], ["select lit", "every light that's on (also unlit, colour, all, none, invert)"], ["what's on", "every light that's on, and its level"], ["running", "which chases and effects are running"]]],
    ["Visualiser", [["viz views 4", "3D, plan, front and side"], ["viz view plan", "a camera view (or one you saved)"], ["viz picture", "save a picture to Downloads"], ["viz record", "record a video (viz stop to save)"], ["viz lights", "the lights table"], ["viz haze 30", "room haze"], ["viz house on", "house lights (also work, grid, targets)"], ["viz plot", "the lighting plot"]]],
    ["Show tools", [["show starter", "Frozen colours, song cues, area groups"], ["tracking sheet", "every light's level in every cue"], ["timeline", "the song timeline"], ["cue sheet", "a printable cue sheet"], ["tempo 120", "the BPM effects follow (tap to tap it)"], ["fog limit 10", "longest the fog may run"], ["atmos off", "fog and haze off"]]]
  ];

  const isWindow = name => Boolean(WINDOWS[name] || (window.LXWindows?.list?.() || []).includes(name));
  window.LXMoreCommands = Object.freeze({ isWindow, command, kill, killAll, pause, resume, COMMANDS, REFERENCE, slot });
})();
