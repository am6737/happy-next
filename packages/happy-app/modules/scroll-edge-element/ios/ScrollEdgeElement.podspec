Pod::Spec.new do |s|
  s.name           = 'ScrollEdgeElement'
  s.version        = '1.0.0'
  s.summary        = 'Registers a React Native view as a UIKit scroll edge element container.'
  s.description    = 'Lets iOS 26 draw a scroll view\'s edge effect underneath a custom floating view.'
  s.license        = 'MIT'
  s.author         = 'happy-next'
  s.homepage       = 'https://github.com/kuaifan/happy-next'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
