const { contextBridge, ipcRenderer } = require('electron');

const showFileApi = {
  save: (filePath, show) => ipcRenderer.invoke('lx-show-save', { filePath, show }),
  load: filePath => ipcRenderer.invoke('lx-show-load', { filePath }),
  getDefaultDirectory: () => ipcRenderer.invoke('lx-show-default-directory')
};

try {
  contextBridge.exposeInMainWorld('LXShowFiles', showFileApi);
  console.log('[SHOW DEBUG] LXShowFiles preload bridge exposed');
} catch (error) {
  console.error('[SHOW DEBUG] FAILED to expose LXShowFiles bridge:', error);
}

/* ------------------------------------------------------------
 * Tapo L900-10 local Wi-Fi bridge
 * ------------------------------------------------------------ */
try {
  const { loginDeviceByIp } = require('tp-link-tapo-connect');
  const sessions = new Map();

  const keyFor = config => `${config?.ip || ''}|${config?.email || ''}`;

  const getDevice = async config => {
    const ip = String(config?.ip || '').trim();
    const email = String(config?.email || '').trim();
    const password = String(config?.password || '');
    if (!ip || !email || !password) throw new Error('Tapo IP, email and password are required');

    const key = keyFor({ ip, email });
    let session = sessions.get(key);
    if (!session) {
      session = { promise: loginDeviceByIp(email, password, ip), password };
      sessions.set(key, session);
    }

    try {
      return await session.promise;
    } catch (error) {
      sessions.delete(key);
      throw error;
    }
  };

  const tapoApi = {
    test: async config => {
      const device = await getDevice(config);
      return device.getDeviceInfo();
    },
    setState: async (config, state) => {
      const device = await getDevice(config);
      const brightness = Math.max(1, Math.min(100, Math.round(Number(state?.brightness ?? 100))));
      const on = Boolean(state?.on);
      const colour = String(state?.colour || '#ffffff');

      if (!on) {
        await device.turnOff();
        return { ok: true, on: false };
      }

      await device.turnOn();
      await device.setBrightness(brightness);
      if (colour) await device.setColour(colour);
      return { ok: true, on: true, brightness, colour };
    },
    clearSession: config => {
      sessions.delete(keyFor(config));
      return true;
    }
  };

  contextBridge.exposeInMainWorld('Tapo', tapoApi);
  console.log('[TAPO] Local Tapo bridge exposed');
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

const injectShowFileCommands = () => {
  injectRendererScript('lxShowFileCommandsScript', './js/showfile.js', 'showfile.js');
};

const injectFresnelControls = () => {
  injectRendererScript('lxFresnelControlsScript', './js/fresnel-controls.js', 'fresnel-controls.js');
};

const injectTapoIntegration = () => {
  injectRendererScript('lxTapoIntegrationScript', './js/tapo-integration.js', 'tapo-integration.js');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectShowFileCommands, { once: true });
  document.addEventListener('DOMContentLoaded', injectFresnelControls, { once: true });
  document.addEventListener('DOMContentLoaded', injectTapoIntegration, { once: true });
} else {
  injectShowFileCommands();
  injectFresnelControls();
  injectTapoIntegration();
}
