"use strict";

/*
 * LTC (SMPTE linear timecode) from an audio signal.
 *
 * LTC is 80 bits a frame in "biphase mark" code: the signal flips at the
 * start of every bit, and flips again half-way through a 1. So the gaps
 * between zero crossings are either a whole bit (a 0) or two half bits
 * (a 1). Every frame ends with a fixed sync word, which is how we find
 * where frames start; the time is in BCD in the bits before it.
 *
 *   const d = new LTCDecoder(sampleRate, frame => …);   d.push(float32Samples)
 *   frame = { h, m, s, f, dropFrame, reverse }
 *
 * LTCEncoder makes test signals (tests/, and handy for checking a setup).
 * Works in the page (window.LTCDecoder) and in Node (module.exports).
 */
(function (root) {
  // Bits 64–79, in the order they're sent.
  const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
  const SYNC_REVERSED = SYNC.slice().reverse();

  class LTCDecoder {
    constructor(sampleRate, onFrame) {
      this.rate = sampleRate;
      this.onFrame = onFrame || (() => {});
      this.level = 0;          // which side of zero the signal is on (+1 / -1)
      this.sinceFlip = 0;      // samples since the last zero crossing
      this.period = 0;         // samples per bit (learnt from the signal)
      this.half = false;       // half of a 1 seen, waiting for the other half
      this.bits = [];          // the last 80 bits
      this.peak = 0.02;        // follows the signal's loudness
      this.frames = 0;
    }

    push(samples) {
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        const a = v < 0 ? -v : v;
        this.peak = a > this.peak ? a : this.peak * 0.9995 + 0.00001;
        // A little hysteresis so noise around zero doesn't count as a flip.
        const threshold = this.peak * 0.15;
        this.sinceFlip++;
        const side = v > threshold ? 1 : v < -threshold ? -1 : 0;
        if (side && side !== this.level) {
          if (this.level) this.interval(this.sinceFlip);
          this.level = side;
          this.sinceFlip = 0;
        }
      }
    }

    interval(n) {
      // Learn the bit length: start from the longest gap seen, then follow it.
      if (!this.period) { this.period = n; return; }
      if (n > this.period * 1.6) { this.period = n; this.half = false; this.bits.length = 0; return; }
      const long = n > this.period * 0.75;
      if (long) {
        this.period = this.period * 0.9 + n * 0.1;
        if (this.half) { this.half = false; } // a lone half: we were out of step
        this.bit(0);
      } else {
        this.period = this.period * 0.9 + n * 2 * 0.1;
        if (this.half) { this.half = false; this.bit(1); } else this.half = true;
      }
    }

    bit(b) {
      const bits = this.bits;
      bits.push(b);
      if (bits.length > 80) bits.shift();
      if (bits.length < 80) return;
      if (matches(bits, 64, SYNC)) this.frame(bits, false);
      else if (matches(bits, 0, SYNC_REVERSED)) this.frame(bits.slice().reverse(), true);
    }

    frame(bits, reverse) {
      // Reversed: the sync word came first, so the frame is the 80 bits read backwards.
      const b = reverse ? [...bits.slice(16), ...bits.slice(0, 16)] : bits;
      const n = (start, count) => { let v = 0; for (let i = 0; i < count; i++) v |= b[start + i] << i; return v; };
      const f = n(0, 4) + 10 * n(8, 2);
      const s = n(16, 4) + 10 * n(24, 3);
      const m = n(32, 4) + 10 * n(40, 3);
      const h = n(48, 4) + 10 * n(56, 2);
      if (f > 29 || s > 59 || m > 59 || h > 23) return;
      this.frames++;
      this.onFrame({ h, m, s, f, dropFrame: Boolean(b[10]), reverse });
    }
  }

  function matches(bits, at, word) {
    for (let i = 0; i < 16; i++) if (bits[at + i] !== word[i]) return false;
    return true;
  }

  // Make LTC audio: frames from (h, m, s, f) onward at `fps`.
  class LTCEncoder {
    constructor(sampleRate, fps = 25, amplitude = 0.5) {
      this.rate = sampleRate; this.fps = fps; this.amp = amplitude; this.level = 1; this.phase = 0;
    }
    frameBits({ h, m, s, f }) {
      const bits = new Array(80).fill(0);
      const put = (value, start, count) => { for (let i = 0; i < count; i++) bits[start + i] = (value >> i) & 1; };
      put(f % 10, 0, 4); put(Math.floor(f / 10), 8, 2);
      put(s % 10, 16, 4); put(Math.floor(s / 10), 24, 3);
      put(m % 10, 32, 4); put(Math.floor(m / 10), 40, 3);
      put(h % 10, 48, 4); put(Math.floor(h / 10), 56, 2);
      SYNC.forEach((v, i) => { bits[64 + i] = v; });
      // Bit 27 (25 fps: bit 59) keeps the number of 0s even; decoders don't need it.
      return bits;
    }
    // Samples for a run of frames starting at `start`.
    render(start, count) {
      const perBit = this.rate / (this.fps * 80);
      const out = [];
      let { h, m, s, f } = start;
      for (let k = 0; k < count; k++) {
        for (const bit of this.frameBits({ h, m, s, f })) {
          // Flip at the start of each bit; a 1 flips again half-way.
          this.level = -this.level;
          const total = this.phase + perBit;
          const n = Math.floor(total);
          this.phase = total - n;
          for (let i = 0; i < n; i++) {
            if (bit && i === Math.floor(n / 2)) this.level = -this.level;
            out.push(this.level * this.amp);
          }
        }
        f++; if (f >= Math.round(this.fps)) { f = 0; s++; if (s >= 60) { s = 0; m++; if (m >= 60) { m = 0; h = (h + 1) % 24; } } }
      }
      return Float32Array.from(out);
    }
  }

  root.LTCDecoder = LTCDecoder;
  root.LTCEncoder = LTCEncoder;
  if (typeof module === "object" && module.exports) module.exports = { LTCDecoder, LTCEncoder };
})(typeof window !== "undefined" ? window : globalThis);
