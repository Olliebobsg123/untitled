'use strict';

const { SerialPort } = require('serialport');
const WebSocket = require('ws');

const WS_HOST = '127.0.0.1';
const WS_PORT = 8082;
let enabled = false;
let mode = 'LIVE';
let refreshRate = 25;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clampRefreshRate = value => {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), 10, 40) : 25;
};

function identify(port) {
  const manufacturer = String(port.manufacturer || '').trim();
  const product = String(port.product || '').trim();
  const text = `${manufacturer} ${product}`.toLowerCase();
  const vid = String(port.vendorId || '').toLowerCase();
  const pid = String(port.productId || '').toLowerCase();
  const serial = String(port.serialNumber || '').toUpperCase();
  const usb = { vendorId: vid || null, productId: pid || null, serialNumber: serial || null };

  if (text.includes('dmxking') || text.includes('jpk systems')) return { id: 'dmxking-pro', name: 'DMXking USB DMX', protocol: 'dmx-usb-pro', usb };
  if (text.includes('enttec')) {
    if (text.includes('open dmx') || text.includes('open-dmx')) return { id: 'enttec-open', name: 'ENTTEC Open DMX', protocol: 'open-dmx', usb };
    if (text.includes('dmx usb') || text.includes('dmx pro') || text.includes('dmxusb')) return { id: 'enttec-pro', name: 'ENTTEC DMX USB Pro', protocol: 'dmx-usb-pro', usb };
  }
  if (vid === '0403' && pid === '6001' && serial === 'BG04IAGK') return { id: 'dsd-tech-open-dmx', name: 'DSD TECH USB DMX / ENTTEC Open DMX', protocol: 'open-dmx', usb };
  if (text.includes('dsd tech') || text.includes('dsdtech')) return { id: 'dsd-tech-open-dmx', name: 'DSD TECH USB DMX / ENTTEC Open DMX', protocol: 'open-dmx', usb };
  if (vid === '0403' && ['6001', '6010', '6011', '6014'].includes(pid)) return { id: 'open-dmx', name: 'OpenDMX / FTDI-compatible', protocol: 'open-dmx', usb };
  return { id: 'generic-serial', name: product || manufacturer || 'USB serial DMX (manual)', protocol: 'open-dmx', usb };
}

function preferMacCuPort(devicePath) {
  const value = String(devicePath || '').trim();
  if (process.platform !== 'darwin') return value;
  if (value.startsWith('/dev/cu.')) return value;
  if (value.startsWith('/dev/tty.')) return `/dev/cu.${value.slice(9)}`;
  return value;
}

function filterMacSerialPorts(ports) {
  if (process.platform !== 'darwin') return ports;
  const cuPaths = new Set(ports.map(p => String(p.path || '')).filter(p => p.startsWith('/dev/cu.')));
  return ports.filter(port => {
    const path = String(port.path || '');
    return !path.startsWith('/dev/tty.') || !cuPaths.has(`/dev/cu.${path.slice(9)}`);
  });
}

class Driver {
  constructor() {
    this.port = null;
    this.path = '';
    this.frame = Buffer.alloc(512, 0);
    this.timer = null;
    this.writing = false;
    this.connected = false;
    this.lastError = null;
    this.info = { id: 'generic-serial', name: 'USB serial DMX (manual)', protocol: 'open-dmx' };
  }

  async listPorts() {
    const ports = filterMacSerialPorts(await SerialPort.list());
    return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || null, product: p.product || null, serialNumber: p.serialNumber || null, locationId: p.locationId || null, vendorId: p.vendorId || null, productId: p.productId || null, driver: identify(p) }));
  }

  async open(devicePath, driverInfo) {
    await this.close();
    const requested = String(devicePath || '').trim();
    if (!requested) throw new Error('No USB DMX device selected');
    const path = preferMacCuPort(requested);
    this.path = path;
    this.lastError = null;
    const ports = filterMacSerialPorts(await SerialPort.list());
    const detected = ports.find(p => p.path === path) || ports.find(p => p.path === requested);
    this.info = driverInfo || (detected ? identify(detected) : this.info);
    if (!['open-dmx', 'dmx-usb-pro'].includes(this.info.protocol)) throw new Error(`Unsupported USB-DMX protocol: ${this.info.protocol}`);

    this.port = new SerialPort({ path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false });
    this.port.on('error', err => { this.lastError = err?.message || String(err); this.connected = false; console.error('USB DMX SERIAL ERROR:', this.lastError); broadcastStatus(); });
    this.port.on('close', () => { this.connected = false; broadcastStatus(); });
    await new Promise((resolve, reject) => this.port.open(err => err ? reject(err) : resolve()));
    this.connected = true;
    this.start();
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    const interval = Math.max(25, Math.round(1000 / refreshRate));
    this.timer = setInterval(() => { void this.sendFrame(); }, interval);
  }

  setRefreshRate(value) {
    refreshRate = clampRefreshRate(value);
    if (this.connected) this.start();
  }

  setFrame(values) {
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) return;
    const src = Array.from(values);
    for (let i = 0; i < 512; i++) this.frame[i] = Number(src[i] ?? 0) & 0xff;
  }

  async sendOpenDMX() {
    if (!this.port?.isOpen || !this.port?.writable) return false;
    // OpenDMX uses a serial break followed by a zero start code and 512 slots.
    await new Promise((resolve, reject) => this.port.set({ brk: true }, err => err ? reject(err) : resolve()));
    await sleep(process.platform === 'win32' ? 1 : 1);
    await new Promise((resolve, reject) => this.port.set({ brk: false }, err => err ? reject(err) : resolve()));
    const packet = Buffer.alloc(513);
    this.frame.copy(packet, 1);
    return new Promise((resolve, reject) => this.port.write(packet, err => err ? reject(err) : this.port.drain(err2 => err2 ? reject(err2) : resolve(true))));
  }

  sendPro() {
    if (!this.port?.isOpen || !this.port?.writable) return Promise.resolve(false);
    // ENTTEC/DMX USB Pro packet: 0x7E, label 0x06, payload length 513 (LSB/MSB), start code + 512 slots, 0xE7.
    const packet = Buffer.alloc(518);
    packet[0] = 0x7e;
    packet[1] = 0x06;
    packet[2] = 0x01;
    packet[3] = 0x02;
    packet[4] = 0x00;
    this.frame.copy(packet, 5);
    packet[517] = 0xe7;
    return new Promise((resolve, reject) => this.port.write(packet, err => err ? reject(err) : this.port.drain(err2 => err2 ? reject(err2) : resolve(true))));
  }

  async sendFrame() {
    if (!enabled || mode !== 'LIVE' || !this.connected || !this.port?.isOpen || !this.port?.writable || this.writing) return false;
    this.writing = true;
    try { return this.info.protocol === 'dmx-usb-pro' ? await this.sendPro() : await this.sendOpenDMX(); }
    catch (err) { this.lastError = err?.message || String(err); console.error('USB DMX OUTPUT ERROR:', this.lastError); return false; }
    finally { this.writing = false; }
  }

  async close() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const port = this.port;
    this.port = null;
    this.connected = false;
    this.writing = false;
    if (!port || !port.isOpen) return;
    try { await new Promise(resolve => port.close(() => resolve())); } catch (_) {}
  }

  status() { return { path: this.path, connected: this.connected, error: this.lastError || null, driver: this.info, refreshRate }; }
}

