"use strict";

/*
 * Preferences tabs: Appearance, Layout, Programming, Keyboard, Show (built by preferences.js),
 * Outputs, MIDI, QLab Connect (and Other, for any panel nothing else
 * claims). Panels are added to the Settings page by several scripts at
 * different times, so each one is sorted into its tab as it appears. The
 * tabs live in a .lx-settings box that preferences.js shows in the
 * Preferences window. The last tab used is remembered.
 */
(function () {
  if (window.__settingsTabsInstalled) return;
  window.__settingsTabsInstalled = true;

  const TABS = [
    { id: "interface", label: "Appearance", hint: "How the console looks: density, size, colours and detail." },
    { id: "layout", label: "Layout", hint: "What's in the sidebar, top bar and bottom bar, and how windows behave." },
    { id: "programming", label: "Programming", hint: "Defaults for recording cues, palettes and the patch, and what Light Spark starts with." },
    { id: "keyboard", label: "Keyboard", hint: "GO and Back keys, the command line and shortcuts." },
    { id: "show", label: "Show", hint: "Autosave, saving and opening shows, quitting, and these preferences." },
    { id: "showcontrol", label: "Show Control", hint: "MIDI Show Control in and out, and timecode (MTC, LTC or Light Spark's own clock) firing cues." },
    { id: "network", label: "Multi-Console", hint: "Run Light Spark on more than one computer: a primary, a backup that takes over if it fails, clients and mirrors." },
    { id: "outputs", label: "Outputs", hint: "Where the console sends DMX: Art-Net, sACN and USB interfaces, one per universe." },
    { id: "midi", label: "MIDI", hint: "Connect a MIDI controller and choose what each knob, pad and joystick does." },
    { id: "qlab", label: "QLab Connect", hint: "Let QLab Connect fire Light Spark's cues, chases and effects." },
    { id: "other", label: "Other", hint: "" }
  ];
  const STORE = "lighting-settings-tab";

  // Which tab a panel belongs in, from its id or heading.
  function tabFor(panel) {
    if (panel.dataset.prefsTab) return panel.dataset.prefsTab;
    const text = `${panel.id} ${panel.querySelector(".panel-header")?.textContent || ""}`.toLowerCase();
    if (/midi/.test(text)) return "midi";
    if (/qlab|qclink/.test(text)) return "qlab";
    if (/output|art-?net|sacn|dmx|usb/.test(text)) return "outputs";
    return "other";
  }

  let page = null, box = null, body = null, bar = null, hint = null, active = "interface";

  function injectStyles() {
    if (document.getElementById("settingsTabStyles")) return;
    const style = document.createElement("style");
    style.id = "settingsTabStyles";
    style.textContent = `
      .lx-settings{display:grid;grid-template-columns:168px minmax(0,1fr);height:100%;min-height:0}
      .lx-settings .settings-head{display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid var(--border);background:#0a1013;overflow:auto}
      .lx-settings .settings-head .deck-tabs{display:flex;flex-direction:column;gap:2px;margin:0}
      .lx-settings .settings-head .deck-tab{padding:0 10px;height:30px;min-width:0;text-align:left;text-transform:none;letter-spacing:.2px;font-size:12px;font-weight:650;border:0;border-radius:5px;background:transparent;color:#9aa7a4}
      .lx-settings .settings-head .deck-tab:hover{background:#141d22;color:var(--text)}
      .lx-settings .settings-head .deck-tab.active{background:var(--accent-soft);color:var(--accent-2);box-shadow:inset 2px 0 0 var(--accent)}
      .lx-settings .settings-main{display:flex;flex-direction:column;min-height:0;overflow:auto;padding:12px}
      .lx-settings .settings-hint{color:#7d8b88;font-size:11px;margin:0 0 10px}
      .lx-settings .settings-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:10px;align-items:start}
      .lx-settings .settings-body > .panel[data-settings-hidden]{display:none!important}
      .lx-settings .settings-body > .panel{box-shadow:none}
      #page-settings > .page-grid:empty{display:none}
      .lx-settings input[type="checkbox"]{width:16px;height:16px;min-height:0;flex:none;padding:0;accent-color:var(--accent)}
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
    active = TABS.some(t => t.id === id) ? id : "interface";
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
    for (const panel of [...page.querySelectorAll("section.panel"), ...body.querySelectorAll(":scope > section.panel")]) {
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
    box = document.createElement("div");
    box.className = "lx-settings";
    box.innerHTML = `<div class="settings-head"><div class="deck-tabs" role="tablist">${TABS.map(t => `<button type="button" class="deck-tab" role="tab" data-tab="${t.id}">${t.label}</button>`).join("")}</div></div><div class="settings-main"><div class="settings-hint"></div><div class="settings-body"></div></div>`;
    page.prepend(box);
    body = box.querySelector(".settings-body");
    bar = box.querySelector(".deck-tabs");
    hint = box.querySelector(".settings-hint");
    bar.addEventListener("click", e => { const b = e.target.closest(".deck-tab"); if (b) select(b.dataset.tab); });
    try { active = localStorage.getItem(STORE) || active; } catch (_) {}
    collect();
    select(active);
    // The box moves into the Preferences window, so watch both places.
    new MutationObserver(collect).observe(page, { childList: true, subtree: true });
    new MutationObserver(collect).observe(body, { childList: true });
    return true;
  }

  window.SettingsTabs = Object.freeze({ select: id => select(id), box: () => box, active: () => active });
  function boot() { if (!install()) setTimeout(boot, 300); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
