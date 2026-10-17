import SwiftUI

/// A session's avatar as the app draws it (AvatarBrutalist, dark): one of its images picked by the
/// hash of the session's machine and folder, tinted on a background of a colour pair picked the
/// same way, with the session's own icon as a badge
struct SessionAvatar: View {
  let session: HappySession
  let size: CGFloat

  private static let imageCount = 422
  private static let colorPairs: [(tint: Color, background: Color)] = [
    (Color(hex: 0x22D3EE), Color(hex: 0x022C22)),
    (Color(hex: 0xA3E635), Color(hex: 0x581C87)),
    (Color(hex: 0xFB7185), Color(hex: 0x1F2937)),
    (Color(hex: 0xFDE047), Color(hex: 0x312E81)),
    (Color(hex: 0x38BDF8), Color(hex: 0x020617)),
    (Color(hex: 0xC084FC), Color(hex: 0x3B0764)),
  ]

  var body: some View {
    let colors = Self.colorPairs[Self.hashCode(session.avatarId + "color") % Self.colorPairs.count]
    ZStack(alignment: .bottomTrailing) {
      Circle()
        .fill(colors.background)
        .overlay {
          Image("avatar-\(Self.hashCode(session.avatarId) % Self.imageCount)")
            .resizable()
            .renderingMode(.template)
            .foregroundStyle(colors.tint)
            .scaledToFit()
            .clipShape(Circle())
            .padding(size * 0.1)
        }
        .frame(width: size, height: size)
      if let icon = session.sessionIcon {
        SessionIconBadge(icon: icon, size: size * 0.5)
          .offset(x: size * 0.1, y: size * 0.1)
      }
    }
  }

  /// `hashCode` from the app: Java's string hash over UTF-16 units in 32 bits, made positive
  static func hashCode(_ string: String) -> Int {
    var hash: Int32 = 0
    for unit in string.utf16 {
      hash = (hash &<< 5) &- hash &+ Int32(unit)
    }
    return Int(hash.magnitude)
  }
}

/// The session's icon: a preset the app ships, an image URL, or an emoji
private struct SessionIconBadge: View {
  let icon: String
  let size: CGFloat

  var body: some View {
    content
      .frame(width: size, height: size)
      .clipShape(Circle())
      .background(Circle().fill(.black).padding(-1))
  }

  @ViewBuilder private var content: some View {
    if icon.hasPrefix("http://") || icon.hasPrefix("https://"), let url = URL(string: icon) {
      AsyncImage(url: url) { image in
        image.resizable().scaledToFill()
      } placeholder: {
        Color.gray
      }
    } else if ["dootask", "github"].contains(icon) {
      Image("session-\(icon)").resizable().scaledToFill()
    } else {
      Text(icon).font(.system(size: size * 0.75))
    }
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

/// Model names from happy-wire's catalog (bundled as `modelCatalog.json`), the way the app turns a
/// model id into a label (`formatModelNameLabel`), shortened for the watch: the catalog's `label`
/// ("Opus 5.5", "GPT-5.5"), which leaves the vendor to the agent's name beside it
enum ModelLabels {
  private static let labels: [String: String] = {
    guard let url = Bundle.main.url(forResource: "modelCatalog", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let models = json["models"] as? [[String: Any]] else { return [:] }
    var labels: [String: String] = [:]
    for model in models {
      if let id = model["id"] as? String, let label = model["label"] as? String {
        labels[id] = label
      }
    }
    return labels
  }()

  private static let efforts = [
    "low": "Low", "medium": "Medium", "high": "High", "max": "Max", "xhigh": "XHigh", "ultra": "Ultra", "none": "None",
  ]

  /// "Opus 5.5 (High)": the model by its catalog label, else as given, with its reasoning effort
  static func label(model: String?, reasoningEffort: String?) -> String? {
    guard let model, !model.isEmpty else { return nil }
    let name = catalogLabel(model) ?? model
    guard let effort = reasoningEffort, !effort.isEmpty else { return name }
    return "\(name) (\(efforts[effort] ?? effort))"
  }

  /// The id as given, then without the context and date suffixes (`normalizeModelId`), then
  /// without a mode's effort suffix (`claude-opus-5-high`)
  private static func catalogLabel(_ model: String) -> String? {
    if let label = labels[model] { return label }
    var id = model.replacingOccurrences(of: "[1m]", with: "")
    for pattern in [#"-\d{8}$"#, #"-\d{4}-\d{2}-\d{2}$"#, #"-fast$"#] {
      id = id.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
    }
    if let label = labels[id] { return label }
    let family = id.replacingOccurrences(of: #"-(low|medium|high|xhigh|max|ultra|none)$"#, with: "", options: .regularExpression)
    return labels[family]
  }
}
