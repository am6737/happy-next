import Foundation

/// Native text in English or Chinese, after the device's first preferred language, as the app picks
public func L(_ english: String, _ chinese: String) -> String {
  isChinese ? chinese : english
}

private let isChinese: Bool = Locale.preferredLanguages.first?.hasPrefix("zh") ?? false
