import Foundation

/// Talks to the server over HTTP, the way the app does over its socket: lists the active sessions,
/// reads and sends messages, and answers permissions and aborts turns through `/v1/rpc`
public actor HappyClient {
  public nonisolated let credentials: HappyCredentials
  private let keys: HappyAccountKeys
  private let urlSession: URLSession
  private var ciphers: [String: SessionCipher] = [:]
  private var flavors: [String: String] = [:]

  public init?(credentials: HappyCredentials, urlSession: URLSession = .shared) {
    guard let keys = HappyAccountKeys(secret: credentials.secret) else { return nil }
    self.credentials = credentials
    self.keys = keys
    self.urlSession = urlSession
  }

  // MARK: Sessions

  /// The sessions active in the last 15 minutes, with the pins the app put on them if asked
  public func activeSessions(withPins: Bool = false) async throws -> [HappySession] {
    async let pins = withPins ? sessionPins() : [:]
    let response = try await request("GET", "/v2/sessions/active?limit=50")
    guard let list = response["sessions"] as? [[String: Any]] else { throw HappyError.badResponse }
    let sessions = list.compactMap(session)
    let pinnedAt = await pins
    return sessions.map { session in
      var session = session
      session.pinnedAt = pinnedAt[session.id]
      return session
    }
  }

  /// The sessions pinned in the app (`session-appearance:v1` in the account's key-value store, base64
  /// JSON with each session's marks), by when each was pinned; none when they can't be read
  private func sessionPins() async -> [String: Date] {
    guard let response = try? await request("GET", "/v1/kv/session-appearance:v1"),
          let value = response["value"] as? String,
          let data = Data(base64Encoded: value),
          let document = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let sessions = document["sessions"] as? [String: Any] else { return [:] }
    return sessions.compactMapValues { entry in
      ((entry as? [String: Any])?["pinnedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
    }
  }

  public func session(id: String) async throws -> HappySession? {
    try await activeSessions().first { $0.id == id }
  }

  private func session(_ json: [String: Any]) -> HappySession? {
    guard let id = json["id"] as? String,
          let cipher = keys.sessionCipher(dataEncryptionKey: json["dataEncryptionKey"] as? String) else { return nil }
    ciphers[id] = cipher

    let metadata = (json["metadata"] as? String).flatMap { cipher.decrypt(base64: $0) } as? [String: Any] ?? [:]
    let agentState = (json["agentState"] as? String).flatMap { cipher.decrypt(base64: $0) } as? [String: Any] ?? [:]
    let flavor = metadata["flavor"] as? String
    flavors[id] = flavor

    let path = metadata["path"] as? String ?? ""
    let folder = path.split(separator: "/").last.map(String.init) ?? ""
    let title = ((metadata["summary"] as? [String: Any])?["text"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? (metadata["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? (folder.isEmpty ? id : folder)
    let host = metadata["host"] as? String ?? ""
    let detail = [host, folder].filter { !$0.isEmpty }.joined(separator: " · ")

    let requests = (agentState["requests"] as? [String: Any] ?? [:])
      .compactMap { key, value in (value as? [String: Any]).map { HappyPermissionRequest(id: key, record: $0) } }
      .sorted { $0.createdAt < $1.createdAt }

    // `agentModelName`: an ACP agent names its model by a code its `models` list spells out. Qoder
    // gives only the code it runs (`currentModelCode`), and its reasoning as a thought level.
    func name(_ code: String?, in list: String) -> String? {
      (metadata[list] as? [[String: Any]])?.first { $0["code"] as? String == code }?["value"] as? String ?? code
    }
    let model = name(metadata["model"] as? String ?? metadata["currentModelCode"] as? String, in: "models")?
      .replacingOccurrences(of: " (default)", with: "")
    let reasoningEffort = metadata["reasoningEffort"] as? String ?? metadata["currentThoughtLevelCode"] as? String
    let machineId = metadata["machineId"] as? String ?? ""
    let avatarId = !machineId.isEmpty && !path.isEmpty ? "\(machineId):\(path)" : id

    func date(_ key: String) -> Date? {
      (json[key] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
    }
    let activeAt = date("activeAt") ?? Date()
    return HappySession(
      id: id,
      title: title,
      detail: detail,
      flavor: flavor,
      model: model,
      reasoningEffort: reasoningEffort,
      avatarId: avatarId,
      sessionIcon: (metadata["sessionIcon"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      thinking: json["thinking"] as? Bool ?? false,
      activeAt: activeAt,
      lastMessageAt: date("lastMessageAt") ?? date("createdAt") ?? activeAt,
      requests: requests
    )
  }

  // MARK: Messages

  /// A page of a session's messages that carry text, oldest first: the last `limit` records, or
  /// those before the record `before`
  public func messages(sessionId: String, before: Int? = nil, limit: Int = 40) async throws -> HappyMessagePage {
    let cipher = try await cipher(for: sessionId)
    let cursor = before.map { "&before=\($0)" } ?? ""
    let response = try await request("GET", "/v1/sessions/\(sessionId)/messages?limit=\(limit)\(cursor)")
    guard let list = response["messages"] as? [[String: Any]] else { throw HappyError.badResponse }
    let messages = list.compactMap { json -> HappyMessage? in
      guard let id = json["id"] as? String,
            let content = json["content"] as? [String: Any],
            content["t"] as? String == "encrypted",
            let sealed = content["c"] as? String,
            let record = cipher.decrypt(base64: sealed) as? [String: Any],
            let entry = HappyMessage.text(ofRecord: record) else { return nil }
      let trimmed = entry.1.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return nil }
      return HappyMessage(
        id: id,
        seq: json["seq"] as? Int ?? 0,
        role: entry.0,
        text: trimmed,
        createdAt: Date(timeIntervalSince1970: (json["createdAt"] as? Double ?? 0) / 1000)
      )
    }
    .sorted { $0.seq < $1.seq }
    return HappyMessagePage(
      messages: messages,
      recordCount: list.count,
      oldestSeq: list.compactMap { $0["seq"] as? Int }.min(),
      hasMore: response["hasMore"] as? Bool ?? (list.count == limit)
    )
  }

  /// Sends a message as the user, in the mode and with the model the session is already in
  public func send(text: String, sessionId: String) async throws {
    let cipher = try await cipher(for: sessionId)
    let record: [String: Any] = [
      "role": "user",
      "content": ["type": "text", "text": text],
      "meta": ["sentFrom": "watch"],
    ]
    let body: [String: Any] = [
      "messages": [[
        "content": try cipher.encrypt(record),
        "localId": UUID().uuidString.lowercased(),
        "trackCliDelivery": true,
      ]],
    ]
    _ = try await request("POST", "/v3/sessions/\(sessionId)/messages", body: body)
  }

  // MARK: Permissions

  public func answer(_ answer: HappyPermissionAnswer, request permission: HappyPermissionRequest, sessionId: String) async throws {
    let isCodex = flavors[sessionId] == "codex" || permission.tool.hasPrefix("Codex")
    var params: [String: Any] = ["id": permission.id]
    switch answer {
    case .allow:
      params["approved"] = true
      if isCodex { params["decision"] = "approved" }
    case .allowForSession:
      params["approved"] = true
      params["decision"] = "approved_for_session"
      if !isCodex {
        // The CLI keeps the rule for the rest of the session: the command for a shell tool, the tool otherwise
        params["allowTools"] = [permission.shellCommand.map { "Bash(\($0))" } ?? permission.tool]
      }
    case .deny:
      params["approved"] = false
    }
    _ = try await rpc(sessionId: sessionId, method: "permission", params: params)
  }

  /// Answers a permission known only by its id (from a notification), reading it from the session
  public func answer(_ answer: HappyPermissionAnswer, requestId: String, sessionId: String) async throws {
    guard let permission = try await session(id: sessionId)?.requests.first(where: { $0.id == requestId }) else {
      // Already answered elsewhere, or the session is gone
      return
    }
    try await self.answer(answer, request: permission, sessionId: sessionId)
  }

  /// Stops the agent's turn, the way the app's stop button does
  public func abort(sessionId: String) async throws {
    _ = try await rpc(sessionId: sessionId, method: "abort", params: [
      "reason": "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
    ])
  }

  private func rpc(sessionId: String, method: String, params: [String: Any]) async throws -> Any? {
    let cipher = try await cipher(for: sessionId)
    let response = try await request("POST", "/v1/rpc", body: [
      "method": "\(sessionId):\(method)",
      "params": try cipher.encrypt(params),
    ])
    guard response["ok"] as? Bool == true else {
      throw HappyError.rpc(response["error"] as? String ?? "RPC failed")
    }
    return (response["result"] as? String).flatMap { cipher.decrypt(base64: $0) }
  }

  private func cipher(for sessionId: String) async throws -> SessionCipher {
    if let cipher = ciphers[sessionId] { return cipher }
    _ = try await activeSessions()
    guard let cipher = ciphers[sessionId] else { throw HappyError.encryption }
    return cipher
  }

  // MARK: HTTP

  private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
    let base = credentials.serverUrl.hasSuffix("/") ? String(credentials.serverUrl.dropLast()) : credentials.serverUrl
    guard let url = URL(string: base + path) else { throw HappyError.badResponse }
    var request = URLRequest(url: url, timeoutInterval: 25)
    request.httpMethod = method
    request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await urlSession.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw HappyError.http(status) }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  }
}
