"use strict";

// The licence, as the window sees it. The tier is decided in the main process
// (main/license.js); this shows it (badge, colours, the activation screen, the
// QLab lock) and passes activate/deactivate requests on.
//
//   License.getTier()  "free" | "live" | "pro"
//   License.isLive()   live DMX output allowed (LIVE or PRO)
//   License.isPro()    QLab allowed
(() => {
  const LEGACY_KEY = "lighting-console-license";
  const TIER_INFO = { free: "FREE", live: "LIVE", pro: "PRO" };
  let state = { tier: "free", canOutput: false, canQLab: false, activated: false };

  const tier = () => state.tier;
  const isLive = () => state.tier === "live" || state.tier === "pro";
  const isPro = () => state.tier === "pro";

  function showTier() {
    document.documentElement.dataset.licenseTier = state.tier;
    let badge = document.getElementById("licenseTierBadge");
    const status = document.querySelector(".topbar-status");
    if (!badge && status) {
      badge = document.createElement("div");
      badge.id = "licenseTierBadge";
      badge.className = "license-tier-badge";
      badge.setAttribute("aria-live", "polite");
      status.prepend(badge);
    }
    if (badge) {
      badge.innerHTML = `<span class="tier-dot"></span><span>${TIER_INFO[state.tier]}</span>`;
      badge.title = state.message || (state.tier === "free" ? "Visualiser only" : state.tier === "live" ? "Live DMX output" : "Live DMX output and QLab");
    }
    showQLabLock();
  }

  // QLab is a Pro feature: its page is covered by a lock card on other tiers.
  function showQLabLock() {
    const page = document.getElementById("page-qlab");
    const nav = document.querySelector('.nav-link[data-page="qlab"]');
    if (!page || !nav) return;
    const locked = !isPro();
    nav.classList.toggle("qlab-pro-locked-nav", locked);
    nav.title = locked ? "QLab is a Pro feature" : "QLab";
    page.classList.toggle("qlab-pro-locked", locked);
    let lock = page.querySelector(".qlab-pro-lock");
    if (locked && !lock) {
      lock = document.createElement("div");
      lock.className = "qlab-pro-lock";
      lock.innerHTML = `<div class="qlab-pro-lock-card"><div class="lock-icon">🔒</div><div class="lock-eyebrow">PRO FEATURE</div><h2>QLab is Locked</h2><p>QLab control is available with a Pro license. Activate a Pro license to unlock QLab integration.</p><button type="button">CHANGE LICENSE</button></div>`;
      lock.querySelector("button").addEventListener("click", changeLicence);
      page.appendChild(lock);
    } else if (!locked) {
      lock?.remove();
    }
  }

  function applyState(next) {
    const before = state.tier;
    state = { ...state, ...next };
    showTier();
    if (state.tier !== before) window.dispatchEvent(new CustomEvent("license-tier-changed", { detail: { tier: state.tier } }));
  }

  async function activate(key) {
    applyState(await window.LXLicense.activate(key));
    return { ...state };
  }

  async function deactivate() {
    applyState(await window.LXLicense.deactivate());
  }

  async function changeLicence() {
    if (state.activated && !confirm("Change your Light Spark license? Your current activation will be released from this computer.")) return;
    if (state.activated) await deactivate();
    showStartupScreen();
  }

  function installChangeLicenceButton() {
    const status = document.querySelector(".topbar-status");
    if (!status || document.getElementById("changeLicenseButton")) return;
    const button = document.createElement("button");
    button.id = "changeLicenseButton";
    button.type = "button";
    button.className = "change-license-button";
    button.textContent = "LICENSE";
    button.title = "Change license or switch to Free mode";
    button.addEventListener("click", changeLicence);
    status.prepend(button);
  }

  function showStartupScreen() {
    if (document.getElementById("licenseStartupScreen")) return;
    const overlay = document.createElement("div");
    overlay.id = "licenseStartupScreen";
    overlay.innerHTML = `<div class="license-startup-card"><div class="license-startup-eyebrow">LIGHT SPARK</div><h1>Activate Light Spark</h1><p class="license-startup-subtitle">Enter a license key for live DMX output, or continue free in visualiser-only mode.</p><div class="license-startup-field"><label for="licenseStartupKey">License key</label><input id="licenseStartupKey" type="text" autocomplete="off" spellcheck="false" placeholder="LC-..." /></div><button id="licenseStartupActivate" class="license-startup-primary">Activate License</button><button id="licenseStartupFree" class="license-startup-secondary">Continue with Free</button><div id="licenseStartupStatus" class="license-startup-status" aria-live="polite"></div></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("license-startup-active");
    const keyInput = overlay.querySelector("#licenseStartupKey");
    const activateButton = overlay.querySelector("#licenseStartupActivate");
    const freeButton = overlay.querySelector("#licenseStartupFree");
    const status = overlay.querySelector("#licenseStartupStatus");
    const close = () => {
      overlay.remove();
      document.body.classList.remove("license-startup-active");
      installChangeLicenceButton();
    };
    const busy = value => [activateButton, freeButton, keyInput].forEach(element => { element.disabled = value; });
    activateButton.addEventListener("click", async () => {
      busy(true);
      status.textContent = "Activating…";
      try {
        const result = await activate(keyInput.value);
        status.textContent = `Activated ${result.tier.toUpperCase()} license.`;
        setTimeout(close, 350);
      } catch (error) {
        status.textContent = String(error?.message || "Unable to activate license.").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        busy(false);
      }
    });
    freeButton.addEventListener("click", close);
    keyInput.addEventListener("keydown", event => { if (event.key === "Enter") activateButton.click(); });
    setTimeout(() => keyInput.focus(), 50);
  }

  async function boot() {
    showTier();
    window.LXLicense?.onChange(applyState);
    // Licences from older versions were kept in this window's storage: hand them to the main process once.
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (legacy?.token) await window.LXLicense.importLegacy(legacy);
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
    applyState(await window.LXLicense.state());
    if (state.activated) installChangeLicenceButton();
    else showStartupScreen();
  }

  window.License = Object.freeze({ getTier: tier, isLive, isPro, activate, deactivate, getState: () => ({ ...state }), showStartupScreen });
  window.getLicenseTier = tier;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
