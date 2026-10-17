import Foundation

public enum HappyError: Error {
  case notSignedIn
  case encryption
  case http(Int)
  case rpc(String)
  case badResponse
}

/// A session as the watch lists it
public struct HappySession: Identifiable, Hashable {
  public enum Status {
    /// The agent waits for a permission to be answered
    case needsApproval
    /// The agent is working on a turn
    case thinking
    /// The turn is over; the agent waits for the next message
    case waiting
  }

  public let id: String
  public let title: String
  /// The host and folder the session runs in
  public let detail: String
  public let flavor: String?
  /// The model the agent runs, as the session's metadata names it, and its reasoning effort
  public let model: String?
  public let reasoningEffort: String?
  /// What the app draws the session's avatar from: the machine and folder, or the session alone
  public let avatarId: String
  /// A preset key, an image URL or an emoji the session is marked with
  public let sessionIcon: String?
  public let thinking: Bool
  public let activeAt: Date
  /// When the conversation last moved, or when the session was created before its first message;
  /// what the app orders its list by
  public let lastMessageAt: Date
  public let requests: [HappyPermissionRequest]

  public var status: Status {
    if !requests.isEmpty { return .needsApproval }
    return thinking ? .thinking : .waiting
  }

  var isCodex: Bool { flavor == "codex" }

  /// The agent's name, as the app's session card gives it
  public var agentName: String {
    switch flavor {
    case nil, "claude": return "Claude"
    case "codex", "gpt", "openai": return "Codex"
    case "gemini": return "Gemini"
    case "qoder": return "Qoder"
    case let other?: return other
    }
  }
}

/// A permission the agent waits on (`agentState.requests`)
public struct HappyPermissionRequest: Identifiable, Hashable {
  public let id: String
  public let tool: String
  /// The command, file or other input the permission is for, short enough for a notification
  public let summary: String
  /// Questions and plans are answered in the app, which shows them in full
  public var answeredInApp: Bool { HappyPermissionRequest.toolsAnsweredInApp.contains(tool) }
  let shellCommand: String?
  let createdAt: Double

  static let toolsAnsweredInApp: Set<String> = ["AskUserQuestion", "ExitPlanMode", "exit_plan_mode"]
  static let shellTools: Set<String> = ["Bash", "execute"]

  init(id: String, record: [String: Any]) {
    self.id = id
    let tool = record["tool"] as? String ?? "?"
    self.tool = tool
    let arguments = record["arguments"] as? [String: Any] ?? [:]
    let command = HappyPermissionRequest.shellCommandOf(arguments)
    shellCommand = HappyPermissionRequest.shellTools.contains(tool) ? command : nil
    summary = command
      ?? (arguments["file_path"] as? String)
      ?? (arguments["path"] as? String)
      ?? (arguments["url"] as? String)
      ?? (arguments["description"] as? String)
      ?? ""
    createdAt = record["createdAt"] as? Double ?? 0
  }

  /// `shellCommandOf` from happy-wire: the command as one line, from a string, an argv, or the title
  /// ACP agents give a tool call
  static func shellCommandOf(_ input: [String: Any]) -> String? {
    var line = ""
    if let parts = input["command"] as? [Any] {
      line = parts.compactMap { $0 as? String }.joined(separator: " ")
    } else if let command = input["command"] as? String {
      line = command
    } else if let title = (input["toolCall"] as? [String: Any])?["title"] as? String {
      line = title.components(separatedBy: " [").first ?? ""
    }
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

/// A message of a session's transcript, as text
public struct HappyMessage: Identifiable, Hashable {
  public enum Role { case user, agent }

  public let id: String
  public let seq: Int
  public let role: Role
  public let text: String
  public let createdAt: Date

  /// The text of a decrypted raw record, for the records that carry text: what the user sent and
  /// the agent's replies, in the formats the CLIs write them in. Tool calls, results and events are
  /// left to the app.
  static func text(ofRecord record: [String: Any]) -> (Role, String)? {
    guard let role = record["role"] as? String, let content = record["content"] as? [String: Any] else { return nil }
    switch role {
    case "user":
      guard let text = content["text"] as? String else { return nil }
      return (.user, text)
    case "agent":
      return agentText(content).map { (.agent, $0) }
    case "session":
      guard let envelope = content["data"] as? [String: Any] else { return nil }
      return envelopeText(envelope)
    default:
      return nil
    }
  }

  private static func agentText(_ content: [String: Any]) -> String? {
    let data = content["data"] as? [String: Any] ?? [:]
    switch content["type"] as? String {
    case "output":
      guard data["type"] as? String == "assistant",
            let items = (data["message"] as? [String: Any])?["content"] as? [[String: Any]] else { return nil }
      let text = items
        .filter { $0["type"] as? String == "text" }
        .compactMap { $0["text"] as? String }
        .joined(separator: "\n")
      return text.isEmpty ? nil : text
    case "codex", "acp":
      guard data["type"] as? String == "message" else { return nil }
      return data["message"] as? String
    case "session":
      return envelopeText(data).map { $0.1 }
    default:
      return nil
    }
  }

  private static func envelopeText(_ envelope: [String: Any]) -> (Role, String)? {
    guard let ev = envelope["ev"] as? [String: Any], ev["t"] as? String == "text",
          let text = ev["text"] as? String else { return nil }
    return (envelope["role"] as? String == "user" ? .user : .agent, text)
  }
}

/// The answers the watch and the notifications give a permission
public enum HappyPermissionAnswer {
  case allow
  /// Don't ask again in this session: the command for a shell tool, the tool otherwise
  case allowForSession
  case deny
}
