"use strict";

/*
 * Run show: one screen for whoever runs the performance. The cue list,
 * the next cue's GO note, a big GO (and Back), where the song is, and the
 * smoke machines' timers — nothing else to knock by accident.
 *
 * ▶ Run show in the top bar, "run show" on the command line, or ⌘K.
 * Esc or "Exit" goes back. The GO key (Space) works as everywhere.
 */
(function () {
  if (window.LXRunShow) return;
  const S = () => window.State || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clock = t => (Number.isFinite(t) ? `${Math.floor(Math.max(0, t) / 60)}:${(Math.max(0, t) % 60).toFixed(1).padStart(4, "0")}` : "—");
  let el = null, timer = null;

  function open() {
    if (el) return;
    el = document.createElement("div");
    el.id = "lxRunShow";
    el.className = "lxrun";
    el.innerHTML = `
      <header class="lxrun-top">
        <b class="lxrun-show"></b>
        <span class="lxrun-mode"></span>
        <span class="lxrun-tempo"></span>
        <span class="lxrun-master"></span>
        <span class="lxrun-grow"></span>
        <button type="button" class="lxrun-black" data-run="blackout">BLACKOUT</button>
        <button type="button" class="btn-secondary lxrun-exit" data-run="exit" title="Back to the full console (Esc)">Exit run show</button>
      </header>
      <section class="lxrun-list"></section>
      <section class="lxrun-side">
        <div class="lxrun-note" hidden></div>
        <div class="lxrun-cues">
          <div><span class="lxrun-tag live">LIVE</span><b data-k="live">—</b></div>
          <div><span class="lxrun-tag next">NEXT</span><b data-k="next">—</b></div>
        </div>
        <div class="lxrun-buttons">
          <button type="button" class="lxrun-back" data-run="back">◀ BACK</button>
          <button type="button" class="lxrun-go" data-run="go">GO</button>
        </div>
        <div class="lxrun-song" hidden>
          <div class="lxrun-song-head"><span>♪ <b data-k="song"></b></span><span data-k="songtime"></span></div>
          <div class="lxrun-bar"><i class="lxrun-bar-fill"></i><span class="lxrun-marks"></span></div>
        </div>
        <div class="lxrun-smoke" hidden></div>
      </section>`;
    document.body.appendChild(el);
    document.body.classList.add("lxrun-on");
    window.LXCueList?.mount?.(el.querySelector(".lxrun-list"));
    el.addEventListener("click", e => {
      const a = e.target.closest("[data-run]")?.dataset.run;
      if (a === "go") window.goNextCue?.();
      else if (a === "back") window.goPreviousCue?.();
      else if (a === "blackout") window.parseCommand?.("blackout");
      else if (a === "exit") close();
      else if (a === "smoke") window.LXAtmos?.reset?.();
    });
    timer = setInterval(render, 100);
    render();
  }

  function close() {
    clearInterval(timer); timer = null;
    el?.remove(); el = null;
    document.body.classList.remove("lxrun-on");
  }

  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

  function render() {
    if (!el) return;
    const s = S();
    const cues = s.cues || [];
    setText(el.querySelector(".lxrun-show"), window.LXShowCommands?.name?.() || "Untitled show");
    const blind = document.documentElement.dataset.consoleMode === "blind";
    const mode = el.querySelector(".lxrun-mode");
    setText(mode, blind ? "BLIND — not on stage" : "LIVE");
    mode.classList.toggle("blind", blind);
    setText(el.querySelector(".lxrun-tempo"), window.LXTempo ? `♩ ${Math.round(window.LXTempo.bpm())} BPM` : "");
    const g = Math.round((window.LXFaders?.grand?.() ?? 1) * 100);
    const master = el.querySelector(".lxrun-master");
    setText(master, `Master ${g}%`);
    master.classList.toggle("down", g < 100);
    el.querySelector(".lxrun-black").classList.toggle("on", Boolean(s.blackout));
    // Live, next and the GO note.
    const live = s.currentCue ?? -1, next = window.LXCueList?.next?.() ?? -1;
    const label = i => (cues[i] ? `${window.cueLabel(i)} · ${cues[i].name || `Cue ${window.cueLabel(i)}`}` : "");
    setText(el.querySelector('.lxrun-cues [data-k="live"]'), live >= 0 ? label(live) : "nothing yet");
    setText(el.querySelector('.lxrun-cues [data-k="next"]'), next >= 0 ? label(next) : "end of the list");
    const note = el.querySelector(".lxrun-note"), gn = next >= 0 ? String(cues[next]?.goNote || "") : "";
    setText(note, gn ? `GO: ${gn}` : "");
    note.hidden = !gn;
    // The song: where it is, and where the cues are on it.
    const song = s.song, songBox = el.querySelector(".lxrun-song");
    songBox.hidden = !song;
    if (song) {
      const pos = window.LXSong?.position?.() ?? 0, dur = Number(song.duration) || 1;
      setText(el.querySelector('.lxrun-song [data-k="song"]'), song.name);
      setText(el.querySelector('.lxrun-song [data-k="songtime"]'), `${clock(pos)} / ${clock(dur)}${window.LXSong?.playing?.() ? "" : " · stopped"}`);
      el.querySelector(".lxrun-bar-fill").style.width = `${Math.max(0, Math.min(100, pos / dur * 100))}%`;
      const off = Number(song.offset) || 0;
      const key = cues.map(c => c?.timecode ?? "").join(",") + `|${next}`;
      const marks = el.querySelector(".lxrun-marks");
      if (marks.dataset.key !== key) {
        marks.dataset.key = key;
        marks.innerHTML = cues.map((c, i) => (c && Number.isFinite(c.timecode) ? `<i class="${i === next ? "next" : ""}" style="left:${Math.max(0, Math.min(100, (c.timecode - off) / dur * 100))}%" title="Cue ${esc(window.cueLabel(i))}"></i>` : "")).join("");
      }
    }
    // Smoke machines: how long each has run, against its limit.
    const smoke = (window.LXAtmos?.status?.() || []).filter(m => m.since != null || m.tripped || m.max > 0);
    const box = el.querySelector(".lxrun-smoke");
    box.hidden = !smoke.length;
    if (smoke.length) {
      box.innerHTML = `<div class="lxrun-smoke-head">Smoke</div>` + smoke.map(m => {
        const ran = m.since != null ? (Date.now() - m.since) / 1000 : 0;
        const pct = m.max > 0 ? Math.min(100, ran / m.max * 100) : 0;
        const state = m.tripped ? "CUT" : m.since != null ? `${ran.toFixed(0)} s${m.max > 0 ? ` of ${m.max} s` : ""}` : "off";
        return `<div class="lxrun-smoke-row${m.tripped ? " cut" : m.since != null ? " on" : ""}"><span>${esc(m.name)}</span><b>${state}</b><i style="width:${m.tripped ? 100 : pct}%"></i>${m.tripped ? '<button type="button" class="btn-secondary" data-run="smoke">Let it run again</button>' : ""}</div>`;
      }).join("");
    }
  }

  document.addEventListener("keydown", e => {
    if (el && e.key === "Escape" && !document.querySelector(".lx-ask, .lxp-back")) { e.preventDefault(); close(); }
  });

  function command(c) {
    if (c === "run show" || c === "run show mode" || c === "show mode") { open(); return true; }
    if (c === "exit run show") { close(); return true; }
    return false;
  }

  function install(tries = 0) {
    const run = document.getElementById("shellRun");
    if (!run) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    if (!$("lxRunShowBtn")) {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "lxRunShowBtn";
      b.className = "shell-runshow";
      b.title = "Run show: just the cue list, the GO note, a big GO, the song and the smoke timers";
      b.innerHTML = "▶ <span>Run show</span>";
      b.addEventListener("click", open);
      run.appendChild(b);
    }
  }

  window.LXRunShow = { open, close, toggle: () => (el ? close() : open()), command, isOpen: () => Boolean(el) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
