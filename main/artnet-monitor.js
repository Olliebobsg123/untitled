'use strict';

// Art-Net discovery and RDM: finds the Art-Net nodes on the network (ArtPoll →
// ArtPollReply) and asks them which RDM devices are on a universe (ArtTodRequest /
// ArtTodControl → ArtTodData). Output itself is main/dmx-output.js.
//
// Nodes answer on port 6454, so this listens there when it can (shared with any
// other Art-Net software on this computer); if the port is taken it falls back to
// a random port, where only nodes that reply to the sender's port are heard.

const dgram = require('dgram');

const PORT = 6454;
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const nodes = new Map(); // ip → node
let ready = false;
let listeners = { node: () => {}, tod: () => {} };

function header(opcode, length) {
  const packet = Buffer.alloc(length);
  packet.write('Art-Net\0', 0, 'latin1');
  packet.writeUInt16LE(opcode, 8);
  packet.writeUInt16BE(14, 10);
  return packet;
}

const isArtNet = (packet, opcode) =>
  packet.length >= 12 && packet.toString('latin1', 0, 8) === 'Art-Net\0' && packet.readUInt16LE(8) === opcode;

const universeParts = universe => {
  const u = Math.max(0, Math.min(32767, Number(universe) || 0));
  return { net: (u >> 8) & 0x7f, address: u & 0xff };
};

function send(packet, target) {
  if (!ready) return false;
  socket.send(packet, PORT, target || '255.255.255.255', err => { if (err) console.error(`Art-Net send to ${target} failed:`, err.message); });
  return true;
}

// ArtPoll: every node answers with an ArtPollReply.
function poll(target = '255.255.255.255') {
  return send(header(0x2000, 14), target);
}

// ArtTodRequest: "send me the table of RDM devices on this universe".
function requestTod(universe, target) {
  const packet = header(0x8000, 24 + 32);
  const { net, address } = universeParts(universe);
  packet[21] = net;
  packet[22] = 0x00; // TodFull
  packet[23] = 1; // one address follows
  packet[24] = address;
  return send(packet, target);
}

// ArtTodControl AtcFlush: forget the table and run full RDM discovery again.
function flushTod(universe, target) {
  const packet = header(0x8200, 24);
  const { net, address } = universeParts(universe);
  packet[21] = net;
  packet[22] = 0x01; // AtcFlush
  packet[23] = address;
  return send(packet, target);
}

function readPollReply(packet, rinfo) {
  if (packet.length < 207) return null;
  const ip = `${packet[10]}.${packet[11]}.${packet[12]}.${packet[13]}`;
  const shortName = packet.toString('latin1', 26, 44).replace(/\0.*$/s, '');
  const longName = packet.toString('latin1', 44, 108).replace(/\0.*$/s, '');
  const netSwitch = packet[18] & 0x7f;
  const subSwitch = packet[19] & 0x0f;
  const ports = Math.min(4, packet.readUInt16BE(172));
  const outputs = [];
  for (let i = 0; i < ports; i++) {
    if (packet[174 + i] & 0x80) outputs.push((netSwitch << 8) | (subSwitch << 4) | (packet[190 + i] & 0x0f)); // can output DMX
  }
  return { ip: ip === '0.0.0.0' ? rinfo.address : ip, shortName, longName, universes: outputs, seenAt: Date.now() };
}

function readTodData(packet, rinfo) {
  if (packet.length < 28) return null;
  const universe = ((packet[21] & 0x7f) << 8) | packet[23];
  const count = packet[27];
  const devices = [];
  for (let i = 0; i < count && 28 + i * 6 + 6 <= packet.length; i++) {
    const uid = packet.subarray(28 + i * 6, 34 + i * 6).toString('hex').toUpperCase().match(/../g).join(':');
    devices.push({ uid, universe, port: packet[13], rdmVersion: packet[12], node: rinfo.address });
  }
  return { universe, total: packet.readUInt16BE(24), devices };
}

socket.on('message', (packet, rinfo) => {
  if (isArtNet(packet, 0x2100)) {
    const node = readPollReply(packet, rinfo);
    if (node) { nodes.set(node.ip, node); listeners.node(node); }
  } else if (isArtNet(packet, 0x8100)) {
    const tod = readTodData(packet, rinfo);
    if (tod) listeners.tod(tod);
  }
});
socket.on('error', err => {
  if (err.code === 'EADDRINUSE' && !ready) {
    console.warn(`Art-Net port ${PORT} is in use by another program; listening on a random port instead.`);
    socket.bind(0, '0.0.0.0');
  } else {
    console.error('Art-Net monitor error:', err.message);
  }
});
socket.on('listening', () => {
  ready = true;
  try { socket.setBroadcast(true); } catch (_) {}
});
socket.bind(PORT, '0.0.0.0');

function on(handlers) {
  listeners = { node: handlers?.node || (() => {}), tod: handlers?.tod || (() => {}) };
}

const knownNodes = () => [...nodes.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));

function shutdown() {
  try { socket.close(); } catch (_) {}
}

module.exports = { poll, requestTod, flushTod, on, knownNodes, shutdown };
