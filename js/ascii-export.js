"use strict";

/*
 * Export for FLX S (Zero 88 ZerOS) and other desks: a USITT ASCII show file.
 *
 * The FLX S loads ASCII show files from a USB stick (Setup → Load File). The
 * plain ASCII format only knows dimmer levels, so what goes across is:
 *   - the patch: channel = Light Spark's fixture number, patched to the DMX
 *     address of that light's dimmer (its first channel if it has none)
 *   - every cue: its number, name, up / down times, delay, follow and link,
 *     and the level of every light in it (the whole look, tracking worked out)
 *   - groups (as ASCII groups)
 * Colour, position, beam, effects and chases don't fit in plain ASCII and are
 * left out; set those up on the desk (or patch the real fixtures there first).
 *
 * App menu → Export for FLX S…, or "export ascii" / "export flx".
 */
(function () {
  if (window.LXAscii) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(m, t);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const definition = f => window.getFixtureDefinition?.(f) || window.FixtureLibrary?.[f?.name] || null;

  // ASCII text: plain characters, no line breaks, not too long.
  const clean = (text, max = 60) => String(text ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const level = v => { const n = Math.round(Math.max(0, Math.min(100, num(v)))); return n >= 100 ? "FL" : String(n); };
  const seconds = ms => { const s = Math.max(0, num(ms)) / 1000; return String(Math.round(s * 10) / 10); };

  // Several "1/FL" style entries to a line (ASCII lines are kept short).
  function lines(keyword, items, perLine = 8) {
    const out = [];
    for (let i = 0; i < items.length; i += perLine) out.push(`${keyword} ${items.slice(i, i + perLine).join(" ")}`);
    return out;
  }

  // Which lights can go across: patched, with a whole fixture number.
  function channels() {
    const out = [];
    const used = new Set();
    for (const f of (S().fixtures || []).filter(Boolean)) {
      const n = Number(f.fixtureNumber);
      if (!Number.isInteger(n) || n < 1 || used.has(n) || f.addr == null) continue;
      used.add(n);
      const map = definition(f)?.map || {};
      const offset = typeof map.dimmer === "number" ? map.dimmer : typeof map.intensity === "number" ? map.intensity : 0;
      const dimmer = (Math.max(1, num(f.uni) || 1) - 1) * 512 + num(f.addr) + offset;
      out.push({ f, channel: n, dimmer });
    }
    return out.sort((a, b) => a.channel - b.channel);
  }

  function build() {
    const s = S();
    const chans = channels();
    const byId = new Map(chans.map(c => [c.f.id, c]));
    const showName = clean(window.LXShowCommands?.name?.() || "Light Spark show", 40).replace(/\.json$/i, "");
    const out = [
      "Ident 3:0",
      "Manufacturer Light Spark",
      "Console Light Spark",
      `! ${showName} - exported ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      "! Levels only: colour, position and beam aren't part of plain ASCII.",
      "Clear All",
      "",
      "! Patch: channel = Light Spark fixture number, dimmer = DMX address",
      ...lines("Patch 1", chans.map(c => `${c.channel}<${c.dimmer}>@FL`), 6),
      ""
    ];

    let cueCount = 0;
    (s.cues || []).forEach((cue, i) => {
      if (!cue) return;
      const number = window.cueLabel ? window.cueLabel(i) : String(i + 1);
      const look = window.cueLook?.(i)?.fixtureMap || new Map();
      const timing = cue.timing && typeof cue.timing === "object" ? cue.timing : {};
      const up = timing.up ?? cue.fade ?? 800, down = timing.down ?? cue.fade ?? 800;
      const delay = num(cue.delay);
      out.push(`Cue ${number}`);
      out.push(`Up ${seconds(up)}${delay ? ` ${seconds(delay)}` : ""}`);
      out.push(`Down ${seconds(down)}${delay ? ` ${seconds(delay)}` : ""}`);
      if (cue.followEnabled) out.push(`FollowOn ${seconds(num(cue.follow) * 1000)}`);
      if (cue.link != null && cue.link !== "") out.push(`Link ${clean(cue.link, 10)}`);
      const name = clean(cue.name || "", 40);
      if (name) out.push(`Text ${name}`);
      const levels = [];
      look.forEach((st, id) => {
        const c = byId.get(id);
        if (c && num(st?.intensity) > 0.5) levels.push([c.channel, `${c.channel}/${level(st.intensity)}`]);
      });
      levels.sort((a, b) => a[0] - b[0]);
      out.push(...lines("Chan", levels.map(l => l[1])));
      out.push("");
      cueCount++;
    });

    let groupCount = 0;
    (s.groups || []).filter(g => g && g.name).forEach(g => {
      const members = (g.members || []).map(m => {
        const f = (s.fixtures || []).find(x => x && (String(x.id) === String(m) || String(x.fixtureNumber) === String(m)));
        return f ? byId.get(f.id) : null;
      }).filter(Boolean);
      if (!members.length) return;
      groupCount++;
      out.push(`Group ${groupCount}`);
      out.push(`Text ${clean(g.name, 40)}`);
      out.push(...lines("Chan", [...new Set(members.map(c => c.channel))].sort((a, b) => a - b).map(c => `${c}/FL`)));
      out.push("");
    });

    out.push("EndData", "");
    return { text: out.join("\r\n"), lights: chans.length, cues: cueCount, groups: groupCount, name: showName, skipped: (s.fixtures || []).filter(Boolean).length - chans.length };
  }

  function exportFile() {
    const r = build();
    if (!r.lights) return say("Nothing to export — patch some lights first", "warn");
    const file = `${r.name.replace(/[^\w .-]/g, "") || "Light Spark show"}.asc`;
    const url = URL.createObjectURL(new Blob([r.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say(`${file} saved to your Downloads folder: ${r.lights} lights, ${r.cues} cues, ${r.groups} groups (levels only). Copy it to a USB stick → FLX S: Setup → Load File`, "ok");
    if (r.skipped) say(`${r.skipped} light${r.skipped === 1 ? " wasn't" : "s weren't"} included (not patched, or no whole fixture number)`, "warn");
    return r;
  }

  function command(c) {
    if (/^export (ascii|flx|flx s|zeros|usitt)$/.test(c)) { exportFile(); return true; }
    return false;
  }

  window.LXAscii = { build, export: exportFile, command };
})();
