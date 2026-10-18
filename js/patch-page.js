"use strict";

/*
 * Patch page: the fixture you've picked, where a patch will land (and what it
 * would overwrite), a "next free address" button, and the Patched Fixtures
 * table, where every patched fixture can be renumbered, moved to another
 * universe/address or unpatched, with clashing addresses shown in red.
 * The Patch button itself is handled in app.js; unpatching lives here
 * (window.LXPatch.unpatch) and is used by both.
 */
(function () {
  if (window.LXPatch) return;

  const $ = id => document.getElementById(id);
  const S = () => window.State;
  const lib = () => window.FixtureLibrary || {};
  const MAX_UNIVERSES = 10;
  const TAPO = "Tapo L900-10 (Wi-Fi RGB)";
  const escape = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const channelsOf = f => Math.max(1, Number(lib()[f?.name]?.channels || 1));
  const onDmx = f => f && f.addr != null && Number.isInteger(Number(f.uni)) && f.name !== TAPO;
  // Preferences → Programming → "Confirm before unpatching".
  const sure = message => window.LXPrefs?.get("confirmUnpatch") === false || confirm(message);

  // ------------------------------------------------------------ backend

  // Every fixture whose channels overlap another's, by id.
  function clashes() {
    const result = new Map();
    const placed = S().fixtures.filter(onDmx).map(f => ({ f, uni: Number(f.uni), start: Number(f.addr), end: Number(f.addr) + channelsOf(f) - 1 }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        if (a.uni === b.uni && a.start <= b.end && b.start <= a.end) {
          if (!result.has(a.f.id)) result.set(a.f.id, []);
          if (!result.has(b.f.id)) result.set(b.f.id, []);
          result.get(a.f.id).push(b.f.fixtureNumber);
          result.get(b.f.id).push(a.f.fixtureNumber);
        }
      }
    }
    return result;
  }

  // Lowest address in a universe where `width` channels fit with nothing else there.
  function nextFreeAddress(uni, width, ignore = new Set()) {
    const taken = S().fixtures.filter(f => onDmx(f) && Number(f.uni) === uni && !ignore.has(f.id))
      .map(f => [Number(f.addr), Number(f.addr) + channelsOf(f) - 1]).sort((a, b) => a[0] - b[0]);
    let address = 1;
    for (const [start, end] of taken) {
      if (address + width - 1 < start) break;
      address = Math.max(address, end + 1);
    }
    return address + width - 1 <= 512 ? address : null;
  }

  function afterPatchChange() {
    window.renderFixtures?.();
    window.renderGroups?.();
    window.updateControlVisibility?.();
    window.updateDMX?.();
    window.sendToVisualizer?.();
    refresh(true);
  }

  // Remove fixtures from the patch: their live state, the selection, and
  // their numbers from groups. Cues keep their saved values (harmless).
  function unpatch(ids, { quiet = false } = {}) {
    const state = S();
    const remove = new Set(ids.map(String));
    const gone = state.fixtures.filter(f => remove.has(String(f.id)));
    if (!gone.length) return 0;
    const numbers = new Set(gone.map(f => Number(f.fixtureNumber)));
    for (let i = state.fixtures.length - 1; i >= 0; i--) if (remove.has(String(state.fixtures[i]?.id))) state.fixtures.splice(i, 1);
    gone.forEach(f => { state.fixtureStates?.delete(f.id); state.selected?.delete(f.id); });
    if (remove.has(String(state.selectedFixtureId))) state.selectedFixtureId = null;
    for (const group of state.groups || []) if (Array.isArray(group.members)) group.members = group.members.filter(n => !numbers.has(Number(n)));
    if (!quiet) window.log?.(`Unpatched ${gone.length === 1 ? `#${gone[0].fixtureNumber} ${gone[0].name}` : `${gone.length} fixtures`}`, "ok");
    afterPatchChange();
    return gone.length;
  }

  // Change one fixture's number, universe or address.
  function edit(id, field, raw) {
    const state = S();
    const fixture = state.fixtures.find(f => String(f.id) === String(id));
    if (!fixture) return false;
    const value = Math.round(Number(raw));
    if (field === "fixtureNumber") {
      if (!Number.isInteger(value) || value < 1) return warn("Fixture numbers start at 1");
      if (state.fixtures.some(f => f !== fixture && Number(f.fixtureNumber) === value)) return warn(`Fixture number ${value} is already used`);
      const old = Number(fixture.fixtureNumber);
      fixture.fixtureNumber = value;
      // Groups store fixture numbers: follow the renumber.
      for (const group of state.groups || []) if (Array.isArray(group.members)) group.members = group.members.map(n => (Number(n) === old ? value : n));
      state.fixtures.sort((a, b) => Number(a?.fixtureNumber) - Number(b?.fixtureNumber));
    } else if (field === "uni") {
      if (!Number.isInteger(value) || value < 1 || value > MAX_UNIVERSES) return warn(`Universe must be 1 to ${MAX_UNIVERSES}`);
      fixture.uni = value;
    } else if (field === "addr") {
      if (!Number.isInteger(value) || value < 1 || value + channelsOf(fixture) - 1 > 512) return warn(`#${fixture.fixtureNumber} needs ${channelsOf(fixture)} channels: start at 1 to ${513 - channelsOf(fixture)}`);
      fixture.addr = value;
    } else return false;
    const clash = clashes().get(fixture.id);
    window.log?.(`#${fixture.fixtureNumber} ${fixture.name} → Uni ${fixture.uni} Addr ${fixture.addr}${clash ? ` — overlaps #${clash.join(", #")}` : ""}`, clash ? "warn" : "ok");
    afterPatchChange();
    return true;
  }
  function warn(message) { window.log?.(message, "warn"); refresh(true); return false; }

  // ---------------------------------------------------------------- view

  function injectStyles() {
    if ($("patchPageStyles")) return;
    const style = document.createElement("style");
    style.id = "patchPageStyles";
    style.textContent = `
      #page-patch .patch-layout{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:12px;align-items:start}
      #patchTablePanel,#rdmPanel{grid-column:1/-1}
      #patchLibraryPanel .panel-body{display:flex;flex-direction:column;gap:10px}
      #patchLibraryPanel .library-list{height:430px;max-height:none;overflow:auto}
      #libList .fixture-item.picked{border-color:var(--accent-line);background:var(--accent-soft);color:var(--accent)}
      .patch-picked{display:flex;flex-direction:column;gap:4px;padding:12px 14px;margin-bottom:14px;border:1px solid var(--accent-line);border-radius:8px;background:var(--accent-soft)}
      .patch-picked b{font-size:13px;color:var(--text)}
      .patch-picked span{font-size:11px;color:#9aa7a4}
      .patch-picked .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
      .patch-picked .chips i{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.4px;padding:3px 8px;border-radius:5px;background:rgba(0,0,0,.25);color:#b9c5c2}
      .patch-picked.empty{border-style:dashed;border-color:var(--border);background:transparent}
      .patch-picked.empty b{color:#9aa7a4}
      .patch-link{margin-left:8px;padding:0;border:0;background:none;color:var(--accent);font-size:9px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;cursor:pointer}
      .patch-range{margin:4px 0 12px;font-size:11px;line-height:1.5;color:#8bc5ff}
      .patch-range.bad{color:#ff8996}
      .patch-range.clash{color:#f5b03c}
      #patchFormPanel .action-row{flex-wrap:wrap}
      #patchFormPanel #btnPatch{flex:1;height:40px;font-size:12px}
      .patch-tools{margin-top:8px}
      .patch-tools:empty{display:none}
      .patch-tools button{flex:1}
      #tapoSetup{display:block}
      #tapoSetup .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #tapoSetup small{font-size:11px;line-height:1.5}
      .patch-table-tools{display:flex;gap:8px;align-items:center;margin-bottom:10px}
      .patch-table-tools .search-box{flex:1;margin:0}
      .patch-table{border:1px solid var(--border);border-radius:8px;overflow:hidden}
      .pt-row{display:grid;grid-template-columns:34px 74px minmax(0,1fr) 58px 84px 92px 96px 78px 40px;align-items:center;min-height:38px;border-bottom:1px solid var(--border);font-size:12px}
      .pt-row:last-child{border-bottom:0}
      .pt-row > *{padding:0 8px;min-width:0}
      .pt-head{min-height:32px;background:rgba(255,255,255,.02);font-size:9px;font-weight:850;letter-spacing:1px;color:#5d6b68;text-transform:uppercase}
      .pt-row:not(.pt-head){cursor:pointer}
      .pt-row:not(.pt-head):hover{background:rgba(255,255,255,.02)}
      .pt-row.sel{background:var(--accent-soft)}
      .pt-row.sel .pt-name{color:var(--accent)}
      .pt-row.clash{background:rgba(255,80,96,.07)}
      .pt-row.clash .pt-range{color:#ff8996;font-weight:800}
      .pt-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
      .pt-name small{display:block;color:#6f7d7a;font-size:10px}
      .pt-row input[type=number]{width:100%;height:28px;padding:0 6px;background:#0d1418;border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:12px}
      .pt-row input[type=checkbox]{width:15px;height:15px;accent-color:var(--accent)}
      .pt-range,.pt-ch,.pt-beam{color:#9aa7a4;font-variant-numeric:tabular-nums}
      .pt-del{border:0;background:none;color:#7d8987;font-size:15px;cursor:pointer;padding:4px 8px;border-radius:5px}
      .pt-del:hover{color:#ff8996;background:rgba(255,80,96,.1)}
      .pt-empty{padding:26px;text-align:center;color:#6f7d7a;font-size:12px}
      @media (max-width:1100px){#page-patch .patch-layout{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  // The fixture picked in the library: a summary card, the library row
  // highlighted, a free address if the current one would clash, and Tapo
  // settings only for the Tapo light.
  let lastPicked = null;
  function syncPicked() {
    const name = $("patchName")?.value || "";
    const def = lib()[name];
    const card = $("patchPicked");
    if (card && name !== lastPicked) {
      lastPicked = name;
      if (!def) {
        card.className = "patch-picked empty";
        card.innerHTML = "<b>No fixture chosen</b><span>Pick a fixture from the library on the left.</span>";
      } else {
        const p = def.photometrics || {};
        const beam = Number(p.beamAngleMin) > 0 && Number(p.beamAngleMax) > 0 && p.beamAngleMin !== p.beamAngleMax ? `${p.beamAngleMin}–${p.beamAngleMax}°` : Number(p.beamAngle || p.beamAngleMin || p.beamAngleMax) > 0 ? `${p.beamAngle || p.beamAngleMin || p.beamAngleMax}°` : "";
        const chips = [`${def.channels} ch`, String(def.type || "").toUpperCase(), Number(p.ratedLumens) > 0 ? `${Math.round(p.ratedLumens).toLocaleString()} lm` : "", beam, typeof def.map?.pan === "number" ? "PAN/TILT" : "", typeof def.map?.zoom === "number" ? "ZOOM" : ""].filter(Boolean);
        card.className = "patch-picked";
        card.innerHTML = `<b>${escape(name)}</b><div class="chips">${chips.map(c => `<i>${escape(c)}</i>`).join("")}</div>`;
        // Don't leave the start address somewhere it would overwrite something.
        const uni = Number($("patchUni")?.value || 1), addr = Number($("patchAddr")?.value || 1), width = Number(def.channels || 1) * Math.max(1, Number($("patchQty")?.value || 1));
        if (name !== TAPO && overlapsAt(uni, addr, width).length) {
          const free = nextFreeAddress(uni, width);
          if (free) $("patchAddr").value = String(free);
        }
      }
      document.querySelectorAll("#libList .fixture-item").forEach(item => item.classList.toggle("picked", item.querySelector("span")?.textContent.trim() === name));
      const tapo = $("tapoSetup");
      if (tapo) tapo.hidden = name !== TAPO;
    }
    footprint();
  }

  function overlapsAt(uni, addr, width) {
    const end = addr + width - 1;
    return S().fixtures.filter(f => onDmx(f) && Number(f.uni) === uni && Number(f.addr) <= end && Number(f.addr) + channelsOf(f) - 1 >= addr);
  }

  // Where the patch will land, and anything it would overwrite.
  function footprint() {
    const range = $("patchRange");
    if (!range) return;
    const name = $("patchName")?.value || "";
    const def = lib()[name];
    const qty = Math.max(1, Math.round(Number($("patchQty")?.value || 1)));
    const uni = Number($("patchUni")?.value || 1), addr = Number($("patchAddr")?.value || 1);
    range.className = "patch-range";
    if (!def) { range.textContent = "Pick a fixture to see where it will go."; return; }
    if (name === TAPO) { range.textContent = "Wi-Fi light — no DMX address needed."; return; }
    const ch = Math.max(1, Number(def.channels || 1));
    const end = addr + qty * ch - 1;
    const button = $("btnPatch");
    if (button) button.textContent = qty > 1 ? `＋ Patch ${qty} fixtures` : "＋ Patch";
    if (!Number.isInteger(addr) || addr < 1 || end > 512) {
      range.classList.add("bad");
      range.textContent = `Universe ${uni}: ${addr}–${end} runs past 512.${qty > 1 ? ` Only ${Math.max(0, Math.floor((513 - addr) / ch))} fit from ${addr}.` : ""}`;
      return;
    }
    const hits = overlapsAt(uni, addr, qty * ch);
    if (hits.length) {
      range.classList.add("clash");
      range.textContent = `Universe ${uni}: ${addr}–${end} — would replace #${hits.map(f => f.fixtureNumber).join(", #")}.`;
      return;
    }
    range.textContent = qty > 1 ? `Universe ${uni}: ${qty} × ${ch} ch at ${Array.from({ length: Math.min(qty, 6) }, (_, i) => addr + i * ch).join(", ")}${qty > 6 ? "…" : ""} (to ${end}).` : `Universe ${uni}: ${addr}–${end} (${ch} channel${ch === 1 ? "" : "s"}).`;
  }

  let tableKey = "";
  function refresh(force = false) {
    const box = $("patchTable");
    if (!box) return;
    const state = S();
    const fixtures = [...(state.fixtures || [])].filter(Boolean).sort((a, b) => Number(a.fixtureNumber) - Number(b.fixtureNumber));
    const filter = String($("patchTableFilter")?.value || "").toLowerCase().trim();
    const selected = state.selected instanceof Set ? state.selected : new Set();
    const clash = clashes();
    const key = JSON.stringify([fixtures.map(f => [f.id, f.fixtureNumber, f.name, f.uni, f.addr, f.beamAngle]), [...selected], filter, [...clash.keys()]]);
    if (!force && key === tableKey) return;
    // Don't redraw under someone typing in a cell.
    if (!force && box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    tableKey = key;
    const meta = $("patchTableMeta");
    if (meta) meta.textContent = `${fixtures.length} FIXTURE${fixtures.length === 1 ? "" : "S"} · ${fixtures.reduce((n, f) => n + (onDmx(f) ? channelsOf(f) : 0), 0)} CH${clash.size ? ` · ${clash.size} CLASHING` : ""}`;
    const shown = fixtures.filter(f => !filter || `${f.fixtureNumber} ${f.name} ${f.uni}/${f.addr}`.toLowerCase().includes(filter));
    const head = `<div class="pt-row pt-head"><span></span><span>#</span><span>Fixture</span><span>Ch</span><span>Universe</span><span>Address</span><span>Range</span><span>Beam</span><span></span></div>`;
    if (!fixtures.length) { box.innerHTML = head + `<div class="pt-empty">Nothing patched yet — pick a fixture from the library and press Patch.</div>`; return; }
    box.innerHTML = head + shown.map(f => {
      const ch = channelsOf(f), dmx = onDmx(f), c = clash.get(f.id);
      const known = Boolean(lib()[f.name]);
      return `<div class="pt-row ${selected.has(f.id) ? "sel" : ""} ${c ? "clash" : ""}" data-id="${escape(f.id)}" title="${c ? `Overlaps #${c.join(", #")}` : ""}">
        <span><input type="checkbox" data-check></span>
        <span><input type="number" min="1" value="${escape(f.fixtureNumber)}" data-edit="fixtureNumber"></span>
        <span class="pt-name">${escape(f.name)}${known ? "" : "<small>Not in the fixture library</small>"}</span>
        <span class="pt-ch">${dmx ? ch : "—"}</span>
        <span>${dmx ? `<input type="number" min="1" max="${MAX_UNIVERSES}" value="${escape(f.uni)}" data-edit="uni">` : '<span class="pt-ch">Wi-Fi</span>'}</span>
        <span>${dmx ? `<input type="number" min="1" max="512" value="${escape(f.addr)}" data-edit="addr">` : ""}</span>
        <span class="pt-range">${dmx ? `${f.addr}–${Number(f.addr) + ch - 1}` : ""}</span>
        <span class="pt-beam">${f.beamAngle ? `${f.beamAngle}°` : "Lib"}</span>
        <span><button type="button" class="pt-del" data-del title="Unpatch #${escape(f.fixtureNumber)}">✕</button></span>
      </div>`;
    }).join("") + (shown.length ? "" : `<div class="pt-empty">No patched fixtures match “${escape(filter)}”.</div>`);
  }

  function wireTable() {
    const box = $("patchTable");
    box.addEventListener("change", e => {
      const input = e.target.closest("input[data-edit]");
      if (!input) return;
      edit(input.closest(".pt-row").dataset.id, input.dataset.edit, input.value);
    });
    box.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input[data-edit]")) e.target.blur(); });
    box.addEventListener("click", e => {
      const row = e.target.closest(".pt-row[data-id]");
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest("[data-del]")) {
        const f = S().fixtures.find(x => String(x.id) === id);
        if (f && sure(`Unpatch #${f.fixtureNumber} ${f.name}?`)) unpatch([f.id]);
        return;
      }
      if (e.target.closest("input")) return;
      // Clicking a row selects that fixture in the console (Shift/Cmd adds).
      const state = S();
      const fixture = state.fixtures.find(x => String(x.id) === id);
      if (!fixture) return;
      if (!(state.selected instanceof Set)) state.selected = new Set();
      if (e.shiftKey || e.metaKey || e.ctrlKey) { state.selected.has(fixture.id) ? state.selected.delete(fixture.id) : state.selected.add(fixture.id); }
      else { state.selected.clear(); state.selected.add(fixture.id); }
      state.selectedFixtureId = fixture.id;
      window.syncFixtureListSelectionClasses?.();
      window.updateControlVisibility?.();
      refresh(true);
    });
    $("patchTableFilter")?.addEventListener("input", () => refresh(true));
    $("patchSelectAll")?.addEventListener("click", () => {
      const boxes = [...box.querySelectorAll("input[data-check]")];
      const all = boxes.length && boxes.every(b => b.checked);
      boxes.forEach(b => { b.checked = !all; });
      $("patchSelectAll").textContent = all ? "Select all" : "Select none";
    });
    $("btnUnpatchSingle")?.addEventListener("click", () => {
      let ids = [...box.querySelectorAll("input[data-check]:checked")].map(b => b.closest(".pt-row").dataset.id);
      // Nothing ticked: the fixtures selected in the console.
      if (!ids.length) ids = [...(S().selected || [])].map(String);
      if (!ids.length) return window.log?.("Tick fixtures in the table (or select them) to unpatch", "warn");
      if (!sure(`Unpatch ${ids.length} fixture${ids.length === 1 ? "" : "s"}?`)) return;
      unpatch(ids);
      $("patchSelectAll").textContent = "Select all";
    });
  }

  // Fixture editor / GDTF / Auto Create buttons get added next to Patch by
  // their own scripts; keep them on a row of their own below it.
  function tidyTools() {
    const tools = document.querySelector("#patchFormPanel .patch-tools");
    const row = $("btnPatch")?.closest(".action-row");
    if (!tools || !row) return;
    [...row.children].forEach(child => { if (child.id !== "btnPatch") tools.appendChild(child); });
  }

  function boot() {
    if (!$("page-patch") || !$("patchTable")) return setTimeout(boot, 300);
    injectStyles();
    wireTable();
    if ($("patchFixtureNumber") && !$("patchFixtureNumber").value) {
      const used = new Set(S().fixtures.map(f => Number(f.fixtureNumber)));
      let n = 1; while (used.has(n)) n++;
      $("patchFixtureNumber").value = String(n);
    }
    $("patchNextFree")?.addEventListener("click", () => {
      const def = lib()[$("patchName")?.value];
      const width = Number(def?.channels || 1) * Math.max(1, Number($("patchQty")?.value || 1));
      const uni = Number($("patchUni")?.value || 1);
      const free = nextFreeAddress(uni, width);
      if (free) { $("patchAddr").value = String(free); footprint(); }
      else window.log?.(`No room for ${width} channels in universe ${uni}`, "warn");
    });
    ["patchQty", "patchUni", "patchAddr"].forEach(id => $(id)?.addEventListener("input", () => setTimeout(footprint, 0)));
    // The library fills in the name by code (no event), so watch for it.
    setInterval(() => {
      syncPicked();
      tidyTools();
      if ($("patchTable")?.offsetParent) refresh(); // on screen: page or window
      const count = $("patchLibraryCount");
      if (count) count.textContent = `${Object.keys(lib()).length} FIXTURES`;
    }, 250);
    refresh(true);
  }

  window.LXPatch = Object.freeze({ unpatch, edit, refresh, nextFreeAddress, clashes });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