const usb = new Driver();
let wss;
let configQueue = Promise.resolve();

function broadcast(message) {
  if (!wss) return;
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { try { client.send(JSON.stringify(message)); } catch (_) {} } });
}
function broadcastStatus() { broadcast({ type: 'USB_DMX_STATUS', enabled, mode, ...usb.status(), online: usb.connected && enabled && mode === 'LIVE' }); }

wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => console.log(`USB DMX SERVICE READY — ws://${WS_HOST}:${WS_PORT}`));
wss.on('error', err => console.error('USB DMX SERVICE ERROR:', err.message));

async function applyConfigNow(message) {
  enabled = Boolean(message.enabled);
  mode = String(message.mode || 'LIVE').toUpperCase() === 'BLIND' ? 'BLIND' : 'LIVE';
  const requestedRate = message.refreshRate != null ? clampRefreshRate(message.refreshRate) : refreshRate;

  if (!enabled || mode !== 'LIVE') { refreshRate = requestedRate; await usb.close(); broadcastStatus(); return; }

  const devicePath = String(message.device || '').trim();
  if (!devicePath) { await usb.close(); usb.lastError = 'No USB DMX device selected'; broadcastStatus(); return; }

  try {
    const driverInfo = message.driver && typeof message.driver === 'object' ? message.driver : null;
    const preferredPath = preferMacCuPort(devicePath);
    const protocol = driverInfo?.protocol || null;
    const driverId = driverInfo?.id || null;
    const needsReopen = usb.path !== preferredPath || !usb.connected || (protocol && protocol !== usb.info?.protocol) || (driverId && driverId !== usb.info?.id);
    if (needsReopen) { refreshRate = requestedRate; await usb.open(preferredPath, driverInfo || usb.info); }
    else usb.setRefreshRate(requestedRate);
    broadcastStatus();
  } catch (err) {
    await usb.close();
    usb.lastError = err?.message || String(err);
    console.error('USB DMX OPEN ERROR:', usb.lastError);
    broadcastStatus();
  }
}

function applyConfig(message) {
  configQueue = configQueue.then(() => applyConfigNow(message)).catch(err => { usb.lastError = err?.message || String(err); broadcastStatus(); });
  return configQueue;
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'USB_DMX_STATUS', enabled, mode, ...usb.status(), online: usb.connected && enabled && mode === 'LIVE' }));
  ws.on('message', data => {
    try {
      const message = JSON.parse(String(data));
      if (message?.type === 'USB_DMX_CONFIG') { void applyConfig(message); return; }
      if (message?.type === 'USB_DMX_PORTS') { usb.listPorts().then(ports => ws.send(JSON.stringify({ type: 'USB_DMX_PORTS', refreshRate, refreshRates: [10, 15, 20, 25, 30, 35, 40], ports }))).catch(err => ws.send(JSON.stringify({ type: 'USB_DMX_PORTS', refreshRate, refreshRates: [10, 15, 20, 25, 30, 35, 40], ports: [], error: err?.message || String(err) }))); return; }
      if (message?.type === 'USB_DMX_UPDATE' && Array.isArray(message.dmx) && enabled && mode === 'LIVE') usb.setFrame(message.dmx);
    } catch (err) { console.warn('Invalid USB DMX message:', err.message); }
  });
});

async function shutdown() {
  enabled = false;
  mode = 'BLIND';
  await configQueue.catch(() => {});
  await usb.close();
  try { wss.close(); } catch (_) {}
}

module.exports = { shutdown, usb, identify, preferMacCuPort };
