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


/* ==========================================================
   HELPERS
========================================================== */

function cueLog(message, type = "info") {
    if (typeof window.log === "function") {
        window.log(message, type);
    } else {
        console.log("[CUES]", message);
    }
}


function clone(value) {
    if (!value || typeof value !== "object") {
        return {};
    }

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

    return Number.isFinite(n)
        ? n
        : fallback;
}


/* ==========================================================
   EFFECT SNAPSHOT
========================================================== */

function snapshotCueEffect() {

    const effect = State.activeEffect;

    if (!effect || !effect.type) {
        return null;
    }

    return {
        type: String(effect.type),
        speed: num(effect.speed, 1)
    };
}


function stopCueEffect() {

    if (typeof window.stopEffect === "function") {
        window.stopEffect(true);
    }
}


function startCueEffectIfNeeded(cue) {

    if (
        !cue ||
        !cue.effect ||
        !cue.effect.type
    ) {
        stopCueEffect();
        return;
    }

    if (typeof window.startEffect !== "function") {
        cueLog(
            "Cue contains an effect but the Effects Engine is unavailable",
            "warn"
        );

        return;
    }

    const effect = {
        type: cue.effect.type,
        speed: num(cue.effect.speed, 1)
    };

    const started =
        window.startEffect(
            effect.type,
            effect
        );

    if (!started) {
        cueLog(
            "Cue effect could not be started: " + effect.type,
            "warn"
        );
    }
}


/* ==========================================================
   TIMERS
========================================================== */

function stopCueFade() {

    if (State.fading !== null) {
        cancelAnimationFrame(
            State.fading
        );

        State.fading = null;
    }
}


function stopFollow() {

    if (State.followTimer !== null) {
        clearTimeout(
            State.followTimer
        );

        State.followTimer = null;
    }
}


function stopCueTimers() {
    stopCueFade();
    stopFollow();
}


/* ==========================================================
   OUTPUT
========================================================== */

function pushLightingUpdate() {

    try {
        if (typeof window.updateDMX === "function") {
            window.updateDMX();
        }
    } catch (error) {
        console.error(
            "updateDMX failed:",
            error
        );
    }

    try {
        if (
            typeof window.sendToVisualizer ===
            "function"
        ) {
            window.sendToVisualizer();
        }
    } catch (error) {
        console.error(
            "Visualizer update failed:",
            error
        );
    }
}


/* ==========================================================
   SNAPSHOTS
========================================================== */

function snapshotFixtureStates() {

    const result = [];

    State.fixtureStates.forEach(
        (state, id) => {
            result.push([
                id,
                clone(state)
            ]);
        }
    );

    return result;
}


function snapshotCurrentLighting() {

    const fixtureMap = new Map();

    State.fixtureStates.forEach(
        (state, id) => {
            fixtureMap.set(
                id,
                clone(state)
            );
        }
    );

    return {
        globalState:
            clone(State.current || {}),

        fixtureMap
    };
}


/* ==========================================================
   CUE TARGET
========================================================== */

function getCueTarget(cue) {

    const globalState =
        clone(
            cue &&
            (
                cue.globalState ||
                cue.state
            )
            || {}
        );

    const fixtureMap =
        new Map();

    if (
        Array.isArray(
            cue &&
            cue.fixtureStates
        )
    ) {

        cue.fixtureStates.forEach(
            entry => {

                if (
                    !Array.isArray(entry) ||
                    entry.length < 2
                ) {
                    return;
                }

                const id = entry[0];
                const state = entry[1];

                if (
                    id != null &&
                    state
                ) {
                    fixtureMap.set(
                        id,
                        clone(state)
                    );
                }
            }
        );
    }

    /*
     * Compatibility with old cues.
     */
    if (!fixtureMap.size) {

        (State.fixtures || []).forEach(
            fixture => {

                if (fixture && fixture.id != null) {

                    fixtureMap.set(
                        fixture.id,
                        clone(globalState)
                    );
                }
            }
        );
    }

    return {
        globalState,
        fixtureMap
    };
}


/* ==========================================================
   APPLY STATE
========================================================== */

function applyLightingState(
    globalState,
    fixtureMap
) {

    State.current ||= {};

    Object.assign(
        State.current,
        clone(globalState)
    );

    fixtureMap.forEach(
        (state, id) => {

            State.fixtureStates.set(
                id,
                clone(state)
            );
        }
    );

    pushLightingUpdate();
}


