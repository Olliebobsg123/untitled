"use strict";

/*
 * grandMA2 FixtureType XML importer.
 *
 * MA2's Coarse/Fine/Ultra fields are the real DMX addresses. The importer
 * converts those addresses to this app's zero-based fixture map and ignores
 * virtual attributes that do not have a physical DMX address.
 */
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.v1";

  const MAP = {
    DIM: "intensity", DIMMER: "intensity", INTENSITY: "intensity", STROBE: "strobe", SHUTTER: "strobe",
    RED: "r", GREEN: "g", BLUE: "b", WHITE: "w",
    COLORRGB1: "r", COLORRGB2: "g", COLORRGB3: "b", COLORRGB4: "w",
    COLORRGB5: "amber", COLORRGB6: "lime", COLORRGB7: "cyan", COLORRGB8: "magenta", COLORRGB9: "yellow", COLORRGB10: "uv",
    WARMWHITE: "warmWhite", COOLWHITE: "coolWhite", COLDWHITE: "coolWhite",
    AMBER: "amber", LIME: "lime", CYAN: "cyan", MAGENTA: "magenta", YELLOW: "yellow", UV: "uv", INDIGO: "indigo",
    PAN: "pan", TILT: "tilt", ZOOM: "zoom", FOCUS: "focus", IRIS: "iris", FROST: "frost",
    PRISM: "prism", PRISMR: "prismr", PRISMROTATION: "prismr",
    GOBO: "gobo", GOBO1: "gobo", GOBO2: "gobo2", GOBOR: "gobor", GOBOWHEEL: "gobo", GOBOWHEELROTATION: "gobor",
    EFFECT: "effect", SPEED: "speed", CCT: "cct", CTO: "cct", CTB: "cct",
    COLORMACRO: "colmacro", COLORPRESET: "preset", MACRO: "macro", FOG: "fog", HAZE: "haze", FAN: "fana"
  };

  const norm = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const key = value => norm(value).toUpperCase().replace(/[^A-Z0-9_]/g, "");
  const num = (value, fallback = null) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  function children(element, name) {
    return Array.from(element?.children || []).filter(child =>
      child.localName === name || child.nodeName === name
    );
  }

  function child(element, name) {
    return children(element, name)[0] || null;
  }

  function childText(element, name) {
    return norm(child(element, name)?.textContent);
  }

  function attr(element, ...names) {
    if (!element) return null;
    for (const name of names) {
      const direct = element.getAttribute(name);
      if (direct !== null) return direct;
      const match = Array.from(element.attributes || []).find(a =>
        a.name.toLowerCase() === String(name).toLowerCase()
      );
      if (match) return match.value;
    }
    return null;
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (_) {
      return {};
    }
  }

  function writeStored(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (err) { console.warn("[MA2Import] persistence failed", err); }
  }

  function mappedAttribute(channel) {
    const fn = child(channel, "ChannelFunction");
    const candidates = [
      attr(channel, "attribute", "attrib"),
      attr(fn, "attribute", "attrib"),
      attr(fn, "subattribute", "subattrib"),
      attr(channel, "feature"),
      attr(channel, "preset"),
      attr(fn, "feature"),
      attr(fn, "preset"),
      attr(fn, "name")
    ].map(norm).filter(Boolean);

    for (const candidate of candidates) {
      const mapped = MAP[key(candidate)];
      if (mapped) return mapped;

      const lower = candidate.toLowerCase();
      if (lower.includes("pan") && !lower.includes("tilt")) return "pan";
      if (lower.includes("tilt")) return "tilt";
      if (lower.includes("dimmer") || lower === "dim" || lower.includes("intensity")) return "intensity";
      if (lower.includes("strobe") || lower.includes("shutter")) return "strobe";
      if (lower.includes("red")) return "r";
      if (lower.includes("green")) return "g";
      if (lower.includes("blue")) return "b";
      if (lower.includes("white")) return lower.includes("warm") ? "warmWhite" : "w";
      if (lower.includes("amber")) return "amber";
      if (lower.includes("lime")) return "lime";
      if (lower.includes("cyan")) return "cyan";
      if (lower.includes("magenta")) return "magenta";
      if (lower.includes("yellow")) return "yellow";
      if (lower.includes("uv")) return "uv";
      if (lower.includes("zoom")) return "zoom";
      if (lower.includes("focus")) return "focus";
      if (lower.includes("iris")) return "iris";
      if (lower.includes("frost")) return "frost";
      if (lower.includes("prism")) return lower.includes("rot") ? "prismr" : "prism";
      if (lower.includes("gobo")) return lower.includes("rot") ? "gobor" : "gobo";
      if (lower.includes("effect")) return "effect";
      if (lower.includes("speed")) return "speed";
      if (lower.includes("temperature") || lower === "cct" || lower === "cto" || lower === "ctb") return "cct";
      if (lower.includes("macro")) return "macro";
      if (lower.includes("fog")) return "fog";
      if (lower.includes("haze")) return "haze";
      if (lower.includes("fan")) return "fana";
    }

    return null;
  }

  function physicalAddress(channel) {
    // Coarse is the 8-bit DMX address. Fine/Ultra are the following physical
    // bytes when present. MA2's values are 1-based, while this app's map is 0-based.
    const coarse = num(attr(channel, "coarse"));
    const fine = num(attr(channel, "fine"));
    const ultra = num(attr(channel, "ultra"));

    if (coarse !== null) return Math.max(0, coarse - 1);
    if (fine !== null) return Math.max(0, fine - 1);
    if (ultra !== null) return Math.max(0, ultra - 1);
    return null;
  }

  function hasPhysicalDMX(channel) {
    return physicalAddress(channel) !== null;
  }

  function buildMap(channels) {
    const map = {};
    const physical = [];

    channels.forEach((channel, index) => {
      const attribute = mappedAttribute(channel);
      const address = physicalAddress(channel);
      if (address === null) return;

      physical.push({ channel, index, attribute, address });
      if (!attribute) return;

      if (map[attribute] === undefined) map[attribute] = address;

      const fine = num(attr(channel, "fine"));
      if (fine !== null && map[`${attribute}Fine`] === undefined) {
        map[`${attribute}Fine`] = Math.max(0, fine - 1);
      }

      const ultra = num(attr(channel, "ultra"));
      if (ultra !== null && map[`${attribute}Ultra`] === undefined) {
        map[`${attribute}Ultra`] = Math.max(0, ultra - 1);
      }
    });

    // The DMX engine uses dimmer as the physical intensity output. Keep both
    // aliases so imported profiles work with either representation.
    if (map.intensity !== undefined && map.dimmer === undefined) map.dimmer = map.intensity;
    if (map.dimmer !== undefined && map.intensity === undefined) map.intensity = map.dimmer;

    return { map, physical };
  }

  function inferType(map, fixtureClass) {
    const moving = map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined;
    const colour = ["r", "g", "b", "w", "warmWhite", "coolWhite", "amber", "lime", "cyan", "magenta", "yellow", "uv"].some(k => map[k] !== undefined);
    const cls = key(fixtureClass);

    if (moving || cls.includes("HEADMOVER") || cls.includes("MOVING")) return "moving";
    if (colour) return map.w !== undefined ? "rgbw" : "rgb";
    if (map.strobe !== undefined && map.intensity === undefined) return "strobe";
    return "dimmer";
  }

  function buildDefinition(fixture, module) {
    const channelTypes = children(module, "ChannelType");
    if (!channelTypes.length) throw new Error("MA2 module contains no ChannelType entries.");

    const { map, physical } = buildMap(channelTypes);
    if (!Object.keys(map).length) {
      throw new Error("MA2 fixture contains DMX channels, but none of its attributes could be mapped.");
    }

    const highest = physical.reduce((max, item) => {
      const coarse = num(attr(item.channel, "coarse"), 0);
      const fine = num(attr(item.channel, "fine"), 0);
      const ultra = num(attr(item.channel, "ultra"), 0);
      return Math.max(max, coarse, fine, ultra);
    }, 0);

    const definition = {
      type: inferType(map, attr(module, "class")),
      channels: Math.max(1, highest),
      map,
      photometrics: {
        verified: false,
        sourceType: norm(attr(module, "beamtype")) || "UNKNOWN",
        ratedLumens: num(attr(module, "beam_intensity")),
        beamAngle: num(attr(module, "beam_angle")),
        beamAngleMin: null,
        beamAngleMax: null,
        outputScale: 1,
        manufacturer: childText(fixture, "manufacturer") || undefined,
        model: childText(fixture, "short_name") || attr(fixture, "name") || undefined,
        sourceNote: "Imported from grandMA2 FixtureType XML. Verify the DMX mode against the fixture manual before live use."
      },
      importedFrom: "grandMA2 XML",
      importedAt: new Date().toISOString(),
      ma2Channels: channelTypes.map((channel, index) => ({
        index: num(attr(channel, "index"), index + 1),
        attribute: norm(attr(channel, "attribute", "attrib")),
        feature: norm(attr(channel, "feature")),
        preset: norm(attr(channel, "preset")),
        coarse: num(attr(channel, "coarse")),
        fine: num(attr(channel, "fine")),
        ultra: num(attr(channel, "ultra")),
        break: num(attr(channel, "break"), 1),
        default: num(attr(channel, "default")),
        virtual: !hasPhysicalDMX(channel),
        mappedAs: mappedAttribute(channel)
      }))
    };

    if (definition.photometrics.beamAngle !== null && definition.photometrics.beamAngle <= 0) {
      definition.photometrics.beamAngle = null;
    }

    return definition;
  }

  function importFixtureXml(text) {
    if (typeof DOMParser === "undefined") throw new Error("XML parsing is not available.");

    // Some MA exports can contain the short "MA DATA" wrapper before the XML
    // declaration. Strip it so DOMParser sees a real XML document.
    let source = String(text || "").replace(/^\uFEFF/, "");
    const xmlStart = source.indexOf("<?xml");
    if (xmlStart > 0) source = source.slice(xmlStart);

    const xml = new DOMParser().parseFromString(source, "application/xml");
    const error = xml.querySelector("parsererror");
    if (error) throw new Error(`Invalid XML: ${norm(error.textContent)}`);
    if (!xml.documentElement || key(xml.documentElement.localName || xml.documentElement.nodeName) !== "MA") {
      throw new Error("This is not a grandMA2 XML file.");
    }

    const fixtureTypes = Array.from(xml.getElementsByTagNameNS("*", "FixtureType"));
    if (!fixtureTypes.length) throw new Error("No grandMA2 FixtureType found.");

    const stored = readStored();
    const names = [];

    fixtureTypes.forEach((fixture, fixtureIndex) => {
      const manufacturer = childText(fixture, "manufacturer");
      const fixtureName = norm(attr(fixture, "name")) || childText(fixture, "short_name") || `MA2 Fixture ${fixtureIndex + 1}`;
      const modulesParent = child(fixture, "Modules");
      const modules = children(modulesParent, "Module");
      if (!modules.length) throw new Error(`${fixtureName} has no Module entries.`);

      modules.forEach((module, moduleIndex) => {
        const moduleName = norm(attr(module, "name"));
        const mode = norm(attr(fixture, "mode"));
        const baseName = [manufacturer, fixtureName].filter(Boolean).join(" ").trim() || fixtureName;
        const name = modules.length === 1
          ? baseName
          : `${baseName} (${mode || moduleName || `Module ${moduleIndex + 1}`})`;

        const definition = buildDefinition(fixture, module);
        FixtureLibrary[name] = definition;
        stored[name] = definition;
        names.push(name);

        console.info("[MA2Import]", name, "DMX map:", definition.map, "footprint:", definition.channels);
      });
    });

    writeStored(stored);
    window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || "");
    return names;
  }

  function openPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml,text/xml,application/xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const names = importFixtureXml(await file.text());
        window.log?.(
          names.length === 1
            ? `Imported MA2 fixture: ${names[0]}`
            : `Imported ${names.length} MA2 fixture definitions.`,
          "ok"
        );
      } catch (err) {
        console.error("[MA2Import]", err);
        window.log?.(`MA2 fixture import failed: ${err.message}`, "error");
      }
    };
    input.click();
  }

  function installUI() {
    if (document.getElementById("btnImportMA2Fixture")) return;
    const panel = document.getElementById("page-patch")?.querySelector(".panel:first-child .panel-body");
    if (!panel) return;

    const row = document.createElement("div");
    row.className = "action-row";
    row.style.marginTop = "10px";
    row.innerHTML = '<button class="btn-secondary" id="btnImportMA2Fixture" type="button">⇩ Import MA2 XML</button><span class="panel-meta" style="align-self:center">grandMA2 FixtureType</span>';
    panel.appendChild(row);
    document.getElementById("btnImportMA2Fixture").onclick = openPicker;
  }

  window.MA2FixtureImport = { importFixtureXml, openPicker };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installUI, { once: true });
  } else {
    installUI();
  }
})();
