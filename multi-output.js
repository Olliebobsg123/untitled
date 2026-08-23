'use strict';

const { SerialPort } = require('serialport');
const WebSocket = require('ws');
const dgram = require('dgram');
const crypto = require('crypto');

const WS_HOST = '127.0.0.1';
const WS_PORT = 8083;
const MAX_OUTPUTS = 10;
const USB_RATES = [10, 15, 20, 25, 30, 35, 40];
const NETWORK_REFRESH_RATE = 40;
const NETWORK_INTERVAL = Math.round(1000 / NETWORK_REFRESH_RATE);

const outputs = new Map();
const universes = new Map();
const artnetSocket = dgram.createSocket('udp4');
const sacnSocket = dgram.createSocket('udp4');
const cid = crypto.randomBytes(16);
let wss = null;
let artnetSequence = 0;
let sacnSequence = 0;
let udpReady = false;
let configQueue = Promise.resolve();

const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

artnetSocket.on('error', err => console.error('MULTI ART-NET UDP ERROR:', err.message));
sacnSocket.on('error', err => console.error('MULTI sACN UDP ERROR:', err.message));
artnetSocket.bind(0, '0.0.0.0', () => {
  udpReady = true;
  console.log(`MULTI NETWORK OUTPUT READY → ${NETWORK_REFRESH_RATE}Hz`);
});

function frameFor(universe) {
  const key = String(Number(universe));
  return universes.get(key) || Buffer.alloc(512, 0);
}

