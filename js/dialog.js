"use strict";

/*
 * In-app question box. Electron doesn't support window.prompt(), so
 * anything that needs typed input asks through this instead:
 *
 *   const answer = await LXAsk("Record cue 4", [
 *     { key: "name", label: "Name", value: "Cue 4" },
 *     { key: "fade", label: "Fade (seconds)", value: 0.8, type: "number", step: 0.1 }
 *   ], { ok: "Record" });
 *   // → { name: "Cue 4", fade: "0.8" }, or null if cancelled
 *   // A field with type: "select" and options: [[value, label], …] is a dropdown.
 *
 * Enter confirms, Esc cancels.
 */
(function () {
  if (window.LXAsk) return;

  function injectStyles() {
    if (document.getElementById("lxAskStyles")) return;
    const style = document.createElement("style");
    style.id = "lxAskStyles";
    style.textContent = `
      .lx-ask-back{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;background:rgba(2,4,5,.55)}
      .lx-ask{width:min(380px,calc(100vw - 32px));background:#0c1215;border:1px solid var(--border-strong);border-radius:8px;box-shadow:0 22px 60px rgba(0,0,0,.6);overflow:hidden}
      .lx-ask h3{margin:0;padding:9px 12px;background:#152026;border-bottom:1px solid var(--border);color:var(--text-soft);font-size:12px;font-weight:800;letter-spacing:.3px}
      .lx-ask form{padding:12px;display:flex;flex-direction:column;gap:9px}
      .lx-ask p{margin:0;color:#8c9a97;font-size:11px;line-height:1.5}
      .lx-ask label{display:flex;flex-direction:column;gap:4px;color:#8c9a97;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase}
      .lx-ask input,.lx-ask select{height:30px;padding:0 9px;background:#0d1418;border:1px solid var(--border);border-radius:6px;color:#e3ebe9;font-size:12px;text-transform:none;letter-spacing:0;font-weight:500;user-select:text}
      .lx-ask input:focus,.lx-ask select:focus{outline:0;border-color:var(--accent-line)}
      .lx-ask .row{display:flex;justify-content:flex-end;gap:6px;margin-top:3px}
    `;
    document.head.appendChild(style);
  }

  const esc = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  window.LXAsk = function ask(title, fields = [], options = {}) {
    injectStyles();
    return new Promise(resolve => {
      const back = document.createElement("div");
      back.className = "lx-ask-back";
      back.innerHTML = `<div class="lx-ask" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><form>${options.message ? `<p>${esc(options.message)}</p>` : ""}${fields.map((f, i) => `<label>${esc(f.label)}${f.type === "select" ? `<select data-i="${i}">${(f.options || []).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>` : `<input data-i="${i}" type="${f.type === "number" ? "number" : "text"}"${f.step != null ? ` step="${f.step}"` : ""}${f.min != null ? ` min="${f.min}"` : ""} value="${esc(f.value)}">`}</label>`).join("")}<div class="row"><button type="button" class="btn-secondary" data-cancel>Cancel</button><button type="submit" class="btn-primary">${esc(options.ok || "OK")}</button></div></form></div>`;
      document.body.appendChild(back);
      const form = back.querySelector("form");
      const done = value => { back.remove(); resolve(value); };
      form.addEventListener("submit", e => {
        e.preventDefault();
        const values = {};
        fields.forEach((f, i) => { values[f.key] = form.querySelector(`[data-i="${i}"]`).value; });
        done(values);
      });
      back.querySelector("[data-cancel]").addEventListener("click", () => done(null));
      back.addEventListener("pointerdown", e => { if (e.target === back) done(null); });
      back.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } });
      const first = form.querySelector("input, select") || form.querySelector("[type=submit]");
      first.focus();
      first.select?.();
    });
  };
})();
