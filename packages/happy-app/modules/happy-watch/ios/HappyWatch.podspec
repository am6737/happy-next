Pod::Spec.new do |s|
  s.name           = 'HappyWatch'
  s.version        = '1.0.0'
  s.summary        = 'Answers Happy notifications from their actions and signs the Apple Watch app in.'
  s.description    = 'Keeps a copy of the account credentials readable while the phone is locked, answers permission requests and replies from notification actions, and hands the credentials to the watch app.'
  s.license        = 'MIT'
  s.author         = 'happy-next'
  s.homepage       = 'https://github.com/kuaifan/happy-next'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'EXNotifications'

  # HappyKit is shared with the watch app (targets/watch links it)
  s.source_files = '*.swift', 'HappyKit/*.swift'
end
