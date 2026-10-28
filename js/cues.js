"use strict";

window.State = window.State || {};

State.cues = Array.isArray(State.cues) ? State.cues : [];
State.chases = Array.isArray(State.chases) ? State.chases : [];
State.currentCue = Number.isInteger(State.currentCue) ? State.currentCue : -1;

State.fixtureStates =
    State.fixtureStates instanceof Map
        ? State.fixtureStates
        : new Map();

State.fading = null;
State.followTimer = null;

function cueLog(message, type = "info") {
    if (typeof window.log === "function") window.log(message, type);
    else console.log("[CUES]", message);
}

function clone(value) {
    if (!value || typeof value !== "object") return {};
    try {
        if (typeof window.cloneFixtureState === "function") {
            return window.cloneFixtureState(value);
        }
        return { ...value };
    } catch (error) {
        return { ...value };
    }
}

function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/*
 * Cue numbers. Every cue carries its own number (cue.number), so cues can
 * go in between others: 0.5 before 1, 1.5 between 1 and 2, 2.25, and so on
 * (up to three decimal places, like a lighting desk's point cues). The
 * list is always kept in number order; an index is only a cue's place in
 * that list. Shows from before point cues are numbered 1, 2, 3… in order.
 */
const CUE_EPSILON = 1e-6;
function parseCueNumber(value) {
    const n = Math.round(Number(String(value ?? "").trim()) * 1000) / 1000;
    return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}
function formatCueNumber(n) {
    const v = Math.round(Number(n) * 1000) / 1000;
    return Number.isFinite(v) ? String(v) : "?";
}
function cueNumberOf(index) {
    const cue = State.cues?.[index];
    return cue && Number.isFinite(Number(cue.number)) ? Number(cue.number) : index + 1;
}
function cueLabel(index) {
    return formatCueNumber(cueNumberOf(index));
}
function cueIndexOf(number) {
    const n = parseCueNumber(number);
    if (n == null) return -1;
    return (State.cues || []).findIndex(cue => cue && Math.abs(Number(cue.number) - n) < CUE_EPSILON);
}
// The next whole number after the last cue (what "record" with no number uses).
function nextCueNumber() {
    let top = 0;
    (State.cues || []).forEach(cue => { if (cue && Number(cue.number) > top) top = Number(cue.number); });
    return Math.floor(top + CUE_EPSILON) + 1;
}
// Move every index that points into the cue list (live cue, chosen next
// cue, chase steps) after the list has been rearranged. `where` maps an old
// index to its new one, or -1 when that cue is gone.
function reindexCues(where) {
    const map = i => (Number.isInteger(Number(i)) && Number(i) >= 0 ? where(Number(i)) : -1);
    if (Number.isInteger(State.currentCue) && State.currentCue >= 0) State.currentCue = map(State.currentCue);
    if (State.nextCue != null && State.nextCue !== "") { const n = map(State.nextCue); State.nextCue = n >= 0 ? n : null; }
    (State.chases || []).forEach(chase => {
        if (chase && Array.isArray(chase.steps)) chase.steps = chase.steps.map(map).filter(i => i >= 0);
    });
}
// Give every cue a number, keep them in number order, drop empty slots.
// Cheap when nothing needs doing (called on every redraw).
function normaliseCueNumbers() {
    const cues = State.cues;
    if (!Array.isArray(cues)) return false;
    let fine = true, last = 0;
    for (const cue of cues) {
        const n = cue ? Number(cue.number) : NaN;
        if (!cue || !Number.isFinite(n) || n <= last + CUE_EPSILON / 2) { fine = false; break; }
        last = n;
    }
    if (fine) return false;
    // Numbers for cues without one: their old place (1, 2, 3…), never
    // going backwards.
    let previous = 0;
    cues.forEach((cue, i) => {
        if (!cue) return;
        let n = parseCueNumber(cue.number);
        if (n == null) n = Math.max(i + 1, Math.floor(previous + CUE_EPSILON) + 1);
        cue.number = n;
        previous = n;
    });
    const order = cues.map((cue, i) => ({ cue, i })).filter(e => e.cue).sort((a, b) => a.cue.number - b.cue.number || a.i - b.i);
    // Two cues with the same number: the later one moves just after.
    for (let k = 1; k < order.length; k++) {
        const prev = order[k - 1].cue.number;
        if (order[k].cue.number <= prev + CUE_EPSILON / 2) order[k].cue.number = Math.round((prev + 0.001) * 1000) / 1000;
    }
    const newIndex = new Map(order.map((e, k) => [e.i, k]));
    reindexCues(i => (newIndex.has(i) ? newIndex.get(i) : -1));
    State.cues = order.map(e => e.cue);
    return true;
}
// A tidy number between two cue numbers (either can be missing): the
// roundest one that fits, so dropping a cue between 2 and 3 makes it 2.5,
// between 2 and 2.5 makes it 2.3.
function cueNumberBetween(a, b) {
    a = Number(a) || 0;
    if (b == null || !Number.isFinite(Number(b))) return Math.floor(a + CUE_EPSILON) + 1;
    b = Number(b);
    for (const step of [1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001]) {
        const x = Math.round((Math.floor((a + CUE_EPSILON) / step) + 1) * step * 1000) / 1000;
        if (x > a + CUE_EPSILON && x < b - CUE_EPSILON) return x;
    }
    return null; // no room (they're 0.001 apart)
}
// Make room for a new cue numbered `number` at its place in the list.
function insertCueSlot(number) {
    normaliseCueNumbers();
    let index = State.cues.findIndex(cue => cue && Number(cue.number) > number);
    if (index < 0) index = State.cues.length;
    State.cues.splice(index, 0, null);
    reindexCues(i => (i >= index ? i + 1 : i));
    return index;
}

