import SwiftUI

@main
struct HappyWatchApp: App {
  @StateObject private var store = WatchStore.shared

  init() {
    WatchSessionReceiver.shared.activate()
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(store)
    }
  }
}
