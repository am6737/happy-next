import CryptoKit
import Foundation
import Security

/// The parts of libsodium the app's encryption uses, which CryptoKit does not have: XSalsa20-Poly1305,
/// as `crypto_secretbox_easy` and `crypto_box_easy` lay it out (the 16-byte tag, then the ciphertext).
/// X25519 comes from CryptoKit.
enum NaCl {
  static let nonceLength = 24
  static let tagLength = 16

  /// `crypto_secretbox_easy`
  static func secretboxSeal(_ message: [UInt8], nonce: [UInt8], key: [UInt8]) -> [UInt8] {
    var stream = Salsa20.xsalsa20Stream(key: key, nonce: nonce, length: 32 + message.count)
    let polyKey = Array(stream[0..<32])
    var ciphertext = [UInt8](repeating: 0, count: message.count)
    for i in 0..<message.count {
      ciphertext[i] = message[i] ^ stream[32 + i]
    }
    stream.removeAll()
    return Poly1305.authenticate(message: ciphertext, key: polyKey) + ciphertext
  }

  /// `crypto_secretbox_open_easy`; nil when the tag does not match
  static func secretboxOpen(_ box: [UInt8], nonce: [UInt8], key: [UInt8]) -> [UInt8]? {
    guard box.count >= tagLength else { return nil }
    let tag = Array(box[0..<tagLength])
    let ciphertext = Array(box[tagLength...])
    let stream = Salsa20.xsalsa20Stream(key: key, nonce: nonce, length: 32 + ciphertext.count)
    let expected = Poly1305.authenticate(message: ciphertext, key: Array(stream[0..<32]))
    guard constantTimeEqual(tag, expected) else { return nil }
    var message = [UInt8](repeating: 0, count: ciphertext.count)
    for i in 0..<ciphertext.count {
      message[i] = ciphertext[i] ^ stream[32 + i]
    }
    return message
  }

  /// `crypto_box_open_easy`: the shared key is HSalsa20 of the X25519 secret (`crypto_box_beforenm`)
  static func boxOpen(_ box: [UInt8], nonce: [UInt8], senderPublicKey: [UInt8], recipientPrivateKey: [UInt8]) -> [UInt8]? {
    guard let shared = try? sharedKey(publicKey: senderPublicKey, privateKey: recipientPrivateKey) else { return nil }
    return secretboxOpen(box, nonce: nonce, key: shared)
  }

  /// The private key of `crypto_box_seed_keypair`: the first half of SHA-512 of the seed
  static func boxPrivateKey(seed: [UInt8]) -> [UInt8] {
    Array(SHA512.hash(data: seed).prefix(32))
  }

  private static func sharedKey(publicKey: [UInt8], privateKey: [UInt8]) throws -> [UInt8] {
    let priv = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
    let pub = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey)
    let secret = try priv.sharedSecretFromKeyAgreement(with: pub)
    let raw = secret.withUnsafeBytes { Array($0) }
    return Salsa20.hsalsa20(key: raw, input: [UInt8](repeating: 0, count: 16))
  }

  static func randomBytes(_ count: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: count)
    let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
    return bytes
  }

  static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
    guard a.count == b.count else { return false }
    var diff: UInt8 = 0
    for i in 0..<a.count {
      diff |= a[i] ^ b[i]
    }
    return diff == 0
  }
}

enum Salsa20 {
  private static let sigma: [UInt32] = [0x6170_7865, 0x3320_646e, 0x7962_2d32, 0x6b20_6574]

  @inline(__always)
  private static func rotl(_ v: UInt32, _ c: UInt32) -> UInt32 {
    (v << c) | (v >> (32 - c))
  }

  @inline(__always)
  static func load32(_ b: [UInt8], _ i: Int) -> UInt32 {
    UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
  }

  @inline(__always)
  static func store32(_ v: UInt32, into out: inout [UInt8], at i: Int) {
    out[i] = UInt8(truncatingIfNeeded: v)
    out[i + 1] = UInt8(truncatingIfNeeded: v >> 8)
    out[i + 2] = UInt8(truncatingIfNeeded: v >> 16)
    out[i + 3] = UInt8(truncatingIfNeeded: v >> 24)
  }

  private static func initialState(key: [UInt8], input: [UInt8]) -> [UInt32] {
    [
      sigma[0], load32(key, 0), load32(key, 4), load32(key, 8),
      load32(key, 12), sigma[1], load32(input, 0), load32(input, 4),
      load32(input, 8), load32(input, 12), sigma[2], load32(key, 16),
      load32(key, 20), load32(key, 24), load32(key, 28), sigma[3],
    ]
  }