function normaliseEffectFixtureIds(ids) {
    if (!Array.isArray(ids) && !(ids instanceof Set)) return [];
    return [...new Set([...ids].filter(id => id != null).map(String))];
}

function snapshotCueEffect() {
    const effect = State.activeEffect;
    if (!effect || !effect.type) return null;

    // IMPORTANT: the effect type alone is not enough. Two saved effects can
    // both be "rainbow" but target completely different fixtures. Store the
    // exact target IDs with the cue so replaying a cue never falls back to
    // whatever fixtures happen to be selected at the time.
    const fixtureIds = normaliseEffectFixtureIds(effect.fixtureIds);
    const snapshot = {
        type: String(effect.type),
        speed: num(effect.speed, 1),
        fixtureMode: effect.fixtureMode || (fixtureIds.length ? "custom" : "selected"),
        fixtureIds
    };

    if (effect.name) snapshot.name = String(effect.name);
    return snapshot;
}

// Every effect running, for a cue to bring back (several can run at once).
function snapshotCueEffects() {
    const list = Array.isArray(State.effects) ? State.effects : [];
    return list.map(e => {
        const fixtureIds = normaliseEffectFixtureIds(e.ids instanceof Set ? [...e.ids] : e.fixtureIds);
        const snap = { type: String(e.type), speed: num(e.speed, 1), fixtureMode: "custom", fixtureIds };
        if (e.name) snap.name = String(e.name);
        if (e.levels instanceof Map) snap.levels = Object.fromEntries(e.levels);
        return snap;
    }).filter(e => e.type && e.fixtureIds.length);
}

function stopCueEffect() {
    if (typeof window.stopEffect === "function") window.stopEffect(true);
}

function startCueEffectIfNeeded(cue) {
    // A cue recorded with several effects running brings them all back.
    if (cue && Array.isArray(cue.effects) && cue.effects.length > 1 && typeof window.startEffect === "function") {
        stopCueEffect();
        cue.effects.forEach(saved => {
            const ok = window.startEffect(String(saved.type), { ...saved, fixtureMode: "custom", fixtureIds: normaliseEffectFixtureIds(saved.fixtureIds) });
            if (!ok) cueLog("Cue effect could not be started: " + saved.type, "warn");
        });
        return;
    }
    if (!cue || !cue.effect || !cue.effect.type) {
        stopCueEffect();
        return;
    }
    if (typeof window.startEffect !== "function") {
        cueLog("Cue contains an effect but the Effects Engine is unavailable", "warn");
        return;
    }

    const saved = cue.effect;
    const fixtureIds = normaliseEffectFixtureIds(saved.fixtureIds);
    const effect = {
        type: String(saved.type),
        speed: num(saved.speed, 1)
    };

    // If the cue recorded a target list, replay that exact list. This is the
    // crucial distinction between two effects such as "Rainbow" and
    // "PAR Rainbow": both may have type="rainbow", but their fixtureIds are
    // different and must remain different when a cue is played.
    if (fixtureIds.length) {
        effect.fixtureMode = "custom";
        effect.fixtureIds = fixtureIds;
    } else if (saved.fixtureMode === "all") {
        effect.fixtureMode = "all";
    } else {
        // Older cues did not store effect targets. Keep their old behaviour
        // rather than inventing a fixture list that could be wrong.
        effect.fixtureMode = saved.fixtureMode || "selected";
    }

    if (saved.name) effect.name = String(saved.name);

    const started = window.startEffect(effect.type, effect);
    if (!started) cueLog("Cue effect could not be started: " + effect.type, "warn");
}

function stopCueFade() {
    if (State.fading !== null) {
        LXClock.cancel(State.fading);
        State.fading = null;
    }
}

function stopFollow() {
    if (State.followTimer !== null) {
        clearTimeout(State.followTimer);
        State.followTimer = null;
    }
}

function stopCueTimers() {
    stopCueFade();
    stopFollow();
}

function pushLightingUpdate() {
    try {
        if (typeof window.updateDMX === "function") window.updateDMX();
    } catch (error) {
        console.error("updateDMX failed:", error);
    }
    try {
        if (typeof window.sendToVisualizer === "function") window.sendToVisualizer();
    } catch (error) {
        console.error("Visualizer update failed:", error);
    }
}

function snapshotFixtureStates() {
    const result = [];
    State.fixtureStates.forEach((state, id) => result.push([id, clone(state)]));
    return result;
}

function snapshotCurrentLighting() {
    const fixtureMap = new Map();
    State.fixtureStates.forEach((state, id) => fixtureMap.set(id, clone(state)));
    return { globalState: clone(State.current || {}), fixtureMap };
}

function blockTarget(cue) {
    const globalState = clone(cue && (cue.globalState || cue.state) || {});
    const fixtureMap = new Map();
    if (Array.isArray(cue && cue.fixtureStates)) {
        cue.fixtureStates.forEach(entry => {
            if (!Array.isArray(entry) || entry.length < 2) return;
            const id = entry[0];
            const state = entry[1];
            if (id != null && state) fixtureMap.set(id, clone(state));
        });
    }
    if (!fixtureMap.size) {
        (State.fixtures || []).forEach(fixture => {
            if (fixture && fixture.id != null) fixtureMap.set(fixture.id, clone(globalState));
        });
    }
    return { globalState, fixtureMap };
}

