"use strict";

(() => {
  if (window.License) return;

  const STORAGE_KEY = "lighting-console-license";
  const API_KEY = "lighting-console-license-api";
  const TIERS = Object.freeze({ FREE: "free", LIVE: "live", PRO: "pro" });
  const TIER_ORDER = Object.freeze({ free: 0, live: 1, pro: 2 });
  const DEFAULT_STATE = Object.freeze({ tier: TIERS.FREE, key: "", token: "", expiresAt: null, machineId: "" });

  const read = key => { try { return localStorage.getItem(key) || ""; } catch (_) { return ""; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };

  function loadState() {
    try {
      const raw = JSON.parse(read(STORAGE_KEY) || "{}");
      const tier = Object.values(TIERS).includes(raw.tier) ? raw.tier : TIERS.FREE;
      return { ...DEFAULT_STATE, ...raw, tier };
    } catch (_) { return { ...DEFAULT_STATE }; }
  }

  let state = loadState();
  let apiBase = read(API_KEY);

  function save() { write(STORAGE_KEY, JSON.stringify(state)); }
  function has(tier) { return TIER_ORDER[state.tier] >= TIER_ORDER[tier] && state.tier !== TIERS.FREE || tier === TIERS.FREE; }
  function isLiveEnabled() { return has(TIERS.LIVE); }
  function isProEnabled() { return has(TIERS.PRO); }

  function machineId() {
    if (state.machineId) return state.machineId;
    let id = "";
    try { id = crypto.randomUUID(); } catch (_) { id = `machine-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    state.machineId = id;
    save();
    return id;
  }

  function status() {
    return { ...state, apiBase, liveEnabled: isLiveEnabled(), proEnabled: isProEnabled(), machineId: machineId() };
  }

  async function activate(licenseKey) {
    const key = String(licenseKey || "").trim();
    if (!key) throw new Error("Enter a license key");
    if (!apiBase) throw new Error("License server is not configured yet");

    const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey: key, machineId: machineId(), product: "lighting-console" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.token || !Object.values(TIERS).includes(data?.tier)) throw new Error(data?.message || "License activation failed");

    state = { ...state, key, token: data.token, tier: data.tier, expiresAt: data.expiresAt || null, machineId: data.machineId || machineId() };
    save();
    window.dispatchEvent(new CustomEvent("license-changed", { detail: status() }));
    return status();
  }

  function deactivate() {
    state = { ...DEFAULT_STATE, machineId: state.machineId || machineId() };
    save();
    window.dispatchEvent(new CustomEvent("license-changed", { detail: status() }));
  }

  function setApiBase(url) {
    apiBase = String(url || "").trim().replace(/\/$/, "");
    write(API_KEY, apiBase);
  }

  function renderPanel() {
    const host = document.getElementById("licenseHost");
    if (!host) return;
    const s = status();
    const tierName = s.tier === TIERS.PRO ? "PRO" : s.tier === TIERS.LIVE ? "LIVE" : "FREE";
    host.innerHTML = `
      <div class="license-card" style="border:1px solid var(--border,#333);border-radius:10px;padding:14px;background:rgba(255,255,255,.025);">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
          <div><strong>License</strong><div style="opacity:.7;font-size:12px;margin-top:4px;">Current tier: ${tierName}</div></div>
          <span class="status-pill">${tierName}</span>
        </div>
        <div style="margin-top:12px;opacity:.8;font-size:13px;line-height:1.5;">
          <div><strong>FREE</strong> — visualizer and programming tools, no physical DMX/network output.</div>
          <div><strong>LIVE</strong> — everything in Free plus live multi-output DMX.</div>
          <div><strong>PRO</strong> — everything in Live plus future Pro features.</div>
        </div>
        <div class="form-row" style="margin-top:12px;"><label>License Key</label><input id="licenseKeyInput" type="text" value="${String(s.key || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}" placeholder="Enter license key" autocomplete="off" spellcheck="false"></div>
        <div class="action-row"><button class="btn-primary" id="licenseActivate">Activate License</button><button class="btn-secondary" id="licenseDeactivate">Use Free</button></div>
        <small id="licenseMessage" style="display:block;margin-top:8px;opacity:.7;"></small>
      </div>`;
    document.getElementById("licenseActivate")?.addEventListener("click", async () => {
      const message = document.getElementById("licenseMessage");
      try { if (message) message.textContent = "Activating…"; await activate(document.getElementById("licenseKeyInput")?.value); if (message) message.textContent = "License activated."; renderPanel(); }
      catch (err) { if (message) message.textContent = err?.message || "Activation failed"; }
    });
    document.getElementById("licenseDeactivate")?.addEventListener("click", () => { deactivate(); renderPanel(); });
  }

  window.License = Object.freeze({ TIERS, status, has, isLiveEnabled, isProEnabled, activate, deactivate, setApiBase, machineId, renderPanel });
  window.getConsoleLicenseTier = () => status().tier;

  const ensureHost = () => {
    if (document.getElementById("licenseHost")) { renderPanel(); return true; }
    const settings = document.getElementById("page-settings");
    if (!settings) return false;
    const section = document.createElement("section");
    section.className = "panel";
    section.innerHTML = `<div class="panel-header"><div><span class="eyebrow">LICENSE</span> Software License</div><span class="panel-meta">ACCOUNT</span></div><div class="panel-body" id="licenseHost"></div>`;
    settings.prepend(section);
    renderPanel();
    return true;
  };

  const install = () => {
    let attempts = 0;
    const wait = () => { if (ensureHost()) return; attempts += 1; if (attempts < 100) setTimeout(wait, 100); };
    wait();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();
