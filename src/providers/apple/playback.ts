import type { PlaybackCapabilities } from '@/domain/playback';
import { providerTrackSchema } from '@/domain/recording';

import type {
  QdMusicKitApi,
  QdMusicKitErrorCode,
  QdMusicKitPlayerState,
} from '../../../modules/qd-music-kit';
import { ProviderError } from '../errors';
import type {
  ConnectionState,
  PlaybackAdapter,
  PlayerState,
  ProviderErrorCode,
  ProviderTrack,
} from '../types';
import { appleMusicConnectionStatus, type AppleMarkerStore } from './connection';

/**
 * Apple Music playback for aux mode: the host's iPhone plays inside q’d with
 * MusicKit's `ApplicationMusicPlayer`, through the qd-music-kit module. q’d
 * owns the player, so it reads the state directly and needs no other app.
 *
 * Built, tested only against a fake native module (src/test/fakeMusicKit.ts):
 * the Swift player is Moussa's and not written yet (the skeleton's methods
 * throw `not_implemented`, which this adapter reports as `not_in_this_build`).
 * Not claimed to work until it plays on an iPhone.
 *
 * Capabilities are what the native module reports, except that it never
 * needs another app and is never a mock. Autoplay is claimed only when the
 * module says so, and a song MusicKit picked itself is reported only when
 * the module marks it (`autoplay`) and sends its details.
 */

export type AppleMusicPlaybackDeps = {
  kit: Pick<
    QdMusicKitApi,
    | 'availability'
    | 'capabilities'
    | 'prepare'
    | 'play'
    | 'pause'
    | 'seek'
    | 'enqueue'
    | 'getState'
    | 'disconnect'
    | 'addStateListener'
    | 'authorizationStatus'
    | 'requestAuthorization'
    | 'subscription'
    | 'storefront'
  >;
  marker: AppleMarkerStore;
};

const idle: PlayerState = Object.freeze({ status: 'idle', track: null, positionMs: 0 });

/** How a MusicKit failure reads to the app. */
const ERROR_CODES: Record<QdMusicKitErrorCode, ProviderErrorCode> = {
  unavailable: 'not_in_this_build',
  not_implemented: 'not_in_this_build',
  wrong_provider: 'wrong_provider',
  invalid_argument: 'invalid_argument',
  not_authorized: 'needs_authorization',
  not_subscribed: 'premium_required',
  unavailable_in_storefront: 'unavailable_in_storefront',
  not_found: 'not_found',
  invalid_native_response: 'provider_unavailable',
  native_error: 'provider_unavailable',
};

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const raw =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;
  const code =
    typeof raw === 'string' && raw in ERROR_CODES
      ? ERROR_CODES[raw as QdMusicKitErrorCode]
      : 'provider_unavailable';
  // The message is the code: MusicKit's own text could name a song.
  return new ProviderError(code, 'apple_music', code);
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toProviderError(error);
  }
}

export class AppleMusicPlaybackAdapter implements PlaybackAdapter {
  readonly provider = 'apple_music' as const;
  /** Every song q’d prepared or queued, by Apple Music id, to report with q’d's own metadata. */
  private known = new Map<string, ProviderTrack>();
  /** Whether q’d has loaded anything since the last disconnect. */
  private loaded = false;
  private readonly frozenCapabilities: PlaybackCapabilities;

  constructor(private readonly deps: AppleMusicPlaybackDeps) {
    const native = deps.kit.capabilities();
    this.frozenCapabilities = Object.freeze({
      inAppAudio: native.inAppAudio,
      backgroundPlayback: native.backgroundPlayback,
      requiresExternalApp: false,
      autoplay: native.autoplay,
      isMock: false,
    });
  }

  capabilities(): PlaybackCapabilities {
    return { ...this.frozenCapabilities };
  }

  /** Checked without a prompt: Connect in Settings is what asks iOS. */
  async connect(): Promise<ConnectionState> {
    const state = await appleMusicConnectionStatus(this.deps.kit, this.deps.marker);
    return state ?? { status: 'error', code: 'not_in_this_build', isMock: false };
  }