/*
 * Tracking, like Eos. A tracked cue (cue.mode === "track") stores only what
 * it changes: fixtureStates holds [id, {changed keys}] pairs. Everything
 * else carries on from the cues before it, back to the last block cue (a
 * cue that stores its whole look — every cue recorded before tracking
 * existed is one). Change a tracked value in cue 3 and it tracks on into
 * cues 4, 5… until a cue moves it.
 *
 * Deleting, moving or copying cues never changes how the other cues look:
 * healLooks() notices the list was rearranged and blocks any cue whose
 * look would otherwise have shifted.
 */
const isTracked = cue => Boolean(cue && cue.mode === "track");
const cloneValue = v => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
const recordMode = () => window.LXPrefs?.get("recordMode") || "track";

function cueLook(index) {
    const cues = State.cues || [];
    let start = Math.min(index, cues.length - 1);
    while (start >= 0 && (!cues[start] || isTracked(cues[start]))) start--;
    let globalState = {}, fixtureMap = new Map();
    if (start >= 0) ({ globalState, fixtureMap } = blockTarget(cues[start]));
    for (let i = start + 1; i <= index; i++) {
        const cue = cues[i];
        if (!cue) continue;
        globalState = clone(cue.globalState || cue.state || globalState);
        (cue.fixtureStates || []).forEach(entry => {
            if (!Array.isArray(entry) || entry.length < 2 || entry[0] == null || !entry[1]) return;
            fixtureMap.set(entry[0], { ...(fixtureMap.get(entry[0]) || {}), ...clone(entry[1]) });
        });
    }
    // A tracked cue with no block before it (after deleting cues): anything
    // it doesn't mention stays dark.
    if (start < 0) {
        (State.fixtures || []).forEach(f => {
            if (f && f.id != null && !fixtureMap.has(f.id)) fixtureMap.set(f.id, { ...clone(State.fixtureStates.get(f.id) || globalState), intensity: 0 });
        });
    }
    return { globalState, fixtureMap };
}

function getCueTarget(cue) {
    const index = (State.cues || []).indexOf(cue);
    if (index < 0 || !isTracked(cue)) return blockTarget(cue);
    healLooks();
    return cueLook(index);
}

// The look just before cue `index` (the nearest earlier cue's), or null.
function lookBefore(index) {
    for (let i = index - 1; i >= 0; i--) if (State.cues[i]) return cueLook(i);
    return null;
}

const sameValue = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : a && b && typeof a === "object" && typeof b === "object" ? JSON.stringify(a) === JSON.stringify(b) : a === b);
function lookDiff(states, before) {
    const changes = [];
    states.forEach(([id, state]) => {
        const was = before.fixtureMap.get(id) || {};
        const part = {};
        Object.keys(state).forEach(key => { if (!(key in was) || !sameValue(state[key], was[key])) part[key] = cloneValue(state[key]); });
        if (Object.keys(part).length) changes.push([id, part]);
    });
    return changes;
}
function sameLook(a, b) {
    if (!a || !b || a.fixtureMap.size !== b.fixtureMap.size) return false;
    for (const [id, sa] of a.fixtureMap) {
        const sb = b.fixtureMap.get(id);
        if (!sb) return false;
        const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
        for (const key of keys) if (!sameValue(sa[key], sb[key])) return false;
    }
    return true;
}

// Every cue's look in one pass (cheaper than cueLook for each).
function allLooks() {
    const looks = new Map();
    let globalState = {}, fixtureMap = null;
    (State.cues || []).forEach((cue, i) => {
        if (!cue) return;
        if (!isTracked(cue) || !fixtureMap) {
            ({ globalState, fixtureMap } = isTracked(cue) ? cueLook(i) : blockTarget(cue));
        } else {
            globalState = clone(cue.globalState || cue.state || globalState);
            fixtureMap = new Map([...fixtureMap].map(([id, st]) => [id, { ...st }]));
            (cue.fixtureStates || []).forEach(entry => {
                if (Array.isArray(entry) && entry.length > 1 && entry[0] != null && entry[1]) fixtureMap.set(entry[0], { ...(fixtureMap.get(entry[0]) || {}), ...clone(entry[1]) });
            });
        }
        looks.set(cue, { globalState, fixtureMap });
    });
    return looks;
}

let knownOrder = [], knownLooks = new Map();
function rememberLooks() {
    knownOrder = [...(State.cues || [])];
    knownLooks = allLooks();
}
function healLooks() {
    const cues = State.cues || [];
    if (cues.length === knownOrder.length && cues.every((cue, i) => cue === knownOrder[i])) return 0;
    let healed = 0;
    if (knownLooks.size) {
        cues.forEach((cue, i) => {
            const was = cue && knownLooks.get(cue);
            if (!was || !isTracked(cue)) return;
            if (sameLook(was, cueLook(i))) return;
            cue.fixtureStates = [...was.fixtureMap].map(([id, st]) => [id, clone(st)]);
            cue.mode = "block";
            healed++;
        });
    }
    rememberLooks();
    return healed;
}

// Switch a cue between tracked and block without changing any cue's look.
function setCueMode(index, mode) {
    const cue = State.cues[index];
    if (!cue) return false;
    healLooks();
    const look = cueLook(index);
    const before = lookBefore(index);
    if (mode === "track" && before) {
        cue.fixtureStates = lookDiff([...look.fixtureMap], before);
        cue.mode = "track";
    } else {
        cue.fixtureStates = [...look.fixtureMap].map(([id, st]) => [id, clone(st)]);
        cue.mode = "block";
    }
    cue.blocked = mode === "block";
    rememberLooks();
    renderCues();
    return true;
}

