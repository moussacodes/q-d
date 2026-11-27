import type { ExpoConfig } from 'expo/config';

// User-facing brand is q’d; code, URLs and identifiers use qd (plan.md §2).
// Android is intentionally not configured yet (team decision, 2026-11-18).
// `owner` (Expo organization) is added when the repo is linked with `eas init`.
const config: ExpoConfig = {
  name: 'q’d',
  slug: 'qd',
  scheme: 'qd',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: 'app.qd.mobile',
    supportsTablet: false,
    // Sign in with Apple capability for EAS builds (Expo Go already has it).
    usesAppleSignIn: true,
    infoPlist: {
      // The host's Apple Music keeps playing with the screen locked (MusicKit's
      // ApplicationMusicPlayer). The qd-music-kit plugin adds it too; it's
      // kept once.
      UIBackgroundModes: ['audio'],
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-font',
    'expo-image',
    'expo-web-browser',
    // Sign in with Apple entitlement (com.apple.developer.applesignin).
    'expo-apple-authentication',
    [
      'expo-splash-screen',
      { backgroundColor: '#000000', image: './assets/splash-icon.png', imageWidth: 200 },
    ],
    // MusicKit usage text and background audio (modules/qd-music-kit/app.plugin.js).
    './modules/qd-music-kit/app.plugin.js',
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
