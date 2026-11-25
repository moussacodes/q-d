import type { PlaybackAdapter, PlaybackState } from '@/providers';
import { toProviderTrack } from '@/providers/mock/catalog';

import type { RoomEntry } from './roomStore';

/**
 * The host's player for one room. It plays one song at a time: the room's
 * now-playing entry. When that song ends it tells the room, and the room
 * (Postgres later, the mock store now) decides what's next. So reorders and
 * removals apply at once, with no copy of the queue inside the player.
 */
export class RoomPlayer {
  /** The entry the player has, or is loading. */
  private loaded: string | null = null;
  /** The entry the player finished loading and started. Cleared once its end is reported. */
  private started: string | null = null;

  constructor(
    private readonly player: PlaybackAdapter,
    private readonly onEnded: (entryId: string) => void,
  ) {}

  /** Plays `entry` from `startAtMs`, or stops with nothing to play. Repeat calls do nothing. */
  async load(entry: RoomEntry | null, startAtMs: number) {
    const id = entry?.entryId ?? null;
    if (this.loaded === id) return;
    this.loaded = id;
    this.started = null;
    if (entry) {
      await this.player.prepare(toProviderTrack(entry), startAtMs);
      if (this.loaded !== id) return;
      await this.player.play();
    } else {
      await this.player.disconnect();
    }
    if (this.loaded === id) this.started = id;
  }

  /**
   * Stops the music without moving the room on, for when this phone can't
   * play right now (its service was disconnected). The song that was playing
   * pauses where it is; any other song isn't started. A later `load` of the
   * paused song leaves it paused, so the music only resumes when the host
   * presses Play.
   */
  async hold(entry: RoomEntry | null) {
    const id = entry?.entryId ?? null;
    // Only a song that finished loading can pause; one still loading is stopped.
    if (id !== null && this.started === id) {
      await this.player.pause();
      return;
    }
    this.loaded = null;
    this.started = null;
    await this.player.disconnect();
  }

  /** The player's state. The first read after the song ends reports the end, once. */
  async getState(): Promise<PlaybackState> {
    const started = this.started;
    const state = await this.player.getState();
    if (started && started === this.started && state.status === 'idle') {
      this.started = null;
      this.onEnded(started);
    }
    return state;
  }

  play() {
    return this.player.play();
  }

  pause() {
    return this.player.pause();
  }

  seek(positionMs: number) {
    return this.player.seek(positionMs);
  }
}
