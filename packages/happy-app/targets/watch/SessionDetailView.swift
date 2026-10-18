import SwiftUI
import WatchKit

/// A session: its latest messages, then the permissions it waits on or a reply, and stopping its turn
struct SessionDetailView: View {
  /// The latest records, read again every few seconds
  private static let latestPageSize = 40
  /// The records read at a time going back
  private static let earlierPageSize = 100
  /// The messages a load looks for, going back until it finds as many: a turn of tool calls can
  /// leave a page without one
  private static let messagesPerLoad = 10
  /// The pages one load reads at most, and the records a session reads in all, so a long session
  /// stays light
  private static let pagesPerLoad = 4
  private static let maxRecords = 1000

  let sessionId: String
  @EnvironmentObject private var store: WatchStore
  /// The text messages of the records read, oldest first: the latest page, read again as it
  /// changes, after the pages read before it
  @State private var records: [HappyMessage] = []
  /// Where the records read begin, whether the session has records before that, and how many were read
  @State private var oldestSeq: Int?
  @State private var hasEarlier = false
  @State private var recordsRead = 0
  @State private var loadingEarlier = false
  @State private var openMessage: HappyMessage?
  /// Where the rows sit on screen, kept as they move without drawing the view again
  @State private var rowFrames = RowFrames()
  /// The message to hold where it was on screen as earlier ones go in above it
  @State private var holdInPlace: RowFrames.Hold?
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
        if !loaded {
          HStack(spacing: 8) {
            ProgressView().frame(width: 16, height: 16)
            Text(L("Loading…", "加载中…"))
              .foregroundStyle(.secondary)
          }
          .listRowBackground(Color.clear)
        }

