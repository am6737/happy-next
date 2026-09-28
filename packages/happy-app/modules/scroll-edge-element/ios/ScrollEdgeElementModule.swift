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
  private var trackingEndsAt: CFTimeInterval = 0

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
  // the keyboard) until something inside it happens to lay out again. So while the keyboard moves,
  // the element is laid out on every frame, and once it settles the interaction is re-added, which
  // makes UIKit measure the element afresh wherever it ended up.
  private func startObservingKeyboard() {
    guard keyboardObservers.isEmpty else { return }
    let center = NotificationCenter.default
    keyboardObservers = [
      center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
        let duration = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        self?.trackKeyboard(for: duration)
      },
      center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { [weak self] _ in
        self?.remeasure()
      },
      center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in
        self?.remeasure()
      },
    ]
  }

  private func stopObservingKeyboard() {
    keyboardObservers.forEach { NotificationCenter.default.removeObserver($0) }
    keyboardObservers = []
    displayLink?.invalidate()
    displayLink = nil
  }

  private func trackKeyboard(for duration: Double) {
    // A little past the animation, as the view that follows the keyboard lands a frame or two late.
    trackingEndsAt = CACurrentMediaTime() + duration + 0.15
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(keyboardFrameTick))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  @objc private func keyboardFrameTick() {
    setNeedsLayout()
    layoutIfNeeded()
    if CACurrentMediaTime() >= trackingEndsAt {
      displayLink?.invalidate()
      displayLink = nil
      remeasure()
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
