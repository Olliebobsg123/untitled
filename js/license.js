"use strict";

(() => {
  if (window.License) return;

  const STORAGE_KEY = "lighting-console-license";
  const DEFAULT_API_BASE = "https://api-bice-ten.vercel.app/api/licenses";
  const TIERS = Object.freeze({ FREE: "free", LIVE: "live", PRO: "pro" });
  const DEFAULT_STATE = Object.freeze({ tier: TIERS.FREE, key: "", token: "", expiresAt: null, machineId: "" });

  const read = key => { try { return localStorage.getItem(key) || ""; } catch (_) { return ""; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
  const normalizeTier = value => { const tier = String(value || "").trim().toLowerCase(); return Object.values(TIERS).includes(tier) ? tier : TIERS.FREE; };
  const apiBase = () => read("lighting-console-license-api") || DEFAULT_API_BASE;
  const load = () => { try { const saved = JSON.parse(read(STORAGE_KEY)); return { ...DEFAULT_STATE, ...(saved && typeof saved === "object" ? saved : {}), tier: normalizeTier(saved?.tier) }; } catch (_) { return { ...DEFAULT_STATE }; } };
  let state = load();

  function machineId() {
    if (state.machineId) return state.machineId;
    let id = read("lighting-console-machine-id");
    if (!id) { id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`); write("lighting-console-machine-id", id); }
    state.machineId = id;
    return id;
  }

  function persist() { write(STORAGE_KEY, JSON.stringify(state)); syncOutputMode(); }
  function syncOutputMode() { window.__licenseTier = state.tier; window.__setMultiOutputMode?.(state.tier === TIERS.FREE ? "BLIND" : "LIVE"); window.dispatchEvent(new CustomEvent("license-tier-changed", { detail: { tier: state.tier } })); }
  function tier() { return state.tier; }
  function isLive() { return state.tier === TIERS.LIVE || state.tier === TIERS.PRO; }

  async function request(path, body) {
    const response = await fetch(`${apiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || `License request failed (${response.status})`);
    return data;
  }

  async function activate(key) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) throw new Error("Enter a license key.");
    const data = await request("/activate", { key: cleanKey, machineId: machineId() });
    if (!data.token) throw new Error("License activation returned no token.");
    state = { ...state, key: cleanKey, token: data.token, tier: normalizeTier(data.tier), expiresAt: data.expiresAt ?? null };
    persist();
    return { ...state };
  }

  async function validate() {
    if (!state.token || !state.machineId) return false;
    try {
      const data = await request("/validate", { token: state.token, machineId: state.machineId });
      if (!data.valid) throw new Error("License is no longer valid.");
      state.tier = normalizeTier(data.tier); state.expiresAt = data.expiresAt ?? null; persist(); return true;
    } catch (_) {
      state = { ...DEFAULT_STATE, machineId: machineId() }; persist(); return false;
    }
  }

  async function deactivate() {
    if (state.key && state.machineId) { try { await request("/deactivate", { key: state.key, machineId: state.machineId }); } catch (_) {} }
    state = { ...DEFAULT_STATE, machineId: machineId() }; persist();
  }

  function installChangeLicenseButton() {
    if (document.getElementById("changeLicenseButton")) return;
    const status = document.querySelector(".topbar-status");
    if (!status) return;
    const button = document.createElement("button");
    button.id = "changeLicenseButton";
    button.type = "button";
    button.textContent = "LICENSE";
    button.title = "Change license or switch to Free mode";
    button.style.cssText = "height:30px;padding:0 10px;border:1px solid var(--border,#202a30);border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:800 8px/1 var(--mono,monospace);letter-spacing:1px;opacity:.8;";
    button.onclick = async () => {
      if (!confirm("Change your Light Spark license? Your current activation will be released from this computer.")) return;
      button.disabled = true;
      button.textContent = "...";
      await deactivate();
      showStartupScreen();
      button.remove();
    };
    status.prepend(button);
  }

  function showStartupScreen() {
    if (document.getElementById("licenseStartupScreen")) return;
    const overlay = document.createElement("div");
    overlay.id = "licenseStartupScreen";
    overlay.innerHTML = `<div class="license-startup-card"><div class="license-startup-eyebrow">LIGHT SPARK</div><h1>Activate Light Spark</h1><p class="license-startup-subtitle">Enter a license key for live DMX output, or continue free in visualiser-only mode.</p><div class="license-startup-field"><label for="licenseStartupKey">License key</label><input id="licenseStartupKey" type="text" autocomplete="off" spellcheck="false" placeholder="LC-..." /></div><button id="licenseStartupActivate" class="license-startup-primary">Activate License</button><button id="licenseStartupFree" class="license-startup-secondary">Continue with Free</button><div id="licenseStartupStatus" class="license-startup-status" aria-live="polite"></div></div>`;
    document.body.appendChild(overlay);
    const keyInput = document.getElementById("licenseStartupKey"), activateButton = document.getElementById("licenseStartupActivate"), freeButton = document.getElementById("licenseStartupFree"), status = document.getElementById("licenseStartupStatus");
    const close = () => { overlay.remove(); document.body.classList.remove("license-startup-active"); installChangeLicenseButton(); };
    const setBusy = busy => { activateButton.disabled = busy; freeButton.disabled = busy; keyInput.disabled = busy; };
    activateButton.onclick = async () => { setBusy(true); status.textContent = "Activating…"; try { const result = await activate(keyInput.value); status.textContent = `Activated ${result.tier.toUpperCase()} license.`; setTimeout(close, 350); } catch (error) { status.textContent = error.message || "Unable to activate license."; setBusy(false); } };
    freeButton.onclick = () => { state = { ...DEFAULT_STATE, machineId: machineId() }; persist(); close(); };
    keyInput.addEventListener("keydown", event => { if (event.key === "Enter") activateButton.click(); });
    document.body.classList.add("license-startup-active");
    setTimeout(() => keyInput.focus(), 50);
  }

  async function boot() {
    syncOutputMode();
    if (state.token) {
      const valid = await validate();
      if (valid) { installChangeLicenseButton(); return; }
    }
    showStartupScreen();
  }

  window.License = Object.freeze({ getTier: tier, isLive, activate, validate, deactivate, getState: () => ({ ...state }), showStartupScreen });
  window.getLicenseTier = tier;
  window.__licenseTier = state.tier;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
