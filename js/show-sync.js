"use strict";

/*
 * Working on a show from more than one Mac.
 *
 *   Shows folder   Preferences → Show → Shows Folder: Documents, iCloud
 *                  Drive, or a folder you choose. In iCloud Drive (or any
 *                  synced folder) every Mac sees the same shows; your shows
 *                  can be copied across when you switch.
 *   Open elsewhere opening a show that's open on your other Mac says so
 *                  (a note beside the show, <show>.json.lxlock, refreshed
 *                  every minute while it's open).
 *   Saved elsewhere if the open show is saved on the other Mac, a bar offers
 *                  that version or keeping yours. Until you choose, autosave
 *                  doesn't write over it.
 *
 * Shows iCloud hasn't downloaded yet are listed and downloaded when opened
 * (main.js).
 */
(function () {
  if (window.LXShowSync) return;
  const files = () => window.LXShowFiles;
  const show = () => window.LXShowCommands;
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const time = ms => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  let current = null, known = 0, host = "", lockTimer = null, watchTimer = null, ignoredMtime = 0;

  // ------------------------------------------------------- the bar on top

  function bar(html, actions = []) {
    let el = document.getElementById("lxSyncBar");
    if (!html) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "lxSyncBar";
      el.className = "lx-sync-bar";
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>${html}</span>${actions.map((a, i) => `<button type="button" data-i="${i}" class="${a.primary ? "btn-primary" : "btn-secondary"}">${esc(a.label)}</button>`).join("")}`;
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => actions[Number(b.dataset.i)].run()));
  }

  // ---------------------------------------------------- open somewhere else

  async function lock(path, on) {
    if (!path || !files()?.lock) return null;
    try { return await files().lock(path, on); } catch (_) { return null; }
  }

  async function opened(path) {
    if (path === current) return;
    if (current) lock(current, false);
    current = path || null;
    clearInterval(lockTimer);
    bar(null);
    window.__lxShowHold = false;
    if (!current) return;
    const result = await lock(current, true);
    host = result?.host || host;
    if (result?.other) {
      bar(`⚠ <b>${esc(show()?.name?.() || "This show")}</b> is also open on <b>${esc(result.other.host)}</b> (since ${time(result.other.since || result.other.at)}). Changes made on both Macs won't merge — the last one saved wins. Close it there, or only change it on one Mac.`, [{ label: "OK", run: () => bar(null) }]);
    }
    lockTimer = setInterval(() => lock(current, true), 60000);
    const stat = await files()?.stat?.(current).catch(() => null);
    known = stat?.mtimeMs || 0;
  }

  // ---------------------------------------------------- saved somewhere else

  async function check() {
    if (!current || !files()?.stat) return;
    let stat;
    try { stat = await files().stat(current); } catch (_) { return; }
    if (!stat?.exists || !stat.mtimeMs || stat.mtimeMs === known || stat.mtimeMs === ignoredMtime) return;
    host = stat.host || host;
    // Saved here (Save or autosave): just note it.
    if (!stat.savedBy || stat.savedBy === host) { known = stat.mtimeMs; return; }
    window.__lxShowHold = true;
    const dirty = show()?.isDirty?.();
    bar(`☁ <b>${esc(show()?.name?.() || "This show")}</b> was saved on <b>${esc(stat.savedBy)}</b> at ${time(stat.mtimeMs)}.${dirty ? " You have changes here that aren't saved — loading theirs loses them." : ""} Autosave is paused until you choose.`, [
      { label: `Load ${stat.savedBy}'s version`, primary: !dirty, run: async () => {
        bar(null);
        window.__lxShowHold = false;
        try { await show().loadShow(current); } catch (err) { window.log?.(`Couldn't load it: ${err.message}`, "warn"); }
        const again = await files().stat(current).catch(() => null);
        known = again?.mtimeMs || known;
      } },
      { label: "Keep mine (save over it)", primary: dirty, run: async () => {
        bar(null);
        window.__lxShowHold = false;
        try { await show().saveShow(current); } catch (err) { window.log?.(`Couldn't save: ${err.message}`, "warn"); }
        const again = await files().stat(current).catch(() => null);
        known = again?.mtimeMs || known;
      } },
      { label: "Decide later", run: () => { ignoredMtime = stat.mtimeMs; bar(null); } }
    ]);
    known = stat.mtimeMs;
  }

  // ---------------------------------------------------------- the settings

  async function renderPanel() {
    const body = document.querySelector("#prefShowsFolder .panel-body");
    if (!body || !files()?.folder) return;
    let info;
    try { info = await files().folder(); } catch (_) { return; }
    host = info.host || host;
    const choice = (kind, label, disabled = false) => `<button type="button" data-kind="${kind}" class="${info.kind === kind ? "on" : ""}"${disabled ? " disabled" : ""}>${label}</button>`;
    body.innerHTML = `
      <div class="lx-sync-intro"><b>Shows folder</b><small>Where Light Spark saves and lists shows. Pick iCloud Drive to have the same shows on all your Macs.</small></div>
      <div class="lx-seg lx-sync-seg">${choice("documents", "Documents")}${choice("icloud", "iCloud Drive", !info.icloud)}${choice("custom", "Choose folder…")}</div>
      <div class="lx-sync-path" title="${esc(info.path)}">📁 ${esc(info.path)}</div>
      <label class="lx-sync-copy"><input type="checkbox" id="lxSyncCopy" checked> When switching, copy my shows into the new folder</label>
      ${info.icloud ? "" : `<div class="lx-pref-note">iCloud Drive isn't on for this Mac: System Settings → your name → iCloud → iCloud Drive.</div>`}
      <div class="lx-pref-note">This Mac is <b>${esc(info.host)}</b>. While a show is open, your other Mac is told so, and if it saves the show you're asked which version to keep. <b>QLab and Capture:</b> keep each show's QLab workspace and Capture project in the same iCloud folder (one folder per show) and they sync too — see the note below.</div>
      <details class="lx-sync-help"><summary>Using QLab and Capture on two Macs</summary>
        <ul>
          <li>Make a folder per show in iCloud Drive → Light Spark Shows (e.g. “Frozen”) and save the Light Spark show, the QLab workspace (with its media inside its folder) and the Capture project in it. Light Spark lists shows in those folders too.</li>
          <li>Right-click the folder in Finder → <b>Keep Downloaded</b>, so every file is on the Mac before you open it — QLab can't play media that's still in the cloud.</li>
          <li>Only have a show open on one Mac at a time. Two Macs saving the same QLab or Capture file makes a copy named “… 2” instead of mixing them.</li>
          <li>On show day, run from a Mac whose files are fully downloaded and don't rely on the internet.</li>
        </ul></details>
      <div id="lxSyncStatus" class="lx-pref-note"></div>`;
    body.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => switchTo(b.dataset.kind)));
  }

  async function switchTo(kind) {
    const status = document.getElementById("lxSyncStatus");
    let path;
    if (kind === "custom") { path = await files().chooseFolder(); if (!path) return; }
    try {
      const r = await files().setFolder(kind, { path, copy: document.getElementById("lxSyncCopy")?.checked });
      const msg = `Shows folder: ${r.path}${r.copied ? ` — ${r.copied} show${r.copied === 1 ? "" : "s"} copied from ${r.from}` : ""}`;
      window.log?.(msg, "ok");
      await renderPanel();
      const s = document.getElementById("lxSyncStatus");
      if (s) s.textContent = r.copied ? `${r.copied} show${r.copied === 1 ? "" : "s"} copied. The originals are still in ${r.from}.` : "Switched.";
    } catch (err) {
      if (status) status.textContent = `⚠ ${err.message}`;
    }
  }

  function install(tries = 0) {
    if (!window.LXPrefs?.addPanel || !document.getElementById("prefShow")) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    window.LXPrefs.addPanel("show", "prefShowsFolder", "Shows Folder", "SYNC", "");
    // First in the Show tab: it decides where everything else is saved.
    const panel = document.getElementById("prefShowsFolder");
    document.getElementById("prefShow")?.before(panel);
    renderPanel();
    if (!document.getElementById("lxSyncStyles")) {
      const st = document.createElement("style");
      st.id = "lxSyncStyles";
      st.textContent = `.lx-sync-bar{position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:100040;display:flex;align-items:center;gap:10px;max-width:min(900px,calc(100vw - 32px));padding:10px 14px;border:1px solid #5a4520;border-radius:10px;background:#1b1508;color:#f4e4c1;font-size:12.5px;line-height:1.45;box-shadow:0 12px 30px rgba(0,0,0,.5)}.lx-sync-bar span{flex:1}.lx-sync-bar button{flex:0 0 auto;min-height:34px;padding:0 12px;white-space:nowrap}.lx-sync-intro b{display:block;font-size:12.5px;color:#edf4f2}.lx-sync-intro small{display:block;margin:3px 0 8px;font-size:11px;line-height:1.45;color:#7d8987}.lx-sync-seg{display:flex;width:100%}.lx-sync-seg button{flex:1;min-width:0;white-space:nowrap}.lx-sync-seg button.on{background:var(--accent-soft,#123);color:var(--accent,#19d6a3)}.lx-sync-path{margin:6px 0;padding:8px 10px;border:1px solid #202a30;border-radius:7px;background:#0a0f12;font:11px var(--mono,monospace);color:#9fb0ac;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lx-sync-copy{display:flex;align-items:center;gap:8px;margin:4px 0 8px;font-size:12px;color:#c6d0ce}.lx-sync-help{font-size:11.5px;color:#9fb0ac;margin-top:6px}.lx-sync-help summary{cursor:pointer;color:#c6d0ce}.lx-sync-help li{margin:4px 0;line-height:1.45}`;
      document.head.appendChild(st);
    }
  }

  window.addEventListener("lx-show-file", e => opened(e.detail?.path || null));
  window.addEventListener("beforeunload", () => { if (current) lock(current, false); });
  watchTimer = setInterval(check, 5000);
  window.LXShowSync = { check, renderPanel, current: () => current };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
