import CryptoKit
import Foundation

/// The account's keys, derived from its secret the way the app derives them (`Encryption.create`)
public struct HappyAccountKeys {
  let masterSecret: [UInt8]
  let contentPrivateKey: [UInt8]

  public init?(secret: String) {
    guard let seed = Data(base64URLEncoded: secret), seed.count == 32 else { return nil }
    masterSecret = Array(seed)
    let contentDataKey = KeyTree.derive(master: masterSecret, usage: "Happy EnCoder", path: ["content"])
    contentPrivateKey = NaCl.boxPrivateKey(seed: contentDataKey)
  }

  /// What a session's records are sealed with: its own AES key when it has one (sealed to the
  /// account's content key), the account's secret otherwise
  func sessionCipher(dataEncryptionKey: String?) -> SessionCipher? {
    guard let dataEncryptionKey else {
      return .legacy(masterSecret)
    }
    guard let sealed = Data(base64Encoded: dataEncryptionKey), sealed.first == 0 else { return nil }
    let bundle = Array(sealed.dropFirst())
    let headerLength = 32 + NaCl.nonceLength
    guard bundle.count > headerLength else { return nil }
    let key = NaCl.boxOpen(
      Array(bundle[headerLength...]),
      nonce: Array(bundle[32..<headerLength]),
      senderPublicKey: Array(bundle[0..<32]),
      recipientPrivateKey: contentPrivateKey
    )
    return key.map { .aes(SymmetricKey(data: $0)) }
  }
}

enum KeyTree {
  /// `deriveKey`: an HMAC-SHA512 key tree, the root keyed by `usage + " Master Seed"`, each child by
  /// the chain code over 0x00 and the path segment
  static func derive(master: [UInt8], usage: String, path: [String]) -> [UInt8] {
    var state = hmac(key: Array((usage + " Master Seed").utf8), data: master)
    for index in path {
      state = hmac(key: Array(state[32...]), data: [0] + Array(index.utf8))
    }
    return Array(state[0..<32])
  }

  private static func hmac(key: [UInt8], data: [UInt8]) -> [UInt8] {
    Array(HMAC<SHA512>.authenticationCode(for: data, using: SymmetricKey(data: key)))
  }
}

/// A session's records (metadata, agent state, messages, RPC params): JSON, sealed with AES-256-GCM
/// behind a version byte, or with the account's secret in a secretbox for sessions from before
/// sessions had keys of their own
enum SessionCipher {
  case aes(SymmetricKey)
  case legacy([UInt8])

  func decrypt(base64 string: String) -> Any? {
    guard let data = Data(base64Encoded: string) else { return nil }
    return decrypt(Array(data))
  }

  func decrypt(_ bytes: [UInt8]) -> Any? {
    let plaintext: Data?
    switch self {
    case .aes(let key):
      guard bytes.first == 0,
            let box = try? AES.GCM.SealedBox(combined: Data(bytes.dropFirst())) else { return nil }
      plaintext = try? AES.GCM.open(box, using: key)
    case .legacy(let secret):
      guard bytes.count > NaCl.nonceLength else { return nil }
      plaintext = NaCl.secretboxOpen(
        Array(bytes[NaCl.nonceLength...]),
        nonce: Array(bytes[0..<NaCl.nonceLength]),
        key: secret
      ).map { Data($0) }
    }
    guard let plaintext else { return nil }
    return try? JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed])
  }

  func encrypt(_ value: Any) throws -> String {
    let json = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    switch self {
    case .aes(let key):
      let box = try AES.GCM.seal(json, using: key)
      guard let combined = box.combined else { throw HappyError.encryption }
      return (Data([0]) + combined).base64EncodedString()
    case .legacy(let secret):
      let nonce = NaCl.randomBytes(NaCl.nonceLength)
      let sealed = NaCl.secretboxSeal(Array(json), nonce: nonce, key: secret)
      return Data(nonce + sealed).base64EncodedString()
    }
  }
}

extension Data {
  init?(base64URLEncoded string: String) {
    var base64 = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let padding = base64.count % 4
    if padding > 0 {
      base64 += String(repeating: "=", count: 4 - padding)
    }
    self.init(base64Encoded: base64)
  }
}
