"use strict";

/*
 * Show control: MIDI Show Control (MSC) in and out, MIDI timecode (MTC) in,
 * and audio timecode (LTC) in. Settings: Preferences → Show Control.
 *
 * MSC in (from QLab, another desk, a show controller):
 *   GO [cue]       go to that cue (or GO = the next cue)
 *   TIMED_GO       go to the cue in the time given
 *   STOP / RESUME  freeze the running fade / carry on to the cue
 *   GO_OFF         fade everything out
 *   RESET          stop effects and chases, next cue back to cue 1
 *   ALL_OFF / RESTORE   blackout on / off
 *   FIRE n         run effect n (in the effects list's order)
 * Light Spark answers its own device ID (or any, by default) and 127, the
 * "all call", for Lighting (General), Moving Lights and All-types formats.
 *
 * MSC out: every time a cue fires, Light Spark sends "GO <cue>" so sound,
 * video or another desk can follow it.
 *
 * MTC and LTC feed js/timecode.js, which fires cues that have a time.
 *
 *   LXShowControl.handleMidi(bytes, portName)   (also used by the tests)
 *   LXShowControl.encodeMsc(command, cue, device)
 */
(function () {
  if (window.LXShowControl) return;

  const S = () => window.State;
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;
  const say = (m, l = "info") => window.log?.(`🎛 ${m}`, l);
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------- MIDI

  let access = null, accessError = "";
  async function startMidi() {
    if (access || !navigator.requestMIDIAccess) return access;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
      access.onstatechange = () => { attachInputs(); renderPanels(); };
      attachInputs();
    } catch (error) {
      accessError = error?.message || String(error);
    }
    renderPanels();
    return access;
  }
  function attachInputs() {
    if (!access) return;
    access.inputs.forEach(input => { input.onmidimessage = e => handleMidi(e.data, input.name); });
  }
  const inputNames = () => (access ? [...access.inputs.values()].map(p => p.name) : []);
  const outputNames = () => (access ? [...access.outputs.values()].map(p => p.name) : []);

  let fromMsc = false; // a GO that came in by MSC isn't sent back out
  function handleMidi(data, port = "") {
    const d = data instanceof Uint8Array ? data : Uint8Array.from(data || []);
    if (!d.length) return;
    if (d[0] === 0xf1) return quarterFrame(d[1] ?? 0, port);
    if (d[0] !== 0xf0 || d[1] !== 0x7f) return;
    // F0 7F <device> 01 01 hh mm ss ff F7: MTC full frame (a locate)
    if (d[3] === 0x01 && d[4] === 0x01) return fullFrame(d, port);
    // F0 7F <device> 02 <format> <command> <data…> F7: MSC
    if (d[3] === 0x02) return msc(d, port);
  }

  // ----------------------------------------------------------- MSC in

  const MSC = { GO: 0x01, STOP: 0x02, RESUME: 0x03, TIMED_GO: 0x04, FIRE: 0x07, ALL_OFF: 0x08, RESTORE: 0x09, RESET: 0x0a, GO_OFF: 0x0b };
  const FORMATS = new Set([0x01, 0x02, 0x7f]); // Lighting (General), Moving Lights, All-types

  function msc(d, port) {
    if (pref("mscIn", true) === false) return;
    const wantPort = pref("mscInPort", "any");
    if (wantPort !== "any" && port && port !== wantPort) return;
    const device = d[2], want = pref("mscInDevice", "any");
    if (want !== "any" && device !== 0x7f && device !== Number(want)) return;
    const format = d[4], command = d[5];
    if (!FORMATS.has(format)) return;
    const end = d.indexOf(0xf7) > 0 ? d.indexOf(0xf7) : d.length;
    let payload = [...d.subarray(6, end)];
    let time = null;
    if (command === MSC.TIMED_GO) {
      const [hr, mn, sc, fr, ff = 0] = payload;
      time = ((hr & 0x1f) * 3600 + mn * 60 + sc + (fr + ff / 100) / 30) * 1000;
      payload = payload.slice(5);
    }
    // Cue number, cue list, path: ASCII separated by 00.
    const fields = payload.map(b => (b === 0 ? "\u0000" : String.fromCharCode(b))).join("").split("\u0000");
    const cue = fields[0] ? fields[0].trim() : "";
    run(command, cue, time, port);
  }

  function cueIndex(text) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) {
      say(`MSC cue ${text}: Light Spark cues are whole numbers — using cue ${Math.floor(n)}`, "warn");
    }
    const i = Math.floor(n) - 1;
    return S().cues?.[i] ? i : -1;
  }

  function run(command, cue, timeMs, port) {
    const s = S();
    const name = Object.keys(MSC).find(k => MSC[k] === command) || `0x${command.toString(16)}`;
    const from = port ? ` (from ${port})` : "";
    fromMsc = true;
    try {
      switch (command) {
        case MSC.GO:
        case MSC.TIMED_GO: {
          if (!cue) { window.goNextCue?.(timeMs); return say(`MSC GO${from}`, "ok"); }
          const i = cueIndex(cue);
          if (i == null) return;
          if (i < 0) return say(`MSC GO ${cue}${from} — there's no cue ${cue}`, "warn");
          window.goToCue?.(i, timeMs);
          return say(`MSC ${name === "TIMED_GO" ? `TIMED GO (${(timeMs / 1000).toFixed(1)} s)` : "GO"} cue ${cue}${from}`, "ok");
        }
        case MSC.STOP:
          window.stopCueTimers?.();
          return say(`MSC STOP${from} — fade held`, "ok");
        case MSC.RESUME:
          if (s.currentCue >= 0) window.goToCue?.(s.currentCue);
          return say(`MSC RESUME${from}`, "ok");
        case MSC.GO_OFF:
          window.clearProgrammer?.();
          if (s.currentCue >= 0) {
            const ids = (s.fixtures || []).map(f => f.id);
            window.fadeTo?.({ intensity: 0 }, Number(s.cues[s.currentCue]?.fade ?? 800), ids.map(id => [id, { ...window.ensureFixtureState(id), intensity: 0 }]));
            s.currentCue = -1;
            window.renderCues?.();
          }
          return say(`MSC GO OFF${from}`, "ok");
        case MSC.RESET:
          window.stopEffect?.(true);
          window.stopChase?.(false);
          s.nextCue = s.cues?.findIndex(Boolean) ?? null;
          window.LXCueList?.setNext?.(s.nextCue);
          return say(`MSC RESET${from} — next cue is cue ${(s.nextCue ?? 0) + 1}`, "ok");
        case MSC.ALL_OFF:
          if (!s.blackout) window.consoleBlackout?.();
          return say(`MSC ALL OFF${from} — blackout`, "ok");
        case MSC.RESTORE:
          if (s.blackout) window.consoleBlackout?.();
          return say(`MSC RESTORE${from}`, "ok");
        case MSC.FIRE: {
          const n = Number(cue) || 0;
          const effect = Object.values(s.savedEffects || {})[n - 1];
          if (!effect) return say(`MSC FIRE ${n}${from} — there's no effect ${n}`, "warn");
          window.applySavedEffect?.(effect.name);
          return say(`MSC FIRE ${n}${from} — effect “${effect.name}”`, "ok");
        }
        default:
          return say(`MSC ${name}${from} isn't something Light Spark does`, "info");
      }
    } finally {
      fromMsc = false;
    }
  }

  // ---------------------------------------------------------- MSC out

  function encodeMsc(command, cue = "", device = 1, format = 0x01) {
    const bytes = [0xf0, 0x7f, Number(device) & 0x7f, 0x02, format, command];
    for (const ch of String(cue)) bytes.push(ch.charCodeAt(0) & 0x7f);
    bytes.push(0xf7);
    return bytes;
  }
  function sendMsc(command, cue) {
    if (!access || pref("mscOut", false) !== true) return false;
    const name = pref("mscOutPort", "");
    const port = [...access.outputs.values()].find(p => p.name === name) || (!name ? [...access.outputs.values()][0] : null);
    if (!port) return false;
    try { port.send(encodeMsc(command, cue, pref("mscOutDevice", "1"))); return true; } catch (e) { say(`MSC out failed: ${e.message}`, "warn"); return false; }
  }
  function hookGo() {
    if (typeof window.goToCue !== "function" || window.goToCue.__lxMsc) return Boolean(window.goToCue?.__lxMsc);
    const original = window.goToCue;
    const wrapped = function (index) {
      const result = original.apply(this, arguments);
      if (result && !fromMsc && pref("mscOut", false) === true) sendMsc(MSC.GO, String(Number(index) + 1));
      return result;
    };
    Object.assign(wrapped, original);
    wrapped.__lxMsc = true;
    window.goToCue = wrapped;
    return true;
  }

  // -------------------------------------------------------------- MTC

  const RATES = [24, 25, 29.97, 30];
  const mtc = { pieces: new Array(8).fill(0), seen: 0, last: -1, fps: 25 };
  function quarterFrame(byte, port) {
    const want = pref("tcMtcPort", "any");
    if (want !== "any" && port && port !== want) return;
    const piece = (byte >> 4) & 7, value = byte & 15;
    mtc.pieces[piece] = value;
    mtc.seen |= 1 << piece;
    // A full time every 8 pieces; it was true 2 frames ago when piece 0 began.
    if (piece === 7 && mtc.seen === 0xff) {
      const p = mtc.pieces;
      const f = p[0] | (p[1] << 4), s = p[2] | (p[3] << 4), m = p[4] | (p[5] << 4), h = p[6] | ((p[7] & 1) << 4);
      mtc.fps = RATES[(p[7] >> 1) & 3];
      const seconds = h * 3600 + m * 60 + s + (f + 2) / mtc.fps;
      mtc.seen = 0;
      window.LXTimecode?.feed(seconds, "mtc", mtc.fps);
    }
  }
  function fullFrame(d, port) {
    const want = pref("tcMtcPort", "any");
    if (want !== "any" && port && port !== want) return;
    const hr = d[5] ?? 0, mn = d[6] ?? 0, sc = d[7] ?? 0, fr = d[8] ?? 0;
    mtc.fps = RATES[(hr >> 5) & 3];
    const seconds = (hr & 0x1f) * 3600 + mn * 60 + sc + fr / mtc.fps;
    mtc.seen = 0;
    window.LXTimecode?.feed(seconds, "mtc", mtc.fps);
    window.LXTimecode?.halt("mtc"); // a locate: parked until quarter frames run again
  }

  // -------------------------------------------------------------- LTC

  let ltc = null; // { ctx, stream, node, decoder, device }
  async function startLtc() {
    const device = pref("tcLtcDevice", "");
    if (ltc && ltc.device === device) return;
    stopLtc();
    if (!navigator.mediaDevices?.getUserMedia || !window.LTCDecoder) return say("Audio timecode needs a sound input — none found", "warn");
    try {
      if (window.LXApp?.askMicrophone && !(await window.LXApp.askMicrophone())) return say("Light Spark isn't allowed to use the sound input — allow it in System Settings → Privacy & Security → Microphone", "warn");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(2048, 1, 1);
      let lastFrame = null;
      const decoder = new window.LTCDecoder(ctx.sampleRate, fr => {
        // Frame rate: from how the frame count wraps (24/25/30), or 29.97 drop-frame.
        if (lastFrame && fr.f === 0 && lastFrame.f >= 23) ltc.fps = fr.dropFrame ? 29.97 : lastFrame.f + 1;
        lastFrame = fr;
        const fps = ltc.fps || Number(pref("tcFps", 25)) || 25;
        window.LXTimecode?.feed(fr.h * 3600 + fr.m * 60 + fr.s + (fr.f + 1) / fps, "ltc", fps);
      });
      node.onaudioprocess = e => decoder.push(e.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(ctx.destination); // ScriptProcessor only runs when connected; it outputs silence
      ltc = { ctx, stream, node, decoder, device, fps: 0 };
      say(`Listening for audio timecode on ${stream.getAudioTracks()[0]?.label || "the default input"}`, "ok");
    } catch (error) {
      say(`Couldn't open the sound input for timecode: ${error.message}`, "warn");
    }
  }
  function stopLtc() {
    if (!ltc) return;
    try { ltc.node.disconnect(); ltc.stream.getTracks().forEach(t => t.stop()); ltc.ctx.close(); } catch (_) {}
    ltc = null;
  }
  async function audioInputs() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); } catch (_) { return []; }
  }

  function applySource() {
    const src = pref("tcSource", "off");
    if (src === "ltc") startLtc(); else stopLtc();
    if (src === "mtc" || pref("mscIn", true) || pref("mscOut", false)) startMidi();
  }

  // ------------------------------------------------------ Preferences

  async function renderPanels() {
    const P = window.LXPrefs;
    if (!P?.addPanel || !P.kit) return;
    const { row, seg, check, number, esc } = P.kit;
    const opt = (key, list, first) => `<select class="lx-select" data-pref="${key}">${[first, ...list].filter(Boolean).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
    const ins = inputNames().map(n => [n, n]), outs = outputNames().map(n => [n, n]);
    const keep = (key, list) => { const v = pref(key, ""); return v && v !== "any" && !list.some(([x]) => x === v) ? [...list, [v, `${v} (not connected)`]] : list; };
    const devices = [["any", "Any"], ...Array.from({ length: 127 }, (_, i) => [String(i), String(i)])];
    const midiNote = access ? (ins.length || outs.length ? "" : "No MIDI ports found — connect one, or use the Mac's IAC Driver to talk to QLab on the same computer.") : accessError ? `MIDI isn't available: ${esc(accessError)}` : "Starting MIDI…";
    P.addPanel("showcontrol", "prefMsc", "MIDI Show Control", "SHOW CONTROL",
      row("Receive MSC", "Let QLab or another controller GO cues by MIDI Show Control.", check("mscIn")) +
      row("Listen on", "Which MIDI input MSC comes in on.", opt("mscInPort", keep("mscInPort", ins), ["any", "Any input"])) +
      row("Device ID", "Light Spark's MSC device ID. Any answers every ID; 127 (all call) always works.", opt("mscInDevice", devices.slice(1, 128), ["any", "Any"])) +
      row("Send MSC", "Send “GO cue N” whenever a cue fires, so sound, video or another desk can follow.", check("mscOut")) +
      row("Send on", "Which MIDI output MSC goes out on.", opt("mscOutPort", keep("mscOutPort", outs), ["", outs.length ? "First output" : "No outputs"])) +
      row("Send to device ID", "The device ID the receiver answers to (127 = everyone).", opt("mscOutDevice", devices.slice(1, 128))) +
      `<div class="lx-pref-note">${midiNote || `Inputs: ${esc(inputNames().join(", "))}. Outputs: ${esc(outputNames().join(", ") || "none")}.`} Light Spark understands GO, TIMED GO, STOP, RESUME, GO OFF, RESET, ALL OFF, RESTORE and FIRE (effects).</div>`);
    const audio = (await audioInputs()).map(d => [d.deviceId, d.label || "Sound input"]);
    P.addPanel("showcontrol", "prefTimecode", "Timecode", "SHOW CONTROL",
      row("Timecode source", "Where the time comes from: MTC is MIDI timecode, LTC is timecode audio from a sound input, Internal is Light Spark's own clock. Cues with a time fire when it passes.", seg("tcSource", [["off", "Off"], ["mtc", "MTC"], ["ltc", "LTC"], ["internal", "Internal"]])) +
      row("MTC input", "Which MIDI input MIDI timecode comes in on.", opt("tcMtcPort", keep("tcMtcPort", ins), ["any", "Any input"])) +
      row("LTC input", "The sound input with the timecode audio on it (a spare channel from the sound desk).", opt("tcLtcDevice", keep("tcLtcDevice", audio), ["", "Default input"])) +
      row("Frame rate", "For the internal clock and how times are shown. MTC and LTC tell Light Spark their own rate.", seg("tcFps", [["24", "24"], ["25", "25"], ["29.97", "29.97"], ["30", "30"]])) +
      row("Timecode fires cues", "Off: watch the time without firing anything.", check("tcTrigger")) +
      row("When the time jumps", "If someone skips around in the sound desk, put up the right cue straight away (snap) or with its own fade.", seg("tcJump", [["snap", "Snap"], ["fade", "Fade"]])) +
      row("Freewheel", "If timecode drops out, keep counting this long before stopping, so a glitch doesn't stop the show.", number("tcFreewheelMs", 0, 30, 0.1, "s", 1000)) +
      row("Note it in the log", "A line in the log when timecode fires a cue.", check("tcLog")) +
      `<div class="lx-pref-note">Give cues a time in the Cue List's TC column (double-click), with “Set next cue to this time” in the Timecode window, or type <b>timecode cue 5 00:01:30:00</b>. Open the window from Windows → Timecode.</div>`);
  }

  // ---------------------------------------------------------- commands

  function installCommands() {
    const previous = window.parseCommand;
    if (typeof previous !== "function" || previous.__lxShowControl) return;
    const wrapped = function (raw) {
      const c = String(raw ?? "").trim().toLowerCase();
      let m;
      if (c === "timecode" || c === "tc") { window.LXTimecode?.open(); return; }
      if ((m = c.match(/^(?:timecode|tc)\s+cue\s+(\d+)\s+(.+)$/))) {
        const i = Number(m[1]) - 1;
        if (/^(off|none|clear)$/.test(m[2])) { window.LXTimecode?.setCue(i, null); return say(`Cue ${m[1]} has no time now`, "ok"); }
        const t = window.LXTimecode?.parse(m[2]);
        if (t == null) return say("Times look like 00:01:30:00", "warn");
        if (!window.LXTimecode?.setCue(i, t)) return say(`Cue ${m[1]} not found`, "warn");
        return say(`Cue ${m[1]} fires at ${window.LXTimecode.format(t)}`, "ok");
      }
      if ((m = c.match(/^(?:timecode|tc)\s+(off|mtc|ltc|internal)$/))) { window.LXPrefs?.set("tcSource", m[1]); return say(`Timecode source: ${m[1]}`, "ok"); }
      if (c === "tc play") return window.LXTimecode?.play();
      if (c === "tc pause") return window.LXTimecode?.pause();
      if (c === "tc stop") return window.LXTimecode?.stop();
      if ((m = c.match(/^tc\s+locate\s+(.+)$/))) { const t = window.LXTimecode?.parse(m[1]); if (t != null) window.LXTimecode.locate(t); return; }
      return previous.apply(this, arguments);
    };
    wrapped.__lxShowControl = true;
    window.parseCommand = wrapped;
    if (typeof commandDefs !== "undefined" && !commandDefs.__lxTc) {
      commandDefs.__lxTc = true;
      commandDefs.push({ cmd: "timecode", hint: "— the Timecode window" }, { cmd: "timecode cue", hint: "N 00:01:30:00 — when cue N fires" }, { cmd: "tc play", hint: "/ pause / stop / locate 00:01:00:00 (internal clock)" });
    }
  }

  function boot(tries = 0) {
    hookGo();
    installCommands();
    applySource();
    renderPanels();
    const ready = window.goToCue?.__lxMsc && window.parseCommand?.__lxShowControl;
    if (!ready && tries < 40) setTimeout(() => boot(tries + 1), 250);
  }
  window.addEventListener("load", () => setTimeout(boot, 900));
  window.LXPrefs?.on?.(key => {
    if (/^(tcSource|tcLtcDevice|mscIn|mscOut)$/.test(key)) applySource();
  });

  window.LXShowControl = Object.freeze({ handleMidi, encodeMsc, sendMsc, startMidi, inputs: inputNames, outputs: outputNames, refresh: renderPanels, MSC });
})();
