import { availabilityOf, canPlayOnHostPhone } from '@/domain/availability';
import type { PlaybackAdapter, PlayerState } from '@/providers';
import { toProviderTrack } from '@/providers/mock/catalog';

import type { RoomEntry } from './roomStore';

/**
 * The host's player for one room. It plays one song at a time: the room's
 * now-playing entry. When that song ends it tells the room, and the room
 * (Postgres later, the mock store now) decides what's next. So reorders and
 * removals apply at once, with no copy of the queue inside the player.
 *
 * It never plays a song its service doesn't have, or one whose match isn't
 * resolved yet (PRODUCT_SPEC.md §6): it stops and waits for the host to skip.
 * A low-confidence match plays, with the room showing its warning.
 */
export class RoomPlayer {
  /** The entry the player has, or is loading. */
  private loaded: string | null = null;
  /** The entry the player finished loading and started. Cleared once its end is reported. */
  private started: string | null = null;
  /** Held while the host's phone is away from the room: nothing starts playing. */
  private held = false;

  constructor(
    private readonly player: PlaybackAdapter,
    private readonly onEnded: (entryId: string) => void,
  ) {}

  /**
   * Plays `entry` from `startAtMs`, or stops with nothing to play, or with a
   * song this service can't play. Repeat calls do nothing.
   */
  async load(entry: RoomEntry | null, startAtMs: number) {
    const id = entry?.entryId ?? null;
    if (this.loaded === id) return;
    this.loaded = id;
    this.started = null;
    const playable = entry !== null && this.canPlay(entry);
    if (entry && playable) {
      // The room's service plays the song. Mock fixtures stand in for the
      // provider track that matching resolves once the real adapters land.
      const track = { ...toProviderTrack(entry), provider: this.player.provider };
      await this.player.prepare(track, startAtMs);
      if (this.loaded !== id) return;
      if (!this.held) await this.player.play();
    } else {
      await this.player.disconnect();
    }
    if (this.loaded === id && playable) this.started = id;
  }

  /** Whether this service can play the entry: its stored match isn't missing or unresolved. */
  canPlay(entry: Pick<RoomEntry, 'matches'>) {
    return canPlayOnHostPhone(availabilityOf(entry.matches?.[this.player.provider]));
  }

  /** The player's state. The first read after the song ends reports the end, once. */
  async getState(): Promise<PlayerState> {
    const started = this.started;
    const state = await this.player.getState();
    if (started && started === this.started && state.status === 'idle') {
      this.started = null;
      this.onEnded(started);
    }
    return state;
  }

  /**
   * Holds or releases the player. Holding pauses it (PRODUCT_SPEC.md §4: the
   * room pauses once the host has been away for the grace period) and keeps a
   * newly loaded song paused. Releasing doesn't play; the host resumes.
   */
  async hold(on: boolean) {
    this.held = on;
    if (on) await this.player.pause();
  }

  get isHeld() {
    return this.held;
  }

  play() {
    if (this.held) return Promise.resolve();
    return this.player.play();
  }

  pause() {
    return this.player.pause();
  }

  seek(positionMs: number) {
    return this.player.seek(positionMs);
  }
}