        if loaded, hasEarlier {
          if recordsRead < Self.maxRecords {
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
          // Not a button: watchOS draws a button row's platter over the row's own background
          MessageRow(message: message, agent: agentLabel)
            .onTapGesture { openMessage = message }
            .onLongPressGesture { openMessage = message }
            .listRowBackground(
              RoundedRectangle(cornerRadius: 10)
                .fill(message.role == .user ? MessageStyle.userBackground : Color.gray.opacity(0.18))
            )
          .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { rowFrames.rows[message.id] = $0 }
          .id(message.id)
        }

        // A permission waiting takes the reply's place, at the end where the session opens
        if let requests = session?.requests, !requests.isEmpty {
          ForEach(requests) { request in
            PermissionCard(request: request, busy: busy, failed: failedRequestId == request.id) { answer in
              run(for: request.id) { try await $0.answer(answer, request: request, sessionId: sessionId) }
            }
            .id(request.id)
          }
        } else {
          TextField(L("Reply", "回复"), text: $draft)
            .onSubmit(send)
            .disabled(busy)
            .id("reply")
        }

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
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { rowFrames.viewport = $0 }
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
      .onChange(of: messages.last?.id) { scrollToEnd(proxy) }
      .onChange(of: session?.requests.first?.id) { scrollToEnd(proxy) }
      .onChange(of: records.count) {
        guard let hold = holdInPlace else { return }
        holdInPlace = nil
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { proxy.scrollTo(hold.id, anchor: hold.anchor) }
      }
    }
  }

  /// Where the session opens and follows: the first permission waiting, its top so its tool and
  /// command show first, or else the end of the last message
  private func scrollToEnd(_ proxy: ScrollViewProxy) {
    if let request = session?.requests.first {
      proxy.scrollTo(request.id, anchor: .top)
    } else if let last = messages.last {
      proxy.scrollTo(last.id, anchor: .bottom)
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

  /// Reads the latest page again, keeping the records read before it; the first time, goes back
  /// till there are messages enough to show
  private func loadMessages() async {
    guard let client = store.client else { return }
    defer { loaded = true }
    guard let latest = try? await client.messages(sessionId: sessionId, limit: Self.latestPageSize) else { return }
    if !loaded {
      var earlier = Earlier(oldestSeq: latest.oldestSeq, hasMore: latest.hasMore, recordsRead: latest.recordCount)
      let shown = HappyMessage.turns(latest.messages).count
      await earlier.read(client: client, sessionId: sessionId, above: latest.messages, adding: Self.messagesPerLoad - shown)
      records = earlier.messages + latest.messages
      oldestSeq = earlier.oldestSeq
      hasEarlier = earlier.hasMore
      recordsRead = earlier.recordsRead
      return
    }
    let start = latest.oldestSeq ?? Int.max
    let merged = records.filter { $0.seq < start } + latest.messages
    if merged != records { records = merged }
  }

  /// Reads back till it finds messages enough, then puts them in at once above the list, holding
  /// the message at the top of the screen where it is just then, wherever it was scrolled to meanwhile
  private func loadEarlier() {
    guard let client = store.client, !loadingEarlier else { return }
    loadingEarlier = true
    Task {
      defer { loadingEarlier = false }
      var earlier = Earlier(oldestSeq: oldestSeq, hasMore: hasEarlier, recordsRead: recordsRead)
      await earlier.read(client: client, sessionId: sessionId, above: records, adding: Self.messagesPerLoad)
      guard !earlier.messages.isEmpty || !earlier.failed else {
        WKInterfaceDevice.current().play(.failure)
        return
      }
      let known = Set(records.map(\.id))
      holdInPlace = rowFrames.topVisible(among: messages.map(\.id))
      records = earlier.messages.filter { !known.contains($0.id) } + records
      oldestSeq = earlier.oldestSeq
      hasEarlier = earlier.hasMore
      recordsRead = earlier.recordsRead
    }
  }

  /// A load of earlier records: page after page back from `oldestSeq`, till the messages it found
  /// add `adding` to those shown after them (the first load: till there are `messagesPerLoad` in
  /// all), or it reaches the start, a load's pages or the session's records
  private struct Earlier {
    var oldestSeq: Int?
    var hasMore: Bool
    var recordsRead: Int
    var messages: [HappyMessage] = []
    var failed = false

    mutating func read(client: HappyClient, sessionId: String, above later: [HappyMessage], adding: Int) async {
      let shownBefore = HappyMessage.turns(later).count
      var pages = 0
      while hasMore, let before = oldestSeq, pages < SessionDetailView.pagesPerLoad,
            recordsRead < SessionDetailView.maxRecords,
            HappyMessage.turns(messages + later).count - shownBefore < adding {
        guard let page = try? await client.messages(
          sessionId: sessionId, before: before, limit: SessionDetailView.earlierPageSize) else {
          failed = true
          return
        }
        messages = page.messages + messages
        oldestSeq = page.oldestSeq ?? before
        hasMore = page.hasMore && page.oldestSeq != nil
        recordsRead += page.recordCount
        pages += 1
      }
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
    .padding(.top, 4)
    .padding(.bottom, 12)
  }
}

private struct MessageRow: View {
  let message: HappyMessage
  let agent: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(message.role == .user ? L("Me", "我") : agent)
        .font(.caption2)
        .lineLimit(1)
        .foregroundStyle(.secondary)
      Text(PlainText.from(markdown: message.text))
        .font(.footnote)
        .lineLimit(4)
    }
    .padding(.vertical, 4)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
  }
}

/// Where the message rows and the list sit on screen. A class, so that keeping up with the scrolling
/// doesn't draw the view again.
final class RowFrames {
  var rows: [String: CGRect] = [:]
  var viewport: CGRect = .zero

  /// A row to scroll back to, and the anchor that puts it where it was
  struct Hold: Equatable {
    let id: String
    let anchor: UnitPoint
  }

  /// The highest row on screen, wholly shown if one is, and where it sits: `scrollTo` lines up the
  /// anchor's point of the row with the same point of the screen, so the row's top `d` below the
  /// screen's, with the row `h` tall on a screen `H` tall, is the anchor `d / (H - h)`
  func topVisible(among ids: [String]) -> Hold? {
    let shown = ids.compactMap { id -> (String, CGRect)? in
      guard let frame = rows[id], frame.maxY > viewport.minY, frame.minY < viewport.maxY else { return nil }
      return (id, frame)
    }
    let whole = shown.filter { $0.1.minY >= viewport.minY && $0.1.maxY <= viewport.maxY }
    guard let (id, frame) = (whole.isEmpty ? shown : whole).min(by: { $0.1.minY < $1.1.minY }) else { return nil }
    let room = viewport.height - frame.height
    guard room > 1 else { return Hold(id: id, anchor: .top) }
    let y = min(max((frame.minY - viewport.minY) / room, 0), 1)
    return Hold(id: id, anchor: UnitPoint(x: 0.5, y: y))
  }
}
