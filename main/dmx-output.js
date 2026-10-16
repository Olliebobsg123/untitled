'use strict';

// DMX output: up to 10 outputs, each sending one universe over Art-Net, sACN or a USB
// interface (ENTTEC Open DMX / FTDI, or ENTTEC DMX USB Pro / DMXking).
//
// The console sends a frame for each universe whenever something changes
// (setFrames); each output keeps re-sending its universe's last frame on its own
// timer, so the lights hold their state even while the console is idle and nodes
// don't time out. Nothing goes out unless the licence allows live output
// (setLicensed, decided in main/license.js) and the console is in LIVE
// (setBlind).

const { SerialPort } = require('serialport');
const dgram = require('dgram');
const crypto = require('crypto');

const MAX_OUTPUTS = 10;
const USB_RATES = [10, 15, 20, 25, 30, 35, 40];
const NETWORK_RATE = 40; // Hz
const DEFAULT_TARGET = process.env.LIGHTING_CONSOLE_NETWORK_TARGET || '192.168.1.1';
const SOURCE_NAME = 'Light Spark';

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const outputs = new Map(); // id → output
const frames = new Map(); // universe number → Buffer(512)
const cid = crypto.randomBytes(16);
const socket = dgram.createSocket('udp4');
let socketReady = false;
let licensed = false;
let blind = true;
let artnetSequence = 0;
let sacnSequence = 0;
let configQueue = Promise.resolve();
let statusListener = () => {};
let shuttingDown = false;

socket.on('error', err => console.error('DMX output UDP error:', err.message));
socket.bind(0, '0.0.0.0', () => {
  socketReady = true;
  try { socket.setBroadcast(true); } catch (_) {}
});

const live = () => licensed && !blind && !shuttingDown;
const frameFor = universe => frames.get(Number(universe)) || Buffer.alloc(512);

// --- Packets ---

function artDmxPacket(frame, universe) {
  const packet = Buffer.alloc(530);
  packet.write('Art-Net\0', 0, 'latin1');
  packet.writeUInt16LE(0x5000, 8); // OpDmx
  packet.writeUInt16BE(14, 10); // protocol version
  packet[12] = artnetSequence = (artnetSequence % 255) + 1; // 1-255; 0 means "no sequencing"
  packet[13] = 0;
  packet.writeUInt16LE(clamp(universe, 0, 32767, 0), 14);
  packet.writeUInt16BE(512, 16);
  frame.copy(packet, 18, 0, 512);
  return packet;
}

function flagsAndLength(packet, offset, length) {
  packet.writeUInt16BE(0x7000 | (length & 0x0fff), offset);
}

// E1.31 data packet: root layer, framing layer, DMP layer, 512 slots.
function sacnPacket(frame, universe, priority) {
  const packet = Buffer.alloc(638);
  packet.writeUInt16BE(0x0010, 0);
  packet.writeUInt16BE(0x0000, 2);
  packet.write('ASC-E1.17\0\0\0', 4, 'latin1');
  flagsAndLength(packet, 16, 638 - 16);
  packet.writeUInt32BE(0x00000004, 18);
  cid.copy(packet, 22);
  flagsAndLength(packet, 38, 638 - 38);
  packet.writeUInt32BE(0x00000002, 40);
  packet.write(SOURCE_NAME, 44, 64, 'utf8');
  packet[108] = clamp(priority, 0, 200, 100);
  packet.writeUInt16BE(0, 109);
  packet[111] = sacnSequence = (sacnSequence + 1) & 0xff;
  packet[112] = 0;
  packet.writeUInt16BE(clamp(universe, 1, 63999, 1), 113);
  flagsAndLength(packet, 115, 638 - 115);
  packet[117] = 0x02;
  packet[118] = 0xa1;
  packet.writeUInt16BE(0, 119);
  packet.writeUInt16BE(1, 121);
  packet.writeUInt16BE(513, 123);
  packet[125] = 0; // start code
  frame.copy(packet, 126, 0, 512);
  return packet;
}

const sacnMulticast = universe => {
  const u = clamp(universe, 1, 63999, 1);
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
};

// --- USB interfaces ---

