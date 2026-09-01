require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'EarthscapeLive'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.author         = 'Earthscape'
  s.homepage       = 'https://earthscape.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  # SRT publishing engine. Pinned: HaishinKit 2.x dropped CocoaPods after 2.0.9 in
  # favour of SwiftPM; SRTHaishinKit 2.0.8 is the last SRT release on trunk and it
  # requires HaishinKit == 2.0.8. Bundles libsrt.xcframework (arm64 device + arm64 simulator).
  s.dependency 'HaishinKit', '2.0.8'
  s.dependency 'SRTHaishinKit', '2.0.8'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