function buildArtDMX(frame, universe) {
  const packet = Buffer.alloc(530);
  Buffer.from('Art-Net\0', 'ascii').copy(packet, 0);
  packet.writeUInt16LE(0x5000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = artnetSequence = (artnetSequence + 1) & 0xff;
  packet[13] = 0;
  packet.writeUInt16LE(clamp(universe, 0, 32767, 0), 14);
  packet.writeUInt16BE(512, 16);
  frame.copy(packet, 18, 0, 512);
  return packet;
}

function setFlagsAndLength(packet, offset, length) {
  packet.writeUInt16BE(0x7000 | (length & 0x0fff), offset);
}

function buildSacn(frame, universe, priority = 100) {
  const packet = Buffer.alloc(638);
  packet.writeUInt16BE(0x0010, 0);
  packet.writeUInt16BE(0x0000, 2);
  Buffer.from('ASC-E1.17\0\0\0', 'ascii').copy(packet, 4, 0, 12);
  setFlagsAndLength(packet, 16, 620);
  packet.writeUInt32BE(0x00000004, 18);
  cid.copy(packet, 22);
  setFlagsAndLength(packet, 38, 598);
  packet.writeUInt32BE(0x00000002, 40);
  Buffer.from('Lighting Console', 'ascii').copy(packet, 44);
  packet[108] = clamp(priority, 0, 200, 100);
  packet[109] = 0;
  packet[110] = 0;
  packet[111] = sacnSequence = (sacnSequence + 1) & 0xff;
  packet.writeUInt16BE(clamp(universe, 1, 63999, 1), 112);
  setFlagsAndLength(packet, 114, 522);
  packet.writeUInt16BE(0x02a1, 116);
  packet[118] = 0xa1;
  packet.writeUInt16BE(0, 119);
  packet.writeUInt16BE(513, 121);
  packet[123] = 0;
  frame.copy(packet, 124, 0, 512);
  return packet;
}

function sacnTarget(universe) {
  const u = clamp(universe, 1, 63999, 1);
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}

function stopNetwork(output) {
  if (output.networkTimer) clearInterval(output.networkTimer);
  output.networkTimer = null;
}

function stopUsb(output) {
  if (output.timer) clearInterval(output.timer);
  output.timer = null;
  const port = output.port;
  output.port = null;
  output.connected = false;
  output.writing = false;
  if (port?.isOpen) {
    try { port.close(() => {}); } catch (_) {}
  }
}

function stopOutput(output) {
  stopNetwork(output);
  stopUsb(output);
}

function usbPath(device) {
  const path = String(device || '').trim();
  if (process.platform === 'darwin' && path.startsWith('/dev/tty.')) {
    return `/dev/cu.${path.slice('/dev/tty.'.length)}`;
  }
  return path;
}

async function sendOpenDMX(output) {
  if (!output.port?.isOpen || !output.port?.writable || output.writing) return false;
  output.writing = true;
  try {
    await new Promise((resolve, reject) => output.port.set({ brk: true }, err => err ? reject(err) : resolve()));
    await new Promise(resolve => setTimeout(resolve, 1));
    await new Promise((resolve, reject) => output.port.set({ brk: false }, err => err ? reject(err) : resolve()));
    const packet = Buffer.alloc(513);
    packet[0] = 0;
    frameFor(output.universe).copy(packet, 1);
    await new Promise((resolve, reject) => output.port.write(packet, err => err ? reject(err) : resolve()));
    output.tx = (output.tx || 0) + 1;
    return true;
  } catch (err) {
    output.error = err?.message || String(err);
    return false;
  } finally {
    output.writing = false;
  }
}

async function startUsb(output) {
  stopUsb(output);
  if (!output.enabled || !output.usbDevice) return;
  const path = usbPath(output.usbDevice);
  output.port = new SerialPort({ path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false });
  output.port.on('error', err => {
    output.error = err?.message || String(err);
    output.connected = false;
    broadcastStatus();
  });
  output.port.on('close', () => {
    output.connected = false;
    broadcastStatus();
  });
  await new Promise((resolve, reject) => output.port.open(err => err ? reject(err) : resolve()));
  output.connected = true;
  output.error = null;
  output.tx = 0;
  const interval = Math.max(25, Math.round(1000 / output.refreshRate));
  output.timer = setInterval(() => {
    if (output.enabled) sendOpenDMX(output);
  }, interval);
  console.log(`MULTI USB CONNECTED → ${path} @ ${output.refreshRate}Hz universe ${output.universe}`);
}

function startNetwork(output) {
  stopNetwork(output);
  if (!output.enabled || output.protocol === 'usb') return;
  // Send immediately, then keep the timer alive independently of frontend
  // configuration messages. This is critical because the frontend may resend
  // the same configuration frequently while the console is running.
  sendNetwork(output);
  output.networkTimer = setInterval(() => {
    if (output.enabled && output.protocol !== 'usb') sendNetwork(output);
  }, NETWORK_INTERVAL);
}

async function configureOutput(config) {
  const id = String(config?.id || '').trim();
  if (!id) return;

  const previous = outputs.get(id);
  const protocol = ['artnet', 'sacn', 'usb'].includes(String(config.protocol || '').toLowerCase())
    ? String(config.protocol).toLowerCase()
    : 'artnet';

  const output = {
    ...(previous || {}),
    ...config,
    id,
    protocol,
    universe: protocol === 'sacn' ? clamp(config.universe, 1, 63999, 1) : clamp(config.universe, 0, 32767, 0),
    refreshRate: USB_RATES.includes(Number(config.refreshRate)) ? Number(config.refreshRate) : (previous?.refreshRate || 25),
    enabled: Boolean(config.enabled),
    target: String(config.target || (protocol === 'artnet' ? '192.168.1.1' : '127.0.0.1')).trim(),
    multicast: protocol === 'sacn' ? Boolean(config.multicast) : false,
    priority: clamp(config.priority, 0, 200, 100),
    connected: previous?.connected || false,
    error: null,
    port: previous?.port || null,
    timer: previous?.timer || null,
    networkTimer: previous?.networkTimer || null,
    writing: false,
    tx: previous?.tx || 0
  };

  const usbChanged = previous && (
    previous.protocol !== protocol ||
    previous.usbDevice !== output.usbDevice ||
    previous.refreshRate !== output.refreshRate ||
    previous.universe !== output.universe
  );

  outputs.set(id, output);

  if (protocol === 'usb') {
    stopNetwork(output);
    if (output.enabled && (!previous?.connected || usbChanged)) {
      try {
        await startUsb(output);
      } catch (err) {
        output.error = err?.message || String(err);
        output.connected = false;
        stopUsb(output);
        console.error(`MULTI USB OPEN ERROR → ${output.usbDevice}:`, output.error);
      }
    } else if (!output.enabled) {
      stopUsb(output);
    } else if (previous?.connected && previous.refreshRate !== output.refreshRate) {
      stopUsb(output);
      try { await startUsb(output); } catch (err) { output.error = err?.message || String(err); }
    }
  } else {
    stopUsb(output);

    // IMPORTANT: Do not tear down/recreate the network interval whenever the
    // frontend sends another config message. If that happens repeatedly, a
    // continuously-reset interval can be starved and Art-Net appears to send
    // only once. Keep the existing timer alive and update the output object.
    if (!output.enabled) {
      stopNetwork(output);
    } else if (!previous || !previous.networkTimer) {
      startNetwork(output);
    } else {
      // Send the newest frame/config immediately, but preserve the existing
      // continuous 40 Hz timer.
      sendNetwork(output);
    }
  }
}

async function applyConfigNow(message) {
  const list = Array.isArray(message?.outputs) ? message.outputs.slice(0, MAX_OUTPUTS) : [];
  const ids = new Set(list.map(o => String(o?.id || '').trim()).filter(Boolean));
  for (const [id, output] of outputs) {
    if (!ids.has(id)) {
      stopOutput(output);
      outputs.delete(id);
    }
  }
  for (const config of list) await configureOutput(config);
  broadcastStatus();
}

function applyConfig(message) {
  configQueue = configQueue.then(() => applyConfigNow(message)).catch(err => {
    console.error('MULTI OUTPUT CONFIG ERROR:', err.message);
    broadcastStatus();
  });
  return configQueue;
}

function sendNetwork(output) {
  if (!output.enabled || !udpReady || output.protocol === 'usb') return;
  const frame = frameFor(output.universe);

  if (output.protocol === 'sacn') {
    const universe = clamp(output.universe, 1, 63999, 1);
    const target = output.multicast ? sacnTarget(universe) : (output.target || '127.0.0.1');
    sacnSocket.send(buildSacn(frame, universe, output.priority), 5568, target, err => {
      if (err) {
        output.error = err.message;
        return;
      }
      output.tx = (output.tx || 0) + 1;
    });
    return;
  }

  const target = output.target || '192.168.1.1';
  artnetSocket.send(buildArtDMX(frame, output.universe), 6454, target, err => {
    if (err) {
      output.error = err.message;
      return;
    }
    output.tx = (output.tx || 0) + 1;
  });
}

function statusFor(output) {
  return {
    id: output.id,
    protocol: output.protocol,
    universe: output.universe,
    target: output.target || '',
    usbDevice: output.usbDevice || '',
    enabled: output.enabled,
    connected: output.protocol === 'usb' ? Boolean(output.connected) : Boolean(output.enabled && udpReady),
    error: output.error || null,
    refreshRate: output.refreshRate,
    networkRefreshRate: output.protocol === 'usb' ? null : NETWORK_REFRESH_RATE,
    tx: output.tx || 0
  };
}

function broadcastStatus() {
  if (!wss) return;
  const message = { type: 'MULTI_OUTPUT_STATUS', maxOutputs: MAX_OUTPUTS, outputs: [...outputs.values()].map(statusFor) };
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(message)); } catch (_) {}
    }
  });
}

