import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { createQdMusicKit } from './src/QdMusicKit';
import type { QdMusicKitNativeModule } from './src/QdMusicKit.types';

/**
 * q’d's MusicKit bridge. Only the Apple PlaybackAdapter in src/providers uses
 * it (docs/ARCHITECTURE.md §4.8). In Expo Go, on the web and in tests the
 * native module is missing, and the wrapper reports `unavailable`.
 */
export const QdMusicKit = createQdMusicKit(
  requireOptionalNativeModule<QdMusicKitNativeModule>('QdMusicKit'),
  Platform.OS,
);

export { createQdMusicKit, QdMusicKitError } from './src/QdMusicKit';
export type * from './src/QdMusicKit.types';
