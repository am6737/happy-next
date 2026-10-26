import ExpoModulesCore
import UIKit

/**
 * A clear button laid over a React Native trigger: a tap sends `onPrimaryAction`, a long press
 * opens the menu out of the button (a `UIButton`'s own menu, as a bar button's is) with a light
 * haptic as it opens. Choosing a row sends its `id` through `onSelectAction`; the rows are those of
 * `HappyMenuElements`.
 *
 * The haptic is the one the sessions list's "+" plays (patches/react-native-screens): a deferred
 * element without rows, which UIKit asks for its rows each time the menu opens.
 */
public class HappyMenuButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappyMenuButton")

    View(HappyMenuButtonView.self) {
      Events("onPrimaryAction", "onSelectAction")

      Prop("menu") { (view: HappyMenuButtonView, menu: [String: Any]?) in
        view.menu = menu
      }
    }
  }
}

public final class HappyMenuButtonView: ExpoView {
  let onPrimaryAction = EventDispatcher()
  let onSelectAction = EventDispatcher()

  var menu: [String: Any]? {
    didSet { updateMenu() }
  }

  private let button = UIButton(type: .custom)

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.frame = bounds
    button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    button.showsMenuAsPrimaryAction = false
    button.addAction(UIAction { [weak self] _ in self?.onPrimaryAction() }, for: .primaryActionTriggered)
    addSubview(button)
  }

  private func updateMenu() {
    let specs = (menu?["items"] as? [[String: Any]]) ?? []
    guard !specs.isEmpty else {
      button.menu = nil
      return
    }
    let children = specs.compactMap { spec in
      HappyMenuElements.element(from: spec) { [weak self] id in self?.onSelectAction(["id": id]) }
    }
    let feedback = UIDeferredMenuElement.uncached { completion in
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      completion([])
    }
    button.menu = UIMenu(title: (menu?["title"] as? String) ?? "", children: children + [feedback])
  }
}
