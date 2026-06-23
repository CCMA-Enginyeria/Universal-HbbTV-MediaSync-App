Pod::Spec.new do |s|
  s.name           = 'UDPMulticast'
  s.version        = '1.0.0'
  s.summary        = 'iOS UDP multicast native module for DIAL/SSDP discovery and DVB-CSS sync'
  s.description     = 'Native iOS UDP support via BSD sockets (multicast send/receive + unicast) for DialApp.'
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