// Store the stage into cue `index` (new or existing), tracked or as a block.
// In "cue only" mode the cue after it keeps looking exactly as it did.
function storeLook(index, entry, block = false) {
    healLooks();
    const states = snapshotFixtureStates();
    const before = lookBefore(index);
    const cueOnly = window.LXPrefs?.get("trackMode") === "cueonly";
    let nextIndex = index + 1;
    while (nextIndex < State.cues.length && !State.cues[nextIndex]) nextIndex++;
    const nextCue = State.cues[nextIndex];
    const nextLook = cueOnly && isTracked(nextCue) ? cueLook(nextIndex) : null;
    if (!block && recordMode() === "track" && before) {
        entry.mode = "track";
        entry.fixtureStates = lookDiff(states, before);
    } else {
        entry.mode = "block";
        entry.fixtureStates = states;
    }
    State.cues[index] = entry;
    if (nextLook) {
        const now = cueLook(index);
        nextCue.fixtureStates = lookDiff([...nextLook.fixtureMap], now);
    }
    rememberLooks();
    return entry;
}

// Which cue last set this value in cue `index`'s look.
function cueSourceOf(index, id, key) {
    for (let i = index; i >= 0; i--) {
        const cue = State.cues[i];
        if (!cue) continue;
        const hit = (cue.fixtureStates || []).find(entry => Array.isArray(entry) && String(entry[0]) === String(id));
        if (hit && hit[1] && key in hit[1]) return i;
        if (!isTracked(cue)) return i;
    }
    return -1;
}

window.LXTracking = Object.freeze({
    look: index => cueLook(index),
    setMode: setCueMode,
    isTracked: index => isTracked(State.cues?.[index]),
    sourceOf: cueSourceOf,
    changes: index => (isTracked(State.cues?.[index]) ? (State.cues[index].fixtureStates || []).length : null),
    heal: healLooks,
    remember: rememberLooks
});

function applyLightingState(globalState, fixtureMap) {
    State.current ||= {};
    Object.assign(State.current, clone(globalState));
    fixtureMap.forEach((state, id) => State.fixtureStates.set(id, clone(state)));
    pushLightingUpdate();
}

/*
 * Cue timing, as on a professional desk. A cue can give each kind of change
 * its own time and delay:
 *
 *   up      intensity going up         down    intensity going down
 *   focus   pan/tilt (moves)           colour  colour of every kind
 *   beam    gobo, zoom, focus, iris, prism, frost…
 *
 * Anything a cue doesn't split uses its fade time and delay. The curve
 * shapes every part of the fade (smooth, linear, ease in/out, snap), and
 * the rate plays the whole cue faster or slower (200% = twice as fast).
 */
const TIME_PARTS = ["up", "down", "focus", "colour", "beam"];
const FOCUS_KEYS = new Set(["pan", "tilt", "panf", "tiltf", "panFine", "tiltFine"]);
const COLOUR_KEYS = new Set(["hue", "sat", "light", "r", "g", "b", "w", "amber", "a", "lime", "uv", "cyan", "magenta", "yellow", "colour", "colourr", "colourSlot", "colourSlotFor", "blueMix", "amberMix", "magentaMix", "colmacro", "cto", "cct", "warmWhite", "naturalWhite", "coolWhite", "preset"]);
const BEAM_KEYS = new Set(["gobo", "gobo2", "gobor", "gobo2r", "prism", "prismr", "focus", "zoom", "frost", "iris", "rot", "shake", "effect", "speed"]);
const INTENSITY_KEYS = new Set(["intensity", "master", "dimmer"]);
const CURVES = {
    smooth: p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    linear: p => p,
    in: p => p * p * p,
    out: p => 1 - Math.pow(1 - p, 3),
    snap: p => (p > 0 ? 1 : 0)
};
function partOf(key) {
    if (INTENSITY_KEYS.has(key)) return "intensity";
    if (FOCUS_KEYS.has(key)) return "focus";
    if (COLOUR_KEYS.has(key)) return "colour";
    if (BEAM_KEYS.has(key)) return "beam";
    return "fade";
}
// Times (ms) for each part of this cue. forceFade (MSC timed GO, sneak…)
// replaces every time.
function cueTiming(cue, forceFade = null) {
    const rate = Math.max(1, Math.min(1000, num(cue?.rate, 100))) / 100;
    const base = { time: Math.max(0, num(cue?.fade, 800)), delay: Math.max(0, num(cue?.delay, 0)) };
    const parts = { fade: base };
    const split = cue?.timing && typeof cue.timing === "object" ? cue.timing : {};
    TIME_PARTS.forEach(part => {
        const time = split[part], delay = split[part + "Delay"];
        parts[part] = {
            time: Number.isFinite(Number(time)) && time !== "" && time != null ? Math.max(0, Number(time)) : base.time,
            delay: Number.isFinite(Number(delay)) && delay !== "" && delay != null ? Math.max(0, Number(delay)) : base.delay
        };
    });
    if (forceFade != null) Object.values(parts).forEach(p => { p.time = Math.max(0, num(forceFade, 0)); p.delay = 0; });
    else Object.values(parts).forEach(p => { p.time /= rate; p.delay /= rate; });
    const curve = CURVES[cue?.curve] ? cue.curve : "smooth";
    const total = Math.max(...Object.values(parts).map(p => p.delay + p.time));
    return { parts, curve, total };
}
// How long cue `index` takes to complete (for progress bars).
function cueDuration(index, forceFade = null) {
    const cue = State.cues?.[index];
    return cue ? cueTiming(cue, forceFade).total : 0;
}

