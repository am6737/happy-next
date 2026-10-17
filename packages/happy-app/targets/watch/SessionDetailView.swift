import SwiftUI
import WatchKit

/// A session: the permissions it waits on, its latest messages, a reply, and stopping its turn
struct SessionDetailView: View {
  /// How many pages before the latest "Load Earlier" reads at most, so a long session stays light
  private static let maxEarlierPages = 5

  let sessionId: String
  @EnvironmentObject private var store: WatchStore
  /// The text messages of the pages read, oldest first: the latest page, read again as it changes,
  /// after the pages read before it
  @State private var records: [HappyMessage] = []
  /// Where the pages read begin, and whether the session has messages before that
  @State private var oldestSeq: Int?
  @State private var hasEarlier = false
  @State private var earlierPages = 0
  @State private var loadingEarlier = false
  @State private var openMessage: HappyMessage?
  /// Whether the messages were read once, till when a spinner stands in for them
  @State private var loaded = false
  @State private var draft = ""
  @State private var busy = false
  @State private var failed = false
  /// The permission whose answer didn't reach the session, told on its own card where it was tapped
  @State private var failedRequestId: String?

  private var session: HappySession? { store.session(id: sessionId) }

  var body: some View {
    ScrollViewReader { proxy in
      List {
        if let session {
          ForEach(session.requests) { request in
            PermissionCard(request: request, busy: busy, failed: failedRequestId == request.id) { answer in
              run(for: request.id) { try await $0.answer(answer, request: request, sessionId: sessionId) }
            }
          }
        }

        if !loaded {
          HStack(spacing: 8) {
            ProgressView().frame(width: 16, height: 16)
            Text(L("Loading…", "加载中…"))
              .foregroundStyle(.secondary)
          }
          .listRowBackground(Color.clear)
        }

        if loaded, hasEarlier {
          if earlierPages < Self.maxEarlierPages {
            Button(action: loadEarlier) {
              HStack(spacing: 8) {
                if loadingEarlier {
                  ProgressView().frame(width: 16, height: 16)
                }
                Text(L("Load Earlier Messages", "加载更早的消息"))
              }
            }
            .disabled(loadingEarlier)
          } else {
            Text(L("Earlier messages are on your iPhone.", "更早的消息请在 iPhone 上查看。"))
              .font(.footnote)
              .foregroundStyle(.secondary)
              .listRowBackground(Color.clear)
          }
        }

        ForEach(messages) { message in
          Button { openMessage = message } label: {
            MessageRow(message: message, agent: agentLabel)
          }
          .buttonStyle(.plain)
          .simultaneousGesture(LongPressGesture().onEnded { _ in openMessage = message })
          .listRowBackground(
            RoundedRectangle(cornerRadius: 10)
              .fill(message.role == .user ? Color.accentColor.opacity(0.18) : Color.gray.opacity(0.18))
          )
          .id(message.id)
        }

        TextField(L("Reply", "回复"), text: $draft)
          .onSubmit(send)
          .disabled(busy)
          .id("reply")

        if let status = session?.status, status != .waiting {
          Button(role: .destructive) {
            run { try await $0.abort(sessionId: sessionId) }
          } label: {
            Label(L("Stop", "中止任务"), systemImage: "stop.circle")
          }
          .disabled(busy)
        }

        if failed {
          Text(L("Couldn't reach the session.", "无法连接到会话。"))
            .font(.footnote)
            .foregroundStyle(.red)
        }
      }
      .navigationTitle(session?.title ?? "")
      .navigationDestination(item: $openMessage) { message in
        MessageDetailView(message: message, agent: agentLabel)
      }
      .task {
        await poll(every: 4) {
          await loadMessages()
          await store.refresh()
        }
      }
      .onChange(of: messages.last?.id) { _, last in
        if let last { proxy.scrollTo(last, anchor: .bottom) }
      }
    }
  }

