import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var store: WatchStore

  var body: some View {
    if store.credentials == nil {
      SignInView()
    } else {
      NavigationStack {
        SessionListView()
      }
    }
  }
}

/// Until the iPhone app hands its account over
private struct SignInView: View {
  var body: some View {
    ScrollView {
      VStack(spacing: 12) {
        Image(systemName: "iphone")
          .font(.system(size: 34))
          .foregroundStyle(.tint)
        Text(L("Open Happy Next on your iPhone to sign in.", "在 iPhone 上打开 Happy Next 以登录。"))
          .multilineTextAlignment(.center)
        Button(L("Try Again", "重试")) {
          WatchSessionReceiver.shared.requestCredentials()
        }
      }
      .padding(.vertical)
    }
  }
}
