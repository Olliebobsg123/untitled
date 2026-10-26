"use strict";

/*
 * Faster programming: commands that save going cue by cue and light by light.
 *
 *   recall from cue 5            the selected lights (or all) take their look from cue 5
 *   recall from cue 5 colour     …just their colour (intensity / colour / position / beam)
 *   apply to cue 3 thru 9        what you've changed on the selected lights goes into cues 3-9
 *   apply to cue 3,5,7 colour    …just their colour; the cue after the range is left as it was
 *   copy 1 to 2 thru 6           light 1's look onto lights 2-6
 *   1 thru 10 @ 0 thru 100       fan: levels spread across the lights (in number order)
 *   highlight                    the selected lights full, open white, to see them (hl)
 *   next / last                  while highlighting: one light at a time, stepping through
 *                                (otherwise "next" is still GO)
 *   highlight off                back to how they were (focus changes made meanwhile kept)
 *
 * The Command Line's suggestions list them (js/autocomplete.js).
 */
(function () {
  if (window.__fastProgrammingInstalled) return;
  window.__fastProgrammingInstalled = true;
  const S = () => window.State || {};
  const say = (message, level = "ok") => window.log?.(message, level);
  const clone = value => JSON.parse(JSON.stringify(value ?? null));
  const PARTS = {
    intensity: ["intensity", "level", "levels", "dimmer"],
    colour: ["colour", "color", "colours", "colors"],
    focus: ["position", "positions", "focus", "pan", "tilt"],
    beam: ["beam", "gobo", "gobos", "zoom"]
  };
  const partNamed = word => Object.keys(PARTS).find(key => PARTS[key].includes(String(word || "").toLowerCase())) || null;
  const keyIn = (key, part) => !part || (typeof window.partOf === "function" ? window.partOf(key) === part : true);
  const PART_LABEL = { intensity: "intensity", colour: "colour", focus: "position", beam: "beam" };

  const fixtures = () => (S().fixtures || []).filter(Boolean);
  const byNumber = n => fixtures().find(f => Number(f.fixtureNumber) === Number(n));
  const numberOf = id => fixtures().find(f => f.id === id)?.fixtureNumber;
  const stateOf = id => window.ensureFixtureState?.(id) || S().fixtureStates?.get(id) || {};
  const selectedIds = () => [...(S().selected || [])].filter(id => fixtures().some(f => f.id === id))
    .sort((a, b) => Number(numberOf(a)) - Number(numberOf(b)));
  const idsFrom = text => (window.parseSelection?.(text) || []).map(byNumber).filter(Boolean).map(f => f.id);

  // Cue numbers: "3 thru 9", "3,5,7", "3", "1.5". → cue indexes that exist
  function cueIndexes(text) {
    const t = String(text).trim().replace(/–/g, "-");
    const range = t.match(/^(\d+(?:\.\d+)?)\s*(?:thru|through|-|>)\s*(\d+(?:\.\d+)?)$/);
    const cues = S().cues || [];
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      return cues.map((cue, i) => (cue && Number(cue.number) >= lo - 1e-9 && Number(cue.number) <= hi + 1e-9 ? i : -1)).filter(i => i >= 0);
    }
    return t.split(/\s*,\s*/).map(v => window.cueIndexOf?.(v)).filter(i => Number.isInteger(i) && i >= 0);
  }

  // Each light to its own values, in one fade.
  function setEach(map, ms = 300) {
    window.finishFade?.();
    const targets = [];
    map.forEach((values, id) => {
      const state = { ...clone(stateOf(id)), ...values };
      targets.push([id, typeof window.withCMY === "function" ? window.withCMY(id, state, values) : state]);
    });
    if (!targets.length) return;
    window.fadeTo?.({}, ms, targets);
    window.renderFixtures?.();
    window.updateControlsForSelection?.();
    window.syncControlsFromSelection?.();
  }

  // --- recall from cue ------------------------------------------------------

  function recallFrom(cueText, part) {
    const index = window.cueIndexOf?.(cueText);
    if (!(index >= 0)) return say(`There's no cue ${cueText}`, "warn");
    window.healLooks?.();
    const look = window.LXTracking?.look(index) || window.cueLook?.(index);
    const ids = selectedIds().length ? selectedIds() : fixtures().map(f => f.id);
    const map = new Map();
    for (const id of ids) {
      const stored = look?.fixtureMap?.get(id);
      if (!stored) continue;
      const values = Object.fromEntries(Object.entries(stored).filter(([key]) => keyIn(key, part)));
      if (Object.keys(values).length) map.set(id, values);
    }
    if (!map.size) return say(`Cue ${cueText} has nothing for ${selectedIds().length ? "the selected lights" : "the rig"}${part ? `' ${PART_LABEL[part]}` : ""}`, "warn");
    setEach(map);
    return say(`${map.size} light${map.size === 1 ? "" : "s"} took ${part ? `their ${PART_LABEL[part]}` : "their look"} from cue ${window.formatCueNumber?.(S().cues[index].number) ?? cueText}`);
  }

  // --- apply to cues ----------------------------------------------------------

  // What's been changed by hand on these lights: what differs from the live cue.
  function changedValues(ids, part) {
    const live = S().currentCue >= 0 ? (window.LXTracking?.look(S().currentCue) || null) : null;
    const map = new Map();
    for (const id of ids) {
      const now = stateOf(id);
      const was = live?.fixtureMap?.get(id) || null;
      const values = {};
      for (const [key, value] of Object.entries(now)) {
        if (!keyIn(key, part) || typeof value === "function") continue;
        if (!was || JSON.stringify(was[key]) !== JSON.stringify(value)) values[key] = clone(value);
      }
      if (Object.keys(values).length) map.set(id, values);
    }
    return map;
  }

  function writeInto(cue, id, values) {
    cue.fixtureStates ||= [];
    const entry = cue.fixtureStates.find(e => Array.isArray(e) && String(e[0]) === String(id));
    if (entry) entry[1] = { ...(entry[1] || {}), ...clone(values) };
    else cue.fixtureStates.push([id, clone(values)]);
  }

  function applyTo(cueText, part) {
    const ids = selectedIds();
    if (!ids.length) return say("Select the lights to put into the cues first (e.g. 1 thru 4)", "warn");
    const indexes = cueIndexes(cueText).sort((a, b) => a - b);
    if (!indexes.length) return say(`No cues match ${cueText}`, "warn");
    const values = part ? changedValues(ids, part).size ? changedValues(ids, part) : allValues(ids, part) : changedValues(ids, null);
    if (!values.size) return say("Nothing's changed on the selected lights since the live cue — set them how you want first", "warn");
    window.healLooks?.();
    const cues = S().cues;
    // The cue after the range keeps its look (the change stops at the range).
    let after = indexes.at(-1) + 1;
    while (after < cues.length && !cues[after]) after++;
    const afterLook = cues[after] ? window.LXTracking?.look(after) : null;
    for (const index of indexes) values.forEach((v, id) => writeInto(cues[index], id, v));
    if (afterLook && cues[after]?.mode === "track") {
      const now = window.LXTracking.look(after);
      values.forEach((v, id) => {
        const before = afterLook.fixtureMap.get(id) || {};
        const restore = {};
        for (const key of Object.keys(v)) if (key in before && JSON.stringify(now.fixtureMap.get(id)?.[key]) !== JSON.stringify(before[key])) restore[key] = clone(before[key]);
        if (Object.keys(restore).length) writeInto(cues[after], id, restore);
      });
    }
    window.rememberLooks?.();
    window.renderCues?.();
    window.LXCueList?.refresh?.();
    const keys = new Set();
    values.forEach(v => Object.keys(v).forEach(k => keys.add(window.partOf ? PART_LABEL[window.partOf(k)] || "other" : k)));
    const first = window.formatCueNumber?.(cues[indexes[0]].number), last = window.formatCueNumber?.(cues[indexes.at(-1)].number);
    return say(`${indexes.length === 1 ? `Cue ${first}` : `Cues ${first}–${last} (${indexes.length})`}: ${values.size} light${values.size === 1 ? "" : "s"}' ${[...keys].filter(Boolean).join(", ")} updated`);
  }
  // With a part named, everything of that part (even if unchanged from the live cue).
  function allValues(ids, part) {
    const map = new Map();
    for (const id of ids) {
      const values = Object.fromEntries(Object.entries(stateOf(id)).filter(([key]) => keyIn(key, part)).map(([k, v]) => [k, clone(v)]));
      if (Object.keys(values).length) map.set(id, values);
    }
    return map;
  }

  // --- copy one light to others --------------------------------------------------

  function copyLight(fromText, toText) {
    const source = byNumber(fromText);
    if (!source) return say(`There's no light ${fromText}`, "warn");
    const targets = idsFrom(toText).filter(id => id !== source.id);
    if (!targets.length) return say(`No lights match ${toText}`, "warn");
    const values = clone(stateOf(source.id));
    setEach(new Map(targets.map(id => [id, values])));
    return say(`Light ${fromText}'s look copied to ${targets.length} light${targets.length === 1 ? "" : "s"}`);
  }

  // --- fan ----------------------------------------------------------------------

  function fan(selectionText, from, to) {
    if (selectionText) {
      const ids = idsFrom(selectionText);
      // ("group front @ 0 thru 100": select the group the usual way.)
      if (ids.length) S().selected = new Set(ids);
      else window.parseCommand?.(selectionText);
    }
    const ids = selectedIds();
    if (!ids.length) return say("Select some lights first", "warn");
    const map = new Map(ids.map((id, i) => [id, { intensity: Math.round(ids.length === 1 ? from : from + ((to - from) * i) / (ids.length - 1)) }]));
    setEach(map);
    return say(`Fanned ${ids.length} lights from ${from}% to ${to}%`);
  }

  // --- highlight, next / last ----------------------------------------------------

  let highlight = null; // { saved: Map(id → intensity+colour), ids, at }
  const LOOK_KEYS = key => !window.partOf || ["intensity", "colour"].includes(window.partOf(key));
  function lit(ids) {
    // Full and open white, like "locate" but without moving anything.
    const numbers = ids.map(numberOf).filter(n => n != null).join(",");
    if (numbers) window.parseCommand?.(`${numbers} @ full white`);
  }
  function rememberOf(ids) {
    for (const id of ids) {
      if (highlight.saved.has(id)) continue;
      highlight.saved.set(id, Object.fromEntries(Object.entries(clone(stateOf(id))).filter(([k]) => LOOK_KEYS(k))));
    }
  }
  function putBack(ids) {
    const map = new Map(ids.filter(id => highlight.saved.has(id)).map(id => [id, highlight.saved.get(id)]));
    setEach(map, 200);
  }
  function highlightOn() {
    const ids = selectedIds();
    if (!ids.length) return say("Select the lights to highlight first", "warn");
    if (highlight) putBack(highlight.ids);
    highlight = { saved: new Map(), ids, at: -1 };
    rememberOf(ids);
    lit(ids);
    return say(`Highlight: ${ids.length} light${ids.length === 1 ? "" : "s"} full, open white · next / last to go one at a time · highlight off to finish`);
  }
  function step(direction) {
    if (!highlight) return say("Highlight some lights first, then next / last steps through them", "warn");
    const { ids } = highlight;
    putBack(ids);
    highlight.at = ((highlight.at < 0 && direction < 0 ? 0 : highlight.at + direction) % ids.length + ids.length) % ids.length;
    const id = ids[highlight.at];
    setTimeout(() => {
      lit([id]);
      S().selected = new Set(ids); // (still the whole set, for next/last)
      window.renderFixtures?.();
    }, 220);
    return say(`Light ${numberOf(id)} (${highlight.at + 1} of ${ids.length}) · next / last · highlight off`);
  }
  function highlightOff() {
    if (!highlight) return say("Highlight isn't on", "info");
    putBack(highlight.ids);
    const n = highlight.ids.length;
    highlight = null;
    return say(`Highlight off — ${n} light${n === 1 ? "" : "s"} back as they were (position changes kept)`);
  }

  // --- the commands -----------------------------------------------------------------

  const CUES = "(\\d+(?:\\.\\d+)?(?:\\s*(?:thru|through|-|–|>)\\s*\\d+(?:\\.\\d+)?)?(?:\\s*,\\s*\\d+(?:\\.\\d+)?)*)";
  const PART = "(?:\\s+(intensity|level|levels|dimmer|colou?rs?|position|positions|focus|pan|tilt|beam|gobos?|zoom))?";
  function handle(raw) {
    const c = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    let m;
    if ((m = c.match(new RegExp(`^(?:recall|copy) from(?: cue)? (\\d+(?:\\.\\d+)?)${PART}$`)))) return recallFrom(m[1], partNamed(m[2])), true;
    if ((m = c.match(new RegExp(`^apply to(?: cues?)? ${CUES}${PART}$`)))) return applyTo(m[1], partNamed(m[2])), true;
    if ((m = c.match(new RegExp(`^update cues? ${CUES} (?:only )?selected${PART}$`)))) return applyTo(m[1], partNamed(m[2])), true;
    if ((m = c.match(/^copy (\d+) to ((?:\d+(?:\s*(?:thru|through|-|–)\s*\d+)?[\s,]*)+)$/))) return copyLight(m[1], m[2]), true;
    if ((m = c.match(/^(?:(.+?) )?@ ?(\d{1,3}) ?(?:thru|through|>) ?(\d{1,3})$/))) {
      const a = Math.min(100, Number(m[2])), b = Math.min(100, Number(m[3]));
      return fan(m[1], a, b), true;
    }
    if (/^(?:highlight|hl)$/.test(c)) return highlightOn(), true;
    if (/^(?:highlight|hl) off$|^(?:unhighlight|rem hl)$/.test(c)) return highlightOff(), true;
    // ("next" is GO, except while highlighting.)
    if (c === "next" && highlight) return step(1), true;
    if ((c === "last" || c === "prev" || c === "previous") && highlight) return step(-1), true;
    return false;
  }

  function install() {
    const previous = window.parseCommand;
    if (typeof previous !== "function") return setTimeout(install, 300);
    const wrapped = function (raw) {
      try { if (handle(raw)) return; } catch (error) { say(`That didn't work: ${error.message}`, "error"); return; }
      return previous.apply(this, arguments);
    };
    Object.assign(wrapped, previous);
    window.parseCommand = wrapped; // once, never re-wrapped
  }
  // (js/command-line.js, in front of everything, asks handle() first too.)
  if (document.readyState === "complete") install(); else window.addEventListener("load", install, { once: true });

  window.LXFastProgramming = Object.freeze({ handle, recallFrom, applyTo, copyLight, fan, highlightOn, highlightOff, step, get highlighting() { return Boolean(highlight); } });
})();
