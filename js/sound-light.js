"use strict";

/*
 * Sound to light: the music effects move with the music's beat. Ways in,
 * best first:
 *
 *  - Ableton Link (link-sync.js): Serato DJ Pro with Link on (and LINK on
 *    the decks), Rekordbox, Traktor, djay, Ableton Live… share the exact
 *    tempo and where the beat is over the network. No microphone. "link on".
 *
 *  - From the DJ software (best): VirtualDJ sends every beat of the playing
 *    track over OS2L (see os2l-link.js), straight from its beat grid: exact.
 *    "dj on", or just "party". In VirtualDJ: Settings → Options, "os2l" → Yes.
 *  - Serato DJ (Lite or Pro): it saves each song's analysis (exact BPM,
 *    beat grid) and rewrites it the moment a song starts (serato-link.js).
 *    The tempo is then known exactly and at once; listening finds where the
 *    beat is from the next kick. "serato on" (party and sound on start it).
 *  - By listening (any DJ software, e.g. Serato DJ Lite): any sound input,
 *    a cable from the DJ controller, a loopback of the computer's own sound,
 *    or the mic. Light Spark finds the beat and the tempo itself.
 *
 * Lights shouldn't react after a beat is heard (that's always late), so it
 * runs its own beat clock at the music's tempo, which every kick drum it
 * hears pulls back into line. Lights fire on the clock's beat: on time even
 * when the sound arrives late or a kick is missed, and steady through a
 * breakdown. "sound offset" moves every beat earlier or later.
 *
 * The tempo it finds becomes the show tempo, so chases and effects set to
 * follow the tempo (Effects → Follow tempo) keep in step too.
 *
 *   dj on / dj off             take the beat from VirtualDJ (OS2L)
 *   sound on / sound off       listen (on the input chosen in "sound inputs")
 *   sound                      what it hears: tempo, how sure, level
 *   sound inputs               the sound inputs; sound input 2 picks one
 *   sound offset -40           lights 40 ms earlier (+ = later)
 *   sound sensitivity 7        1-10: higher hears quieter kicks
 *   party                      an automatic light show to the music, on the
 *                              selected lights (or every light); takes the
 *                              beat from VirtualDJ, or listens if none comes
 *
 * VirtualDJ's lighting buttons (OS2L "btn") run their name as a command, so a
 * button called "party" or "go" or "cue 5" does that.
 *   party off
 *   beat flash / beat colour / beat chase / sound level   one music effect
 *
 * Music effects (also in the effect editor, so they can be saved and put in
 * cues): beatflash, beatcolour, beatchase, soundlevel, party. Without the
 * sound on they follow the show tempo.
 *
 *   LXSound.state()   { listening, bpm, sure, beat, phase, energy, hit, drop }
 */
