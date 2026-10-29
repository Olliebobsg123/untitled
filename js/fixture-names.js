"use strict";

/*
 * Short names for fixtures. A light can have its own name (fixture.label,
 * e.g. "Fresnel 1" or "SL boom low"); otherwise it's called by its profile
 * without the mode and "Generic" ("RGBW Moving Head", "Dimmer"). Lists show
 * the fixture number and this name; hovering shows the full profile.
 *
 *   label 1 thru 4 Fresnel     → Fresnel 1, Fresnel 2, Fresnel 3, Fresnel 4
 *   label 5 Front wash SL      → one light, that name
 *   label 1 thru 4 off         → back to the profile's name
 *
 * Double-click a light in the Fixtures list, or type in the Name column on
 * the Patch page.
 */
(function () {
  if (window.fixtureLabel) return;
  const S = () => window.State || {};
  const say = (m, t = "ok") => window.log?.(m, t);

  // "Generic RGBW Moving Head (14ch - Home Fixture)" → "RGBW Moving Head"
  function profileShort(name) {
    let n = String(name || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    n = n.replace(/^generic\s+/i, "");
    return n || String(name || "Light");
  }
  function fixtureLabel(f) {
    if (!f) return "";
    const own = String(f.label ?? "").trim();
    return own || profileShort(f.name);
  }
  // Number and name: "12 · Fresnel 1".
  const fixtureTitle = f => (f ? `${f.fixtureNumber ?? ""}${f.fixtureNumber != null ? " · " : ""}${fixtureLabel(f)}` : "");
  // For tooltips: everything about it.
  const fixtureDetails = f => (f ? `${fixtureTitle(f)}\n${f.name}\nUniverse ${f.uni ?? "?"} · address ${f.addr ?? "?"}` : "");

  // "1 thru 4", "1,3,5", "2>6" → fixtures
  function pick(spec) {
    const numbers = [];
    for (const part of String(spec).toLowerCase().replace(/\s*(thru|through|>)\s*/g, "-").split(/[\s,+]+/)) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return null;
      const a = +m[1], b = +(m[2] || m[1]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) numbers.push(n);
    }
    const all = S().fixtures || [];
    return numbers.map(n => all.find(f => Number(f?.fixtureNumber) === n)).filter(Boolean);
  }

  function setLabels(fixtures, name) {
    const clean = String(name || "").trim();
    const off = !clean || /^(off|none|clear)$/i.test(clean);
    fixtures.forEach((f, i) => {
      if (off) delete f.label;
      else f.label = fixtures.length > 1 ? `${clean} ${i + 1}` : clean;
    });
    window.renderFixtures?.();
    window.LXPatchPage?.render?.();
    window.renderPatchTable?.();
    window.dispatchEvent(new CustomEvent("lx-fixture-labels"));
    return fixtures.length;
  }

  function command(c, raw) {
    const m = /^label\s+([\d\s,+>-]+?(?:\s+(?:thru|through)\s+\d+)*)\s+(.+)$/i.exec(String(raw || c).trim());
    if (!m) return false;
    const fixtures = pick(m[1]);
    if (!fixtures || !fixtures.length) { say(`No lights ${m[1].trim()} in the patch`, "warn"); return true; }
    setLabels(fixtures, m[2]);
    const off = /^(off|none|clear)$/i.test(m[2].trim());
    say(off ? `${fixtures.length} light${fixtures.length === 1 ? "" : "s"} back to ${fixtures.length === 1 ? "its" : "their"} profile name` : `Named: ${fixtures.map(fixtureLabel).slice(0, 6).join(", ")}${fixtures.length > 6 ? "…" : ""}`);
    return true;
  }

  async function renameAsk(f) {
    if (!f) return;
    const r = await window.LXAsk?.(`Name light ${f.fixtureNumber ?? ""}`, [{ key: "name", label: `A short name (empty = “${profileShort(f.name)}”)`, value: f.label || "" }], { ok: "Name it", message: f.name });
    if (!r) return;
    setLabels([f], r.name);
  }

  // Double-click a light in the Fixtures list to name it.
  document.addEventListener("dblclick", e => {
    const item = e.target.closest?.("#fixtureList .fixture-item[data-fixture-id]");
    if (!item) return;
    const f = (S().fixtures || []).find(x => String(x?.id) === item.dataset.fixtureId);
    if (f) renameAsk(f);
  });

  Object.assign(window, { fixtureLabel, fixtureTitle, fixtureDetails });
  window.LXFixtureNames = { label: fixtureLabel, title: fixtureTitle, details: fixtureDetails, profileShort, set: setLabels, command, renameAsk };
})();