// Fade from one look to another. `timing` is a cueTiming() result, or a
// plain number of milliseconds for everything.
function fadeLighting(from, to, timing, finished) {
    stopCueFade();
    if (typeof timing !== "object" || !timing) timing = cueTiming({ fade: Math.max(0, num(timing, 0)), curve: "smooth" });
    const { parts, total } = timing;
    const ease = CURVES[timing.curve] || CURVES.smooth;
    if (total <= 0) {
        applyLightingState(to.globalState, to.fixtureMap);
        if (typeof finished === "function") finished();
        return;
    }
    const start = performance.now();
    const ids = new Set([...from.fixtureMap.keys(), ...to.fixtureMap.keys()]);
    // Where a value is in its own part of the fade: 0 before its delay, 1 once done.
    const progress = (part, elapsed) => {
        const w = parts[part] || parts.fade;
        if (elapsed < w.delay) return 0;
        return w.time <= 0 ? 1 : Math.min(1, (elapsed - w.delay) / w.time);
    };
    const blend = (key, a, b, elapsed) => {
        let part = partOf(key);
        if (part === "intensity") part = num(b) >= num(a) ? "up" : "down";
        const p = progress(part, elapsed);
        if (typeof a === "number" || typeof b === "number") return num(a) + (num(b) - num(a)) * ease(p);
        return p < 1 ? (a ?? b) : (b ?? a);
    };
    function frame(now) {
        const elapsed = now - start;
        const global = {};
        const globalKeys = new Set([
            ...Object.keys(from.globalState || {}),
            ...Object.keys(to.globalState || {})
        ]);
        globalKeys.forEach(key => {
            global[key] = blend(key, from.globalState && from.globalState[key], to.globalState && to.globalState[key], elapsed);
        });
        const fixtures = new Map();
        ids.forEach(id => {
            const a = from.fixtureMap.get(id) || {};
            const b = to.fixtureMap.get(id) || a;
            const result = {};
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            keys.forEach(key => { result[key] = blend(key, a[key], b[key], elapsed); });
            fixtures.set(id, result);
        });
        State.current ||= {};
        Object.assign(State.current, global);
        fixtures.forEach((state, id) => State.fixtureStates.set(id, state));
        pushLightingUpdate();
        if (elapsed >= total) {
            State.fading = null;
            applyLightingState(to.globalState, to.fixtureMap);
            if (typeof finished === "function") finished();
            return;
        }
        State.fading = trackFade(LXClock.frame(frame), finishNow);
    }
    const finishNow = () => {
        applyLightingState(to.globalState, to.fixtureMap);
        if (typeof finished === "function") finished();
    };
    State.fading = trackFade(LXClock.frame(frame), finishNow);
}

function renderCues() {
    normaliseCueNumbers();
    healLooks();
    const list = document.getElementById("cueList");
    if (!list) return;
    list.replaceChildren();
    State.cues.forEach((cue, index) => {
        if (!cue) return;
        const el = document.createElement("div");
        el.className = "cue-item" + (index === State.currentCue ? " active" : "");
        const title = String(cue.name || "Cue " + cueLabel(index));
        const fade = num(cue.fade, 800);
        let info = "(" + fade + "ms";
        if (cue.followEnabled === true) info += " · Follow " + num(cue.follow, 0) + "s";
        info += ")";
        const strong = document.createElement("strong");
        strong.textContent = cueLabel(index) + ". " + title;
        const small = document.createElement("small");
        small.textContent = info;
        el.appendChild(strong);
        el.appendChild(small);
        if (cue.effect && cue.effect.type) {
            const effect = document.createElement("small");
            effect.textContent = " ✦ " + (cue.effect.name || cue.effect.type);
            el.appendChild(effect);
        }
        el.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            goToCue(index);
        };
        list.appendChild(el);
    });
    if (typeof window.updateInspectorList === "function") window.updateInspectorList();
}

function syncCueControls(state) {
    if (!state) return;
    const fields = { master: ["master", "masterVal"], intensity: ["intensity", "intensityVal"] };
    Object.entries(fields).forEach(([key, ids]) => {
        const input = document.getElementById(ids[0]);
        const label = document.getElementById(ids[1]);
        const value = num(state[key], 100);
        if (input) input.value = value;
        if (label) label.textContent = Math.round(value);
    });
}

// Auto-go to the next cue: "complete" (a hang: N seconds after this cue
// finishes fading) or "go" (a follow: N seconds after this cue's GO).
function scheduleCueFollow(cue, cueIndex, when = "complete") {
    if (!cue || cue.followEnabled !== true) return;
    const mode = cue.followMode === "go" ? "go" : "complete";
    if (mode !== when) return;
    stopFollow();
    const seconds = Math.max(0, num(cue.follow, 0));
    cueLog("Follow armed: Cue " + cueLabel(cueIndex) + " -> next cue " + seconds + "s after its " + (mode === "go" ? "GO" : "fade finishes"));
    State.followTimer = setTimeout(() => {
        State.followTimer = null;
        if (State.currentCue !== cueIndex) return;
        cueLog("Follow firing: Cue " + cueLabel(cueIndex), "ok");
        goNextCue();
    }, seconds * 1000);
}

// The house curtain is part of a cue's look: recording stores whether it's
// open (1), closed (0) or part way, and playing the cue moves it there.
// A cue recorded before this (no curtain) leaves it alone; going straight
// to a cue uses the last curtain setting at or before it, like tracking.
function curtainNow() {
    const v = Number(State.visualizer?.settings?.curtain);
    return Number.isFinite(v) ? v : 1;
}
function cueCurtain(index) {
    for (let i = index; i >= 0; i--) {
        const c = State.cues?.[i];
        if (c && Number.isFinite(Number(c.curtain))) return Number(c.curtain);
    }
    return null;
}
function playCueCurtain(index, timing) {
    const want = cueCurtain(index);
    if (want == null || Math.abs(want - curtainNow()) < 0.005 || !window.LXVisualizer?.curtain) return;
    // It travels over the cue's fade (a snap cue still takes a moment), 4 s if none.
    const seconds = timing && timing.total > 0 ? timing.total / 1000 : 4;
    window.LXVisualizer.curtain(want, Math.max(0.3, seconds));
    cueLog("Curtain " + (want >= 1 ? "opens" : want <= 0 ? "closes" : "to " + Math.round(want * 100) + "% open") + " with Cue " + cueLabel(index), "info");
}

