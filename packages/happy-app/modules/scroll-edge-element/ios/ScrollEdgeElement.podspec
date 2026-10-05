Pod::Spec.new do |s|
  s.name           = 'ScrollEdgeElement'
  s.version        = '1.0.0'
  s.summary        = 'A keyboard-following composer dock that carries the iOS 26 bottom scroll edge effect.'
  s.description    = 'Pins a React Native composer to keyboardLayoutGuide and registers it as a scroll edge element container, so iOS 26 draws the soft edge effect under it.'
  s.license        = 'MIT'
  s.author         = 'happy-next'
  s.homepage       = 'https://github.com/kuaifan/happy-next'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
