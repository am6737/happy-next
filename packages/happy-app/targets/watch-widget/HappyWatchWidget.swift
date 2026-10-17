import SwiftUI
import WidgetKit

struct SessionCountsEntry: TimelineEntry {
  let date: Date
  /// Nil while signed out
  let snapshot: HappyAppGroup.Snapshot?
}

/// Reads the counts from the server, with the account the watch app keeps in the shared group, and
/// falls back to those the watch app saw last
struct SessionCountsProvider: TimelineProvider {
  func placeholder(in context: Context) -> SessionCountsEntry {
    SessionCountsEntry(date: Date(), snapshot: HappyAppGroup.Snapshot(needsApproval: 1, running: 2))
  }

  func getSnapshot(in context: Context, completion: @escaping (SessionCountsEntry) -> Void) {
    if context.isPreview {
      completion(placeholder(in: context))
      return
    }
    Task { completion(await entry()) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SessionCountsEntry>) -> Void) {
    Task {
      let entry = await entry()
      completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
  }

  private func entry() async -> SessionCountsEntry {
    HappyCredentialsStore.accessGroup = HappyAppGroup.identifier
    guard let credentials = HappyCredentialsStore.load(),
          let client = HappyClient(credentials: credentials) else {
      return SessionCountsEntry(date: Date(), snapshot: nil)
    }
    if let sessions = try? await client.activeSessions() {
      let snapshot = HappyAppGroup.Snapshot(sessions: sessions)
      HappyAppGroup.save(snapshot)
      return SessionCountsEntry(date: Date(), snapshot: snapshot)
    }
    return SessionCountsEntry(date: Date(), snapshot: HappyAppGroup.loadSnapshot())
  }
}

struct SessionCountsView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SessionCountsEntry

  private var needsApproval: Int { entry.snapshot?.needsApproval ?? 0 }
  private var running: Int { entry.snapshot?.running ?? 0 }

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Image(systemName: symbol)
            .font(.system(size: 14, weight: .semibold))
          Text(entry.snapshot == nil ? "–" : "\(needsApproval > 0 ? needsApproval : running)")
            .font(.system(size: 16, weight: .bold, design: .rounded))
        }
        .foregroundStyle(needsApproval > 0 ? Color.orange : Color.primary)
      }
    case .accessoryCorner:
      Image(systemName: symbol)
        .font(.system(size: 20, weight: .semibold))
        .foregroundStyle(needsApproval > 0 ? Color.orange : Color.primary)
        .widgetLabel(summary)
    case .accessoryInline:
      Label(summary, systemImage: symbol)
    default:
      VStack(alignment: .leading, spacing: 2) {
        Text("Happy Next")
          .font(.headline)
          .widgetAccentable()
        if entry.snapshot == nil {
          Text(L("Sign in on your iPhone", "请在 iPhone 上登录"))
            .font(.footnote)
        } else {
          Label(L("\(needsApproval) need approval", "\(needsApproval) 个等待审批"), systemImage: "hand.raised.fill")
            .foregroundStyle(needsApproval > 0 ? Color.orange : Color.secondary)
          Label(L("\(running) working", "\(running) 个执行中"), systemImage: "bolt.fill")
        }
      }
      .font(.footnote)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var symbol: String {
    if entry.snapshot == nil { return "person.crop.circle.badge.questionmark" }
    if needsApproval > 0 { return "hand.raised.fill" }
    return running > 0 ? "bolt.fill" : "checkmark"
  }

  private var summary: String {
    guard entry.snapshot != nil else { return L("Signed out", "未登录") }
    if needsApproval > 0 { return L("\(needsApproval) need approval", "\(needsApproval) 个等待审批") }
    if running > 0 { return L("\(running) working", "\(running) 个执行中") }
    return L("All idle", "全部空闲")
  }
}

@main
struct HappyWatchWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HappySessions", provider: SessionCountsProvider()) { entry in
      SessionCountsView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Happy Next")
    .description(L("Sessions waiting for approval and working.", "等待审批和执行中的会话。"))
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}
