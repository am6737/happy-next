import SwiftUI
import UIKit

/// The active sessions, ordered as the app orders its list: by when their conversation last moved
struct SessionListView: View {
  @EnvironmentObject private var store: WatchStore

  private var sessions: [HappySession] {
    store.sessions.sorted { a, b in
      a.lastMessageAt != b.lastMessageAt ? a.lastMessageAt > b.lastMessageAt : a.id < b.id
    }
  }

  var body: some View {
    List {
      if store.sessions.isEmpty {
        Text(emptyText)
          .foregroundStyle(.secondary)
          .listRowBackground(Color.clear)
      }
      ForEach(sessions) { session in
        NavigationLink(value: session.id) {
          SessionRow(session: session)
        }
      }
    }
    .navigationTitle("Happy Next")
    .navigationDestination(for: String.self) { id in
      SessionDetailView(sessionId: id)
    }
    .task {
      await poll(every: 5) { await store.refresh() }
    }
  }

  private var emptyText: String {
    if !store.hasLoaded { return L("Loading…", "加载中…") }
    if store.loadFailed { return L("Can't reach the server.", "无法连接服务器。") }
    return L("No active sessions.", "没有活跃的会话。")
  }
}

private struct SessionRow: View {
  let session: HappySession
  /// The avatar is as tall as a line of the title, and centred on its first line
  @ScaledMetric(relativeTo: .headline) private var avatarSize: CGFloat = 20
  private var titleLineHeight: CGFloat { UIFont.preferredFont(forTextStyle: .headline).lineHeight }

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      SessionAvatar(session: session, size: avatarSize)
        .frame(height: max(titleLineHeight, avatarSize))
      VStack(alignment: .leading, spacing: 2) {
        Text(session.title)
          .font(.headline)
          .lineLimit(2)
        HStack(spacing: 4) {
          StatusBadge(status: session.status, size: 12)
          Text(statusText)
            .foregroundStyle(statusColor)
            .lineLimit(1)
        }
        .font(.footnote)
        if !session.detail.isEmpty {
          Text(session.detail)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
    }
    .padding(.vertical, 2)
  }

  private var statusText: String {
    switch session.status {
    case .needsApproval:
      return L("Needs approval", "等待审批") + (session.requests.count > 1 ? " (\(session.requests.count))" : "")
    case .thinking:
      return L("Working…", "执行中…")
    case .waiting:
      return L("Waiting for you", "等待你的消息")
    }
  }

  private var statusColor: Color {
    switch session.status {
    case .needsApproval: return .orange
    case .thinking: return .blue
    case .waiting: return .green
    }
  }
}

struct StatusBadge: View {
  let status: HappySession.Status
  let size: CGFloat

  var body: some View {
    switch status {
    case .needsApproval:
      Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
    case .thinking:
      ProgressView().frame(width: size, height: size)
    case .waiting:
      Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
    }
  }
}

/// Runs `work` now and every `seconds` after it, until the view's task is cancelled
func poll(every seconds: Double, _ work: () async -> Void) async {
  while !Task.isCancelled {
    await work()
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
  }
}
