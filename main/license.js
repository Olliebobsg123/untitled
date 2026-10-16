'use strict';

// The licence, decided here in the main process rather than in the window, so it
// can't be changed from the window's developer tools or storage. Activation and
// validation go to the licence server, which signs a token for this machine.
//
// Offline use: once validated, a licence keeps working without internet for
// OFFLINE_GRACE_DAYS, then drops to Free until the server can be reached again.
// If config/license-public.pem is present (the server's LICENSE_PUBLIC_KEY), the
// token's signature is also checked locally, so a hand-edited license.json is
// refused even offline.

const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.LIGHT_SPARK_LICENSE_API || 'https://api-bice-ten.vercel.app/api/licenses';
const OFFLINE_GRACE_DAYS = 14;
const REVALIDATE_MS = 6 * 60 * 60 * 1000;
const TIERS = ['free', 'live', 'pro'];

let state = { key: '', token: '', machineId: '', tier: 'free', validatedAt: 0, expiresAt: null, message: '' };
let changeListener = () => {};
let revalidateTimer = null;

const statePath = () => path.join(app.getPath('userData'), 'license.json');
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const normaliseTier = value => (TIERS.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'free');

// Testing builds only (never a packaged app): LIGHT_SPARK_TEST_TIER=live|pro.
const testTier = () => (!app.isPackaged && TIERS.includes(process.env.LIGHT_SPARK_TEST_TIER) ? process.env.LIGHT_SPARK_TEST_TIER : null);

function publicKey() {
  for (const file of [path.join(__dirname, '..', 'config', 'license-public.pem')]) {
    try { return crypto.createPublicKey(fs.readFileSync(file, 'utf8')); } catch (_) {}
  }
  return null;
}

// Checks the server's signature on the token and that it was issued for this machine.
function tokenPayload(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
  const key = publicKey();
  if (key) {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(body);
    verifier.end();
    if (!verifier.verify(key, Buffer.from(signature, 'base64url'))) return null;
  }
  if (payload.machineHash && payload.machineHash !== sha256(state.machineId)) return null;
  if (payload.exp && Number(payload.exp) <= Date.now()) return null;
  return payload;
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    state = { ...state, ...saved, tier: normaliseTier(saved.tier) };
  } catch (_) {}
  if (!state.machineId) state.machineId = crypto.randomUUID();
}

function save() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not save the licence:', err.message);
  }
}

// The tier in force right now.
function tier() {
  const override = testTier();
  if (override) return override;
  if (state.tier === 'free' || !state.token) return 'free';
  if (!tokenPayload(state.token)) return 'free';
  if (state.expiresAt && Date.parse(state.expiresAt) <= Date.now()) return 'free';
  const offlineFor = Date.now() - Number(state.validatedAt || 0);
  if (offlineFor > OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000) return 'free';
  return state.tier;
}

function publicState() {
  const current = tier();
  return {
    tier: current,
    canOutput: current === 'live' || current === 'pro',
    canQLab: current === 'pro',
    activated: Boolean(state.token),
    key: state.key ? `${state.key.slice(0, 8)}…` : '',
    validatedAt: state.validatedAt || null,
    expiresAt: state.expiresAt || null,
    message: state.message || '',
    testing: Boolean(testTier())
  };
}

function changed() {
  save();
  try { changeListener(publicState()); } catch (_) {}
}

async function post(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  return { ok: response.ok, status: response.status, data };
}

async function activate(key) {
  const cleanKey = String(key || '').trim().toUpperCase();
  if (!cleanKey) throw new Error('Enter a licence key.');
  const { ok, data } = await post('/activate', { key: cleanKey, machineId: state.machineId });
  if (!ok || !data.token) throw new Error(data.error || 'Activation failed.');
  const previous = { ...state };
  state = { ...state, key: cleanKey, token: data.token, tier: normaliseTier(data.tier), validatedAt: Date.now(), expiresAt: data.expiresAt || null, message: '' };
  if (!tokenPayload(state.token)) {
    state = previous;
    throw new Error('The licence server sent a token this app could not verify.');
  }
  changed();
  return publicState();
}

// Asks the server whether the licence is still good. A network failure keeps the
// licence (within the offline grace period); a definite "no" from the server drops it.
async function validate() {
  if (!state.token) return publicState();
  try {
    const { ok, status, data } = await post('/validate', { token: state.token, machineId: state.machineId });
    if (ok && data.valid) {
      state = { ...state, tier: normaliseTier(data.tier), validatedAt: Date.now(), expiresAt: data.expiresAt || null, message: '' };
    } else if (status >= 400 && status < 500) {
      state = { ...state, tier: 'free', token: '', message: data.error || 'This licence is no longer valid.' };
    }
  } catch (_) {
    state.message = 'Could not reach the licence server; working offline.';
  }
  changed();
  return publicState();
}

async function deactivate() {
  if (state.key) {
    try { await post('/deactivate', { key: state.key, machineId: state.machineId }); } catch (_) {}
  }
  state = { ...state, key: '', token: '', tier: 'free', validatedAt: 0, expiresAt: null, message: '' };
  changed();
  return publicState();
}

// Licences activated by older versions lived in the window's storage. They're
// moved here once, and only kept if the server confirms them.
async function importLegacy(legacy) {
  if (state.token || !legacy?.token) return publicState();
  state = { ...state, key: String(legacy.key || ''), token: String(legacy.token), machineId: String(legacy.machineId || state.machineId), tier: normaliseTier(legacy.tier), validatedAt: 0 };
  return validate();
}

function onChange(listener) {
  changeListener = typeof listener === 'function' ? listener : () => {};
}

function start() {
  load();
  validate();
  revalidateTimer = setInterval(validate, REVALIDATE_MS);
}

function stop() {
  clearInterval(revalidateTimer);
}

module.exports = { start, stop, tier, publicState, activate, validate, deactivate, importLegacy, onChange };
