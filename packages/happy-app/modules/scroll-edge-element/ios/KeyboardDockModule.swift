import ExpoModulesCore
import UIKit

/**
 * A composer dock that rides the keyboard the way UIKit's own input bars do: its content sits in a
 * view pinned to `keyboardLayoutGuide` with constraints, so showing, hiding, an interactive
 * dismissal and screen transitions all move it through UIKit's layout and animations. The iOS 26
 * bottom scroll edge effect is registered on that same view, so the effect is shaped by where UIKit
 * lays the composer out rather than by where a transform happens to draw it.
 */
public class KeyboardDockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardDock")

    View(KeyboardDockView.self) {
      // How far the dock's bottom may sit below the keyboard's top: the part of the dock's own
      // bottom padding that the keyboard is allowed to cover.
      Prop("keyboardOffset") { (view: KeyboardDockView, offset: Double?) in
        view.keyboardOffset = CGFloat(offset ?? 0)
      }
    }
  }
}

public final class KeyboardDockView: ExpoView {
  var keyboardOffset: CGFloat = 0 {
    didSet {
      keyboardConstraint?.constant = keyboardOffset
    }
  }

  /// Holds the React Native children. React Native sizes this view (the dock at rest); the dock
  /// view takes the same size and is lifted over the keyboard by its constraints.
  private let dockView = UIView()
  private var keyboardConstraint: NSLayoutConstraint?

  private var interaction: UIInteraction?
  private weak var attachedScrollView: UIScrollView?
  private var attachedSize: CGSize = .zero
  private var watchdog: Timer?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    dockView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(dockView)

    // With the keyboard down the guide's top is this view's bottom, so the dock rests there; with
    // it up the dock's bottom follows the keyboard's top.
    keyboardLayoutGuide.usesBottomSafeArea = false
    let keyboard = dockView.bottomAnchor.constraint(lessThanOrEqualTo: keyboardLayoutGuide.topAnchor, constant: keyboardOffset)
    let resting = dockView.bottomAnchor.constraint(equalTo: bottomAnchor)
    resting.priority = .defaultLow
    NSLayoutConstraint.activate([
      dockView.leadingAnchor.constraint(equalTo: leadingAnchor),
      dockView.trailingAnchor.constraint(equalTo: trailingAnchor),
      dockView.heightAnchor.constraint(equalTo: heightAnchor),
      dockView.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor),
      keyboard,
      resting,
    ])
    keyboardConstraint = keyboard
  }

  deinit {
    stopWatchdog()
  }

  // MARK: - Children

  public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    dockView.insertSubview(childComponentView, at: index)
  }

  public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  // With the keyboard up the dock sits above this view's own frame; touches follow the dock.
  public override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    return dockView.frame.contains(point)
  }

  // MARK: - Scroll edge element

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      startWatchdog()
      remeasure()
    } else {
      stopWatchdog()
    }
  }

  // Layout runs whenever the dock moves with the keyboard (which needs nothing: UIKit follows a view
  // it lays out), and when the scroll view beside it appears or is replaced. A change of size (a
  // panel above the input, a taller input) only counts once the interaction is re-added.
  public override func layoutSubviews() {
    super.layoutSubviews()
    if interaction != nil && dockView.bounds.size != attachedSize {
      remeasure()
    } else {
      attach()
    }
  }

  // The scroll view can be swapped without this view laying out: a chat list mounts a moment
  // after the composer (and replaces the empty state's scroll view), or remounts for another
  // session. A cheap check a few times a second re-attaches once the one it holds has left.
  private func startWatchdog() {
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    #else
    return
    #endif
    guard watchdog == nil else { return }
    let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, self.window != nil else { return }
      if self.attachedScrollView?.window == nil {
        self.remeasure()
      }
    }
    RunLoop.main.add(timer, forMode: .common)
    watchdog = timer
  }

  private func stopWatchdog() {
    watchdog?.invalidate()
    watchdog = nil
  }

  private func remeasure() {
    attachedScrollView = nil
    attach()
  }

  private func attach() {
    // The interaction and edge-effect APIs only exist in the iOS 26 SDK (Swift 6.2 / Xcode 26).
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    guard window != nil, let scrollView = findScrollView() else { return }
    if scrollView === attachedScrollView && interaction != nil { return }

    if let old = interaction {
      dockView.removeInteraction(old)
    }
    let edgeInteraction = UIScrollEdgeElementContainerInteraction()
    edgeInteraction.scrollView = scrollView
    edgeInteraction.edge = .bottom
    dockView.addInteraction(edgeInteraction)

    scrollView.bottomEdgeEffect.isHidden = false
    scrollView.bottomEdgeEffect.style = .soft

    interaction = edgeInteraction
    attachedScrollView = scrollView
    attachedSize = dockView.bounds.size
    #endif
  }

  /// The scroll view this dock floats over: the largest one beside it, found by widening the search
  /// one ancestor at a time. Scroll views inside the dock (a text input) do not count, and the
  /// search does not descend into scroll views, so a list's rows are never walked.
  private func findScrollView() -> UIScrollView? {
    var ancestor = superview
    while let current = ancestor {
      if let found = largestScrollView(in: current) {
        return found
      }
      ancestor = current.superview
    }
    return nil
  }

  private func largestScrollView(in root: UIView) -> UIScrollView? {
    var best: UIScrollView?
    var bestArea: CGFloat = 0
    var stack: [UIView] = [root]
    while let view = stack.popLast() {
      if view === self {
        continue
      }
      if let scrollView = view as? UIScrollView {
        if !(scrollView is UITextView) && scrollView.window != nil {
          let area = scrollView.bounds.width * scrollView.bounds.height
          if area > bestArea {
            best = scrollView
            bestArea = area
          }
        }
        continue
      }
      stack.append(contentsOf: view.subviews)
    }
    return best
  }
}
