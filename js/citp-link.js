"use strict";

/*
 * CITP (Settings → Outputs → Visualiser link): keeps a visualiser such as
 * Capture in step with Light Spark. citp.js does the talking; this page
 * sends it the patch, the selection and (if asked) the levels, shows who
 * it has found, and selects lights clicked in the visualiser.
 *
 * Light ids on CITP are fixture numbers, the same numbers as the command line.
 *
 * The patch can also come the other way: "Get Capture's patch" shows what
 * Capture has that Light Spark doesn't (or has differently) and patches it
 * when you say so; "Capture → Light Spark" follows Capture's patch as it
 * changes. Lights Light Spark has no profile for are added with the right
 * channel count (Patch → Fixture Editor gives their channels jobs).
 */
(function () {
  if (window.LXCitp) return;
  const STORE = "lx-citp";
  const $ = id => document.getElementById(id);
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let config = { enabled: false, patchMode: "send", selection: true, levels: false };
  try { config = { ...config, ...(JSON.parse(localStorage.getItem(STORE) || "{}") || {}) }; } catch (_) {}
  if (typeof config.patch === "boolean") { config.patchMode = config.patch ? "send" : "off"; delete config.patch; }
  let socket = null, retry = null, status = null, lastPatch = "", lastSelection = "", fromPeer = false, lastLevels = "", lastLevelsAt = 0;
  let preview = null; // { from, fixtures, diff } while "Get Capture's patch" waits for a yes

  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(config)); } catch (_) {} };
  const send = m => { if (socket?.readyState !== WebSocket.OPEN) return false; try { socket.send(JSON.stringify(m)); return true; } catch (_) { return false; } };

  function connect() {
    clearTimeout(retry);
    if (socket && socket.readyState <= 1) return;
    try {
      socket = new WebSocket("ws://127.0.0.1:8087");
      socket.onopen = () => { lastPatch = lastSelection = ""; send({ type: "CITP_CONFIG", config }); tick(); };
      socket.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) {} };
      socket.onclose = () => { socket = null; retry = setTimeout(connect, 2000); };
      socket.onerror = () => {};
    } catch (_) { retry = setTimeout(connect, 2000); }
  }

  function onMessage(m) {
    if (m.type === "CITP_STATUS") { status = m; render(); }
    if (m.type === "CITP_SELECT") select(m.ids, m.from);
    if (m.type === "CITP_PEER_PATCH_FULL") showPreview(m);
    if (m.type === "CITP_PEER_PATCH" && config.patchMode === "receive") follow(m);
  }

  // ------------------------------------------------------------ what we send

  const defOf = f => (typeof window.getFixtureDefinition === "function" ? window.getFixtureDefinition(f) : window.FixtureLibrary?.[f?.name]) || {};
  const numberOf = f => Number(f?.fixtureNumber) || (S().fixtures || []).indexOf(f) + 1;

  // Make and model as a visualiser's library knows them: "Robe" + "Robin
  // 600 LEDWash", not "Robe Robin 600 LEDWash (Mode 1)".
  function makeAndName(f) {
    const def = defOf(f);
    const full = String(f?.name || def.name || "Fixture");
    const make = String(def.manufacturer || def.make || def.brand || "").trim() || (/^generic\s/i.test(full) ? "Generic" : "");
    let name = String(def.model || full).replace(/\s*\([^)]*\)\s*$/, "").trim() || full;
    if (make && name.toLowerCase().startsWith(make.toLowerCase() + " ")) name = name.slice(make.length + 1);
    return { make: make || "Generic", name };
  }

  function patchList() {
    return (S().fixtures || []).map(f => {
      const def = defOf(f);
      return { id: numberOf(f), universe: Number(f.uni ?? f.universe) || 1, channel: Number(f.addr ?? f.address) || 1, count: Number(def.channels || def.channelCount) || 1, ...makeAndName(f) };
    });
  }

  function selectedNumbers() {
    const selected = S().selected instanceof Set ? S().selected : new Set();
    return (S().fixtures || []).filter(f => selected.has(f.id)).map(numberOf).sort((a, b) => a - b);
  }

  function levels() {
    const frames = {};
    const dmx = S().dmx;
    if (!dmx) return frames;
    for (const f of S().fixtures || []) {
      const u = Number(f.uni ?? f.universe), base = Number(f.addr ?? f.address) - 1;
      if (!Number.isInteger(u) || !Number.isInteger(base) || base < 0) continue;
      const global = typeof window.getFixtureBaseAddress === "function" ? window.getFixtureBaseAddress(f) : base;
      const count = Number(defOf(f).channels) || 1;
      frames[u] ||= new Array(512).fill(0);
      for (let i = 0; i < count && base + i < 512; i++) frames[u][base + i] = Number(dmx[global + i]) & 255;
    }
    return frames;
  }

  let ticks = 0;
  function tick() {
    if (!config.enabled || socket?.readyState !== WebSocket.OPEN) return;
    ticks++;
    if (ticks % 10 === 0 || !lastPatch) {
      const list = patchList(), text = JSON.stringify(list);
      if (text !== lastPatch) { lastPatch = text; send({ type: "CITP_PATCH", fixtures: list }); }
    }
    const ids = selectedNumbers(), text = JSON.stringify(ids);
    if (text !== lastSelection) {
      lastSelection = text;
      if (!fromPeer) send({ type: "CITP_SELECTION", ids });
      fromPeer = false;
    }
  }

  // Levels: checked 25 times a second and sent only when something moved
  // (and once a second anyway), so CITP keeps up with sACN.
  function levelTick() {
    if (!config.enabled || !config.levels || socket?.readyState !== WebSocket.OPEN) return;
    const frames = levels(), text = JSON.stringify(frames);
    if (text === lastLevels && Date.now() - lastLevelsAt < 1000) return;
    lastLevels = text; lastLevelsAt = Date.now();
    send({ type: "CITP_LEVELS", universes: frames });
  }

  // ------------------------------------------------- Capture's patch, here

  // Light Spark's profile for a light Capture names, or a new one with the
  // right channel count when there's none.
  function profileFor(make, name, count) {
    const lib = window.FixtureLibrary || {};
    const norm = t => String(t || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const want = norm(name), wantFull = norm(`${make} ${name}`), wantMake = norm(make);
    const keys = Object.keys(lib);
    const fits = k => !count || Number(lib[k]?.channels) === Number(count);
    const score = k => {
      const def = lib[k] || {}, key = norm(k), model = norm(def.model), maker = norm(def.manufacturer);
      if ((model === want || key === want) && (!wantMake || !maker || maker === wantMake)) return 3;
      if (key === wantFull || key.startsWith(wantFull + " ")) return 2;
      if (want && (key.startsWith(want + " ") || key.includes(" " + want))) return 1;
      return 0;
    };
    const best = keys.filter(fits).map(k => [k, score(k)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
    if (best) return { key: best[0], made: false };
    const key = `${make && !/^generic$/i.test(make) ? `${make} ` : ""}${name || "Fixture"} (${count}ch, from Capture)`;
    return { key, made: !lib[key], definition: { type: "dimmer", channels: Math.max(1, Number(count) || 1), map: { intensity: 0, dimmer: 0 }, manufacturer: make || "Custom", model: name || key, custom: true, fromCapture: true } };
  }

  // What using Capture's patch would do: add, change (moved or a different
  // light) and, if asked, unpatch.
  function diff(fixtures) {
    const here = new Map((S().fixtures || []).map(f => [numberOf(f), f]));
    const add = [], change = [], same = [];
    for (const c of fixtures) {
      const profile = profileFor(c.make, c.name, c.count);
      const f = here.get(c.id);
      const item = { ...c, profile };
      if (!f) add.push(item);
      else if (Number(f.uni) !== c.universe || Number(f.addr) !== c.channel || f.name !== profile.key) change.push({ ...item, was: f });
      else same.push(item);
    }
    const theirs = new Set(fixtures.map(c => c.id));
    const missing = [...here.entries()].filter(([n]) => !theirs.has(n)).map(([, f]) => f);
    return { add, change, same, missing };
  }

  function apply(d, { unpatchMissing = false } = {}) {
    const lib = window.FixtureLibrary || {};
    const made = [];
    let custom = {};
    try { custom = JSON.parse(localStorage.getItem("lx-custom-fixtures") || "{}") || {}; } catch (_) {}
    for (const item of [...d.add, ...d.change]) {
      if (item.profile.definition && !lib[item.profile.key]) {
        lib[item.profile.key] = JSON.parse(JSON.stringify(item.profile.definition));
        custom[item.profile.key] = item.profile.definition;
        made.push(item.profile.key);
      }
    }
    if (made.length) { try { localStorage.setItem("lx-custom-fixtures", JSON.stringify(custom)); } catch (_) {} }
    const state = S();
    for (const item of d.change) Object.assign(item.was, { name: item.profile.key, uni: item.universe, addr: item.channel });
    for (const item of d.add) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      state.fixtures.push({ id, name: item.profile.key, uni: item.universe, addr: item.channel, fixtureNumber: item.id });
      state.fixtureStates?.set(id, typeof window.createFixtureState === "function" ? window.createFixtureState({}) : {});
    }
    if (unpatchMissing && d.missing.length) {
      const ids = d.missing.map(f => f.id);
      if (window.LXPatch?.unpatch) window.LXPatch.unpatch(ids, { quiet: true });
      else state.fixtures = state.fixtures.filter(f => !ids.includes(f.id));
    }
    state.fixtures.sort((a, b) => Number(a?.fixtureNumber) - Number(b?.fixtureNumber));
    window.renderFixtures?.();
    window.updateControlVisibility?.();
    window.updateDMX?.();
    window.sendToVisualizer?.();
    window.LXPatch?.refresh?.(true);
    lastPatch = JSON.stringify(patchList()); // already matches Capture: nothing to send back
    return made;
  }

  const sayCount = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function showPreview(m) {
    const host = $("citpPreview");
    if (!host) return;
    if (m.error) { preview = null; host.innerHTML = `<div class="citp-note warn">${esc(m.error)} — tick “Link with a visualiser” and open Capture first.</div>`; return; }
    const d = diff(m.fixtures || []);
    preview = { from: m.from, fixtures: m.fixtures, diff: d };
    const row = (item, what) => `<li><b>${item.id}</b> ${esc(item.make && !/^generic$/i.test(item.make) ? item.make + " " : "")}${esc(item.name)} → ${item.universe}/${item.channel} <span>${what}${item.profile.made ? " · new profile, " + item.count + " channels" : ""}</span></li>`;
    const list = [...d.add.map(i => row(i, "add")), ...d.change.map(i => row(i, `was ${i.was.uni}/${i.was.addr}${i.was.name !== i.profile.key ? " · " + esc(i.was.name) : ""}`))];
    host.innerHTML = !m.fixtures?.length ? `<div class="citp-note">${esc(m.from)} has no lights patched.</div>`
      : `<div class="citp-note"><b>${esc(m.from)}</b> has ${sayCount(m.fixtures.length, "light")}: ${sayCount(d.add.length, "to add")}, ${sayCount(d.change.length, "to change")}, ${d.same.length} already the same${d.missing.length ? `, and Light Spark has ${sayCount(d.missing.length, "light")} Capture doesn't` : ""}.</div>`
        + (list.length ? `<ul class="citp-diff">${list.join("")}</ul>` : "")
        + (d.missing.length ? `<label class="citp-row"><input type="checkbox" id="citpUnpatchMissing"> Also unpatch the ${sayCount(d.missing.length, "light")} Capture doesn't have (${d.missing.slice(0, 8).map(f => "#" + numberOf(f)).join(", ")}${d.missing.length > 8 ? "…" : ""})</label>` : "")
        + `<div class="action-row"><button type="button" class="btn-primary" data-citp="apply"${list.length || d.missing.length ? "" : " disabled"}>Use Capture's patch</button><button type="button" class="btn-secondary" data-citp="cancel">Cancel</button></div>`;
  }

  function usePreview() {
    if (!preview) return;
    const unpatchMissing = Boolean($("citpUnpatchMissing")?.checked);
    const d = preview.diff;
    const made = apply(d, { unpatchMissing });
    window.log?.(`Patch from ${preview.from}: ${sayCount(d.add.length, "light")} added, ${d.change.length} changed${unpatchMissing ? `, ${d.missing.length} unpatched` : ""}${made.length ? ` · new profile${made.length === 1 ? "" : "s"}: ${made.join(", ")} (give the channels jobs in Patch → Fixture Editor)` : ""}`, "ok");
    const from = preview.from;
    preview = null;
    $("citpPreview").innerHTML = `<div class="citp-note">Done — Light Spark's patch now matches ${esc(from || "Capture")}.</div>`;
  }

  // "Capture → Light Spark": Capture's changes are used as they come.
  function follow(m) {
    const d = diff(m.fixtures || []);
    d.missing = m.complete ? d.missing : [];
    if (m.removed?.length) {
      const gone = new Set(m.removed.map(Number));
      d.missing = [...d.missing, ...(S().fixtures || []).filter(f => gone.has(numberOf(f)))];
    }
    if (!d.add.length && !d.change.length && !d.missing.length) return;
    const made = apply(d, { unpatchMissing: true });
    window.log?.(`${m.from} patch: ${sayCount(d.add.length, "light")} added, ${d.change.length} changed, ${d.missing.length} unpatched${made.length ? ` · new profile${made.length === 1 ? "" : "s"}: ${made.join(", ")}` : ""}`, "ok");
  }

  // Lights clicked in the visualiser are selected here.
  function select(numbers, from) {
    const byNumber = new Map((S().fixtures || []).map(f => [numberOf(f), f.id]));
    const ids = (numbers || []).map(n => byNumber.get(Number(n))).filter(id => id != null);
    const state = S();
    state.selected = new Set(ids);
    state.selectedFixtureId = ids[ids.length - 1] ?? null;
    lastSelection = JSON.stringify(selectedNumbers());
    fromPeer = true;
    if (window.syncFixtureListSelectionClasses) window.syncFixtureListSelectionClasses();
    else window.renderFixtures?.();
    window.updateControlVisibility?.();
    try { if (typeof updateControlsForSelection === "function") updateControlsForSelection(); } catch (_) {}
    const el = $("citpLast");
    if (el) el.textContent = ids.length ? `${from} selected ${ids.length} light${ids.length === 1 ? "" : "s"}` : `${from} cleared the selection`;
  }

  // ------------------------------------------------------------------- panel

  function render() {
    const host = $("citpBody");
    if (!host) return;
    const peers = status?.peers || [];
    const on = config.enabled;
    host.querySelector("[data-c=enabled]").checked = on;
    ["selection", "levels"].forEach(k => { host.querySelector(`[data-c=${k}]`).checked = Boolean(config[k]); });
    host.querySelector("[data-c=patchMode]").value = config.patchMode;
    const linked = peers.some(p => p.connected);
    host.querySelector("[data-citp=get]").disabled = !on || !linked;
    const list = $("citpPeers");
    if (!socket || socket.readyState !== WebSocket.OPEN) list.innerHTML = `<div class="citp-note">The CITP service isn't running — restart Light Spark.</div>`;
    else if (!on) list.innerHTML = `<div class="citp-note">Off. Tick “Link with a visualiser” to look for Capture.</div>`;
    else if (status?.error) list.innerHTML = `<div class="citp-note warn">⚠ ${esc(status.error)}</div>`;
    else if (!peers.length) list.innerHTML = `<div class="citp-note">Looking for a visualiser… Open Capture on this computer or the same network. In Capture: Universes tab → Console links, pick Light Spark.</div>`;
    else list.innerHTML = peers.map(p => `<div class="citp-peer"><span class="dot ${p.connected ? "on" : ""}"></span><div><b>${esc(p.name || "Visualiser")}</b><span>${esc(p.type || "")} · ${esc(p.ip)} · ${p.connected ? `linked — ${status.patched} light${status.patched === 1 ? "" : "s"} shared` : "found, connecting…"}</span></div></div>`).join("");
  }

  function install() {
    if ($("citpPanel")) return true;
    const outputs = $("multiOutputPanel");
    if (!outputs) return false;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "citpPanel";
    panel.dataset.prefsTab = "outputs";
    panel.innerHTML = `<div class="panel-header"><div><span class="eyebrow">CITP</span> Visualiser link</div><span class="panel-meta">CAPTURE</span></div><div class="panel-body" id="citpBody">
      <p class="citp-note">CITP lets Light Spark and a visualiser such as Capture share what they know: the lights you patch here appear in Capture at the right addresses, and selecting lights in one selects them in the other. The light levels still go by Art-Net or sACN (the outputs above) unless you tick “Levels too”.</p>
      <label class="citp-row"><input type="checkbox" data-c="enabled"> <b>Link with a visualiser</b></label>
      <label class="citp-row">Patch <select data-c="patchMode"><option value="send">Light Spark → Capture (Light Spark's patch counts)</option><option value="receive">Capture → Light Spark (Capture's patch counts)</option><option value="off">Don't share the patch</option></select></label>
      <div class="action-row" style="margin:0 0 8px"><button type="button" class="btn-secondary" data-citp="get">⇩ Get Capture's patch…</button></div>
      <div id="citpPreview"></div>
      <label class="citp-row"><input type="checkbox" data-c="selection"> Selection — select together</label>
      <label class="citp-row"><input type="checkbox" data-c="levels"> Levels too — send the DMX over CITP as well (only if the visualiser takes it)</label>
      <div id="citpPeers" class="citp-peers"></div><div id="citpLast" class="citp-note"></div>
      <p class="citp-note">Made the patch in Capture? Pick “Capture → Light Spark” before linking, or Light Spark's patch is sent first and Capture's will match it. Levels lag more over CITP than sACN, so leave “Levels too” off when sACN is on.</p></div>`;
    outputs.after(panel);
    if (!$("citpStyles")) {
      const st = document.createElement("style");
      st.id = "citpStyles";
      st.textContent = `.citp-diff{max-height:220px;overflow:auto;margin:0 0 10px;padding:0 0 0 2px;list-style:none;font-size:11.5px;color:#c6d0ce}.citp-diff li{padding:3px 0;border-bottom:1px solid #1c262b}.citp-diff b{display:inline-block;min-width:34px;color:#54f2c8}.citp-diff span{color:#7d8987}.citp-row select{margin-left:6px;min-width:0;flex:1}.citp-note{font-size:11px;line-height:1.55;color:#7d8987;margin:0 0 10px}.citp-note.warn{color:#f2b84b}.citp-row{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;color:#c6d0ce;cursor:pointer}.citp-peers{display:grid;gap:6px;margin:6px 0 8px}.citp-peer{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26343a;border-radius:8px;background:#0d1418}.citp-peer b{display:block;font-size:12px;color:#edf4f2}.citp-peer span{font-size:11px;color:#7d8987}.citp-peer .dot{width:9px;height:9px;border-radius:50%;background:#3a4549;flex:0 0 auto}.citp-peer .dot.on{background:#54f2c8;box-shadow:0 0 8px rgba(84,242,200,.6)}`;
      document.head.appendChild(st);
    }
    panel.addEventListener("click", e => {
      const a = e.target.closest("[data-citp]")?.dataset.citp;
      if (a === "get") { $("citpPreview").innerHTML = `<div class="citp-note">Asking Capture for its patch…</div>`; send({ type: "CITP_REQUEST_PATCH" }); }
      if (a === "apply") usePreview();
      if (a === "cancel") { preview = null; $("citpPreview").innerHTML = ""; }
    });
    panel.addEventListener("change", e => {
      const key = e.target.dataset.c;
      if (!key) return;
      config[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      save();
      lastPatch = lastSelection = "";
      send({ type: "CITP_CONFIG", config });
      tick();
      render();
    });
    render();
    return true;
  }

  function boot(tries = 0) {
    if (!install() && tries < 100) return setTimeout(() => boot(tries + 1), 200);
    connect();
    setInterval(tick, 100);
    setInterval(levelTick, 40);
  }

  window.LXCitp = { diff, profileFor, status: () => status, config: () => ({ ...config }), set: next => { config = { ...config, ...next }; save(); lastPatch = lastSelection = ""; send({ type: "CITP_CONFIG", config }); render(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
  else boot();
})();
