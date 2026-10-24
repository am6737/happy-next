import ExpoModulesCore
import UIKit

/**
 * Where a drag from a `HappyContextMenuView` inside it is, for content that rearranges itself
 * under the finger (a strip of tabs dragged into a new order).
 *
 * `onDragMove` reports the dragged view's `dragId` and the finger's `x` in this view, as long as
 * the finger is over it. Nothing is ever dropped: letting go anywhere sends the dragged copy back
 * onto its view, so where the content has moved that view by then is where the drag lands, and a
 * finger that strays off a thin strip does not throw the move away.
 */
public class HappyDropZoneModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappyDropZone")

    View(HappyDropZoneView.self) {
      Events("onDragMove")
    }
  }
}

public final class HappyDropZoneView: ExpoView, UIDropInteractionDelegate {
  let onDragMove = EventDispatcher()

  private var lastX: CGFloat?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIDropInteraction(delegate: self))
  }

  public func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
    payload(of: session) != nil
  }

  public func dropInteraction(
    _ interaction: UIDropInteraction,
    sessionDidUpdate session: UIDropSession
  ) -> UIDropProposal {
    if let payload = payload(of: session) {
      let x = session.location(in: self).x
      if x != lastX {
        lastX = x
        onDragMove(["id": payload.id, "x": x])
      }
    }
    return UIDropProposal(operation: .cancel)
  }

  public func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnd session: UIDropSession) {
    lastX = nil
  }

  private func payload(of session: UIDropSession) -> HappyDragPayload? {
    session.localDragSession?.items.first?.localObject as? HappyDragPayload
  }
}
