import Foundation
import WatchConnectivity

/// Receives the iPhone app's account: the application context it last shared, or, when the watch has
/// none yet, the answer to asking for it
final class WatchSessionReceiver: NSObject, WCSessionDelegate {
  static let shared = WatchSessionReceiver()

  func activate() {
    guard WCSession.isSupported(), WCSession.default.delegate == nil else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  /// Asks the phone for its account; it answers only while it is reachable
  func requestCredentials() {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessage(["request": "credentials"], replyHandler: { [weak self] reply in
      self?.apply(reply)
    }, errorHandler: nil)
  }

  private func apply(_ context: [String: Any]) {
    if context["signedOut"] as? Bool == true {
      Task { @MainActor in WatchStore.shared.update(nil) }
    } else if let dictionary = context["credentials"] as? [String: Any],
              let credentials = HappyCredentials(dictionary: dictionary) {
      Task { @MainActor in WatchStore.shared.update(credentials) }
    }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    guard activationState == .activated else { return }
    if !session.receivedApplicationContext.isEmpty {
      apply(session.receivedApplicationContext)
    }
    Task { @MainActor in
      if WatchStore.shared.credentials == nil {
        self.requestCredentials()
      }
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor in
      if session.isReachable, WatchStore.shared.credentials == nil {
        self.requestCredentials()
      }
    }
  }
}
