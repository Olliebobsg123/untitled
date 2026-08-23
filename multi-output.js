'use strict';

const { SerialPort } = require('serialport');
const WebSocket = require('ws');

const WS_HOST = '127.0.0.1';
const WS_PORT = 8083;
const MAX_OUTPUTS = 10;
const USB_RATES = [10, 15, 20, 25, 30, 35, 40];

const outputs = new Map();
const universes = new Map();
let wss = null;
let sequence = 0;
let sacnSequence = 0;
const cid = Buffer.from(require('crypto').randomBytes(16));

const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

const frameFor = universe => {
  const u = String(Number(universe));
  return universes.get(u) || Buffer.alloc(512, 0);
};

function buildArtDMX(frame, universe) {
  const packet = Buffer.alloc(530);
  Buffer.from('Art-Net\0').copy(packet, 0);
  packet.writeUInt16LE(0x5000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = sequence = (sequence + 1) & 0xff;
  packet[13] = 0;
  packet.writeUInt16LE(clamp(universe, 0, 32767, 0), 14);
  packet.writeUInt16BE(512, 16);
  frame.copy(packet, 18, 0, 512);
  return packet;
}

function buildSacn(frame, universe, priority = 100) {
  const packet = Buffer.alloc(638);
  packet.writeUInt16BE(0x0010, 0);
  Buffer.from([0x41,0x53,0x43,0x2d,0x45,0x31,0x2e,0x31,0x37,0x00,0x00,0x00]).copy(packet, 4);
  packet.writeUInt16BE(0x7000 | 0x026c, 16);
  packet.writeUInt32BE(0x00000004, 18);
  cid.copy(packet, 22);
  packet.writeUInt16BE(0x7000 | 0x0256, 38);
  packet.writeUInt32BE(0x00000002, 40);
  Buffer.from('Lighting Console').copy(packet, 44);
  packet[108] = clamp(priority, 0, 200, 100);
  packet[111] = sacnSequence = (sacnSequence + 1) & 0xff;
  packet.writeUInt16BE(clamp(universe, 1, 63999, 1), 113);
  packet.writeUInt16BE(0x7000 | 0x0209, 115);
  packet[117] = 0x02;
  packet[118] = 0xa1;
  packet.writeUInt16BE(0, 119);
  packet.writeUInt16BE(1, 121);
  packet.writeUInt16BE(513, 123);
  packet[125] = 0;
  frame.copy(packet, 126, 0, 512);
  return packet;
}

function sacnTarget(universe) {
  const u = clamp(universe, 1, 63999, 1);
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}

function stopUsb(output) {
  if (output.timer) clearInterval(output.timer);
  output.timer = null;
  if (output.port?.isOpen) {
    try { output.port.close(() => {}); } catch (_) {}
  }
  output.port = null;
  output.connected = false;
}

async function sendOpenDMX(output) {
  if (!output.port?.isOpen || !output.port?.writable) return;
  await new Promise((resolve, reject) => output.port.set({ brk: true }, err => err ? reject(err) : resolve()));
  await new Promise(resolve => setTimeout(resolve, 1));
  await new Promise((resolve, reject) => output.port.set({ brk: false }, err => err ? reject(err) : resolve()));
  const packet = Buffer.alloc(513);
  frameFor(output.universe).copy(packet, 1);
  await new Promise((resolve, reject) => output.port.write(packet, err => err ? reject(err) : resolve()));
}

async function startUsb(output) {
  stopUsb(output);
  if (!output.enabled || !output.usbDevice) return;
  const path = String(output.usbDevice).replace(/^\/dev\/tty\./, '/dev/cu.');
  output.port = new SerialPort({ path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false });
  output.port.on('error', err => { output.error = err?.message || String(err); output.connected = false; broadcastStatus(); });
  output.port.on('close', () => { output.connected = false; broadcastStatus(); });
  await new Promise((resolve, reject) => output.port.open(err => err ? reject(err) : resolve()));
  output.connected = true;
  output.error = null;
  output.timer = setInterval(() => {
    if (!output.enabled) return;
    sendOpenDMX(output).catch(err => { output.error = err?.message || String(err); });
  }, Math.max(25, Math.round(1000 / output.refreshRate)));
}

async function configureOutput(config) {
  const id = String(config.id || '');
  if (!id) return;
  const previous = outputs.get(id);
  if (previous?.protocol === 'usb' && (config.protocol !== 'usb' || previous.usbDevice !== config.usbDevice)) stopUsb(previous);

  const output = {
    ...(previous || {}),
    ...config,
    protocol: ['artnet', 'sacn', 'usb'].includes(String(config.protocol).toLowerCase()) ? String(config.protocol).toLowerCase() : 'artnet',
    universe: Number.isFinite(Number(config.universe)) ? Math.round(Number(config.universe)) : 0,
    refreshRate: USB_RATES.includes(Number(config.refreshRate)) ? Number(config.refreshRate) : 25,
    enabled: Boolean(config.enabled),
    connected: previous?.connected || false,
    error: previous?.error || null
  };
  outputs.set(id, output);

  if (output.protocol === 'usb' && output.enabled) {
    try { await startUsb(output); } catch (err) { output.error = err?.message || String(err); output.connected = false; stopUsb(output); }
  } else if (output.protocol !== 'usb') {
    stopUsb(output);
  }
}

async function applyConfig(message) {
  const list = Array.isArray(message.outputs) ? message.outputs.slice(0, MAX_OUTPUTS) : [];
  const ids = new Set(list.map(o => String(o?.id || '')).filter(Boolean));
  for (const [id, output] of outputs) {
    if (!ids.has(id)) {
      stopUsb(output);
      outputs.delete(id);
    }
  }
  for (const config of list) await configureOutput(config);
  broadcastStatus();
}

function sendNetwork(output) {
  if (!output.enabled) return;
  const frame = frameFor(output.universe);
  if (output.protocol === 'sacn') {
    const u = clamp(output.universe, 1, 63999, 1);
    const target = output.multicast ? sacnTarget(u) : String(output.target || '127.0.0.1');
    const socket = require('dgram').createSocket('udp4');
    socket.send(buildSacn(frame, u, output.priority), 5568, target, () => socket.close());
  } else {
    const dgram = require('dgram');
    const socket = dgram.createSocket('udp4');
    socket.send(buildArtDMX(frame, output.universe), 6454, String(output.target || '192.168.1.1'), () => socket.close());
  }
}

function broadcastStatus() {
  if (!wss) return;
  const status = [...outputs.values()].map(o => ({ id: o.id, protocol: o.protocol, universe: o.universe, target: o.target || '', usbDevice: o.usbDevice || '', enabled: o.enabled, connected: o.protocol === 'usb' ? Boolean(o.connected) : Boolean(o.enabled), error: o.error || null, refreshRate: o.refreshRate }));
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'MULTI_OUTPUT_STATUS', maxOutputs: MAX_OUTPUTS, outputs: status })); } catch (_) {} } });
}