// A cue's command (its "macro"): any command line, run when the cue GOes.
let macroDepth = 0;
function runCueMacro(cue, index) {
    const text = String(cue?.macro || "").trim();
    if (!text || typeof window.parseCommand !== "function") return;
    if (macroDepth > 2) return cueLog("Cue " + cueLabel(index) + " command skipped: commands calling cues too deep", "warn");
    macroDepth++;
    try {
        text.split(/\s*;\s*|\n+/).filter(Boolean).forEach(line => window.parseCommand(line));
    } catch (e) {
        cueLog("Cue " + cueLabel(index) + " command failed: " + e.message, "error");
    } finally {
        macroDepth--;
    }
}

function goToCue(index, forceFade = null) {
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= State.cues.length || !State.cues[index]) {
        cueLog("That cue does not exist", "warn");
        return false;
    }
    stopCueTimers();
    const cue = State.cues[index];
    stopCueEffect();
    const previous = snapshotCurrentLighting();
    const target = getCueTarget(cue);
    State.currentCue = index;
    const timing = cueTiming(cue, forceFade);
    const fade = timing.total;
    State.cueStartedAt = performance.now();
    fadeLighting(previous, target, timing, () => {
        syncCueControls(target.globalState);
        startCueEffectIfNeeded(cue);
        renderCues();
        cueLog("Cue " + cueLabel(State.cues.indexOf(cue)) + " active", "ok");
        scheduleCueFollow(cue, State.cues.indexOf(cue), "complete");
        window.dispatchEvent(new CustomEvent("lx-cue-complete", { detail: { index } }));
    });
    scheduleCueFollow(cue, index, "go");
    syncCueControls(target.globalState);
    renderCues();
    cueLog("Cue " + cueLabel(index) + ": " + (cue.name || "Cue " + cueLabel(index)) + " - " + (fade <= 0 ? "instant" : "fade " + Math.round(fade) + "ms"));
    playCueCurtain(index, timing);
    runCueMacro(cue, index);
    return true;
}

// What GO plays after cue `index`: its link (a jump, e.g. back to 5 to
// loop a sequence, `loop` times then on), else the next cue that isn't
// disabled. Returns -1 at the end of the list.
const linkCounts = new Map(); // cue -> times its link has been taken
function cueAfter(index) {
    const cues = State.cues;
    const cue = cues[index];
    if (cue && cue.link != null && cue.link !== "") {
        const target = cueIndexOf(cue.link);
        const loops = Math.max(0, Math.floor(num(cue.loop, 0)));
        const taken = linkCounts.get(cue) || 0;
        if (target >= 0 && target !== index && (loops === 0 || taken < loops)) {
            linkCounts.set(cue, taken + 1);
            return target;
        }
        linkCounts.delete(cue); // done looping: carry on, and loop again next time round
    }
    let next = index + 1;
    while (next < cues.length && (!cues[next] || cues[next].disabled)) next++;
    return next < cues.length ? next : -1;
}

function goNextCue(forceFade = null) {
    if (!State.cues.length) {
        cueLog("No cues recorded", "warn");
        return false;
    }
    // Stop at the end of the list instead of jumping back to the first cue.
    const next = cueAfter(State.currentCue);
    if (next < 0) {
        cueLog("End of the cue list", "warn");
        return false;
    }
    return goToCue(next, forceFade);
}

function goPreviousCue(forceFade = null) {
    if (!State.cues.length) return false;
    stopFollow();
    let previous = State.currentCue - 1;
    while (previous >= 0 && (!State.cues[previous] || State.cues[previous].disabled)) previous--;
    if (previous < 0) {
        cueLog("Already at the first cue", "warn");
        return false;
    }
    return goToCue(previous, forceFade);
}

// What GO would play next, without playing it (for the cue list and inspector).
function peekNextCue() {
    const cues = State.cues || [];
    const index = State.currentCue;
    const cue = cues[index];
    if (cue && cue.link != null && cue.link !== "") {
        const target = cueIndexOf(cue.link);
        const loops = Math.max(0, Math.floor(num(cue.loop, 0)));
        if (target >= 0 && target !== index && (loops === 0 || (linkCounts.get(cue) || 0) < loops)) return target;
    }
    let next = index + 1;
    while (next < cues.length && (!cues[next] || cues[next].disabled)) next++;
    return next < cues.length ? next : -1;
}

