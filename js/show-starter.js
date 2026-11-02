"use strict";

/*
 * Show Starter (Windows → Show Starter, or "show starter" / "frozen" on the
 * command line). Three things to get a show going before you've seen it:
 *
 *   Colours     ready-made colour palettes for Frozen (Arendelle warm, ice,
 *               Elsa's magic, night, summer…), on every light that can
 *               change colour.
 *   Song cues   a cue list laid out song by song: each song is a scene
 *               (a heading in the cue list) with a few named cues and GO
 *               notes, numbered in blocks of 10 so there's room to add more.
 *               The cues are empty to start (they change nothing), except
 *               blackouts; set a look and "update cue N" to fill one in.
 *   Areas       groups for each part of the stage (DSR, DSC, DSL, mid,
 *               upstage), from where the lights hang or where the
 *               visualiser has them aimed.
 *
 * Running any part again updates what it made before; nothing else changes.
 */
(function () {
  if (window.LXShowStarter) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(m, t);
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const definition = f => window.getFixtureDefinition?.(f) || window.FixtureLibrary?.[f?.name] || null;
  const has = (def, key) => typeof def?.map?.[key] === "number";
  const atmospheric = f => {
    const def = definition(f);
    return has(def, "fog") || has(def, "haze") || String(def?.photometrics?.sourceType || "").toUpperCase() === "ATMOSPHERIC" || /\b(fog|haze|hazer|smoke)\b/i.test(String(f?.name || ""));
  };
  const lights = () => (S().fixtures || []).filter(f => f && f.id != null && !atmospheric(f));

  // ------------------------------------------------------------ colours

  // [name, hue, sat, light, extra]: the same kind of values as Auto Create's colours.
  const COLOURS = [
    ["Arendelle Warm", 34, 55, 78, { w: 200, amber: 90 }],
    ["Summer Gold", 42, 90, 58, { w: 60, amber: 255 }],
    ["Sunrise", 26, 80, 64, { amber: 160 }],
    ["Fireplace", 18, 100, 50, { amber: 220 }],
    ["Ice Blue", 200, 60, 76, { w: 110 }],
    ["Frozen Steel", 212, 32, 86, { w: 255 }],
    ["Elsa Magic", 186, 95, 58, {}],
    ["Magic Lavender", 268, 60, 74, { w: 40 }],
    ["Winter Night", 228, 100, 40, {}],
    ["Storm", 242, 85, 30, {}],
    ["Romance Pink", 326, 55, 74, { w: 50 }],
    ["Aurora Green", 150, 80, 50, {}]
  ];
  const colourValues = ([, hue, sat, light, extra]) => ({ hue, sat, light, w: 0, amber: 0, uv: 0, lime: 0, cyan: 0, magenta: 0, yellow: 0, ...extra });
  const swatch = ([, h, s, l]) => `hsl(${h} ${s}% ${Math.max(35, Math.min(72, l))}%)`;
  // CMY lights mix by taking away from white.
  function cmyFor([, h, s, l]) {
    const k = (n) => { const a = (s / 100) * Math.min(l / 100, 1 - l / 100); const m = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(m - 3, 9 - m, 1)); };
    const [r, g, b] = [k(0), k(8), k(4)], max = Math.max(r, g, b) || 1;
    return { cyan: Math.round((1 - r / max) * 255), magenta: Math.round((1 - g / max) * 255), yellow: Math.round((1 - b / max) * 255) };
  }

  function makePalettes() {
    const s = S();
    if (!Array.isArray(s.palettes)) s.palettes = [];
    const colourful = lights().filter(f => window.canColour ? window.canColour(f) : true);
    if (!colourful.length) return { added: 0, updated: 0, lights: 0 };
    const cmy = colourful.filter(f => { const d = definition(f); return !["r", "g", "b"].every(k => has(d, k)) && ["cyan", "magenta", "yellow"].every(k => has(d, k)); });
    let added = 0, updated = 0;
    for (const colour of COLOURS) {
      const key = `frozen:${colour[0]}`;
      const palette = {
        starterKey: key,
        name: colour[0],
        category: "Colour",
        values: colourValues(colour),
        fixtures: colourful.map(f => f.id),
        ...(cmy.length ? { perFixture: Object.fromEntries(cmy.map(f => [f.id, cmyFor(colour)])) } : {})
      };
      const old = s.palettes.find(p => p && (p.starterKey === key || String(p.name || "").toLowerCase() === colour[0].toLowerCase()));
      if (old) { Object.assign(old, palette); updated++; }
      else { s.palettes.push({ id: `palette-${Date.now()}-${added}`, createdAt: new Date().toISOString(), ...palette }); added++; }
    }
    window.refreshPalettes?.();
    window.renderPalettes?.();
    return { added, updated, lights: colourful.length };
  }

  // ------------------------------------------------------------ song cues

  // Frozen JR, up to "In Summer" (check it against your script: schools cut
  // and move things). Each cue: [name, GO note, fade in seconds, blackout?].
  const FROZEN = [
    ["Preshow", [["House open — preshow", "House opens", 0], ["House to half", "SM: house to half", 5], ["Blackout — top of show", "House out", 3, true]]],
    ["Let the Sun Shine On", [["Sunrise — opening", "First note", 6], ["Warm day — full company", "Company enters", 4], ["Build", "Last chorus", 3], ["Button", "Last note", 0.5]]],
    ["A Little Bit of You", [["Young sisters — playroom", "Scene starts", 3], ["Song", "Intro", 3], ["Elsa's magic — first sparkle", "Elsa uses her magic", 1], ["Accident — Anna hurt", "Anna falls", 0.5]]],
    ["First Joik (Hidden Folk)", [["Forest at night", "Scene starts", 4], ["Hidden Folk appear", "Hidden Folk enter", 3], ["Memory taken — magic", "Pabbie's magic", 2], ["Back to the castle", "Scene ends", 3]]],
    ["Do You Want to Build a Snowman?", [["Verse 1 — Anna at Elsa's door", "Intro", 3], ["Elsa's room — cold", "Elsa's line", 2], ["Verse 2 — older", "Verse 2", 3], ["Verse 3 — cold and sparse", "Verse 3", 5], ["Button — both sides of the door", "Last note", 4]]],
    ["For the First Time in Forever", [["Coronation morning", "Intro", 3], ["Anna — bright", "Anna starts", 2], ["Elsa — cold special", "Elsa's verse", 2], ["Together — big build", "Last chorus", 3], ["Button", "Last note", 0.5]]],
    ["Dangerous to Dream", [["Elsa alone — cold special", "Intro", 4], ["Build", "Chorus", 3], ["Button", "Last note", 2]]],
    ["Love Is an Open Door", [["Party — warm gold", "Scene starts", 3], ["Anna & Hans — romantic", "Intro", 3], ["Build", "Last chorus", 3], ["Button", "Last note", 0.5]]],
    ["Coronation — powers revealed", [["Party", "Scene starts", 3], ["Powers revealed — flash", "Elsa: “Enough!”", 0], ["Ice — stark and cold", "After the flash", 2], ["Elsa runs", "Elsa exits", 3]]],
    ["Let It Go", [["Mountain — dark and alone", "Intro", 4], ["Verse 1", "First line", 3], ["Chorus 1 — magic grows", "First “let it go”", 2], ["Verse 2 — ice palace", "Verse 2", 3], ["Key change — full magic", "Key change", 1], ["Final note", "“The cold never bothered me anyway”", 0.5], ["Button", "Last note", 0]]],
    ["Hygge", [["Oaken's shop — cosy", "Scene starts", 3], ["Hygge — sauna party", "Intro", 2], ["Button", "Last note", 0.5]]],
    ["What Do You Know About Love?", [["Mountain path — cold day", "Scene starts", 3], ["Song", "Intro", 3], ["Button", "Last note", 1]]],
    ["In Summer", [["Meet Olaf — cold night", "Olaf appears", 3], ["Summer dream — warm gold", "Intro", 3], ["Big finish", "Last chorus", 2], ["Snap back to cold", "Last note", 0], ["End of Act 1 — blackout", "End of the scene", 3, true]]]
  ];
  const GENERIC = [["Scene", "Scene starts", 3], ["Song", "Intro", 3], ["Build", "Last chorus", 3], ["Button", "Last note", 0.5]];
  const norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const songCues = title => (FROZEN.find(([name]) => norm(name) === norm(title)) || [null, GENERIC])[1];

  // The next free block of 10 after the cues already in the show.
  function suggestedStart() {
    let top = 0;
    for (const c of S().cues || []) if (c && Number(c.number) > top) top = Number(c.number);
    return top ? (Math.floor(top / 10) + 1) * 10 : 10;
  }

  // What it would make: [{ song, number, name, goNote, fade, out }].
  function planCues(songs, start, detailed = true) {
    const out = [];
    songs.forEach((song, k) => {
      const base = start + k * 10;
      const list = detailed ? songCues(song) : [["Start", "Scene starts", 3]];
      list.slice(0, 10).forEach(([name, goNote, fade, blackout], n) => out.push({ song, number: base + n, name, goNote, fade, out: Boolean(blackout) }));
    });
    return out;
  }

  function makeCues(songs, start, detailed = true) {
    const s = S();
    if (!Array.isArray(s.cues)) s.cues = [];
    window.normaliseCueNumbers?.();
    window.healLooks?.();
    const plan = planCues(songs, start, detailed);
    let made = 0;
    const skipped = [];
    for (const p of plan) {
      if (window.cueIndexOf?.(p.number) >= 0) { skipped.push(p.number); continue; }
      const index = window.insertCueSlot(p.number);
      // The look carried on from the cue before (these cues change nothing yet).
      let before = {};
      for (let i = index - 1; i >= 0; i--) { const c = s.cues[i]; if (c) { before = c.globalState || c.state || {}; break; } }
      const globalState = JSON.parse(JSON.stringify(before));
      s.cues[index] = {
        number: p.number,
        name: p.name,
        scene: p.song,
        goNote: p.goNote || undefined,
        note: p.out ? "Blackout" : "Not lit yet — set the look, then update this cue",
        mode: "track",
        fixtureStates: p.out ? lights().map(f => [f.id, { intensity: 0 }]) : [],
        globalState,
        state: JSON.parse(JSON.stringify(globalState)),
        fade: Math.round(Math.max(0, Number(p.fade) || 0) * 1000),
        follow: 0,
        followEnabled: false,
        effect: null,
        effects: [],
        starter: true
      };
      if (!p.goNote) delete s.cues[index].goNote;
      made++;
    }
    window.rememberLooks?.();
    window.renderCues?.();
    window.updateInspectorList?.();
    return { made, skipped, songs: songs.length, first: plan[0]?.number, last: plan[plan.length - 1]?.number };
  }

  // ------------------------------------------------------------ areas

  const ROWS = [["D", "Downstage"], ["M", "Midstage"], ["U", "Upstage"]];
  const COLS = [["R", "Right"], ["C", "Centre"], ["L", "Left"]];

  // Which area each light lights: from where it hangs (FOH and the first
  // bar light downstage, and so on back), or where it's aimed.
  function planAreas(by = "hang") {
    const v = S().visualizer || {};
    const stage = v.venue?.stage || {};
    const width = Number(stage.width) || 12, depth = Number(stage.depth) || 9, top = Number.isFinite(Number(stage.height)) ? Number(stage.height) : 1;
    const saved = v.positions || {};
    const fallback = window.AutoCreate?.positions?.(lights()) || new Map();
    const aims = v.aims || {};
    const cells = new Map(), skipped = [];
    const col = x => (x < -width / 6 ? "R" : x > width / 6 ? "L" : "C"); // stage right is -x
    const row = z => (z > -depth / 3 ? "D" : z > -depth * 2 / 3 ? "M" : "U");
    for (const f of lights()) {
      const p = saved[String(f.id)] || fallback.get(f.id);
      let spot = null;
      if (by === "aim") {
        const a = aims[String(f.id)];
        if (a && [a.x, a.y, a.z].every(Number.isFinite) && Math.abs(a.y - top) < 0.7 && a.z <= 0.6 && a.z >= -depth - 0.5 && Math.abs(a.x) <= width / 2 + 0.5) spot = a;
      } else if (p && [p.x, p.z].every(Number.isFinite)) {
        spot = { x: p.x, z: Math.min(p.z, -0.1) }; // FOH lights downstage
      }
      if (!spot) { skipped.push(f); continue; }
      const key = row(spot.z) + "S" + col(spot.x);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(f);
    }
    const groups = [];
    const num = list => list.map(f => Number(f.fixtureNumber)).filter(Number.isFinite).sort((a, b) => a - b);
    for (const [r, rowName] of ROWS) {
      for (const [c, colName] of COLS) {
        const list = cells.get(`${r}S${c}`) || [];
        if (list.length) groups.push({ name: `Area ${r}S${c}`, title: `${rowName} ${colName}`, members: num(list) });
      }
    }
    for (const [r, rowName] of ROWS) {
      const list = COLS.flatMap(([c]) => cells.get(`${r}S${c}`) || []);
      if (list.length) groups.push({ name: `Area ${rowName}`, title: `All of ${rowName.toLowerCase()}`, members: num(list) });
    }
    return { groups, skipped };
  }

  function makeAreas(by = "hang") {
    const s = S();
    if (!Array.isArray(s.groups)) s.groups = [];
    const { groups, skipped } = planAreas(by);
    let added = 0, updated = 0;
    // Areas from a run before that have no lights now are emptied, not left stale.
    const names = new Set(groups.map(g => g.name.toLowerCase()));
    for (const old of s.groups) if (old?.area && !names.has(String(old.name).toLowerCase())) old.members = [];
    for (const g of groups) {
      const old = s.groups.find(x => x && String(x.name || "").toLowerCase() === g.name.toLowerCase());
      if (old) { old.members = g.members.slice(); old.area = true; updated++; }
      else { s.groups.push({ name: g.name, members: g.members.slice(), area: true }); added++; }
    }
    window.renderGroups?.();
    return { groups, skipped, added, updated };
  }

  // ------------------------------------------------------------ the window

  let host = null;
  const DEFAULT_SONGS = FROZEN.map(([name]) => name).join("\n");
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(`lxStarter.${k}`); localStorage.setItem(`lxStarter.${k}`, v); } catch (_) {} return null; };

  function build(el) {
    host = el;
    const songs = store("songs") || DEFAULT_SONGS;
    el.innerHTML = `
      <div class="st">
        <section>
          <h4>Frozen colours <small>colour palettes on every light that can change colour</small></h4>
          <div class="st-sw">${COLOURS.map(c => `<span title="${esc(c[0])}"><i style="background:${swatch(c)}"></i>${esc(c[0])}</span>`).join("")}</div>
          <div class="st-row"><button type="button" class="btn-primary" data-st="palettes">Add the colours</button><span class="st-msg" data-msg="palettes"></span></div>
        </section>
        <section>
          <h4>Song cues <small>a block of cues for each song, with a heading in the cue list</small></h4>
          <div class="st-cols">
            <label class="st-songs">Songs, in order (one a line — check them against your script)<textarea data-st="songs" spellcheck="false">${esc(songs)}</textarea></label>
            <div class="st-side">
              <label>First cue number<input type="number" min="1" step="1" data-st="start" value="${suggestedStart()}"></label>
              <label class="st-check"><input type="checkbox" data-st="detail" checked> A few cues in each song</label>
              <div class="st-preview" data-st="preview"></div>
            </div>
          </div>
          <div class="st-row"><button type="button" class="btn-primary" data-st="cues">Make the cues</button><button type="button" class="btn-secondary" data-st="reset">Frozen JR list</button><span class="st-msg" data-msg="cues"></span></div>
        </section>
        <section>
          <h4>Area groups <small>a group for each part of the stage</small></h4>
          <div class="st-row">
            <label class="st-check"><input type="radio" name="stBy" value="hang" checked> From where they hang</label>
            <label class="st-check"><input type="radio" name="stBy" value="aim"> From where they're aimed in the visualiser</label>
          </div>
          <div class="st-grid" data-st="areas"></div>
          <div class="st-row"><button type="button" class="btn-primary" data-st="makeAreas">Make area groups</button><span class="st-msg" data-msg="areas"></span></div>
        </section>
      </div>`;
    const q = sel => el.querySelector(sel);
    const msg = (k, text, warn = false) => { const m = q(`[data-msg="${k}"]`); m.textContent = text; m.classList.toggle("warn", warn); };
    const songList = () => q('[data-st="songs"]').value.split("\n").map(t => t.trim()).filter(Boolean);
    const by = () => q('input[name="stBy"]:checked')?.value || "hang";

    function preview() {
      const start = Math.max(1, Math.round(Number(q('[data-st="start"]').value) || 1));
      const plan = planCues(songList(), start, q('[data-st="detail"]').checked);
      const taken = plan.filter(p => window.cueIndexOf?.(p.number) >= 0).length;
      const unknown = songList().filter(t => !FROZEN.some(([n]) => norm(n) === norm(t)));
      q('[data-st="preview"]').innerHTML = plan.length
        ? `<b>${plan.length} cues</b>, ${esc(plan[0].number)}–${esc(plan[plan.length - 1].number)}<br>${songList().length} songs, each starting on a multiple of 10${taken ? `<br><span class="warn">${taken} of those numbers are already cues — they're skipped</span>` : ""}${unknown.length && q('[data-st="detail"]').checked ? `<br><span class="dim">Songs it doesn't know get Scene, Song, Build, Button</span>` : ""}`
        : "No songs";
    }
    function areas() {
      const { groups, skipped } = planAreas(by());
      const cell = (r, c) => {
        const g = groups.find(x => x.name === `Area ${r}S${c}`);
        return `<div class="${g ? "" : "empty"}"><b>${r}S${c}</b><span>${g ? g.members.join(", ") : "no lights"}</span></div>`;
      };
      q('[data-st="areas"]').innerHTML = `<div class="st-aud">Upstage</div>${["U", "M", "D"].map(r => ["R", "C", "L"].map(c => cell(r, c)).join("")).join("")}<div class="st-aud">Downstage — audience</div>${skipped.length ? `<p class="warn">Not in any area${by() === "aim" ? " (not aimed at the stage floor)" : ""}: ${skipped.map(f => esc(f.fixtureNumber)).join(", ")}</p>` : ""}`;
    }

    q('[data-st="songs"]').addEventListener("input", () => { store("songs", q('[data-st="songs"]').value); preview(); });
    q('[data-st="start"]').addEventListener("input", preview);
    q('[data-st="detail"]').addEventListener("change", preview);
    el.querySelectorAll('input[name="stBy"]').forEach(r => r.addEventListener("change", areas));
    el.addEventListener("keydown", e => e.stopPropagation()); // typing here isn't the console's shortcuts
    q('[data-st="reset"]').addEventListener("click", () => { q('[data-st="songs"]').value = DEFAULT_SONGS; store("songs", DEFAULT_SONGS); preview(); });
    q('[data-st="palettes"]').addEventListener("click", () => {
      const r = makePalettes();
      if (!r.lights) return msg("palettes", "No lights here can change colour", true);
      const text = `${r.added ? `${r.added} added` : ""}${r.added && r.updated ? ", " : ""}${r.updated ? `${r.updated} updated` : ""} — on ${r.lights} colour lights. They're in Palettes, under Colour.`;
      msg("palettes", text); say(`Frozen colours: ${text}`);
    });
    q('[data-st="cues"]').addEventListener("click", () => {
      const start = Math.max(1, Math.round(Number(q('[data-st="start"]').value) || 1));
      const r = makeCues(songList(), start, q('[data-st="detail"]').checked);
      const text = r.made ? `Made ${r.made} cues (${r.first}–${r.last}) for ${r.songs} songs${r.skipped.length ? `; ${r.skipped.length} skipped (already cues)` : ""}` : `Nothing made — those cue numbers are all taken`;
      msg("cues", text, !r.made); say(text, r.made ? "ok" : "warn");
      q('[data-st="start"]').value = suggestedStart();
      preview();
    });
    q('[data-st="makeAreas"]').addEventListener("click", () => {
      const r = makeAreas(by());
      if (!r.groups.length) return msg("areas", "No lights to put in areas", true);
      const text = `${r.groups.length} area groups (${r.added} new, ${r.updated} updated) — in Groups, named "Area …"`;
      msg("areas", text); say(text);
    });
    preview();
    areas();
  }

  function open() { window.LXWindows?.open("starter"); }

  function command(c) {
    if (/^(show\s*starter|starter|frozen(\s+starter)?)$/.test(c)) { open(); return true; }
    if (c === "area groups" || c === "make area groups") { const r = makeAreas("hang"); say(`${r.groups.length} area groups made from where the lights hang`); return true; }
    return false;
  }

  function styles() {
    if (document.getElementById("lxStarterStyles")) return;
    const st = document.createElement("style");
    st.id = "lxStarterStyles";
    st.textContent = `.st{display:flex;flex-direction:column;gap:0;height:100%;overflow:auto;font-size:11px;color:#c6d0ce}
.st section{padding:10px 12px 12px;border-bottom:1px solid var(--border,#1d262b)}
.st h4{margin:0 0 8px;font-size:12px;font-weight:800;color:#e3ebe9}.st h4 small{font-weight:500;color:#7d8987;margin-left:6px}
.st-sw{display:flex;flex-wrap:wrap;gap:5px 10px;margin-bottom:9px}.st-sw span{display:flex;align-items:center;gap:5px;color:#9fb0ac}.st-sw i{width:14px;height:14px;border-radius:3px;display:inline-block}
.st-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.st-msg{color:#7fdcb2}.st-msg.warn,.st .warn{color:#ffb4a4}.st .dim{color:#7d8987}
.st-cols{display:flex;gap:12px;margin-bottom:9px}.st label{display:flex;flex-direction:column;gap:4px;color:#8c9a97;font-size:11px}
.st-songs{flex:1}.st textarea{min-height:170px;resize:vertical;padding:7px 9px;background:#0d1418;border:1px solid var(--border,#1d262b);border-radius:6px;color:#e3ebe9;font:11.5px/1.5 system-ui;user-select:text}
.st-side{width:190px;display:flex;flex-direction:column;gap:9px}.st input[type=number]{height:28px;padding:0 8px;background:#0d1418;border:1px solid var(--border,#1d262b);border-radius:6px;color:#e3ebe9}
.st label.st-check{flex-direction:row;align-items:center;gap:6px;font-size:11px;color:#c6d0ce}
.st-preview{color:#9fb0ac;line-height:1.5}
.st-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:8px 0 9px}.st-grid>div{background:#11181c;border:1px solid #1d262b;border-radius:5px;padding:5px 7px;display:flex;flex-direction:column;gap:2px}
.st-grid>div.empty{opacity:.45}.st-grid b{font-size:11px;color:#e3ebe9}.st-grid span{font:11px var(--mono,monospace);color:#9fb0ac}
.st-grid .st-aud{grid-column:1/-1;background:none;border:0;padding:0;text-align:center;color:#66736f;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.st-grid p{grid-column:1/-1;margin:2px 0 0}`;
    document.head.appendChild(st);
  }

  function install(tries = 0) {
    if (!window.LXWindows?.register) { if (tries < 100) setTimeout(() => install(tries + 1), 200); return; }
    styles();
    if (!window.LXWindows.list().includes("starter")) window.LXWindows.register({ id: "starter", title: "Show Starter", build, w: 640, h: 640 });
  }

  window.LXShowStarter = { open, command, makePalettes, makeCues, planCues, makeAreas, planAreas, COLOURS, FROZEN };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  else install();
})();
