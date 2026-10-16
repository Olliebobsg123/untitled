// The visualiser's DMX decoding: colour, level, strobe and position for each kind of fixture.
import { decodeFixture } from "../js/visualizer/decode.js";
import assert from "node:assert/strict";
const frame = new Uint8Array(512);
const near = (a, b, d = 0.02) => Math.abs(a - b) <= d;
// RGB par, no dimmer: red at full
const par = { type: "rgb", map: { r: 0, g: 1, b: 2 }, photometrics: { beamAngle: 25 } };
frame.set([255, 0, 0], 0);
let d = decodeFixture(par, frame, 0);
assert.deepEqual(d.rgb, [1, 0, 0]); assert.equal(d.intensity, 1); assert.equal(d.pan, null);
// half red: intensity 0.5, colour still pure red
frame.set([128, 0, 0], 0);
d = decodeFixture(par, frame, 0); assert.ok(near(d.intensity, 0.5)); assert.deepEqual(d.rgb, [1, 0, 0]);
// all off: dark
frame.set([0, 0, 0], 0); d = decodeFixture(par, frame, 0); assert.equal(d.intensity, 0);
// RGBW with dimmer
const rgbw = { type: "moving", map: { pan: 0, panf: 1, tilt: 2, tiltf: 3, dimmer: 4, strobe: 5, r: 6, g: 7, b: 8, w: 9 }, photometrics: { beamAngle: 20 } };
frame.fill(0); frame.set([128, 0, 128, 0, 255, 0, 0, 255, 0, 0], 10);
d = decodeFixture(rgbw, frame, 10);
assert.deepEqual(d.rgb, [0, 1, 0]); assert.equal(d.intensity, 1); assert.ok(near(d.pan, 0, 0.01)); assert.equal(d.strobeRate, 0);
frame[15] = 200; d = decodeFixture(rgbw, frame, 10); assert.ok(d.strobeRate > 10);
// colour wheel
const wheel = { type: "moving", map: { dimmer: 0, colour: 1 }, colourWheel: [{ min: 0, max: 9, rgb: [1, 1, 1] }, { min: 10, max: 19, rgb: [0, 0, 1] }] };
frame.fill(0); frame.set([255, 15], 0); d = decodeFixture(wheel, frame, 0); assert.deepEqual(d.rgb, [0, 0, 1]);
// CMY (Robe-like)
const cmy = { map: { cyan: 0, magenta: 1, yellow: 2, dimmer: 3 }, photometrics: { manufacturer: "ROBE", beamAngleMin: 13, beamAngleMax: 44 } };
frame.fill(0); frame.set([0, 255, 255, 255], 0); d = decodeFixture(cmy, frame, 0); assert.deepEqual(d.rgb, [1, 0, 0]);
// tungsten dimmer: warm
const tung = { map: { dimmer: 0 }, photometrics: { sourceType: "TUNGSTEN" } };
frame.fill(0); frame[0] = 255; d = decodeFixture(tung, frame, 0, "Fresnel Tungsten");
assert.ok(d.rgb[0] === 1 && d.rgb[2] < 0.6, JSON.stringify(d.rgb));
console.log("decode tests passed");