  private static func rounds(_ x: inout [UInt32]) {
    for _ in 0..<10 {
      x[4] ^= rotl(x[0] &+ x[12], 7); x[8] ^= rotl(x[4] &+ x[0], 9)
      x[12] ^= rotl(x[8] &+ x[4], 13); x[0] ^= rotl(x[12] &+ x[8], 18)
      x[9] ^= rotl(x[5] &+ x[1], 7); x[13] ^= rotl(x[9] &+ x[5], 9)
      x[1] ^= rotl(x[13] &+ x[9], 13); x[5] ^= rotl(x[1] &+ x[13], 18)
      x[14] ^= rotl(x[10] &+ x[6], 7); x[2] ^= rotl(x[14] &+ x[10], 9)
      x[6] ^= rotl(x[2] &+ x[14], 13); x[10] ^= rotl(x[6] &+ x[2], 18)
      x[3] ^= rotl(x[15] &+ x[11], 7); x[7] ^= rotl(x[3] &+ x[15], 9)
      x[11] ^= rotl(x[7] &+ x[3], 13); x[15] ^= rotl(x[11] &+ x[7], 18)

      x[1] ^= rotl(x[0] &+ x[3], 7); x[2] ^= rotl(x[1] &+ x[0], 9)
      x[3] ^= rotl(x[2] &+ x[1], 13); x[0] ^= rotl(x[3] &+ x[2], 18)
      x[6] ^= rotl(x[5] &+ x[4], 7); x[7] ^= rotl(x[6] &+ x[5], 9)
      x[4] ^= rotl(x[7] &+ x[6], 13); x[5] ^= rotl(x[4] &+ x[7], 18)
      x[11] ^= rotl(x[10] &+ x[9], 7); x[8] ^= rotl(x[11] &+ x[10], 9)
      x[9] ^= rotl(x[8] &+ x[11], 13); x[10] ^= rotl(x[9] &+ x[8], 18)
      x[12] ^= rotl(x[15] &+ x[14], 7); x[13] ^= rotl(x[12] &+ x[15], 9)
      x[14] ^= rotl(x[13] &+ x[12], 13); x[15] ^= rotl(x[14] &+ x[13], 18)
    }
  }

  /// HSalsa20 of a 32-byte key and a 16-byte input
  static func hsalsa20(key: [UInt8], input: [UInt8]) -> [UInt8] {
    var x = initialState(key: key, input: input)
    rounds(&x)
    var out = [UInt8](repeating: 0, count: 32)
    for (n, i) in [0, 5, 10, 15, 6, 7, 8, 9].enumerated() {
      store32(x[i], into: &out, at: n * 4)
    }
    return out
  }

  /// The XSalsa20 keystream of a 32-byte key and a 24-byte nonce, from block 0
  static func xsalsa20Stream(key: [UInt8], nonce: [UInt8], length: Int) -> [UInt8] {
    let subkey = hsalsa20(key: key, input: Array(nonce[0..<16]))
    var input = Array(nonce[16..<24]) + [UInt8](repeating: 0, count: 8)
    var out = [UInt8](repeating: 0, count: length)
    var block = [UInt8](repeating: 0, count: 64)
    var counter: UInt64 = 0
    var offset = 0
    while offset < length {
      for i in 0..<8 {
        input[8 + i] = UInt8(truncatingIfNeeded: counter >> (8 * UInt64(i)))
      }
      let initial = initialState(key: subkey, input: input)
      var x = initial
      rounds(&x)
      for i in 0..<16 {
        store32(x[i] &+ initial[i], into: &block, at: i * 4)
      }
      let n = min(64, length - offset)
      for i in 0..<n {
        out[offset + i] = block[i]
      }
      offset += n
      counter += 1
    }
    return out
  }
}

