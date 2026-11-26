'use strict';

// Serato DJ (Lite or Pro) link: which song just started and its exact tempo.
//
// Serato analyses every song it loads and keeps the result for streamed
// songs (Spotify, TIDAL, SoundCloud, Beatport, Apple Music) in
//   ~/Music/_Serato_/Metadata/<Service>/<track id>.xml
//   <BPM>76.900000</BPM>
//   <TempoMap>base64</TempoMap>    beat grid: version byte, marker count,
//                                  then per marker a big-endian double start
//                                  time (s) ... and the exact BPM (double)
//   <PlayCount>1</PlayCount>
// When a song starts playing, Serato marks it played and rewrites its file,
// PlayCount going up by one; a song that's only loaded keeps its count. So
// watching that folder tells us the moment a song starts, and its tempo.
//
// Nothing in Serato is changed: these are files it writes for itself; we
// only read them.
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseXml(text) {
  const tag = name => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text); return m ? m[1].trim() : null; };
  const bpmTag = Number(tag('BPM'));
  const playCount = Number(tag('PlayCount')) || 0;
  let firstBeat = null, bpm = Number.isFinite(bpmTag) && bpmTag > 0 ? bpmTag : null;
  const map = tag('TempoMap');
  if (map) {
    try {
      const b = Buffer.from(map.replace(/\s+/g, ''), 'base64');
      // The first marker's start time is the double at byte 4; the grid's
      // exact BPM is the double closest to the rounded <BPM>.
      if (b.length >= 12) { const t = b.readDoubleBE(4); if (Number.isFinite(t) && t >= 0 && t < 600) firstBeat = t; }
      let best = null;
      for (let i = 4; i + 8 <= b.length; i++) {
        const d = b.readDoubleBE(i);
        if (!(d > 20 && d < 400)) continue;
        if (bpm == null ? best == null : Math.abs(d - bpm) < 0.6 && (best == null || Math.abs(d - bpm) < Math.abs(best - bpm))) best = d;
      }
      if (best != null) bpm = best;
    } catch (_) {}
  }
  return { bpm, firstBeat, playCount };
}

function createSeratoLink({ onTrack, onStatus }) {
  const root = path.join(os.homedir(), 'Music', '_Serato_', 'Metadata');
  let watcher = null;
  const known = new Map();   // file → play count last seen
  const pending = new Map(); // file → timer (Serato writes in a few steps)
  const status = () => ({ running: Boolean(watcher), folder: root, songs: known.size });

  function read(file) {
    try { return parseXml(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
  }

  function scan() {
    let services = [];
    try { services = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (_) {}
    for (const s of services) {
      let files = [];
      try { files = fs.readdirSync(path.join(root, s)).filter(f => f.endsWith('.xml')); } catch (_) {}
      for (const f of files) { const file = path.join(root, s, f); const x = read(file); if (x) known.set(file, x.playCount); }
    }
  }

  function changed(file) {
    const info = read(file);
    if (!info) return;
    const before = known.get(file);
    known.set(file, info.playCount);
    const service = path.basename(path.dirname(file));
    const id = path.basename(file, '.xml');
    const event = before != null && info.playCount > before ? 'playing' : before == null && info.playCount > 0 ? 'playing' : 'loaded';
    try { onTrack?.({ event, service, id, bpm: info.bpm, firstBeat: info.firstBeat, playCount: info.playCount, at: Date.now() }); } catch (_) {}
  }

  function start() {
    if (watcher) return status();
    if (!fs.existsSync(root)) { try { onStatus?.({ ...status(), error: 'no-serato' }); } catch (_) {} return { ...status(), error: 'no-serato' }; }
    scan();
    try {
      watcher = fs.watch(root, { recursive: true }, (_type, name) => {
        if (!name || !String(name).endsWith('.xml')) return;
        const file = path.join(root, String(name));
        clearTimeout(pending.get(file));
        pending.set(file, setTimeout(() => { pending.delete(file); changed(file); }, 40));
      });
      watcher.on('error', err => { console.warn('[SERATO] watch error:', err.message); stop(); });
    } catch (err) {
      console.warn('[SERATO] could not watch:', err.message);
      return { ...status(), error: err.message };
    }
    console.log(`[SERATO] watching ${root} (${known.size} songs)`);
    try { onStatus?.(status()); } catch (_) {}
    return status();
  }

  function stop() {
    try { watcher?.close(); } catch (_) {}
    watcher = null;
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    try { onStatus?.(status()); } catch (_) {}
    return status();
  }

  return { start, stop, status };
}

module.exports = { createSeratoLink, parseXml };
