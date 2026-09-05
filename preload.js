const { contextBridge, ipcRenderer } = require('electron');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

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
 *
 * The L900-10 can use the newer KLAP local protocol.  Do not use
 * loginDeviceByIp() from an older/incompatible transport here: the
 * device can reject that path with "legacy login not supported".
 * ------------------------------------------------------------ */
try {
  const sessions = new Map();

  const sha1 = value => crypto.createHash('sha1').update(value).digest();
  const sha256 = value => crypto.createHash('sha256').update(value).digest();
  const text = value => Buffer.from(String(value), 'utf8');

  const generateAuthHash = (email, password) =>
    sha256(Buffer.concat([sha1(email), sha1(password)]));

  const postBinary = (ip, pathname, body, headers = {}) => new Promise((resolve, reject) => {
    const request = http.request({
      hostname: ip,
      port: 80,
      path: pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': body.length,
        'Content-Type': 'application/octet-stream'
      },
      timeout: 8000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on('timeout', () => request.destroy(new Error('Tapo connection timed out')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });

  const deriveKlap = (localSeed, remoteSeed, authHash) => {
    const key = sha256(Buffer.concat([text('lsk'), localSeed, remoteSeed, authHash])).subarray(0, 16);
    const iv = sha256(Buffer.concat([text('iv'), localSeed, remoteSeed, authHash]));
    const sig = sha256(Buffer.concat([text('ldk'), localSeed, remoteSeed, authHash])).subarray(0, 28);
    return { key, iv, sig };
  };

  const incrementSeq = seq => {
    const next = Buffer.alloc(4);
    next.writeInt32BE((seq.readInt32BE(0) + 1) | 0, 0);
    return next;
  };

  const ivWithSeq = (iv, seq) => Buffer.concat([iv.subarray(0, 12), seq]);

  const encrypt = (payload, key, iv, seq) => {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, ivWithSeq(iv, seq));
    return Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
  };

  const decrypt = (payload, key, iv, seq) => {
    if (!Buffer.isBuffer(payload) || payload.length <= 32) throw new Error('Invalid KLAP response');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivWithSeq(iv, seq));
    const plaintext = Buffer.concat([decipher.update(payload.subarray(32)), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  };

  const createKlapSession = async (config) => {
    const ip = String(config?.ip || '').trim();
    const email = String(config?.email || '').trim();
    const password = String(config?.password || '');
    if (!ip || !email || !password) throw new Error('Tapo IP, email and password are required');

    const localSeed = crypto.randomBytes(16);
    const handshake1 = await postBinary(ip, '/app/handshake1', localSeed);
    if (handshake1.status !== 200) {
      if (handshake1.status === 404) throw new Error('KLAP protocol not supported by this device');
      throw new Error(`Tapo handshake1 failed (HTTP ${handshake1.status})`);
    }
    if (handshake1.body.length < 32) throw new Error('Invalid Tapo handshake1 response');

    const setCookie = handshake1.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) && setCookie.length
      ? String(setCookie[0]).split(';')[0]
      : '';
    if (!cookie) throw new Error('Tapo did not return a KLAP session cookie');

    const remoteSeed = handshake1.body.subarray(0, 16);
    const serverHash = handshake1.body.subarray(16);
    const authHash = generateAuthHash(email, password);
    const expectedHash = sha256(Buffer.concat([localSeed, remoteSeed, authHash]));

    if (!crypto.timingSafeEqual(expectedHash, serverHash)) {
      throw new Error('Tapo email or password incorrect');
    }

    const handshake2 = sha256(Buffer.concat([remoteSeed, localSeed, authHash]));
    const handshake2Response = await postBinary(ip, '/app/handshake2', handshake2, { Cookie: cookie });
    if (handshake2Response.status !== 200) {
      throw new Error(`Tapo handshake2 failed (HTTP ${handshake2Response.status})`);
    }

    const { key, iv, sig } = deriveKlap(localSeed, remoteSeed, authHash);
    let seq = iv.subarray(iv.length - 4);

    const send = async payload => {
      seq = incrementSeq(seq);
      const encrypted = encrypt(payload, key, iv, seq);
      const signature = sha256(Buffer.concat([sig, seq, encrypted]));
      const requestBody = Buffer.concat([signature, encrypted]);
      const response = await postBinary(
        ip,
        `/app/request?seq=${seq.readInt32BE(0)}`,
        requestBody,
        { Cookie: cookie }
      );

      if (response.status !== 200) {
        throw new Error(`Tapo request failed (HTTP ${response.status})`);
      }

      const result = decrypt(response.body, key, iv, seq);
      if (result && Number(result.error_code) !== 0) {
        const message = result.msg || `Device error ${result.error_code}`;
        throw new Error(message);
      }
      return result?.result ?? result;
    };

    return { send };
  };

  const keyFor = config => `${config?.ip || ''}|${config?.email || ''}`;

  const getDevice = async config => {
    const key = keyFor(config);
    let session = sessions.get(key);
    if (!session) {
      session = { promise: createKlapSession(config) };
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
      return device.send({ method: 'get_device_info' });
    },

    setState: async (config, state) => {
      const device = await getDevice(config);
      const brightness = Math.max(1, Math.min(100, Math.round(Number(state?.brightness ?? 100))));
      const on = Boolean(state?.on);
      const colour = String(state?.colour || '#ffffff');

      if (!on) {
        await device.send({
          method: 'set_device_info',
          params: { device_on: false }
        });
        return { ok: true, on: false };
      }

      await device.send({
        method: 'set_device_info',
        params: { device_on: true }
      });

      await device.send({
        method: 'set_device_info',
        params: { brightness }
      });

      const match = /^#([0-9a-f]{6})$/i.exec(colour);
      if (match) {
        const rgb = match[1];
        const r = parseInt(rgb.slice(0, 2), 16) / 255;
        const g = parseInt(rgb.slice(2, 4), 16) / 255;
        const b = parseInt(rgb.slice(4, 6), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const light = (max + min) / 2;
        let hue = 0;
        let saturation = 0;

        if (max !== min) {
          const delta = max - min;
          saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
          if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
          else if (max === g) hue = (b - r) / delta + 2;
          else hue = (r - g) / delta + 4;
          hue /= 6;
        }

        await device.send({
          method: 'set_device_info',
          params: {
            hue: Math.round(hue * 360),
            saturation: Math.round(saturation * 100),
            brightness,
            color_temp: 0
          }
        });
      }

      return { ok: true, on: true, brightness, colour };
    },

    clearSession: config => {
      sessions.delete(keyFor(config));
      return true;
    }
  };

  contextBridge.exposeInMainWorld('Tapo', tapoApi);
  console.log('[TAPO] Direct KLAP bridge exposed');
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