/* ==========================================================
   FADE
========================================================== */

function fadeLighting(
    from,
    to,
    duration,
    finished
) {

    stopCueFade();

    duration =
        Math.max(
            0,
            num(duration, 0)
        );

    if (duration <= 0) {

        applyLightingState(
            to.globalState,
            to.fixtureMap
        );

        if (typeof finished === "function") {
            finished();
        }

        return;
    }

    const start =
        performance.now();

    const ids =
        new Set([
            ...from.fixtureMap.keys(),
            ...to.fixtureMap.keys()
        ]);

    function frame(now) {

        const raw =
            Math.min(
                1,
                (now - start) / duration
            );

        const t =
            raw < 0.5
                ? 2 * raw * raw
                : 1 -
                  Math.pow(
                      -2 * raw + 2,
                      2
                  ) / 2;


        /* GLOBAL */

        const global = {};

        const globalKeys =
            new Set([
                ...Object.keys(
                    from.globalState || {}
                ),

                ...Object.keys(
                    to.globalState || {}
                )
            ]);

        globalKeys.forEach(
            key => {

                const a =
                    from.globalState &&
                    from.globalState[key];

                const b =
                    to.globalState &&
                    to.globalState[key];

                if (
                    typeof a === "number" ||
                    typeof b === "number"
                ) {

                    global[key] =
                        num(a) +
                        (
                            num(b) -
                            num(a)
                        ) * t;

                } else {

                    global[key] =
                        raw < 1
                            ? (a ?? b)
                            : (b ?? a);
                }
            }
        );


        /* FIXTURES */

        const fixtures =
            new Map();

        ids.forEach(
            id => {

                const a =
                    from.fixtureMap.get(id) ||
                    {};

                const b =
                    to.fixtureMap.get(id) ||
                    a;

                const result = {};

                const keys =
                    new Set([
                        ...Object.keys(a),
                        ...Object.keys(b)
                    ]);

                keys.forEach(
                    key => {

                        const av = a[key];
                        const bv = b[key];

                        if (
                            typeof av === "number" ||
                            typeof bv === "number"
                        ) {

                            result[key] =
                                num(av) +
                                (
                                    num(bv) -
                                    num(av)
                                ) * t;

                        } else {

                            result[key] =
                                raw < 1
                                    ? (av ?? bv)
                                    : (bv ?? av);
                        }
                    }
                );

                fixtures.set(
                    id,
                    result
                );
            }
        );


        State.current ||= {};

        Object.assign(
            State.current,
            global
        );

        fixtures.forEach(
            (state, id) => {

                State.fixtureStates.set(
                    id,
                    state
                );
            }
        );

        pushLightingUpdate();


        if (raw >= 1) {

            State.fading = null;

            applyLightingState(
                to.globalState,
                to.fixtureMap
            );

            if (typeof finished === "function") {
                finished();
            }

            return;
        }

        State.fading =
            requestAnimationFrame(
                frame
            );
    }

    State.fading =
        requestAnimationFrame(
            frame
        );
}


/* ==========================================================
   RENDER CUES
========================================================== */

function renderCues() {

    const list =
        document.getElementById(
            "cueList"
        );

    if (!list) {
        return;
    }

    list.replaceChildren();

    State.cues.forEach(
        (cue, index) => {

            if (!cue) {
                return;
            }

            const el =
                document.createElement(
                    "div"
                );

            el.className =
                "cue-item" +
                (
                    index === State.currentCue
                        ? " active"
                        : ""
                );

            const title =
                String(
                    cue.name ||
                    "Cue " + (index + 1)
                );

            const fade =
                num(
                    cue.fade,
                    800
                );

            let info =
                "(" + fade + "ms";

            if (
                cue.followEnabled === true
            ) {

                info +=
                    " · Follow " +
                    num(cue.follow, 0) +
                    "s";
            }

            info += ")";

            const strong =
                document.createElement(
                    "strong"
                );

            strong.textContent =
                (index + 1) +
                ". " +
                title;

            const small =
                document.createElement(
                    "small"
                );

            small.textContent =
                info;

            el.appendChild(strong);
            el.appendChild(small);

            /*
             * Show a small effect indicator.
             */
            if (
                cue.effect &&
                cue.effect.type
            ) {

                const effect =
                    document.createElement(
                        "small"
                    );

                effect.textContent =
                    " ✦ " +
                    cue.effect.type;

                el.appendChild(effect);
            }

            el.onclick =
                function(event) {

                    event.preventDefault();
                    event.stopPropagation();

                    goToCue(index);
                };

            list.appendChild(el);
        }
    );

    if (
        typeof window.updateInspectorList ===
        "function"
    ) {
        window.updateInspectorList();
    }
}