// Which USB-DMX protocol a serial port speaks, from what it reports about itself.
function identifyUsb(port) {
  const text = `${port.manufacturer || ''} ${port.product || ''}`.toLowerCase();
  const vid = String(port.vendorId || '').toLowerCase();
  const pid = String(port.productId || '').toLowerCase();
  if (text.includes('dmxking') || text.includes('jpk systems')) return { name: 'DMXking USB DMX', protocol: 'dmx-usb-pro' };
  if (text.includes('enttec')) {
    if (text.includes('open dmx') || text.includes('open-dmx')) return { name: 'ENTTEC Open DMX', protocol: 'open-dmx' };
    if (text.includes('pro') || text.includes('dmx usb')) return { name: 'ENTTEC DMX USB Pro', protocol: 'dmx-usb-pro' };
  }
  if (text.includes('dsd tech') || text.includes('dsdtech')) return { name: 'DSD TECH USB DMX', protocol: 'open-dmx' };
  if (vid === '0403' && ['6001', '6010', '6011', '6014'].includes(pid)) return { name: 'Open DMX (FTDI)', protocol: 'open-dmx' };
  return { name: port.product || port.manufacturer || 'USB serial DMX', protocol: 'open-dmx' };
}

// On a Mac each serial device appears twice (tty. and cu.); cu. is the one to open.
const preferCuPath = path => (process.platform === 'darwin' && path.startsWith('/dev/tty.') ? `/dev/cu.${path.slice(9)}` : path);

