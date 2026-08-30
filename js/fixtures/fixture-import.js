"use strict";

/*
 * External fixture library importer.
 *
 * The console keeps its existing hand-written FixtureLibrary, but imported
 * Open Fixture Library (OFL) JSON profiles are added at runtime and persisted
 * locally. This deliberately uses a small adapter instead of depending on
 * OFL's internal JSON schema staying stable forever.
 */

(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.v1";

  const TYPE_MAP = {
    Intensity: "intensity",
    Dimmer: "intensity",
    ShutterStrobe: "strobe",
    Strobe: "strobe",
    StrobeSpeed: "speed",
    Red: "r",
    Green: "g",
    Blue: "b",
    White: "w",
    WarmWhite: "warmWhite",
    ColdWhite: "coolWhite",
    Amber: "amber",
    Lime: "lime",
    Cyan: "cyan",
    Magenta: "magenta",
    Yellow: "yellow",
    UV: "uv",
    Indigo: "indigo",
    Pan: "pan",
    Tilt: "tilt",
    PanTilt: "pan",
    PanTiltSpeed: "speed",
    PanSpeed: "speed",
    TiltSpeed: "speed",
    Zoom: "zoom",
    Focus: "focus",
    Iris: "iris",
    Frost: "frost",
    Prism: "prism",
    PrismRotation: "prismr",
    Gobo: "gobo",
    GoboWheel: "gobo",
    GoboWheelRotation: "gobor",
    Effect: "effect",
    EffectSpeed: "speed",
    ProgramSpeed: "speed",
    ColorTemperature: "cct",
    CTC: "cct",
    CTO: "cct",
    CTB: "cct",
    ColorMacro: "colmacro",
    ColorPreset: "preset",
    ColorWheel: "colour",
    ColorWheelRotation: "colourr",
    Speed: "speed",
    Macro: "macro",
    Fog: "fog",
    Haze: "haze",
    Fan: "fana"
  };

  const MOVING_TYPES = new Set(["pan", "tilt", "zoom", "focus", "iris", "prism", "gobo"]);
  const COLOUR_TYPES = new Set(["r", "g", "b", "w", "warmWhite", "coolWhite", "amber", "lime", "cyan", "magenta", "yellow", "uv", "indigo"]);

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      console.warn("[FixtureImport] Could not read imported fixtures:", err);
      return {};
    }
  }

  function writeStored(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("[FixtureImport] Could not persist imported fixtures:", err);
    }
  }

  function normaliseName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function channelType(channel) {
    const raw = normaliseName(channel?.type || channel?.attribute || channel?.name);
    if (!raw) return null;

    if (TYPE_MAP[raw]) return TYPE_MAP[raw];

    const lower = raw.toLowerCase();
    if (lower.includes("pan") && lower.includes("tilt")) return "pan";
    if (lower.includes("pan")) return "pan";
    if (lower.includes("tilt")) return "tilt";
    if (lower.includes("dimmer") || lower.includes("intensity")) return "intensity";
    if (lower.includes("strobe") || lower.includes("shutter")) return "strobe";
    if (lower.includes("red")) return "r";
    if (lower.includes("green")) return "g";
    if (lower.includes("blue")) return "b";
    if (lower.includes("white")) return "w";
    if (lower.includes("amber")) return "amber";
    if (lower.includes("lime")) return "lime";
    if (lower.includes("cyan")) return "cyan";
    if (lower.includes("magenta")) return "magenta";
    if (lower.includes("yellow")) return "yellow";
    if (lower.includes("zoom")) return "zoom";
    if (lower.includes("focus")) return "focus";
    if (lower.includes("iris")) return "iris";
    if (lower.includes("frost")) return "frost";
    if (lower.includes("prism")) return "prism";
    if (lower.includes("gobo")) return "gobo";
    if (lower.includes("effect")) return "effect";
    if (lower.includes("speed")) return "speed";
    if (lower.includes("temperature") || lower === "cct" || lower === "cto" || lower === "ctb") return "cct";
    return null;
  }

  function getChannels(mode) {
    if (Array.isArray(mode?.channels)) return mode.channels;
    if (mode?.channels && typeof mode.channels === "object") return Object.values(mode.channels);
    return [];
  }

  function getModes(fixture) {
    if (Array.isArray(fixture?.modes) && fixture.modes.length) return fixture.modes;
    if (fixture?.mode && typeof fixture.mode === "object") return [fixture.mode];
    return [];
  }

  function makeMap(channels) {
    const map = {};
    channels.forEach((channel, index) => {
      const key = channelType(channel);
      if (!key || map[key] !== undefined) return;
      map[key] = index;
    });

    if (map.intensity === undefined && map.dimmer !== undefined) map.intensity = map.dimmer;
    if (map.dimmer === undefined && map.intensity !== undefined) map.dimmer = map.intensity;

    return map;
  }

  function inferType(map) {
    if (map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined) return "moving";
    if (map.r !== undefined || map.g !== undefined || map.b !== undefined || map.w !== undefined || map.amber !== undefined || map.lime !== undefined) return "rgb";
    if (map.strobe !== undefined && Object.keys(map).length <= 4) return "strobe";
    return "dimmer";
  }

  function photometricsFromFixture(fixture) {
    const physical = fixture?.physical || {};
    const bulb = physical?.bulb || {};
    const lens = physical?.lens || {};
    const lumens = Number(bulb.lumens ?? physical.lumens);
    const power = Number(physical.power);
    const beamMin = Number(lens.beamAngle?.[0] ?? lens.beamAngleMin);
    const beamMax = Number(lens.beamAngle?.[1] ?? lens.beamAngleMax);

    const p = {
      verified: false,
      sourceType: bulb.type || "UNKNOWN",
      ratedLumens: Number.isFinite(lumens) ? lumens : null,
      beamAngle: null,
      beamAngleMin: Number.isFinite(beamMin) ? beamMin : null,
      beamAngleMax: Number.isFinite(beamMax) ? beamMax : null,
      outputScale: 1.0,
      sourcePowerWatts: Number.isFinite(power) ? power : undefined,
      manufacturer: fixture?.manufacturer || undefined,
      model: fixture?.name || undefined,
      sourceNote: "Imported from Open Fixture Library JSON. Verify the DMX mode against the fixture manual before live use."
    };

    if (p.beamAngleMin !== null && p.beamAngleMax !== null && p.beamAngleMin === p.beamAngleMax) {
      p.beamAngle = p.beamAngleMin;
      p.beamAngleMin = null;
      p.beamAngleMax = null;
    }

    return p;
  }

  function buildDefinition(fixture, mode) {
    const channels = getChannels(mode);
    if (!channels.length) throw new Error("The selected fixture mode has no DMX channels.");

    const map = makeMap(channels);
    const def = {
      type: inferType(map),
      channels: channels.length,
      map,
      photometrics: photometricsFromFixture(fixture),
      importedFrom: "Open Fixture Library",
      importedAt: new Date().toISOString()
    };

    if (map.r !== undefined || map.g !== undefined || map.b !== undefined) {
      def.type = "rgb";
    } else if (map.w !== undefined && COLOUR_TYPES.has("w")) {
      def.type = "rgbw";
    }

    if (MOVING_TYPES.has("pan") && (map.pan !== undefined || map.tilt !== undefined)) {
      def.type = "moving";
    }

    return def;
  }

  function extractFixtureObject(parsed) {
    if (!parsed || typeof parsed !== "object") throw new Error("The file is not a JSON object.");
    if (parsed.fixture && typeof parsed.fixture === "object") return parsed.fixture;
    if (parsed.fixtureDefinition && typeof parsed.fixtureDefinition === "object") return parsed.fixtureDefinition;
    return parsed;
  }

  function importFixtureJson(parsed) {
    const fixture = extractFixtureObject(parsed);
    const modes = getModes(fixture);
    if (!modes.length) throw new Error("No DMX modes were found in this fixture definition.");

    const manufacturer = normaliseName(fixture.manufacturer || parsed.manufacturer || "Imported");
    const baseName = normaliseName(fixture.name || fixture.longName || fixture.shortName || parsed.name);
    if (!baseName) throw new Error("The fixture definition has no name.");

    const stored = readStored();
    const importedNames = [];

    modes.forEach((mode, index) => {
      const modeName = normaliseName(mode?.name || mode?.shortName || `Mode ${index + 1}`);
      const name = modes.length === 1
        ? `${manufacturer} ${baseName}`.trim()
        : `${manufacturer} ${baseName} (${modeName})`.trim();
      const definition = buildDefinition(fixture, mode);
      const uniqueName = name || `Imported Fixture ${Date.now()}-${index + 1}`;

      FixtureLibrary[uniqueName] = definition;
      stored[uniqueName] = definition;
      importedNames.push(uniqueName);
    });

    writeStored(stored);
    window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || "");

    return importedNames;
  }

  function restoreStoredFixtures() {
    const stored = readStored();
    Object.entries(stored).forEach(([name, definition]) => {
      if (!FixtureLibrary[name] && definition && typeof definition === "object") {
        FixtureLibrary[name] = definition;
      }
    });
  }

  function openPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.txt,application/json,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const names = importFixtureJson(JSON.parse(text));
        const message = names.length === 1
          ? `Imported fixture: ${names[0]}`
          : `Imported ${names.length} DMX modes from ${names[0]}`;
        window.log?.(message, "ok");
      } catch (err) {
        console.error("[FixtureImport] Import failed:", err);
        window.log?.(`Fixture import failed: ${err.message}`, "error");
      }
    };
    input.click();
  }

  function installUI() {
    if (document.getElementById("btnImportFixture")) return;
    const page = document.getElementById("page-patch");
    const libraryPanel = page?.querySelector(".panel:first-child .panel-body");
    if (!libraryPanel) return false;

    const row = document.createElement("div");
    row.className = "action-row";
    row.style.marginTop = "10px";
    row.innerHTML = '<button class="btn-secondary" id="btnImportFixture" type="button">⇩ Import Fixture JSON</button><span class="panel-meta" style="align-self:center">OFL / compatible JSON</span>';
    libraryPanel.appendChild(row);
    document.getElementById("btnImportFixture").onclick = openPicker;
    return true;
  }

  restoreStoredFixtures();
  installUI();
  window.FixtureImport = {
    importFixtureJson,
    openPicker,
    restoreStoredFixtures
  };

  if (typeof window.renderLibrary === "function") {
    window.renderLibrary(document.getElementById("fixtureSearch")?.value || "");
  }
})();