/* ==========================================================
   CONTROL SYNC
========================================================== */

function syncCueControls(state) {

    if (!state) {
        return;
    }

    const fields = {
        master: [
            "master",
            "masterVal"
        ],

        intensity: [
            "intensity",
            "intensityVal"
        ]
    };

    Object.entries(fields).forEach(
        entry => {

            const key =
                entry[0];

            const inputId =
                entry[1][0];

            const labelId =
                entry[1][1];

            const input =
                document.getElementById(
                    inputId
                );

            const label =
                document.getElementById(
                    labelId
                );

            const value =
                num(
                    state[key],
                    100
                );

            if (input) {
                input.value = value;
            }

            if (label) {
                label.textContent =
                    Math.round(value);
            }
        }
    );
}


/* ==========================================================
   FOLLOW
========================================================== */

function scheduleCueFollow(
    cue,
    cueIndex
) {

    stopFollow();

    if (!cue) {
        return;
    }

    if (
        cue.followEnabled !== true
    ) {
        return;
    }

    const seconds =
        Math.max(
            0,
            num(cue.follow, 0)
        );

    cueLog(
        "Follow armed: Cue " +
        (cueIndex + 1) +
        " -> next cue in " +
        seconds +
        "s"
    );

    State.followTimer =
        setTimeout(
            function() {

                State.followTimer =
                    null;

                if (
                    State.currentCue !==
                    cueIndex
                ) {
                    return;
                }

                cueLog(
                    "Follow firing: Cue " +
                    (cueIndex + 1),
                    "ok"
                );

                goNextCue();

            },
            seconds * 1000
        );
}


/* ==========================================================
   GO TO CUE
========================================================== */

function goToCue(
    index,
    forceFade = null
) {

    index = Number(index);

    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= State.cues.length ||
        !State.cues[index]
    ) {

        cueLog(
            "Cue " +
            (index + 1) +
            " does not exist",
            "warn"
        );

        return false;
    }

    stopCueTimers();

    /*
     * Save the cue before stopping the old effect.
     */
    const cue =
        State.cues[index];

    /*
     * Stop whatever effect was running
     * from the previous cue.
     */
    stopCueEffect();

    const previous =
        snapshotCurrentLighting();

    const target =
        getCueTarget(cue);

    State.currentCue =
        index;

    const fade =
        forceFade !== null
            ? Math.max(
                0,
                num(forceFade, 0)
            )
            : Math.max(
                0,
                num(cue.fade, 800)
            );


    fadeLighting(
        previous,
        target,
        fade,
        function() {

            syncCueControls(
                target.globalState
            );

            /*
             * IMPORTANT:
             * Start the cue's stored effect only
             * after the cue lighting has finished fading.
             */
            startCueEffectIfNeeded(
                cue
            );

            renderCues();

            cueLog(
                "Cue " +
                (index + 1) +
                " active",
                "ok"
            );

            scheduleCueFollow(
                cue,
                index
            );
        }
    );


    syncCueControls(
        target.globalState
    );

    renderCues();

    cueLog(
        "Cue " +
        (index + 1) +
        ": " +
        (
            cue.name ||
            "Cue " + (index + 1)
        ) +
        " - " +
        (
            fade <= 0
                ? "instant"
                : "fade " + fade + "ms"
        )
    );

    return true;
}


/* ==========================================================
   NEXT CUE
========================================================== */

function goNextCue(
    forceFade = null
) {

    if (!State.cues.length) {

        cueLog(
            "No cues recorded",
            "warn"
        );

        return false;
    }

    let next =
        State.currentCue + 1;

    let attempts = 0;

    while (
        attempts < State.cues.length &&
        !State.cues[next]
    ) {

        next++;

        if (
            next >= State.cues.length
        ) {
            next = 0;
        }

        attempts++;
    }

    if (!State.cues[next]) {
        return false;
    }

    return goToCue(
        next,
        forceFade
    );
}


