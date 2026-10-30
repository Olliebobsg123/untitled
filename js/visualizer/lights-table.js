// The lights as a table (📋 Lights in the toolbar): number, name, type,
// patch, where each hangs, and its level and colour live. Click a row to
// select the light; type in Across / Height / Depth to move it. Save CSV
// gives the same table for a spreadsheet (paperwork).
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TYPES = { moving: "Moving head", wash: "Wash", beam: "Beam", spot: "Spot", profile: "Profile", fresnel: "Fresnel", par: "Par", bar: "Batten / bar", strobe: "Strobe", blinder: "Blinder", tungsten: "Tungsten", dimmer: "Dimmer", fogger: "Fog machine", hazer: "Hazer", mirrorBall: "Mirror ball" };

export function createLightsTable({ fixtures, typeOf, patchOf, select, selected, place, wake, say = () => {} }) {
  const panel = document.createElement("div");
  panel.id = "lightsTable";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="lt-head"><b>Lights</b><input type="search" placeholder="Filter" class="lt-filter"><button type="button" class="lt-csv" title="The table as a spreadsheet file">Save CSV</button><button type="button" class="lt-close" title="Close">×</button></div>
    <div class="lt-scroll"><table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Patch</th><th title="Metres from centre (− stage right)">Across</th><th title="Metres above the floor">Height</th><th title="Metres from the stage front (− upstage)">Depth</th><th>Level</th><th></th></tr></thead><tbody></tbody></table></div>`;
  document.body.appendChild(panel);
  const body = panel.querySelector("tbody");
  let filter = "", shapeKey = "";

  const rows = () => [...fixtures.values()].map(model => ({ model, fixture: model.fixture })).filter(r => r.fixture)
    .sort((a, b) => (Number(a.fixture.fixtureNumber) || 0) - (Number(b.fixture.fixtureNumber) || 0));
  const nameOf = f => f.label || String(f.name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const colourOf = model => { const rgb = model.state?.rgb; return rgb ? `rgb(${rgb.map(v => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255)).join(",")})` : "transparent"; };

  function build() {
    const list = rows().filter(({ fixture: f }) => !filter || `${f.fixtureNumber} ${nameOf(f)} ${f.name} ${typeOf(f)}`.toLowerCase().includes(filter));
    shapeKey = list.map(r => r.fixture.id).join(",") + filter;
    body.innerHTML = list.map(({ model, fixture: f }) => {
      const p = model.root.position;
      return `<tr data-id="${esc(f.id)}">
        <td class="lt-num">${esc(f.fixtureNumber ?? "")}</td>
        <td class="lt-name" title="${esc(f.name)}">${esc(nameOf(f))}</td>
        <td>${esc(TYPES[typeOf(f)] || typeOf(f))}</td>
        <td class="lt-mono">${esc(patchOf(f))}</td>
        <td><input type="number" step="0.05" data-axis="x" value="${p.x.toFixed(2)}"></td>
        <td><input type="number" step="0.05" data-axis="y" value="${p.y.toFixed(2)}"></td>
        <td><input type="number" step="0.05" data-axis="z" value="${p.z.toFixed(2)}"></td>
        <td class="lt-mono lt-level"></td>
        <td><i class="lt-swatch"></i></td>
      </tr>`;
    }).join("");
    live();
  }

  // Levels, colours, positions and the selected row, without rebuilding.
  function live() {
    if (panel.hidden) return;
    const key = rows().filter(({ fixture: f }) => !filter || `${f.fixtureNumber} ${nameOf(f)} ${f.name} ${typeOf(f)}`.toLowerCase().includes(filter)).map(r => r.fixture.id).join(",") + filter;
    if (key !== shapeKey) return build();
    const sel = selected();
    for (const tr of body.children) {
      const model = fixtures.get(tr.dataset.id);
      if (!model) continue;
      tr.classList.toggle("on", tr.dataset.id === sel);
      const level = model.state?.level != null ? `${Math.round(model.state.level * 100)}%` : "";
      const cell = tr.querySelector(".lt-level");
      if (cell.textContent !== level) cell.textContent = level;
      tr.querySelector(".lt-swatch").style.background = model.state?.level > 0.005 ? colourOf(model) : "transparent";
      for (const input of tr.querySelectorAll("input[data-axis]")) {
        if (document.activeElement === input) continue;
        const v = model.root.position[input.dataset.axis].toFixed(2);
        if (input.value !== v) input.value = v;
      }
    }
  }
  setInterval(live, 250);

  body.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-id]");
    if (tr && !e.target.closest("input")) { select(tr.dataset.id); live(); }
  });
  body.addEventListener("change", e => {
    const input = e.target.closest("input[data-axis]");
    if (!input) return;
    const tr = input.closest("tr");
    const model = fixtures.get(tr.dataset.id);
    if (!model) return;
    const p = model.root.position;
    const next = { x: p.x, y: p.y, z: p.z, [input.dataset.axis]: Number(input.value) || 0 };
    place(tr.dataset.id, next);
    wake();
  });
  body.addEventListener("keydown", e => e.stopPropagation());
  panel.querySelector(".lt-filter").addEventListener("input", e => { filter = e.target.value.trim().toLowerCase(); build(); });
  panel.querySelector(".lt-filter").addEventListener("keydown", e => e.stopPropagation());
  panel.querySelector(".lt-close").addEventListener("click", () => toggle(false));
  panel.querySelector(".lt-csv").addEventListener("click", () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Number", "Name", "Fixture", "Type", "Universe", "Address", "Across (m)", "Height (m)", "Depth (m)"].map(q).join(",")];
    for (const { model, fixture: f } of rows()) {
      const p = model.root.position;
      lines.push([f.fixtureNumber, nameOf(f), f.name, TYPES[typeOf(f)] || typeOf(f), f.uni ?? "", f.addr ?? "", p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)].map(q).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "Lights.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say("Lights.csv saved to your Downloads folder");
  });

  function toggle(on = panel.hidden) {
    panel.hidden = !on;
    document.getElementById("lightsButton")?.classList.toggle("on", on);
    if (on) build();
  }
  return { toggle, build, isOpen: () => !panel.hidden };
}