// Everything about a cue that isn't its look (kept when it's re-recorded).
const CUE_OPTIONS = ["noMib", "blocked", "timecode", "delay", "timing", "curve", "rate", "followMode", "link", "loop", "disabled", "note", "scene", "colourTag", "macro"];
function recordCue(number, name, fadeMs, follow, followEnabled) {
    window.finishFade?.();
    number = parseCueNumber(number);
    if (number == null) {
        cueLog("Cue numbers are 0.001 or more, e.g. 5, 0.5 or 2.25", "warn");
        return false;
    }
    normaliseCueNumbers();
    let index = cueIndexOf(number);
    const existing = index >= 0 ? State.cues[index] : null;
    if (index < 0) index = insertCueSlot(number);
    const label = formatCueNumber(number);
    const globalState = clone(State.current || {});
    const effect = snapshotCueEffect();
    const cue = storeLook(index, {
        // Re-recording a cue keeps everything about it except its look.
        ...(existing ? Object.fromEntries(CUE_OPTIONS.filter(k => k in existing).map(k => [k, cloneValue(existing[k])])) : {}),
        number,
        name: String(name || "").trim() || "Cue " + label,
        globalState,
        state: clone(globalState),
        // Times not given: an existing cue keeps its own, a new one gets the default.
        fade: Math.max(0, num(fadeMs ?? existing?.fade ?? window.LXPrefs?.get("cueFadeMs") ?? 800, 800)),
        follow: Math.max(0, num(follow ?? existing?.follow, 0)),
        followEnabled: (followEnabled ?? existing?.followEnabled) === true,
        effect,
        effects: snapshotCueEffects(),
        curtain: curtainNow()
    }, existing ? existing.mode === "block" && existing.blocked === true : false);
    renderCues();
    if (typeof window.updateInspectorList === "function") window.updateInspectorList();
    let message = "Recorded Cue " + label + ": " + cue.name + (cue.mode === "track" ? " - tracked, " + cue.fixtureStates.length + " fixtures changed" : " - " + cue.fixtureStates.length + " fixtures saved");
    message += effect ? " - Effect: " + (effect.name || effect.type) : " - No effect";
    cueLog(message, "ok");
    return true;
}

/*
 * Clear the programmer: everything you've set by hand — command line,
 * control deck, palettes, magic sheet, point & shoot, effects and chases
 * you started — is dropped, and the lights fade back to what the live cue
 * says. Nothing live: they go dark. Captured targets stay captured.
 *
 * Preferences → Programming: "Clear goes to" (the live cue, or the old
 * everything-to-0) and how long the fade back takes.
 */
function clearProgrammer(options = {}) {
    // options.insert = { index, map: Map(id -> {key: value}) }: after
    // clearing, put that cue's programmed values into the programmer
    // (Cue Inspector → Insert into Control Deck).
    const insert = options && options.insert && options.insert.map instanceof Map ? options.insert : null;
    const mode = insert ? "cue" : window.LXPrefs?.get("clearMode") || "cue";
    const ms = Math.max(0, num(window.LXPrefs?.get("clearFadeMs"), 1000));
    const index = State.currentCue;
    const cue = mode === "cue" && index >= 0 ? State.cues[index] : null;
    if (!(State.fixtureStates instanceof Map)) State.fixtureStates = new Map();
    window.finishFade?.();
    stopCueTimers();
    // Effects and chases started by hand go; the live cue's own come back.
    if (typeof window.stopEffect === "function") window.stopEffect(true);
    if (!cue?.chase && State.currentChase >= 0 && typeof window.stopChase === "function") window.stopChase(false);

    let target;
    if (cue) {
        target = getCueTarget(cue);
        // Fixtures the cue doesn't mention (patched after it was recorded) go dark.
        (State.fixtures || []).forEach(f => {
            if (f && f.id != null && !target.fixtureMap.has(f.id)) target.fixtureMap.set(f.id, { ...clone(State.fixtureStates.get(f.id) || State.current || {}), intensity: 0 });
        });
    } else {
        const fixtureMap = new Map();
        State.fixtureStates.forEach((state, id) => fixtureMap.set(id, { ...clone(state), intensity: 0, master: 0 }));
        (State.fixtures || []).forEach(f => { if (f && f.id != null && !fixtureMap.has(f.id)) fixtureMap.set(f.id, { ...clone(State.current || {}), intensity: 0 }); });
        target = { globalState: { ...clone(State.current || {}), intensity: 0 }, fixtureMap };
    }

    if (insert) insert.map.forEach((part, id) => target.fixtureMap.set(id, { ...(target.fixtureMap.get(id) || clone(State.fixtureStates.get(id) || {})), ...clone(part) }));

    const ids = [...target.fixtureMap.keys()];
    const source = cue
        ? { kind: "cue", label: "Cue " + cueLabel(index) + " “" + (cue.name || "Cue " + cueLabel(index)) + "”", detail: "programmer cleared" }
        : { kind: "clear", label: "Clear", detail: "programmer cleared" };
    window.LXFixtureInfo?.act(source.kind, source.label, source.detail, ms + 500, ids);
    const keys = new Set();
    target.fixtureMap.forEach(state => Object.keys(state).forEach(k => keys.add(k)));
    window.LXFixtureInfo?.claimKeys(ids, [...keys], source);
    // The inserted values belong to the programmer; claimed again when the
    // fade lands, since the fade itself is credited to the cue.
    const claimInserted = () => {
        if (!insert) return;
        const from = State.cues[insert.index];
        const inserted = { kind: "insert", label: "Cue " + cueLabel(insert.index) + " “" + (from?.name || "Cue " + cueLabel(insert.index)) + "”", detail: "inserted into the Control Deck" };
        insert.map.forEach((part, id) => window.LXFixtureInfo?.claimKeys([id], Object.keys(part), inserted));
    };
    claimInserted();

    fadeLighting(snapshotCurrentLighting(), target, cue ? ms : 0, () => {
        claimInserted();
        setTimeout(claimInserted, 250); // after Fixture Info has seen the last frame
        if (cue) startCueEffectIfNeeded(cue);
        if (typeof window.syncControlsFromSelection === "function") window.syncControlsFromSelection();
    });
    if (typeof window.syncControlsFromSelection === "function") window.syncControlsFromSelection();
    if (insert) return true;
    cueLog(cue ? "Programmer cleared — back to Cue " + cueLabel(index) + (ms ? " over " + (ms / 1000) + "s" : "")
        : mode === "cue" ? "Programmer cleared — no cue is live, so everything is at 0" : "Programmer cleared — all fixtures set to 0", "ok");
    return true;
}
window.clearProgrammer = clearProgrammer;

