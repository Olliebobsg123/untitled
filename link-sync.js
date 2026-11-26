'use strict';

// Ableton Link, listening only: the shared tempo and beat of a Link session
// (Serato DJ Pro with Link on, Ableton Live, Traktor, djay, Rekordbox…).
// Light Spark never changes the session's tempo; it just follows it.
//
// How Link shares the beat (Ableton's open-source protocol):
//  - Every peer multicasts "_asdp_v\1" messages to 224.76.78.75:20808:
//      type (1 alive, 2 response, 3 bye-bye), ttl, group id (2 bytes),
//      peer id (8 bytes), then entries: 4-byte key, 4-byte size, value:
//        'tmln'  µs per beat, beat origin (µbeats), time origin (µs ghost time)
//        'sess'  session id (8 bytes)       'mep4'  IPv4 address + port to ping
//  - The timeline is in "ghost time", a clock the session shares. To turn it
//    into our own clock we ping a peer ("_link_v\1" type 1, '__ht' our time);
//    it answers (type 2) with its ghost time '__gt' and our '__ht' back, and
//    we ping again with '_pgt'. Ghost minus our clock, at the middle of each
//    round trip, many times over: the median is the offset.
// All numbers are big-endian.
const dgram = require('dgram');
const os = require('os');

const GROUP = '224.76.78.75', PORT = 20808;
const DISCOVERY = Buffer.from('_asdp_v\x01', 'latin1');
const LINK = Buffer.from('_link_v\x01', 'latin1');
const KEY = s => Buffer.from(s, 'latin1').readUInt32BE(0);
const K = { tmln: KEY('tmln'), sess: KEY('sess'), mep4: KEY('mep4'), ht: KEY('__ht'), gt: KEY('__gt'), pgt: KEY('_pgt'), stst: KEY('stst') };

// Our clock in µs since 1970 (the page can use the same: timeOrigin + now()).
const { performance } = require('perf_hooks');
const hostMicros = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000));

function entries(buf, at) {
  const out = new Map();
  while (at + 8 <= buf.length) {
    const key = buf.readUInt32BE(at), size = buf.readUInt32BE(at + 4);
    if (at + 8 + size > buf.length) break;
    out.set(key, buf.subarray(at + 8, at + 8 + size));
    at += 8 + size;
  }
  return out;
}
const entry = (key, value) => { const h = Buffer.alloc(8); h.writeUInt32BE(key, 0); h.writeUInt32BE(value.length, 4); return Buffer.concat([h, value]); };
const i64 = v => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v), 0); return b; };

