Pod::Spec.new do |s|
  s.name           = 'HappyShareExtension'
  s.version        = '1.0.0'
  s.summary        = 'What the app tells its share extension, and what the extension tells back.'
  s.description    = 'Writes the sessions the share extension lists into the App Group, and takes the one picked there.'
  s.license        = 'MIT'
  s.author         = 'happy-next'
  s.homepage       = 'https://github.com/kuaifan/happy-next'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
