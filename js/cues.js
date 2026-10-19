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

function stopCueEffect() {
    if (typeof window.stopEffect === "function") window.stopEffect(true);
}

function startCueEffectIfNeeded(cue) {
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

function fadeLighting(from, to, duration, finished) {
    stopCueFade();
    duration = Math.max(0, num(duration, 0));
    if (duration <= 0) {
        applyLightingState(to.globalState, to.fixtureMap);
        if (typeof finished === "function") finished();
        return;
    }
    const start = performance.now();
    const ids = new Set([...from.fixtureMap.keys(), ...to.fixtureMap.keys()]);
    function frame(now) {
        const raw = Math.min(1, (now - start) / duration);
        const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
        const global = {};
        const globalKeys = new Set([
            ...Object.keys(from.globalState || {}),
            ...Object.keys(to.globalState || {})
        ]);
        globalKeys.forEach(key => {
            const a = from.globalState && from.globalState[key];
            const b = to.globalState && to.globalState[key];
            if (typeof a === "number" || typeof b === "number") {
                global[key] = num(a) + (num(b) - num(a)) * t;
            } else {
                global[key] = raw < 1 ? (a ?? b) : (b ?? a);
            }
        });
        const fixtures = new Map();
        ids.forEach(id => {
            const a = from.fixtureMap.get(id) || {};
            const b = to.fixtureMap.get(id) || a;
            const result = {};
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            keys.forEach(key => {
                const av = a[key];
                const bv = b[key];
                if (typeof av === "number" || typeof bv === "number") {
                    result[key] = num(av) + (num(bv) - num(av)) * t;
                } else {
                    result[key] = raw < 1 ? (av ?? bv) : (bv ?? av);
                }
            });
            fixtures.set(id, result);
        });
        State.current ||= {};
        Object.assign(State.current, global);
        fixtures.forEach((state, id) => State.fixtureStates.set(id, state));
        pushLightingUpdate();
        if (raw >= 1) {
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
    healLooks();
    const list = document.getElementById("cueList");
    if (!list) return;
    list.replaceChildren();
    State.cues.forEach((cue, index) => {
        if (!cue) return;
        const el = document.createElement("div");
        el.className = "cue-item" + (index === State.currentCue ? " active" : "");
        const title = String(cue.name || "Cue " + (index + 1));
        const fade = num(cue.fade, 800);
        let info = "(" + fade + "ms";
        if (cue.followEnabled === true) info += " · Follow " + num(cue.follow, 0) + "s";
        info += ")";
        const strong = document.createElement("strong");
        strong.textContent = (index + 1) + ". " + title;
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

function scheduleCueFollow(cue, cueIndex) {
    stopFollow();
    if (!cue || cue.followEnabled !== true) return;
    const seconds = Math.max(0, num(cue.follow, 0));
    cueLog("Follow armed: Cue " + (cueIndex + 1) + " -> next cue in " + seconds + "s");
    State.followTimer = setTimeout(() => {
        State.followTimer = null;
        if (State.currentCue !== cueIndex) return;
        cueLog("Follow firing: Cue " + (cueIndex + 1), "ok");
        goNextCue();
    }, seconds * 1000);
}

function goToCue(index, forceFade = null) {
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= State.cues.length || !State.cues[index]) {
        cueLog("Cue " + (index + 1) + " does not exist", "warn");
        return false;
    }
    stopCueTimers();
    const cue = State.cues[index];
    stopCueEffect();
    const previous = snapshotCurrentLighting();
    const target = getCueTarget(cue);
    State.currentCue = index;
    const fade = forceFade !== null ? Math.max(0, num(forceFade, 0)) : Math.max(0, num(cue.fade, 800));
    fadeLighting(previous, target, fade, () => {
        syncCueControls(target.globalState);
        startCueEffectIfNeeded(cue);
        renderCues();
        cueLog("Cue " + (index + 1) + " active", "ok");
        scheduleCueFollow(cue, index);
        window.dispatchEvent(new CustomEvent("lx-cue-complete", { detail: { index } }));
    });
    syncCueControls(target.globalState);
    renderCues();
    cueLog("Cue " + (index + 1) + ": " + (cue.name || "Cue " + (index + 1)) + " - " + (fade <= 0 ? "instant" : "fade " + fade + "ms"));
    return true;
}

function goNextCue(forceFade = null) {
    if (!State.cues.length) {
        cueLog("No cues recorded", "warn");
        return false;
    }
    // Stop at the end of the list instead of jumping back to the first cue.
    let next = State.currentCue + 1;
    while (next < State.cues.length && !State.cues[next]) next++;
    if (!State.cues[next]) {
        cueLog("End of the cue list", "warn");
        return false;
    }
    return goToCue(next, forceFade);
}

function goPreviousCue(forceFade = null) {
    if (!State.cues.length) return false;
    stopFollow();
    let previous = State.currentCue - 1;
    while (previous >= 0 && !State.cues[previous]) previous--;
    if (previous < 0) {
        cueLog("Already at the first cue", "warn");
        return false;
    }
    return goToCue(previous, forceFade);
}

function recordCue(number, name, fadeMs = Number(window.LXPrefs?.get("cueFadeMs") ?? 800), follow = 0, followEnabled = false) {
    window.finishFade?.();
    number = Number(number);
    if (!Number.isInteger(number) || number < 1) {
        cueLog("Invalid cue number", "warn");
        return false;
    }
    const index = number - 1;
    while (State.cues.length <= index) State.cues.push(null);
    const globalState = clone(State.current || {});
    const effect = snapshotCueEffect();
    const existing = State.cues[index];
    const cue = storeLook(index, {
        ...(existing ? { noMib: existing.noMib, blocked: existing.blocked } : {}),
        name: String(name || "").trim() || "Cue " + number,
        globalState,
        state: clone(globalState),
        fade: Math.max(0, num(fadeMs, 800)),
        follow: Math.max(0, num(follow, 0)),
        followEnabled: followEnabled === true,
        effect
    }, existing ? existing.mode === "block" && existing.blocked === true : false);
    renderCues();
    if (typeof window.updateInspectorList === "function") window.updateInspectorList();
    let message = "Recorded Cue " + number + ": " + cue.name + (cue.mode === "track" ? " - tracked, " + cue.fixtureStates.length + " fixtures changed" : " - " + cue.fixtureStates.length + " fixtures saved");
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
function clearProgrammer() {
    const mode = window.LXPrefs?.get("clearMode") || "cue";
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

    const ids = [...target.fixtureMap.keys()];
    const source = cue
        ? { kind: "cue", label: "Cue " + (index + 1) + " “" + (cue.name || "Cue " + (index + 1)) + "”", detail: "programmer cleared" }
        : { kind: "manual", label: "Clear", detail: "programmer cleared" };
    window.LXFixtureInfo?.act(source.kind, source.label, source.detail, ms + 500, ids);
    const keys = new Set();
    target.fixtureMap.forEach(state => Object.keys(state).forEach(k => keys.add(k)));
    window.LXFixtureInfo?.claimKeys(ids, [...keys], source);

    fadeLighting(snapshotCurrentLighting(), target, cue ? ms : 0, () => {
        if (cue) startCueEffectIfNeeded(cue);
        if (typeof window.syncControlsFromSelection === "function") window.syncControlsFromSelection();
    });
    if (typeof window.syncControlsFromSelection === "function") window.syncControlsFromSelection();
    cueLog(cue ? "Programmer cleared — back to Cue " + (index + 1) + (ms ? " over " + (ms / 1000) + "s" : "")
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
    number = Number(number);
    if (!Number.isInteger(number) || number < 1 || !State.cues[number - 1]) {
        cueLog("Cue " + number + " does not exist", "warn");
        return false;
    }

    const existing = State.cues[number - 1];
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
        fade,
        follow,
        followEnabled,
        effect: effect && effect.type ? effect : null
    };
    if (keepLook) State.cues[number - 1] = entry;
    else storeLook(number - 1, entry, existing.mode === "block" && existing.blocked === true);
    rememberLooks();

    renderCues();
    if (typeof window.updateInspectorList === "function") window.updateInspectorList();
    const saved = State.cues[number - 1];
    cueLog("Updated Cue " + number + ": " + name + (keepLook ? "" : saved.mode === "track" ? " - tracked, " + saved.fixtureStates.length + " fixtures changed" : " - " + (saved.fixtureStates?.length || 0) + " fixtures saved"), "ok");
    return true;
}

function updateCurrentCue(options = {}) {
    if (State.currentCue < 0) {
        cueLog("No cue is currently selected", "warn");
        return false;
    }
    return updateCue(State.currentCue + 1, options);
}

async function recordNextCue() {
    const number = State.cues.length + 1;
    const answer = await window.LXAsk("Record cue " + number, [{ key: "name", label: "Name", value: "Cue " + number }], { ok: "Record" });
    if (!answer) return false;
    return recordCue(number, answer.name.trim() || "Cue " + number, Number(window.LXPrefs?.get("cueFadeMs") ?? 800), 0, false);
}

function deleteCue(number) {
    number = Number(number);
    if (!Number.isInteger(number) || number < 1) return false;
    const index = number - 1;
    if (!State.cues[index]) {
        cueLog("Cue " + number + " not found", "warn");
        return false;
    }
    stopCueTimers();
    stopCueEffect();
    State.cues.splice(index, 1);
    if (State.currentCue > index) State.currentCue--;
    else if (State.currentCue === index) State.currentCue = Math.min(State.currentCue, State.cues.length - 1);
    if (!State.cues.length) State.currentCue = -1;
    renderCues();
    if (typeof window.renderChases === "function") window.renderChases();
    cueLog("Deleted Cue " + number, "ok");
    return true;
}

Object.assign(window, {
    getCueTarget,
    renderCues,
    syncCueControls,
    goToCue,
    goNextCue,
    goPreviousCue,
    recordCue,
    recordNextCue,
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