  /// "Claude · Opus 5.5 (High)": the agent the session runs, and its model when the session names one
  private var agentLabel: String {
    guard let session else { return L("Agent", "助手") }
    let model = ModelLabels.label(model: session.model, reasoningEffort: session.reasoningEffort)
    return [session.agentName, model].compactMap { $0 }.joined(separator: " · ")
  }

  /// The messages as a copied session's backfill keeps them: each prompt and the reply it ended on
  private var messages: [HappyMessage] { HappyMessage.turns(records) }

  /// Reads the latest page again, keeping the pages read before it
  private func loadMessages() async {
    guard let client = store.client else { return }
    defer { loaded = true }
    guard let latest = try? await client.messages(sessionId: sessionId) else { return }
    let merged: [HappyMessage]
    if earlierPages == 0 {
      merged = latest.messages
      oldestSeq = latest.oldestSeq
      hasEarlier = latest.hasMore
    } else {
      let start = latest.oldestSeq ?? Int.max
      merged = records.filter { $0.seq < start } + latest.messages
    }
    if merged != records { records = merged }
  }

  private func loadEarlier() {
    guard let client = store.client, let before = oldestSeq, !loadingEarlier else { return }
    loadingEarlier = true
    Task {
      defer { loadingEarlier = false }
      guard let page = try? await client.messages(sessionId: sessionId, before: before) else {
        WKInterfaceDevice.current().play(.failure)
        return
      }
      let known = Set(records.map(\.id))
      records = page.messages.filter { !known.contains($0.id) } + records
      oldestSeq = page.oldestSeq ?? before
      hasEarlier = page.hasMore
      earlierPages += 1
    }
  }

  private func send() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    run { client in
      try await client.send(text: text, sessionId: sessionId)
      draft = ""
    }
  }

  /// Runs an action against the server, then reads the session again to show what came of it;
  /// a failure taps the wrist and is told on the permission's card when the action answers one
  private func run(for requestId: String? = nil, _ action: @escaping (HappyClient) async throws -> Void) {
    guard let client = store.client, !busy else { return }
    busy = true
    failed = false
    failedRequestId = nil
    Task {
      do {
        try await action(client)
      } catch {
        if let requestId {
          failedRequestId = requestId
        } else {
          failed = true
        }
        WKInterfaceDevice.current().play(.failure)
      }
      await store.refresh()
      await loadMessages()
      busy = false
    }
  }
}

private struct PermissionCard: View {
  let request: HappyPermissionRequest
  let busy: Bool
  let failed: Bool
  let answer: (HappyPermissionAnswer) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label(request.tool, systemImage: "hand.raised.fill")
        .font(.headline)
        .foregroundStyle(.orange)
      if !request.summary.isEmpty {
        Text(request.summary)
          .font(.system(.footnote, design: .monospaced))
          .lineLimit(6)
      }
      if request.answeredInApp {
        Text(L("Answer this on your iPhone.", "请在 iPhone 上回答。"))
          .font(.footnote)
          .foregroundStyle(.secondary)
      } else {
        Button(L("Allow", "允许")) { answer(.allow) }
          .tint(.green)
        Button(L("Allow for This Session", "本次会话总是允许")) { answer(.allowForSession) }
        Button(L("Deny", "拒绝"), role: .destructive) { answer(.deny) }
        if failed {
          Text(L("Couldn't reach the session.", "无法连接到会话。"))
            .font(.footnote)
            .foregroundStyle(.red)
        }
      }
    }
    .disabled(busy)
    .buttonStyle(.bordered)
    .padding(.vertical, 4)
  }
}

private struct MessageRow: View {
  let message: HappyMessage
  let agent: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(message.role == .user ? L("You", "你") : agent)
        .font(.caption2)
        .lineLimit(1)
        .foregroundStyle(message.role == .user ? Color.accentColor : .secondary)
      Text(PlainText.from(markdown: message.text))
        .font(.footnote)
        .lineLimit(12)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
  }
}
