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

  // Light Spark keeps a profile's maker and model either on the profile or
  // in its photometrics (where the built-in Vari-Lite and High End ones have
  // them); the profile's own name is the fallback.
  function metaOf(def, key = "") {
    // "Unknown" isn't a maker or a model; the profile's name says more.
    const known = v => (v && !/^(unknown|n\/?a|none|-)$/i.test(String(v).trim()) ? String(v).trim() : "");
    let maker = known(def?.manufacturer) || known(def?.make) || known(def?.brand) || known(def?.photometrics?.manufacturer);
    if (!maker && /^generic\s/i.test(key)) maker = "Generic";
    let model = known(def?.model) || known(def?.photometrics?.model);
    if (!model) {
      model = String(key).replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (maker && model.toLowerCase().startsWith(maker.toLowerCase() + " ")) model = model.slice(maker.length + 1);
    }
    return { maker, model };
  }

  // Make and model as a visualiser's library knows them: "Robe" + "Robin
  // 600 LEDWash", not "Robe Robin 600 LEDWash (Mode 1)".
  function makeAndName(f) {
    const def = defOf(f);
    const full = String(f?.name || def.name || "Fixture");
    const meta = metaOf(def, full);
    const make = meta.maker || (/^generic\s/i.test(full) ? "Generic" : "");
    let name = meta.model || full;
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

  // Which Light Spark profile a light Capture names should use.
  //   picked   you chose it before for this make, name and channel count
  //   exact    same maker, same model, same channel count
  //   close    same maker, a similar model, same channel count: probably
  //            right, but check it (a Cyberlight CL isn't a Cyberlight)
  //   none     nothing fits: a new blank profile with the right channel
  //            count, whose channels need jobs (Fixture Editor) — or pick one
  const PICKS = "lx-citp-picks";
  const loadPicks = () => { try { return JSON.parse(localStorage.getItem(PICKS) || "{}") || {}; } catch (_) { return {}; } };
  const pickKey = (make, name, count) => `${String(make).toLowerCase()}|${String(name).toLowerCase()}|${count}`;
  const norm = t => String(t || "").toLowerCase().replace(/\s*\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  // "High End Systems", "HES" and "High End" are one maker; so are "Vari-Lite" and "VariLite".
  const makerKey = t => norm(t).replace(/\bvarilite\b/g, "vari lite").replace(/\bhes\b/g, "high end").replace(/\b(systems|lighting|professional|inc|ltd|gmbh|co)\b/g, "").replace(/\s+/g, " ").trim();
  const tokens = t => norm(t).split(" ").filter(Boolean);

  function candidates(make, name, count) {
    const lib = window.FixtureLibrary || {};
    const wantMaker = makerKey(make === "Generic" ? "" : make);
    const want = new Set(tokens(name).filter(t => !wantMaker.split(" ").includes(t) && t !== "generic"));
    return Object.keys(lib).map(key => {
      const def = lib[key] || {}, meta = metaOf(def, key);
      const haveMaker = makerKey(meta.maker) || "";
      const keyText = makerKey(key);
      const makerOk = !wantMaker || (haveMaker ? haveMaker === wantMaker : keyText.startsWith(wantMaker + " "));
      // Maker words aren't part of the model: "Showtec Phantom 130" is the Phantom 130.
      const makerWords = new Set([...haveMaker.split(" "), ...wantMaker.split(" "), "generic"]);
      const have = new Set(tokens(meta.model).filter(t => !makerWords.has(t)));
      const both = [...want].filter(t => have.has(t)).length;
      const sim = want.size || have.size ? both / new Set([...want, ...have]).size : 0;
      const countOk = Number(def.channels) === Number(count);
      return { key, makerOk, sim, countOk, exact: makerOk && sim === 1 && countOk };
    }).filter(c => c.makerOk && c.sim > 0).sort((a, b) => (b.exact - a.exact) || (b.countOk - a.countOk) || (b.sim - a.sim));
  }

  const blankKey = (make, name, count) => `${make && !/^generic$/i.test(make) ? `${make} ` : ""}${name || "Fixture"} (${count}ch, from Capture)`;
  function blankProfile(make, name, count) {
    const key = blankKey(make, name, count);
    return { key, kind: "none", made: !(window.FixtureLibrary || {})[key], definition: { type: count >= 8 ? "moving" : "dimmer", channels: Math.max(1, Number(count) || 1), map: { intensity: 0, dimmer: 0 }, manufacturer: make || "Custom", model: name || key, custom: true, fromCapture: true } };
  }

  function profileFor(make, name, count, override) {
    const lib = window.FixtureLibrary || {};
    const choice = override ?? loadPicks()[pickKey(make, name, count)];
    if (choice === "__blank") return { ...blankProfile(make, name, count), kind: "picked" };
    if (choice && lib[choice]) return { key: choice, kind: "picked", made: false };
    const list = candidates(make, name, count);
    if (list[0]?.exact) return { key: list[0].key, kind: "exact", made: false };
    if (list[0]?.countOk && list[0].sim >= 0.5) return { key: list[0].key, kind: "close", made: false };
    return blankProfile(make, name, count);
  }

  // What using Capture's patch would do: add, change (moved or a different
  // profile) and, if asked, unpatch. overrides: your picks in the preview.
  function diff(fixtures, overrides = {}) {
    const here = new Map((S().fixtures || []).map(f => [numberOf(f), f]));
    const add = [], change = [], same = [];
    for (const c of fixtures) {
      const profile = profileFor(c.make, c.name, c.count, overrides[c.id]);
      const f = here.get(c.id);
      const item = { ...c, profile };
      if (!f) add.push(item);
      else if (Number(f.uni) !== c.universe || Number(f.addr) !== c.channel || f.name !== profile.key) change.push({ ...item, was: f });
      else same.push({ ...item, was: f });
    }
    const theirs = new Set(fixtures.map(c => c.id));
    const missing = [...here.entries()].filter(([n]) => !theirs.has(n)).map(([, f]) => f);
    return { add, change, same, missing };
  }

  function apply(d, { unpatchMissing = false, remember = {} } = {}) {
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
    // Your picks are kept, so the next import (and follow mode) uses them.
    if (Object.keys(remember).length) { try { localStorage.setItem(PICKS, JSON.stringify({ ...loadPicks(), ...remember })); } catch (_) {} }
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
  const capName = c => `${c.make && !/^generic$/i.test(c.make) ? c.make + " " : ""}${c.name}`;
  const KIND = {
    exact: ["ok", "✓ matches"],
    picked: ["ok", "✓ your choice"],
    close: ["warn", "⚠ closest match — check it's the same light and mode"],
    none: ["bad", "⚠ no profile — a blank one would only dim channel 1: pick the right one, or import its GDTF (Patch page)"]
  };

  // One dropdown per kind of light (same make, name and channel count).
  function pickerHtml(c, profile) {
    const lib = window.FixtureLibrary || {};
    const best = candidates(c.make, c.name, c.count).slice(0, 8).map(x => x.key);
    const sameCount = Object.keys(lib).filter(k => Number(lib[k]?.channels) === Number(c.count) && !best.includes(k)).sort();
    const rest = Object.keys(lib).filter(k => !best.includes(k) && !sameCount.includes(k)).sort();
    const opt = k => `<option value="${esc(k)}"${k === profile.key && profile.kind !== "none" ? " selected" : ""}>${esc(k)} · ${lib[k]?.channels ?? "?"}ch</option>`;
    const blank = blankKey(c.make, c.name, c.count);
    return `<select data-pick="${esc(pickKey(c.make, c.name, c.count))}">`
      + (best.length ? `<optgroup label="Best matches">${best.map(opt).join("")}</optgroup>` : "")
      + (sameCount.length ? `<optgroup label="${c.count} channels">${sameCount.map(opt).join("")}</optgroup>` : "")
      + `<optgroup label="New"><option value="__blank"${profile.kind === "none" || profile.key === blank ? " selected" : ""}>New blank profile (${c.count} channels — give them jobs in the Fixture Editor)</option></optgroup>`
      + (rest.length ? `<optgroup label="Other channel counts (won't line up)">${rest.map(opt).join("")}</optgroup>` : "")
      + `</select>`;
  }

  function showPreview(m) {
    const host = $("citpPreview");
    if (!host) return;
    if (m.error) { preview = null; host.innerHTML = `<div class="citp-note warn">${esc(m.error)} — tick “Link with a visualiser” and open Capture first.</div>`; return; }
    preview = { from: m.from, fixtures: m.fixtures || [], overrides: preview?.from === m.from ? preview.overrides || {} : {} };
    renderPreview();
  }

  function renderPreview() {
    const host = $("citpPreview");
    if (!host || !preview) return;
    const keep = $("citpUnpatchMissing")?.checked;
    const d = diff(preview.fixtures, preview.overrides);
    preview.diff = d;
    const all = [...d.add.map(i => ({ ...i, what: "add" })), ...d.change.map(i => ({ ...i, what: "change" })), ...d.same.map(i => ({ ...i, what: "same" }))];
    // One row per kind of light: all the VL3000s get the same profile.
    const kinds = new Map();
    for (const i of all) {
      const k = pickKey(i.make, i.name, i.count);
      if (!kinds.has(k)) kinds.set(k, { ...i, ids: [], adds: 0, changes: 0 });
      const g = kinds.get(k);
      g.ids.push(i.id); if (i.what === "add") g.adds++; if (i.what === "change") g.changes++;
    }
    const rows = [...kinds.values()].map(g => {
      const [cls, text] = KIND[g.profile.kind] || KIND.none;
      const ids = g.ids.sort((a, b) => a - b);
      return `<li class="citp-kind ${cls}"><div><b>${esc(capName(g))}</b> <span>· Capture says ${g.count} channels · #${ids.length > 6 ? `${ids.slice(0, 5).join(", ")}… (${ids.length})` : ids.join(", ")}${g.adds ? ` · ${g.adds} to add` : ""}${g.changes ? ` · ${g.changes} to change` : ""}</span></div><div class="citp-pick">Light Spark profile ${pickerHtml(g, g.profile)}</div><div class="citp-kind-note">${text}</div></li>`;
    });
    const bad = [...kinds.values()].filter(g => g.profile.kind === "none" || g.profile.kind === "close").length;
    const todo = d.add.length + d.change.length;
    host.innerHTML = !preview.fixtures.length ? `<div class="citp-note">${esc(preview.from)} has no lights patched.</div>`
      : `<div class="citp-note"><b>${esc(preview.from)}</b> has ${sayCount(preview.fixtures.length, "light")}: ${d.add.length} to add, ${d.change.length} to change, ${d.same.length} already the same${d.missing.length ? `, and Light Spark has ${sayCount(d.missing.length, "light")} Capture doesn't` : ""}.${bad ? ` <span class="warn">Check the ${sayCount(bad, "kind")} of light marked ⚠ — the wrong profile drives the wrong channels.</span>` : ""}</div>`
        + `<ul class="citp-diff">${rows.join("")}</ul>`
        + (d.missing.length ? `<label class="citp-row"><input type="checkbox" id="citpUnpatchMissing"${keep ? " checked" : ""}> Also unpatch the ${sayCount(d.missing.length, "light")} Capture doesn't have (${d.missing.slice(0, 8).map(f => "#" + numberOf(f)).join(", ")}${d.missing.length > 8 ? "…" : ""})</label>` : "")
        + `<div class="action-row"><button type="button" class="btn-primary" data-citp="apply"${todo || d.missing.length ? "" : " disabled"}>Use Capture's patch</button><button type="button" class="btn-secondary" data-citp="cancel">Cancel</button></div>`;
  }

  function pick(select) {
    if (!preview) return;
    const key = select.dataset.pick;
    for (const c of preview.fixtures) if (pickKey(c.make, c.name, c.count) === key) preview.overrides[c.id] = select.value;
    preview.remember = { ...(preview.remember || {}), [key]: select.value };
    renderPreview();
  }

  function usePreview() {
    if (!preview) return;
    const unpatchMissing = Boolean($("citpUnpatchMissing")?.checked);
    const d = preview.diff || diff(preview.fixtures, preview.overrides);
    const made = apply(d, { unpatchMissing, remember: preview.remember || {} });
    const unsure = [...d.add, ...d.change].filter(i => i.profile.kind === "none" || i.profile.kind === "close").map(i => `#${i.id}`);
    window.log?.(`Patch from ${preview.from}: ${sayCount(d.add.length, "light")} added, ${d.change.length} changed${unpatchMissing ? `, ${d.missing.length} unpatched` : ""}${made.length ? ` · new profile${made.length === 1 ? "" : "s"}: ${made.join(", ")} (give the channels jobs in Patch → Fixture Editor)` : ""}${unsure.length ? ` · check the profile of ${unsure.slice(0, 10).join(", ")}` : ""}`, unsure.length ? "warn" : "ok");
    const from = preview.from;
    preview = null;
    $("citpPreview").innerHTML = `<div class="citp-note">Done — Light Spark's patch now matches ${esc(from || "Capture")}.</div>`;
  }

  // "Capture → Light Spark": Capture's changes are used as they come, with
  // the profiles you picked before; anything unsure is said in the log.
  function follow(m) {
    const d = diff(m.fixtures || []);
    d.missing = m.complete ? d.missing : [];
    if (m.removed?.length) {
      const gone = new Set(m.removed.map(Number));
      d.missing = [...d.missing, ...(S().fixtures || []).filter(f => gone.has(numberOf(f)))];
    }
    if (!d.add.length && !d.change.length && !d.missing.length) return;
    const made = apply(d, { unpatchMissing: true });
    const unsure = [...d.add, ...d.change].filter(i => i.profile.kind === "none" || i.profile.kind === "close");
    window.log?.(`${m.from} patch: ${sayCount(d.add.length, "light")} added, ${d.change.length} changed, ${d.missing.length} unpatched${made.length ? ` · new profile${made.length === 1 ? "" : "s"}: ${made.join(", ")}` : ""}${unsure.length ? ` · ⚠ check the profile of ${[...new Set(unsure.map(capName))].join(", ")} (Get Capture's patch… to pick)` : ""}`, unsure.length ? "warn" : "ok");
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
      st.textContent = `.citp-kind{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;overflow-wrap:anywhere;padding:8px 6px!important;border-left:3px solid #3a4549}.citp-kind.ok{border-left-color:#19d6a3}.citp-kind.warn{border-left-color:#f2b84b}.citp-kind.bad{border-left-color:#ff6b6b}.citp-kind-note{font-size:11px;color:#7d8987}.citp-kind.warn .citp-kind-note{color:#f2b84b}.citp-kind.bad .citp-kind-note{color:#ff8a8a}.citp-pick{display:flex;align-items:center;gap:6px;font-size:11px;color:#7d8987}.citp-pick{flex-wrap:wrap}.citp-pick select{flex:1 1 180px;min-width:0;max-width:100%}.citp-note .warn{color:#f2b84b}.citp-diff{max-height:340px;overflow:auto;margin:0 0 10px;padding:0 0 0 2px;list-style:none;font-size:11.5px;color:#c6d0ce}.citp-diff li{padding:3px 0;border-bottom:1px solid #1c262b}.citp-diff b{display:inline-block;min-width:34px;color:#54f2c8}.citp-diff span{color:#7d8987}.citp-row select{margin-left:6px;min-width:0;flex:1}.citp-note{font-size:11px;line-height:1.55;color:#7d8987;margin:0 0 10px}.citp-note.warn{color:#f2b84b}.citp-row{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;color:#c6d0ce;cursor:pointer}.citp-peers{display:grid;gap:6px;margin:6px 0 8px}.citp-peer{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26343a;border-radius:8px;background:#0d1418}.citp-peer b{display:block;font-size:12px;color:#edf4f2}.citp-peer span{font-size:11px;color:#7d8987}.citp-peer .dot{width:9px;height:9px;border-radius:50%;background:#3a4549;flex:0 0 auto}.citp-peer .dot.on{background:#54f2c8;box-shadow:0 0 8px rgba(84,242,200,.6)}`;
      document.head.appendChild(st);
    }
    panel.addEventListener("click", e => {
      const a = e.target.closest("[data-citp]")?.dataset.citp;
      if (a === "get") { $("citpPreview").innerHTML = `<div class="citp-note">Asking Capture for its patch…</div>`; send({ type: "CITP_REQUEST_PATCH" }); }
      if (a === "apply") usePreview();
      if (a === "cancel") { preview = null; $("citpPreview").innerHTML = ""; }
    });
    panel.addEventListener("change", e => {
      if (e.target.dataset.pick != null) return pick(e.target);
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

  window.LXCitp = { diff, profileFor, candidates, status: () => status, config: () => ({ ...config }), set: next => { config = { ...config, ...next }; save(); lastPatch = lastSelection = ""; send({ type: "CITP_CONFIG", config }); render(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
  else boot();
})();
