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

  function installTierThemeStyles() {
    if (document.getElementById("license-tier-theme-styles")) return;
    const style = document.createElement("style");
    style.id = "license-tier-theme-styles";
    style.textContent = `
      html[data-license-tier="free"]{--tier-accent:#5ca8ff;--tier-accent-soft:rgba(92,168,255,.14);--tier-accent-glow:rgba(92,168,255,.25)}
      html[data-license-tier="live"]{--tier-accent:#19d6a3;--tier-accent-soft:rgba(25,214,163,.14);--tier-accent-glow:rgba(25,214,163,.25)}
      html[data-license-tier="pro"]{--tier-accent:#c28cff;--tier-accent-soft:rgba(194,140,255,.14);--tier-accent-glow:rgba(194,140,255,.28)}
      .license-tier-badge{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--tier-accent);border-radius:7px;background:var(--tier-accent-soft);color:var(--tier-accent);font:900 8px/1 var(--mono,monospace);letter-spacing:1.2px;white-space:nowrap;box-shadow:0 0 12px var(--tier-accent-glow)}
      .license-tier-badge .tier-dot{width:6px;height:6px;border-radius:50%;background:var(--tier-accent);box-shadow:0 0 7px var(--tier-accent)}
      html[data-license-tier="free"] .topbar{border-bottom-color:rgba(92,168,255,.3)}
      html[data-license-tier="live"] .topbar{border-bottom-color:rgba(25,214,163,.3)}
      html[data-license-tier="pro"] .topbar{border-bottom-color:rgba(194,140,255,.35)}
      html[data-license-tier="free"] .page-kicker{color:#5ca8ff}
      html[data-license-tier="live"] .page-kicker{color:#19d6a3}
      html[data-license-tier="pro"] .page-kicker{color:#c28cff}
      .license-tier-description{display:none!important;font:700 7px/1 var(--mono,monospace);letter-spacing:.8px;opacity:.65}
      @media(max-width:700px){.license-tier-description{display:none}.license-tier-badge{padding:0 7px}}
    `;
    document.head.appendChild(style);
  }

  function tierInfo() {
    if (state.tier === TIERS.PRO) return { name: "PRO", description: "LIVE + QLAB" };
    if (state.tier === TIERS.LIVE) return { name: "LIVE", description: "LIVE DMX" };
    return { name: "FREE", description: "VISUALIZER ONLY" };
  }

  function updateTierTheme() {
    if (!document.documentElement) return;
    installTierThemeStyles();
    const info = tierInfo();
    document.documentElement.dataset.licenseTier = state.tier;
    document.documentElement.dataset.licenseName = info.name;
    let badge = document.getElementById("licenseTierBadge");
    const status = document.querySelector(".topbar-status");
    if (!badge && status) {
      badge = document.createElement("div");
      badge.id = "licenseTierBadge";
      badge.className = "license-tier-badge";
      badge.setAttribute("aria-live", "polite");
      status.prepend(badge);
    }
    if (badge) badge.innerHTML = `<span class="tier-dot"></span><span>${info.name}</span><span class="license-tier-description">${info.description}</span>`;
    document.querySelectorAll("[data-license-tier-label]").forEach(node => { node.textContent = info.name; });
  }

  function persist() { write(STORAGE_KEY, JSON.stringify(state)); syncOutputMode(); updateQlabLock(); updateTierTheme(); }
  function syncOutputMode() {
    window.__licenseTier = state.tier;
    const consoleMode = String(window.getConsoleMode?.() || "LIVE").toUpperCase();
    const outputMode = state.tier === TIERS.FREE ? "BLIND" : (consoleMode === "BLIND" ? "BLIND" : "LIVE");
    window.__setMultiOutputMode?.(outputMode);
    window.dispatchEvent(new CustomEvent("license-tier-changed", { detail: { tier: state.tier } }));
  }
  function tier() { return state.tier; }
  function isLive() { return state.tier === TIERS.LIVE || state.tier === TIERS.PRO; }
  function isPro() { return state.tier === TIERS.PRO; }

  function installQlabLockStyles() {
    if (document.getElementById("qlab-pro-lock-styles")) return;
    const style = document.createElement("style"); style.id = "qlab-pro-lock-styles";
    style.textContent = `#page-qlab.qlab-pro-locked{position:relative;overflow:hidden}#page-qlab.qlab-pro-locked>.qlab-pro-lock{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(5,9,12,.88);backdrop-filter:blur(5px);border:1px solid rgba(92,168,255,.25);border-radius:12px}.qlab-pro-lock-card{width:min(430px,calc(100% - 40px));padding:30px;text-align:center;border:1px solid rgba(92,168,255,.35);border-radius:14px;background:rgba(12,18,23,.98);box-shadow:0 18px 60px rgba(0,0,0,.4)}.qlab-pro-lock-card .lock-icon{font-size:30px;margin-bottom:12px}.qlab-pro-lock-card .lock-eyebrow{font:800 9px/1 var(--mono,monospace);letter-spacing:2px;color:#5ca8ff;margin-bottom:10px}.qlab-pro-lock-card h2{margin:0 0 10px;font:800 22px/1.2 var(--mono,monospace);color:#e8f0f2}.qlab-pro-lock-card p{margin:0 0 20px;color:#8d9a9e;font:500 12px/1.6 var(--mono,monospace)}.qlab-pro-lock-card button{height:36px;padding:0 16px;border:1px solid #5ca8ff;border-radius:7px;background:#5ca8ff;color:#07111d;cursor:pointer;font:800 9px/1 var(--mono,monospace);letter-spacing:1px}.nav-link.qlab-pro-locked-nav{opacity:.55}`;
    document.head.appendChild(style);
  }

  function updateQlabLock() {
    if (!document.body) return; installQlabLockStyles();
    const page = document.getElementById("page-qlab"), nav = document.querySelector('.nav-link[data-page="qlab"]');
    if (!page || !nav) return;
    const locked = !isPro(); nav.classList.toggle("qlab-pro-locked-nav", locked); nav.setAttribute("aria-disabled", locked ? "true" : "false"); nav.title = locked ? "QLab is a Pro feature" : "QLab";
    let lock = page.querySelector(".qlab-pro-lock");
    if (locked) {
      page.classList.add("qlab-pro-locked");
      if (!lock) { lock = document.createElement("div"); lock.className = "qlab-pro-lock"; lock.innerHTML = `<div class="qlab-pro-lock-card"><div class="lock-icon">🔒</div><div class="lock-eyebrow">PRO FEATURE</div><h2>QLab is Locked</h2><p>QLab control is available with a Pro license. Activate a Pro license to unlock QLab integration.</p><button type="button" id="qlabProLicenseButton">CHANGE LICENSE</button></div>`; page.appendChild(lock); lock.querySelector("#qlabProLicenseButton").onclick = () => window.License?.showStartupScreen(); }
      if (page.classList.contains("active")) document.querySelector('.nav-link[data-page="live"]')?.click();
    } else { page.classList.remove("qlab-pro-locked"); lock?.remove(); }
  }

  function wireQlabNavigationGuard() {
    const nav = document.querySelector('.nav-link[data-page="qlab"]'); if (!nav || nav.dataset.proGuard === "1") return;
    nav.dataset.proGuard = "1"; nav.addEventListener("click", event => { if (!isPro()) { event.preventDefault(); event.stopImmediatePropagation(); updateQlabLock(); return false; } }, true); updateQlabLock();
  }

  async function request(path, body) { const response = await fetch(`${apiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); let data = {}; try { data = await response.json(); } catch (_) {} if (!response.ok) throw new Error(data.error || `License request failed (${response.status})`); return data; }
  async function activate(key) { const cleanKey = String(key || "").trim(); if (!cleanKey) throw new Error("Enter a license key."); const data = await request("/activate", { key: cleanKey, machineId: machineId() }); if (!data.token) throw new Error("License activation returned no token."); state = { ...state, key: cleanKey, token: data.token, tier: normalizeTier(data.tier), expiresAt: data.expiresAt ?? null }; persist(); return { ...state }; }
  async function validate() { if (!state.token || !state.machineId) return false; try { const data = await request("/validate", { token: state.token, machineId: state.machineId }); if (!data.valid) throw new Error("License is no longer valid."); state.tier = normalizeTier(data.tier); state.expiresAt = data.expiresAt ?? null; persist(); return true; } catch (_) { state = { ...DEFAULT_STATE, machineId: machineId() }; persist(); return false; } }
  async function deactivate() { if (state.key && state.machineId) { try { await request("/deactivate", { key: state.key, machineId: state.machineId }); } catch (_) {} } state = { ...DEFAULT_STATE, machineId: machineId() }; persist(); }

  function installChangeLicenseButton() {
    if (document.getElementById("changeLicenseButton")) return; const status = document.querySelector(".topbar-status"); if (!status) return;
    const button = document.createElement("button"); button.id = "changeLicenseButton"; button.type = "button"; button.textContent = "LICENSE"; button.title = "Change license or switch to Free mode"; button.style.cssText = "height:30px;padding:0 10px;border:1px solid var(--border,#202a30);border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:800 8px/1 var(--mono,monospace);letter-spacing:1px;opacity:.8;";
    button.onclick = async () => { if (!confirm("Change your Light Spark license? Your current activation will be released from this computer.")) return; button.disabled = true; button.textContent = "..."; await deactivate(); showStartupScreen(); button.remove(); }; status.prepend(button);
  }

  function showStartupScreen() {
    if (document.getElementById("licenseStartupScreen")) return; const overlay = document.createElement("div"); overlay.id = "licenseStartupScreen";
    overlay.innerHTML = `<div class="license-startup-card"><div class="license-startup-eyebrow">LIGHT SPARK</div><h1>Activate Light Spark</h1><p class="license-startup-subtitle">Enter a license key for live DMX output, or continue free in visualiser-only mode.</p><div class="license-startup-field"><label for="licenseStartupKey">License key</label><input id="licenseStartupKey" type="text" autocomplete="off" spellcheck="false" placeholder="LC-..." /></div><button id="licenseStartupActivate" class="license-startup-primary">Activate License</button><button id="licenseStartupFree" class="license-startup-secondary">Continue with Free</button><div id="licenseStartupStatus" class="license-startup-status" aria-live="polite"></div></div>`;
    document.body.appendChild(overlay); const keyInput = document.getElementById("licenseStartupKey"), activateButton = document.getElementById("licenseStartupActivate"), freeButton = document.getElementById("licenseStartupFree"), status = document.getElementById("licenseStartupStatus");
    const close = () => { overlay.remove(); document.body.classList.remove("license-startup-active"); installChangeLicenseButton(); updateQlabLock(); updateTierTheme(); }; const setBusy = busy => { activateButton.disabled = busy; freeButton.disabled = busy; keyInput.disabled = busy; };
    activateButton.onclick = async () => { setBusy(true); status.textContent = "Activating…"; try { const result = await activate(keyInput.value); status.textContent = `Activated ${result.tier.toUpperCase()} license.`; setTimeout(close, 350); } catch (error) { status.textContent = error.message || "Unable to activate license."; setBusy(false); } };
    freeButton.onclick = () => { state = { ...DEFAULT_STATE, machineId: machineId() }; persist(); close(); }; keyInput.addEventListener("keydown", event => { if (event.key === "Enter") activateButton.click(); }); document.body.classList.add("license-startup-active"); setTimeout(() => keyInput.focus(), 50);
  }

  async function boot() { installTierThemeStyles(); updateTierTheme(); syncOutputMode(); wireQlabNavigationGuard(); updateQlabLock(); window.addEventListener("license-tier-changed", () => { updateQlabLock(); updateTierTheme(); }); if (state.token) { const valid = await validate(); if (valid) { installChangeLicenseButton(); updateQlabLock(); updateTierTheme(); return; } } showStartupScreen(); }
  window.License = Object.freeze({ getTier: tier, isLive, isPro, activate, validate, deactivate, getState: () => ({ ...state }), showStartupScreen }); window.getLicenseTier = tier; window.__licenseTier = state.tier;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
