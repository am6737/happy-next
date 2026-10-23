import ExpoModulesCore
import Foundation

/**
 * The share extension (expo-share-intent's, patched) runs before the app and can't reach its
 * store, so the two talk through the App Group's defaults: the app leaves a snapshot of what the
 * extension shows (the online sessions, its strings and colours), and the extension leaves where
 * the user sent the content, which the app takes along with the content itself.
 */
public class HappyShareExtensionModule: Module {
  // The same keys as in the extension (patches/expo-share-intent+5.1.1.patch)
  private let snapshotKey = "happyShareSnapshot"
  private let targetKey = "happyShareTarget"

  public func definition() -> ModuleDefinition {
    Name("HappyShareExtension")

    // A JSON snapshot, or nil to clear it (signed out: the extension then just opens the app)
    Function("setSnapshot") { (json: String?) in
      guard let defaults = self.groupDefaults() else { return }
      if let json {
        defaults.set(json, forKey: self.snapshotKey)
      } else {
        defaults.removeObject(forKey: self.snapshotKey)
      }
    }

    // Where the extension sent the content last: "new" or "session:<id>", once
    Function("takeTarget") { () -> String? in
      guard let defaults = self.groupDefaults() else { return nil }
      let target = defaults.string(forKey: self.targetKey)
      defaults.removeObject(forKey: self.targetKey)
      return target
    }
  }

  private func groupDefaults() -> UserDefaults? {
    // Set in Info.plist by expo-share-intent's config plugin
    guard let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String else { return nil }
    return UserDefaults(suiteName: group)
  }
}
