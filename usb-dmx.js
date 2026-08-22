'use strict';

const { SerialPort } = require('serialport');
const WebSocket = require('ws');

const WS_HOST = '127.0.0.1';
const WS_PORT = 8082;
let enabled = false;
let mode = 'LIVE';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function identify(port) {
  const text = [port.manufacturer, port.product, port.vendorId, port.productId].filter(Boolean).join(' ').toLowerCase();
  const vid = String(port.vendorId || '').toLowerCase();
  const pid = String(port.productId || '').toLowerCase();
  if (text.includes('dmxking') || text.includes('jpk systems')) return { id: 'dmxking-pro', name: 'DMXking USB DMX', protocol: 'dmx-usb-pro' };
  if (text.includes('enttec') && (text.includes('dmx usb') || text.includes('open dmx') || text.includes('dmx pro'))) {
    if (text.includes('open dmx')) return { id: 'enttec-open', name: 'ENTTEC Open DMX', protocol: 'open-dmx' };
    return { id: 'enttec-pro', name: 'ENTTEC DMX USB Pro', protocol: 'dmx-usb-pro' };
  }
  if (vid === '0403' && ['6001', '6010', '6011', '6014'].includes(pid)) return { id: 'open-dmx', name: 'OpenDMX / FTDI-compatible', protocol: 'open-dmx' };
  return { id: 'generic-serial', name: 'USB serial DMX (manual)', protocol: 'open-dmx' };
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
    const ports = await SerialPort.list();
    return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer, product: p.product, vendorId: p.vendorId, productId: p.productId, driver: identify(p) }));
  }

  async open(devicePath, driverInfo) {
    await this.close();
    const path = String(devicePath || '').trim();
    if (!path) throw new Error('No USB DMX device selected');
    this.path = path;
    this.info = driverInfo || this.info;
    this.lastError = null;
    this.port = new SerialPort({ path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false });
    this.port.on('error', err => { this.lastError = err?.message || String(err); this.connected = false; broadcastStatus(); });
    this.port.on('close', () => { this.connected = false; broadcastStatus(); });
    await new Promise((resolve, reject) => this.port.open(err => err ? reject(err) : resolve()));
    this.connected = true;
    this.start();
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.sendFrame(), 25); }

  setFrame(values) {
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) return;
    const src = Array.from(values);
    for (let i = 0; i < 512; i++) this.frame[i] = Number(src[i] ?? 0) & 0xff;
  }

  async sendOpenDMX() {
    if (!this.port?.writable) return false;
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
    if (!this.port?.writable) return Promise.resolve(false);
    const packet = Buffer.alloc(518);
    packet[0] = 0x7e; packet[1] = 0x06; packet[2] = 0x01; packet[3] = 0x02; packet[4] = 0x00;
    this.frame.copy(packet, 5); packet[517] = 0xe7;
    return new Promise((resolve, reject) => this.port.write(packet, err => err ? reject(err) : this.port.drain(() => resolve(true))));
  }

  async sendFrame() {
    if (!enabled || mode !== 'LIVE' || !this.connected || !this.port?.writable || this.writing) return false;
    this.writing = true;
    try { return this.info.protocol === 'dmx-usb-pro' ? await this.sendPro() : await this.sendOpenDMX(); }
    catch (err) { this.lastError = err?.message || String(err); return false; }
    finally { this.writing = false; broadcastStatus(); }
  }

  async close() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const port = this.port; this.port = null; this.connected = false; this.writing = false;
    if (!port || !port.isOpen) return;
    await new Promise(resolve => port.close(() => resolve()));
  }

  status() { return { path: this.path, connected: this.connected, error: this.lastError || null, driver: this.info }; }
}

const usb = new Driver();
let wss;
function broadcast(message) { if (!wss) return; wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { try { client.send(JSON.stringify(message)); } catch (_) {} } }); }
function broadcastStatus() { broadcast({ type: 'USB_DMX_STATUS', enabled, mode, ...usb.status(), online: usb.connected && enabled && mode === 'LIVE' }); }

wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => console.log(`USB DMX SERVICE READY — ws://${WS_HOST}:${WS_PORT}`));
wss.on('error', err => console.error('USB DMX SERVICE ERROR:', err.message));

async function applyConfig(message) {
  enabled = Boolean(message.enabled);
  mode = String(message.mode || 'LIVE').toUpperCase() === 'BLIND' ? 'BLIND' : 'LIVE';
  if (!enabled || mode !== 'LIVE') { await usb.close(); broadcastStatus(); return; }
  const devicePath = String(message.device || '').trim();
  if (!devicePath) { await usb.close(); usb.lastError = 'No USB DMX device selected'; broadcastStatus(); return; }
  try {
    const driverInfo = message.driver && typeof message.driver === 'object' ? message.driver : null;
    if (usb.path !== devicePath || !usb.connected || driverInfo?.id !== usb.info.id) await usb.open(devicePath, driverInfo || usb.info);
    broadcastStatus();
  } catch (err) { await usb.close(); usb.lastError = err?.message || String(err); broadcastStatus(); }
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'USB_DMX_STATUS', enabled, mode, ...usb.status(), online: usb.connected && enabled && mode === 'LIVE' }));
  ws.on('message', async data => {
    try {
      const message = JSON.parse(String(data));
      if (message?.type === 'USB_DMX_CONFIG') return applyConfig(message);
      if (message?.type === 'USB_DMX_PORTS') { ws.send(JSON.stringify({ type: 'USB_DMX_PORTS', ports: await usb.listPorts() })); return; }
      if (message?.type === 'USB_DMX_UPDATE' && Array.isArray(message.dmx) && enabled && mode === 'LIVE') usb.setFrame(message.dmx);
    } catch (err) { console.warn('Invalid USB DMX message:', err.message); }
  });
});

async function shutdown() { enabled = false; mode = 'BLIND'; await usb.close(); try { wss.close(); } catch (_) {} }
module.exports = { shutdown, usb };
