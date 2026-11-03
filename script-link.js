// Script link (main process): reads where Light Spark's cues go in the script from QLab Connect.
//
// QLab Connect keeps the show's script, with cues marked on it (QLab cues named "LX 5", or
// "LX 5" written in the script). Light Spark logs in as one of its departments and fetches
// GET /api/script/lighting: each lighting cue's line, word, speaker and page, plus the lines.
// The page (js/script-link.js) matches LX 5 to Light Spark's cue 5.
//
// The login is kept on this computer (userData/script-link.json), never in a show file; the
// password is encrypted with the system keychain when it's available.
const fs = require('fs');
const { safeStorage } = require('electron');

function createScriptLink({ configPath }) {
  let config = { url: '', departmentId: '', departmentName: '', password: '', token: '' };
  try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch (_) {}

  const save = () => { try { fs.writeFileSync(configPath, JSON.stringify(config)); } catch (_) {} };
  const seal = text => {
    if (!text) return '';
    try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64'); } catch (_) {}
    return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
  };
  const unseal = value => {
    const text = String(value || '');
    try {
      if (text.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(text.slice(4), 'base64'));
      if (text.startsWith('b64:')) return Buffer.from(text.slice(4), 'base64').toString('utf8');
    } catch (_) {}
    return '';
  };

  // "192.168.1.20" → "http://192.168.1.20:3030"
  function normaliseUrl(input) {
    let text = String(input || '').trim().replace(/\/+$/, '');
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) text = 'http://' + text;
    try {
      const url = new URL(text);
      if (!url.port && url.protocol === 'http:') url.port = '3030';
      return url.origin;
    } catch (_) { return ''; }
  }

  async function request(path, { method = 'GET', body = null, token = '' } = {}) {
    if (!config.url) throw new Error('No QLab Connect address yet');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(config.url + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { 'x-dept-session': token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { data = { error: text.slice(0, 200) }; }
      return { status: response.status, data, headers: response.headers };
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? `QLab Connect didn't answer at ${config.url}` : `Can't reach QLab Connect at ${config.url}`);
    } finally {
      clearTimeout(timer);
    }
  }

  function tokenFrom(result) {
    if (result.data?.token) return result.data.token;
    const cookies = typeof result.headers.getSetCookie === 'function' ? result.headers.getSetCookie() : [result.headers.get('set-cookie') || ''];
    for (const cookie of cookies) {
      const match = String(cookie).match(/^[^=]+=([^;]+)/);
      if (match && match[1]) return match[1];
    }
    return '';
  }

  async function departments(url) {
    if (url != null) config.url = normaliseUrl(url);
    const result = await request('/api/departments');
    if (result.status !== 200) throw new Error(result.data?.error || `QLab Connect answered ${result.status}`);
    return { url: config.url, departments: (result.data?.departments || []).map(d => ({ id: d.id, name: d.name })) };
  }

  async function login({ url, departmentId, password } = {}) {
    if (url != null) config.url = normaliseUrl(url);
    if (departmentId != null) config.departmentId = String(departmentId);
    const pass = password != null ? String(password) : unseal(config.password);
    const result = await request('/api/login', { method: 'POST', body: { departmentId: config.departmentId, password: pass } });
    if (result.status !== 200) throw new Error(result.data?.error || `QLab Connect answered ${result.status}`);
    config.token = tokenFrom(result);
    if (!config.token) throw new Error('QLab Connect logged in but sent no login token');
    config.departmentName = result.data?.department?.name || config.departmentName;
    if (password != null) config.password = seal(pass);
    save();
    return info();
  }

  // The lighting cues in the script (or { unchanged } when the version is the same).
  async function fetchScript(since) {
    if (!config.url || !config.departmentId) return { notSetUp: true };
    const path = '/api/script/lighting' + (since != null ? `?since=${encodeURIComponent(since)}` : '');
    let result = await request(path, { token: config.token });
    if (result.status === 401 && config.password) {
      await login();
      result = await request(path, { token: config.token });
    }
    if (result.status === 404) throw new Error('This QLab Connect is too old for the script link — update it');
    if (result.status !== 200) throw new Error(result.data?.error || `QLab Connect answered ${result.status}`);
    return result.data;
  }

  function forget() {
    config = { url: config.url, departmentId: '', departmentName: '', password: '', token: '' };
    save();
    return info();
  }

  function info() {
    return { url: config.url, departmentId: config.departmentId, departmentName: config.departmentName, linked: Boolean(config.url && config.departmentId && config.token) };
  }

  return { info, departments, login, fetchScript, forget };
}

module.exports = { createScriptLink };
