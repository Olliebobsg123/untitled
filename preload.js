const { contextBridge, ipcRenderer } = require('electron');
const https = require('node:https');

const showFileApi = {
  save: (filePath, show) => ipcRenderer.invoke('lx-show-save', { filePath, show }),
  load: filePath => ipcRenderer.invoke('lx-show-load', { filePath }),
  getDefaultDirectory: () => ipcRenderer.invoke('lx-show-default-directory')
};

const feedbackApi = {
  send: payload => new Promise((resolve, reject) => {
    const apiUrl = new URL('https://api-bice-ten.vercel.app/api/feedback');
    const body = JSON.stringify({
      name: 'LX Console User',
      message: String(payload?.message || '').trim(),
      type: String(payload?.type || 'Feedback'),
      app: 'LX Console'
    });

    if (!JSON.parse(body).message) {
      reject(new Error('Please enter a message first.'));
      return;
    }

    const request = https.request({
      hostname: apiUrl.hostname,
      path: `${apiUrl.pathname}${apiUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 15000
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        let result = {};
        try { result = raw ? JSON.parse(raw) : {}; } catch (_) {}

        console.log('[FEEDBACK] API response:', response.statusCode, result || raw);

        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300 || result?.success === false) {
          reject(new Error(result?.error || result?.message || `Feedback API returned HTTP ${response.statusCode}`));
          return;
        }

        resolve({ success: true, status: response.statusCode, result });
      });
    });

    request.on('timeout', () => request.destroy(new Error('Feedback API request timed out')));
    request.on('error', error => reject(error));
    request.write(body);
    request.end();
  })
};

try {
  contextBridge.exposeInMainWorld('LXShowFiles', showFileApi);
  console.log('[SHOW DEBUG] LXShowFiles preload bridge exposed');
} catch (error) {
  console.error('[SHOW DEBUG] FAILED to expose LXShowFiles bridge:', error);
}

try {
  contextBridge.exposeInMainWorld('LXFeedbackMail', feedbackApi);
  console.log('[FEEDBACK] Electron feedback API bridge exposed');
} catch (error) {
  console.error('[FEEDBACK] FAILED to expose feedback API bridge:', error);
}

try {
  require('./js/tapo-ccm.js');

  const P100Module = require('iobroker.tapo/build/lib/utils/p100.js');
  const P100 = P100Module.default || P100Module;
  const sessions = new Map();
  const logger = {
    debug: (...args) => console.debug('[TAPO]', ...args),
    info: (...args) => console.info('[TAPO]', ...args),
    warn: (...args) => console.warn('[TAPO]', ...args),
    error: (...args) => console.error('[TAPO]', ...args)
  };
  const keyFor = config => `${String(config?.ip || '').trim()}|${String(config?.email || '').trim()}`;
  const createDevice = async config => {
    const ip = String(config?.ip || '').trim();
    const email = String(config?.email || '').trim();
    const password = String(config?.password || '');
    if (!ip || !email || !password) throw new Error('Tapo IP, email and password are required');
    const device = new P100(logger, ip, email, password, 8, 80, false);
    if (typeof device.handshake_tpap !== 'function') throw new Error('TPAP transport is not available in the installed Tapo library');
    await device.handshake_tpap();
    return device;
  };
  const getDevice = async config => {
    const key = keyFor(config);
    let session = sessions.get(key);
    if (!session) { session = { promise: createDevice(config) }; sessions.set(key, session); }
    try { return await session.promise; }
    catch (error) { sessions.delete(key); throw error; }
  };
  const sendCommand = async (config, method, params = {}) => {
    const device = await getDevice(config);
    try { return await device.sendCommand(method, params); }
    catch (error) { sessions.delete(keyFor(config)); throw error; }
  };
  const hexToHsl = hex => {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!match) return null;
    const rgb = match[1];
    const r = parseInt(rgb.slice(0, 2), 16) / 255;
    const g = parseInt(rgb.slice(2, 4), 16) / 255;
    const b = parseInt(rgb.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2;
    if (max === min) return { hue: 0, saturation: 0, brightness: Math.round(light * 100) };
    const delta = max - min;
    const saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return { hue: Math.round((hue / 6) * 360), saturation: Math.round(saturation * 100), brightness: Math.round(light * 100) };
  };
  const tapoApi = {
    test: async config => sendCommand(config, 'get_device_info'),
    setState: async (config, state = {}) => {
      const on = Boolean(state.on);
      const brightness = Math.max(1, Math.min(100, Math.round(Number(state.brightness ?? 100))));
      if (!on) {
        await sendCommand(config, 'set_device_info', { device_on: false, transition_period: 0 });
        return { ok: true, on: false };
      }
      const colour = hexToHsl(state.colour);
      await sendCommand(config, 'set_device_info', colour
        ? { device_on: true, brightness, hue: colour.hue, saturation: colour.saturation, color_temp: 0, transition_period: 0 }
        : { device_on: true, brightness, transition_period: 0 });
      return { ok: true, on: true, brightness, colour: state.colour || null };
    },
    clearSession: config => { sessions.delete(keyFor(config)); return true; }
  };
  contextBridge.exposeInMainWorld('Tapo', tapoApi);
  console.log('[TAPO] TPAP/SPAKE2+ bridge exposed');
} catch (error) {
  console.error('[TAPO] FAILED to expose Tapo bridge:', error);
  try { contextBridge.exposeInMainWorld('Tapo', null); } catch (_) {}
}

try {
  contextBridge.exposeInMainWorld('LXShowDebug', {
    bridgeReady: () => true,
    bridgeKeys: () => Object.keys(showFileApi)
  });
} catch (error) {
  console.error('[SHOW DEBUG] FAILED to expose LXShowDebug bridge:', error);
}

const injectRendererScript = (id, src, label) => {
  try {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = new URL(src, window.location.href).href;
    script.onload = () => console.log(`[SHOW DEBUG] ${label} loaded`);
    script.onerror = error => console.error(`[SHOW DEBUG] Failed to load ${label}:`, error);
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    console.error(`[SHOW DEBUG] Failed to inject ${label}:`, error);
  }
};

const injectShowFileCommands = () => injectRendererScript('lxShowFileCommandsScript', './js/showfile.js', 'showfile.js');
const injectFresnelControls = () => injectRendererScript('lxFresnelControlsScript', './js/fresnel-controls.js', 'fresnel-controls.js');
const injectTapoIntegration = () => injectRendererScript('lxTapoIntegrationScript', './js/tapo-integration.js', 'tapo-integration.js');
const injectShowFileVisualizerFix = () => injectRendererScript('lxShowFileVisualizerFixScript', './js/showfile-visualizer-fix.js', 'showfile-visualizer-fix.js');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShowFileCommands, { once: true });
  document.addEventListener('DOMContentLoaded', injectFresnelControls, { once: true });
  document.addEventListener('DOMContentLoaded', injectTapoIntegration, { once: true });
  document.addEventListener('DOMContentLoaded', injectShowFileVisualizerFix, { once: true });
} else {
  injectShowFileCommands();
  injectFresnelControls();
  injectTapoIntegration();
  injectShowFileVisualizerFix();
}