async function listUsbPorts() {
  const ports = await SerialPort.list();
  const seen = new Set();
  return ports
    .filter(port => {
      const key = String(port.path || '').replace(/^\/dev\/(tty|cu)\./, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(port => ({ path: preferCuPath(String(port.path || '')), manufacturer: port.manufacturer || null, product: port.product || null, serialNumber: port.serialNumber || null, ...identifyUsb(port) }));
}

const portCall = (port, method, ...args) => new Promise((resolve, reject) => port[method](...args, err => (err ? reject(err) : resolve())));

async function writeUsbFrame(output) {
  const port = output.port;
  if (!live() || !port?.isOpen || !port.writable || output.writing) return;
  output.writing = true;
  try {
    const frame = frameFor(output.universe);
    if (output.driver === 'dmx-usb-pro') {
      // ENTTEC Pro "Output Only Send DMX" (label 6): 0x7E, label, length 513 (LSB, MSB), start code, 512 slots, 0xE7.
      const packet = Buffer.alloc(518);
      packet[0] = 0x7e;
      packet[1] = 0x06;
      packet.writeUInt16LE(513, 2);
      packet[4] = 0;
      frame.copy(packet, 5);
      packet[517] = 0xe7;
      await portCall(port, 'write', packet);
    } else {
      // Open DMX: a break, then the start code and 512 slots at 250k baud.
      await portCall(port, 'set', { brk: true });
      await sleep(1);
      await portCall(port, 'set', { brk: false });
      const packet = Buffer.alloc(513);
      frame.copy(packet, 1);
      await portCall(port, 'write', packet);
    }
    await portCall(port, 'drain');
    output.tx += 1;
    output.error = null;
  } catch (err) {
    output.error = err?.message || String(err);
  } finally {
    output.writing = false;
  }
}

async function openUsb(output) {
  await closeUsb(output);
  if (!output.enabled || !output.usbDevice) return;
  const path = preferCuPath(output.usbDevice);
  const known = (await listUsbPorts().catch(() => [])).find(port => port.path === path);
  output.driver = output.usbDriver && output.usbDriver !== 'auto' ? output.usbDriver : known?.protocol || 'open-dmx';
  const port = new SerialPort({ path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false });
  port.on('error', err => { output.error = err?.message || String(err); output.connected = false; notify(); });
  port.on('close', () => { output.connected = false; notify(); });
  await portCall(port, 'open');
  output.port = port;
  output.connected = true;
  output.error = null;
  output.timer = setInterval(() => void writeUsbFrame(output), Math.max(25, Math.round(1000 / output.refreshRate)));
}

async function closeUsb(output) {
  clearInterval(output.timer);
  output.timer = null;
  const port = output.port;
  output.port = null;
  output.connected = false;
  output.writing = false;
  if (port?.isOpen) await new Promise(resolve => port.close(() => resolve()));
}

// --- Network ---

function sendNetwork(output) {
  if (!live() || !socketReady || !output.enabled) return;
  const frame = frameFor(output.universe);
  const done = err => { if (err) output.error = err.message; else { output.tx += 1; output.error = null; } };
  if (output.protocol === 'sacn') {
    const target = output.multicast ? sacnMulticast(output.universe) : output.target;
    socket.send(sacnPacket(frame, output.universe, output.priority), 5568, target, done);
  } else {
    socket.send(artDmxPacket(frame, output.universe), 6454, output.target, done);
  }
}

const networkTimer = setInterval(() => {
  for (const output of outputs.values()) if (output.protocol !== 'usb') sendNetwork(output);
}, Math.round(1000 / NETWORK_RATE));

// --- Configuration ---

function normalise(config, index) {
  const protocol = ['artnet', 'sacn', 'usb'].includes(String(config?.protocol).toLowerCase()) ? String(config.protocol).toLowerCase() : 'artnet';
  return {
    id: String(config?.id || `output-${index}`),
    protocol,
    // The patch universe this output sends, which is also its Art-Net/sACN universe number.
    universe: protocol === 'sacn' ? clamp(config?.universe, 1, 63999, 1) : clamp(config?.universe, 0, 32767, 0),
    enabled: Boolean(config?.enabled),
    target: String(config?.target || DEFAULT_TARGET).trim(),
    multicast: protocol === 'sacn' && Boolean(config?.multicast),
    priority: clamp(config?.priority, 0, 200, 100),
    usbDevice: String(config?.usbDevice || ''),
    usbDriver: ['open-dmx', 'dmx-usb-pro'].includes(config?.usbDriver) ? config.usbDriver : 'auto',
    refreshRate: USB_RATES.includes(Number(config?.refreshRate)) ? Number(config.refreshRate) : 25
  };
}

async function applyConfig(list) {
  const next = (Array.isArray(list) ? list : []).slice(0, MAX_OUTPUTS).map(normalise);
  const ids = new Set(next.map(output => output.id));
  for (const [id, output] of outputs) {
    if (!ids.has(id)) { await closeUsb(output); outputs.delete(id); }
  }
  for (const config of next) {
    const previous = outputs.get(config.id);
    const output = Object.assign(previous || { tx: 0, port: null, timer: null, connected: false, writing: false, error: null, driver: null }, config);
    outputs.set(config.id, output);
    const usbChanged = !previous || ['protocol', 'usbDevice', 'usbDriver', 'refreshRate', 'enabled'].some(key => previous[key] !== config[key]) || !previous.connected;
    if (output.protocol !== 'usb' || !output.enabled) await closeUsb(output);
    else if (usbChanged) await openUsb(output).catch(err => { output.error = err?.message || String(err); output.connected = false; });
  }
  notify();
}

function configure(list) {
  configQueue = configQueue.then(() => applyConfig(list)).catch(err => console.error('DMX output config error:', err.message));
  return configQueue;
}

// universes: { [universe]: number[512] } — only the universes that changed need sending.
function setFrames(universes) {
  if (!universes || typeof universes !== 'object') return;
  for (const [key, values] of Object.entries(universes)) {
    const universe = Number(key);
    if (!Number.isInteger(universe) || universe < 0 || universe > 63999) continue;
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) continue;
    const frame = frames.get(universe) || Buffer.alloc(512);
    for (let i = 0; i < 512; i++) frame[i] = Number(values[i]) & 0xff;
    frames.set(universe, frame);
  }
}

function setLicensed(allowed) {
  licensed = Boolean(allowed);
  notify();
}

function setBlind(isBlind) {
  blind = Boolean(isBlind);
  notify();
}

function status() {
  return {
    maxOutputs: MAX_OUTPUTS,
    live: live(),
    licensed,
    blind,
    outputs: [...outputs.values()].map(output => ({
      id: output.id,
      protocol: output.protocol,
      universe: output.universe,
      target: output.target,
      enabled: output.enabled,
      usbDevice: output.usbDevice,
      driver: output.driver,
      refreshRate: output.refreshRate,
      connected: output.protocol === 'usb' ? output.connected : output.enabled && socketReady,
      error: output.error,
      tx: output.tx
    }))
  };
}

function notify() {
  try { statusListener(status()); } catch (_) {}
}

function onStatus(listener) {
  statusListener = typeof listener === 'function' ? listener : () => {};
}

async function shutdown() {
  shuttingDown = true;
  clearInterval(networkTimer);
  await configQueue.catch(() => {});
  for (const output of outputs.values()) await closeUsb(output);
  try { socket.close(); } catch (_) {}
}

module.exports = { configure, setFrames, setLicensed, setBlind, status, onStatus, listUsbPorts, shutdown, MAX_OUTPUTS, USB_RATES };
