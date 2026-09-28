Pod::Spec.new do |s|
  s.name           = 'HappyContextMenu'
  s.version        = '1.0.0'
  s.summary        = 'Attaches a native UIKit context menu to a React Native view.'
  s.description    = 'Long-pressing the wrapped view lifts it and opens a system context menu described from JavaScript.'
  s.license        = 'MIT'
  s.author         = 'happy-next'
  s.homepage       = 'https://github.com/kuaifan/happy-next'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
