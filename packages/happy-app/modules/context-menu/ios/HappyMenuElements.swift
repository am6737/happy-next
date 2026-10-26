import UIKit

/**
 * The menus' rows, described from JavaScript as plain data: actions (`id`, `title`, an SF Symbol
 * `systemImage` and its `imageColor`, `destructive`, `disabled`, `checked`) and groups of them
 * (`type: "group"` with `children`), which can be inline sections or a palette (a row of swatches).
 * Choosing an action calls `select` with its `id`.
 */
enum HappyMenuElements {
  static func element(from spec: [String: Any], select: @escaping (String) -> Void) -> UIMenuElement? {
    let title = (spec["title"] as? String) ?? ""
    let image = image(for: spec)

    if (spec["type"] as? String) == "group" {
      let children = ((spec["children"] as? [[String: Any]]) ?? []).compactMap {
        element(from: $0, select: select)
      }
      guard !children.isEmpty else { return nil }
      var options: UIMenu.Options = []
      if (spec["inline"] as? Bool) == true {
        options.insert(.displayInline)
      }
      if (spec["palette"] as? Bool) == true {
        if #available(iOS 17.0, *) {
          options.insert(.displayAsPalette)
        }
      }
      return UIMenu(title: title, image: image, options: options, children: children)
    }

    guard let id = spec["id"] as? String else { return nil }
    let action = UIAction(title: title, image: image) { _ in
      select(id)
    }
    var attributes: UIMenuElement.Attributes = []
    if (spec["destructive"] as? Bool) == true {
      attributes.insert(.destructive)
    }
    if (spec["disabled"] as? Bool) == true {
      attributes.insert(.disabled)
    }
    action.attributes = attributes
    action.state = (spec["checked"] as? Bool) == true ? .on : .off
    return action
  }

  /// An SF Symbol, drawn in `imageColor` when one is given (a palette swatch keeps its colour).
  private static func image(for spec: [String: Any]) -> UIImage? {
    guard let name = spec["systemImage"] as? String, let symbol = UIImage(systemName: name) else {
      return nil
    }
    if let hex = spec["imageColor"] as? String, let color = color(fromHex: hex) {
      return symbol.withTintColor(color, renderingMode: .alwaysOriginal)
    }
    return symbol
  }

  private static func color(fromHex hex: String) -> UIColor? {
    var digits = hex.trimmingCharacters(in: .whitespaces)
    if digits.hasPrefix("#") {
      digits.removeFirst()
    }
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}
