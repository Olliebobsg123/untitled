// Run with: npm test
import assert from "node:assert/strict";
import { archetype, baseAddress, decodeFixture, decodeFraming, reader, wheelColour } from "../js/visualizer/decode.js";

const frame = (values, length = 5120) => { const f = new Uint8Array(length); for (const [i, v] of Object.entries(values)) f[i] = v; return f; };
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// Universes sit end to end in the console's buffer.
assert.equal(baseAddress({ uni: 1, addr: 1 }), 0);
assert.equal(baseAddress({ uni: 2, addr: 10 }), 521);
assert.equal(baseAddress({ uni: 1, addr: null }), -1); // Tapo / not on DMX

// RGB par with no dimmer: the colour carries the level.
const rgbPar = { type: "rgb", map: { r: 0, g: 1, b: 2 } };
let s = decodeFixture(rgbPar, frame({ 512: 0, 513: 0, 514: 128 }), 512);
near(s.intensity, 0.5); assert.deepEqual(s.rgb, [0, 0, 1]);

// Dimmer + RGBW: white emitter adds warm white.
const rgbw = { type: "rgbw", map: { dimmer: 0, r: 1, g: 2, b: 3, w: 4 } };
s = decodeFixture(rgbw, frame({ 0: 255, 4: 255 }), 0);
near(s.intensity, 1); near(s.rgb[0], 1); near(s.rgb[2], 0.88);

// Colour wheel.
const wheel = [{ min: 0, max: 25, rgb: [1, 1, 1] }, { min: 26, max: 50, rgb: [1, 0, 0] }];
assert.deepEqual(wheelColour({ colourWheel: wheel }, 30), [1, 0, 0]);

// Strobe: open below 11, flashing above.
const strobe = { type: "rgb", map: { r: 0, g: 1, b: 2, strobe: 3 } };
assert.equal(decodeFixture(strobe, frame({ 0: 255, 3: 5 }), 0).strobeRate, 0);
assert.ok(decodeFixture(strobe, frame({ 0: 255, 3: 200 }), 0).strobeRate > 15);

// Moving head: 50% pan/tilt is centre; 16-bit fine channels.
const mover = { type: "moving", map: { dimmer: 0, pan: 1, panf: 2, tilt: 3, tiltf: 4, gobo: 5 } };
s = decodeFixture(mover, frame({ 0: 255, 1: 128, 2: 0, 3: 128, 4: 0, 5: 40 }), 0);
near(s.pan, 0, 0.02); near(s.tilt, 0, 0.02); assert.equal(s.gobo, 3);
s = decodeFixture(mover, frame({ 1: 255, 2: 255 }), 0);
near(s.pan, (540 / 2) * Math.PI / 180, 0.01);

// Zoom between the fixture's angles.
const zoomer = { type: "wash", map: { dimmer: 0, zoom: 1 }, photometrics: { beamAngleMin: 10, beamAngleMax: 40 } };
near(decodeFixture(zoomer, frame({ 1: 255 }), 0).beamAngle, 40, 0.1);
near(decodeFixture(zoomer, frame({ 1: 0 }), 0).beamAngle, 10, 0.1);

// Tungsten fresnel glows warm.
s = decodeFixture({ type: "tungsten", map: { dimmer: 0 } }, frame({ 0: 255 }), 0);
assert.ok(s.rgb[2] < s.rgb[0] * 0.75);

// Barn doors (manual, 0-100) and DMX framing shutters.
const framing = decodeFraming(reader(frame({}), 0, {}), { b1: 50, b2: 0, b3: 0, b4: 25, rotate: 90 });
assert.deepEqual(framing.blades, [0.5, 0, 0, 0.25]); near(framing.rotation, Math.PI / 2, 1e-6); assert.ok(framing.active);

// What each fixture is.
assert.equal(archetype({ type: "dimmer", map: { speed: 0 }, photometrics: { sourceType: "MIRROR_BALL_MOTOR" } }, "Mirror Ball Motor (1ch)"), "mirrorBall");
assert.equal(archetype({ type: "dimmer", map: { fog: 0 } }, "Fog 1500"), "fogger");
assert.equal(archetype({ type: "dimmer", map: { haze: 0 } }, "Haze 1500"), "hazer");
assert.equal(archetype(mover, "Spot"), "movingSpot");
assert.equal(archetype({ type: "tungsten", map: { dimmer: 0 } }, "Fresnel"), "fresnel");
assert.equal(archetype(rgbPar, "Par"), "par");

// Fog output and mirror-ball motor speed.
near(decodeFixture({ type: "dimmer", map: { fog: 0 } }, frame({ 0: 255 }), 0).fog, 1);
near(decodeFixture({ type: "dimmer", map: { speed: 0 } }, frame({ 0: 128 }), 0).speed, 0.5);

console.log("visualiser decode tests passed");
