import ExpoModulesCore
import UIKit

/**
 * A long press on the wrapped view lifts it and opens a system context menu
 * (`UIContextMenuInteraction`), the way iOS shows the actions of a row. React Native only has the
 * long-press gesture, so its menus were bottom sheets; this view is the native one.
 *
 * The menu is described from JavaScript as plain data (`menu`): actions and groups of them, which
 * can be inline sections or a palette (a row of swatches). Choosing an action sends its `id` back
 * through `onSelectAction`, once the menu has finished closing, so what the action presents next
 * (a confirmation, a sheet) is not presented while the menu is still on screen.
 */
public class HappyContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappyContextMenu")

    View(HappyContextMenuView.self) {
      Events("onSelectAction")

      Prop("menu") { (view: HappyContextMenuView, menu: [String: Any]?) in
        view.menu = menu
      }

      Prop("previewCornerRadii") { (view: HappyContextMenuView, radii: [String: Double]?) in
        view.previewCornerRadii = radii ?? [:]
      }
    }
  }
}

public final class HappyContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onSelectAction = EventDispatcher()

  var menu: [String: Any]? {
    didSet { updateInteraction() }
  }

  /// The corners of the lifted preview: `topLeft`, `topRight`, `bottomLeft`, `bottomRight`.
  var previewCornerRadii: [String: Double] = [:]

  private var interaction: UIContextMenuInteraction?
  private var menuShown = false
  private var pendingActionId: String?

  private var items: [[String: Any]] {
    (menu?["items"] as? [[String: Any]]) ?? []
  }

  private func updateInteraction() {
    if !items.isEmpty && interaction == nil {
      let newInteraction = UIContextMenuInteraction(delegate: self)
      addInteraction(newInteraction)
      interaction = newInteraction
    } else if items.isEmpty, let oldInteraction = interaction {
      removeInteraction(oldInteraction)
      interaction = nil
    }
  }

  // MARK: - UIContextMenuInteractionDelegate

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    let specs = items
    guard !specs.isEmpty else { return nil }
    let title = (menu?["title"] as? String) ?? ""
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      guard let self else { return nil }
      return UIMenu(title: title, children: specs.compactMap { self.element(from: $0) })
    }
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    menuShown = true
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    guard let animator else {
      menuShown = false
      flushPendingAction()
      return
    }
    animator.addCompletion { [weak self] in
      self?.menuShown = false
      self?.flushPendingAction()
    }
  }

  // MARK: - Actions

  // Depending on the iOS version the action's handler runs before or after the menu has closed;
  // either way the event goes out once it has.
  private func select(_ id: String) {
    pendingActionId = id
    if !menuShown {
      flushPendingAction()
    }
  }

  private func flushPendingAction() {
    guard let id = pendingActionId else { return }
    pendingActionId = nil
    onSelectAction(["id": id])
  }

  // MARK: - Building the menu

  private func element(from spec: [String: Any]) -> UIMenuElement? {
    let title = (spec["title"] as? String) ?? ""
    let image = image(for: spec)

    if (spec["type"] as? String) == "group" {
      let children = ((spec["children"] as? [[String: Any]]) ?? []).compactMap { element(from: $0) }
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
    let action = UIAction(title: title, image: image) { [weak self] _ in
      self?.select(id)
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
  private func image(for spec: [String: Any]) -> UIImage? {
    guard let name = spec["systemImage"] as? String, let symbol = UIImage(systemName: name) else {
      return nil
    }
    if let hex = spec["imageColor"] as? String, let color = color(fromHex: hex) {
      return symbol.withTintColor(color, renderingMode: .alwaysOriginal)
    }
    return symbol
  }

  private func color(fromHex hex: String) -> UIColor? {
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

  // MARK: - Preview

  /// The view itself, lifted, clipped to the row's own corners. The system backdrop behind it
  /// stays, for a row that draws no background of its own.
  private func targetedPreview() -> UITargetedPreview? {
    guard window != nil else { return nil }
    let parameters = UIPreviewParameters()
    parameters.visiblePath = roundedPath(in: bounds)
    return UITargetedPreview(view: self, parameters: parameters)
  }

  private func roundedPath(in rect: CGRect) -> UIBezierPath {
    let limit = min(rect.width, rect.height) / 2
    func radius(_ key: String) -> CGFloat {
      min(CGFloat(previewCornerRadii[key] ?? 0), limit)
    }
    let topLeft = radius("topLeft")
    let topRight = radius("topRight")
    let bottomLeft = radius("bottomLeft")
    let bottomRight = radius("bottomRight")

    let path = UIBezierPath()
    path.move(to: CGPoint(x: rect.minX + topLeft, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX - topRight, y: rect.minY))
    path.addArc(
      withCenter: CGPoint(x: rect.maxX - topRight, y: rect.minY + topRight),
      radius: topRight, startAngle: -.pi / 2, endAngle: 0, clockwise: true)
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomRight))
    path.addArc(
      withCenter: CGPoint(x: rect.maxX - bottomRight, y: rect.maxY - bottomRight),
      radius: bottomRight, startAngle: 0, endAngle: .pi / 2, clockwise: true)
    path.addLine(to: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY))
    path.addArc(
      withCenter: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY - bottomLeft),
      radius: bottomLeft, startAngle: .pi / 2, endAngle: .pi, clockwise: true)
    path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeft))
    path.addArc(
      withCenter: CGPoint(x: rect.minX + topLeft, y: rect.minY + topLeft),
      radius: topLeft, startAngle: .pi, endAngle: 3 * .pi / 2, clockwise: true)
    path.close()
    return path
  }
}
