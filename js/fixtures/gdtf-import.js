"use strict";

/* GDTF fixture importer.
 * GDTF is a ZIP archive containing description.xml plus optional resources.
 * This importer intentionally reads the DMX personality and maps it into the
 * console's existing FixtureLibrary format without adding a native dependency.
 */
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.gdtf.v1";
  const MAP = {
    Dimmer:"intensity",Intensity:"intensity",Shutter:"strobe",Strobe:"strobe",
    Pan:"pan",Tilt:"tilt",Zoom:"zoom",Focus:"focus",Iris:"iris",Frost:"frost",
    Prism:"prism",Prism1:"prism",PrismRotation:"prismr",Gobo:"gobo",Gobo1:"gobo",
    GoboRotation:"gobor",Red:"r",Green:"g",Blue:"b",White:"w",WarmWhite:"warmWhite",
    CoolWhite:"coolWhite",ColdWhite:"coolWhite",Amber:"amber",Lime:"lime",Cyan:"cyan",
    Magenta:"magenta",Yellow:"yellow",UV:"uv",Indigo:"indigo",ColorTemperature:"cct",
    CTO:"cct",CTB:"cct",ColorMacro:"colmacro",ColorWheel:"colour",ColorWheelRotation:"colourr",
    Macro:"macro",Effect:"effect",EffectSpeed:"speed",Speed:"speed",Fan:"fana",Haze:"haze",Fog:"fog"
  };

  const clean = v => String(v ?? "").replace(/\s+/g, " ").trim();
  const attr = (el, name) => el?.getAttribute(name) ?? "";
  const elements = (root, name) => Array.from(root.getElementsByTagName(name));
  const first = (root, name) => elements(root, name)[0] || null;

  function mapAttribute(name) {
    const raw = clean(name);
    if (!raw) return null;
    if (MAP[raw]) return MAP[raw];
    const s = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (s.includes("dimmer") || s.includes("intensity")) return "intensity";
    if (s.includes("shutter") || s.includes("strobe")) return "strobe";
    if (s === "pan" || s.includes("pancontinuous")) return "pan";
    if (s === "tilt" || s.includes("tiltcontinuous")) return "tilt";
    if (s.includes("zoom")) return "zoom";
    if (s.includes("focus")) return "focus";
    if (s.includes("iris")) return "iris";
    if (s.includes("frost")) return "frost";
    if (s.includes("prism")) return "prism";
    if (s.includes("gobo") && s.includes("rotation")) return "gobor";
    if (s.includes("gobo")) return "gobo";
    if (s.includes("red")) return "r";
    if (s.includes("green")) return "g";
    if (s.includes("blue")) return "b";
    if (s.includes("warmwhite")) return "warmWhite";
    if (s.includes("coldwhite") || s.includes("coolwhite")) return "coolWhite";
    if (s === "white" || s.includes("coloraddw")) return "w";
    if (s.includes("amber")) return "amber";
    if (s.includes("lime")) return "lime";
    if (s.includes("cyan")) return "cyan";
    if (s.includes("magenta")) return "magenta";
    if (s.includes("yellow")) return "yellow";
    if (s === "uv" || s.includes("ultraviolet")) return "uv";
    if (s.includes("colortemperature") || s === "cto" || s === "ctb" || s === "cct") return "cct";
    if (s.includes("colormacro")) return "colmacro";
    if (s.includes("colorwheelrotation")) return "colourr";
    if (s.includes("colorwheel")) return "colour";
    if (s.includes("effectspeed") || s.includes("programspeed")) return "speed";
    if (s.includes("effect")) return "effect";
    if (s.includes("speed")) return "speed";
    if (s.includes("haze")) return "haze";
    if (s.includes("fog")) return "fog";
    return null;
  }

  function bytesToString(bytes) { return new TextDecoder("utf-8").decode(bytes); }
  function u16(v, p) { return v.getUint16(p, true); }
  function u32(v, p) { return v.getUint32(p, true); }

  function findEndOfCentralDirectory(bytes) {
    for (let p = Math.max(0, bytes.length - 65557); p <= bytes.length - 22; p++) {
      if (u32(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), p) === 0x06054b50) return p;
    }
    return -1;
  }

  async function unzipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const eocd = findEndOfCentralDirectory(bytes);
    if (eocd < 0) throw new Error("Not a valid GDTF/ZIP archive (EOCD missing).");
    const count = u16(view, eocd + 10);
    const centralSize = u32(view, eocd + 12);
    const centralOffset = u32(view, eocd + 16);
    const out = new Map();
    let p = centralOffset;
    for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
      if (u32(view, p) !== 0x02014b50) break;
      const method = u16(view, p + 10);
      const compressedSize = u32(view, p + 20);
      const nameLen = u16(view, p + 28);
      const extraLen = u16(view, p + 30);
      const commentLen = u16(view, p + 32);
      const localOffset = u32(view, p + 42);
      const name = bytesToString(bytes.slice(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      const local = localOffset;
      if (u32(view, local) !== 0x04034b50) continue;
      const localNameLen = u16(view, local + 26);
      const localExtraLen = u16(view, local + 28);
      const dataStart = local + 30 + localNameLen + localExtraLen;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(ds)).arrayBuffer());
      } else continue;
      out.set(name.replace(/^\.\//, ""), data);
    }
    return out;
  }

  function parseDescription(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("GDTF description.xml could not be parsed.");
    const fixture = first(xml, "FixtureType");
    if (!fixture) throw new Error("GDTF description.xml contains no FixtureType.");
    const manufacturer = clean(attr(fixture, "Manufacturer")) || "Imported";
    const fixtureName = clean(attr(fixture, "Name")) || clean(attr(fixture, "ShortName")) || "GDTF Fixture";
    const modesNode = first(fixture, "DMXModes");
    const modes = modesNode ? elements(modesNode, "DMXMode") : [];
    if (!modes.length) throw new Error("GDTF fixture contains no DMX modes.");
    return { xml, fixture, manufacturer, fixtureName, modes };
  }

  function parseOffsets(value) {
    return clean(value).split(",").map(v => Number(v.trim())).filter(Number.isFinite).filter(v => v > 0);
  }

  function buildDefinition(parsed, mode) {
    const channelsNode = first(mode, "DMXChannels");
    const channels = channelsNode ? elements(channelsNode, "DMXChannel") : [];
    if (!channels.length) throw new Error(`GDTF mode "${attr(mode, "Name")}" has no DMX channels.`);
    const map = {};
    const detailed = [];
    let maxAddress = 0;
    let unsupportedBreaks = false;

    channels.forEach(channel => {
      const offsets = parseOffsets(attr(channel, "Offset"));
      const dmxBreak = attr(channel, "DMXBreak") || "1";
      if (dmxBreak !== "1" && dmxBreak.toLowerCase() !== "overwrite") unsupportedBreaks = true;
      if (!offsets.length) return;
      const logical = first(channel, "LogicalChannel");
      const fn = logical ? first(logical, "ChannelFunction") : null;
      const attribute = clean(attr(fn, "Attribute")) || clean(attr(logical, "Attribute"));
      const key = mapAttribute(attribute);
      const original = clean(attr(fn, "OriginalAttribute"));
      const address = offsets[0] - 1;
      maxAddress = Math.max(maxAddress, ...offsets);
      if (key && map[key] === undefined && (dmxBreak === "1" || dmxBreak.toLowerCase() === "overwrite")) {
        map[key] = address;
        if (offsets.length > 1) {
          const fineKey = key === "pan" ? "panf" : key === "tilt" ? "tiltf" : `${key}Fine`;
          if (map[fineKey] === undefined) map[fineKey] = offsets[1] - 1;
        }
      }
      detailed.push({
        address,
        offsets: offsets.map(v => v - 1),
        break: dmxBreak,
        attribute: attribute || "NoFeature",
        originalAttribute: original || null,
        channelFunction: clean(attr(fn, "Name")) || null,
        physicalFrom: Number(attr(fn, "PhysicalFrom")),
        physicalTo: Number(attr(fn, "PhysicalTo"))
      });
    });

    if (map.intensity === undefined && map.dimmer !== undefined) map.intensity = map.dimmer;
    if (map.dimmer === undefined && map.intensity !== undefined) map.dimmer = map.intensity;
    let type = "dimmer";
    if (map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined) type = "moving";
    else if (map.r !== undefined || map.g !== undefined || map.b !== undefined || map.w !== undefined || map.amber !== undefined || map.lime !== undefined || map.cyan !== undefined || map.magenta !== undefined) type = map.w !== undefined && map.r !== undefined ? "rgbw" : "rgb";
    else if (map.strobe !== undefined && Object.keys(map).length <= 4) type = "strobe";

    const definition = {
      type,
      channels: maxAddress,
      map,
      photometrics: {
        verified: false,
        sourceType: "GDTF",
        ratedLumens: null,
        beamAngle: null,
        beamAngleMin: null,
        beamAngleMax: null,
        outputScale: 1,
        manufacturer: parsed.manufacturer,
        model: parsed.fixtureName,
        sourceNote: "Imported from a GDTF fixture profile. GDTF DMX mapping is preserved; photometrics are not guessed."
      },
      importedFrom: "GDTF",
      importedAt: new Date().toISOString(),
      gdtf: {
        manufacturer: parsed.manufacturer,
        fixtureType: parsed.fixtureName,
        mode: clean(attr(mode, "Name")),
        description: clean(attr(mode, "Description")),
        channels: detailed,
        unsupportedBreaks
      }
    };
    return definition;
  }

  function readStored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (_) { return {}; }
  }
  function writeStored(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

  async function importGDTFFile(file) {
    if (!file) return [];
    const entries = await unzipEntries(await file.arrayBuffer());
    const description = entries.get("description.xml") || entries.get("Description.xml");
    if (!description) throw new Error("This GDTF file has no description.xml.");
    const parsed = parseDescription(bytesToString(description));
    const stored = readStored();
    const names = [];
    parsed.modes.forEach((mode, index) => {
      const modeName = clean(attr(mode, "Name")) || `Mode ${index + 1}`;
      const name = `${parsed.manufacturer} ${parsed.fixtureName} (${modeName})`.trim();
      const definition = buildDefinition(parsed, mode);
      FixtureLibrary[name] = definition;
      stored[name] = definition;
      names.push(name);
    });
    writeStored(stored);
    window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || "");
    return names;
  }

  function restoreGDTF() {
    const stored = readStored();
    Object.entries(stored).forEach(([name, definition]) => {
      if (!FixtureLibrary[name] && definition && typeof definition === "object") FixtureLibrary[name] = definition;
    });
  }

  function openPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gdtf,application/zip,application/octet-stream";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const names = await importGDTFFile(file);
        const warning = names.some(n => FixtureLibrary[n]?.gdtf?.unsupportedBreaks) ? " (multi-break channels are flagged for review)" : "";
        window.log?.(`Imported GDTF: ${names.length} DMX mode${names.length === 1 ? "" : "s"}${warning}`, "ok");
      } catch (err) {
        console.error("[GDTF] Import failed:", err);
        window.log?.(`GDTF import failed: ${err.message}`, "error");
      }
    };
    input.click();
  }

  function installUI() {
    if (document.getElementById("btnImportGDTF")) return;
    const page = document.getElementById("page-patch");
    const libraryPanel = page?.querySelector(".panel:first-child .panel-body");
    if (!libraryPanel) return false;
    const row = document.createElement("div");
    row.className = "action-row";
    row.style.marginTop = "10px";
    row.innerHTML = '<button class="btn-secondary" id="btnImportGDTF" type="button">⇩ Import GDTF</button><span class="panel-meta" style="align-self:center">GDTF 1.2 · manufacturer profiles</span>';
    libraryPanel.appendChild(row);
    document.getElementById("btnImportGDTF").onclick = openPicker;
    return true;
  }

  restoreGDTF();
  installUI();
  window.GDTFImport = { importGDTFFile, openPicker, restoreGDTF };
})();