async function listUsbPorts() {
  return (await SerialPort.list()).map(p => ({ path: p.path, manufacturer: p.manufacturer || null, product: p.product || null, serialNumber: p.serialNumber || null, vendorId: p.vendorId || null, productId: p.productId || null }));
}

wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => console.log(`MULTI OUTPUT SERVICE READY — ws://${WS_HOST}:${WS_PORT}`));
wss.on('error', err => console.error('MULTI OUTPUT SERVICE ERROR:', err.message));

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'MULTI_OUTPUT_STATUS', maxOutputs: MAX_OUTPUTS, outputs: [...outputs.values()].map(o => ({ id: o.id, protocol: o.protocol, universe: o.universe, target: o.target || '', usbDevice: o.usbDevice || '', enabled: o.enabled, connected: Boolean(o.connected), error: o.error || null, refreshRate: o.refreshRate })) }));
  ws.on('message', async data => {
    try {
      const message = JSON.parse(String(data));
      if (message?.type === 'MULTI_OUTPUT_CONFIG') return applyConfig(message);
      if (message?.type === 'MULTI_USB_PORTS') {
        ws.send(JSON.stringify({ type: 'MULTI_USB_PORTS', ports: await listUsbPorts() }));
        return;
      }
      if (message?.type === 'MULTI_DMX_UPDATE') {
        const incoming = message.universes && typeof message.universes === 'object' ? message.universes : {};
        for (const [u, values] of Object.entries(incoming)) {
          if (Array.isArray(values)) universes.set(String(Number(u)), Buffer.from(values.slice(0, 512).map(v => Number(v) & 0xff)));
        }
        for (const output of outputs.values()) if (output.enabled && output.protocol !== 'usb') sendNetwork(output);
      }
    } catch (err) { console.warn('MULTI OUTPUT MESSAGE ERROR:', err.message); }
  });
});

async function shutdown() {
  for (const output of outputs.values()) stopUsb(output);
  try { wss?.close(); } catch (_) {}
}

module.exports = { shutdown, outputs };