/*
 * Re-record the current look into an existing cue without forcing
 * the operator to rebuild the cue metadata. This is the normal
 * "update cue" workflow: capture the programmer state, keep the
 * existing cue name/fade/follow settings, and replace the look.
 */
function updateCue(number, options = {}) {
    normaliseCueNumbers();
    const index = cueIndexOf(number);
    if (index < 0) {
        cueLog("Cue " + number + " does not exist", "warn");
        return false;
    }
    number = formatCueNumber(State.cues[index].number);

    const existing = State.cues[index];
    const name = Object.prototype.hasOwnProperty.call(options, "name")
        ? String(options.name || "").trim() || "Cue " + number
        : existing.name;
    const fade = Object.prototype.hasOwnProperty.call(options, "fade")
        ? Math.max(0, num(options.fade, existing.fade))
        : Math.max(0, num(existing.fade, 800));
    const follow = Object.prototype.hasOwnProperty.call(options, "follow")
        ? Math.max(0, num(options.follow, existing.follow))
        : Math.max(0, num(existing.follow, 0));
    const followEnabled = Object.prototype.hasOwnProperty.call(options, "followEnabled")
        ? options.followEnabled === true
        : existing.followEnabled === true;

    // Changing only the name, fade or follow keeps the cue's recorded look;
    // anything else (e.g. a plain "update cue N") re-records it from stage.
    const keys = Object.keys(options);
    const keepLook = keys.length > 0 && keys.every(key => ["name", "fade", "follow", "followEnabled"].includes(key));
    if (!keepLook) window.finishFade?.();
    const globalState = keepLook ? existing.globalState : clone(State.current || {});
    const effect = Object.prototype.hasOwnProperty.call(options, "effect")
        ? clone(options.effect)
        : keepLook ? existing.effect : snapshotCueEffect();

    const entry = {
        ...existing,
        name,
        globalState,
        state: keepLook ? existing.state : clone(globalState),
        curtain: keepLook ? existing.curtain : curtainNow(),
        fade,
        follow,
        followEnabled,
        effect: effect && effect.type ? effect : null,
        effects: Object.prototype.hasOwnProperty.call(options, "effect") ? (effect && effect.type ? [effect] : []) : keepLook ? existing.effects : snapshotCueEffects()
    };
    if (keepLook) State.cues[index] = entry;
    else storeLook(index, entry, existing.mode === "block" && existing.blocked === true);
    rememberLooks();

    renderCues();
    if (typeof window.updateInspectorList === "function") window.updateInspectorList();
    const saved = State.cues[index];
    cueLog("Updated Cue " + number + ": " + name + (keepLook ? "" : saved.mode === "track" ? " - tracked, " + saved.fixtureStates.length + " fixtures changed" : " - " + (saved.fixtureStates?.length || 0) + " fixtures saved"), "ok");
    return true;
}

function updateCurrentCue(options = {}) {
    if (State.currentCue < 0) {
        cueLog("No cue is currently selected", "warn");
        return false;
    }
    return updateCue(cueNumberOf(State.currentCue), options);
}

async function recordNextCue() {
    const suggested = nextCueNumber();
    const answer = await window.LXAsk("Record cue", [
        { key: "number", label: "Cue number (e.g. 5, or 2.5 to go between 2 and 3)", value: String(suggested) },
        { key: "name", label: "Name", value: "" }
    ], { ok: "Record" });
    if (!answer) return false;
    const number = parseCueNumber(answer.number);
    if (number == null) { cueLog("Cue numbers are 0.001 or more, e.g. 5, 0.5 or 2.25", "warn"); return false; }
    if (cueIndexOf(number) >= 0) {
        const replace = window.LXAsk ? await window.LXAsk("Replace cue " + formatCueNumber(number) + "?", [], { ok: "Replace", message: "Cue " + formatCueNumber(number) + " already exists. Recording replaces its look." }) : window.confirm("Replace cue " + number + "?");
        if (!replace) return false;
    }
    return recordCue(number, String(answer.name || "").trim() || "Cue " + formatCueNumber(number), Number(window.LXPrefs?.get("cueFadeMs") ?? 800), 0, false);
}

function deleteCue(number) {
    normaliseCueNumbers();
    const index = cueIndexOf(number);
    if (index < 0) {
        cueLog("Cue " + number + " not found", "warn");
        return false;
    }
    const label = cueLabel(index);
    stopCueTimers();
    stopCueEffect();
    const wasLive = State.currentCue === index;
    State.cues.splice(index, 1);
    reindexCues(i => (i === index ? (wasLive ? Math.min(index, State.cues.length - 1) : -1) : i > index ? i - 1 : i));
    if (!State.cues.length) State.currentCue = -1;
    renderCues();
    if (typeof window.renderChases === "function") window.renderChases();
    cueLog("Deleted Cue " + label, "ok");
    return true;
}

Object.assign(window, {
    parseCueNumber,
    formatCueNumber,
    CUE_CURVES: Object.keys(CURVES),
    cueNumberOf,
    cueLabel,
    cueIndexOf,
    nextCueNumber,
    cueNumberBetween,
    normaliseCueNumbers,
    insertCueSlot,
    getCueTarget,
    renderCues,
    syncCueControls,
    goToCue,
    goNextCue,
    goPreviousCue,
    recordCue,
    recordNextCue,
    cueTiming,
    cueDuration,
    peekNextCue,
    runCueMacro,
    cueCurtain,
    updateCue,
    updateCurrentCue,
    deleteCue,
    stopCueFade,
    stopFollow,
    stopCueTimers,
    applyLightingState,
    scheduleCueFollow,
    snapshotCueEffect,
    startCueEffectIfNeeded
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderCues, { once: true });
} else {
    renderCues();
}