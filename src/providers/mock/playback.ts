import type { MusicProvider } from '@/domain/music-provider';

import { toProviderTrack } from './catalog';
import { mockAutoplayTracks } from './data';

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
 * it moves to the next enqueued song. When the queue runs out it goes idle,
 * or, with `autoplay`, plays songs it picks itself, the way Apple Music and
 * Spotify can. Its picks are a fixed list, so they're always the same.
 */
export class MockPlaybackAdapter implements PlaybackAdapter {
  private queue: ProviderTrack[] = [];
  private track: ProviderTrack | null = null;
  private status: PlaybackState['status'] = 'idle';
  /** Position when playback last started, paused or seeked. */
  private baseMs = 0;
  /** Clock time when playback last started or seeked while playing. */
  private startedAt = 0;

  /** The track is one the mock picked itself after the queue ran out. */
  private autoplaying = false;
  /** How many songs autoplay has picked, for the next pick. */
  private picks = 0;

  constructor(
    readonly provider: MusicProvider,
    private readonly now: () => number = Date.now,
    private readonly options: { autoplay?: boolean } = {},
  ) {}

  capabilities(): PlaybackCapabilities {
    const apple = this.provider === 'apple_music';
    return {
      canSeek: true,
      playsInsideApp: apple,
      backgroundPlayback: apple,
      autoplay: !!this.options.autoplay,
    };
  }

  async connect(): Promise<ConnectionState> {
    return { status: 'connected', accountLabel: 'Mock account', isMock: true };
  }

  async prepare(track: ProviderTrack, startPositionMs = 0) {
    this.autoplaying = false;
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
    const state: PlaybackState = {
      status: this.status,
      track: this.track,
      positionMs: this.position(),
    };
    return this.autoplaying ? { ...state, autoplay: true } : state;
  }

  async disconnect() {
    this.autoplaying = false;
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
      const next = this.queue.shift() ?? this.pick();
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

  /** Autoplay's next song, once the queue has run out. Null without autoplay. */
  private pick(): ProviderTrack | null {
    if (!this.options.autoplay) return null;
    const track = mockAutoplayTracks[this.picks % mockAutoplayTracks.length];
    this.picks += 1;
    this.autoplaying = true;
    return { ...toProviderTrack(track), provider: this.provider };
  }
}
