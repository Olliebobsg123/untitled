"use strict";

/*
 * Settings sub-tabs: Outputs, MIDI, QLab Connect (and Other, for any panel
 * nothing else claims). Panels are added to the Settings page by several
 * scripts at different times, so each one is sorted into its tab as it
 * appears. The last tab used is remembered.
 */
(function () {
  if (window.__settingsTabsInstalled) return;
  window.__settingsTabsInstalled = true;

  const TABS = [
    { id: "outputs", label: "Outputs", hint: "Where the console sends DMX: Art-Net, sACN and USB interfaces, one per universe." },
    { id: "midi", label: "MIDI", hint: "Connect a MIDI controller and choose what each knob, pad and joystick does." },
    { id: "qlab", label: "QLab Connect", hint: "Let QLab Connect fire Light Spark's cues, chases and effects." },
    { id: "other", label: "Other", hint: "" }
  ];
  const STORE = "lighting-settings-tab";

  // Which tab a panel belongs in, from its id or heading.
  function tabFor(panel) {
    const text = `${panel.id} ${panel.querySelector(".panel-header")?.textContent || ""}`.toLowerCase();
    if (/midi/.test(text)) return "midi";
    if (/qlab|qclink/.test(text)) return "qlab";
    if (/output|art-?net|sacn|dmx|usb/.test(text)) return "outputs";
    return "other";
  }

  let page = null, body = null, bar = null, hint = null, active = "outputs";

  function injectStyles() {
    if (document.getElementById("settingsTabStyles")) return;
    const style = document.createElement("style");
    style.id = "settingsTabStyles";
    style.textContent = `
      #page-settings .settings-head{display:flex;align-items:center;gap:16px;margin-bottom:12px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-md);background:linear-gradient(180deg,rgba(16,22,26,.98),rgba(11,16,19,.98))}
      #page-settings .settings-head .deck-tabs{display:flex;gap:6px;margin:0}
      #page-settings .settings-head .deck-tab{padding:8px 16px;min-width:96px}
      #page-settings .settings-hint{color:#6f7d7a;font-size:11px;margin-left:auto;text-align:right}
      #page-settings .settings-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:12px;align-items:start}
      #page-settings .settings-body > .panel[data-settings-hidden]{display:none!important}
      #page-settings > .page-grid:empty{display:none}
      #page-settings input[type="checkbox"]{width:16px;height:16px;min-height:0;flex:none;padding:0;accent-color:var(--accent)}
      /* DMX Outputs: calmer intro, card titles and status lines. */
      #multiOutputPanel .panel-body > p{font-size:11px;line-height:1.55;color:#7d8987;opacity:1!important;margin:0 0 12px}
      #multiOutputPanel strong{font-size:12px;letter-spacing:.4px}
      #multiOutputPanel .multi-status{font-size:11px;color:#7d8987}
      /* MIDI mapping list: same look as the rest of the form controls. */
      #midiMappings > div{display:grid!important;grid-template-columns:110px 1fr auto;gap:8px!important;align-items:center;margin-bottom:6px!important}
      #midiMappings span{width:auto!important;color:#9aa7a4;font-size:10px;font-weight:800;letter-spacing:.8px}
      #midiMappings select{height:32px;padding:0 10px;background:#0d1418;border:1px solid var(--border);border-radius:6px;color:#e3ebe9;font-size:12px}
      #midiMappings button{height:32px;min-width:92px;font-size:10px}
    `;
    document.head.appendChild(style);
  }

  function select(id) {
    active = TABS.some(t => t.id === id) ? id : "outputs";
    try { localStorage.setItem(STORE, active); } catch (_) {}
    for (const button of bar.querySelectorAll(".deck-tab")) {
      button.classList.toggle("active", button.dataset.tab === active);
      button.setAttribute("aria-selected", button.dataset.tab === active ? "true" : "false");
    }
    for (const panel of body.children) {
      if (panel.dataset.settingsTab === active) panel.removeAttribute("data-settings-hidden");
      else panel.setAttribute("data-settings-hidden", "");
    }
    hint.textContent = TABS.find(t => t.id === active)?.hint || "";
  }

  // Move every panel on the page into the tab body, tagged with its tab.
  function collect() {
    let moved = false;
    for (const panel of page.querySelectorAll("section.panel")) {
      // Some panels are inserted next to another one, so they can already
      // be in the body without a tab.
      if (panel.parentElement === body && panel.dataset.settingsTab) continue;
      panel.dataset.settingsTab = tabFor(panel);
      if (panel.parentElement !== body) body.appendChild(panel);
      moved = true;
    }
    if (!moved) return;
    // Tabs with nothing visible in them are hidden (e.g. Other, usually).
    for (const tab of TABS) {
      const any = [...body.children].some(p => p.dataset.settingsTab === tab.id && p.style.display !== "none");
      bar.querySelector(`[data-tab="${tab.id}"]`).hidden = !any && tab.id === "other";
    }
    select(active);
  }

  function install() {
    page = document.getElementById("page-settings");
    if (!page) return false;
    injectStyles();
    const head = document.createElement("div");
    head.className = "settings-head";
    head.innerHTML = `<div class="deck-tabs" role="tablist">${TABS.map(t => `<button type="button" class="deck-tab" role="tab" data-tab="${t.id}">${t.label}</button>`).join("")}</div><div class="settings-hint"></div>`;
    body = document.createElement("div");
    body.className = "settings-body";
    page.prepend(head, body);
    bar = head.querySelector(".deck-tabs");
    hint = head.querySelector(".settings-hint");
    bar.addEventListener("click", e => { const b = e.target.closest(".deck-tab"); if (b) select(b.dataset.tab); });
    try { active = localStorage.getItem(STORE) || active; } catch (_) {}
    collect();
    select(active);
    new MutationObserver(collect).observe(page, { childList: true, subtree: true });
    return true;
  }

  window.SettingsTabs = Object.freeze({ select: id => select(id) });
  function boot() { if (!install()) setTimeout(boot, 300); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
