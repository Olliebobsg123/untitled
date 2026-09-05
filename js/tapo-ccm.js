"use strict";

/*
 * Electron's crypto build does not expose the AES-CCM cipher that newer Tapo
 * TPAP firmware requires. This adapter implements the small CCM surface used
 * by iobroker.tapo while leaving all other crypto algorithms untouched.
 *
 * TPAP uses a 12-byte nonce, no AAD, and a 16-byte authentication tag.
 */
(function installTapoCcmFallback() {
  const crypto = require("crypto");
  const originalCreateCipheriv = crypto.createCipheriv.bind(crypto);
  const originalCreateDecipheriv = crypto.createDecipheriv.bind(crypto);

  const isCcm = algorithm => /^(aes-128|aes-256)-ccm$/i.test(String(algorithm));

  const aesBlock = (key, block) => {
    const algorithm = key.length === 16 ? "aes-128-ecb" : "aes-256-ecb";
    const cipher = originalCreateCipheriv(algorithm, key, null);
    cipher.setAutoPadding(false);
    return cipher.update(block);
  };

  const xorInto = (target, source) => {
    for (let i = 0; i < target.length; i++) target[i] ^= source[i];
  };

  const counterBlock = (nonce, counter) => {
    if (nonce.length !== 12) throw new Error(`TPAP AES-CCM requires a 12-byte nonce, got ${nonce.length}`);
    const block = Buffer.alloc(16);
    block[0] = 0x02; // L - 1; 12-byte nonce => L=3.
    nonce.copy(block, 1);
    block.writeUIntBE(counter, 13, 3);
    return block;
  };

  const cbcMac = (key, plaintext, nonce, tagLength) => {
    const L = 3;
    const b0 = Buffer.alloc(16, 0);
    b0[0] = (((tagLength - 2) / 2) << 3) | (L - 1);
    nonce.copy(b0, 1);
    b0.writeUIntBE(plaintext.length, 13, L);

    let state = aesBlock(key, b0);
    const paddedLength = Math.ceil(plaintext.length / 16) * 16;
    if (!paddedLength) return state.subarray(0, tagLength);

    const padded = Buffer.alloc(paddedLength, 0);
    plaintext.copy(padded);
    for (let offset = 0; offset < padded.length; offset += 16) {
      const mixed = Buffer.from(state);
      xorInto(mixed, padded.subarray(offset, offset + 16));
      state = aesBlock(key, mixed);
    }
    return state.subarray(0, tagLength);
  };

  const encryptCcm = (key, nonce, plaintext, tagLength) => {
    if (![16, 32].includes(key.length)) throw new Error("TPAP AES-CCM requires a 128- or 256-bit key");
    if (![4, 6, 8, 10, 12, 14, 16].includes(tagLength)) throw new Error("Unsupported AES-CCM tag length");
    if (plaintext.length > 0xFFFFFF) throw new Error("TPAP AES-CCM payload is too large");

    const mac = cbcMac(key, plaintext, nonce, tagLength);
    const s0 = aesBlock(key, counterBlock(nonce, 0));
    const tag = Buffer.from(mac);
    xorInto(tag, s0.subarray(0, tagLength));

    const ciphertext = Buffer.alloc(plaintext.length);
    let offset = 0;
    let counter = 1;
    while (offset < plaintext.length) {
      const stream = aesBlock(key, counterBlock(nonce, counter++));
      const length = Math.min(16, plaintext.length - offset);
      for (let i = 0; i < length; i++) ciphertext[offset + i] = plaintext[offset + i] ^ stream[i];
      offset += length;
    }
    return { ciphertext, tag };
  };

  const decryptCcm = (key, nonce, ciphertext, tag, tagLength) => {
    if (tag.length !== tagLength) throw new Error("TPAP AES-CCM authentication tag length mismatch");

    const plaintext = Buffer.alloc(ciphertext.length);
    let offset = 0;
    let counter = 1;
    while (offset < ciphertext.length) {
      const stream = aesBlock(key, counterBlock(nonce, counter++));
      const length = Math.min(16, ciphertext.length - offset);
      for (let i = 0; i < length; i++) plaintext[offset + i] = ciphertext[offset + i] ^ stream[i];
      offset += length;
    }

    const mac = cbcMac(key, plaintext, nonce, tagLength);
    const s0 = aesBlock(key, counterBlock(nonce, 0));
    const expected = Buffer.from(mac);
    xorInto(expected, s0.subarray(0, tagLength));
    if (!crypto.timingSafeEqual(expected, tag)) throw new Error("TPAP AES-CCM authentication failed");
    return plaintext;
  };

  class TapoCcmCipher {
    constructor(key, nonce, tagLength, mode) {
      this.key = Buffer.from(key);
      this.nonce = Buffer.from(nonce);
      this.tagLength = tagLength;
      this.mode = mode;
      this.input = Buffer.alloc(0);
      this.tag = null;
      this.result = null;
    }

    setAAD(adata) {
      if (Buffer.from(adata || []).length) throw new Error("TPAP AES-CCM fallback does not support AAD");
    }

    update(data) {
      this.input = Buffer.concat([this.input, Buffer.from(data || [])]);
      if (this.mode === "decrypt") return Buffer.alloc(0);
      if (this.result === null) {
        const result = encryptCcm(this.key, this.nonce, this.input, this.tagLength);
        this.result = result.ciphertext;
        this.tag = result.tag;
      }
      return this.result;
    }

    final() {
      if (this.mode === "decrypt") {
        if (!this.tag) throw new Error("TPAP AES-CCM authentication tag missing");
        this.result = decryptCcm(this.key, this.nonce, this.input, this.tag, this.tagLength);
        return this.result;
      }
      return Buffer.alloc(0);
    }

    getAuthTag() {
      if (!this.tag) {
        const result = encryptCcm(this.key, this.nonce, this.input, this.tagLength);
        this.result = result.ciphertext;
        this.tag = result.tag;
      }
      return Buffer.from(this.tag);
    }

    setAuthTag(tag) {
      this.tag = Buffer.from(tag);
    }
  }

  const makeCipher = (mode, key, iv, options) =>
    new TapoCcmCipher(key, iv, Number(options?.authTagLength || 16), mode);

  crypto.createCipheriv = function patchedCreateCipheriv(algorithm, key, iv, options) {
    if (isCcm(algorithm)) return makeCipher("encrypt", key, iv, options);
    return originalCreateCipheriv(algorithm, key, iv, options);
  };

  crypto.createDecipheriv = function patchedCreateDecipheriv(algorithm, key, iv, options) {
    if (isCcm(algorithm)) return makeCipher("decrypt", key, iv, options);
    return originalCreateDecipheriv(algorithm, key, iv, options);
  };

  console.log("[TAPO] AES-CCM Electron fallback installed");
})();
