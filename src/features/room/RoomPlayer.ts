import type { MusicProvider } from '@/domain/music-provider';
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
  /** The provider is playing songs it picked itself, after the room's queue ran out. */
  private autoplaying = false;
  /** Held while this phone can't play: nothing starts until the host presses Play. */
  private held = false;

  private player: PlaybackAdapter;

  /**
   * `adapterFor` gives the player for a service. The room starts on
   * `provider`; a switch hands the next song to another service's player.
   */
  constructor(
    private readonly adapterFor: (provider: MusicProvider) => PlaybackAdapter,
    provider: MusicProvider,
    /** `providerKeptPlaying`: the provider went on to a song it picked itself (autoplay). */
    private readonly onEnded: (entryId: string, providerKeptPlaying: boolean) => void,
  ) {
    this.player = adapterFor(provider);
  }

  /** The service the player plays through now. */
  get provider(): MusicProvider {
    return this.player.provider;
  }

  /**
   * Plays `entry` from `startAtMs` through `provider`, or stops with nothing
   * to play. Repeat calls for the same entry do nothing, even with another
   * service: services only change when a new song loads, never mid-song.
   */
  async load(entry: RoomEntry | null, startAtMs: number, provider = this.player.provider) {
    const id = entry?.entryId ?? null;
    if (this.loaded === id) return;
    this.loaded = id;
    this.started = null;
    if (entry) this.autoplaying = false;
    if (entry && provider !== this.player.provider) {
      const previous = this.player;
      this.player = this.adapterFor(provider);
      await previous.disconnect();
      if (this.loaded !== id) return;
    }
    if (entry) {
      await this.player.prepare({ ...toProviderTrack(entry), provider }, startAtMs);
      if (this.loaded !== id) return;
      if (!this.held) await this.player.play();
    } else if (!this.autoplaying) {
      // With nothing queued, provider autoplay keeps going; anything else stops.
      await this.player.disconnect();
    }
    if (this.loaded === id) this.started = id;
  }

  /**
   * Holds or releases the player, for when this phone can't play right now
   * (the host disconnected the room's service). Holding pauses the song where
   * it is, and a song loaded while held is prepared but stays paused, so a
   * skip during the hold doesn't start anything. Releasing doesn't play: the
   * music only resumes when the host presses Play. Same signature and meaning
   * as the host-reconnecting card's `hold` (docs/DECISIONS.md). A song that
   * isn't on the room's service uses `standBy` instead.
   */
  async hold(on: boolean) {
    this.held = on;
    if (!on) return;
    if (this.autoplaying) {
      // Provider autoplay stops rather than pauses: q’d didn't choose those songs.
      this.autoplaying = false;
      await this.player.disconnect();
      return;
    }
    await this.player.pause();
  }

  /**
   * Stops without moving the room on, for a song that's up but isn't on the
   * room's service: it never starts, and waits for the host to skip it or
   * switch. Provider autoplay stops too. A song that had already started
   * pauses where it is instead. A later `load` of the entry plays it (after a
   * switch).
   */
  async standBy(entry: RoomEntry | null) {
    const id = entry?.entryId ?? null;
    if (id !== null && this.started === id) {
      await this.player.pause();
      return;
    }
    this.loaded = null;
    this.started = null;
    this.autoplaying = false;
    await this.player.disconnect();
  }

  get isHeld() {
    return this.held;
  }

  /** The provider is playing songs it picked itself. */
  get isAutoplaying() {
    return this.autoplaying;
  }

  /** The player's state. The first read after the song ends reports the end, once. */
  async getState(): Promise<PlaybackState> {
    const started = this.started;
    const state = await this.player.getState();
    const ended = state.status === 'idle' || !!state.autoplay;
    if (started && started === this.started && ended) {
      this.started = null;
      this.autoplaying = !!state.autoplay;
      this.onEnded(started, this.autoplaying);
    }
    return state;
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
