import ExpoModulesCore
import UIKit

/**
 * A long press on the wrapped view lifts it and opens a system context menu
 * (`UIContextMenuInteraction`), the way iOS shows the actions of a row. React Native only has the
 * long-press gesture, so its menus were bottom sheets; this view is the native one.
 *
 * The menu is described from JavaScript as plain data (`menu`): actions and groups of them, which
 * can be inline sections or a palette (a row of swatches). Choosing an action sends its `id` back
 * through `onSelectAction` as soon as the menu starts closing, so what the action presents next
 * (a confirmation, a sheet) comes up while the menu fades out, as in the system's own apps, rather
 * than after the whole dismissal animation.
 *
 * With a `dragId` the view can also be dragged, the way a lifted item is in the system's own apps:
 * moving the finger once the menu is up closes it and carries a copy of the view, which a
 * `HappyDropZone` around it follows (see there). `onDragBegin` and `onDragEnd` bracket the drag;
 * the end comes as the finger lifts, and the copy then flies back onto the view wherever it is by
 * then, so content that moves the view to where the drag left it has the copy land there.
 */
public class HappyContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappyContextMenu")

    View(HappyContextMenuView.self) {
      Events("onSelectAction", "onDragBegin", "onDragEnd")

      Prop("menu") { (view: HappyContextMenuView, menu: [String: Any]?) in
        view.menu = menu
      }

      Prop("previewCornerRadii") { (view: HappyContextMenuView, radii: [String: Double]?) in
        view.previewCornerRadii = radii ?? [:]
      }

      Prop("dragId") { (view: HappyContextMenuView, id: String?) in
        view.dragId = id
      }

      Prop("dragPreviewColor") { (view: HappyContextMenuView, color: UIColor?) in
        view.dragPreviewColor = color
      }
    }
  }
}

/// What a drag from a `HappyContextMenuView` carries, for a `HappyDropZone` to recognise it by.
final class HappyDragPayload: NSObject {
  let id: String

  init(id: String) {
    self.id = id
  }
}

public final class HappyContextMenuView: ExpoView, UIContextMenuInteractionDelegate,
  UIDragInteractionDelegate
{
  let onSelectAction = EventDispatcher()
  let onDragBegin = EventDispatcher()
  let onDragEnd = EventDispatcher()

  var menu: [String: Any]? {
    didSet { updateInteraction() }
  }

  /// The corners of the lifted preview: `topLeft`, `topRight`, `bottomLeft`, `bottomRight`.
  var previewCornerRadii: [String: Double] = [:]

  /// Makes the view draggable, carrying this id; not draggable without one.
  var dragId: String? {
    didSet { updateDragInteraction() }
  }

  /// What the carried copy is drawn on; the system's plate when not given.
  var dragPreviewColor: UIColor?

  private var interaction: UIContextMenuInteraction?
  private var dragSource: UIDragInteraction?
  private var dragSnapshot: UIImage?
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

  private func updateDragInteraction() {
    if dragId != nil && dragSource == nil {
      let newInteraction = UIDragInteraction(delegate: self)
      // Off by default on the iPhone.
      newInteraction.isEnabled = true
      addInteraction(newInteraction)
      dragSource = newInteraction
    } else if dragId == nil, let oldInteraction = dragSource {
      removeInteraction(oldInteraction)
      dragSource = nil
    }
  }

  // MARK: - UIContextMenuInteractionDelegate

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    let specs = items
    guard !specs.isEmpty else { return nil }
    // The copy a drag carries is drawn now, while the view is still in place: once lifted, the
    // view is the menu's to show.
    if dragSource != nil {
      dragSnapshot = snapshot()
    }
    let title = (menu?["title"] as? String) ?? ""
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      guard let self else { return nil }
      let children = specs.compactMap { spec in
        HappyMenuElements.element(from: spec) { [weak self] id in self?.select(id) }
      }
      return UIMenu(title: title, children: children)
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
    menuShown = false
    flushPendingAction()
  }

  // MARK: - UIDragInteractionDelegate

  public func dragInteraction(
    _ interaction: UIDragInteraction,
    itemsForBeginning session: UIDragSession
  ) -> [UIDragItem] {
    guard let dragId else { return [] }
    let item = UIDragItem(itemProvider: NSItemProvider())
    item.localObject = HappyDragPayload(id: dragId)
    // A picture of the view rather than the view: the view stays behind, free to move.
    let image = dragSnapshot ?? snapshot()
    let size = bounds.size
    let parameters = UIDragPreviewParameters()
    parameters.visiblePath = roundedPath(in: CGRect(origin: .zero, size: size))
    if let dragPreviewColor {
      parameters.backgroundColor = dragPreviewColor
    }
    item.previewProvider = {
      let imageView = UIImageView(image: image)
      imageView.frame = CGRect(origin: .zero, size: size)
      return UIDragPreview(view: imageView, parameters: parameters)
    }
    return [item]
  }

  public func dragInteraction(
    _ interaction: UIDragInteraction,
    previewForLifting item: UIDragItem,
    session: UIDragSession
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  public func dragInteraction(
    _ interaction: UIDragInteraction,
    sessionIsRestrictedToDraggingApplication session: UIDragSession
  ) -> Bool {
    true
  }

  public func dragInteraction(_ interaction: UIDragInteraction, sessionWillBegin session: UIDragSession) {
    onDragBegin()
  }

  public func dragInteraction(
    _ interaction: UIDragInteraction,
    session: UIDragSession,
    willEndWith operation: UIDropOperation
  ) {
    dragSnapshot = nil
    onDragEnd()
  }

  /// Back onto the view where it is now, which the drag may have moved, rather than where it was
  /// picked up.
  public func dragInteraction(
    _ interaction: UIDragInteraction,
    previewForCancelling item: UIDragItem,
    withDefault defaultPreview: UITargetedPreview
  ) -> UITargetedPreview? {
    guard let superview, window != nil else { return defaultPreview }
    return defaultPreview.retargetedPreview(with: UIPreviewTarget(container: superview, center: center))
  }

  // MARK: - Actions

  // Depending on the iOS version the action's handler runs before or after the menu has started
  // closing; either way the event goes out once it has.
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

  // MARK: - Preview

  /// The view itself, lifted, clipped to the row's own corners. The system backdrop behind it
  /// stays, for a row that draws no background of its own.
  private func targetedPreview() -> UITargetedPreview? {
    guard window != nil else { return nil }
    let parameters = UIPreviewParameters()
    parameters.visiblePath = roundedPath(in: bounds)
    return UITargetedPreview(view: self, parameters: parameters)
  }

  private func snapshot() -> UIImage {
    UIGraphicsImageRenderer(bounds: bounds).image { _ in
      _ = drawHierarchy(in: bounds, afterScreenUpdates: false)
    }
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
