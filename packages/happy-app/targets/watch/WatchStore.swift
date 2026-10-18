import Foundation
import WidgetKit

/// The watch app's state: the account it is signed in with (handed over by the iPhone app) and the
/// active sessions, which it reads from the server while it is on screen
@MainActor
final class WatchStore: ObservableObject {
  static let shared = WatchStore()

  @Published private(set) var credentials: HappyCredentials?
  @Published private(set) var sessions: [HappySession] = []
  @Published private(set) var hasLoaded = false
  @Published private(set) var loadFailed = false
  private(set) var client: HappyClient?

  private init() {
    HappyCredentialsStore.accessGroup = HappyAppGroup.identifier
    apply(HappyCredentialsStore.load())
  }

  /// The iPhone app's account, or nil when it signed out
  func update(_ credentials: HappyCredentials?) {
    guard credentials != self.credentials else { return }
    if let credentials {
      HappyCredentialsStore.save(credentials)
    } else {
      HappyCredentialsStore.clear()
    }
    apply(credentials)
    Task { await refresh() }
  }

  private func apply(_ credentials: HappyCredentials?) {
    self.credentials = credentials
    client = credentials.flatMap { HappyClient(credentials: $0) }
    if client == nil {
      sessions = []
      hasLoaded = false
      saveSnapshot()
    }
  }

  func refresh() async {
    guard let client else { return }
    do {
      sessions = try await client.activeSessions(withPins: true)
      loadFailed = false
    } catch {
      loadFailed = true
    }
    hasLoaded = true
    saveSnapshot()
  }

  func session(id: String) -> HappySession? {
    sessions.first { $0.id == id }
  }

  /// Hands the complication the counts, reloading it only when they change (its reloads are budgeted)
  private func saveSnapshot() {
    let snapshot = HappyAppGroup.Snapshot(sessions: sessions)
    let previous = HappyAppGroup.loadSnapshot()
    HappyAppGroup.save(snapshot)
    if previous?.needsApproval != snapshot.needsApproval || previous?.running != snapshot.running {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
