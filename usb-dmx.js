'use strict';

const { SerialPort } = require('serialport');
const WebSocket = require('ws');

const WS_HOST = '127.0.0.1';
const WS_PORT = 8082;
let enabled = false;
let mode = 'LIVE';
let refreshRate = 25;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clampRefreshRate = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(10, Math.min(40, Math.round(n))) : 25;
};

function identify(port) {
  const manufacturer = String(port.manufacturer || '').trim();
  const product = String(port.product || '').trim();
  const text = `${manufacturer} ${product}`.toLowerCase();
  const vid = String(port.vendorId || '').toLowerCase();
  const pid = String(port.productId || '').toLowerCase();
  const serial = String(port.serialNumber || '').toUpperCase();
  const usb = { vendorId: vid || null, productId: pid || null, serialNumber: serial || null };

  if (text.includes('dmxking') || text.includes('jpk systems')) {
    return { id: 'dmxking-pro', name: 'DMXking USB DMX', protocol: 'dmx-usb-pro', usb };
  }
  if (text.includes('enttec')) {
    if (text.includes('open dmx') || text.includes('open-dmx')) {
      return { id: 'enttec-open', name: 'ENTTEC Open DMX', protocol: 'open-dmx', usb };
    }
    if (text.includes('dmx usb') || text.includes('dmx pro') || text.includes('dmxusb')) {
      return { id: 'enttec-pro', name: 'ENTTEC DMX USB Pro', protocol: 'dmx-usb-pro', usb };
    }
  }
  if (vid === '0403' && pid === '6001' && serial === 'BG04IAGK') {
    return { id: 'dsd-tech-open-dmx', name: 'DSD TECH USB DMX / ENTTEC Open DMX', protocol: 'open-dmx', usb };
  }
  if (text.includes('dsd tech') || text.includes('dsdtech')) {
    return { id: 'dsd-tech-open-dmx', name: 'DSD TECH USB DMX / ENTTEC Open DMX', protocol: 'open-dmx', usb };
  }
  if (vid === '0403' && ['6001', '6010', '6011', '6014'].includes(pid)) {
    return { id: 'open-dmx', name: 'OpenDMX / FTDI-compatible', protocol: 'open-dmx', usb };
  }
  return { id: 'generic-serial', name: product || manufacturer || 'USB serial DMX (manual)', protocol: 'open-dmx', usb };
}

function preferMacCuPort(devicePath) {
  const path = String(devicePath || '').trim();
  if (process.platform !== 'darwin') return path;
  if (path.startsWith('/dev/cu.')) return path;
  if (path.startsWith('/dev/tty.')) return `/dev/cu.${path.slice('/dev/tty.'.length)}`;
  return path;
}

function filterMacSerialPorts(ports) {
  if (process.platform !== 'darwin') return ports;
  const cuPaths = new Set(ports.map(p => String(p.path || '')).filter(p => p.startsWith('/dev/cu.')));
  return ports.filter(port => {
    const path = String(port.path || '');
    if (!path.startsWith('/dev/tty.')) return true;
    return !cuPaths.has(`/dev/cu.${path.slice('/dev/tty.'.length)}`);
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
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || null,
      product: p.product || null,
      serialNumber: p.serialNumber || null,
      locationId: p.locationId || null,
      vendorId: p.vendorId || null,
      productId: p.productId || null,
      driver: identify(p)
    }));
  }

  async open(devicePath, driverInfo) {
    await this.close();
    const requestedPath = String(devicePath || '').trim();
    if (!requestedPath) throw new Error('No USB DMX device selected');
    const path = preferMacCuPort(requestedPath);
    this.path = path;
    this.lastError = null;
    const ports = filterMacSerialPorts(await SerialPort.list());
    const detected = ports.find(p => p.path === path) || ports.find(p => p.path === requestedPath);
    this.info = driverInfo || (detected ? identify(detected) : this.info);
    if (!this.info.protocol) throw new Error('Unknown USB-DMX protocol. Please select DMX USB Pro or OpenDMX.');
    if (!['open-dmx', 'dmx-usb-pro'].includes(this.info.protocol)) throw new Error(`Unsupported USB-DMX protocol: ${this.info.protocol}`);

    console.log(`USB DMX OPEN → ${path}`);
    console.log(`USB DMX PROTOCOL → ${this.info.protocol === 'open-dmx' ? 'OpenDMX' : 'DMX USB Pro'}`);

    this.port = new SerialPort({ path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false });
    this.port.on('error', err => {
      this.lastError = err?.message || String(err);
      this.connected = false;
      console.error('USB DMX SERIAL ERROR:', this.lastError);
      broadcastStatus();
    });
    this.port.on('close', () => { this.connected = false; broadcastStatus(); });

    await new Promise((resolve, reject) => this.port.open(err => err ? reject(err) : resolve()));
    this.connected = true;
    console.log(`USB DMX CONNECTED → ${path}`);
    this.start();
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    const interval = Math.max(25, Math.round(1000 / refreshRate));
    this.timer = setInterval(() => this.sendFrame(), interval);
  }

  setRefreshRate(value) {
    const next = clampRefreshRate(value);
    if (next === refreshRate) return;
    refreshRate = next;
    if (this.connected) this.start();
    broadcastStatus();
  }

  setFrame(values) {
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) return;
    const src = Array.from(values);
    for (let i = 0; i < 512; i++) this.frame[i] = Number(src[i] ?? 0) & 0xff;
  }

  async sendOpenDMX() {
    if (!this.port?.isOpen || !this.port?.writable) return false;
    await new Promise((resolve, reject) => this.port.set({ brk: true }, err => err ? reject(err) : resolve()));
    await sleep(1);
    await new Promise((resolve, reject) => this.port.set({ brk: false }, err => err ? reject(err) : resolve()));
    const packet = Buffer.alloc(513);
    packet[0] = 0;
    this.frame.copy(packet, 1);
    await new Promise((resolve, reject) => this.port.write(packet, err => err ? reject(err) : resolve()));
    return true;
  }

  sendPro() {
    if (!this.port?.isOpen || !this.port?.writable) return Promise.resolve(false);
    const packet = Buffer.alloc(518);
    packet[0] = 0x7e; packet[1] = 0x06; packet[2] = 0x01; packet[3] = 0x02; packet[4] = 0x00;
    this.frame.copy(packet, 5); packet[517] = 0xe7;
    return new Promise((resolve, reject) => this.port.write(packet, err => err ? reject(err) : this.port.drain(err2 => err2 ? reject(err2) : resolve(true))));
  }

  async sendFrame() {
    if (!enabled || mode !== 'LIVE' || !this.connected || !this.port?.isOpen || !this.port?.writable || this.writing) return false;
    this.writing = true;
    try {
      return this.info.protocol === 'dmx-usb-pro' ? await this.sendPro() : await this.sendOpenDMX();
    } catch (err) {
      this.lastError = err?.message || String(err);
      console.error('USB DMX OUTPUT ERROR:', this.lastError);
      return false;
    } finally {
      this.writing = false;
      broadcastStatus();
    }
  }

  async close() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const port = this.port;
    this.port = null;
    this.connected = false;
    this.writing = false;
    if (!port || !port.isOpen) return;
    await new Promise(resolve => port.close(() => resolve()));
  }

  status() {
    return { path: this.path, connected: this.connected, error: this.lastError || null, driver: this.info, refreshRate };
  }
}

