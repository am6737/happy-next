import SwiftUI
import WatchKit

/// A session: the permissions it waits on, its latest messages, a reply, and stopping its turn
struct SessionDetailView: View {
  let sessionId: String
  @EnvironmentObject private var store: WatchStore
  @State private var messages: [HappyMessage] = []
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

        ForEach(messages.suffix(20)) { message in
          MessageRow(message: message)
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

  private func loadMessages() async {
    guard let client = store.client,
          let latest = try? await client.messages(sessionId: sessionId) else { return }
    if latest != messages { messages = latest }
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

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(message.role == .user ? L("You", "你") : L("Agent", "助手"))
        .font(.caption2)
        .foregroundStyle(message.role == .user ? Color.accentColor : .secondary)
      Text(message.text)
        .font(.footnote)
        .lineLimit(12)
    }
    .listRowBackground(
      RoundedRectangle(cornerRadius: 10)
        .fill(message.role == .user ? Color.accentColor.opacity(0.18) : Color.gray.opacity(0.18))
    )
  }
}
