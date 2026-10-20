// Software updates: Preferences → Show → Updates, a top-bar notice, the
// "update" command and Help → Check for Updates. The work is done in the
// main process (updater.js); this shows what it's doing.
//
// The Windows installer downloads an update quietly and installs it when
// Light Spark quits — it never restarts by itself, so the lights stay up.
// The portable and Mac builds offer the download instead.
(function () {
  if (window.LXUpdates) return;
  const api = window.LXApp?.update;
  const pref = (k, d) => window.LXPrefs?.get(k) ?? d;
  const say = (m, l = "info") => window.log?.(m, l);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let state = { status: api ? "idle" : "source", version: window.LXApp?.version || "" };
  let asked = false; // this check was asked for by hand: report "up to date" too

  function text(s = state) {
    switch (s.status) {
      case "source": return "Running from the source code — update with git pull.";
      case "checking": return "Checking for updates…";
      case "none": return `Light Spark ${esc(s.version)} is the newest version.`;
      case "downloading": return `Downloading Light Spark ${esc(s.latest || "")}… ${s.percent || 0}%`;
      case "ready": return `Light Spark ${esc(s.latest || "")} is ready. It installs when you quit Light Spark, or restart now.`;
      case "available": return `Light Spark ${esc(s.latest || "")} is out (you have ${esc(s.version)}).${s.download ? " Download it and run it to update." : ""}`;
      case "error": return `Couldn't check for updates: ${esc(s.error || "unknown error")}`;
      default: return `Version ${esc(s.version)}.`;
    }
  }

  function renderPill() {
    let el = document.getElementById("lxUpdatePill");
    const show = state.status === "ready" || state.status === "available";
    if (!show) { el?.remove(); return; }
    if (!el) {
      const bar = document.querySelector(".topbar-status");
      if (!bar) return;
      el = document.createElement("button");
      el.type = "button";
      el.id = "lxUpdatePill";
      el.className = "status-pill lx-update-pill";
      el.addEventListener("click", () => window.LXPrefs?.open("show"));
      bar.prepend(el);
    }
    el.textContent = state.status === "ready" ? `UPDATE READY · ${state.latest || ""}` : `UPDATE · ${state.latest || ""}`;
    el.title = state.status === "ready" ? "Installs when you quit Light Spark — click for options" : "A new version is out — click to download";
  }

  function renderPanel() {
    const P = window.LXPrefs;
    if (!P?.addPanel || !P.kit) return;
    const { row, check } = P.kit;
    const buttons = [
      state.status === "ready" ? `<button type="button" class="btn-primary" data-update="install">Restart and update now</button>` : "",
      state.status === "available" && state.download ? `<button type="button" class="btn-primary" data-update="install">Download ${esc(state.latest || "")}</button>` : "",
      state.status !== "source" ? `<button type="button" class="btn-secondary" data-update="check"${state.status === "checking" || state.status === "downloading" ? " disabled" : ""}>Check now</button>` : ""
    ].join("");
    const section = P.addPanel("show", "prefUpdates", "Updates", "SHOW",
      row("Check for updates", "When Light Spark starts, and every few hours. A downloaded update is only installed when you quit, never during a show.", check("updateAutoCheck")) +
      `<div class="lx-pref-note" data-update-text>This is Light Spark ${esc(state.version || "")}. ${text()}</div>
       <div class="action-row">${buttons}</div>`);
    if (section && !section.dataset.wired) {
      section.dataset.wired = "1";
      section.addEventListener("click", e => {
        const a = e.target.closest("[data-update]")?.dataset.update;
        if (a === "check") check(true);
        else if (a === "install") install();
      });
    }
  }

  function onState(next) {
    const was = state.status;
    state = { ...state, ...next };
    renderPill(); renderPanel();
    if (state.status === was && !asked) return;
    if (state.status === "ready") say(`Light Spark ${state.latest} downloaded — it installs when you quit (Preferences → Show → Updates to restart now)`, "ok");
    else if (state.status === "available") say(`Light Spark ${state.latest} is out — Preferences → Show → Updates to download it`, "ok");
    else if (asked && state.status === "none") say(`Light Spark ${state.version} is the newest version`, "ok");
    else if (asked && state.status === "error") say(`Couldn't check for updates: ${state.error}`, "warn");
    else if (asked && state.status === "source") say("Running from the source code — update with git pull", "info");
    if (state.status !== "checking") asked = false;
  }

  async function check(byHand = false) {
    asked = byHand;
    if (!api) return onState({ status: "source" });
    try { onState(await api.check()); } catch (e) { onState({ status: "error", error: e.message }); }
  }

  async function install() {
    if (!api) return;
    if (state.status === "ready") {
      const ok = window.LXAsk ? await window.LXAsk("Restart and update?", [], { ok: "Restart now", message: "Light Spark closes, installs the update and opens again. The lights go out while it restarts — don't do this during a show.", safe: true }) : window.confirm("Restart and update now?");
      if (!ok) return;
      try { await window.LXShowCommands?.saveCurrent?.(); } catch (_) {}
    }
    await api.install();
  }

  // "update", "updates", "check for updates" on the command line.
  document.addEventListener("keydown", e => {
    const input = e.target;
    if (e.key !== "Enter" || input?.id !== "cmdInput") return;
    if (!/^(updates?|check for updates?)$/i.test(String(input.value).trim())) return;
    e.preventDefault(); e.stopImmediatePropagation();
    input.value = "";
    check(true);
  }, true);

  function boot() {
    if (!document.querySelector(".topbar-status") || !window.LXPrefs?.addPanel) return setTimeout(boot, 300);
    api?.on?.(onState);
    api?.status?.().then(s => s && onState(s)).catch(() => {});
    renderPanel();
    if (pref("updateAutoCheck", true)) setTimeout(() => check(false), 8000);
    setInterval(() => { if (pref("updateAutoCheck", true) && !["downloading", "ready"].includes(state.status)) check(false); }, 6 * 3600 * 1000);
  }

  const style = document.createElement("style");
  style.textContent = ".lx-update-pill{color:#8fd3ff;border-color:rgba(80,170,255,.5);cursor:pointer}";
  document.head.appendChild(style);

  window.LXUpdates = Object.freeze({ check, install, state: () => ({ ...state }) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
