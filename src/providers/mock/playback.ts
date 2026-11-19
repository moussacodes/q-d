import type { MusicProvider } from '@/domain/music-provider';

import type {
  ConnectionState,
  PlaybackAdapter,
  PlaybackCapabilities,
  PlaybackState,
  ProviderTrack,
} from '../types';

/**
 * A pretend player for web, Windows and tests. It keeps time with a clock you
 * can inject, so the same calls always give the same state. When a song ends
 * it moves to the next enqueued song; when the queue runs out it goes idle.
 */
export class MockPlaybackAdapter implements PlaybackAdapter {
  private queue: ProviderTrack[] = [];
  private track: ProviderTrack | null = null;
  private status: PlaybackState['status'] = 'idle';
  /** Position when playback last started, paused or seeked. */
  private baseMs = 0;
  /** Clock time when playback last started or seeked while playing. */
  private startedAt = 0;

  constructor(
    readonly provider: MusicProvider,
    private readonly now: () => number = Date.now,
  ) {}

  capabilities(): PlaybackCapabilities {
    const apple = this.provider === 'apple_music';
    return { canSeek: true, playsInsideApp: apple, backgroundPlayback: apple };
  }

  async connect(): Promise<ConnectionState> {
    return { status: 'connected', accountLabel: 'Mock account', isMock: true };
  }

  async prepare(track: ProviderTrack, startPositionMs = 0) {
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
    this.advance();
    this.baseMs = this.clamp(positionMs);
    this.startedAt = this.now();
  }

  async enqueue(tracks: ProviderTrack[]) {
    this.queue.push(...tracks);
  }

  async getState(): Promise<PlaybackState> {
    this.advance();
    return { status: this.status, track: this.track, positionMs: this.position() };
  }

  async disconnect() {
    this.queue = [];
    this.track = null;
    this.status = 'idle';
    this.baseMs = 0;
  }

  private position() {
    return this.status === 'playing' ? this.baseMs + (this.now() - this.startedAt) : this.baseMs;
  }

  private clamp(positionMs: number) {
    return Math.min(Math.max(positionMs, 0), this.track?.durationMs ?? 0);
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
