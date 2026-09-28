import ExpoModulesCore
import UIKit

/**
 * iOS 26 only draws a scroll view's edge effect under system bars, or under a custom view that is
 * registered with `UIScrollEdgeElementContainerInteraction`. React Native has no way to do the
 * latter, so a floating composer over a chat list gets no bottom effect. This view is that
 * registration: whatever it wraps becomes the element the effect is drawn under.
 */
public class ScrollEdgeElementModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScrollEdgeElement")

    View(ScrollEdgeElementView.self) {
      Prop("edge") { (view: ScrollEdgeElementView, edge: String?) in
        view.edge = edge ?? "bottom"
      }
    }
  }
}

public final class ScrollEdgeElementView: ExpoView {
  var edge: String = "bottom" {
    didSet {
      if edge != oldValue {
        attachedScrollView = nil
        attach()
      }
    }
  }

  private var interaction: UIInteraction?
  private weak var attachedScrollView: UIScrollView?
  private var keyboardObservers: [NSObjectProtocol] = []
  private var displayLink: CADisplayLink?
  private var keyboardVisible = false
  private var lastFrameInWindow: CGRect?
  private var lastMovedAt: CFTimeInterval = 0
  private var settled = true
  private var attachedSize: CGSize = .zero
  private var watchdog: Timer?
  private var backGestures: [UIGestureRecognizer] = []

  deinit {
    stopObservingKeyboard()
    stopObservingBackGesture()
    stopWatchdog()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      startObservingKeyboard()
      startObservingBackGesture()
      startWatchdog()
      // Coming back on screen (say, popping back to the chat) the old registration may be stale.
      remeasure()
    } else {
      stopObservingKeyboard()
      stopObservingBackGesture()
      stopWatchdog()
    }
  }

  // Layout runs whenever the wrapped view or its surroundings change, which is also when the scroll
  // view it belongs to can appear (the list mounts after the first frame) or be replaced. A change
  // of size (a panel above the input, a taller input) only counts once the interaction is re-added.
  public override func layoutSubviews() {
    super.layoutSubviews()
    if interaction != nil && bounds.size != attachedSize {
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

  private func attach() {
    // The interaction and edge-effect APIs only exist in the iOS 26 SDK (Swift 6.2 / Xcode 26).
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    guard window != nil, let scrollView = findScrollView() else { return }
    if scrollView === attachedScrollView && interaction != nil { return }
    register(on: scrollView)
    #endif
  }

  /// Re-adds the interaction, the only thing that makes UIKit measure this view again: laying it
  /// out does not move an edge effect it has already shaped.
  private func register(on scrollView: UIScrollView) {
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    if let old = interaction {
      removeInteraction(old)
    }
    let edgeInteraction = UIScrollEdgeElementContainerInteraction()
    edgeInteraction.scrollView = scrollView
    edgeInteraction.edge = edge == "top" ? .top : .bottom
    addInteraction(edgeInteraction)

    let effect = edge == "top" ? scrollView.topEdgeEffect : scrollView.bottomEdgeEffect
    effect.isHidden = false
    effect.style = .soft

    interaction = edgeInteraction
    attachedScrollView = scrollView
    attachedSize = bounds.size
    #endif
  }

  // A composer that rides the keyboard is moved by a transform on an ancestor, and UIKit only
  // measures an element when its interaction is added: the edge effect stays where it was first
  // shaped (behind the keyboard, or wherever a drag last paused). So from the moment the keyboard
  // starts to move until it has gone, the element's place on screen is checked every frame and the
  // interaction is re-added whenever it moved. Following the element rather than the keyboard's
  // notifications also covers an interactive dismissal, which posts none while the finger drags
  // the keyboard (and the composer) down, and a swipe back, which slides the whole screen.
  private func startObservingKeyboard() {
    guard keyboardObservers.isEmpty else { return }
    let center = NotificationCenter.default
    keyboardObservers = [
      center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
        self?.keyboardVisible = true
        self?.startTracking()
      },
      center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] _ in
        self?.startTracking()
      },
      center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
        self?.startTracking()
      },
      center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in
        self?.keyboardVisible = false
        self?.startTracking()
      },
    ]
  }

  private func stopObservingKeyboard() {
    keyboardObservers.forEach { NotificationCenter.default.removeObserver($0) }
    keyboardObservers = []
    keyboardVisible = false
    stopTracking()
  }

  private func startTracking() {
    // Counts as a fresh move, so tracking outlives a hide that lands later than announced.
    lastMovedAt = CACurrentMediaTime()
    guard displayLink == nil else { return }
    lastFrameInWindow = convert(bounds, to: nil)
    let link = CADisplayLink(target: self, selector: #selector(trackingTick))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopTracking() {
    displayLink?.invalidate()
    displayLink = nil
    lastFrameInWindow = nil
  }

  @objc private func trackingTick() {
    let now = CACurrentMediaTime()
    let frame = convert(bounds, to: nil)
    if frame != lastFrameInWindow {
      lastFrameInWindow = frame
      lastMovedAt = now
      settled = false
      refresh()
      return
    }
    // Still for a few frames: the move is over (or a pause in a drag). One more measure there
    // catches a transform applied after this frame's check.
    if !settled && now - lastMovedAt >= 0.1 {
      settled = true
      remeasure()
    }
    // With the keyboard up the composer can be dragged at any time; once it is down and the
    // composer has held still a while, nothing moves it any more.
    if !keyboardVisible && settled && now - lastMovedAt >= 0.3 {
      stopTracking()
    }
  }

  private func remeasure() {
    attachedScrollView = nil
    attach()
  }

  /// `remeasure` without searching for the scroll view again, cheap enough for every frame.
  private func refresh() {
    if let scrollView = attachedScrollView, scrollView.window != nil {
      register(on: scrollView)
    } else {
      remeasure()
    }
  }

  // A swipe back slides the screen without any keyboard notification, so the navigation
  // controller's back gestures start the tracking too.
  private func startObservingBackGesture() {
    stopObservingBackGesture()
    guard let navigationController = findNavigationController() else { return }
    var recognizers: [UIGestureRecognizer] = []
    if let pop = navigationController.interactivePopGestureRecognizer {
      recognizers.append(pop)
    }
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), let contentPop = navigationController.interactiveContentPopGestureRecognizer {
      recognizers.append(contentPop)
    }
    #endif
    // react-native-screens' own full-screen swipe lives on the controller's view.
    for recognizer in navigationController.view.gestureRecognizers ?? [] where !recognizers.contains(recognizer) {
      recognizers.append(recognizer)
    }
    recognizers.forEach { $0.addTarget(self, action: #selector(backGestureChanged(_:))) }
    backGestures = recognizers
  }

  private func stopObservingBackGesture() {
    backGestures.forEach { $0.removeTarget(self, action: #selector(backGestureChanged(_:))) }
    backGestures = []
  }

  @objc private func backGestureChanged(_ recognizer: UIGestureRecognizer) {
    switch recognizer.state {
    case .began, .changed, .ended, .cancelled:
      startTracking()
    default:
      break
    }
  }

  private func findNavigationController() -> UINavigationController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let navigationController = current as? UINavigationController {
        return navigationController
      }
      responder = current.next
    }
    return nil
  }

  /// The scroll view this element floats over: the largest one beside it, found by widening the
  /// search one ancestor at a time. Scroll views inside this view (a text input) do not count, and
  /// the search does not descend into scroll views, so a list's rows are never walked.
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