function createLinkSync({ onTimeline, onStatus }) {
  let disco = null, ping = null, timer = null;
  const peers = new Map();       // peer id (hex) → { tl, sess, mep, seen }
  const offsets = new Map();     // session id (hex) → { samples, offset, at, busy }
  let lastSent = '';
  // What it can see, for "link status".
  const diag = { error: '', networks: [], packets: 0, linkPackets: 0, pings: 0, pongs: 0, mep: '' };

  const status = () => ({ running: Boolean(disco), peers: peers.size, measured: [...offsets.values()].some(o => o.offset != null), ...diag });

  function onDiscovery(msg) {
    diag.packets++;
    if (msg.length < 20 || !msg.subarray(0, 8).equals(DISCOVERY)) return;
    diag.linkPackets++;
    const type = msg[8];
    const id = msg.subarray(12, 20).toString('hex');
    if (type === 3) { peers.delete(id); publish(); return; }
    if (type !== 1 && type !== 2) return;
    const e = entries(msg, 20);
    const tmln = e.get(K.tmln), sess = e.get(K.sess), mep = e.get(K.mep4);
    if (!tmln || tmln.length < 24) return;
    const tl = { microsPerBeat: Number(tmln.readBigInt64BE(0)), beatOrigin: Number(tmln.readBigInt64BE(8)) / 1e6, timeOrigin: tmln.readBigInt64BE(16) };
    if (!(tl.microsPerBeat > 0)) return;
    const peer = {
      tl, sess: sess ? sess.toString('hex') : id, seen: Date.now(),
      mep: mep && mep.length >= 6 ? { address: [mep[0], mep[1], mep[2], mep[3]].join('.'), port: mep.readUInt16BE(4) } : null
    };
    peers.set(id, peer);
    measure(peer);
    publish();
  }

  // Ping a peer of this session until we know ghost time against our clock.
  function measure(peer) {
    if (!peer.mep || !ping) return;
    let o = offsets.get(peer.sess);
    if (o && (o.busy || Date.now() - o.at < 30000)) return;
    if (!o) offsets.set(peer.sess, o = { samples: [], offset: null, at: 0 });
    o.busy = true; o.samples = []; o.to = peer.mep; o.sess = peer.sess;
    o.started = Date.now();
    sendPing(o, null);
    clearTimeout(o.giveUp);
    o.giveUp = setTimeout(() => { o.busy = false; if (o.samples.length >= 3) finish(o); }, 1500);
  }
  function sendPing(o, prevGhost) {
    const payload = [entry(K.ht, i64(hostMicros()))];
    if (prevGhost != null) payload.push(entry(K.pgt, i64(prevGhost)));
    const msg = Buffer.concat([LINK, Buffer.from([1]), ...payload]);
    diag.pings++; diag.mep = `${o.to.address}:${o.to.port}`;
    try { ping.send(msg, o.to.port, o.to.address, err => { if (err) diag.error = `ping: ${err.code || err.message}`; }); } catch (err) { diag.error = `ping: ${err.code || err.message}`; }
  }
  function onPong(msg) {
    if (msg.length < 9 || !msg.subarray(0, 8).equals(LINK) || msg[8] !== 2) return;
    diag.pongs++;
    const now = hostMicros();
    const e = entries(msg, 9);
    const sess = e.get(K.sess)?.toString('hex');
    const o = sess && offsets.get(sess);
    if (!o || !o.busy) return;
    const gt = e.get(K.gt) ? e.get(K.gt).readBigInt64BE(0) : 0n;
    const pgt = e.get(K.pgt) ? e.get(K.pgt).readBigInt64BE(0) : 0n;
    const ht = e.get(K.ht) ? e.get(K.ht).readBigInt64BE(0) : 0n;
    if (gt && ht) {
      o.samples.push(Number(gt) - (Number(now) + Number(ht)) / 2);
      if (pgt) o.samples.push((Number(gt) + Number(pgt)) / 2 - Number(ht));
    }
    if (o.samples.length >= 40) finish(o);
    else sendPing(o, gt);
  }
  function finish(o) {
    clearTimeout(o.giveUp);
    const s = [...o.samples].sort((a, b) => a - b);
    o.offset = s[Math.floor(s.length / 2)];   // ghost = our µs + offset
    o.at = Date.now(); o.busy = false;
    publish(true);
  }

  // The session's timeline in our clock: which beat at what time (ms since 1970).
  function publish(force = false) {
    // The session with the most peers (Serato on its own is one).
    const bySess = new Map();
    for (const p of peers.values()) bySess.set(p.sess, [...(bySess.get(p.sess) || []), p]);
    const best = [...bySess.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) { if (lastSent) { lastSent = ''; onTimeline?.(null); } notify(); return; }
    const [sess, list] = best;
    const peer = list.sort((a, b) => b.seen - a.seen)[0];
    const o = offsets.get(sess);
    if (o?.offset == null) { notify(); return; }
    const bpm = 60e6 / peer.tl.microsPerBeat;
    const timeOriginMs = (Number(peer.tl.timeOrigin) - o.offset) / 1000;
    const tl = { bpm, beatOrigin: peer.tl.beatOrigin, timeOriginMs, peers: list.length, session: sess };
    const sig = `${bpm.toFixed(4)}|${peer.tl.beatOrigin}|${timeOriginMs.toFixed(2)}`;
    if (force || sig !== lastSent) { lastSent = sig; try { onTimeline?.(tl); } catch (_) {} }
    notify();
  }
  const notify = () => { try { onStatus?.(status()); } catch (_) {} };

  function start() {
    if (disco) return Promise.resolve(status());
    return new Promise(resolve => {
      disco = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      disco.on('message', onDiscovery);
      disco.on('error', err => { console.warn('[LINK] discovery error:', err.message); diag.error = `port ${PORT}: ${err.code || err.message}`; stop(true); resolve(status()); });
      disco.bind(PORT, () => {
        try { disco.setMulticastLoopback(true); } catch (_) {}
        // Every network the computer is on (Link peers on the same Mac use them too).
        const nets = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).filter(a => a && a.family === 'IPv4').map(a => ({ name, address: a.address })));
        diag.networks = [];
        for (const n of nets) { try { disco.addMembership(GROUP, n.address); diag.networks.push(`${n.name} ${n.address}`); } catch (err) { diag.networks.push(`${n.name} ${n.address} (couldn't join: ${err.code || err.message})`); } }
        if (!diag.networks.some(n => !n.includes("couldn't"))) { try { disco.addMembership(GROUP); diag.networks.push('default'); } catch (err) { diag.error = `multicast: ${err.code || err.message}`; } }
        ping = dgram.createSocket('udp4');
        ping.on('message', onPong);
        ping.on('error', () => {});
        ping.bind(0, () => {
          // Forget peers that went quiet; measure again now and then.
          timer = setInterval(() => {
            const now = Date.now();
            for (const [id, p] of peers) if (now - p.seen > 6000) peers.delete(id);
            for (const p of peers.values()) measure(p);
            publish();
          }, 1000);
          console.log(`[LINK] listening for Ableton Link on ${GROUP}:${PORT}`);
          notify();
          resolve(status());
        });
      });
    });
  }

  function stop(keepError = false) {
    if (!keepError) Object.assign(diag, { error: '', packets: 0, linkPackets: 0, pings: 0, pongs: 0, mep: '' });
    clearInterval(timer); timer = null;
    try { disco?.close(); } catch (_) {}
    try { ping?.close(); } catch (_) {}
    disco = ping = null;
    peers.clear(); offsets.clear(); lastSent = '';
    notify();
    return status();
  }

  return { start, stop, status };
}

module.exports = { createLinkSync, hostMicros };