(function () {
  if (window.LXSound) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(`♪ ${m}`, t);
  const pref = (k, d) => { try { const v = localStorage.getItem(`lxSound.${k}`); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(`lxSound.${k}`, JSON.stringify(v)); } catch (_) {} };

  // ------------------------------------------------------------ listening

  let ctx = null, stream = null, analyser = null, timer = null, freq = null, prev = null, wave = null;
  let inputName = "";
  const settings = { device: pref("device", ""), offset: pref("offset", 0), sensitivity: pref("sensitivity", 5), tempo: pref("tempo", true) };

  // What the detector knows.
  const st = {
    listening: false, bpm: 0, sure: 0,
    beat: 0, nextBeat: 0, lastBeatAt: 0,   // the clock: beat count, when the next one is due (ms)
    energy: 0, peak: 1e-4, bass: 0, bassPeak: 1e-4,
    onsets: [], flux: [], lastOnset: 0, above: false,
    slowBass: [], dropAt: -1e9, heardAt: 0,
    djAt: -1e9, djStrength: null, djOn: false   // OS2L: when its last beat came
  };
  const fromDj = (now = performance.now()) => now - st.djAt < 4000;
  // Ableton Link: the session's timeline in ms since 1970 (link-sync.js).
  const epochNow = () => performance.timeOrigin + performance.now();
  // A Link session the music isn't following (Serato's decks not on LINK:
  // the session sits at 120) is ignored, and listening takes over.
  const linked = () => Boolean(st.link) && !st.linkIgnored;
  const linkBeats = (ms = epochNow()) => st.link.beatOrigin + (ms - settings.offset - st.link.timeOriginMs) * st.link.bpm / 60000;
  const live = () => linked() || ((st.listening || fromDj()) && st.bpm > 0);

  async function start(device = settings.device) {
    stop(true);
    if (!navigator.mediaDevices?.getUserMedia) { say("This computer can't listen to sound", "warn"); return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      say(device ? `Couldn't open that sound input (${e.message || e.name}) — trying the default` : `Couldn't listen: ${e.message || e.name}. Allow Light Spark to use the microphone in System Settings → Privacy & Security → Microphone`, "warn");
      if (device) return start("");
      return false;
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    freq = new Float32Array(analyser.frequencyBinCount);
    prev = new Float32Array(analyser.frequencyBinCount);
    wave = new Float32Array(analyser.fftSize);
    inputName = stream.getAudioTracks()[0]?.label || "default input";
    Object.assign(st, { listening: true, bpm: 0, sure: 0, onsets: [], flux: [], slowBass: [], nextBeat: 0, heardAt: performance.now() });
    timer = setInterval(tick, 8);
    badge();
    say(`Listening to ${inputName} — finding the beat…`);
    return true;
  }

  function stop(quiet = false) {
    clearInterval(timer); timer = null;
    try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { ctx?.close(); } catch (_) {}
    stream = ctx = analyser = null;
    const was = st.listening;
    st.listening = false;
    badge();
    if (was && !quiet) say("Stopped listening — music effects follow the show tempo", "info");
  }

  // Bass bins: about 40-180 Hz, where the kick drum is.
  function bassRange() {
    const hz = ctx.sampleRate / analyser.fftSize;
    return [Math.max(1, Math.round(40 / hz)), Math.max(2, Math.round(180 / hz))];
  }

  function tick() {
    if (!analyser) return;
    const now = performance.now();
    analyser.getFloatFrequencyData(freq);
    analyser.getFloatTimeDomainData(wave);
    // Loudness (for how busy the lights are), with its own slow auto-gain.
    let sum = 0;
    for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
    const rms = Math.sqrt(sum / wave.length);
    // Loudness against the last ~15 s: a steady track sits near 0.75, a
    // breakdown drops, a drop jumps.
    st.loud = (st.loud ?? rms) + (rms - (st.loud ?? rms)) * 0.04;          // ~0.2 s
    st.longLoud = Math.max(1e-4, (st.longLoud ?? rms) + (rms - (st.longLoud ?? rms)) * 0.0005);   // ~15 s
    st.energy = Math.max(0, Math.min(1, 0.75 * st.loud / st.longLoud));
    // Kick drum: how much the bass jumped since the last look (spectral flux).
    const [lo, hi] = bassRange();
    let flux = 0, bass = 0;
    for (let i = lo; i <= hi; i++) {
      const m = Math.pow(10, freq[i] / 20);
      bass += m;
      flux += Math.max(0, m - prev[i]);
      prev[i] = m;
    }
    bass /= (hi - lo + 1);
    st.bassPeak = Math.max(bass, st.bassPeak * 0.9995, 1e-6);
    st.bass += ((bass / st.bassPeak) - st.bass) * 0.05;
    // An onset: well above what the last second has been doing.
    st.flux.push(flux);
    if (st.flux.length > 125) st.flux.shift();
    const mean = st.flux.reduce((a, b) => a + b, 0) / st.flux.length;
    const sd = Math.sqrt(st.flux.reduce((a, b) => a + (b - mean) ** 2, 0) / st.flux.length);
    const k = 2.6 - (Math.max(1, Math.min(10, settings.sensitivity)) - 1) * 0.2;  // 1 → 2.6 sd, 10 → 0.8 sd
    const loudEnough = rms > 0.003;
    const over = flux > mean + k * sd && flux > 1e-5 && loudEnough;
    if (over && !st.above && now - st.lastOnset > 260) onset(now);
    st.above = over;
    if (loudEnough) st.heardAt = now;
    // Drop: the bass comes back hard after a quieter stretch.
    st.slowBass.push(st.bass);
    if (st.slowBass.length > 1000) st.slowBass.shift();     // ~8 s
    if (st.slowBass.length > 600 && now - st.dropAt > 16000) {
      const before = st.slowBass.slice(0, -125), recent = st.slowBass.slice(-60);
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      if (avg(before.slice(-375)) < 0.3 && avg(recent) > 0.65) { st.dropAt = now; window.dispatchEvent(new CustomEvent("lx-sound-drop")); }
    }
    clock(now);
  }

  // Each kick: remember it, work the tempo out again, and pull the beat clock towards it.
  // A new song (a cut, or the end of a blend) shows up as kicks that keep
  // landing off the clock: then it forgets the old track, works the tempo
  // out from the last few seconds and jumps onto the new beat.
  function onset(now) {
    st.lastOnset = now;
    st.onsets.push(now);
    while (st.onsets.length && now - st.onsets[0] > 8000) st.onsets.shift();
    estimateTempo();
    if (!st.bpm) return;
    let period = 60000 / st.bpm;
    if (!st.nextBeat) { st.nextBeat = now + period; st.beat++; st.lastBeatAt = now; beatHappened(); return; }
    // How far this kick is from the nearest beat of the clock (fraction of a beat).
    const last = st.nextBeat - period;
    const error = Math.abs(now - last) < Math.abs(now - st.nextBeat) ? now - last : now - st.nextBeat;
    const e = error / period;
    st.errs = [...(st.errs || []), e].slice(-4);
    if (Math.abs(e) < 0.12) { st.nextBeat += error * 0.35; return; }   // on the beat: a gentle pull
    if (st.sure < 0.4) { st.nextBeat = now + period; st.errs = []; return; }   // not locked yet: jump onto it
    const off = st.errs.filter(x => Math.abs(x) >= 0.12);
    if (off.length < 3) return;                                // one stray kick: ignore it
    const mean = off.reduce((a, b) => a + b, 0) / off.length;
    const spread = Math.max(...off) - Math.min(...off);
    if (spread < 0.12) {
      // Same tempo, beat moved (a blend finished on a track a little out): jump onto it.
      st.nextBeat += mean * period;
    } else {
      // A different tempo: start again from the last 3 seconds.
      st.onsets = st.onsets.filter(t => now - t <= 3000);
      estimateTempo(true);
      period = 60000 / st.bpm;
      st.nextBeat = now + period;
    }
    st.errs = [];
  }

  // Tempo: which beat length best explains the kicks of the last 8 seconds.
  // DJ music sits between 80 and 175 BPM.
  function estimateTempo(fresh = false) {
    const t = st.onsets;
    if (t.length < (fresh ? 4 : 6)) return;
    // The latest kicks count most, so a new song takes over quickly.
    const newest = t[t.length - 1];
    let best = 0, bestScore = 0, total = 0;
    // Serato told us the song's tempo: only look for the pitch fader moving
    // it (±8%). Otherwise anything from 70 to 180 BPM.
    const grid = st.grid && performance.now() - st.gridAt < 20 * 60000 ? st.grid : 0;
    const [lo, hi, step] = grid ? [grid * 0.92, grid * 1.08, grid * 0.0025] : [70, 180, 0.5];
    for (let bpm = lo; bpm <= hi; bpm += step) {
      const period = 60000 / bpm;
      let score = 0;
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const dt = t[j] - t[i];
        if (dt > 4 * period + 100) break;
        const n = Math.round(dt / period);
        if (n < 1 || n > 4) continue;
        const off = (dt - n * period) / (period * 0.06);
        score += Math.exp(-off * off) / n * Math.exp(-(newest - t[j]) / 3000);
      }
      total += score;
      if (score > bestScore) { bestScore = score; best = bpm; }
    }
    if (!best) return;
    // How sure: against what the same kicks would score if perfectly in time.
    let ideal = 0;
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { const dt = t[j] - t[i], n = Math.round(dt / (60000 / best)); if (n >= 1 && n <= 4 && dt <= 4 * 60000 / best + 100) ideal += Math.exp(-(newest - t[j]) / 3000) / n; }
    const sure = Math.min(1, bestScore / Math.max(1e-9, ideal));
    // Small changes ease in; a different tempo takes over once it's clearly right.
    if (!st.bpm || fresh || Math.abs(best - st.bpm) / st.bpm > 0.04) { if (sure > 0.6 || !st.bpm || fresh) st.bpm = best; }
    else st.bpm += (best - st.bpm) * 0.3;
    st.sure += (sure - st.sure) * 0.3;
    if (settings.tempo && window.LXTempo && st.sure > 0.4 && Math.abs((window.LXTempo.bpm?.() ?? 0) - st.bpm) >= 0.5) {
      try { window.LXTempo.set(Math.round(st.bpm * 2) / 2, { quiet: true }); } catch (_) {}
    }
  }

  // The beat clock: a beat each period, shifted by the offset.
  function clock(now) {
    if (!st.bpm || !st.nextBeat) return;
    const period = 60000 / st.bpm;
    if (!fromDj(now) && now - st.heardAt > 6000) st.sure *= 0.999;   // music stopped: keep time, but less sure
    // The DJ software's beats lead; the clock only fills in a late or missing one.
    const grace = fromDj(now) ? period * 0.25 : 0;
    while (now >= st.nextBeat + settings.offset + grace) {
      st.lastBeatAt = st.nextBeat + settings.offset;
      st.nextBeat += period;
      st.beat++;
      beatHappened();
    }
  }

  let beatListeners = [];
  function beatHappened() {
    pulseBadge();
    for (const f of beatListeners) { try { f(st.beat); } catch (_) {} }
  }

  // ------------------------------------------------------------ from the DJ software (OS2L)

  let djTimer = null;
  function djMessage(msg) {
    const now = performance.now();
    if (msg.evt === "beat") {
      const bpm = Number(msg.bpm);
      if (!(bpm > 20 && bpm < 400)) return;
      const first = !fromDj(now);
      st.bpm = bpm; st.sure = 1; st.djAt = now;
      st.djStrength = Number.isFinite(Number(msg.strength)) ? Math.max(0, Math.min(1, Number(msg.strength))) : null;
      if (Number.isFinite(Number(msg.pos))) st.beat = Math.floor(Number(msg.pos)); else st.beat++;
      st.lastBeatAt = now + settings.offset;
      st.nextBeat = now + 60000 / bpm;
      beatHappened();
      if (settings.tempo && window.LXTempo && Math.abs((window.LXTempo.bpm?.() ?? 0) - bpm) >= 0.5) { try { window.LXTempo.set(Math.round(bpm * 2) / 2, { quiet: true }); } catch (_) {} }
      if (first) { badge(); say(`Beat from the DJ software: ${Math.round(bpm)} BPM`); }
      if (!djTimer) djTimer = setInterval(() => { if (!st.listening) clock(performance.now()); if (!fromDj() && !st.listening) { clearInterval(djTimer); djTimer = null; badge(); } }, 8);
    } else if (msg.evt === "btn" && /^(on|1|true)$/i.test(String(msg.state ?? "on")) && msg.name) {
      // A VirtualDJ lighting button: its name is a command.
      say(`VirtualDJ: ${msg.name}`, "info");
      window.parseCommand?.(String(msg.name));
    }
  }
  if (window.LXOs2l) {
    window.LXOs2l.onMessage(djMessage);
    window.LXOs2l.onStatus(info => { const was = st.djClients || 0; st.djClients = info.clients; if (info.clients > was) say("VirtualDJ connected — play a track", "ok"); });
  }
  async function djOn(quiet = false) {
    if (!window.LXOs2l) { say("Taking the beat from DJ software needs the Light Spark app", "warn"); return false; }
    if (fromDj()) { say(`${Math.round(st.bpm * 10) / 10} BPM from VirtualDJ (beat ${st.beat})`, "info"); return true; }
    const info = await window.LXOs2l.start();
    st.djOn = Boolean(info?.running);
    if (st.djOn && !quiet) say(`Waiting for VirtualDJ's beat (OS2L, port ${info.port}). In VirtualDJ: Settings → Options → os2l → Yes`, "info");
    else say("Couldn't start the OS2L link", "warn");
    badge();
    return st.djOn;
  }
  // ------------------------------------------------------------ from Serato (serato-link.js)

  // A song started in Serato: its exact tempo now, and the beat locks onto
  // the next kick heard (listening fills in where in the song it is).
  function seratoTrack(t) {
    if (!(t?.bpm > 0)) return;
    if (t.event !== "playing") return;
    st.grid = t.bpm; st.gridAt = performance.now(); st.seratoSong = `${t.service} ${t.id}`;
    st.bpm = t.bpm;
    st.sure = Math.max(st.sure, 0.7);
    st.onsets = []; st.errs = [];
    st.nextBeat = 0;                       // the next kick sets where the beat is
    if (settings.tempo && window.LXTempo) { try { window.LXTempo.set(Math.round(t.bpm * 2) / 2, { quiet: true }); } catch (_) {} }
    badge();
    if (!st.link) say(`Serato: new song, ${Math.round(t.bpm * 10) / 10} BPM${st.listening ? "" : " — sound on to lock the lights to its beat"}`);
    checkLink();
  }
  if (window.LXSerato) window.LXSerato.onTrack(seratoTrack);
  async function seratoOn(quiet = false) {
    if (!window.LXSerato) { if (!quiet) say("The Serato link needs the Light Spark app", "warn"); return false; }
    const info = await window.LXSerato.start();
    st.seratoOn = Boolean(info?.running);
    if (info?.error === "no-serato") { if (!quiet) say("Serato's folder (Music → _Serato_) isn't on this computer", "warn"); }
    else if (st.seratoOn && !quiet) say("Following Serato: each song's tempo as it starts", "info");
    return st.seratoOn;
  }
  async function seratoOff() {
    await window.LXSerato?.stop();
    st.seratoOn = false; st.grid = 0;
    say("Stopped following Serato", "info");
  }

  // ------------------------------------------------------------ Ableton Link

  let linkTimer = null;
  // Serato says the song is (say) 97 BPM but the Link session is at 120:
  // the playing deck isn't on LINK. Same tempo, double or half is fine.
  function checkLink() {
    if (!st.link || !(st.grid > 0) || performance.now() - st.gridAt > 20 * 60000) { if (st.linkIgnored) { st.linkIgnored = false; badge(); } return; }
    const r = st.link.bpm / st.grid;
    const ok = [1, 2, 0.5].some(x => Math.abs(r / x - 1) < 0.09);
    if (!ok && !st.linkIgnored) {
      st.linkIgnored = true;
      st.bpm = st.grid; st.onsets = []; st.errs = []; st.nextBeat = 0;
      say(`Serato's Link is at ${Math.round(st.link.bpm)} BPM but the song is ${Math.round(st.grid)} BPM — press LINK on the deck that's playing. Following the music by listening until then`, "warn");
      if (!st.listening && window.LXSound?.partyRunning?.()) start();
      badge();
    } else if (ok && st.linkIgnored) {
      st.linkIgnored = false;
      say(`Link matches the song now: ${Math.round(st.link.bpm * 10) / 10} BPM`);
      badge();
    }
  }

  function linkTimeline(tl) {
    const was = st.link;
    st.link = tl && tl.bpm > 0 ? tl : null;
    if (!st.link) { if (was) { say("Ableton Link session ended", "info"); badge(); } clearInterval(linkTimer); linkTimer = null; return; }
    if (!st.linkIgnored) { st.bpm = tl.bpm; st.sure = 1; }
    if (!st.linkIgnored && settings.tempo && window.LXTempo && Math.abs((window.LXTempo.bpm?.() ?? 0) - tl.bpm) >= 0.5) { try { window.LXTempo.set(Math.round(tl.bpm * 2) / 2, { quiet: true }); } catch (_) {} }
    if (!was) { say(`Locked to Ableton Link: ${Math.round(tl.bpm * 10) / 10} BPM${tl.peers > 1 ? ` (${tl.peers} apps)` : ""}`); badge(); }
    checkLink();
    // A beat event on every beat of the session.
    if (!linkTimer) {
      st.linkBeat = Math.floor(linkBeats());
      linkTimer = setInterval(() => {
        if (!st.link || st.linkIgnored) return;
        const b = Math.floor(linkBeats());
        if (b !== st.linkBeat) { st.linkBeat = b; st.beat = b; st.lastBeatAt = performance.now(); beatHappened(); }
      }, 4);
    }
  }
  if (window.LXLink) window.LXLink.onTimeline(linkTimeline);
  async function linkOn(quiet = false) {
    if (!window.LXLink) { if (!quiet) say("Ableton Link needs the Light Spark app", "warn"); return false; }
    const info = await window.LXLink.start();
    st.linkOn = Boolean(info?.running);
    if (!quiet) say(st.linkOn ? "Listening for Ableton Link — in Serato DJ Pro, click LINK at the top (and LINK on the decks)" : "Couldn't start Ableton Link", st.linkOn ? "info" : "warn");
    badge();
    return st.linkOn;
  }
  // What Light Spark can see of Link, in words: which step is failing.
  async function linkStatus() {
    if (!window.LXLink) return say("This copy of Light Spark has no Ableton Link — update it and restart it", "warn");
    if (!window.LXLink.status) return say("Restart Light Spark to finish updating Ableton Link", "warn");
    if (!st.linkOn) await linkOn(true);
    await new Promise(r => setTimeout(r, 2500));
    const d = await window.LXLink.status();
    const nets = (d.networks || []).join(", ") || "none";
    say(`Link: ${d.running ? "listening" : "NOT listening"}${d.error ? ` — problem: ${d.error}` : ""} · networks: ${nets} · heard ${d.packets} messages (${d.linkPackets} from Link apps) · ${d.peers} Link app${d.peers === 1 ? "" : "s"} · clock ${d.measured ? "measured" : `not measured (pings ${d.pings}, answers ${d.pongs}${d.mep ? ` to ${d.mep}` : ""})`}${linked() ? ` · LOCKED ${Math.round(st.link.bpm * 10) / 10} BPM` : ""}`, "info");
    if (!d.running) say("Light Spark couldn't open the Link network port. Quit and reopen Light Spark, then try again", "warn");
    else if (!d.linkPackets) say("Nothing from Serato yet: check LINK is on in Serato (top left), and on a Mac: System Settings → Privacy & Security → Local Network → turn Light Spark on, then restart Light Spark", "warn");
    else if (!d.measured) say("Serato was found but didn't answer the clock check — allow Light Spark in Local Network and check no firewall is blocking it", "warn");
  }
  async function linkOff() {
    await window.LXLink?.stop();
    st.linkOn = false; linkTimeline(null);
    say("Stopped following Ableton Link", "info");
  }

  async function djOff() {
    await window.LXOs2l?.stop();
    st.djOn = false; st.djAt = -1e9;
    badge();
    say("Stopped taking the beat from the DJ software", "info");
  }

  // ------------------------------------------------------------ what effects read

  // Where the music is now. Without the sound on: the show tempo's clock.
  function state(now = performance.now()) {
    if (linked()) {
      const b = linkBeats(), period = 60000 / st.link.bpm, beat = Math.floor(b);
      const energy = st.listening ? Math.min(1, st.energy * 1.3) : 0.85;
      return { listening: true, dj: true, link: true, bpm: st.link.bpm, sure: 1, beat, phase: b - beat, period, energy, bass: st.listening ? st.bass : energy, drop: st.listening && now - st.dropAt < period * 4 };
    }
    if (live()) {
      const period = 60000 / st.bpm;
      const since = Math.max(0, now - st.lastBeatAt);
      // Loudness: what's heard if listening, else the DJ software's beat strength.
      const energy = st.listening ? Math.min(1, st.energy * 1.3) : (st.djStrength ?? 0.85);
      return { listening: true, dj: fromDj(now), bpm: st.bpm, sure: st.sure, beat: st.beat + Math.floor(since / period), phase: (since % period) / period, period, energy, bass: st.listening ? st.bass : energy, drop: now - st.dropAt < period * 4 };
    }
    const bpm = window.LXTempo?.bpm?.() || 120, period = 60000 / bpm;
    return { listening: st.listening, bpm, sure: 0, beat: Math.floor(now / period), phase: (now % period) / period, period, energy: st.listening ? Math.min(1, st.energy * 1.3) : 0.8, bass: st.listening ? st.bass : 0.8, drop: false };
  }

  // ------------------------------------------------------------ the music effects

  const PARTY_HUES = [0, 300, 240, 180, 120, 45, 270, 20, 200, 330];
  const flash = phase => Math.exp(-phase * 4);              // full on the beat, gone by the next
  // How lively the lights are: calmer in a breakdown.
  const drive = s => 0.35 + 0.65 * Math.max(0, Math.min(1, s.energy));

  function addEffects() {
    if (typeof FX_TYPES !== "object") return setTimeout(addEffects, 300);
    // Intensity flashes on every beat (o.every: beats between flashes).
    FX_TYPES.beatflash = ["all", (st_, f, c) => {
      const s = state(), every = Math.max(1, Number(c.o.every) || 1);
      const p = ((s.beat % every) + s.phase) / every;
      st_.intensity = fxApplyIntensity(100 * (0.15 + 0.85 * flash(p * every)) * drive(s));
    }];
    // A new colour every beat (o.every beats); o.spread: each light its own.
    FX_TYPES.beatcolour = ["colour", (st_, f, c) => {
      const s = state(), every = Math.max(1, Number(c.o.every) || 1);
      const step = Math.floor(s.beat / every) + (c.o.spread ? c.index * 3 : 0);
      fxSetColour(f, st_, PARTY_HUES[((step % PARTY_HUES.length) + PARTY_HUES.length) % PARTY_HUES.length]);
      fxKeepLit(st_);
    }];
    // One light a beat, bouncing along the lights.
    FX_TYPES.beatchase = ["all", (st_, f, c) => {
      const s = state(), span = Math.max(1, c.count - 1);
      const pos = s.beat % (span * 2), at = pos <= span ? pos : span * 2 - pos;
      st_.intensity = fxApplyIntensity(c.order === at ? 100 * (0.4 + 0.6 * flash(s.phase)) : 6);
    }];
    // Brightness follows how loud the music is.
    FX_TYPES.soundlevel = ["all", (st_, f, c) => {
      const s = state();
      st_.intensity = fxApplyIntensity(100 * Math.max(0.05, Math.min(1, s.bass * 0.7 + s.energy * 0.5)));
    }];
    // The party: a different look every 4 bars, colours change with the
    // bars, flashes on the beat, calmer in breakdowns, white hits on a drop.
    FX_TYPES.party = ["all", (st_, f, c) => {
      // The Party page's settings (js/party-page.js) when it's loaded.
      if (window.LXParty?.frame) return window.LXParty.frame(st_, f, c, state());
      const s = state(), colour = fxCanColour(f), level = drive(s);
      const bar = Math.floor(s.beat / 4), look = Math.floor(s.beat / 16) % 5;
      const hue = PARTY_HUES[bar % PARTY_HUES.length];
      let v = 1, h = hue;
      if (s.drop) { v = flash(s.phase); if (colour) fxSetColour(f, st_, 0, 0, 100); st_.intensity = fxApplyIntensity(100 * v); return; }
      if (look === 0) v = 0.2 + 0.8 * flash(s.phase);                                   // everyone flashes on the beat
      else if (look === 1) { const odd = (c.index + s.beat) % 2 === 0; v = odd ? 0.3 + 0.7 * flash(s.phase) : 0.08; h = odd ? hue : (hue + 180) % 360; }   // odd / even swap
      else if (look === 2) { const span = Math.max(1, c.count - 1), pos = s.beat % (span * 2); v = c.order === (pos <= span ? pos : span * 2 - pos) ? 1 : 0.1; }   // chase on the beat
      else if (look === 3) { h = (hue + (c.index / Math.max(1, c.count)) * 360 + s.beat * 30) % 360; v = 0.55 + 0.45 * flash(s.phase); }   // rainbow across, turning with the beat
      else { v = 0.3 + 0.7 * flash(((s.beat % 2) + s.phase) / 2 * 2); h = PARTY_HUES[(bar + c.index) % PARTY_HUES.length]; }   // two-beat pulse, a colour each
      if (colour) fxSetColour(f, st_, h);
      st_.intensity = fxApplyIntensity(100 * v * level);
    }];
    // In the effect editor.
    const select = document.getElementById("effectType");
    if (select && !select.querySelector('option[value="party"]')) {
      const group = document.createElement("optgroup");
      group.label = "Music (listens to the sound)";
      for (const [v, l] of [["party", "Party (auto light show)"], ["beatflash", "Beat Flash"], ["beatcolour", "Beat Colour"], ["beatchase", "Beat Chase"], ["soundlevel", "Sound Level"]]) {
        const o = document.createElement("option"); o.value = v; o.textContent = l; group.appendChild(o);
      }
      select.insertBefore(group, select.firstChild);
    }
  }

  // ------------------------------------------------------------ the badge

  function css() {
    if (document.getElementById("lxSoundStyle")) return;
    const s = document.createElement("style");
    s.id = "lxSoundStyle";
    s.textContent = `
  #lxSoundBadge{position:fixed;right:14px;bottom:64px;z-index:9000;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border:1px solid var(--border-strong,#333);background:var(--bg-1,#111);color:var(--text,#eee);font:700 12px var(--sans,system-ui);cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)}
  #lxSoundBadge i{width:10px;height:10px;border-radius:50%;background:var(--accent,#19d6a3);opacity:.25;transition:opacity .12s ease-out}
  #lxSoundBadge i.on{opacity:1;transition:none}
  #lxSoundBadge small{font-weight:600;color:var(--text-muted,#999)}`;
    document.head.appendChild(s);
  }
  function badge() {
    css();
    let el = document.getElementById("lxSoundBadge");
    if (!st.listening && !st.djOn && !fromDj() && !st.linkOn && !linked()) { el?.remove(); clearInterval(badge.timer); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "lxSoundBadge";
      el.title = "Light Spark is following the music. Click to stop.";
      el.innerHTML = `<i></i><span>♪ listening…</span><small></small>`;
      el.addEventListener("click", () => { stop(); if (st.djOn) djOff(); });
      document.body.appendChild(el);
    }
    clearInterval(badge.timer);
    badge.timer = setInterval(() => {
      const span = el.querySelector("span"), small = el.querySelector("small");
      if (linked()) { span.textContent = `♪ ${Math.round(st.link.bpm * 10) / 10} BPM`; small.textContent = "Ableton Link"; return; }
      if (fromDj()) { span.textContent = `♪ ${Math.round(st.bpm * 10) / 10} BPM`; small.textContent = "from VirtualDJ"; return; }
      if (!st.listening) { span.textContent = st.linkOn ? "♪ waiting for Link…" : "♪ waiting for VirtualDJ…"; small.textContent = ""; return; }
      span.textContent = st.bpm ? `♪ ${Math.round(st.bpm)} BPM` : "♪ finding the beat…";
      small.textContent = st.bpm ? (st.sure > 0.6 ? "locked" : st.sure > 0.35 ? "nearly" : "listening") + (st.grid ? " · Serato" : "") : `${Math.round(Math.min(1, st.energy) * 100)}%`;
    }, 250);
  }
  function pulseBadge() {
    const dot = document.querySelector("#lxSoundBadge i");
    if (!dot) return;
    dot.classList.add("on");
    setTimeout(() => dot.classList.remove("on"), 90);
  }

  // ------------------------------------------------------------ commands

  async function inputs() {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
      return list;
    } catch (_) { return []; }
  }

  function startMusicEffect(type, options = {}, given = null) {
    const sel = [...(S().selected || [])].map(String);
    // Never the smoke machines.
    const lights = given?.length ? given.map(String) : sel.length ? sel : (S().fixtures || []).filter(f => {
      const map = (typeof fxDefinitionMap === "function" ? fxDefinitionMap(f) : {}) || {};
      return f && f.id != null && typeof map.fog !== "number" && typeof map.haze !== "number" && !/fog|haz|smoke/i.test(f.name || "");
    }).map(f => String(f.id));
    if (!lights.length) return say("Patch some lights first", "warn");
    const name = { party: "Party", beatflash: "Beat Flash", beatcolour: "Beat Colour", beatchase: "Beat Chase", soundlevel: "Sound Level" }[type];
    if (options.fullLevel) { options = { ...options, levels: Object.fromEntries(lights.map(id => [id, 100])) }; delete options.fullLevel; }
    window.startEffect?.(type, { name, fixtureMode: "custom", fixtureIds: lights, speed: 1, ...options });
    return say(`${name} on ${lights.length} light${lights.length === 1 ? "" : "s"}${st.listening || fromDj() || st.djOn || type === "party" ? "" : " — following the show tempo (dj on or sound on to follow the music)"}`);
  }

  async function command(raw) {
    const c = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
    let m;
    if (/^(ableton )?link( on)?$/.test(c)) { await linkOn(); return true; }
    if (/^(ableton )?link off$/.test(c)) { await linkOff(); return true; }
    if (/^(ableton )?link (status|check|\?)$/.test(c)) { await linkStatus(); return true; }
    if (/^serato( on| link)?$/.test(c)) { await seratoOn(); return true; }
    if (/^serato off$/.test(c)) { await seratoOff(); return true; }
    if (/^(dj|virtual ?dj|os2l)( on| link)?$/.test(c)) { await djOn(); return true; }
    if (/^(dj|virtual ?dj|os2l) off$/.test(c)) { await djOff(); return true; }
    if (/^(sound|listen|music) on$|^listen$/.test(c)) { await start(); if (!st.seratoOn) await seratoOn(true); return true; }
    if (/^(sound|listen|music) off$|^stop listening$/.test(c)) { stop(); return true; }
    if (/^(sound|music|dj)( status)?\??$/.test(c)) {
      if (linked()) return say(`${Math.round(st.link.bpm * 100) / 100} BPM from Ableton Link, beat ${Math.floor(linkBeats())}${settings.offset ? ` · offset ${settings.offset} ms` : ""}`, "info"), true;
      if (fromDj()) return say(`${Math.round(st.bpm * 10) / 10} BPM from VirtualDJ (beat ${st.beat})${settings.offset ? ` · offset ${settings.offset} ms` : ""}`, "info"), true;
      if (!st.listening) return say("Not listening — sound on to start (sound inputs to pick where from)", "info"), true;
      return say(st.bpm ? `${Math.round(st.bpm * 2) / 2} BPM, ${st.sure > 0.6 ? "locked on" : st.sure > 0.35 ? "nearly locked" : "still finding it"} · level ${Math.round(Math.min(1, st.energy) * 100)}% · from ${inputName}${settings.offset ? ` · offset ${settings.offset} ms` : ""}` : `Listening to ${inputName}, no beat yet (level ${Math.round(Math.min(1, st.energy) * 100)}%)`, "info"), true;
    }
    if (/^sound inputs?$/.test(c)) {
      const list = await inputs();
      if (!list.length) return say("No sound inputs found", "warn"), true;
      say(`Sound inputs: ${list.map((d, i) => `${i + 1}. ${d.label || "input " + (i + 1)}${d.deviceId === settings.device || (!settings.device && i === 0) ? " ←" : ""}`).join(" · ")} — sound input 2 to pick`, "info");
      return true;
    }
    if ((m = /^sound input (.+)$/.exec(c))) {
      const list = await inputs();
      const n = Number(m[1]);
      const d = Number.isInteger(n) ? list[n - 1] : list.find(x => (x.label || "").toLowerCase().includes(m[1]));
      if (!d) return say(`No sound input “${m[1]}” — sound inputs to see them`, "warn"), true;
      settings.device = d.deviceId; store("device", d.deviceId);
      say(`Listening to ${d.label || "that input"} from now on`);
      if (st.listening) await start();
      return true;
    }
    if ((m = /^sound offset (-?\d+)\s*(?:ms)?$/.exec(c))) {
      settings.offset = Math.max(-500, Math.min(500, Number(m[1]))); store("offset", settings.offset);
      return say(`Beats ${settings.offset < 0 ? `${-settings.offset} ms earlier` : settings.offset > 0 ? `${settings.offset} ms later` : "exactly on the clock"}`), true;
    }
    if ((m = /^sound sensitivity (\d+)$/.exec(c))) {
      settings.sensitivity = Math.max(1, Math.min(10, Number(m[1]))); store("sensitivity", settings.sensitivity);
      return say(`Sensitivity ${settings.sensitivity} of 10`), true;
    }
    if ((m = /^sound tempo (on|off)$/.exec(c))) {
      settings.tempo = m[1] === "on"; store("tempo", settings.tempo);
      return say(settings.tempo ? "The music's tempo sets the show tempo" : "The show tempo stays as you set it"), true;
    }
    if ((m = /^(beat flash|beat colou?r|beat chase|sound level)$/.exec(c))) {
      startMusicEffect({ "beat flash": "beatflash", "beat colour": "beatcolour", "beat color": "beatcolour", "beat chase": "beatchase", "sound level": "soundlevel" }[m[1]]);
      return true;
    }
    if (/^party (page|settings|setup)$/.test(c)) { window.LXParty?.open?.(); return true; }
    if (/^party( on| mode)?$/.test(c)) { await startParty(); return true; }
    if (/^party off$/.test(c)) { await stopParty(); return true; }
    return false;
  }

  // The party: the look on the lights (given, else the selected, else all),
  // and the beat from the best place there is.
  async function startParty(lights = null) {
      // At full whatever the lights were at (the Party page's Brightness sets the level).
      const ids = lights?.length ? lights.map(String) : null;
      startMusicEffect("party", ids ? { levels: Object.fromEntries(ids.map(id => [id, 100])) } : { fullLevel: true }, ids);
      if (!st.linkOn) await linkOn(true);
      if (!st.seratoOn) await seratoOn(true);
      // The beat: from VirtualDJ if it's sending, else listen to the music.
      if (!fromDj() && !st.listening && !linked()) {
        if (window.LXOs2l && !st.djOn) await djOn(true);
        setTimeout(() => { if (!fromDj() && !st.listening && !linked()) { say("No beat from Ableton Link or VirtualDJ — listening to the music instead (type link status to see why Link wasn't found)", "info"); start(); } }, 5000);
      }
  }
  async function stopParty() {
      for (const e of [...(S().effects || [])]) if (["party", "beatflash", "beatcolour", "beatchase", "soundlevel"].includes(e.type)) window.stopEffectsOn?.([...e.ids], false);
      stop(true);
      if (st.djOn) await djOff();
      if (st.seratoOn) { await window.LXSerato?.stop(); st.seratoOn = false; st.grid = 0; }
      if (st.linkOn) { await window.LXLink?.stop(); st.linkOn = false; linkTimeline(null); }
      say("Party over", "info");
      return true;
  }

  function install() {
    const previous = window.parseCommand;
    if (typeof previous !== "function") return setTimeout(install, 300);
    if (previous.__lxSound) return;
    const wrapped = function (raw) {
      const c = String(raw || "").trim().toLowerCase();
      if (/^(sound|listen|music|party|beat |stop listening|dj\b|virtual ?dj|os2l|serato|(ableton )?link\b)/.test(c)) {
        const handled = command(raw);
        // Handled asynchronously; anything else falls through.
        handled.then(ok => { if (!ok) previous.call(this, raw); });
        return;
      }
      return previous.apply(this, arguments);
    };
    Object.assign(wrapped, previous);
    wrapped.__lxSound = true;
    window.parseCommand = wrapped;
  }

  window.LXSound = { start, stop, state, command, startParty, stopParty, linkStatus, partyRunning: () => (S().effects || []).some(e => e.type === "party"), djOn, djOff, djMessage, seratoTrack, seratoOn, linkOn, linkOff, linkTimeline, onBeat: f => beatListeners.push(f), settings, raw: st };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { addEffects(); install(); }, { once: true });
  else { addEffects(); install(); }
  // Other scripts wrap parseCommand after load: make sure ours is outermost-ish.
  setTimeout(install, 1500);
})();
