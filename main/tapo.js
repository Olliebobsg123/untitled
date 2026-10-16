'use strict';

// TP-Link Tapo smart bulbs as fixtures (js/tapo-integration.js decides what each
// bulb shows). Newer Tapo firmware needs the TPAP handshake from iobroker.tapo,
// and AES-CCM that Electron's crypto lacks (main/tapo-ccm.js adds it).

require('./tapo-ccm.js');
const P100Module = require('iobroker.tapo/build/lib/utils/p100.js');

const P100 = P100Module.default || P100Module;
const sessions = new Map();
const logger = {
  debug: () => {},
  info: (...args) => console.info('[TAPO]', ...args),
  warn: (...args) => console.warn('[TAPO]', ...args),
  error: (...args) => console.error('[TAPO]', ...args)
};

const keyFor = config => `${String(config?.ip || '').trim()}|${String(config?.email || '').trim()}`;

async function createDevice(config) {
  const ip = String(config?.ip || '').trim();
  const email = String(config?.email || '').trim();
  const password = String(config?.password || '');
  if (!ip || !email || !password) throw new Error('Tapo IP, email and password are required');
  const device = new P100(logger, ip, email, password, 8, 80, false);
  if (typeof device.handshake_tpap !== 'function') throw new Error('TPAP transport is not available in the installed Tapo library');
  await device.handshake_tpap();
  return device;
}

async function getDevice(config) {
  const key = keyFor(config);
  if (!sessions.has(key)) sessions.set(key, createDevice(config));
  try {
    return await sessions.get(key);
  } catch (error) {
    sessions.delete(key);
    throw error;
  }
}

async function sendCommand(config, method, params = {}) {
  const device = await getDevice(config);
  try {
    return await device.sendCommand(method, params);
  } catch (error) {
    sessions.delete(keyFor(config));
    throw error;
  }
}

function hexToHsl(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return { hue: 0, saturation: 0 };
  const delta = max - min;
  const saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { hue: Math.round((hue / 6) * 360), saturation: Math.round(saturation * 100) };
}

const test = config => sendCommand(config, 'get_device_info');

async function setState(config, state = {}) {
  if (!state.on) {
    await sendCommand(config, 'set_device_info', { device_on: false, transition_period: 0 });
    return { ok: true, on: false };
  }
  const brightness = Math.max(1, Math.min(100, Math.round(Number(state.brightness ?? 100))));
  const colour = hexToHsl(state.colour);
  await sendCommand(config, 'set_device_info', colour
    ? { device_on: true, brightness, hue: colour.hue, saturation: colour.saturation, color_temp: 0, transition_period: 0 }
    : { device_on: true, brightness, transition_period: 0 });
  return { ok: true, on: true, brightness, colour: state.colour || null };
}

function clearSession(config) {
  sessions.delete(keyFor(config));
  return true;
}

module.exports = { test, setState, clearSession };
