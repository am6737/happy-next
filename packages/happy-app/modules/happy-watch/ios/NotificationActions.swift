import EXNotifications
import UIKit
import UserNotifications

/**
 * The actions of Happy's notifications, which the CLI asks for by category:
 * - `happy.permission`, on a permission request: allow, allow for the rest of the session, deny,
 *   and stop the turn;
 * - `happy.ready`, when a turn is over: a reply.
 * The answer goes straight to the server, without opening the app; an Apple Watch shows the same
 * actions on the notifications it mirrors (the reply by dictation).
 */
final class NotificationActions: NotificationDelegate {
  static let shared = NotificationActions()

  static let permissionCategory = "happy.permission"
  static let readyCategory = "happy.ready"

  private enum Action: String {
    case allow = "happy.allow"
    case allowForSession = "happy.allowForSession"
    case deny = "happy.deny"
    case abort = "happy.abort"
    case reply = "happy.reply"
  }

  static func registerCategories() {
    let permission = UNNotificationCategory(
      identifier: permissionCategory,
      actions: [
        UNNotificationAction(identifier: Action.allow.rawValue, title: L("Allow", "允许"), options: [.authenticationRequired]),
        UNNotificationAction(identifier: Action.allowForSession.rawValue, title: L("Allow for This Session", "本次会话总是允许"), options: [.authenticationRequired]),
        UNNotificationAction(identifier: Action.deny.rawValue, title: L("Deny", "拒绝"), options: [.destructive]),
        UNNotificationAction(identifier: Action.abort.rawValue, title: L("Stop", "中止任务"), options: [.destructive]),
      ],
      intentIdentifiers: []
    )
    let ready = UNNotificationCategory(
      identifier: readyCategory,
      actions: [
        UNTextInputNotificationAction(
          identifier: Action.reply.rawValue,
          title: L("Reply", "回复"),
          options: [.authenticationRequired],
          textInputButtonTitle: L("Send", "发送"),
          textInputPlaceholder: L("Message", "消息")
        ),
      ],
      intentIdentifiers: []
    )
    let center = UNUserNotificationCenter.current()
    // Keep the categories other code registered (expo-notifications' own, if any)
    center.getNotificationCategories { existing in
      let others = existing.filter { $0.identifier != permissionCategory && $0.identifier != readyCategory }
      center.setNotificationCategories(others.union([permission, ready]))
    }
  }

  // MARK: NotificationDelegate

  func willPresent(_ notification: UNNotification, completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) -> Bool {
    false
  }

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    guard let action = Action(rawValue: response.actionIdentifier) else {
      // A tap on the notification, or another app's action: left to expo-notifications
      return false
    }
    let data = Self.payload(of: response.notification.request.content.userInfo)
    guard let sessionId = data["sessionId"] as? String else { return true }
    let requestId = data["requestId"] as? String
    let text = (response as? UNTextInputNotificationResponse)?.userText.trimmingCharacters(in: .whitespacesAndNewlines)

    // expo-notifications completes the response right away, so the work asks for time of its own
    let application = UIApplication.shared
    var task = UIBackgroundTaskIdentifier.invalid
    task = application.beginBackgroundTask(withName: "happy.notificationAction") {
      application.endBackgroundTask(task)
      task = .invalid
    }
    Task {
      await Self.perform(action, sessionId: sessionId, requestId: requestId, text: text)
      await MainActor.run {
        if task != .invalid {
          application.endBackgroundTask(task)
          task = .invalid
        }
      }
    }
    return true
  }

  func didReceive(_ userInfo: [AnyHashable: Any], completionHandler: @escaping (UIBackgroundFetchResult) -> Void) -> Bool {
    false
  }

  func openSettings(_ notification: UNNotification?) {}
  func didRegister(_ deviceToken: String) {}
  func didFailRegistration(_ error: Error) {}

  // MARK: Answering

  private static func perform(_ action: Action, sessionId: String, requestId: String?, text: String?) async {
    guard let credentials = HappyCredentialsStore.load(), let client = HappyClient(credentials: credentials) else {
      await notifyFailure(L("Open Happy to sign in again.", "请打开 Happy 重新登录。"))
      return
    }
    do {
      switch action {
      case .allow, .allowForSession, .deny:
        guard let requestId else { return }
        let answer: HappyPermissionAnswer = action == .allow ? .allow : action == .deny ? .deny : .allowForSession
        try await client.answer(answer, requestId: requestId, sessionId: sessionId)
      case .abort:
        try await client.abort(sessionId: sessionId)
      case .reply:
        guard let text, !text.isEmpty else { return }
        try await client.send(text: text, sessionId: sessionId)
      }
    } catch {
      await notifyFailure(L("Couldn't reach the session. Open Happy to try again.", "无法连接到会话，请打开 Happy 重试。"))
    }
  }

  /// A failed action leaves no trace otherwise: the notification it came from is already gone
  private static func notifyFailure(_ message: String) async {
    let content = UNMutableNotificationContent()
    content.title = "Happy"
    content.body = message
    let request = UNNotificationRequest(identifier: "happy.actionFailed", content: content, trigger: nil)
    try? await UNUserNotificationCenter.current().add(request)
  }

  /// The push's data: DooPush passes it as a JSON string under `data`, Expo as `body`, a local
  /// notification at the root
  static func payload(of userInfo: [AnyHashable: Any]) -> [String: Any] {
    if let string = userInfo["data"] as? String,
       let data = string.data(using: .utf8),
       let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
      return object
    }
    if let object = userInfo["data"] as? [String: Any] { return object }
    if let object = userInfo["body"] as? [String: Any] { return object }
    var root: [String: Any] = [:]
    for (key, value) in userInfo {
      if let key = key as? String { root[key] = value }
    }
    return root
  }
}
