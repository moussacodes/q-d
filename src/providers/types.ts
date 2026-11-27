import type { MusicProvider } from '@/domain/music-provider';
import type { PlaybackCapabilities } from '@/domain/playback';
import type { CanonicalRecording, ProviderTrack, TrackMatch } from '@/domain/recording';

/**
 * The provider adapter contracts (docs/API_CONTRACTS.md §5). Apple Music,
 * Spotify and the mocks all implement the same two interfaces. Catalog and
 * playback are separate because anyone can search, but only the phone that
 * plays needs a player (ARCHITECTURE.md §4.6).
 */

export type { MusicProvider, PlaybackCapabilities, ProviderTrack };

/** A canonical-catalog search result and where it can play. */
export type CatalogResult = {
  track: ProviderTrack;
  /** Services the recording is available on. */
  availableOn: MusicProvider[];
  /**
   * The services `availableOn` was checked against. Missing means all of
   * them (the mock catalog knows every service). Live canonical search only
   * knows Apple Music, the catalog it searched: on the other services a song
   * is unknown until a match is stored, never "not on" them.
   */
  checkedOn?: MusicProvider[];
  /**
   * The canonical recording the server saved for this result, which
   * `enqueue_recording` takes. Live canonical search sets it; the mock
   * catalog has no server, so it leaves it out.
   */
  recordingId?: string;
  /**
   * The stored track match per service, where one is resolved
   * (`track_matches`, PRODUCT_SPEC.md §6). A missing service hasn't been
   * matched yet; mappings are resolved when playback needs them.
   */
  matches?: Partial<Record<MusicProvider, TrackMatch>>;
};

/** What a pasted Apple Music or Spotify link points at. */
export type ProviderEntity =
  | { kind: 'track'; track: ProviderTrack }
  | { kind: 'playlist'; provider: MusicProvider; playlistId: string };

/** One page of a playlist's tracks (post-demo playlist import). */
export type PlaylistPage = {
  provider: MusicProvider;
  playlistId: string;
  name: string;
  tracks: ProviderTrack[];
  /** Pass to the next call for the next page; `null` on the last page. */
  nextCursor: string | null;
};

export interface CatalogAdapter {
  provider: MusicProvider;
  search(query: string, market: 'US'): Promise<CatalogResult[]>;
  resolveLink(url: string): Promise<ProviderEntity>;
  getTrack(id: string): Promise<ProviderTrack>;
  getPlaylist?(id: string, cursor?: string): Promise<PlaylistPage>;
}

/** A recording and the tracks one service offers for it. */
export type VersionCandidates = {
  recording: CanonicalRecording;
  /** That service's tracks that could be this recording, any version, in no order. */
  candidates: ProviderTrack[];
  /** Made-up mock versions, which the screen must label as mock. */
  isMock: boolean;
};

/**
 * Where "Wrong version?" finds the versions the room's service has of a
 * song (PRODUCT_SPEC.md §6, rule 8). `matchRecording` ranks them. Only the
 * labeled mock exists so far; the live source searches the host's service
 * and comes with the playback cards (API_CONTRACTS.md §5).
 */
export interface VersionSource {
  versions(recordingId: string, provider: MusicProvider): Promise<VersionCandidates>;
}

/**
 * Whether this phone can play through a provider. Every state says whether it
 * comes from a mock, so the UI never shows a mock as a real account.
 */
export type ConnectionState = { isMock: boolean } & (
  | {
      status: 'connected';
      /** e.g. "baron.li · Premium". Mocks say "Mock account". */
      accountLabel?: string;
      /**
       * The account's storefront (two lowercase letters, `us`), when the
       * service tells us. Apple Music does; it's written to the
       * `provider_connections` row.
       */
      storefront?: string;
    }
  | { status: 'needs_authorization' }
  /** e.g. no Apple Music subscription or no Spotify Premium. */
  | { status: 'needs_subscription' }
  /** Spotify: the Spotify app isn't installed. */
  | { status: 'app_not_installed' }
  | { status: 'error'; code: ProviderErrorCode }
);

export type ConnectionStatus = ConnectionState['status'];

/**
 * What the local player is doing. This is the adapter's view of one device;
 * the room's shared `PlaybackState` (src/domain/playback.ts) is what the host
 * reports to the server.
 */
export type PlayerState = {
  status: 'idle' | 'playing' | 'paused';
  track: ProviderTrack | null;
  positionMs: number;
  /** Set when the provider picked this track itself, after q’d's queue ran out. */
  autoplay?: true;
};

export interface PlaybackAdapter {
  provider: MusicProvider;
  capabilities(): PlaybackCapabilities;
  connect(): Promise<ConnectionState>;
  /** Loads a track without starting audio. `play` starts it. */
  prepare(track: ProviderTrack, startPositionMs?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  enqueue(tracks: ProviderTrack[]): Promise<void>;
  getState(): Promise<PlayerState>;
  disconnect(): Promise<void>;
}

/** Stable codes for `ProviderError`. */
export type ProviderErrorCode =
  /** The real Apple Music or Spotify adapter isn't part of this build yet. */
  | 'not_in_this_build'
  /** No such track or playlist. */
  | 'not_found'
  /** Apple Music: the song exists, but not in this account's storefront (country). */
  | 'unavailable_in_storefront'
  /** Not an Apple Music or Spotify link q’d understands. */
  | 'unsupported_link'
  /** The track belongs to a different provider than the player. */
  | 'wrong_provider'
  /** An argument is out of range, e.g. a negative seek position. */
  | 'invalid_argument'
  /** This build has no client ID (or other setup) for the provider. */
  | 'not_configured'
  /** Not connected, or the provider revoked access: the person reconnects. */
  | 'needs_authorization'
  /** Authorization didn't finish: state mismatch, a refused code exchange. */
  | 'auth_failed'
  /**
   * The person said no (or the phone is restricted), and only iOS Settings
   * can change it: Apple Music access for q’d.
   */
  | 'permission_denied'
  /** The account needs Premium (Spotify) or a subscription for this. */
  | 'premium_required'
  /** Spotify development mode: the account isn't on the app's user list. */
  | 'not_approved_user'
  /** Spotify: no Spotify app is open and active to control. */
  | 'no_active_device'
  /** The provider refused the command, e.g. a device that can't be controlled. */
  | 'playback_refused'
  /** Too many requests. `ProviderError.retryAfterSeconds` says when to try again. */
  | 'rate_limited'
  /** The service (or q’d's server in front of it) couldn't be reached or failed (network, 5xx). */
  | 'provider_unavailable';
