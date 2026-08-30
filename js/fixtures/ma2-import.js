"use strict";

/* grandMA2 FixtureType XML importer. Converts MA2 ChannelTypes into the console's fixture definition shape. */
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.v1";
  const MAP = {
    DIM:"intensity", DIMMER:"intensity", INTENSITY:"intensity", STROBE:"strobe", SHUTTER:"strobe",
    RED:"r", GREEN:"g", BLUE:"b", WHITE:"w", COLORRGB1:"r", COLORRGB2:"g", COLORRGB3:"b", COLORRGB4:"w", COLORRGB5:"amber", COLORRGB6:"lime", COLORRGB7:"cyan", COLORRGB8:"magenta", COLORRGB9:"yellow", COLORRGB10:"uv",
    WARMWHITE:"warmWhite", COOLWHITE:"coolWhite", COLDWHITE:"coolWhite", AMBER:"amber", LIME:"lime", CYAN:"cyan", MAGENTA:"magenta", YELLOW:"yellow", UV:"uv", INDIGO:"indigo",
    PAN:"pan", TILT:"tilt", ZOOM:"zoom", FOCUS:"focus", IRIS:"iris", FROST:"frost", PRISM:"prism", PRISMR:"prismr", PRISMROTATION:"prismr",
    GOBO:"gobo", GOBO1:"gobo", GOBO2:"gobo2", GOBOR:"gobor", GOBOWHEEL:"gobo", GOBOWHEELROTATION:"gobor",
    EFFECT:"effect", SPEED:"speed", CCT:"cct", CTO:"cct", CTB:"cct", COLORMACRO:"colmacro", COLORPRESET:"preset", MACRO:"macro", FOG:"fog", HAZE:"haze", FAN:"fana"
  };

  const norm = v => String(v || "").replace(/\s+/g, " ").trim();
  const key = v => norm(v).toUpperCase().replace(/[^A-Z0-9_]/g, "");
  const num = (v, fallback = null) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

  function children(el, name) {
    return Array.from(el?.children || []).filter(c => c.localName === name || c.nodeName === name);
  }
  function child(el, name) { return children(el, name)[0] || null; }
  function childText(el, name) { return norm(child(el, name)?.textContent); }
  function attr(el, ...names) {
    if (!el) return null;
    for (const name of names) {
      const direct = el.getAttribute(name);
      if (direct !== null) return direct;
      const match = Array.from(el.attributes || []).find(a => a.name.toLowerCase() === name.toLowerCase());
      if (match) return match.value;
    }
    return null;
  }

  function readStored() {
    try { const raw = localStorage.getItem(STORAGE_KEY); const data = raw ? JSON.parse(raw) : {}; return data && typeof data === "object" ? data : {}; }
    catch { return {}; }
  }
  function writeStored(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (err) { console.warn("[MA2Import] persistence failed", err); }
  }

  function attributeFor(channel) {
    const fn = child(channel, "ChannelFunction");
    const candidates = [attr(channel, "attribute"), attr(fn, "attribute"), attr(fn, "subattribute"), attr(fn, "name")].map(norm).filter(Boolean);
    for (const candidate of candidates) {
      const mapped = MAP[key(candidate)];
      if (mapped) return mapped;
      const lower = candidate.toLowerCase();
      if (lower.includes("pan") && !lower.includes("tilt")) return "pan";
      if (lower.includes("tilt")) return "tilt";
      if (lower.includes("dimmer") || lower === "dim" || lower.includes("intensity")) return "intensity";
      if (lower.includes("strobe") || lower.includes("shutter")) return "strobe";
      if (lower.includes("red")) return "r"; if (lower.includes("green")) return "g"; if (lower.includes("blue")) return "b";
      if (lower.includes("white")) return lower.includes("warm") ? "warmWhite" : "w";
      if (lower.includes("amber")) return "amber"; if (lower.includes("lime")) return "lime"; if (lower.includes("cyan")) return "cyan";
      if (lower.includes("magenta")) return "magenta"; if (lower.includes("yellow")) return "yellow"; if (lower.includes("zoom")) return "zoom";
      if (lower.includes("focus")) return "focus"; if (lower.includes("iris")) return "iris"; if (lower.includes("frost")) return "frost";
      if (lower.includes("prism")) return lower.includes("rot") ? "prismr" : "prism";
      if (lower.includes("gobo")) return lower.includes("rot") ? "gobor" : "gobo";
      if (lower.includes("effect")) return "effect"; if (lower.includes("speed")) return "speed";
      if (lower.includes("temperature") || ["cct","cto","ctb"].includes(lower)) return "cct";
      if (lower.includes("macro")) return "macro"; if (lower.includes("fog")) return "fog"; if (lower.includes("haze")) return "haze"; if (lower.includes("fan")) return "fana";
    }
    return null;
  }

  function channelNumber(channel, fallback) {
    // MA2 Coarse/Fine/Ultra are DMX addresses relative to the module. A
    // ChannelType without any of these is a virtual attribute and must NOT
    // be assigned a DMX address merely because it has an internal index.
    const coarse = num(attr(channel, "coarse"));
    if (coarse !== null) return Math.max(0, coarse - 1);
    const index = num(attr(channel, "index"));
    return index !== null ? Math.max(0, index - 1) : fallback;
  }

  function hasPhysicalDMX(channel) {
    return num(attr(channel, "coarse")) !== null || num(attr(channel, "fine")) !== null || num(attr(channel, "ultra")) !== null;
  }

  function buildMap(channels) {
    const map = {};
    channels.forEach((channel, index) => {
      const attrName = attributeFor(channel); if (!attrName) return;
      // Ignore virtual attributes. They are useful in MA2 but have no DMX byte
      // for this console to write to.
      if (!hasPhysicalDMX(channel)) return;
      const coarse = channelNumber(channel, index);
      if (map[attrName] === undefined) map[attrName] = coarse;
      const fine = num(attr(channel, "fine"));
      if (fine !== null && map[`${attrName}Fine`] === undefined) map[`${attrName}Fine`] = Math.max(0, fine - 1);
      const ultra = num(attr(channel, "ultra"));
      if (ultra !== null && map[`${attrName}Ultra`] === undefined) map[`${attrName}Ultra`] = Math.max(0, ultra - 1);
    });
    if (map.intensity === undefined && map.dimmer !== undefined) map.intensity = map.dimmer;
    if (map.dimmer === undefined && map.intensity !== undefined) map.dimmer = map.intensity;
    return map;
  }

  function inferType(map, cls) {
    const moving = map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined;
    const colour = ["r","g","b","w","warmWhite","coolWhite","amber","lime","cyan","magenta","yellow"].some(k => map[k] !== undefined);
    const c = key(cls);
    if (moving || c.includes("HEADMOVER") || c.includes("MOVING")) return "moving";
    if (colour) return map.w !== undefined ? "rgbw" : "rgb";
    if (map.strobe !== undefined && map.intensity === undefined) return "strobe";
    return "dimmer";
  }

  function buildDefinition(fixture, module) {
    const channels = children(module, "ChannelType");
    if (!channels.length) throw new Error("MA2 module contains no ChannelType entries.");
    const map = buildMap(channels);
    const physicalChannels = channels.filter(hasPhysicalDMX);
    const highest = physicalChannels.reduce((max, ch, i) => {
      const coarse = num(attr(ch, "coarse"), 0);
      const fine = num(attr(ch, "fine"), 0);
      const ultra = num(attr(ch, "ultra"), 0);
      return Math.max(max, coarse, fine, ultra);
    }, 0);

    const definition = {
      type: inferType(map, attr(module, "class")),
      channels: highest || physicalChannels.length || 1,
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
      ma2Channels: channels.map((ch, i) => {
        const fn = child(ch, "ChannelFunction");
        return {
          index: num(attr(ch, "index"), i + 1), attribute: norm(attr(ch, "attribute")), coarse: num(attr(ch, "coarse")),
          fine: num(attr(ch, "fine")), ultra: num(attr(ch, "ultra")), default: num(attr(ch, "default")),
          virtual: !hasPhysicalDMX(ch), invert: String(attr(ch, "invert") || "").toLowerCase() === "true", functionName: norm(attr(fn, "name")),
          minDmx: num(attr(fn, "min_dmx")), maxDmx: num(attr(fn, "max_dmx"))
        };
      })
    };
    if (definition.photometrics.beamAngle !== null && definition.photometrics.beamAngle <= 0) definition.photometrics.beamAngle = null;
    return definition;
  }

  function importFixtureXml(text) {
    if (typeof DOMParser === "undefined") throw new Error("XML parsing is not available.");
    const xml = new DOMParser().parseFromString(String(text || ""), "application/xml");
    const error = xml.querySelector("parsererror");
    if (error) throw new Error(`Invalid XML: ${norm(error.textContent)}`);
    if (!xml.documentElement || norm(xml.documentElement.localName || xml.documentElement.nodeName) !== "MA") throw new Error("This is not a grandMA2 XML file.");

    const fixtureTypes = Array.from(xml.getElementsByTagName("FixtureType"));
    if (!fixtureTypes.length) throw new Error("No grandMA2 FixtureType found.");

    const saved = readStored(); const names = [];
    fixtureTypes.forEach((fixture, fi) => {
      const manufacturer = childText(fixture, "manufacturer");
      const fixtureName = norm(attr(fixture, "name")) || childText(fixture, "short_name") || `MA2 Fixture ${fi + 1}`;
      const modules = children(child(fixture, "Modules"), "Module");
      if (!modules.length) throw new Error(`${fixtureName} has no Module entries.`);
      modules.forEach((module, mi) => {
        const mode = norm(attr(fixture, "mode")) || childText(fixture, "short_name") || norm(attr(module, "name"));
        const base = [manufacturer, fixtureName].filter(Boolean).join(" ").trim();
        const name = modules.length === 1 ? base : `${base} (${mode || attr(module, "name") || `Module ${mi + 1}`})`;
        const definition = buildDefinition(fixture, module);
        FixtureLibrary[name] = definition; saved[name] = definition; names.push(name);
      });
    });
    writeStored(saved); window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || "");
    return names;
  }

  function openPicker() {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".xml,text/xml,application/xml";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try { const names = importFixtureXml(await file.text()); window.log?.(names.length === 1 ? `Imported MA2 fixture: ${names[0]}` : `Imported ${names.length} MA2 fixture definitions.`, "ok"); }
      catch (err) { console.error("[MA2Import]", err); window.log?.(`MA2 fixture import failed: ${err.message}`, "error"); }
    };
    input.click();
  }

  function installUI() {
    if (document.getElementById("btnImportMA2Fixture")) return;
    const panel = document.getElementById("page-patch")?.querySelector(".panel:first-child .panel-body"); if (!panel) return;
    const row = document.createElement("div"); row.className = "action-row"; row.style.marginTop = "10px";
    row.innerHTML = '<button class="btn-secondary" id="btnImportMA2Fixture" type="button">⇩ Import MA2 XML</button><span class="panel-meta" style="align-self:center">grandMA2 FixtureType</span>';
    panel.appendChild(row); document.getElementById("btnImportMA2Fixture").onclick = openPicker;
  }

  window.MA2FixtureImport = { importFixtureXml, openPicker };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installUI, { once: true }); else installUI();
})();
