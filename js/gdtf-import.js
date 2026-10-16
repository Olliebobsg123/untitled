"use strict";

/*
 * GDTF (General Device Type Format) import.
 *
 * A .gdtf file is a ZIP archive; the fixture definition itself lives in
 * a single "description.xml" entry inside it (wheel/gobo images and 3D
 * models also ship in the archive, but this app draws its own
 * procedural gobo patterns rather than using bitmap gobo images, so
 * only the XML is read here).
 *
 * Everything below runs entirely in the renderer using standard Web
 * APIs already available in this Electron version (43) — no Node
 * dependency, no IPC, no new npm package:
 *   - a small hand-written ZIP central-directory reader (the ZIP
 *     format's local/central header layout is fixed and well
 *     documented; writing ~80 lines here beats depending on whatever
 *     happens to be sitting in node_modules as an unrelated package's
 *     transitive dependency — e.g. "unzipper" is only present because
 *     electron-builder's own dependency tree pulled it in, not because
 *     this app declared it, so it could vanish on the next npm install)
 *   - DecompressionStream('deflate-raw') for the (usual) DEFLATE-
 *     compressed entries
 *   - DOMParser for the XML itself
 *
 * Best-effort by design (no live manufacturer .gdtf file was available
 * to test against while writing this — see the attribute-mapping table
 * below for exactly which GDTF attributes are understood and which are
 * deliberately left unmapped rather than guessed).
 */
