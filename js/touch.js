"use strict";

/*
 * Touch screens.
 *
 *   Touch mode       bigger buttons, rows, faders and scroll bars, no hover-only
 *                    controls, no text getting selected by a long press.
 *                    Preferences → Appearance → Touch screen: Automatic (on when
 *                    the screen reports touch), On or Off. Many touch monitors on
 *                    a Mac act like a mouse and don't report touch: pick On.
 *   Press and hold   does what a right-click does (the cue list's menu, fixture
 *                    info…). On a button with no menu it shows what the button is for.
 *   Keypad           an on-screen command keypad: numbers, thru, @, full, out,
 *                    cue, group, record, GO… and an ABC page for names. It types
 *                    into the command line, or into whichever box you tapped last.
 *                    The ⌨ button at the end of the command line shows and hides it.
 *
 * LXTouch.on is true while touch mode is on.
 */
(function () {
  if (window.LXTouch) return;
  const STORE = "lx_touch_keypad";
  const pref = (key, fallback) => window.LXPrefs?.get(key) ?? fallback;
  const reportsTouch = () => (window.matchMedia?.("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0);
  let on = false;

  function isOn() {
    const mode = pref("touchMode", "auto");
    return mode === "on" || (mode === "auto" && reportsTouch());
  }

  function apply() {
    on = isOn();
    document.documentElement.dataset.touch = on ? "on" : "off";
    // The cue list's rows drag to reorder with a mouse; with a finger that
    // fights scrolling and press-and-hold, so "Move to…" in the menu does it.
    document.querySelectorAll(".cl-row").forEach(row => row.setAttribute("draggable", on ? "false" : "true"));
    if (keypad) keypad.hidden = !(on && keypadWanted());
    syncKeyButton();
  }

  // ------------------------------------------------------------ press and hold

  const HOLD_MS = 550, SLOP = 10;
  let hold = null, lastHold = null;

  function cancelHold() { if (hold) clearTimeout(hold.timer); hold = null; }

  function interactive(el) {
    return el.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], .xy-pad, canvas, .lxw-bar, .lxw-grip, .lx-keypad");
  }

  document.addEventListener("pointerdown", e => {
    cancelHold();
    if (!on || e.button !== 0 || !e.isPrimary || interactive(e.target)) return;
    const target = e.target, x = e.clientX, y = e.clientY;
    hold = { x, y, target, timer: setTimeout(() => fire(target, x, y), HOLD_MS) };
  }, true);
  document.addEventListener("pointermove", e => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) cancelHold();
  }, true);
  ["pointerup", "pointercancel", "dragstart"].forEach(type => document.addEventListener(type, cancelHold, true));
  // Scrolling the list under the finger is a swipe, not a hold. (The log
  // scrolling itself as lines come in elsewhere doesn't count.)
  document.addEventListener("scroll", e => {
    if (hold && (e.target === document || e.target.contains?.(hold.target))) cancelHold();
  }, true);

  function fire(target, x, y) {
    hold = null;
    if (!target.isConnected) return;
    lastHold = { at: Date.now(), x, y };
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
    const handled = !target.dispatchEvent(menu);
    if (!handled) {
      const titled = target.closest?.("[title]");
      if (titled?.title) tip(titled.title, x, y);
      else { lastHold = null; return; }
    }
    // The finger lifting would otherwise also click what's under it.
    const swallow = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    document.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", swallow, true), 800);
  }

  // A real touch screen on Windows opens its own context menu on a long
  // press too; after ours, that one is a duplicate.
  document.addEventListener("contextmenu", e => {
    if (!e.isTrusted || !lastHold) return;
    if (Date.now() - lastHold.at < 1200 && Math.hypot(e.clientX - lastHold.x, e.clientY - lastHold.y) < 30) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  function tip(text, x, y) {
    document.querySelector(".lx-touch-tip")?.remove();
    const el = document.createElement("div");
    el.className = "lx-touch-tip";
    el.textContent = text;
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(x - w / 2, innerWidth - w - 8))}px`;
    el.style.top = `${y - h - 24 > 8 ? y - h - 24 : y + 24}px`;
    const close = () => { el.remove(); document.removeEventListener("pointerdown", close, true); };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
    setTimeout(close, 4000);
  }

  // ------------------------------------------------------------------ keypad

  const CMD_KEYS = [
    ["7", "8", "9", "thru", "@"],
    ["4", "5", "6", "+", "-"],
    ["1", "2", "3", "full", "out"],
    ["0", ".", "/", "time", "group"],
    ["cue", "record", "update", "clear", "go"]
  ];
  const ABC_KEYS = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "'"],
    ["z", "x", "c", "v", "b", "n", "m", ",", ".", "-"]
  ];
  const WORDS = new Set(["thru", "@", "+", "-", "full", "out", "time", "group", "cue", "record", "update", "clear", "go", "/"]);
  let keypad = null, page = "cmd", lastBox = null;

  const keypadWanted = () => { try { return localStorage.getItem(STORE) !== "off"; } catch (_) { return true; } };
  const setWanted = want => { try { localStorage.setItem(STORE, want ? "on" : "off"); } catch (_) {} };

  // Text boxes the keypad can type into; ranges, colours and checkboxes can't take text.
  const typeable = el => el && ((el.tagName === "INPUT" && /^(text|search|number|tel|url|email|password|)$/.test(el.type || "")) || el.tagName === "TEXTAREA");

  document.addEventListener("focusin", e => { if (typeable(e.target) && !e.target.closest(".lx-keypad")) lastBox = e.target; });

  function box() {
    if (lastBox?.isConnected && !lastBox.disabled && lastBox.offsetParent !== null) return lastBox;
    return document.getElementById("cmdInput");
  }

  function put(input, text) {
    const v = input.value;
    let start = v.length, end = v.length;
    try { if (input.selectionStart != null) { start = input.selectionStart; end = input.selectionEnd; } } catch (_) {}
    input.value = v.slice(0, start) + text + v.slice(end);
    try { input.setSelectionRange(start + text.length, start + text.length); } catch (_) {}
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function press(key) {
    const input = box();
    if (!input) return;
    const cmd = input.id === "cmdInput";
    if (key === "enter") {
      const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent("keydown", enter));
      input.dispatchEvent(new KeyboardEvent("keyup", enter));
      if (!cmd && input.form) input.form.requestSubmit?.();
      return;
    }
    if (key === "back") {
      let start = input.value.length, end = start;
      try { if (input.selectionStart != null) { start = input.selectionStart; end = input.selectionEnd; } } catch (_) {}
      if (start === end) start = Math.max(0, start - 1);
      input.value = input.value.slice(0, start) + input.value.slice(end);
      try { input.setSelectionRange(start, start); } catch (_) {}
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (key === "wipe") { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); return; }
    if (key === "space") return put(input, " ");
    if (key === "go" && cmd && !input.value.trim()) { document.getElementById("btnCueGo")?.click(); return; }
    if (WORDS.has(key) && cmd) {
      // Words stand apart: "1 thru 5 @ full", not "1thru5@full".
      const before = input.value.slice(0, input.selectionStart ?? input.value.length);
      put(input, `${before && !/\s$/.test(before) ? " " : ""}${key} `);
      return;
    }
    put(input, key);
  }

  function keyHtml(key) {
    const label = { back: "⌫", wipe: "Clear line", enter: "Enter ↵", space: "Space", abc: "ABC", cmd: "123", "-": "−" }[key] ?? key;
    const kind = /^\d$|^\.$/.test(key) ? "num" : ["enter", "go"].includes(key) ? "go" : "";
    return `<button type="button" data-key="${key}" class="${kind}">${label}</button>`;
  }

  function renderKeypad() {
    const rows = page === "abc" ? [...ABC_KEYS, ["cmd", "space", "back", "enter"]] : [...CMD_KEYS, ["abc", "wipe", "back", "enter"]];
    keypad.querySelector(".lx-keypad-keys").className = `lx-keypad-keys ${page}`;
    keypad.querySelector(".lx-keypad-keys").innerHTML = rows.map(r => `<div class="lx-keypad-row">${r.map(keyHtml).join("")}</div>`).join("");
  }

  function buildKeypad() {
    keypad = document.createElement("div");
    keypad.className = "lx-keypad";
    keypad.hidden = true;
    keypad.innerHTML = `<div class="lx-keypad-bar"><span>KEYPAD</span><button type="button" data-close title="Hide the keypad (⌨ in the command line brings it back)">×</button></div><div class="lx-keypad-keys"></div>`;
    document.body.appendChild(keypad);
    renderKeypad();
    try {
      const at = JSON.parse(localStorage.getItem(`${STORE}_at`) || "null");
      if (at) place(at.x, at.y);
    } catch (_) {}

    // Keys mustn't take the focus away from the box they type into.
    keypad.addEventListener("pointerdown", e => { if (e.target.closest("button")) e.preventDefault(); });
    keypad.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-close")) { setWanted(false); apply(); return; }
      const key = b.dataset.key;
      if (key === "abc" || key === "cmd") { page = key; renderKeypad(); return; }
      press(key);
    });

    const bar = keypad.querySelector(".lx-keypad-bar");
    bar.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const start = { px: e.clientX, py: e.clientY, x: keypad.offsetLeft, y: keypad.offsetTop };
      const move = m => place(start.x + m.clientX - start.px, start.y + m.clientY - start.py);
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
        try { localStorage.setItem(`${STORE}_at`, JSON.stringify({ x: keypad.offsetLeft, y: keypad.offsetTop })); } catch (_) {}
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
    window.addEventListener("resize", () => { if (keypad.style.left) place(keypad.offsetLeft, keypad.offsetTop); });
  }

  function place(x, y) {
    const w = keypad.offsetWidth || 340, h = keypad.offsetHeight || 300;
    keypad.style.left = `${Math.max(0, Math.min(x, innerWidth - w))}px`;
    keypad.style.top = `${Math.max(0, Math.min(y, innerHeight - h))}px`;
    keypad.style.right = keypad.style.bottom = "auto";
  }

  let keyButton = null;
  function syncKeyButton() {
    if (!keyButton) return;
    keyButton.classList.toggle("open", Boolean(keypad && !keypad.hidden));
  }

  function installKeyButton() {
    const line = document.querySelector(".cmd-line");
    if (!line || keyButton) return;
    keyButton = document.createElement("button");
    keyButton.type = "button";
    keyButton.className = "lx-keypad-toggle";
    keyButton.title = "On-screen keypad";
    keyButton.textContent = "⌨";
    keyButton.addEventListener("pointerdown", e => e.preventDefault());
    keyButton.addEventListener("click", () => {
      const show = keypad.hidden;
      setWanted(show);
      keypad.hidden = !show;
      syncKeyButton();
    });
    line.insertBefore(keyButton, line.querySelector("#cmdInput"));
  }

  // ------------------------------------------------------------------ styles

  function injectStyles() {
    if (document.getElementById("lxTouchStyles")) return;
    const style = document.createElement("style");
    style.id = "lxTouchStyles";
    const T = 'html[data-touch="on"]';
    style.textContent = `
      .lx-keypad-toggle{display:none;flex:0 0 auto;margin-right:8px;width:44px;height:34px;border:1px solid var(--border,#26343a);border-radius:7px;background:#10171b;color:#9fb0ac;font-size:18px;cursor:pointer}
      .lx-keypad-toggle.open{border-color:var(--accent,#19d6a3);color:var(--accent,#19d6a3)}
      ${T} .lx-keypad-toggle{display:block}
      .lx-keypad{position:fixed;right:16px;bottom:64px;z-index:100050;width:360px;max-width:calc(100vw - 16px);background:#0b1114;border:1px solid #2b383f;border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.55);user-select:none;-webkit-user-select:none;touch-action:none}
      .lx-keypad[hidden]{display:none}
      /* Above dialogs so it can type into them, but a menu that's open goes over it. */
      body:has(.lxw-menu:not([hidden])) .lx-keypad{z-index:1900}
      .lx-keypad-bar{display:flex;align-items:center;justify-content:space-between;height:34px;padding:0 6px 0 12px;border-bottom:1px solid #202a30;color:#61706c;font-size:10px;font-weight:850;letter-spacing:1.2px;cursor:grab}
      .lx-keypad-bar button{width:40px;height:30px;border:0;border-radius:6px;background:transparent;color:#8a9894;font-size:18px;cursor:pointer}
      .lx-keypad-keys{display:grid;gap:6px;padding:8px}
      .lx-keypad-row{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
      .lx-keypad-keys.abc{gap:5px}.lx-keypad-keys.abc .lx-keypad-row{gap:4px}
      .lx-keypad-keys.abc .lx-keypad-row:last-child{grid-template-columns:1fr 2.4fr 1fr 1.6fr;grid-auto-flow:row}
      .lx-keypad-keys button{min-height:52px;padding:0 2px;border:1px solid #26343a;border-radius:8px;background:#121b20;color:#c6d0ce;font-size:13px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;cursor:pointer;touch-action:manipulation}
      .lx-keypad-keys.abc button{min-height:46px;font-size:15px;text-transform:none}
      .lx-keypad-keys button.num{font-size:21px;font-family:var(--mono,monospace);color:#edf4f2;background:#18232a}
      .lx-keypad-keys button.go{background:var(--accent,#19d6a3);border-color:transparent;color:#061210}
      .lx-keypad-keys button:active{transform:scale(.95);filter:brightness(1.3)}
      .lx-touch-tip{position:fixed;z-index:100060;max-width:320px;padding:9px 12px;border:1px solid #2b383f;border-radius:8px;background:#0b1114;color:#dbe4e2;font-size:13px;line-height:1.35;box-shadow:0 10px 26px rgba(0,0,0,.5);pointer-events:none}

      /* A finger is about 9 mm: about 44 px is the smallest thing worth aiming at. */
      ${T} body{-webkit-tap-highlight-color:transparent}
      ${T} body{-webkit-user-select:none;user-select:none}
      ${T} input,${T} textarea,${T} [contenteditable],${T} #termLog{-webkit-user-select:text;user-select:text}
      ${T} button,${T} .btn-primary,${T} .btn-secondary,${T} .btn-danger-soft,${T} .btn-icon,${T} .deck-tab{min-height:44px!important;touch-action:manipulation}
      ${T} .btn-icon{padding-left:14px!important;padding-right:14px!important}
      ${T} .lx-swatches button{min-height:0!important;width:36px;height:36px}
      ${T} button:active{filter:brightness(1.25)}
      ${T} input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]),${T} select{min-height:42px!important;font-size:15px!important}
      ${T} input[type=checkbox],${T} input[type=radio]{width:24px;height:24px}
      ${T} .nav-link{min-height:52px!important}
      ${T} .item-list > *,${T} .fixture-item,${T} .pt-row,${T} .qlab-sync-list > *{min-height:46px!important}
      ${T} .cl-row{height:48px!important;font-size:14px!important}
      ${T} .cl-head{height:34px}
      ${T} #btnCueGo{min-width:120px;font-size:16px!important;font-weight:900}
      ${T} #btnCueBack{min-width:84px}
      ${T} .cue-actions{gap:8px}
      ${T} .cmd-line{min-height:52px}
      ${T} #cmdInput{font-size:17px!important}
      ${T} .lxw-bar{height:44px!important;min-height:44px}
      ${T} .lxw-bar button{width:44px!important;height:38px!important;font-size:18px!important}
      ${T} .lxw-grip{width:34px!important;height:34px!important}
      ${T} .lxw-menu button,${T} .lxw-menu-btn{min-height:44px!important;font-size:14px!important}
      ${T} .lxw-menu button{padding-top:10px!important;padding-bottom:10px!important}
      ${T} .xy-pad,${T} #colourWheel,${T} .colour-wheel,${T} canvas,${T} svg{touch-action:none}
      ${T} input[type=range]{height:40px!important;touch-action:none}
      ${T} input[type=range]::-webkit-slider-thumb{width:30px!important;height:30px!important;border-radius:50%!important}
      ${T} .dynamic-mini-fader::-webkit-slider-thumb{width:28px!important;height:28px!important}
      ${T} ::-webkit-scrollbar{width:16px!important;height:16px!important}
      ${T} ::-webkit-scrollbar-thumb{min-height:48px;border:4px solid transparent;background-clip:padding-box;border-radius:10px}
      /* Shown on hover with a mouse; a finger can't hover, so always shown. */
      ${T} .lxw:not(.front){opacity:1!important}
      ${T} .nav-link.nav-add{opacity:1!important}
      ${T} #lxScreenMirror .bar{opacity:1!important}
    `;
    document.head.appendChild(style);
  }

  // --------------------------------------------------------------------- boot

  function boot(tries = 0) {
    if (!document.body || !document.querySelector(".cmd-line")) { if (tries < 100) setTimeout(() => boot(tries + 1), 100); return; }
    injectStyles();
    buildKeypad();
    installKeyButton();
    apply();
    window.LXPrefs?.on?.(key => { if (key === "touchMode") apply(); });
    // A touch screen plugged in (or taken out) while the app is open.
    window.matchMedia?.("(any-pointer: coarse)").addEventListener?.("change", apply);
    // The cue list rebuilds its rows; keep them in step.
    setInterval(() => { if (on) document.querySelectorAll('.cl-row[draggable="true"]').forEach(r => r.setAttribute("draggable", "false")); }, 1000);
  }

  window.LXTouch = {
    get on() { return on; },
    keypad: show => { if (!keypad) return; setWanted(show !== false); keypad.hidden = show === false; syncKeyButton(); },
    press
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
  else boot();
})();