async function listUsbPorts() {
  const ports = await SerialPort.list();
  const seen = new Set();
  return ports.filter(p => {
    const path = String(p.path || '');
    const key = path.replace(/^\/dev\/(tty|cu)\./, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(p => ({
    path: p.path,
    manufacturer: p.manufacturer || null,
    product: p.product || null,
    serialNumber: p.serialNumber || null,
    locationId: p.locationId || null,
    vendorId: p.vendorId || null,
    productId: p.productId || null
  }));
}

wss = new WebSocket.Server({ host: WS_HOST, port: WS_PORT });
wss.on('listening', () => console.log(`MULTI OUTPUT SERVICE READY — ws://${WS_HOST}:${WS_PORT}`));
wss.on('error', err => console.error('MULTI OUTPUT SERVICE ERROR:', err.message));
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'MULTI_OUTPUT_STATUS', maxOutputs: MAX_OUTPUTS, outputs: [...outputs.values()].map(statusFor) }));
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
          if (!Array.isArray(values) && !ArrayBuffer.isView(values)) continue;
          const frame = Buffer.alloc(512, 0);
          const src = Array.from(values).slice(0, 512);
          for (let i = 0; i < src.length; i++) frame[i] = Number(src[i]) & 0xff;
          universes.set(String(Number(u)), frame);
        }
      }
    } catch (err) {
      console.warn('MULTI OUTPUT MESSAGE ERROR:', err.message);
    }
  });
});

async function shutdown() {
  for (const output of outputs.values()) stopOutput(output);
  try { artnetSocket.close(); } catch (_) {}
  try { sacnSocket.close(); } catch (_) {}
  try { wss?.close(); } catch (_) {}
}

module.exports = { shutdown, outputs };