(function installGdtfImport() {

  const STORAGE_KEY = "lightingConsole.importedFixtures.gdtf.v1";

  // ============================================================
  // ZIP READING
  // ============================================================

  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_DIR_SIGNATURE = 0x02014b50;
  const LOCAL_HEADER_SIGNATURE = 0x04034b50;

  function findEndOfCentralDirectory(view) {
    // The EOCD record is a fixed 22 bytes plus an optional comment of
    // up to 65535 bytes at the very end of the file — search backward
    // for its signature rather than assuming no comment is present.
    const maxCommentLength = 65535;
    const minOffset = Math.max(0, view.byteLength - 22 - maxCommentLength);
    for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
      if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
    }
    throw new Error("Not a valid ZIP file (no end-of-central-directory record found) — is this really a .gdtf file?");
  }

  function readCentralDirectory(bytes, view) {
    const eocdOffset = findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    let offset = view.getUint32(eocdOffset + 16, true);

    const entries = [];
    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
        throw new Error("Corrupt ZIP central directory (unexpected signature) while reading entry " + i);
      }
      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
      const name = new TextDecoder("utf-8").decode(nameBytes);

      entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });

      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateRaw(compressedBytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This Electron/Chromium version has no DecompressionStream support — GDTF import needs it to read compressed entries.");
    }
    const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function extractZipEntry(bytes, view, entry) {
    const local = entry.localHeaderOffset;
    if (view.getUint32(local, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`Corrupt ZIP local header for "${entry.name}"`);
    }
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const dataStart = local + 30 + nameLength + extraLength;
    const compressedBytes = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) return compressedBytes;
    if (entry.compressionMethod === 8) return inflateRaw(compressedBytes);
    throw new Error(`"${entry.name}" uses ZIP compression method ${entry.compressionMethod}, which this importer doesn't support (only stored/deflate — the two GDTF actually uses).`);
  }

  async function readGdtfDescriptionXml(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const entries = readCentralDirectory(bytes, view);
    const descriptionEntry = entries.find(e => e.name.toLowerCase() === "description.xml");
    if (!descriptionEntry) {
      throw new Error("No description.xml found inside this archive — is this actually a .gdtf file?");
    }
    const xmlBytes = await extractZipEntry(bytes, view, descriptionEntry);
    return new TextDecoder("utf-8").decode(xmlBytes);
  }


  // ============================================================
  // CIE xyY -> sRGB (for colour wheel slots — GDTF's <Slot Color="x,y,Y">
  // and other Color attributes across the schema all use this same
  // "ColorCIE" triplet, never a direct RGB value)
  // ============================================================

  function cieXyyToSrgb(xyYString) {
    const parts = String(xyYString || "").split(",").map(Number);
    if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) return null;
    const [x, y, Y] = parts;
    if (y === 0) return [0, 0, 0];

    const X = (Y / y) * x;
    const Z = (Y / y) * (1 - x - y);

    let r =  3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    let b =  0.0557 * X - 0.2040 * Y + 1.0570 * Z;

    const gamma = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    r = gamma(r); g = gamma(g); b = gamma(b);

    // GDTF's Y (luminance) scale varies by author (some use 0-100,
    // some near-0-1) — normalising by the brightest component keeps
    // the RESULT a sensible, vivid colour regardless of that scale,
    // the same spirit as the hand-transcribed colour wheels elsewhere
    // in this library being "this app's own approximation", not a
    // guaranteed-exact manufacturer swatch.
    const peak = Math.max(r, g, b, 1e-6);
    return [
      Math.max(0, Math.min(1, r / peak)),
      Math.max(0, Math.min(1, g / peak)),
      Math.max(0, Math.min(1, b / peak))
    ];
  }


  // ============================================================
  // GDTF ATTRIBUTE -> this app's internal map key
  // ============================================================
  //
  // Only attributes this app's DMX engine (js/dmx.js) and visualizer
  // actually drive are mapped. Anything else — mode-selector enums,
  // per-manufacturer macro attributes, framing-shutter blade attributes
  // (which GDTF names very inconsistently across manufacturers, unlike
  // the stable Pan/Tilt/Zoom/etc. below) — is intentionally left
  // unmapped, the same "left unmapped rather than wired to the wrong
  // effect" rule the hand-transcribed fixtures in this library follow.
  const ATTRIBUTE_MAP = {
    pan: "pan", tilt: "tilt",
    dimmer: ["dimmer", "intensity"],
    shutter1: "strobe", shutter1strobe: "strobe",
    zoom: "zoom", iris: "iris", focus: "focus", frost1: "frost",
    color1: "colour",
    coloradd_r: "r", coloradd_g: "g", coloradd_b: "b", coloradd_w: "w",
    coloradd_uv: "uv", coloradd_amber: "amber", coloradd_lime: "lime",
    colorsub_c: "cyan", colorsub_m: "magenta", colorsub_y: "yellow",
    colorsub_cto: "cto", cto: "cto",
    gobo1: "gobo", gobo2: "gobo2",
    prism1: "prism"
  };

  // Attributes that indicate "rotate/index the wheel from the last one"
  // rather than a distinct control of their own — mapped onto this
  // app's own "<wheel>r" rotate-offset convention (see colourWheelDMX /
  // drawGoboPattern's use of gobor/gobo2r/prismr).
  const ROTATE_SUFFIX_MAP = {
    color1wheelspin: "colourr", color1pos: "colourr",
    gobo1pos: "gobor", gobo1wheelspin: "gobor", gobo1posrotate: "gobor",
    gobo2pos: "gobo2r", gobo2wheelspin: "gobo2r", gobo2posrotate: "gobo2r",
    prism1pos: "prismr", prism1posrotate: "prismr"
  };

  function normaliseAttributeName(name) {
    return String(name || "").trim().toLowerCase();
  }


  // ============================================================
  // XML -> FixtureLibrary-shaped definition
  // ============================================================

  function pickDmxMode(fixtureTypeEl) {
    const modes = Array.from(fixtureTypeEl.querySelectorAll("DMXModes > DMXMode"));
    if (!modes.length) throw new Error("This GDTF file has no <DMXMode> at all — nothing to import.");
    return { mode: modes[0], skippedCount: modes.length - 1, skippedNames: modes.slice(1).map(m => m.getAttribute("Name")) };
  }

  function extractChannelMap(modeEl) {
    const map = {};
    let maxOffset = 0;
    const unmapped = [];

    modeEl.querySelectorAll("DMXChannels > DMXChannel").forEach(channelEl => {
      const offsetAttr = channelEl.getAttribute("Offset");
      if (!offsetAttr || offsetAttr === "None") return; // virtual channel, no real DMX footprint

      const offsets = offsetAttr.split(",").map(n => parseInt(n, 10)).filter(Number.isFinite);
      if (!offsets.length) return;

      offsets.forEach(o => { if (o > maxOffset) maxOffset = o; });

      // A DMXChannel's "default" attribute lives on its first
      // LogicalChannel — GDTF allows several LogicalChannels sharing
      // one physical channel (e.g. different behaviour per DMX range),
      // but for a best-effort single-mode import the first one is what
      // actually drives this byte in practice.
      const logicalEl = channelEl.querySelector("LogicalChannel");
      const attribute = normaliseAttributeName(logicalEl?.getAttribute("Attribute"));
      if (!attribute) return;

      const coarseOffset = offsets[0] - 1;
      const fineOffset = offsets.length > 1 ? offsets[1] - 1 : null;

      const mapped = ATTRIBUTE_MAP[attribute];
      const rotateMapped = ROTATE_SUFFIX_MAP[attribute];

      if (mapped) {
        (Array.isArray(mapped) ? mapped : [mapped]).forEach(key => { map[key] = coarseOffset; });
        // This app only understands fine resolution for pan/tilt (see
        // js/dmx.js) — every other attribute's fine byte would just sit
        // unread, so it's only carried through for those two.
        if (fineOffset !== null && (attribute === "pan" || attribute === "tilt")) {
          map[attribute + "f"] = fineOffset;
        }
      } else if (rotateMapped) {
        map[rotateMapped] = coarseOffset;
      } else {
        unmapped.push(`${logicalEl.getAttribute("Attribute")} (offset ${offsets[0]})`);
      }
    });

    return { map, channels: maxOffset, unmapped };
  }

  function extractColourWheel(fixtureTypeEl) {
    const wheelEl = Array.from(fixtureTypeEl.querySelectorAll("Wheels > Wheel"))
      .find(w => normaliseAttributeName(w.getAttribute("Name")).startsWith("color"));
    if (!wheelEl) return null;

    const slots = Array.from(wheelEl.querySelectorAll("Slot"));
    if (!slots.length) return null;

    // GDTF wheel slots don't publish DMX min/max ranges directly (that
    // mapping is a property of the Color1 ChannelFunction's DMXFrom
    // ranges, not the wheel definition) — spreading them evenly across
    // 0-255 in slot order is the same honest approximation this
    // library's other hand-built colour wheels use for their
    // "in-between" transition slots.
    const step = 256 / slots.length;
    return slots.map((slot, i) => {
      const rgb = cieXyyToSrgb(slot.getAttribute("Color"));
      return {
        min: Math.round(i * step),
        max: Math.round((i + 1) * step) - 1,
        rgb: rgb || [1, 1, 1]
      };
    });
  }

  function extractPhotometrics(fixtureTypeEl, manufacturer, model) {
    const beamEl = fixtureTypeEl.querySelector('Geometries Beam, Geometries [Type="Beam"]');
    const num = attr => {
      const v = parseFloat(beamEl?.getAttribute(attr));
      return Number.isFinite(v) ? v : null;
    };

    return {
      verified: false, // hand-transcribed fixtures in this library set this true only after a human checked the source document — an automated import can't claim that
      sourceType: "LED",
      ratedLumens: num("LuminousFlux"),
      beamAngle: num("BeamAngle"),
      outputScale: 1.00,
      colourTemperature: num("ColorTemperature") || undefined,
      sourcePowerWatts: num("PowerConsumption"),
      manufacturer,
      model,
      sourceNote: "Imported from a GDTF file — best-effort attribute mapping, not independently verified against a manufacturer document."
    };
  }

  function convertGdtfXmlToFixtureDef(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("description.xml did not parse as valid XML.");
    }

    const fixtureTypeEl = doc.querySelector("FixtureType");
    if (!fixtureTypeEl) throw new Error("No <FixtureType> element in description.xml.");

    const manufacturer = fixtureTypeEl.getAttribute("Manufacturer") || "Unknown";
    const model = fixtureTypeEl.getAttribute("Name") || fixtureTypeEl.getAttribute("LongName") || "Imported Fixture";
    const name = `${manufacturer} ${model}`;

    const { mode, skippedCount, skippedNames } = pickDmxMode(fixtureTypeEl);
    const { map, channels, unmapped } = extractChannelMap(mode);

    if (!channels) throw new Error(`DMX mode "${mode.getAttribute("Name")}" has no channels with a real DMX offset — nothing to patch.`);

    const type = typeof map.pan === "number" && typeof map.tilt === "number" ? "moving" : "dimmer";

    const definition = {
      type,
      channels,
      map,
      photometrics: extractPhotometrics(fixtureTypeEl, manufacturer, model)
    };

    const colourWheel = extractColourWheel(fixtureTypeEl);
    if (colourWheel) definition.colourWheel = colourWheel;

    return {
      name,
      definition,
      modeName: mode.getAttribute("Name"),
      skippedModeCount: skippedCount,
      skippedModeNames: skippedNames,
      unmappedAttributes: unmapped
    };
  }


  // ============================================================
  // PERSISTENCE — imported fixtures survive an app restart the same
  // way js/fixture-editor.js's hand-built custom fixtures do.
  // ============================================================

  function loadPersistedImports() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function persistImport(name, definition) {
    const all = loadPersistedImports();
    all[name] = definition;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_) {}
  }

  function installPersistedImports() {
    if (!window.FixtureLibrary || typeof window.FixtureLibrary !== "object") return;
    const all = loadPersistedImports();
    Object.entries(all).forEach(([name, definition]) => {
      if (!(name in window.FixtureLibrary)) window.FixtureLibrary[name] = definition;
    });
  }


  // ============================================================
  // UI
  // ============================================================

  function report(message, level = "info") {
    if (typeof window.log === "function") window.log(message, level);
    else console.log(`[GDTF] ${message}`);
  }

  async function handleFile(file) {
    if (!file) return;
    report(`Importing "${file.name}"…`, "info");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const xmlText = await readGdtfDescriptionXml(arrayBuffer);
      const result = convertGdtfXmlToFixtureDef(xmlText);

      window.FixtureLibrary[result.name] = result.definition;
      persistImport(result.name, result.definition);

      if (typeof window.renderLibrary === "function") window.renderLibrary();

      report(
        `✅ Imported "${result.name}" — ${result.definition.channels}ch, mode "${result.modeName}"` +
        (result.skippedModeCount ? ` (${result.skippedModeCount} other mode(s) in this file were skipped: ${result.skippedModeNames.join(", ")})` : ""),
        "ok"
      );

      if (result.unmappedAttributes.length) {
        report(
          `${result.unmappedAttributes.length} channel(s) in "${result.name}" use attributes this app doesn't drive yet, left unmapped: ${result.unmappedAttributes.join(", ")}`,
          "warn"
        );
      }
    } catch (error) {
      console.error("[GDTF] Import failed:", error);
      report(`❌ GDTF import failed: ${error.message || error}`, "error");
    }
  }

  function installUI() {
    const actionRow = document.getElementById("btnPatch")?.closest(".action-row");
    if (!actionRow || document.getElementById("btnImportGdtf")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.id = "btnImportGdtf";
    button.textContent = "📥 Import GDTF";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "gdtfFileInput";
    fileInput.accept = ".gdtf";
    fileInput.hidden = true;

    button.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) handleFile(file);
    });

    actionRow.appendChild(button);
    actionRow.appendChild(fileInput);
  }

  function start() {
    installPersistedImports();
    installUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.LXGdtfImport = Object.freeze({
    // Exposed for testing/automation — same path the UI button uses.
    importFile: handleFile,
    _internal: { readGdtfDescriptionXml, convertGdtfXmlToFixtureDef, cieXyyToSrgb }
  });

})();
