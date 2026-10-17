import EXNotifications
import ExpoModulesCore
import UIKit

/// At launch, before any JavaScript runs (a notification's action can launch the app in the
/// background), registers the notification categories and starts answering their actions
public class HappyWatchAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    NotificationActions.registerCategories()
    NotificationCenterManager.shared.addDelegate(NotificationActions.shared)
    PhoneWatchBridge.shared.activate()
    return true
  }
}
