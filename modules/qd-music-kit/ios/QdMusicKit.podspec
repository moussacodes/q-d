# Local Expo module for q’d (modules/qd-music-kit). Autolinked from ./modules;
# it has no package.json, so the metadata lives here.
Pod::Spec.new do |s|
  s.name           = 'QdMusicKit'
  s.version        = '0.1.0'
  s.summary        = 'MusicKit playback bridge for q’d'
  s.description    = 'Wraps MusicKit ApplicationMusicPlayer behind the PlaybackAdapter contract.'
  s.license        = { :type => 'UNLICENSED' }
  s.author         = 'q-d'
  s.homepage       = 'https://github.com/moussacodes/q-d'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/moussacodes/q-d.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MusicKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
