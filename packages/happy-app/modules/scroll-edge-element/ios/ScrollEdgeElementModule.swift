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

  deinit {
    stopObservingKeyboard()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      startObservingKeyboard()
    } else {
      stopObservingKeyboard()
    }
    attach()
  }

  // Layout runs whenever the wrapped view or its surroundings change, which is also when the scroll
  // view it belongs to can appear (the list mounts after the first frame) or be replaced.
  public override func layoutSubviews() {
    super.layoutSubviews()
    attach()
  }

  private func attach() {
    // The interaction and edge-effect APIs only exist in the iOS 26 SDK (Swift 6.2 / Xcode 26).
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    guard window != nil, let scrollView = findScrollView() else { return }
    if scrollView === attachedScrollView && interaction != nil { return }

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
    #endif
  }

  // A composer that rides the keyboard is moved by a transform on an ancestor, which UIKit does
  // not treat as a layout change: the edge effect stays where the element was laid out (behind
  // the keyboard) until something inside it happens to lay out again. So from the moment the
  // keyboard starts to move until it has gone, the element's place on screen is checked every
  // frame and it is laid out whenever it moved; once it holds still the interaction is re-added,
  // which makes UIKit measure it afresh wherever it ended up. Following the element rather than
  // the keyboard's notifications also covers an interactive dismissal, which posts none while
  // the finger drags the keyboard (and the composer) down.
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
      setNeedsLayout()
      layoutIfNeeded()
      return
    }
    // Still for a few frames: the move is over (or a pause in a drag).
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
