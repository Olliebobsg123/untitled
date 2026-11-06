"use strict";

/*
 * Find a show: type part of a file's name and Light Spark searches the whole
 * computer (Spotlight on a Mac, plus USB sticks) for Light Spark shows
 * (.json), FLX shows (.zos) and visualiser files (.lsviz). Click one to open
 * it — however it needs opening.
 *
 * App menu → Find a show… (⌘⇧F is taken by the browser; ⌘⇧O here), or
 * "find frozen" / "find show frozen".
 */
(function () {
  if (window.LXFindShow) return;
  const say = (m, t = "ok") => window.log?.(m, t);
  const api = () => (window.LXShowFiles?.find ? window.LXShowFiles : null);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KIND = { show: ["Light Spark show", "◆"], flx: ["FLX show", "Z"], viz: ["Visualiser file", "▲"] };

  function styles() {
    if (document.getElementById("lxFindStyles")) return;
    const s = document.createElement("style");
    s.id = "lxFindStyles";
    s.textContent = `
      .lx-find-back{position:fixed;inset:0;z-index:5000;display:grid;place-items:start center;padding-top:9vh;background:rgba(2,4,5,.55)}
      .lx-find{width:min(640px,calc(100vw - 32px));max-height:76vh;display:flex;flex-direction:column;background:#0c1215;border:1px solid var(--border-strong);border-radius:10px;box-shadow:0 22px 60px rgba(0,0,0,.6);overflow:hidden}
      .lx-find header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)}
      .lx-find input{flex:1;height:34px;padding:0 11px;background:#0d1418;border:1px solid var(--border);border-radius:7px;color:#e3ebe9;font-size:14px;user-select:text}
      .lx-find input:focus{outline:0;border-color:var(--accent-line)}
      .lx-find .note{padding:8px 12px;color:#8c9a97;font-size:11px;line-height:1.5}
      .lx-find ul{list-style:none;margin:0;padding:4px;overflow:auto}
      .lx-find li{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:8px 9px;border-radius:7px;cursor:pointer}
      .lx-find li:hover,.lx-find li.on{background:var(--accent-soft,#123)}
      .lx-find .ic{width:26px;height:26px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:800;background:#152026;color:var(--text-soft)}
      .lx-find .nm{color:#e3ebe9;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lx-find .pt{color:#6f7d7a;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
      .lx-find .md{color:#6f7d7a;font-size:10.5px;text-align:right;white-space:nowrap}
      .lx-find .tag{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:4px;background:#1b2a30;color:#9fb3ae;font-size:9px;font-weight:800;letter-spacing:.4px;vertical-align:1px}
    `;
    document.head.appendChild(s);
  }

  const when = ms => {
    const d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString()) return `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  };

  async function openResult(r) {
    try {
      if (r.kind === "show") {
        const C = window.LXShowCommands;
        if (C?.isDirty?.() && window.LXAsk && !(await window.LXAsk(`Open “${r.name}”?`, [], { ok: "Open without saving", safe: true, message: "The show that's open has changes that haven't been saved — they'll be lost. Cancel and press Save first to keep them." }))) return;
        await C.loadShow(r.path);
      } else if (r.kind === "flx") {
        const got = await api().zosRead(r.path);
        if (!got) throw new Error("couldn't read it");
        await window.LXZos.openBytes(new Uint8Array(got.data), r.name, r.path);
      } else if (r.kind === "viz") {
        const text = await api().readText(r.path);
        await window.LXVizFiles.openFile({ name: r.name, text: async () => text });
      }
    } catch (e) {
      console.error("[FIND]", e);
      say(`Couldn't open ${r.name}: ${e.message || e}`, "error");
    }
  }

  function open(initial = "") {
    if (!api()) return say("Searching the computer works in the Light Spark app, not in a browser", "warn");
    styles();
    document.querySelector(".lx-find-back")?.remove();
    const back = document.createElement("div");
    back.className = "lx-find-back";
    back.innerHTML = `<div class="lx-find" role="dialog" aria-modal="true">
      <header><input type="search" placeholder="Search the whole computer for a show… (e.g. frozen)" value="${esc(initial)}" spellcheck="false"></header>
      <div class="note">Finds Light Spark shows, FLX shows (.zos) and visualiser files anywhere on this computer, USB sticks included. Type at least 2 letters.</div>
      <ul></ul></div>`;
    document.body.appendChild(back);
    const input = back.querySelector("input"), list = back.querySelector("ul"), note = back.querySelector(".note");
    let results = [], on = 0, timer = 0, seq = 0;
    const close = () => { back.remove(); };
    const draw = () => {
      list.innerHTML = results.map((r, i) => `<li data-i="${i}" class="${i === on ? "on" : ""}"><span class="ic" title="${KIND[r.kind][0]}">${KIND[r.kind][1]}</span><span><div class="nm">${esc(r.name)}<span class="tag">${KIND[r.kind][0].toUpperCase()}</span>${r.usb ? '<span class="tag">USB / DRIVE</span>' : ""}</div><div class="pt" title="${esc(r.path)}">&lrm;${esc(r.folder)}&lrm;</div></span><span class="md">${when(r.modified)}</span></li>`).join("");
      list.querySelector("li.on")?.scrollIntoView({ block: "nearest" });
    };
    const search = async () => {
      const q = input.value.trim();
      const mine = ++seq;
      if (q.length < 2) { results = []; draw(); note.textContent = "Finds Light Spark shows, FLX shows (.zos) and visualiser files anywhere on this computer, USB sticks included. Type at least 2 letters."; return; }
      note.textContent = `Searching for “${q}”…`;
      let found = [];
      try { found = await api().find(q); } catch (e) { note.textContent = `Search failed: ${e.message || e}`; return; }
      if (mine !== seq) return;
      results = found; on = 0; draw();
      note.textContent = found.length ? `${found.length} file${found.length === 1 ? "" : "s"} — newest first. Enter or click to open.` : `Nothing called “${q}” found. Check the spelling, or that the USB stick is plugged in.`;
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    back.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowDown" && results.length) { e.preventDefault(); on = Math.min(results.length - 1, on + 1); draw(); }
      else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); on = Math.max(0, on - 1); draw(); }
      else if (e.key === "Enter" && results[on]) { e.preventDefault(); const r = results[on]; close(); openResult(r); }
    });
    list.addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if (!li) return; const r = results[Number(li.dataset.i)]; close(); openResult(r); });
    back.addEventListener("pointerdown", e => { if (e.target === back) close(); });
    input.focus();
    input.select();
    if (initial) search();
  }

  function command(c, raw) {
    const m = String(raw || c).trim().match(/^(?:find|search)(?:\s+(?:for|show|shows|file|files))?(?:\s+(.+))?$/i);
    if (!m) return false;
    open(m[1] || "");
    return true;
  }

  window.LXFindShow = { open, command, openResult };
})();