/// Poly1305 with 26-bit limbs, after poly1305-donna
enum Poly1305 {
  static func authenticate(message: [UInt8], key: [UInt8]) -> [UInt8] {
    let load32 = Salsa20.load32
    let r0 = load32(key, 0) & 0x3ff_ffff
    let r1 = (load32(key, 3) >> 2) & 0x3ff_ff03
    let r2 = (load32(key, 6) >> 4) & 0x3ff_c0ff
    let r3 = (load32(key, 9) >> 6) & 0x3f0_3fff
    let r4 = (load32(key, 12) >> 8) & 0x00f_ffff
    let s1 = UInt64(r1 * 5), s2 = UInt64(r2 * 5), s3 = UInt64(r3 * 5), s4 = UInt64(r4 * 5)
    let R0 = UInt64(r0), R1 = UInt64(r1), R2 = UInt64(r2), R3 = UInt64(r3), R4 = UInt64(r4)

    var h0: UInt32 = 0, h1: UInt32 = 0, h2: UInt32 = 0, h3: UInt32 = 0, h4: UInt32 = 0
    var block = [UInt8](repeating: 0, count: 17)
    var offset = 0
    while offset < message.count {
      let n = min(16, message.count - offset)
      for i in 0..<17 { block[i] = 0 }
      for i in 0..<n { block[i] = message[offset + i] }
      let hibit: UInt32
      if n == 16 {
        hibit = 1 << 24
      } else {
        block[n] = 1
        hibit = 0
      }
      h0 = h0 &+ (load32(block, 0) & 0x3ff_ffff)
      h1 = h1 &+ ((load32(block, 3) >> 2) & 0x3ff_ffff)
      h2 = h2 &+ ((load32(block, 6) >> 4) & 0x3ff_ffff)
      h3 = h3 &+ ((load32(block, 9) >> 6) & 0x3ff_ffff)
      h4 = h4 &+ ((load32(block, 12) >> 8) | hibit)

      let H0 = UInt64(h0), H1 = UInt64(h1), H2 = UInt64(h2), H3 = UInt64(h3), H4 = UInt64(h4)
      let d0 = H0 * R0 + H1 * s4 + H2 * s3 + H3 * s2 + H4 * s1
      var d1 = H0 * R1 + H1 * R0 + H2 * s4 + H3 * s3 + H4 * s2
      var d2 = H0 * R2 + H1 * R1 + H2 * R0 + H3 * s4 + H4 * s3
      var d3 = H0 * R3 + H1 * R2 + H2 * R1 + H3 * R0 + H4 * s4
      var d4 = H0 * R4 + H1 * R3 + H2 * R2 + H3 * R1 + H4 * R0

      var c = d0 >> 26; h0 = UInt32(d0 & 0x3ff_ffff)
      d1 += c; c = d1 >> 26; h1 = UInt32(d1 & 0x3ff_ffff)
      d2 += c; c = d2 >> 26; h2 = UInt32(d2 & 0x3ff_ffff)
      d3 += c; c = d3 >> 26; h3 = UInt32(d3 & 0x3ff_ffff)
      d4 += c; c = d4 >> 26; h4 = UInt32(d4 & 0x3ff_ffff)
      h0 = h0 &+ UInt32(c) &* 5
      let carry = h0 >> 26
      h0 &= 0x3ff_ffff
      h1 = h1 &+ carry

      offset += 16
    }

    var c = h1 >> 26; h1 &= 0x3ff_ffff
    h2 = h2 &+ c; c = h2 >> 26; h2 &= 0x3ff_ffff
    h3 = h3 &+ c; c = h3 >> 26; h3 &= 0x3ff_ffff
    h4 = h4 &+ c; c = h4 >> 26; h4 &= 0x3ff_ffff
    h0 = h0 &+ c &* 5; c = h0 >> 26; h0 &= 0x3ff_ffff
    h1 = h1 &+ c

    var g0 = h0 &+ 5; c = g0 >> 26; g0 &= 0x3ff_ffff
    var g1 = h1 &+ c; c = g1 >> 26; g1 &= 0x3ff_ffff
    var g2 = h2 &+ c; c = g2 >> 26; g2 &= 0x3ff_ffff
    var g3 = h3 &+ c; c = g3 >> 26; g3 &= 0x3ff_ffff
    var g4 = h4 &+ c &- (1 << 26)

    var mask = (g4 >> 31) &- 1
    g0 &= mask; g1 &= mask; g2 &= mask; g3 &= mask; g4 &= mask
    mask = ~mask
    h0 = (h0 & mask) | g0
    h1 = (h1 & mask) | g1
    h2 = (h2 & mask) | g2
    h3 = (h3 & mask) | g3
    h4 = (h4 & mask) | g4

    h0 = h0 | (h1 << 26)
    h1 = (h1 >> 6) | (h2 << 20)
    h2 = (h2 >> 12) | (h3 << 14)
    h3 = (h3 >> 18) | (h4 << 8)

    var f = UInt64(h0) + UInt64(load32(key, 16)); h0 = UInt32(truncatingIfNeeded: f)
    f = UInt64(h1) + UInt64(load32(key, 20)) + (f >> 32); h1 = UInt32(truncatingIfNeeded: f)
    f = UInt64(h2) + UInt64(load32(key, 24)) + (f >> 32); h2 = UInt32(truncatingIfNeeded: f)
    f = UInt64(h3) + UInt64(load32(key, 28)) + (f >> 32); h3 = UInt32(truncatingIfNeeded: f)

    var tag = [UInt8](repeating: 0, count: 16)
    Salsa20.store32(h0, into: &tag, at: 0)
    Salsa20.store32(h1, into: &tag, at: 4)
    Salsa20.store32(h2, into: &tag, at: 8)
    Salsa20.store32(h3, into: &tag, at: 12)
    return tag
  }
}
