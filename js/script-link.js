"use strict";

/*
 * Script (Windows → Script, or "script" on the command line): the show's script from QLab
 * Connect, with Light Spark's cues on it.
 *
 * Mark the cues once, in QLab Connect's Script page (a QLab cue named "LX 5", or "LX 5"
 * written in the script). Light Spark reads them (main process: script-link.js) and:
 *   - matches LX 5 to its own cue 5
 *   - fills each cue's GO note with where it goes ("p.12 · ANNA: “…build a snowman?”"),
 *     unless you've written your own
 *   - shows the script with every cue on its line, the live cue in teal and the next one in
 *     amber (its word highlighted), following the show as it goes
 *   - lists cues in the script that Light Spark doesn't have, and the other way round
 */
(function () {
  if (window.LXScript) return;
  const api = window.LXScriptLink;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(`📜 ${m}`, t);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) {} return null; };

  let link = { linked: false, url: "", departmentName: "" };
  let data = null;          // { version, title, lines, cues }
  let error = "";
  let host = null;          // the window's body while it's open
  let rendered = "";        // which version / cues the script view was drawn for
  let timer = null;
  let follow = store("lxScriptFollow") !== "0";
  let fillNotes = store("lxScriptGoNotes") !== "0";

  // ------------------------------------------------------------ matching

  const num = v => { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; };
  const goCues = () => (data?.cues || []).filter(c => !c.standby && (!c.playback || c.playback === "1"));

  // The script's GO for each Light Spark cue number (the first, if marked twice).
  function byNumber() {
    const map = new Map();
    for (const c of goCues()) { const n = num(c.cue); if (n != null && !map.has(n)) map.set(n, c); }
    return map;
  }

  const clip = (text, n = 70) => { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  // Is the cue written on a line of its own ("LX 21"), so the line before it is what matters?
  const ownLine = c => !c.onLine || (c.onLine.length < 30 && c.onLine.toUpperCase().includes(String(c.label || "").toUpperCase()));

  function goNoteFor(c) {
    const page = c.page ? `p.${c.page} · ` : "";
    if (c.word) return `${page}on “${c.word}” — ${c.onSpeaker ? `${c.onSpeaker}: ` : ""}${clip(c.onLine, 60)}`;
    if (ownLine(c)) return c.said ? `${page}${c.speaker ? `${c.speaker}: ` : ""}“${clip(c.said)}”` : `${page}${clip(c.onLine)}`;
    return `${page}${c.onSpeaker ? `${c.onSpeaker}: ` : ""}“${clip(c.onLine)}”`;
  }

  // GO notes from the script, on cues whose note is empty or came from the script before.
  function applyNotes() {
    if (!data || !fillNotes) return 0;
    const map = byNumber();
    let changed = 0;
    (S().cues || []).forEach(cue => {
      if (!cue) return;
      const mark = map.get(num(cue.number));
      // A Show Starter placeholder ("Intro", "Last note") isn't yours: the script replaces it.
      const placeholder = cue.starter && starterNotes().has(cue.goNote);
      const mine = cue.goNote && cue.goNote !== cue.goNoteFromScript && !placeholder;
      if (mine) return;
      const next = mark ? goNoteFor(mark) : "";
      if (next && cue.goNote !== next) { cue.goNote = next; cue.goNoteFromScript = next; changed++; }
      if (!next && cue.goNoteFromScript) { delete cue.goNote; delete cue.goNoteFromScript; changed++; }
    });
    if (changed) { window.renderCues?.(); window.LXCueList?.refresh?.(); }
    return changed;
  }

  let starterNoteSet = null;
  function starterNotes() {
    if (!starterNoteSet) {
      starterNoteSet = new Set(["Scene starts", "Intro", "Build", "Last chorus", "Last note"]);
      for (const [, cues] of window.LXShowStarter?.FROZEN || []) for (const c of cues) if (c[1]) starterNoteSet.add(c[1]);
    }
    return starterNoteSet;
  }

  // What doesn't line up: script cues Light Spark doesn't have, and the other way round.
  function differences() {
    const map = byNumber();
    const mine = new Set((S().cues || []).filter(Boolean).map(c => num(c.number)));
    const missing = [...map.keys()].filter(n => !mine.has(n)).sort((a, b) => a - b);
    const extra = [...mine].filter(n => n != null && !map.has(n)).sort((a, b) => a - b);
    return { missing, extra };
  }

  // ------------------------------------------------------------ fetching

  async function poll() {
    if (!api) return;
    const result = await api.fetch(data ? data.version : undefined);
    if (result?.error) { if (error !== result.error) { error = result.error; render(); } return; }
    if (result?.notSetUp) { link.linked = false; render(); return; }
    const wasError = error;
    error = "";
    if (!result?.unchanged) {
      const first = !data;
      data = result;
      if (first) say(`Script linked: ${data.title || "the script"} — ${goCues().length} lighting cue${goCues().length === 1 ? "" : "s"}`);
    }
    applyNotes();
    if (!result?.unchanged || wasError) render(); else highlight();
  }

  function schedule() {
    clearInterval(timer);
    if (!link.linked) return;
    timer = setInterval(poll, host?.isConnected ? 4000 : 12000);
  }

  async function start() {
    if (!api) return;
    link = await api.info();
    if (link.linked) { await poll(); }
    schedule();
  }

  // ------------------------------------------------------------ the window

  function build(el) {
    host = el;
    rendered = "";
    render();
    schedule();
    if (link.linked) poll();
    el.addEventListener("keydown", e => e.stopPropagation());
  }

  function render() {
    if (!host?.isConnected) { host = null; return; }
    if (!api) { host.innerHTML = `<div class="sc-empty">The script link needs the Light Spark app (not a browser).</div>`; return; }
    if (!link.linked) return renderSetup();
    const { missing, extra } = data ? differences() : { missing: [], extra: [] };
    const key = JSON.stringify([data?.version, error, (S().cues || []).map(c => c && c.number)]);
    if (key === rendered && host.querySelector(".sc-lines")) return highlight();
    rendered = key;
    host.innerHTML = `
      <div class="sc">
        <div class="sc-top">
          <div class="sc-title"><b>${esc(data?.title || "Script")}</b><span>${esc(link.departmentName || "")} · ${esc((link.url || "").replace(/^https?:\/\//, ""))}</span></div>
          <label><input type="checkbox" data-sc="follow"${follow ? " checked" : ""}> Follow</label>
          <label title="Write where each cue goes into its GO note (not if you've written your own)"><input type="checkbox" data-sc="notes"${fillNotes ? " checked" : ""}> GO notes</label>
          <button type="button" class="btn-secondary" data-sc="refresh">↻</button>
          <button type="button" class="btn-secondary" data-sc="unlink">Unlink</button>
        </div>
        ${error ? `<div class="sc-warn">⚠ ${esc(error)}</div>` : ""}
        ${data ? `<div class="sc-sum">${goCues().length} lighting cue${goCues().length === 1 ? "" : "s"} in the script
          ${missing.length ? ` · <span class="sc-bad">not in Light Spark: ${missing.slice(0, 14).join(", ")}${missing.length > 14 ? "…" : ""}</span>` : ""}
          ${extra.length ? ` · <span class="sc-dim">Light Spark cues not in the script: ${extra.slice(0, 14).join(", ")}${extra.length > 14 ? "…" : ""}</span>` : ""}
          ${!missing.length && !extra.length && goCues().length ? ` · <span class="sc-ok">every cue matches</span>` : ""}</div>` : ""}
        <div class="sc-lines">${data ? scriptHtml() : `<div class="sc-empty">Loading the script…</div>`}</div>
      </div>`;
    host.querySelector('[data-sc="follow"]').onchange = e => { follow = e.target.checked; store("lxScriptFollow", follow ? "1" : "0"); if (follow) highlight(true); };
    host.querySelector('[data-sc="notes"]').onchange = e => { fillNotes = e.target.checked; store("lxScriptGoNotes", fillNotes ? "1" : "0"); if (fillNotes) applyNotes(); else clearNotes(); };
    host.querySelector('[data-sc="refresh"]').onclick = () => { data = null; rendered = ""; poll(); };
    host.querySelector('[data-sc="unlink"]').onclick = async () => { if (!confirm("Unlink the script? GO notes it wrote stay.")) return; link = await api.forget(); data = null; render(); schedule(); };
    host.querySelector(".sc-lines").addEventListener("click", e => {
      const badge = e.target.closest("[data-cue]");
      if (!badge) return;
      const i = window.cueIndexOf?.(badge.dataset.cue);
      if (i == null || i < 0) return say(`Light Spark has no cue ${badge.dataset.cue} yet — record it`, "warn");
      window.LXCueList?.setNext?.(i);
    });
    highlight(true);
  }

  function clearNotes() {
    let n = 0;
    (S().cues || []).forEach(cue => { if (cue?.goNoteFromScript && cue.goNote === cue.goNoteFromScript) { delete cue.goNote; n++; } if (cue) delete cue.goNoteFromScript; });
    if (n) { window.renderCues?.(); window.LXCueList?.refresh?.(); say(`Took the script's GO notes off ${n} cue${n === 1 ? "" : "s"}`); }
  }

  // The script, line by line, with each cue as a badge on its line (and its word marked).
  function scriptHtml() {
    const lines = data.lines || [];
    if (!lines.length) return `<div class="sc-empty">QLab Connect has no script yet — import it on its Script page.</div>`;
    const atLine = new Map();
    for (const c of data.cues || []) { if (!atLine.has(c.line)) atLine.set(c.line, []); atLine.get(c.line).push(c); }
    const mine = new Set((S().cues || []).filter(Boolean).map(c => num(c.number)));
    return lines.map((raw, i) => {
      const text = String(raw);
      const page = text.trim().match(/^— Page (.+) —$/);
      if (page) return `<div class="sc-page" data-line="${i}">Page ${esc(page[1])}</div>`;
      let html = esc(text) || "&nbsp;";
      const cues = atLine.get(i) || [];
      const go = cues.find(c => !c.standby && c.word);
      if (go) {
        // The cue's word: its n-th time in the line.
        let count = -1;
        html = esc(text).replace(new RegExp(`\\b${go.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), m => (++count === go.wordAt ? `<mark data-word="${esc(go.cue)}">${m}</mark>` : m));
      }
      const badges = cues.map(c => `<button type="button" class="sc-cue${c.standby ? " sb" : ""}${mine.has(num(c.cue)) ? "" : " missing"}" data-cue="${esc(c.cue)}" title="${esc(c.standby ? `Standby ${c.label}` : `${c.label}${c.name ? ` — ${c.name}` : ""}${mine.has(num(c.cue)) ? " · click: GO plays it next" : " · not in Light Spark yet"}`)}">${c.standby ? "SB " : ""}${esc(c.label)}</button>`).join("");
      const speaker = /^[A-Z][A-Z .'’-]{1,30}$/.test(text.trim()) && !/^(LX|SQ|FS|FLY|VID)\s*\d/.test(text.trim());
      const direction = /^\s*[([]/.test(text);
      return `<div class="sc-line${speaker ? " who" : ""}${direction ? " dir" : ""}${cues.some(c => !c.standby) ? " has" : ""}" data-line="${i}">${badges ? `<span class="sc-badges">${badges}</span>` : ""}<span class="sc-text">${html}</span></div>`;
    }).join("");
  }

  // Live cue in teal, next in amber; scroll to the next one when following.
  let lastNext = null;
  function highlight(force = false) {
    if (!host?.isConnected || !data) return;
    const box = host.querySelector(".sc-lines");
    if (!box) return;
    const s = S();
    const label = i => (i >= 0 && s.cues?.[i] ? num(s.cues[i].number) : null);
    const live = label(s.currentCue);
    let nextIndex = window.LXCueList?.next?.();
    if (!(nextIndex >= 0)) nextIndex = -1;
    const next = label(nextIndex);
    box.querySelectorAll(".sc-cue").forEach(b => {
      const n = num(b.dataset.cue);
      b.classList.toggle("live", n != null && n === live && !b.classList.contains("sb"));
      b.classList.toggle("next", n != null && n === next && !b.classList.contains("sb"));
    });
    box.querySelectorAll("mark[data-word]").forEach(m => { const n = num(m.dataset.word); m.classList.toggle("next", n === next); m.classList.toggle("live", n === live); });
    box.querySelectorAll(".sc-line.at-live, .sc-line.at-next").forEach(l => l.classList.remove("at-live", "at-next"));
    const lineOf = n => box.querySelector(`.sc-cue:not(.sb)[data-cue="${CSS.escape(String(data.cues.find(c => !c.standby && num(c.cue) === n)?.cue ?? ""))}"]`)?.closest(".sc-line");
    const liveLine = live != null ? lineOf(live) : null, nextLine = next != null ? lineOf(next) : null;
    liveLine?.classList.add("at-live");
    nextLine?.classList.add("at-next");
    if (follow && (force || next !== lastNext)) (nextLine || liveLine)?.scrollIntoView({ block: "center", behavior: force ? "auto" : "smooth" });
    lastNext = next;
  }

  // Linking: QLab Connect's address, a department, its password.
  async function renderSetup() {
    host.innerHTML = `
      <div class="sc sc-setup">
        <h4>Link the script from QLab Connect</h4>
        <p>Mark your cues once in QLab Connect's Script page (a QLab cue named <b>LX 5</b>, or <b>LX 5</b> written in the script). Light Spark matches them to its own cues, shows the script as the show goes, and writes where each cue goes into its GO note.</p>
        <label>QLab Connect's address<input data-sc="url" placeholder="192.168.1.20 or qlab-mac.local" value="${esc((link.url || "").replace(/^http:\/\//, "").replace(/:3030$/, ""))}"></label>
        <div class="sc-row"><button type="button" class="btn-secondary" data-sc="find">Find departments</button></div>
        <label>Log in as<select data-sc="dept"><option value="">— find departments first —</option></select></label>
        <label>Password<input data-sc="pass" type="password" placeholder="That department's password"></label>
        <div class="sc-row"><button type="button" class="btn-primary" data-sc="link">Link script</button><span class="sc-msg" data-sc="msg">${esc(error)}</span></div>
      </div>`;
    const q = k => host.querySelector(`[data-sc="${k}"]`);
    const msg = (t, bad = true) => { q("msg").textContent = t; q("msg").classList.toggle("bad", bad); };
    const find = async () => {
      msg("Looking…", false);
      const r = await api.departments(q("url").value);
      if (r.error) return msg(r.error);
      q("dept").innerHTML = r.departments.map(d => `<option value="${esc(d.id)}"${d.id === link.departmentId || /light|lx/i.test(d.name) ? " selected" : ""}>${esc(d.name)}</option>`).join("") || `<option value="">No departments have a password yet</option>`;
      msg(r.departments.length ? `Found ${r.departments.length} department${r.departments.length === 1 ? "" : "s"}` : "Give a department a password in QLab Connect → Admin", !r.departments.length);
    };
    q("find").onclick = find;
    q("link").onclick = async () => {
      if (!q("dept").value) await find();
      if (!q("dept").value) return;
      msg("Linking…", false);
      const r = await api.login({ url: q("url").value, departmentId: q("dept").value, password: q("pass").value });
      if (r.error) return msg(r.error);
      link = r; error = ""; data = null; rendered = "";
      await poll();
      render();
      schedule();
    };
    if (link.url) find();
  }

  // ------------------------------------------------------------ plumbing

  function command(c) {
    if (c === "script" || c === "show script" || c === "script window") { window.LXWindows?.open("script"); return true; }
    if (c === "script refresh") { data = null; rendered = ""; poll(); return true; }
    if (c === "script notes off") { fillNotes = false; store("lxScriptGoNotes", "0"); clearNotes(); return true; }
    if (c === "script notes on") { fillNotes = true; store("lxScriptGoNotes", "1"); say(`${applyNotes()} GO notes from the script`); return true; }
    return false;
  }

  function styles() {
    if (document.getElementById("lxScriptStyles")) return;
    const st = document.createElement("style");
    st.id = "lxScriptStyles";
    st.textContent = `.sc{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;color:#c6d0ce}
.sc-top{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border,#1d262b);flex-wrap:wrap}
.sc-top label{display:flex;align-items:center;gap:4px;white-space:nowrap}
.sc-title{flex:1;min-width:120px;display:flex;flex-direction:column}.sc-title b{font-size:13px;color:#e3ebe9}.sc-title span{color:#6f7d7b;font-size:11px}
.sc-sum{padding:6px 10px;color:#9fb0ac;border-bottom:1px solid var(--border,#1d262b)}
.sc-warn{padding:6px 10px;color:#ffb4a4;background:rgba(120,40,30,.18)}
.sc-bad{color:#ffb4a4}.sc-dim{color:#7d8987}.sc-ok{color:#7fdcb2}
.sc-lines{flex:1;min-height:0;overflow:auto;padding:10px 14px 40vh;font:13px/1.55 Georgia,"Times New Roman",serif;color:#cfd8d6;user-select:text}
.sc-line{position:relative;padding:1px 6px;border-radius:4px;white-space:pre-wrap}
.sc-line.who{font:700 11px/2 system-ui;letter-spacing:.06em;color:#9fb0ac;margin-top:6px}
.sc-line.dir{font-style:italic;color:#8c9a97}
.sc-line.at-next{background:rgba(255,181,71,.12);box-shadow:inset 3px 0 #ffb547}
.sc-line.at-live{background:rgba(25,214,163,.12);box-shadow:inset 3px 0 #19d6a3}
.sc-page{margin:14px 0 6px;font:700 10px system-ui;letter-spacing:.12em;text-transform:uppercase;color:#5d6a68;border-bottom:1px solid #1d262b;padding-bottom:2px}
.sc-badges{float:right;display:flex;gap:4px;margin-left:8px}
.sc-cue{font:800 10px system-ui;padding:2px 7px;border-radius:999px;border:1px solid #2c5b4e;background:#10261f;color:#7fdcb2;cursor:pointer}
.sc-cue.sb{border-color:#2a3338;background:transparent;color:#6f7d7b}
.sc-cue.missing{border-color:#5a2a26;background:#2a1412;color:#ffb4a4}
.sc-cue.next{background:#ffb547;border-color:#ffb547;color:#1b1200}
.sc-cue.live{background:#19d6a3;border-color:#19d6a3;color:#03140f}
.sc-lines mark{background:rgba(127,220,178,.18);color:inherit;border-radius:3px;padding:0 2px}
.sc-lines mark.next{background:#ffb547;color:#1b1200}.sc-lines mark.live{background:#19d6a3;color:#03140f}
.sc-empty{padding:24px;color:#7d8987;font:13px system-ui}
.sc-setup{padding:14px;gap:10px;overflow:auto}.sc-setup h4{margin:0;font-size:14px;color:#e3ebe9}.sc-setup p{margin:0;color:#8c9a97;line-height:1.5}
.sc-setup label{display:flex;flex-direction:column;gap:4px;color:#8c9a97;font-size:11px}
.sc-setup input,.sc-setup select{height:30px;padding:0 9px;background:#0d1418;border:1px solid var(--border,#1d262b);border-radius:6px;color:#e3ebe9;font-size:12px}
.sc-row{display:flex;align-items:center;gap:10px}.sc-msg{color:#7fdcb2}.sc-msg.bad{color:#ffb4a4}`;
    document.head.appendChild(st);
  }

  function install(tries = 0) {
    if (!window.LXWindows?.register) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    styles();
    if (!window.LXWindows.list().includes("script")) window.LXWindows.register({ id: "script", title: "Script", build, w: 620, h: 640 });
    start();
    // The live / next cue moved: follow it.
    setInterval(() => { if (host?.isConnected && data) highlight(); }, 500);
    window.addEventListener("lx-show-file", () => { rendered = ""; applyNotes(); render(); });
  }

  window.LXScript = { command, open: () => window.LXWindows?.open("script"), poll, applyNotes, goNoteFor, differences, data: () => data };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
