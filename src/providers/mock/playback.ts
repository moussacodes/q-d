import type { MusicProvider } from '@/domain/music-provider';
import type { PlaybackCapabilities } from '@/domain/playback';

import { ProviderError } from '../errors';
import type { ConnectionState, PlaybackAdapter, PlayerState, ProviderTrack } from '../types';

/**
 * A mock plays no audio, so it claims no real capability. `isMock` lets the UI
 * label it, and it never stands in for what Apple Music or Spotify can do.
 */
export const mockCapabilities: PlaybackCapabilities = Object.freeze({
  inAppAudio: false,
  backgroundPlayback: false,
  requiresExternalApp: false,
  autoplay: false,
  isMock: true,
});

/**
 * A pretend player for web, Windows and tests. It keeps time with a clock you
 * can inject, so the same calls always give the same state. When a song ends
 * it moves to the next enqueued song; when the queue runs out it goes idle.
 */
export class MockPlaybackAdapter implements PlaybackAdapter {
  private queue: ProviderTrack[] = [];
  private track: ProviderTrack | null = null;
  private status: PlayerState['status'] = 'idle';
  /** Position when playback last started, paused or seeked. */
  private baseMs = 0;
  /** Clock time when playback last started or seeked while playing. */
  private startedAt = 0;

  constructor(
    readonly provider: MusicProvider,
    private readonly now: () => number = Date.now,
  ) {}

  capabilities(): PlaybackCapabilities {
    return { ...mockCapabilities };
  }

  async connect(): Promise<ConnectionState> {
    return { status: 'connected', accountLabel: 'Mock account', isMock: true };
  }

  /** Loads the track paused. It never starts audio; `play` does. */
  async prepare(track: ProviderTrack, startPositionMs = 0) {
    this.check(track);
    this.checkPosition(startPositionMs);
    this.track = track;
    this.status = 'paused';
    this.baseMs = this.clamp(startPositionMs);
  }

  async play() {
    this.advance();
    if (this.track && this.status !== 'playing') {
      this.status = 'playing';
      this.startedAt = this.now();
    }
  }

  async pause() {
    this.advance();
    if (this.status === 'playing') {
      this.baseMs = this.position();
      this.status = 'paused';
    }
  }

  async seek(positionMs: number) {
    this.checkPosition(positionMs);
    this.advance();
    this.baseMs = this.clamp(positionMs);
    this.startedAt = this.now();
  }

  async enqueue(tracks: ProviderTrack[]) {
    tracks.forEach((track) => this.check(track));
    this.queue.push(...tracks);
  }

  async getState(): Promise<PlayerState> {
    this.advance();
    return { status: this.status, track: this.track, positionMs: this.position() };
  }

  async disconnect() {
    this.queue = [];
    this.track = null;
    this.status = 'idle';
    this.baseMs = 0;
  }

  /** A player only plays its own provider's tracks. */
  private check(track: ProviderTrack) {
    if (track.provider !== this.provider) {
      throw new ProviderError('wrong_provider', this.provider, 'Track is from another provider');
    }
  }

  private checkPosition(positionMs: number) {
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      throw new ProviderError('invalid_argument', this.provider, 'Position must be ms ≥ 0');
    }
  }

  private position() {
    return this.status === 'playing' ? this.baseMs + (this.now() - this.startedAt) : this.baseMs;
  }

  private clamp(positionMs: number) {
    return Math.min(Math.round(positionMs), this.track?.durationMs ?? 0);
  }

  /** Roll over to the next song for any time spent past the end of the current one. */
  private advance() {
    while (this.status === 'playing' && this.track && this.position() >= this.track.durationMs) {
      const overflow = this.position() - this.track.durationMs;
      const next = this.queue.shift();
      if (!next) {
        this.track = null;
        this.status = 'idle';
        this.baseMs = 0;
        return;
      }
      this.track = next;
      this.baseMs = 0;
      this.startedAt = this.now() - overflow;
    }
  }
}
