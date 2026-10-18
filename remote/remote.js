"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} }
  };

  // The iOS app hands over the PIN in the URL fragment (never sent to the server).
  const hashPin = new URLSearchParams(location.hash.slice(1)).get('pin');
  if (hashPin) { store.set('lx.pin', hashPin); history.replaceState(null, '', location.pathname); }

  let ws = null, token = null, state = null, retry = 0, wasOpen = false;
  const dragging = new Set(); // sliders the user is touching — don't overwrite them from state

  // ---- auth / connection ----------------------------------------------
  async function authenticate(pin) {
    const res = await fetch('/auth', { method: 'POST', body: JSON.stringify({ pin }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Could not connect'), { status: res.status });
    return data.token;
  }
  function showLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    $('loginMsg').textContent = msg || 'Enter the PIN shown on the console.';
  }
  async function connect() {
    const pin = store.get('lx.pin');
    if (!pin) return showLogin();
    try { token = await authenticate(pin); }
    catch (err) {
      if (err.status === 401 || err.status === 429) { store.set('lx.pin', null); return showLogin(err.message); }
      console.error('auth failed', err);
      return scheduleReconnect();
    }
    openSocket();
  }
  function openSocket() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?token=${token}`);
    ws.onopen = () => { retry = 0; wasOpen = true; $('login').hidden = true; $('app').hidden = false; $('status').classList.add('ok'); send({ type: 'hello' }); };
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'state') { state = m; render(); } } catch (_) {} };
    ws.onclose = () => { $('status').classList.remove('ok'); scheduleReconnect(); };
    ws.onerror = () => ws.close();
  }
  function scheduleReconnect() {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * retry);
  }
  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (!ws || ws.readyState > 1)) connect(); });

  $('pinGo').onclick = () => { store.set('lx.pin', $('pin').value.trim()); connect(); };
  $('pin').onkeydown = e => { if (e.key === 'Enter') $('pinGo').click(); };

  // ---- helpers --------------------------------------------------------
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const buzz = () => { try { navigator.vibrate?.(10); } catch (_) {} };
  function tap(node, fn) { node.addEventListener('click', () => { buzz(); fn(); }); return node; }
  function hsl(h, s) { return `hsl(${h} ${s}% ${50 + (100 - s) / 4}%)`; }
  let toastTimer = null, lastLogId = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // Throttled slider: sends while dragging, at most every 50ms, plus a final value.
  function slider(id, valId, type, extra) {
    const input = $(id); let last = 0, timer = null;
    const push = () => { last = Date.now(); send({ type, value: Number(input.value), ...(extra ? extra() : {}) }); };
    input.addEventListener('input', () => {
      $(valId).textContent = input.value;
      const wait = 50 - (Date.now() - last);
      clearTimeout(timer);
      if (wait <= 0) push(); else timer = setTimeout(push, wait);
    });
    const start = () => dragging.add(id), end = () => setTimeout(() => dragging.delete(id), 400);
    input.addEventListener('touchstart', start, { passive: true });
    input.addEventListener('pointerdown', start);
    ['touchend', 'touchcancel', 'pointerup'].forEach(ev => input.addEventListener(ev, end));
    return input;
  }
  slider('intensity', 'intVal', 'intensity');
  slider('strobe', 'strobeVal', 'strobe');
  const colourMsg = () => ({ type: 'colour', hue: Number($('hue').value), sat: Number($('sat').value) });
  for (const id of ['hue', 'sat']) {
    const input = $(id); let last = 0;
    input.addEventListener('input', () => {
      $(id + 'Val').textContent = input.value;
      if (Date.now() - last > 50) { last = Date.now(); send(colourMsg()); }
    });
    input.addEventListener('change', () => send(colourMsg()));
    input.addEventListener('pointerdown', () => dragging.add(id));
    ['pointerup', 'touchend', 'touchcancel'].forEach(ev => input.addEventListener(ev, () => setTimeout(() => dragging.delete(id), 400)));
  }
  document.querySelectorAll('[data-int]').forEach(b => tap(b, () => send({ type: 'intensity', value: Number(b.dataset.int) })));

  // Inside the iPhone app: show a disconnect button that returns to the console picker.
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.lx;
  if (native) { $('eject').hidden = false; tap($('eject'), () => { store.set('lx.pin', null); native.postMessage('disconnect'); }); }

  tap($('go'), () => send({ type: 'go' }));
  tap($('back'), () => send({ type: 'back' }));
  tap($('blackout'), () => send({ type: 'blackout', on: !(state && state.blackout) }));
  tap($('selAll'), () => send({ type: 'select', mode: 'all' }));
  tap($('selNone'), () => send({ type: 'select', mode: 'none' }));
  tap($('stopChase'), () => send({ type: 'stopChase' }));
  $('cmdForm').onsubmit = e => { e.preventDefault(); const t = $('cmdText').value.trim(); if (t) { send({ type: 'cmd', text: t }); $('cmdText').value = ''; } };
  $('recForm').onsubmit = e => {
    e.preventDefault();
    const n = parseInt($('recNum').value, 10);
    if (!n) return toast('Enter a cue number');
    send({ type: 'record', number: n, name: $('recName').value });
    $('recName').value = '';
  };

  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    buzz();
  }));

  // ---- rendering ------------------------------------------------------
  const sigs = {}; // rebuild a list only when its content changed
  function fill(id, sig, build) {
    const key = JSON.stringify(sig);
    if (sigs[id] === key) return;
    sigs[id] = key;
    const box = $(id); box.replaceChildren(); build(box);
  }
  function setSlider(id, valId, v) {
    if (dragging.has(id) || v == null) return;
    $(id).value = v; $(valId).textContent = Math.round(v);
  }

  function render() {
    const s = state;
    setSlider('intensity', 'intVal', s.intensity);
    setSlider('strobe', 'strobeVal', s.strobe);
    setSlider('hue', 'hueVal', s.hue);
    setSlider('sat', 'satVal', s.sat);
    $('blackout').classList.toggle('on', s.blackout);
    $('title').textContent = s.mode ? `LX Remote · ${s.mode}` : 'LX Remote';

    const cur = s.cues[s.currentCue];
    $('nowplaying').replaceChildren(document.createTextNode('Now: '), el('b', null, cur ? `${s.currentCue + 1} ${cur.name}` : '—'));

    fill('cues', [s.cues, s.currentCue], box => {
      if (!s.cues.some(Boolean)) box.append(el('div', 'muted', 'No cues recorded yet'));
      s.cues.forEach((q, i) => {
        if (!q) return;
        const b = el('button', 'btn cue' + (i === s.currentCue ? ' cur' : ''));
        b.append(el('span', 'n', String(i + 1)), el('span', 't', q.name), el('small', null, `${(q.fade / 1000).toFixed(1)}s`));
        box.append(tap(b, () => send({ type: 'cue', index: i })));
      });
    });
    fill('groups', s.groups, box => {
      if (!s.groups.length) box.append(el('div', 'muted', 'No groups'));
      s.groups.forEach(g => { const b = el('button', 'btn', g.name); b.append(el('small', null, `${g.count} fixtures`)); box.append(tap(b, () => send({ type: 'group', name: g.name }))); });
    });
    fill('fixtures', s.fixtures, box => {
      if (!s.fixtures.length) box.append(el('div', 'muted', 'No fixtures patched'));
      s.fixtures.forEach(f => { const b = el('button', 'btn' + (f.sel ? ' on' : ''), String(f.num)); b.append(el('small', null, f.name)); box.append(tap(b, () => send({ type: 'select', id: f.id }))); });
    });
    $('selCount').textContent = `${s.fixtures.filter(f => f.sel).length} selected`;
    fill('palettes', s.palettes, box => {
      if (!s.palettes.length) box.append(el('div', 'muted', 'No palettes'));
      s.palettes.forEach(p => box.append(tap(el('button', 'btn', p.name), () => send({ type: 'palette', name: p.name }))));
    });
    fill('chases', [s.chases, s.activeChase], box => {
      if (!s.chases.length) box.append(el('div', 'muted', 'No chases'));
      s.chases.forEach(c => box.append(tap(el('button', 'btn' + (c.i === s.activeChase ? ' on' : ''), c.name), () => send({ type: 'chase', index: c.i }))));
    });
    fill('swatches', s.colours, box => s.colours.forEach(name => {
      const b = el('button', 'sw'); b.setAttribute('aria-label', name); b.dataset.name = name;
      box.append(tap(b, () => send({ type: 'colourName', name })));
    }));
    if (s.log && s.log.id !== lastLogId) {
      if (lastLogId) { toast(s.log.msg); const line = el('div', s.log.type, s.log.msg); $('cmdLog').prepend(line); while ($('cmdLog').children.length > 30) $('cmdLog').lastChild.remove(); }
      lastLogId = s.log.id;
    }
  }
  // Swatch colours come from the palette table the console uses; approximate with hue names.
  const NAME_HSL = { red: [0, 100], green: [120, 100], blue: [240, 100], white: [0, 0], yellow: [60, 100], cyan: [180, 100], magenta: [300, 100], orange: [30, 100], elsa: [210, 70], ice: [195, 60], snow: [200, 20], sky: [220, 50], aurora: [280, 65], castle: [45, 40], kristoff: [30, 60], sven: [25, 70], olaf: [50, 80], forest: [140, 55], night: [260, 45] };
  new MutationObserver(() => document.querySelectorAll('.sw').forEach(b => { const c = NAME_HSL[b.dataset.name]; if (c) b.style.background = hsl(c[0], c[1]); })).observe($('swatches'), { childList: true });

  connect();
})();
