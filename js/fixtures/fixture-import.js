"use strict";
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.v2";
  const norm = v => String(v ?? "").replace(/\s+/g, " ").trim();
  const lower = v => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");
  const readStored = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } };
  const writeStored = v => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { console.warn("[FixtureImport] save failed", e); } };

  function channelMap(channel) {
    const type = lower(channel?.type || channel?.attribute || channel?.name);
    const color = lower(channel?.color || channel?.colour || channel?.colorName);
    const text = `${type} ${color}`;
    if (color.includes("red") || text.includes("coloraddr")) return "r";
    if (color.includes("green") || text.includes("coloraddg")) return "g";
    if (color.includes("blue") || text.includes("coloraddb")) return "b";
    if (color.includes("white") || text.includes("coloraddw")) return "w";
    if (color.includes("amber") || text.includes("coloradda")) return "amber";
    if (color.includes("lime")) return "lime";
    if (color.includes("cyan")) return "cyan";
    if (color.includes("magenta")) return "magenta";
    if (color.includes("yellow")) return "yellow";
    if (color === "uv" || color.includes("ultraviolet")) return "uv";
    if (type.includes("pan") && !type.includes("tilt")) return "pan";
    if (type.includes("tilt")) return "tilt";
    if (type.includes("dimmer") || type.includes("intensity")) return "intensity";
    if (type.includes("shutter") || type.includes("strobe")) return "strobe";
    if (type.includes("zoom")) return "zoom";
    if (type.includes("focus")) return "focus";
    if (type.includes("iris")) return "iris";
    if (type.includes("frost")) return "frost";
    if (type.includes("prism")) return type.includes("rotation") ? "prismr" : "prism";
    if (type.includes("gobo")) return type.includes("rotation") ? "gobor" : "gobo";
    if (type.includes("effect")) return "effect";
    if (type.includes("speed") || type.includes("rate")) return "speed";
    if (type.includes("colormacro")) return "colmacro";
    if (type === "macro") return "macro";
    if (type.includes("temperature") || type === "cct" || type === "cto" || type === "ctb" || type === "ctc") return "cct";
    if (type.includes("fog")) return "fog";
    if (type.includes("haze")) return "haze";
    return null;
  }
  function channelsOf(mode) { if (Array.isArray(mode?.channels)) return mode.channels; if (mode?.channels && typeof mode.channels === "object") return Object.values(mode.channels); return []; }
  function modesOf(f) { if (Array.isArray(f?.modes)) return f.modes; if (f?.mode && typeof f.mode === "object") return [f.mode]; return []; }
  function definition(fixture, mode) {
    const channels = channelsOf(mode); if (!channels.length) throw new Error("No DMX channels in selected OFL mode.");
    const map = {};
    channels.forEach((ch, i) => { const k = channelMap(ch); if (k && map[k] === undefined) map[k] = i; });
    if (map.intensity !== undefined) map.dimmer ??= map.intensity;
    if (map.dimmer !== undefined) map.intensity ??= map.dimmer;
    if (!Object.keys(map).length) throw new Error("OFL mode contains channels, but no supported attributes were recognised.");
    let type = "dimmer";
    if (map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined) type = "moving";
    else if (map.r !== undefined || map.g !== undefined || map.b !== undefined || map.w !== undefined || map.amber !== undefined) type = map.w !== undefined ? "rgbw" : "rgb";
    else if (map.strobe !== undefined && map.intensity === undefined) type = "strobe";
    return { type, channels: channels.length, map, photometrics: { verified: false, sourceType: fixture?.physical?.bulb?.type || "UNKNOWN", ratedLumens: Number.isFinite(Number(fixture?.physical?.bulb?.lumens)) ? Number(fixture.physical.bulb.lumens) : null, beamAngle: null, beamAngleMin: null, beamAngleMax: null, outputScale: 1, manufacturer: fixture?.manufacturer || undefined, model: fixture?.name || undefined, sourceNote: "Imported from Open Fixture Library JSON. Verify the mode against the fixture manual." }, importedFrom: "Open Fixture Library", importedAt: new Date().toISOString(), importMeta: { mode: norm(mode?.name || mode?.shortName || "") } };
  }
  function fixtureObject(parsed) { return parsed?.fixture && typeof parsed.fixture === "object" ? parsed.fixture : parsed?.fixtureDefinition && typeof parsed.fixtureDefinition === "object" ? parsed.fixtureDefinition : parsed; }
  function importFixtureJson(parsed) {
    const f = fixtureObject(parsed); const modes = modesOf(f); if (!modes.length) throw new Error("No DMX modes were found.");
    const manufacturer = norm(f.manufacturer || parsed.manufacturer || "Imported"); const base = norm(f.name || f.longName || f.shortName || parsed.name); if (!base) throw new Error("Fixture has no name.");
    const stored = readStored(), names = [];
    modes.forEach((mode, i) => { const modeName = norm(mode?.name || mode?.shortName || `Mode ${i + 1}`); const name = (modes.length === 1 ? `${manufacturer} ${base}` : `${manufacturer} ${base} (${modeName})`).trim(); const def = definition(f, mode); FixtureLibrary[name] = def; stored[name] = def; names.push(name); });
    writeStored(stored); window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || ""); return names;
  }
  function restore() { const stored = readStored(); Object.entries(stored).forEach(([n, d]) => { if (!FixtureLibrary[n] && d && typeof d === "object") FixtureLibrary[n] = d; }); }
  function picker() { const input = document.createElement("input"); input.type = "file"; input.accept = ".json,.txt,application/json,text/plain"; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { const names = importFixtureJson(JSON.parse(await file.text())); window.log?.(`Imported ${names.length} OFL fixture mode${names.length === 1 ? "" : "s"}.`, "ok"); } catch (e) { console.error("[FixtureImport]", e); window.log?.(`Fixture import failed: ${e.message}`, "error"); } }; input.click(); }
  function install() { if (document.getElementById("btnImportFixture")) return; const panel = document.getElementById("page-patch")?.querySelector(".panel:first-child .panel-body"); if (!panel) return false; const row = document.createElement("div"); row.className = "action-row"; row.style.marginTop = "10px"; row.innerHTML = '<button class="btn-secondary" id="btnImportFixture" type="button">⇩ Import Fixture JSON</button><span class="panel-meta" style="align-self:center">OFL / compatible JSON</span>'; panel.appendChild(row); document.getElementById("btnImportFixture").onclick = picker; return true; }
  function loadMA2() { if (window.MA2FixtureImport || document.getElementById("ma2ImportLoader")) return; const s = document.createElement("script"); s.id = "ma2ImportLoader"; s.src = "js/fixtures/ma2-import.js"; s.onload = () => console.log("✅ MA2 fixture importer loaded"); s.onerror = e => console.error("❌ MA2 fixture importer failed to load", e); document.head.appendChild(s); }
  restore(); install(); loadMA2(); window.FixtureImport = { importFixtureJson, openPicker: picker, restoreStoredFixtures: restore }; window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || "");
})();
