// Command line suggestions: every command the desk understands, completed
// as you type, with what's in this show filled in (cue numbers and names,
// fixtures, groups, palettes, chases, effects, targets, colours).
//
// The list sits above the command line whenever it has focus, empty or not,
// and always shows everything that could come next. The best match is also
// shown greyed out after what you've typed.
//
//   Tab or →      take the highlighted suggestion (→ only at the end)
//   ↑ ↓           move through the list (in an empty box ↑ is history)
//   Enter         run the command (or, after ↑/↓, take that suggestion)
//   Esc           hide the list until you type again
//
// The grammar: each command is a pattern of words and slots, e.g.
// "record cue <cuenew> <text?>". Typing is matched against every pattern;
// whatever can come next where the cursor is becomes a suggestion.
(function () {
  if (window.LXAutocomplete) return;
  const S = () => window.State || {};
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------ grammar

  const COMMANDS = [
    // Playback
    ["go", "play the next cue", "Playback"], ["go <cue>", "jump to a cue", "Playback"], ["back", "the previous cue", "Playback"],
    ["cue <cue>", "go to a cue", "Playback"], ["sneak <sec?>", "fade back to the live cue", "Playback"], ["fade <cue> <sec>", "set a cue's fade time", "Playback"],
    ["blackout", "everything off (again to undo)", "Playback"], ["full", "everything on", "Playback"], ["release", "release everything", "Playback"],
    // Recording
    ["record cue <cuenew> <text?>", "record what's on stage as a cue", "Cues"], ["record <cuenew> <text?>", "record a cue", "Cues"],
    ["update cue <cue>", "save the stage into a cue", "Cues"], ["update cue <cue> name <text>", "rename a cue", "Cues"],
    ["update cue <cue> fade <sec>", "change a cue's fade", "Cues"], ["update cue <cue> follow <sec|off>", "change a cue's follow", "Cues"],
    ["rename cue <cue> <text>", "rename a cue", "Cues"], ["delete cue <cue>", "remove a cue", "Cues"],
    ["copy cue <cue> to <cuenew> <text?>", "copy a cue to a new number", "Cues"], ["move cue <cue> to <cuenew>", "renumber a cue", "Cues"],
    ["insert cue <cue>", "load a cue into the Control Deck", "Cues"], ["block cue <cue>", "a cue stores its whole look", "Cues"],
    ["track cue <cue>", "a cue stores only what changed", "Cues"], ["follow cue <cue> <sec|off>", "auto-GO after a cue finishes", "Cues"],
    ["list cues", "every cue in the log", "Cues"], ["cue list", "the Cue List window", "Cues"], ["mib <on|off>", "move in black on or off", "Cues"],
    // Cue options
    ["cue <cue> up <sec>", "intensity up time", "Cue options"], ["cue <cue> down <sec>", "intensity down time", "Cue options"],
    ["cue <cue> move <sec>", "pan/tilt time", "Cue options"], ["cue <cue> colour <sec>", "colour time", "Cue options"], ["cue <cue> beam <sec>", "beam time (gobo, zoom…)", "Cue options"],
    ["cue <cue> delay <sec>", "wait before fading", "Cue options"], ["cue <cue> curve <curve>", "the shape of the fade", "Cue options"],
    ["cue <cue> rate <pct>", "play faster or slower", "Cue options"], ["cue <cue> follow <sec>", "next cue N s after its GO", "Cue options"],
    ["cue <cue> hang <sec>", "next cue N s after it finishes", "Cue options"], ["cue <cue> wait", "waits for GO", "Cue options"],
    ["cue <cue> link <cue|off>", "after it, GO jumps to a cue", "Cue options"], ["cue <cue> loop <count>", "how many times the link loops", "Cue options"],
    ["cue <cue> disable", "GO skips it", "Cue options"], ["cue <cue> enable", "GO plays it again", "Cue options"],
    ["cue <cue> scene <text>", "a scene heading", "Cue options"], ["cue <cue> note <text>", "a note on the cue", "Cue options"],
    ["cue <cue> command <command>", "run a command when it GOes", "Cue options"], ["cue <cue> curtain <curtainstate>", "the cue opens or closes the curtain", "Cue options"], ["cue <cue> go", "go to a cue", "Cue options"],
    ["timecode cue <cue> <tc>", "fire a cue at a timecode", "Timecode"], ["tc cue <cue> <tc>", "fire a cue at a timecode", "Timecode"],
    // Selection and levels (the rest is in the selection grammar below)
    ["group <group>", "select a group", "Select"], ["group <group> @ <level>", "a group to a level", "Select"],
    ["group = <text>", "make a group from the selection (or: name and fixture numbers)", "Select"], ["delete group <group>", "remove a group", "Select"],
    ["list groups", "every group in the log", "Select"], ["@ <level>", "the selected fixtures to a level", "Levels"], ["@ <level> thru <level>", "fan: levels spread across the selection", "Levels"],
    ["recall from cue <cue>", "the selected lights take their look from a cue", "Programming"], ["recall from cue <cue> <part>", "…just their intensity, colour, position or beam", "Programming"],
    ["apply to cue <cue> thru <cue>", "your changes to the selected lights go into those cues", "Programming"], ["apply to cue <cue> <part>", "…just one part", "Programming"],
    ["copy <fixture> to <fixture> thru <fixture>", "one light's look onto others", "Programming"],
    ["highlight", "selected lights full, open white (next / last step through them)", "Programming"], ["highlight off", "back as they were", "Programming"],
    ["clear", "deselect everything", "Select"], ["clear programmer", "drop hand changes, back to the live cue", "Select"], ["rem dim", "everything not selected to 0", "Levels"],
    ["undo", "undo a level change", "Levels"], ["redo", "redo it", "Levels"],
    // Palettes, chases, effects, targets
    ["palette <palette>", "apply a palette", "Palettes"], ["record palette <text>", "save the selection's look as a palette", "Palettes"],
    ["update palette <palette>", "re-record a palette", "Palettes"], ["delete palette <palette>", "remove a palette", "Palettes"],
    ["run chase <chase>", "start a chase", "Chases"], ["chase <chase>", "start a chase", "Chases"], ["stop chase", "stop the chase", "Chases"],
    ["delete chase <chase>", "remove a chase", "Chases"], ["new chase", "make a chase", "Chases"], ["chase <number> = <cuelist>", "a chase through cues", "Chases"],
    ["run effect <effect>", "start an effect", "Effects"], ["effect <effect>", "start an effect", "Effects"], ["stop effect", "stop effects", "Effects"],
    ["new effect", "make an effect", "Effects"], ["delete effect <effect>", "remove an effect", "Effects"],
    ["targets", "list targets", "Targets"], ["target create <text>", "a new target", "Targets"], ["target aim <target>", "aim the selection at a target", "Targets"],
    ["target capture <target>", "lock lights onto a target", "Targets"], ["target release <target>", "unlock a target", "Targets"], ["target delete <target>", "remove a target", "Targets"],
    // Stage
    ["viz", "the 3D visualiser", "Stage"], ["curtain <curtain>", "the curtain in the visualiser", "Stage"], ["curtain <curtain> over <sec>", "…taking this long", "Stage"],
    ["haze <level>", "every hazer", "Stage"], ["fog <level>", "every fog machine", "Stage"], ["fan <level>", "hazer / fog fans", "Stage"], ["fluid <level>", "hazer fluid pumps", "Stage"],
    ["focus <metres> <metres>", "point & shoot: across, depth", "Stage"], ["fixture check <fixture?>", "step through every light", "Stage"],
    // Timecode
    ["timecode", "the Timecode window", "Timecode"], ["timecode <tcsource>", "where timecode comes from", "Timecode"],
    ["tc play", "start the internal clock", "Timecode"], ["tc pause", "pause it", "Timecode"], ["tc stop", "stop it", "Timecode"], ["tc locate <tc>", "jump the clock", "Timecode"],
    // Info
    ["info <fixture>", "what a fixture is doing, and why", "Info"], ["locate <fixture>", "a fixture full, white, centred", "Info"],
    ["address <fixture>", "where a fixture is patched", "Info"], ["dmx <fixture>", "the DMX a fixture is sending", "Info"],
    ["errors", "what's gone wrong this session", "Info"], ["errors clear", "start counting again", "Info"], ["check", "health check", "Info"],
    ["stats", "running time, GOs, errors", "Info"], ["clashes", "overlapping addresses", "Info"], ["history", "the last commands", "Info"],
    ["status", "what's loaded", "Info"], ["version", "which Light Spark this is", "Info"], ["help", "every command, with examples", "Info"],
    // Show
    ["save <text?>", "save the show", "Show"], ["load <text?>", "open a show", "Show"], ["auto create", "groups, palettes, effects and chases", "Show"],
    ["update", "check for a new Light Spark", "Show"], ["take control", "a backup console takes over", "Show"], ["take control back", "the primary takes over again", "Show"],
    ["artnet", "Art-Net output", "Show"]
  ];

  const PARAMS = ["pan", "tilt", "zoom", "focus", "frost", "iris", "gobo", "prism", "strobe"];
  const LEVELS = [["full", "100%"], ["out", "0%"], ["50", ""], ["75", ""], ["25", ""], ["+10", "up 10%"], ["-10", "down 10%"], ["half", "50%"]];
  const colours = () => Object.keys(typeof cueColours === "object" ? cueColours : {});
  const fixtures = () => (S().fixtures || []).filter(Boolean).slice().sort((a, b) => (Number(a.fixtureNumber) || 0) - (Number(b.fixtureNumber) || 0));
  const named = list => (list || []).filter(x => x && x.name);
  const cueList = () => (S().cues || []).map((c, i) => (c ? { n: window.cueLabel ? window.cueLabel(i) : String(i + 1), name: c.name || "" } : null)).filter(Boolean);

  // What a slot can be: [value, description] pairs. `typed` is what's been
  // typed for it so far (for open-ended numbers).
  function slotValues(type) {
    switch (type) {
      case "cue": return cueList().map(c => [c.n, c.name, "CUE"]);
      case "cuenew": {
        const out = [];
        const next = window.nextCueNumber ? window.nextCueNumber() : cueList().length + 1;
        out.push([String(next), "the next cue number", "NEW"]);
        // In between the live cue and the one after it.
        const s = S(), live = s.currentCue;
        if (live >= 0 && window.cueNumberBetween) {
          const between = window.cueNumberBetween(window.cueNumberOf(live), s.cues[live + 1] ? window.cueNumberOf(live + 1) : null);
          if (between != null && String(between) !== String(next)) out.push([window.formatCueNumber(between), `after the live cue ${window.cueLabel(live)}`, "NEW"]);
        }
        for (const c of cueList()) out.push([c.n, `replace “${c.name}”`, "CUE"]);
        return out;
      }
      case "fixture": return fixtures().map(f => [String(f.fixtureNumber), f.name, "FIXTURE"]);
      case "group": return named(S().groups).map(g => [g.name, `${(g.members || []).length} fixtures`, "GROUP"]);
      case "palette": return named(S().palettes).map(p => [p.name, p.category || "palette", "PALETTE"]);
      case "chase": return (S().chases || []).map((c, i) => (c ? [String(i + 1), c.name || "", "CHASE"] : null)).filter(Boolean);
      case "effect": return Object.keys(S().savedEffects || {}).map((name, i) => [String(i + 1), name, "EFFECT"]);
      case "target": return named(window.Targets?.list?.() || S().targets).map(t => [t.name, "target", "TARGET"]);
      case "colour": return colours().map(c => [c, "colour", "COLOUR"]);
      case "curve": return (window.CUE_CURVES || ["smooth", "linear", "in", "out", "snap"]).map(c => [c, { smooth: "S-curve", linear: "even", in: "slow start", out: "slow end", snap: "instant" }[c] || "", "CURVE"]);
      case "level": return LEVELS.map(([v, d]) => [v, d, "LEVEL"]);
      case "part": return [["intensity", "levels only"], ["colour", "colour only"], ["position", "pan & tilt only"], ["beam", "gobo, zoom, focus…"]].map(([v, d]) => [v, d, "PART"]);
      case "sec": return [["1", "second"], ["2", "seconds"], ["3", "seconds"], ["5", "seconds"], ["0.5", "seconds"], ["10", "seconds"]].map(([v, d]) => [v, d, "SECONDS"]);
      case "pct": return [["150", "% — faster"], ["200", "% — twice as fast"], ["50", "% — half speed"], ["100", "% — normal"]].map(([v, d]) => [v, d, "RATE"]);
      case "count": return [["2", "times"], ["3", "times"], ["0", "forever"]].map(([v, d]) => [v, d, "LOOPS"]);
      case "curtain": return [["open", "open the curtain"], ["close", "close the curtain"], ["toggle", "open ↔ close"], ["50", "% open"]].map(([v, d]) => [v, d, "CURTAIN"]);
      case "curtainstate": return [["open", "the cue opens it"], ["close", "the cue closes it"], ["leave", "the cue doesn't move it"]].map(([v, d]) => [v, d, "CURTAIN"]);
      case "tcsource": return [["mtc", "MIDI timecode"], ["ltc", "audio timecode"], ["internal", "Light Spark's clock"], ["off", "no timecode"]].map(([v, d]) => [v, d, "SOURCE"]);
      case "metres": return [["0", "metres"], ["2", "metres"], ["-2", "metres"]].map(([v, d]) => [v, d, "METRES"]);
      case "number": return [["1", ""], ["2", ""], ["3", ""]].map(([v, d]) => [v, d, "NUMBER"]);
      default: return [];
    }
  }
  // Whether a typed word is a valid value for an open-ended slot.
  const NUMERIC = { sec: /^\d*\.?\d+$/, pct: /^\d*\.?\d+%?$/, count: /^\d+$/, number: /^\d+$/, metres: /^-?\d*\.?\d+$/, level: /^([+-]?\d*\.?\d+|full|fl|out|off|half)$/, cuenew: /^(\d+(\.\d+)?|\.\d+)$/, tc: /^[\d:;.]+$/ };
  const FREE = new Set(["text", "command", "cuelist", "tc"]);
  const PLACEHOLDER = { text: "name", command: "any command", cuelist: "1, 2, 3", tc: "00:01:30:00" };

  // Patterns, split into words: { lit: ["off"] } or { slot: "cue", optional }.
  // "<sec|off>" is a slot with extra literal choices.
  function compile(pattern) {
    return pattern.split(" ").map(word => {
      const m = word.match(/^<(\w+)((?:\|\w+)*)(\?)?>$/);
      if (!m) return { lit: word.split("|") };
      return { slot: m[1], extra: m[2] ? m[2].slice(1).split("|") : [], optional: Boolean(m[3]) };
    });
  }
  const GRAMMAR = COMMANDS.map(([pattern, desc, group]) => ({ pattern, desc, group, parts: compile(pattern) }));

  // ----------------------------------------------------------- matching

  // The values a part can take, best first.
  function partValues(part) {
    if (part.lit) return part.lit.map(v => [v, "", "WORD"]);
    return [...part.extra.map(v => [v, "", "WORD"]), ...slotValues(part.slot)];
  }
  // How a slot can consume the start of `rest` (lower case). Returns the
  // length used, or -1. Names can be several words.
  function consume(part, rest) {
    const word = rest.match(/^\S+/)?.[0] || "";
    if (part.lit) { for (const v of part.lit) if (rest === v || rest.startsWith(v + " ")) return v.length; return -1; }
    for (const v of part.extra) if (rest === v || rest.startsWith(v + " ")) return v.length;
    if (FREE.has(part.slot)) return rest.length; // the rest of the line
    if (NUMERIC[part.slot]) return NUMERIC[part.slot].test(word) ? word.length : -1;
    // A known value (longest first, so "front whites" beats "front").
    const values = partValues(part).map(([v]) => String(v).toLowerCase()).sort((a, b) => b.length - a.length);
    for (const v of values) if (rest === v || rest.startsWith(v + " ")) return v.length;
    return -1;
  }

  // Suggestions for `text` from one pattern: each is { value, desc, tag, rest }
  // where value is the whole new command line.
  function fromPattern(rule, text) {
    const out = [];
    const lower = text.toLowerCase();
    const walk = (k, pos) => {
      const rest = lower.slice(pos).replace(/^\s+/, "");
      const at = lower.length - rest.length; // where `rest` starts in the text
      if (k >= rule.parts.length) return; // the whole pattern is typed
      const part = rule.parts[k];
      const ends = !/\s$/.test(lower) && !rest.includes(" ");
      // The cursor is in (or right before) this part: suggest its values.
      if (!rest.trim() || ends) {
        const typed = rest.trim();
        const hint = rule.parts.slice(k + 1).map(p => (p.lit ? p.lit[0] : `[${PLACEHOLDER[p.slot] || p.slot}]`)).join(" ");
        if (part.slot && FREE.has(part.slot)) {
          if (!typed) out.push({ value: null, desc: `type ${PLACEHOLDER[part.slot]}`, tag: rule.group.toUpperCase(), shown: text.slice(0, at) + `[${PLACEHOLDER[part.slot]}]`, rule });
          return;
        }
        // A run of plain words completes in one go ("rec" → "record cue").
        let chain = "";
        let j = k + 1;
        if (part.lit) while (j < rule.parts.length && rule.parts[j].lit && rule.parts[j].lit.length === 1) chain += " " + rule.parts[j++].lit[0];
        const after = rule.parts.slice(j).map(p => (p.lit ? p.lit[0] : `[${PLACEHOLDER[p.slot] || p.slot}]`)).join(" ");
        for (const [v, d, tag] of partValues(part)) {
          const value = String(v);
          if (typed && !value.toLowerCase().startsWith(typed)) continue;
          if (typed && value.toLowerCase() === typed && !chain && k === rule.parts.length - 1) {
            // Already complete: still offered, so the list shows it's right.
          }
          const full = text.slice(0, at) + value + chain;
          out.push({ value: full + (j < rule.parts.length || part.slot ? " " : ""), desc: part.lit ? rule.desc : d || rule.desc, tag: part.lit ? rule.group.toUpperCase() : tag, hint: (part.lit ? after : hint) || "", rule });
        }
        // Open-ended numbers: what's typed is fine as it is.
        if (part.slot && NUMERIC[part.slot] && typed && NUMERIC[part.slot].test(typed) && !out.some(s => s.value && s.value.trim() === (text.slice(0, at) + typed))) {
          out.push({ value: text.slice(0, at) + typed + (k < rule.parts.length - 1 ? " " : ""), desc: rule.desc, tag: part.slot.toUpperCase(), hint, rule });
        }
        if (part.optional && !typed) walk(k + 1, pos);
        return;
      }
      const used = consume(part, rest);
      if (used >= 0) walk(k + 1, at + used);
      if (part.optional) walk(k + 1, pos);
    };
    walk(0, 0);
    return out;
  }

  // Free-form selection: "1 thru 10 + 12 @ 50 red time 3", "group front @ full".
  function fromSelection(text) {
    const lower = text.toLowerCase().replace(/@/g, " @ ").replace(/\s+/g, " ");
    const words = lower.trim().split(" ").filter(Boolean);
    if (!words.length) return [];
    const startsSelection = /^\d/.test(words[0]) || words[0] === "@" || words[0] === "at" ||
      named(S().groups).some(g => lower.trimStart().startsWith(g.name.toLowerCase() + " "));
    if (!startsSelection) return [];
    const ended = /\s$/.test(text);
    const done = ended ? words : words.slice(0, -1);
    const typed = ended ? "" : words[words.length - 1];
    const last = done[done.length - 1] || "";
    const before = text.slice(0, ended ? text.length : text.length - typed.length);
    const out = [];
    const add = (v, d, tag) => {
      if (typed && !String(v).toLowerCase().startsWith(typed)) return;
      out.push({ value: before + v + " ", desc: d, tag });
    };
    const fixtureList = after => fixtures().filter(f => !after || Number(f.fixtureNumber) > after).forEach(f => add(String(f.fixtureNumber), f.name, "FIXTURE"));
    if (last === "thru") { fixtureList(Number(done[done.length - 2]) || 0); return out; }
    if (last === "+" || last === "-") { fixtureList(0); named(S().groups).forEach(g => add(g.name, "group", "GROUP")); return out; }
    if (last === "@" || last === "at") { LEVELS.forEach(([v, d]) => add(v, d || "level", "LEVEL")); return out; }
    if (PARAMS.includes(last)) { (last === "strobe" ? [["off", "stop"], ["120", ""], ["200", "fast"]] : [["0", ""], ["64", ""], ["128", "centre"], ["192", ""], ["255", ""]]).forEach(([v, d]) => add(v, d || "0–255", "VALUE")); return out; }
    if (last === "time") { [["1", "s"], ["2", "s"], ["3", "s"], ["5", "s"]].forEach(([v, d]) => add(v, `seconds`, "SECONDS")); return out; }
    // After a fixture number or group: build the selection, or act on it.
    if (/^\d/.test(typed) || (!typed && /^\d/.test(last) && !done.includes("@") && !done.includes("at"))) {
      if (/^\d/.test(typed)) { fixtureList(0); return out; }
    }
    const selecting = !done.includes("@") && !done.includes("at");
    if (selecting) {
      add("@", "set a level", "LEVEL");
      if (/^\d+$/.test(last) && done[done.length - 2] !== "thru") add("thru", "a range of fixtures", "SELECT");
      add("+", "and another", "SELECT");
      add("-", "except", "SELECT");
    }
    colours().forEach(c => add(c, "colour", "COLOUR"));
    named(S().palettes).forEach(p => add(`palette ${p.name}`, "palette", "PALETTE"));
    PARAMS.forEach(p => add(p, "0–255", "PARAM"));
    add("home", "pan and tilt to centre", "MOVE");
    if (!selecting) add("time", "fade over seconds", "TIME");
    if (selecting) { add("full", "100%", "LEVEL"); add("out", "0%", "LEVEL"); add("info", "what it's doing", "INFO"); add("rem dim", "everything else to 0", "LEVEL"); }
    return out;
  }

  // Everything that could come next, best first, no repeats.
  function suggest(text) {
    const lower = text.toLowerCase();
    let list = [];
    for (const rule of GRAMMAR) list.push(...fromPattern(rule, text));
    list.push(...fromSelection(text));
    // Typing a fixture number on its own: the fixture.
    const first = lower.trim();
    const oneWord = Boolean(first) && !/\s/.test(lower);
    if (/^\d+$/.test(first) && !/\s$/.test(lower)) for (const f of fixtures()) if (String(f.fixtureNumber).startsWith(first)) list.push({ value: `${f.fixtureNumber} `, desc: f.name, tag: "FIXTURE" });
    // Group names straight away ("front whites @ 50").
    if (first && !first.includes(" ")) for (const g of named(S().groups)) if (g.name.toLowerCase().startsWith(first)) list.push({ value: `${g.name} `, desc: `group · ${(g.members || []).length} fixtures`, tag: "GROUP" });
    const phrase = rule => rule.parts.filter(p => p.lit).map(p => p.lit[0]).join(" ");
    const commandRow = rule => ({ value: rule.parts.map(p => (p.lit ? p.lit[0] : "")).filter(Boolean).join(" ") + " ", desc: rule.desc, tag: rule.group.toUpperCase(), hint: rule.pattern.replace(/^[a-z |=@]+?(?=<|$)/, "").replace(/<(\w+)[^>]*>/g, (_, s) => `[${PLACEHOLDER[s] || s}]`) });
    if (oneWord && first.length >= 3) {
      // Things in this show by name: "storm" → go to the Storm cue.
      const word = first.toLowerCase();
      cueList().forEach(c => { if (c.name.toLowerCase().includes(word)) list.push({ value: `go ${c.n}`, desc: `cue ${c.n} “${c.name}”`, tag: "CUE" }); });
      named(S().palettes).forEach(p => { if (p.name.toLowerCase().includes(word)) list.push({ value: `palette ${p.name}`, desc: "apply this palette to the selection", tag: "PALETTE" }); });
      fixtures().forEach(f => { if (String(f.name).toLowerCase().includes(word)) list.push({ value: `${f.fixtureNumber} `, desc: f.name, tag: "FIXTURE" }); });
    }
    // Words anywhere in a command, so "curt" or "tain" finds "curtain open".
    if (oneWord && first.length >= 2) {
      for (const rule of GRAMMAR) { const lit = phrase(rule); if (!lit.startsWith(first) && lit.includes(first)) list.push(commandRow(rule)); }
    }
    // Still nothing: letters in order ("hz" → haze, "rcq" → record cue).
    if (oneWord && !list.length) {
      const fuzzy = new RegExp(first.split("").map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
      for (const rule of GRAMMAR) if (fuzzy.test(phrase(rule))) list.push(commandRow(rule));
    }
    // One row per completion ("go" and "go [cue]" are one row: go, then a cue).
    const seen = new Map();
    list = list.filter(s => {
      const key = (s.value ?? s.shown).trimEnd().toLowerCase();
      const had = seen.get(key);
      if (had) { if (!had.hint && s.hint) had.hint = s.hint; if (s.value && /\s$/.test(s.value)) had.value = s.value; return false; }
      seen.set(key, s);
      return true;
    });
    // Exact-prefix first, then by how short the completion is.
    const t = lower;
    return list.map((s, i) => ({ s, i, score: (s.value && s.value.toLowerCase().startsWith(t) ? 0 : 1) })).sort((a, b) => a.score - b.score || a.i - b.i).map(x => x.s);
  }

  // --------------------------------------------------------------- the box

  let input = null, box = null, ghost = null, items = [], index = 0, picked = false, hidden = false, lastTyped = "";
  // Compact (about six rows, beside the command line) unless made bigger.
  let big = false;
  try { big = localStorage.getItem("lxSuggestBig") === "1"; } catch (_) {}

  function render() {
    if (!input || !box) return;
    const text = input.value;
    if (hidden || document.activeElement !== input) { box.hidden = true; ghost.textContent = ""; return; }
    items = suggest(text);
    if (index >= items.length) index = 0;
    box.hidden = false;
    const typed = text.toLowerCase();
    box.innerHTML = `<div class="lxs-list">${items.slice(0, 200).map((s, i) => {
      const value = s.value ?? s.shown;
      const shown = esc(value.trimEnd());
      const match = s.value && value.toLowerCase().startsWith(typed) ? `<b>${esc(value.slice(0, text.length))}</b>${esc(value.slice(text.length).trimEnd())}` : shown;
      return `<div class="lxs-item${i === index ? " on" : ""}${s.value ? "" : " lxs-placeholder"}" data-i="${i}"><span class="lxs-cmd">${match}${s.hint ? ` <i>${esc(s.hint)}</i>` : ""}</span><span class="lxs-desc">${esc(s.desc || "")}</span><span class="lxs-tag">${esc(s.tag || "")}</span></div>`;
    }).join("") || `<div class="lxs-empty">Nothing matches — press Enter to try it anyway, or type help</div>`}</div>
      <div class="lxs-foot"><span>${items.length} suggestion${items.length === 1 ? "" : "s"} · <kbd>Tab</kbd> complete · <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Esc</kbd> hide</span><button type="button" class="lxs-size" title="${big ? "Make the list smaller" : "Show more of the list"}">${big ? "▾ smaller" : "▴ bigger"}</button></div>`;
    box.classList.toggle("big", big);
    box.querySelector(".lxs-item.on")?.scrollIntoView({ block: "nearest" });
    // Ghost: the rest of the best match, after the text.
    const best = items[index];
    const rest = best?.value && best.value.toLowerCase().startsWith(typed) && best.value.length > text.length ? best.value.slice(text.length) : "";
    ghost.innerHTML = rest ? `<span class="lxs-typed">${esc(text)}</span>${esc(rest)}` : "";
    syncGhost();
  }
  function syncGhost() {
    const cs = getComputedStyle(input);
    Object.assign(ghost.style, { font: cs.font, letterSpacing: cs.letterSpacing, paddingLeft: cs.paddingLeft, paddingTop: cs.paddingTop, left: `${input.offsetLeft}px`, top: `${input.offsetTop}px`, width: `${input.clientWidth}px`, height: `${input.offsetHeight}px`, lineHeight: `${input.offsetHeight}px` });
    ghost.scrollLeft = input.scrollLeft;
  }

  function take(i = index) {
    const s = items[i];
    if (!s || !s.value) return false;
    input.value = s.value;
    lastTyped = input.value;
    input.setSelectionRange(input.value.length, input.value.length);
    picked = false; index = 0;
    input.dispatchEvent(new Event("input", { bubbles: true })); // the live preview updates
    return true;
  }

  function attach() {
    input = document.getElementById("cmdInput");
    const line = input?.closest(".cmd-line") || input?.parentElement;
    if (!input || !line) return setTimeout(attach, 300);
    if (input.dataset.lxSuggest) return;
    input.dataset.lxSuggest = "1";
    input.setAttribute("autocomplete", "off");
    line.style.position = "relative";
    box = document.createElement("div");
    box.id = "lxSuggest";
    box.hidden = true;
    line.appendChild(box);
    ghost = document.createElement("div");
    ghost.className = "lxs-ghost";
    input.parentElement.insertBefore(ghost, input);
    input.parentElement.style.position ||= "relative";

    input.addEventListener("input", () => { hidden = false; picked = false; index = 0; lastTyped = input.value; render(); });
    input.addEventListener("focus", () => { hidden = false; render(); });
    input.addEventListener("blur", () => setTimeout(render, 120));
    input.addEventListener("scroll", syncGhost);
    box.addEventListener("mousedown", e => {
      if (e.target.closest(".lxs-size")) {
        e.preventDefault();
        big = !big;
        try { localStorage.setItem("lxSuggestBig", big ? "1" : "0"); } catch (_) {}
        render();
        return;
      }
      const row = e.target.closest(".lxs-item");
      if (!row) return;
      e.preventDefault();
      take(Number(row.dataset.i));
      render();
    });
    // Capture: ahead of the history and command handlers.
    document.addEventListener("keydown", e => {
      if (e.target !== input) return;
      // History set the text (no typing): leave the arrows to history.
      const fromHistory = input.value !== lastTyped;
      if (e.key === "Tab") {
        if (!items.length) return;
        e.preventDefault(); e.stopImmediatePropagation();
        take(); render(); return;
      }
      if (e.key === "ArrowRight" && input.selectionStart === input.value.length && ghost.textContent) {
        e.preventDefault(); take(); render(); return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && input.value.trim() && !fromHistory && items.length && !box.hidden) {
        e.preventDefault(); e.stopImmediatePropagation();
        index = (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        picked = true;
        render(); return;
      }
      if (e.key === "Enter" && picked && items[index]?.value) {
        // After choosing with the arrows, Enter takes it (press Enter again to run).
        e.preventDefault(); e.stopImmediatePropagation();
        take(); render(); return;
      }
      if (e.key === "Escape" && !box.hidden) { e.preventDefault(); hidden = true; render(); return; }
      if (e.key === "Enter") { hidden = true; setTimeout(() => { hidden = false; lastTyped = input.value; if (document.activeElement === input) render(); }, 0); }
    }, true);
    // The show changes (new cues, groups…): keep the list current.
    setInterval(() => { if (document.activeElement === input && !box.hidden) { const was = index; render(); index = was; } }, 1500);
    if (document.activeElement === input) render();
  }

  const style = document.createElement("style");
  style.textContent = `
    #cmdAutocompleteList{display:none!important}
    #lxSuggest{position:absolute;left:0;width:min(640px,100%);bottom:calc(100% + 4px);z-index:9999;max-height:178px;display:flex;flex-direction:column;background:#0a0f12;border:1px solid #2b383f;border-radius:10px;box-shadow:0 -12px 32px rgba(0,0,0,.45);overflow:hidden;font:12px var(--sans,system-ui)}
    #lxSuggest[hidden]{display:none}
    #lxSuggest.big{width:auto;right:0;max-height:min(360px,55vh)}
    .lxs-list{overflow:auto;flex:1 1 auto;min-height:0;padding:3px}
    .lxs-foot{flex:none}
    .lxs-item{display:grid;grid-template-columns:minmax(150px,1.3fr) minmax(0,1fr) auto;gap:10px;align-items:center;padding:3px 8px;border-radius:5px;cursor:pointer;color:#b9c5c2;font-size:11.5px}
    #lxSuggest.big .lxs-item{padding:5px 9px;font-size:12px}
    .lxs-item:hover{background:#141c21}
    .lxs-item.on{background:rgba(25,214,163,.12);color:#edf4f2;box-shadow:inset 2px 0 0 #19d6a3}
    .lxs-cmd{font:500 12px var(--mono,monospace);color:#dfe7e5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lxs-cmd b{color:#19d6a3;font-weight:700}
    .lxs-cmd i{font-style:normal;color:#5d6b6e}
    .lxs-desc{color:#8b9aa1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lxs-tag{font:800 9px var(--sans,system-ui);letter-spacing:.08em;color:#6f7d7b;border:1px solid #243036;border-radius:9px;padding:2px 6px}
    .lxs-placeholder{cursor:default;opacity:.7}
    .lxs-empty{padding:10px;color:#8b9aa1}
    .lxs-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:3px 6px 3px 10px;border-top:1px solid #1d272c;color:#5d6b6e;font-size:10px;white-space:nowrap;overflow:hidden}
    .lxs-size{flex:none;height:18px;padding:0 7px;border:1px solid #2b383f;border-radius:4px;background:#0f1519;color:#8b9aa1;font:700 9.5px var(--sans,system-ui);cursor:pointer}
    .lxs-size:hover{color:#19d6a3;border-color:#19d6a3}
    .lxs-foot kbd{font:700 9.5px var(--mono,monospace);border:1px solid #2b383f;border-radius:3px;padding:0 4px;margin:0 1px;color:#8b9aa1}
    .lxs-ghost{position:absolute;pointer-events:none;color:#4f5d60;white-space:pre;overflow:hidden;box-sizing:border-box;z-index:0}
    .lxs-ghost .lxs-typed{color:transparent}
    #cmdInput{position:relative;z-index:1;background-color:transparent}`;
  document.head.appendChild(style);

  window.LXAutocomplete = Object.freeze({ suggest, hide: () => { hidden = true; render(); }, grammar: () => COMMANDS.map(([p, d, g]) => ({ pattern: p, desc: d, group: g })) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach, { once: true });
  else attach();
})();
