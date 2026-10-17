import Foundation
import WatchConnectivity

/// Signs the watch app in with the phone's account: the credentials go to the watch as the
/// application context (the latest one is delivered when the watch next wakes the app), and the
/// watch can ask for them when it has none
final class PhoneWatchBridge: NSObject, WCSessionDelegate {
  static let shared = PhoneWatchBridge()

  private var session: WCSession? {
    WCSession.isSupported() ? WCSession.default : nil
  }

  func activate() {
    guard let session, session.delegate == nil else { return }
    session.delegate = self
    session.activate()
  }

  /// Shares the credentials with the watch, or that the phone signed out (nil)
  func share(_ credentials: HappyCredentials?) {
    guard let session, session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
    let context = Self.context(for: credentials)
    if NSDictionary(dictionary: session.applicationContext).isEqual(to: context) { return }
    try? session.updateApplicationContext(context)
  }

  private static func context(for credentials: HappyCredentials?) -> [String: Any] {
    guard let credentials else { return ["signedOut": true] }
    return ["credentials": credentials.dictionary]
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if activationState == .activated {
      share(HappyCredentialsStore.load())
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    replyHandler(Self.context(for: HappyCredentialsStore.load()))
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    share(HappyCredentialsStore.load())
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switching to another watch: activate again so the new one is signed in too
    session.activate()
  }
}
