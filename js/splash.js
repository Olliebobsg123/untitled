"use strict";

// Splash screen — shown immediately (it's plain markup at the top of
// index.html, so it paints before any of the heavier scripts below run)
// while the app's real, synchronous initialisation happens, then offers
// a Recent Shows chooser once that settles. This file is loaded FIRST,
// before fixtures.js/dmx.js/etc., specifically so it can start reacting
// to real init milestones (DOMContentLoaded, the license tier resolving)
// as early as possible rather than after everything else has already run.
(function initialiseSplashScreen() {
  const screen = document.getElementById("splashScreen");
  const statusEl = document.getElementById("splashStatus");
  const progressBar = document.getElementById("splashProgressBar");
  const loadingSection = document.getElementById("splashLoading");
  const licenseSection = document.getElementById("splashLicense");
  const licenseKeyInput = document.getElementById("splashLicenseKey");
  const licenseActivateButton = document.getElementById("splashLicenseActivate");
  const licenseFreeButton = document.getElementById("splashLicenseFree");
  const licenseStatusEl = document.getElementById("splashLicenseStatus");
  const chooserSection = document.getElementById("splashChooser");
  const showsHost = document.getElementById("splashShows");
  const newShowButton = document.getElementById("splashNewShow");
  if (!screen || !statusEl || !progressBar || !loadingSection || !licenseSection || !licenseKeyInput ||
      !licenseActivateButton || !licenseFreeButton || !licenseStatusEl || !chooserSection || !showsHost || !newShowButton) return;

  // Cosmetic phase labels — most of this app's startup is synchronous
  // script execution (fixture library parsing, control wiring, etc.),
  // which by definition can't be observed mid-flight from a script
  // that runs after it, so these are paced for perceived progress
  // rather than tied to literal per-step completion events. The
  // exception is the license check below, which genuinely is async
  // and is gated on for real.
  const STEPS = [
    "Starting Light Spark…",
    "Loading fixture library…",
    "Preparing controls…",
    "Loading cue engine…",
    "Checking license…"
  ];

  let stepIndex = 0;
  function showStep(i) {
    stepIndex = i;
    statusEl.textContent = STEPS[Math.min(i, STEPS.length - 1)];
    progressBar.style.width = `${Math.min(100, Math.round(((i + 1) / STEPS.length) * 100))}%`;
  }
  showStep(0);
  const stepTimer = setInterval(() => {
    if (stepIndex >= STEPS.length - 1) { clearInterval(stepTimer); return; }
    showStep(stepIndex + 1);
  }, 240);

  const startTime = Date.now();
  const MIN_DISPLAY_MS = 1200;
  const LICENSE_TIMEOUT_MS = 2200;

  let domReady = document.readyState !== "loading";
  if (!domReady) document.addEventListener("DOMContentLoaded", () => { domReady = true; tryAdvance(); }, { once: true });

  // Three ways this settles: (1) the common case — a cached license
  // token validates and js/license.js calls window.__licenseBootResolved
  // for real; (2) no token at all — js/license.js calls
  // window.__licenseNeedsActivation (defined below) instead of showing
  // its own separate startup overlay, and THIS file drives the inline
  // form until the user activates or continues free; (3) neither fires
  // within LICENSE_TIMEOUT_MS (shouldn't happen, but a network hang
  // during validate() shouldn't hang the splash forever either).
  // Deliberately NOT "license-tier-changed" — js/license.js's own
  // syncOutputMode() fires that unconditionally at the very start of
  // boot(), before it's actually decided whether activation is needed,
  // so treating it as "boot is done" raced this straight past the
  // license step before boot() had gotten there.
  // Smooth section swap: fades hideEl out, then (once actually hidden)
  // fades showEl in — instead of the instant hidden=true/false flips
  // this all used to be, which made the loading/license/chooser
  // sections pile up on top of each other the instant [hidden] wasn't
  // actually working (see the [hidden]{display:none!important} rule
  // in styles.css) and still looked abrupt once that was fixed.
  const FADE_MS = 280;
  function crossfade(hideEl, showEl) {
    const startShow = () => {
      if (!showEl) return;
      showEl.hidden = false;
      showEl.style.transition = "none";
      showEl.style.opacity = "0";
      void showEl.offsetWidth; // force a reflow so the fade-in actually animates from 0
      requestAnimationFrame(() => {
        showEl.style.transition = `opacity ${FADE_MS}ms ease`;
        showEl.style.opacity = "1";
      });
    };
    if (hideEl && !hideEl.hidden) {
      hideEl.style.transition = `opacity ${FADE_MS}ms ease`;
      hideEl.style.opacity = "0";
      setTimeout(() => {
        hideEl.hidden = true;
        hideEl.style.transition = "";
        hideEl.style.opacity = "";
        startShow();
      }, FADE_MS);
    } else {
      startShow();
    }
  }

  let licenseReady = false;
  let awaitingActivation = false;
  window.__licenseBootResolved = function () {
    if (awaitingActivation) return; // the inline form's own handlers resolve this case
    licenseReady = true;
    tryAdvance();
  };
  setTimeout(() => { if (!awaitingActivation) { licenseReady = true; tryAdvance(); } }, LICENSE_TIMEOUT_MS);

  window.__licenseNeedsActivation = function showLicenseStep() {
    awaitingActivation = true;
    clearInterval(stepTimer);
    crossfade(loadingSection, licenseSection);
    setTimeout(() => licenseKeyInput.focus(), FADE_MS + 50);
  };

  function resolveActivation() {
    awaitingActivation = false;
    licenseReady = true;
    // js/license.js's OWN standalone startup overlay always re-installed
    // the topbar "LICENSE" button when it closed (see its close()) —
    // this inline flow replaces that overlay at boot time but still
    // needs to do the same thing, otherwise there's no way to change
    // license/switch to free later in the session.
    window.License?.installChangeLicenseButton?.();
    // licenseSection's own fade-out happens as part of tryAdvance() ->
    // showChooser()'s crossfade below, once MIN_DISPLAY_MS/domReady
    // actually let it proceed — no need to fade it out separately here.
    tryAdvance();
  }

  function setLicenseFormBusy(busy) {
    licenseActivateButton.disabled = busy;
    licenseFreeButton.disabled = busy;
    licenseKeyInput.disabled = busy;
  }

  licenseActivateButton.addEventListener("click", async () => {
    setLicenseFormBusy(true);
    licenseStatusEl.textContent = "Activating…";
    try {
      const result = await window.License.activate(licenseKeyInput.value);
      licenseStatusEl.textContent = `Activated ${String(result.tier).toUpperCase()} license.`;
      setTimeout(resolveActivation, 350);
    } catch (err) {
      licenseStatusEl.textContent = err?.message || "Unable to activate license.";
      setLicenseFormBusy(false);
    }
  });
  licenseFreeButton.addEventListener("click", () => {
    window.License?.continueFree?.();
    resolveActivation();
  });
  licenseKeyInput.addEventListener("keydown", event => {
    if (event.key === "Enter") licenseActivateButton.click();
  });

  let advanced = false;
  function tryAdvance() {
    if (advanced) return;
    if (!domReady || !licenseReady || awaitingActivation) return;
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_DISPLAY_MS) { setTimeout(tryAdvance, MIN_DISPLAY_MS - elapsed); return; }
    advanced = true;
    clearInterval(stepTimer);
    showStep(STEPS.length - 1);
    showChooser();
  }
  setInterval(tryAdvance, 150);

  function formatWhen(mtimeMs) {
    const date = new Date(mtimeMs || 0);
    if (!mtimeMs || Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  async function showChooser() {
    const visible = !licenseSection.hidden ? licenseSection : loadingSection;
    crossfade(visible, chooserSection);

    let shows = [];
    try {
      shows = await window.LXShowFiles?.list?.() || [];
    } catch (_) { shows = []; }

    showsHost.replaceChildren();
    if (!shows.length) {
      const empty = document.createElement("div");
      empty.className = "splash-shows-empty";
      empty.textContent = "No previous shows found";
      showsHost.appendChild(empty);
    } else {
      for (const show of shows) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "splash-show-item";
        item.innerHTML = `<span class="splash-show-name"></span><span class="splash-show-meta"></span>`;
        item.querySelector(".splash-show-name").textContent = show.name;
        item.querySelector(".splash-show-meta").textContent = formatWhen(show.mtimeMs);
        item.addEventListener("click", () => dismissWithShow(show.path));
        showsHost.appendChild(item);
      }
    }
  }

  async function dismissWithShow(path) {
    try {
      if (typeof window.loadShow === "function") await window.loadShow(path);
    } catch (err) {
      console.error("[SPLASH] Failed to load show:", err);
    }
    dismiss();
  }

  newShowButton.addEventListener("click", () => dismiss());

  function dismiss() {
    screen.classList.add("splash-hidden");
    setTimeout(() => screen.remove(), 500);
  }
})();
