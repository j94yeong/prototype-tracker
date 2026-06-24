/*
 * SHA-256 in pure JavaScript
 * Based on Chris Veness's implementation (MIT licence)
 * https://github.com/chrisveness/crypto
 * Sets window.sha256hex(message) -> hex string
 */
(function (global) {
  'use strict';

  function sha256hex(message) {
    var msg = encodeUTF8(message);
    var msgLen = msg.length;

    // Initial hash values (first 32 bits of fractional parts of square roots of first 8 primes)
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    // Round constants (first 32 bits of fractional parts of cube roots of first 64 primes)
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    // Pre-processing: adding padding bits
    msg[msgLen] = 0x80;
    var l = msgLen + 1;
    while (l % 64 !== 56) { msg[l++] = 0; }
    // Append length in bits as 64-bit big-endian
    var bitLen = msgLen * 8;
    // We assume messages < 2^32 bits
    msg[l++] = 0; msg[l++] = 0; msg[l++] = 0; msg[l++] = 0;
    msg[l++] = (bitLen >>> 24) & 0xff;
    msg[l++] = (bitLen >>> 16) & 0xff;
    msg[l++] = (bitLen >>> 8)  & 0xff;
    msg[l++] = (bitLen)        & 0xff;

    // Process each 512-bit chunk
    for (var i = 0; i < msg.length; i += 64) {
      var W = new Array(64);
      for (var j = 0; j < 16; j++) {
        W[j] = (msg[i + j*4] << 24) | (msg[i + j*4 + 1] << 16) |
                (msg[i + j*4 + 2] << 8) | msg[i + j*4 + 3];
      }
      for (var j = 16; j < 64; j++) {
        var s0 = rotr(W[j-15], 7) ^ rotr(W[j-15], 18) ^ (W[j-15] >>> 3);
        var s1 = rotr(W[j-2], 17) ^ rotr(W[j-2], 19) ^ (W[j-2] >>> 10);
        W[j] = (W[j-16] + s0 + W[j-7] + s1) >>> 0;
      }

      var a = H[0], b = H[1], c = H[2], d = H[3];
      var e = H[4], f = H[5], g = H[6], h = H[7];

      for (var j = 0; j < 64; j++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + K[j] + W[j]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;

        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    var hex = '';
    for (var i = 0; i < 8; i++) {
      hex += ('00000000' + H[i].toString(16)).slice(-8);
    }
    return hex;
  }

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function encodeUTF8(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          var cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          bytes.push(0xf0 | (cp >> 18));
          bytes.push(0x80 | ((cp >> 12) & 0x3f));
          bytes.push(0x80 | ((cp >> 6) & 0x3f));
          bytes.push(0x80 | (cp & 0x3f));
          i++;
        }
      } else {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    return bytes;
  }

  global.sha256hex = sha256hex;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sha256hex: sha256hex };
  }

}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
