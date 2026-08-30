"use strict";
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.ma2.v2";
  const norm = v => String(v ?? "").replace(/\s+/g, " ").trim();
  const key = v => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");
  const descendants = (root, name) => Array.from(root?.getElementsByTagName?.("*") || []).filter(e => (e.localName || e.nodeName) === name);
  const first = (root, name) => descendants(root, name)[0] || null;
  const attr = (el, ...names) => { for (const n of names) { const v = el?.getAttribute?.(n); if (v !== null) return v; const a = Array.from(el?.attributes || []).find(x => x.name.toLowerCase() === String(n).toLowerCase()); if (a) return a.value; } return null; };
  const num = (v, fallback = null) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const readStored = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } };
  const writeStored = v => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { console.warn("[MA2Import] save failed", e); } };

  function mapAttribute(value) {
    const s = key(value); if (!s) return null;
    if (["colorrgb1","colorrgbr","coloraddr","red"].includes(s)) return "r";
    if (["colorrgb2","colorrgbg","coloraddg","green"].includes(s)) return "g";
    if (["colorrgb3","colorrgbb","coloraddb","blue"].includes(s)) return "b";
    if (["colorrgb4","colorrgbw","coloraddw","white"].includes(s)) return "w";
    if (s.includes("amber")) return "amber";
    if (s.includes("lime")) return "lime";
    if (s.includes("cyan")) return "cyan";
    if (s.includes("magenta")) return "magenta";
    if (s.includes("yellow")) return "yellow";
    if (s === "uv" || s.includes("ultraviolet")) return "uv";
    if (s === "dim" || s.includes("dimmer") || s.includes("intensity")) return "intensity";
    if (s.includes("strobe") || s.includes("shutter")) return "strobe";
    if (s === "pan" || s.startsWith("pan")) return "pan";
    if (s === "tilt" || s.startsWith("tilt")) return "tilt";
    if (s.includes("zoom")) return "zoom";
    if (s.includes("focus")) return "focus";
    if (s.includes("iris")) return "iris";
    if (s.includes("frost")) return "frost";
    if (s.includes("prism") && (s.includes("rot") || s.includes("rotation"))) return "prismr";
    if (s.includes("prism")) return "prism";
    if (s.includes("gobo") && (s.includes("rot") || s.includes("rotation"))) return "gobor";
    if (s.includes("gobo")) return "gobo";
    if (s.includes("effect") && (s.includes("speed") || s.includes("rate"))) return "speed";
    if (s.includes("effect")) return "effect";
    if (s.includes("speed") || s.includes("rate")) return "speed";
    if (s.includes("colormacro")) return "colmacro";
    if (s.includes("colorpreset")) return "preset";
    if (s === "macro") return "macro";
    if (s.includes("temperature") || ["cct","cto","ctb","ctc"].includes(s)) return "cct";
    if (s.includes("fog")) return "fog";
    if (s.includes("haze")) return "haze";
    if (s.includes("fan")) return "fana";
    return null;
  }

  function address(channel) { const coarse = num(attr(channel, "coarse")); const fine = num(attr(channel, "fine")); const ultra = num(attr(channel, "ultra")); if (coarse !== null) return coarse - 1; if (fine !== null) return fine - 1; if (ultra !== null) return ultra - 1; return null; }

  function buildDefinition(fixture, module) {
    const channels = descendants(module, "ChannelType"); if (!channels.length) throw new Error("MA2 module contains no ChannelType entries.");
    const map = {}, details = []; let highest = 0;
    channels.forEach((ch, i) => {
      const a = address(ch); const mapped = mapAttribute(attr(ch, "attribute", "attrib") || attr(ch, "feature") || attr(ch, "preset") || attr(ch, "name"));
      const coarse = num(attr(ch, "coarse")), fine = num(attr(ch, "fine")), ultra = num(attr(ch, "ultra"));
      if (coarse !== null) highest = Math.max(highest, coarse); if (fine !== null) highest = Math.max(highest, fine); if (ultra !== null) highest = Math.max(highest, ultra);
      if (a !== null && mapped && map[mapped] === undefined) map[mapped] = Math.max(0, a);
      if (fine !== null && mapped && map[`${mapped}Fine`] === undefined) map[`${mapped}Fine`] = Math.max(0, fine - 1);
      if (ultra !== null && mapped && map[`${mapped}Ultra`] === undefined) map[`${mapped}Ultra`] = Math.max(0, ultra - 1);
      details.push({ index: num(attr(ch, "index"), i + 1), attribute: norm(attr(ch, "attribute", "attrib")), feature: norm(attr(ch, "feature")), preset: norm(attr(ch, "preset")), coarse, fine, ultra, virtual: a === null, mappedAs: mapped });
    });
    if (map.intensity !== undefined) map.dimmer ??= map.intensity;
    if (map.dimmer !== undefined) map.intensity ??= map.dimmer;
    if (!Object.keys(map).length) throw new Error("MA2 fixture contains DMX channels, but none of its attributes were recognised.");
    let type = "dimmer";
    if (map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined) type = "moving";
    else if (map.r !== undefined || map.g !== undefined || map.b !== undefined || map.w !== undefined || map.amber !== undefined) type = map.w !== undefined ? "rgbw" : "rgb";
    else if (map.strobe !== undefined && map.intensity === undefined) type = "strobe";
    return { type, channels: Math.max(1, highest), map, photometrics: { verified: false, sourceType: norm(attr(module, "beamtype")) || "UNKNOWN", ratedLumens: num(attr(module, "beam_intensity")), beamAngle: num(attr(module, "beam_angle")), beamAngleMin: null, beamAngleMax: null, outputScale: 1, manufacturer: norm(first(fixture, "manufacturer")?.textContent), model: norm(first(fixture, "short_name")?.textContent) || norm(attr(fixture, "name")), sourceNote: "Imported from grandMA2 FixtureType XML. Verify the DMX mode against the fixture manual." }, importedFrom: "grandMA2 XML", importedAt: new Date().toISOString(), ma2Channels: details };
  }

  function importFixtureXml(text) {
    let source = String(text || "").replace(/^\uFEFF/, ""); const start = source.indexOf("<?xml"); if (start > 0) source = source.slice(start);
    const xml = new DOMParser().parseFromString(source, "application/xml"); if (xml.querySelector("parsererror")) throw new Error("Invalid XML: " + norm(xml.querySelector("parsererror")?.textContent));
    if (key(xml.documentElement?.localName || xml.documentElement?.nodeName) !== "ma") throw new Error("This is not a grandMA2 XML file.");
    const fixtures = descendants(xml, "FixtureType"); if (!fixtures.length) throw new Error("No grandMA2 FixtureType elements found.");
    const stored = readStored(), names = [];
    fixtures.forEach((fixture, fi) => {
      const manufacturer = norm(first(fixture, "manufacturer")?.textContent); const fixtureName = norm(attr(fixture, "name")) || norm(first(fixture, "short_name")?.textContent) || `MA2 Fixture ${fi + 1}`;
      const modules = descendants(fixture, "Module"); if (!modules.length) throw new Error(`${fixtureName} has no Module entries.`);
      modules.forEach((module, mi) => { const modeName = norm(attr(module, "name")) || norm(attr(fixture, "mode")) || `Module ${mi + 1}`; const base = [manufacturer, fixtureName].filter(Boolean).join(" ").trim(); const name = modules.length === 1 ? base : `${base} (${modeName})`; const def = buildDefinition(fixture, module); FixtureLibrary[name] = def; stored[name] = def; names.push(name); console.info("[MA2Import]", name, def.map, def.channels); });
    });
    writeStored(stored); window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || ""); return names;
  }
  function picker() { const input = document.createElement("input"); input.type = "file"; input.accept = ".xml,text/xml,application/xml"; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { const names = importFixtureXml(await file.text()); window.log?.(`Imported ${names.length} MA2 fixture definition${names.length === 1 ? "" : "s"}.`, "ok"); } catch (e) { console.error("[MA2Import]", e); window.log?.(`MA2 import failed: ${e.message}`, "error"); } }; input.click(); }
  function install() { if (document.getElementById("btnImportMA2Fixture")) return; const panel = document.getElementById("page-patch")?.querySelector(".panel:first-child .panel-body"); if (!panel) return false; const row = document.createElement("div"); row.className = "action-row"; row.style.marginTop = "10px"; row.innerHTML = '<button class="btn-secondary" id="btnImportMA2Fixture" type="button">⇩ Import MA2 XML</button><span class="panel-meta" style="align-self:center">grandMA2 FixtureType</span>'; panel.appendChild(row); document.getElementById("btnImportMA2Fixture").onclick = picker; return true; }
  window.MA2FixtureImport = { importFixtureXml, openPicker: picker };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();
