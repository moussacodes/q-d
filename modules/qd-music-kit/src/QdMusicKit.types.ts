/**
 * Types for the qd-music-kit JavaScript wrapper.
 *
 * They follow docs/API_CONTRACTS.md §5 (PlaybackAdapter, PlaybackCapabilities,
 * ConnectionState). The module keeps its own copies so it doesn't depend on
 * src/: the Apple PlaybackAdapter in src/providers wraps this module and maps
 * these types onto the app's.
 */

/** The two providers q’d supports. Only Apple Music tracks can play here. */
export type QdMusicKitProvider = 'apple_music' | 'spotify';

/** API_CONTRACTS.md §5 `PlaybackCapabilities`. */
export type QdMusicKitCapabilities = {
  inAppAudio: boolean;
  backgroundPlayback: boolean;
  requiresExternalApp: boolean;
  autoplay: boolean;
  isMock: boolean;
};

/** API_CONTRACTS.md §5 `ConnectionState`. */
export type QdMusicKitConnectionState =
  | { status: 'connected' }
  | { status: 'needs_authorization' }
  | { status: 'needs_subscription' }
  | { status: 'app_not_installed' }
  | { status: 'error'; code: string };

/**
 * What the native player is doing. The room-level `PlaybackState` in
 * API_CONTRACTS.md §6 is built from this by the Apple adapter.
 */
export type QdMusicKitPlayerState = {
  status: 'playing' | 'paused' | 'stopped';
  /** Apple Music catalog id of the loaded song, or null with nothing loaded. */
  providerTrackId: string | null;
  positionMs: number;
};

/** The part of a ProviderTrack the native player needs. ProviderTrack fits it. */
export type QdMusicKitTrackRef = {
  provider: QdMusicKitProvider;
  providerTrackId: string;
};

export type QdMusicKitAvailability =
  | { available: true }
  | {
      available: false;
      /** `native_module_missing`: Expo Go, or a build without the module. */
      reason: 'native_module_missing' | 'unsupported_platform';
    };

export type QdMusicKitErrorCode =
  /** No native module here (Expo Go, web, Android, tests). */
  | 'unavailable'
  /** The native method exists but isn't built yet. */
  | 'not_implemented'
  /** A Spotify track was passed to the Apple player. */
  | 'wrong_provider'
  | 'invalid_argument'
  /** The native side answered with a shape the wrapper doesn't know. */
  | 'invalid_native_response'
  /** Any other native failure. */
  | 'native_error';

/** The JavaScript API, method for method the PlaybackAdapter contract. */
export interface QdMusicKitApi {
  readonly provider: 'apple_music';
  availability(): QdMusicKitAvailability;
  capabilities(): QdMusicKitCapabilities;
  connect(): Promise<QdMusicKitConnectionState>;
  /** Loads a song without starting audio. */
  prepare(track: QdMusicKitTrackRef, startPositionMs?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  enqueue(tracks: QdMusicKitTrackRef[]): Promise<void>;
  getState(): Promise<QdMusicKitPlayerState>;
  disconnect(): Promise<void>;
}

/**
 * The Swift module's surface (ios/QdMusicKitModule.swift). Results are
 * `unknown` because the wrapper validates whatever the bridge returns.
 */
export interface QdMusicKitNativeModule {
  capabilities(): unknown;
  connect(): Promise<unknown>;
  prepare(trackId: string, startPositionMs: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  enqueue(trackIds: string[]): Promise<void>;
  getState(): Promise<unknown>;
  disconnect(): Promise<void>;
}
