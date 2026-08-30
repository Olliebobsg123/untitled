"use strict";
(() => {
  const STORAGE_KEY = "lightingConsole.importedFixtures.ma2.v3";
  const norm = v => String(v ?? "").replace(/\s+/g, " ").trim();
  const key = v => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");
  const descendants = (root, name) => Array.from(root?.getElementsByTagName?.("*") || []).filter(e => (e.localName || e.nodeName) === name);
  const children = (root, name) => Array.from(root?.children || []).filter(e => (e.localName || e.nodeName) === name);
  const first = (root, name) => descendants(root, name)[0] || null;
  const attr = (el, ...names) => {
    for (const n of names) {
      const v = el?.getAttribute?.(n);
      if (v !== null && v !== undefined) return v;
      const a = Array.from(el?.attributes || []).find(x => x.name.toLowerCase() === String(n).toLowerCase());
      if (a) return a.value;
    }
    return null;
  };
  const num = (v, fallback = null) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const readStored = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } };
  const writeStored = v => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { console.warn("[MA2] save failed", e); } };

  function mapAttribute(value) {
    const s = key(value); if (!s) return null;
    const exact = {
      dim: "intensity", dimmer: "intensity", intensity: "intensity",
      colorrgb1: "r", colorrgb2: "g", colorrgb3: "b", colorrgb4: "w",
      colorrgb5: "amber", colorrgb6: "lime", colorrgb7: "cyan", colorrgb8: "magenta", colorrgb9: "yellow", colorrgb10: "uv",
      red: "r", green: "g", blue: "b", white: "w", amber: "amber", lime: "lime", cyan: "cyan", magenta: "magenta", yellow: "yellow", uv: "uv",
      pan: "pan", tilt: "tilt", zoom: "zoom", focus: "focus", iris: "iris", frost: "frost",
      prism: "prism", prismr: "prismr", prismrotation: "prismr",
      gobo1: "gobo", gobo2: "gobo2", gobor: "gobor", goborotation: "gobor",
      strobe: "strobe", shutter: "strobe", effect: "effect", effectspeed: "speed", speed: "speed",
      macro: "macro", colormacro: "colmacro", colorpreset: "preset", cto: "cct", ctb: "cct", ctc: "cct", cct: "cct",
      fog: "fog", haze: "haze", fan: "fana"
    };
    if (exact[s]) return exact[s];
    if (s.includes("dimmer") || s === "dim" || s.includes("intensity")) return "intensity";
    if (s.includes("pan") && !s.includes("tilt")) return "pan";
    if (s.includes("tilt")) return "tilt";
    if (s.includes("strobe") || s.includes("shutter")) return "strobe";
    if (s.includes("red")) return "r";
    if (s.includes("green")) return "g";
    if (s.includes("blue")) return "b";
    if (s.includes("white")) return s.includes("warm") ? "warmWhite" : "w";
    if (s.includes("amber")) return "amber";
    if (s.includes("lime")) return "lime";
    if (s.includes("cyan")) return "cyan";
    if (s.includes("magenta")) return "magenta";
    if (s.includes("yellow")) return "yellow";
    if (s === "uv" || s.includes("ultraviolet")) return "uv";
    if (s.includes("zoom")) return "zoom";
    if (s.includes("focus")) return "focus";
    if (s.includes("iris")) return "iris";
    if (s.includes("frost")) return "frost";
    if (s.includes("prism") && (s.includes("rot") || s.includes("rotation"))) return "prismr";
    if (s.includes("prism")) return "prism";
    if (s.includes("gobo") && (s.includes("rot") || s.includes("rotation"))) return "gobor";
    if (s.includes("gobo2")) return "gobo2";
    if (s.includes("gobo")) return "gobo";
    if (s.includes("effect") && (s.includes("speed") || s.includes("rate"))) return "speed";
    if (s.includes("effect")) return "effect";
    if (s.includes("speed") || s.includes("rate")) return "speed";
    if (s.includes("macro")) return "macro";
    if (s.includes("temperature") || ["cto", "ctb", "ctc", "cct"].includes(s)) return "cct";
    if (s.includes("fog")) return "fog";
    if (s.includes("haze")) return "haze";
    if (s.includes("fan")) return "fana";
    return null;
  }

  function moduleList(fixture) {
    const parent = first(fixture, "Modules");
    return parent ? children(parent, "Module") : descendants(fixture, "Module");
  }

  function instanceList(fixture) {
    const parent = first(fixture, "Instances");
    return parent ? children(parent, "Instance") : descendants(fixture, "Instance");
  }

  function instancePatch(instance) {
    const patch = num(attr(instance, "patch", "Patch"));
    return patch === null ? 1 : patch;
  }

  function buildDefinition(fixture) {
    const modules = moduleList(fixture);
    if (!modules.length) throw new Error("MA2 fixture has no Module entries.");

    const instances = instanceList(fixture);
    const moduleByIndex = new Map(modules.map((m, i) => [String(num(attr(m, "index"), i)), m]));
    const targets = [];

    if (instances.length) {
      instances.forEach((instance, i) => {
        const moduleIndex = String(num(attr(instance, "module_index", "moduleIndex", "module"), 0));
        const module = moduleByIndex.get(moduleIndex) || modules[0];
        targets.push({ module, patch: instancePatch(instance), instance: i + 1, moduleIndex });
      });
    } else {
      modules.forEach((module, i) => targets.push({ module, patch: 1, instance: i + 1, moduleIndex: String(num(attr(module, "index"), i)) }));
    }

    const map = {};
    const details = [];
    let highest = 0;

    for (const target of targets) {
      const channels = descendants(target.module, "ChannelType");
      for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        const coarse = num(attr(ch, "coarse"));
        const fine = num(attr(ch, "fine"));
        const ultra = num(attr(ch, "ultra"));
        const mapped = mapAttribute(attr(ch, "attribute", "attrib") || attr(ch, "feature") || attr(ch, "preset"));
        const physical = coarse !== null || fine !== null || ultra !== null;
        if (!physical) {
          details.push({ instance: target.instance, moduleIndex: target.moduleIndex, attribute: norm(attr(ch, "attribute", "attrib")), coarse, fine, ultra, virtual: true, mappedAs: mapped });
          continue;
        }

        // MA2 Coarse/Fine/Ultra values are offsets from the module's instance
        // patch. Both are 1-based, so convert the final absolute address to
        // the console's zero-based fixture map.
        const base = Math.max(1, target.patch);
        const coarseOffset = coarse !== null ? base + coarse - 2 : null;
        const fineOffset = fine !== null ? base + fine - 2 : null;
        const ultraOffset = ultra !== null ? base + ultra - 2 : null;
        const primary = coarseOffset ?? fineOffset ?? ultraOffset;

        if (primary !== null) {
          highest = Math.max(highest, primary + 1, fineOffset === null ? 0 : fineOffset + 1, ultraOffset === null ? 0 : ultraOffset + 1);
          if (mapped && map[mapped] === undefined) map[mapped] = primary;
          if (mapped && fineOffset !== null && map[`${mapped}Fine`] === undefined) map[`${mapped}Fine`] = fineOffset;
          if (mapped && ultraOffset !== null && map[`${mapped}Ultra`] === undefined) map[`${mapped}Ultra`] = ultraOffset;
        }

        details.push({ instance: target.instance, moduleIndex: target.moduleIndex, patch: target.patch, attribute: norm(attr(ch, "attribute", "attrib")), feature: norm(attr(ch, "feature")), preset: norm(attr(ch, "preset")), coarse, fine, ultra, virtual: false, mappedAs: mapped, mapOffset: primary });
      }
    }

    if (map.intensity !== undefined) map.dimmer ??= map.intensity;
    if (map.dimmer !== undefined) map.intensity ??= map.dimmer;
    if (!Object.keys(map).length) throw new Error("MA2 fixture contains DMX channels, but none of its attributes were recognised.");

    let type = "dimmer";
    if (map.pan !== undefined || map.tilt !== undefined || map.zoom !== undefined || map.focus !== undefined) type = "moving";
    else if (map.r !== undefined || map.g !== undefined || map.b !== undefined || map.w !== undefined || map.amber !== undefined) type = map.w !== undefined ? "rgbw" : "rgb";
    else if (map.strobe !== undefined && map.intensity === undefined) type = "strobe";

    return {
      type,
      channels: Math.max(1, highest),
      map,
      photometrics: {
        verified: false,
        sourceType: norm(attr(modules[0], "beamtype")) || "UNKNOWN",
        ratedLumens: num(attr(modules[0], "beam_intensity")),
        beamAngle: num(attr(modules[0], "beam_angle")), beamAngleMin: null, beamAngleMax: null, outputScale: 1,
        manufacturer: norm(first(fixture, "manufacturer")?.textContent),
        model: norm(first(fixture, "short_name")?.textContent) || norm(attr(fixture, "name")),
        sourceNote: "Imported from grandMA2 FixtureType XML. Instance patch offsets and Coarse/Fine/Ultra addresses were resolved. Verify the DMX mode against the fixture manual."
      },
      importedFrom: "grandMA2 XML",
      importedAt: new Date().toISOString(),
      ma2: { modules: modules.length, instances: targets.length, channels: details }
    };
  }

  function importFixtureXml(text) {
    let source = String(text || "").replace(/^\uFEFF/, "");
    const start = source.indexOf("<?xml"); if (start > 0) source = source.slice(start);
    const xml = new DOMParser().parseFromString(source, "application/xml");
    const parserError = xml.querySelector("parsererror"); if (parserError) throw new Error("Invalid XML: " + norm(parserError.textContent));
    if (key(xml.documentElement?.localName || xml.documentElement?.nodeName) !== "ma") throw new Error("This is not a grandMA2 XML file.");

    const fixtures = descendants(xml, "FixtureType");
    if (!fixtures.length) throw new Error("No grandMA2 FixtureType elements found.");
    const stored = readStored(), names = [];

    fixtures.forEach((fixture, fi) => {
      const manufacturer = norm(first(fixture, "manufacturer")?.textContent);
      const fixtureName = norm(attr(fixture, "name")) || norm(first(fixture, "short_name")?.textContent) || `MA2 Fixture ${fi + 1}`;
      const mode = norm(attr(fixture, "mode"));
      const name = [manufacturer, fixtureName, mode].filter(Boolean).join(" ").trim();
      const def = buildDefinition(fixture);
      FixtureLibrary[name] = def;
      stored[name] = def;
      names.push(name);
      console.info("[MA2] imported", name, "map", def.map, "footprint", def.channels);
    });

    writeStored(stored);
    window.renderLibrary?.(document.getElementById("fixtureSearch")?.value || "");
    return names;
  }

  function picker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml,text/xml,application/xml";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const names = importFixtureXml(await file.text());
        window.log?.(`Imported ${names.length} MA2 fixture definition${names.length === 1 ? "" : "s"}.`, "ok");
      } catch (e) {
        console.error("[MA2]", e);
        window.log?.(`MA2 import failed: ${e.message}`, "error");
      }
    };
    input.click();
  }

  function install() {
    if (document.getElementById("btnImportMA2Fixture")) return true;
    const panel = document.getElementById("page-patch")?.querySelector(".panel:first-child .panel-body");
    if (!panel) return false;
    const row = document.createElement("div");
    row.className = "action-row";
    row.style.marginTop = "10px";
    row.innerHTML = '<button class="btn-secondary" id="btnImportMA2Fixture" type="button">⇩ Import MA2 XML</button><span class="panel-meta" style="align-self:center">grandMA2 FixtureType</span>';
    panel.appendChild(row);
    document.getElementById("btnImportMA2Fixture").onclick = picker;
    return true;
  }

  window.MA2FixtureImport = { importFixtureXml, openPicker: picker };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