const usb = new Driver();
let wss;
let configQueue = Promise.resolve();

function broadcast(message) {
  if (!wss) return;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(JSON.stringify(message)); } catch (_) {}
    }
  });
}
function broadcastStatus() {
  broadcast({ type: 'USB_DMX_STATUS', enabled, mode, ...usb.status(), online: usb.connected && enabled && mode === 'LIVE' });
}

wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => console.log(`USB DMX SERVICE READY — ws://${WS_HOST}:${WS_PORT}`));
wss.on('error', err => console.error('USB DMX SERVICE ERROR:', err.message));

async function applyConfigNow(message) {
  enabled = Boolean(message.enabled);
  mode = String(message.mode || 'LIVE').toUpperCase() === 'BLIND' ? 'BLIND' : 'LIVE';
  if (message.refreshRate != null) refreshRate = clampRefreshRate(message.refreshRate);

  if (!enabled || mode !== 'LIVE') {
    await usb.close();
    broadcastStatus();
    return;
  }

  const devicePath = String(message.device || '').trim();
  if (!devicePath) {
    await usb.close();
    usb.lastError = 'No USB DMX device selected';
    broadcastStatus();
    return;
  }

  try {
    const driverInfo = message.driver && typeof message.driver === 'object' ? message.driver : null;
    const preferredPath = preferMacCuPort(devicePath);
    const requestedProtocol = driverInfo?.protocol || null;
    const currentProtocol = usb.info?.protocol || null;
    const requestedDriverId = driverInfo?.id || null;
    const currentDriverId = usb.info?.id || null;
    const needsReopen = usb.path !== preferredPath || !usb.connected ||
      (requestedDriverId !== null && requestedDriverId !== currentDriverId) ||
      (requestedProtocol !== null && requestedProtocol !== currentProtocol);

    if (needsReopen) await usb.open(preferredPath, driverInfo || usb.info);
    else usb.setRefreshRate(refreshRate);
    broadcastStatus();
  } catch (err) {
    await usb.close();
    usb.lastError = err?.message || String(err);
    console.error('USB DMX OPEN ERROR:', usb.lastError);
    broadcastStatus();
  }
}

function applyConfig(message) {
  // WebSocket messages can arrive back-to-back while SerialPort.open() is
  // still awaiting the macOS device. SerialPort is not safe to open twice at
  // once, so serialize configuration changes through one queue.
  configQueue = configQueue
    .then(() => applyConfigNow(message))
    .catch(err => {
      usb.lastError = err?.message || String(err);
      console.error('USB DMX CONFIG ERROR:', usb.lastError);
      broadcastStatus();
    });
  return configQueue;
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'USB_DMX_STATUS', enabled, mode, ...usb.status(), online: usb.connected && enabled && mode === 'LIVE' }));
  ws.on('message', async data => {
    try {
      const message = JSON.parse(String(data));
      if (message?.type === 'USB_DMX_CONFIG') return applyConfig(message);
      if (message?.type === 'USB_DMX_PORTS') {
        ws.send(JSON.stringify({ type: 'USB_DMX_PORTS', refreshRate, refreshRates: [10, 15, 20, 25, 30, 35, 40], ports: await usb.listPorts() }));
        return;
      }
      if (message?.type === 'USB_DMX_UPDATE' && Array.isArray(message.dmx) && enabled && mode === 'LIVE') usb.setFrame(message.dmx);
    } catch (err) {
      console.warn('Invalid USB DMX message:', err.message);
    }
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
