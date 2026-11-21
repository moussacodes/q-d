import type { MusicProvider } from '@/domain/music-provider';

/**
 * The provider adapter contracts from plan.md §3, trimmed to what the mock
 * adapters implement today. The provider-adapter card extends them; Apple,
 * Spotify and the mocks all implement the same interfaces.
 */

/** A recording as one provider knows it. */
export type ProviderTrack = {
  provider: MusicProvider;
  providerTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  explicit: boolean;
  isrc?: string;
  artworkUrl?: string | null;
  /** Apple supplies a background color with its artwork; Spotify doesn't. */
  artworkBackgroundColor?: string | null;
};

/** A canonical-catalog search result and where it can play. */
export type CatalogResult = {
  track: ProviderTrack;
  /** Services the recording is available on. */
  availableOn: MusicProvider[];
};

export interface CatalogAdapter {
  provider: MusicProvider;
  search(query: string, market: 'US'): Promise<CatalogResult[]>;
  getTrack(id: string): Promise<ProviderTrack>;
}

export type PlaybackCapabilities = {
  canSeek: boolean;
  /** Apple plays inside q’d; Spotify remote-controls the Spotify app. */
  playsInsideApp: boolean;
  backgroundPlayback: boolean;
};

export type ConnectionState = {
  status: 'connected' | 'disconnected';
  /** e.g. "baron.li · Premium". */
  accountLabel?: string;
  /** True for mock adapters, so the UI never shows them as a real account. */
  isMock: boolean;
};

export type PlaybackState = {
  status: 'idle' | 'playing' | 'paused';
  track: ProviderTrack | null;
  positionMs: number;
};

export interface PlaybackAdapter {
  provider: MusicProvider;
  capabilities(): PlaybackCapabilities;
  connect(): Promise<ConnectionState>;
  prepare(track: ProviderTrack, startPositionMs?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  enqueue(tracks: ProviderTrack[]): Promise<void>;
  getState(): Promise<PlaybackState>;
  disconnect(): Promise<void>;
}
