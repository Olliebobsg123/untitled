"use strict";
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.gdtf.v2";
  const norm = v => String(v ?? "").replace(/\s+/g, " ").trim();
  const key = v => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");
  const all = (root, name) => Array.from(root?.getElementsByTagName?.("*") || []).filter(e => (e.localName || e.nodeName) === name);
  const first = (root, name) => all(root, name)[0] || null;
  const attr = (el, name) => el?.getAttribute(name) ?? "";

  function mapAttribute(value) {
    const s = key(value);
    if (!s) return null;
    if (s === "coloraddr" || s === "red") return "r";
    if (s === "coloraddg" || s === "green") return "g";
    if (s === "coloraddb" || s === "blue") return "b";
    if (s === "coloraddw" || s === "white") return "w";
    if (s.includes("coloradda") || s === "amber") return "amber";
    if (s.includes("coloraddgy") || s === "lime") return "lime";
    if (s.includes("coloraddc") || s === "cyan") return "cyan";
    if (s.includes("coloraddm") || s === "magenta") return "magenta";
    if (s.includes("coloraddy") || s === "yellow") return "yellow";
    if (s === "uv" || s.includes("ultraviolet")) return "uv";
    if (s === "dimmer" || s.startsWith("dimmer")) return "intensity";
    if (s.includes("shutter") || s.includes("strobe")) return "strobe";
    if (s === "pan" || s.startsWith("pan")) return "pan";
    if (s === "tilt" || s.startsWith("tilt")) return "tilt";
    if (s.includes("zoom")) return "zoom";
    if (s.includes("focus")) return "focus";
    if (s.includes("iris")) return "iris";
    if (s.includes("frost")) return "frost";
    if (s.includes("prism") && s.includes("rotation")) return "prismr";
    if (s.includes("prism")) return "prism";
    if (s.includes("gobo") && s.includes("rotation")) return "gobor";
    if (s.includes("gobo")) return "gobo";
    if (s.includes("effect") && s.includes("speed")) return "speed";
    if (s.includes("effect")) return "effect";
    if (s.includes("speed") || s.includes("rate")) return "speed";
    if (s.includes("colormacro")) return "colmacro";
    if (s.includes("macro")) return "macro";
    if (s === "cto" || s === "ctb" || s === "ctc" || s.includes("colortemperature")) return "cct";
    if (s.includes("fog")) return "fog";
    if (s.includes("haze")) return "haze";
    if (s.includes("fan")) return "fana";
    return null;
  }

  function readStored() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } }
  function writeStored(v) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { console.warn("[GDTF] save failed", e); } }
  function u16(v, p) { return v.getUint16(p, true); }
  function u32(v, p) { return v.getUint32(p, true); }
  function zipEnd(bytes) { const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); for (let p = Math.max(0, bytes.length - 65557); p <= bytes.length - 22; p++) if (u32(v, p) === 0x06054b50) return p; return -1; }

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer), eocd = zipEnd(bytes);
    if (eocd < 0) throw new Error("Not a valid GDTF ZIP archive.");
    const count = u16(view, eocd + 10), centralOffset = u32(view, eocd + 16), out = new Map(); let p = centralOffset;
    for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
      if (u32(view, p) !== 0x02014b50) break;
      const method = u16(view, p + 10), compressedSize = u32(view, p + 20), nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32), localOffset = u32(view, p + 42);
      const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen)); p += 46 + nameLen + extraLen + commentLen;
      const lv = new DataView(buffer), localNameLen = u16(lv, localOffset + 26), localExtraLen = u16(lv, localOffset + 28), start = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = bytes.slice(start, start + compressedSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else continue;
      out.set(name.replace(/^\.\//, ""), data);
    }
    return out;
  }

  function parseDescription(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("GDTF description.xml could not be parsed.");
    const fixture = first(xml, "FixtureType"); if (!fixture) throw new Error("GDTF description.xml has no FixtureType.");
    const modes = all(fixture, "DMXMode"); if (!modes.length) throw new Error("GDTF fixture has no DMX modes.");
    return { fixture, modes, manufacturer: norm(attr(fixture, "Manufacturer")) || "Imported", fixtureName: norm(attr(fixture, "Name")) || "GDTF Fixture" };
  }

  function buildDefinition(parsed, mode) {
    const channels = all(mode, "DMXChannel"); if (!channels.length) throw new Error(`GDTF mode "${attr(mode, "Name")}" has no DMX channels.`);
    const map = {}, detailed = []; let highest = 0;
    for (const channel of channels) {
      const offsets = norm(attr(channel, "Offset")).split(",").map(Number).filter(Number.isFinite).filter(n => n > 0);
      if (!offsets.length) continue;
      const br = norm(attr(channel, "DMXBreak")) || "1";
      if (br !== "1" && br.toLowerCase() !== "overwrite") throw new Error(`GDTF mode uses DMX Break ${br}; this console currently supports DMX Break 1 only.`);
      const logical = first(channel, "LogicalChannel"); const fn = logical ? first(logical, "ChannelFunction") : null;
      const attribute = attr(fn, "Attribute") || attr(logical, "Attribute"); const mapped = mapAttribute(attribute);
      const zero = offsets[0] - 1; highest = Math.max(highest, ...offsets);
      if (mapped && map[mapped] === undefined) map[mapped] = zero;
      if (mapped && offsets.length > 1) map[mapped === "pan" ? "panf" : mapped === "tilt" ? "tiltf" : `${mapped}Fine`] ??= offsets[1] - 1;
      detailed.push({ offset: zero, offsets: offsets.map(n => n - 1), attribute: norm(attribute), function: norm(attr(fn, "Name")) });
    }
    if (map.intensity !== undefined) map.dimmer ??= map.intensity;
    if (map.dimmer !== undefined) map.intensity ??= map.dimmer;
    if (!Object.keys(map).length) throw new Error("GDTF mode contains DMX channels, but no supported attributes were recognised.");
    let type = "dimmer";
    if (map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined) type = "moving";
    else if (map.r !== undefined || map.g !== undefined || map.b !== undefined || map.w !== undefined || map.amber !== undefined) type = map.w !== undefined ? "rgbw" : "rgb";
    else if (map.strobe !== undefined && map.intensity === undefined) type = "strobe";
    return { type, channels: highest, map, photometrics: { verified: false, sourceType: "GDTF", ratedLumens: null, beamAngle: null, beamAngleMin: null, beamAngleMax: null, outputScale: 1, manufacturer: parsed.manufacturer, model: parsed.fixtureName, sourceNote: "Imported from GDTF. Verify the DMX mode against the fixture manual." }, importedFrom: "GDTF", importedAt: new Date().toISOString(), gdtf: { manufacturer: parsed.manufacturer, fixtureType: parsed.fixtureName, mode: norm(attr(mode, "Name")), channels: detailed } };
  }

  async function importGDTFFile(file) {
    const entries = await unzip(await file.arrayBuffer()); const desc = entries.get("description.xml") || entries.get("Description.xml"); if (!desc) throw new Error("GDTF file has no description.xml.");
    const parsed = parseDescription(new TextDecoder().decode(desc)), stored = readStored(), names = [];
    parsed.modes.forEach((mode, i) => { const modeName = norm(attr(mode, "Name")) || `Mode ${i + 1}`; const name = `${parsed.manufacturer} ${parsed.fixtureName} (${modeName})`.trim(); const def = buildDefinition(parsed, mode); FixtureLibrary[name] = def; stored[name] = def; names.push(name); });
    writeStored(stored); window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || ""); return names;
  }
  function restore() { const stored = readStored(); Object.entries(stored).forEach(([n, d]) => { if (!FixtureLibrary[n] && d && typeof d === "object") FixtureLibrary[n] = d; }); }
  function picker() { const input = document.createElement("input"); input.type = "file"; input.accept = ".gdtf,application/zip,application/octet-stream"; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { const names = await importGDTFFile(file); window.log?.(`Imported ${names.length} GDTF DMX mode${names.length === 1 ? "" : "s"}.`, "ok"); } catch (e) { console.error("[GDTF]", e); window.log?.(`GDTF import failed: ${e.message}`, "error"); } }; input.click(); }
  function install() { if (document.getElementById("btnImportGDTF")) return; const panel = document.getElementById("page-patch")?.querySelector(".panel:first-child .panel-body"); if (!panel) return false; const row = document.createElement("div"); row.className = "action-row"; row.style.marginTop = "10px"; row.innerHTML = '<button class="btn-secondary" id="btnImportGDTF" type="button">⇩ Import GDTF</button><span class="panel-meta" style="align-self:center">GDTF 1.2 · manufacturer profiles</span>'; panel.appendChild(row); document.getElementById("btnImportGDTF").onclick = picker; return true; }
  restore(); install(); window.GDTFImport = { importGDTFFile, openPicker: picker, restoreGDTF: restore };
})();