/* ==========================================================
   PREVIOUS CUE
========================================================== */

function goPreviousCue(
    forceFade = null
) {

    if (!State.cues.length) {
        return false;
    }

    stopFollow();

    let previous =
        State.currentCue - 1;

    if (previous < 0) {
        previous =
            State.cues.length - 1;
    }

    let attempts = 0;

    while (
        attempts < State.cues.length &&
        !State.cues[previous]
    ) {

        previous--;

        if (previous < 0) {
            previous =
                State.cues.length - 1;
        }

        attempts++;
    }

    if (!State.cues[previous]) {
        return false;
    }

    return goToCue(
        previous,
        forceFade
    );
}


/* ==========================================================
   RECORD CUE
========================================================== */

function recordCue(
    number,
    name,
    fadeMs = 800,
    follow = 0,
    followEnabled = false
) {

    number = Number(number);

    if (
        !Number.isInteger(number) ||
        number < 1
    ) {

        cueLog(
            "Invalid cue number",
            "warn"
        );

        return false;
    }

    const index =
        number - 1;

    while (
        State.cues.length <= index
    ) {
        State.cues.push(null);
    }


    /*
     * Capture lighting.
     */
    const globalState =
        clone(
            State.current || {}
        );

    const fixtureStates =
        snapshotFixtureStates();


    /*
     * Capture currently running effect.
     *
     * This is the important part.
     */
    const effect =
        snapshotCueEffect();


    State.cues[index] = {

        name:
            String(name || "").trim() ||
            "Cue " + number,

        globalState:

            globalState,

        state:
            clone(globalState),

        fixtureStates:
            fixtureStates,

        fade:
            Math.max(
                0,
                num(fadeMs, 800)
            ),

        follow:
            Math.max(
                0,
                num(follow, 0)
            ),

        followEnabled:
            followEnabled === true,

        effect:
            effect
    };


    renderCues();

    if (
        typeof window.updateInspectorList ===
        "function"
    ) {
        window.updateInspectorList();
    }


    let message =
        "Recorded Cue " +
        number +
        ": " +
        State.cues[index].name +
        " - " +
        fixtureStates.length +
        " fixtures saved";


    if (effect) {
        message +=
            " - Effect: " +
            effect.type;
    } else {
        message +=
            " - No effect";
    }


    cueLog(
        message,
        "ok"
    );

    return true;
}


/* ==========================================================
   RECORD NEXT CUE
========================================================== */

function recordNextCue() {

    const number =
        State.cues.length + 1;

    const name =
        prompt(
            "Cue name:",
            "Cue " + number
        );

    if (name === null) {
        return false;
    }

    return recordCue(
        number,
        name,
        800,
        0,
        false
    );
}


/* ==========================================================
   DELETE
========================================================== */

function deleteCue(number) {

    number = Number(number);

    if (
        !Number.isInteger(number) ||
        number < 1
    ) {
        return false;
    }

    const index =
        number - 1;

    if (!State.cues[index]) {

        cueLog(
            "Cue " +
            number +
            " not found",
            "warn"
        );

        return false;
    }

    stopCueTimers();
    stopCueEffect();

    State.cues.splice(
        index,
        1
    );


    if (
        State.currentCue > index
    ) {

        State.currentCue--;

    } else if (
        State.currentCue === index
    ) {

        State.currentCue =
            Math.min(
                State.currentCue,
                State.cues.length - 1
            );
    }


    if (!State.cues.length) {
        State.currentCue = -1;
    }


    renderCues();

    if (
        typeof window.renderChases ===
        "function"
    ) {
        window.renderChases();
    }


    cueLog(
        "Deleted Cue " + number,
        "ok"
    );

    return true;
}


/* ==========================================================
   EXPORTS
========================================================== */

Object.assign(
    window,
    {
        renderCues,
        syncCueControls,
        goToCue,
        goNextCue,
        goPreviousCue,
        recordCue,
        recordNextCue,
        deleteCue,
        stopCueFade,
        stopFollow,
        stopCueTimers,
        applyLightingState,
        scheduleCueFollow,
        snapshotCueEffect,
        startCueEffectIfNeeded
    }
);


/* ==========================================================
   START
========================================================== */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        renderCues,
        {
            once: true
        }
    );

} else 

    renderCues();