  async prepare(track: ProviderTrack, startPositionMs = 0) {
    this.check(track);
    this.checkPosition(startPositionMs);
    const start = Math.min(Math.round(startPositionMs), track.durationMs);
    // Known before the call, so the state event MusicKit sends while loading
    // already reports the song; undone if loading fails.
    const wasLoaded = this.loaded;
    const wasKnown = this.known.get(track.providerTrackId);
    this.known.set(track.providerTrackId, track);
    this.loaded = true;
    try {
      await guarded(() => this.deps.kit.prepare(track, start));
    } catch (error) {
      this.loaded = wasLoaded;
      if (wasKnown) this.known.set(track.providerTrackId, wasKnown);
      else this.known.delete(track.providerTrackId);
      throw error;
    }
  }

  async play() {
    // Nothing prepared: stay idle rather than resume whatever MusicKit had.
    if (!this.loaded) return;
    await guarded(() => this.deps.kit.play());
  }

  async pause() {
    if (!this.loaded) return;
    await guarded(() => this.deps.kit.pause());
  }

  async seek(positionMs: number) {
    this.checkPosition(positionMs);
    if (!this.loaded) return;
    const state = await guarded(() => this.deps.kit.getState());
    const track = state.providerTrackId ? this.known.get(state.providerTrackId) : undefined;
    const position = Math.round(track ? Math.min(positionMs, track.durationMs) : positionMs);
    await guarded(() => this.deps.kit.seek(position));
  }

  async enqueue(tracks: ProviderTrack[]) {
    tracks.forEach((track) => this.check(track));
    if (tracks.length === 0) return;
    await guarded(() => this.deps.kit.enqueue(tracks));
    tracks.forEach((track) => this.known.set(track.providerTrackId, track));
  }

  async getState(): Promise<PlayerState> {
    if (!this.loaded) return { ...idle };
    const state = await guarded(() => this.deps.kit.getState());
    return this.toPlayerState(state);
  }

  /**
   * Calls `listener` when the native player changes (song ended, paused
   * from the lock screen). Returns an unsubscribe. Polling `getState` still
   * works without it; the skeleton sends no events.
   */
  onStateChange(listener: (state: PlayerState) => void): () => void {
    return this.deps.kit.addStateListener((state) => {
      if (this.loaded) listener(this.toPlayerState(state));
    });
  }

  /** Stops and forgets what q’d loaded. The Apple Music connection stays. Never throws. */
  async disconnect() {
    const wasLoaded = this.loaded;
    this.loaded = false;
    this.known.clear();
    if (!wasLoaded || !this.deps.kit.availability().available) return;
    try {
      await this.deps.kit.disconnect();
    } catch {
      // Best effort: a player that's already stopped has nothing to undo.
    }
  }

  private toPlayerState(state: QdMusicKitPlayerState): PlayerState {
    if (state.status === 'stopped' || !state.providerTrackId) return { ...idle };
    const status = state.status === 'playing' ? 'playing' : 'paused';
    const mine = this.known.get(state.providerTrackId);
    if (mine && !state.autoplay) {
      return { status, track: mine, positionMs: Math.min(state.positionMs, mine.durationMs) };
    }
    // A song q’d didn't queue: only Apple Music autoplay, marked and described.
    const picked =
      state.autoplay && this.frozenCapabilities.autoplay && state.metadata
        ? providerTrackSchema.safeParse({
            provider: 'apple_music',
            providerTrackId: state.providerTrackId,
            ...state.metadata,
          })
        : null;
    if (!picked?.success) return { ...idle };
    return {
      status,
      track: picked.data,
      positionMs: Math.min(state.positionMs, picked.data.durationMs),
      autoplay: true,
    };
  }

  private check(track: ProviderTrack) {
    if (track.provider !== 'apple_music') {
      throw new ProviderError('wrong_provider', 'apple_music', 'Only Apple Music tracks play here');
    }
  }

  private checkPosition(positionMs: number) {
    if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
      throw new ProviderError('invalid_argument', 'apple_music', 'Position must be ≥ 0');
    }
  }
}
