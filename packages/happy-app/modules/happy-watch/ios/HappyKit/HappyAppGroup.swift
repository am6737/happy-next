import Foundation

/// The App Group the watch app shares with its complication: `group.<the iPhone app's bundle id>.watch`,
/// the watch app's bundle id being the iPhone app's with `.watchkitapp` (and the complication's
/// `.watchkitapp.widget`) after it
public enum HappyAppGroup {
  public static var identifier: String? {
    guard let bundleId = Bundle.main.bundleIdentifier,
          let range = bundleId.range(of: ".watchkitapp") else { return nil }
    return "group.\(bundleId[..<range.lowerBound]).watch"
  }

  /// What the complication shows when it cannot reach the server: the counts the watch app saw last
  public struct Snapshot: Codable {
    public var needsApproval: Int
    public var running: Int
    public var updatedAt: Date

    public init(needsApproval: Int, running: Int, updatedAt: Date = Date()) {
      self.needsApproval = needsApproval
      self.running = running
      self.updatedAt = updatedAt
    }

    public init(sessions: [HappySession]) {
      self.init(
        needsApproval: sessions.filter { $0.status == .needsApproval }.count,
        running: sessions.filter { $0.status == .thinking }.count
      )
    }
  }

  private static let snapshotKey = "snapshot"

  public static func loadSnapshot() -> Snapshot? {
    guard let identifier, let data = UserDefaults(suiteName: identifier)?.data(forKey: snapshotKey) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  public static func save(_ snapshot: Snapshot) {
    guard let identifier, let data = try? JSONEncoder().encode(snapshot) else { return }
    UserDefaults(suiteName: identifier)?.set(data, forKey: snapshotKey)
  }
}
