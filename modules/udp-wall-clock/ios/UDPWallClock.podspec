Pod::Spec.new do |s|
  s.name           = 'UDPWallClock'
  s.version        = '1.0.0'
  s.summary        = 'iOS UDP native module for DVB-CSS Wall Clock synchronization'
  s.description     = 'Native iOS unicast UDP support via BSD sockets for the DVB-CSS CSS-WC (Wall Clock) protocol. Does not use multicast, so it requires no networking multicast entitlement.'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
