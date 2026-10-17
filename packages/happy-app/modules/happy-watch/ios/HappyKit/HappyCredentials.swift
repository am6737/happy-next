import Foundation
import Security

/// What talking to the server takes: the account's token and secret (as the app keeps them) and the
/// server the app talks to
public struct HappyCredentials: Codable, Equatable {
  public let token: String
  public let secret: String
  public let serverUrl: String

  public init(token: String, secret: String, serverUrl: String) {
    self.token = token
    self.secret = secret
    self.serverUrl = serverUrl
  }

  public init?(dictionary: [String: Any]) {
    guard let token = dictionary["token"] as? String,
          let secret = dictionary["secret"] as? String,
          let serverUrl = dictionary["serverUrl"] as? String else { return nil }
    self.init(token: token, secret: secret, serverUrl: serverUrl)
  }

  public var dictionary: [String: Any] {
    ["token": token, "secret": secret, "serverUrl": serverUrl]
  }
}

/// The credentials in the keychain, readable after the first unlock, so a notification's action
/// still works while the phone is locked (the app's own copy is readable only while unlocked)
public enum HappyCredentialsStore {
  private static let service = "happy.watch.credentials"
  private static let account = "default"

  /// The keychain group the credentials are kept in, which the watch app shares with its complication
  public static var accessGroup: String?

  public static func load() -> HappyCredentials? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(HappyCredentials.self, from: data)
  }

  @discardableResult
  public static func save(_ credentials: HappyCredentials) -> Bool {
    guard let data = try? JSONEncoder().encode(credentials) else { return false }
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var item = baseQuery
      item.merge(attributes) { $1 }
      return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }
    return status == errSecSuccess
  }

  public static func clear() {
    SecItemDelete(baseQuery as CFDictionary)
  }

  private static var baseQuery: [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if let accessGroup {
      query[kSecAttrAccessGroup as String] = accessGroup
    }
    return query
  }
}
