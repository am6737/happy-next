import SwiftUI

/// A message's Markdown as plain text for the watch: the marks taken off and what they marked kept —
/// headings, emphasis, code, links and images by their text, lists by a bullet, tables by their cells
enum PlainText {
  static func from(markdown: String) -> String {
    var lines: [String] = []
    var inFence = false
    for line in markdown.components(separatedBy: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
        inFence.toggle()
        continue
      }
      if inFence {
        lines.append(line)
        continue
      }
      if matches(trimmed, #"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$"#) || matches(trimmed, #"^([-*_])(\s*\1){2,}$"#) {
        continue
      }
      lines.append(inline(block(line)))
    }
    return lines.joined(separator: "\n")
      .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// A line's own marks: a heading's, a quote's, a list item's, a table row's
  private static func block(_ line: String) -> String {
    var line = line
      .replacingOccurrences(of: #"^\s{0,3}#{1,6}\s+"#, with: "", options: .regularExpression)
      .replacingOccurrences(of: #"^\s*(>\s?)+"#, with: "", options: .regularExpression)
      .replacingOccurrences(of: #"^(\s*)[-*+]\s+\[[xX]\]\s+"#, with: "$1☑ ", options: .regularExpression)
      .replacingOccurrences(of: #"^(\s*)[-*+]\s+\[ \]\s+"#, with: "$1☐ ", options: .regularExpression)
      .replacingOccurrences(of: #"^(\s*)[-*+]\s+"#, with: "$1• ", options: .regularExpression)
    if line.trimmingCharacters(in: .whitespaces).hasPrefix("|") {
      line = line
        .trimmingCharacters(in: .whitespaces)
        .replacingOccurrences(of: #"^\||\|$"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: #"\s*\|\s*"#, with: "  ", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
    }
    return line
  }

  /// The marks within a line: images and links by their text, code, emphasis, struck text
  private static func inline(_ line: String) -> String {
    [
      (#"!\[([^\]]*)\]\([^)]*\)"#, "$1"),
      (#"\[([^\]]+)\]\([^)]*\)"#, "$1"),
      (#"<(https?://[^>\s]+)>"#, "$1"),
      (#"`([^`]+)`"#, "$1"),
      (#"\*\*(.+?)\*\*"#, "$1"),
      (#"__(.+?)__"#, "$1"),
      (#"(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])"#, "$1"),
      (#"(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])"#, "$1"),
      (#"~~(.+?)~~"#, "$1"),
    ].reduce(line) { text, rule in
      text.replacingOccurrences(of: rule.0, with: rule.1, options: .regularExpression)
    }
  }

  private static func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
  }
}

/// How the user's own messages stand apart from the agent's
enum MessageStyle {
  static let userBackground = Color(hex: 0x2B3A4C)
}

/// A message in full, opened from the session where its row shows only its first lines
struct MessageDetailView: View {
  let message: HappyMessage
  let agent: String

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        Text(message.role == .user ? L("Me", "我") : agent)
          .font(.caption2)
          .foregroundStyle(.secondary)
        Text(PlainText.from(markdown: message.text))
          .font(.footnote)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
}
