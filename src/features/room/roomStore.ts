import type { MusicProvider } from '@/domain/music-provider';
import { checkSwitch, type SwitchError } from '@/domain/provider-switch';
import { defaultRoomRules, type RoomRules } from '@/domain/room-rules';
import { findRoom, mockQueue, type MockRoom, type MockTrack } from '@/providers/mock/data';

/**
 * Mock mode's stand-in for the room's rows in Postgres: what's playing,
 * what's next, and the room's rules. Its actions follow the RPCs in
 * docs/API_CONTRACTS.md (`enqueue_recording`, `reorder_queue`,
 * `remove_queue_entry`, `advance_queue`, `update_room_rules`), so the screens
 * call the same operations the real backend will offer. The Supabase cards
 * replace it; the server, not this store, will check who may do what.
 */

/** A song in a room's queue. Entries have their own id, so one song can be queued twice. */
export type RoomEntry = MockTrack & { entryId: string };

/** The parts of a room that change while it plays. */
export type RoomState = {
  nowPlaying: RoomEntry | null;
  queue: RoomEntry[];
  /** Where the host's player starts the now-playing song. */
  startAtMs: number;
  /** Who adds songs and who controls the music. */
  rules: RoomRules;
  /** The service the room plays through after a switch. Null: the one it started with. */
  playsThrough: MusicProvider | null;
  /** The last switch, so everyone can be told while that song plays. */
  switched: { entryId: string; from: MusicProvider; to: MusicProvider } | null;
  /**
   * The queue ran out and this service kept playing songs it picked itself
   * (`report_playback_state` with status `autoplay`). Null otherwise.
   */
  autoplay: MusicProvider | null;
};

/**
 * Development previews of the room (docs/PRODUCT_SPEC.md §12, 4.1–4.3, plus
 * the Apple Music colors). `listener` and `apple` only change who's looking
 * or the service, so they share the real room's queue.
 */
export type RoomView = 'listener' | 'empty' | 'unavailable' | 'apple';

export type RoomRef = { code: string; view?: RoomView };

export type AdvanceReason = 'ended' | 'skipped' | 'unavailable';

/** A host's request to switch the room's service, as `switch_playback_provider` takes it. */
export type SwitchRequest = {
  /** The song the host answered the prompt for. */
  forEntryId: string;
  to: MusicProvider;
  /**
   * What the server checks for itself in real mode: who's asking, whether the
   * song has started, the room's service and what the host has connected.
   */
  isHost: boolean;
  songStarted: boolean;
  playsThrough: MusicProvider;
  hostConnected: readonly MusicProvider[];
};

export type SwitchResult = { ok: true } | { ok: false; error: SwitchError };

/** The services a queue song is on. Mock songs say which one they're missing from. */
export function availableOn(entry: Pick<MockTrack, 'unavailableOn'>): MusicProvider[] {
  return (['spotify', 'apple_music'] as const).filter((p) => p !== entry.unavailableOn);
}

/** What `enqueue_recording` answers. `queueLength` gives "Rain Down added · 8th in line". */
export type EnqueueResult =
  | { ok: true; entryId: string; playingNow: boolean; queueLength: number }
  | { ok: false; error: 'already_in_queue' };

/** Mock rooms open 1:40 into the song, like the Figma frames. */
export const MOCK_START_MS = 100_000;

/** Previews that change the queue get their own state, so trying them leaves the real room alone. */
export function roomKey({ code, view }: RoomRef): string {
  return view === 'empty' || view === 'unavailable' ? `${code}~${view}` : code;
}

/** The sample room as a development preview shows it. */
export function previewRoom(room: MockRoom, view?: RoomView): MockRoom {
  switch (view) {
    case 'empty':
      return { ...room, nowPlaying: null, queue: [], people: room.people.slice(0, 1) };
    case 'unavailable':
      // "Phantom" isn't on Spotify, the service the sample room plays through.
      return { ...room, nowPlaying: mockQueue[2], queue: room.queue.slice(3) };
    case 'apple':
      return { ...room, playsThrough: 'apple_music' };
    default:
      return room;
  }
}

function seed(ref: RoomRef): RoomState {
  const room = previewRoom(findRoom(ref.code), ref.view);
  const key = roomKey(ref);
  const entry = (track: MockTrack): RoomEntry => ({ ...track, entryId: `${key}/${track.id}` });
  return {
    nowPlaying: room.nowPlaying ? entry(room.nowPlaying) : null,
    queue: room.queue.map(entry),
    startAtMs: room.nowPlaying ? MOCK_START_MS : 0,
    rules: defaultRoomRules,
    playsThrough: null,
    switched: null,
    autoplay: null,
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;

export function createRoomStore() {
  const rooms = new Map<string, RoomState>();
  const listeners = new Set<() => void>();
  let added = 0;

  /**
   * The room's current state. A room nobody has touched yet starts from the
   * sample data; that's deterministic, so filling it in on first read is safe.
   */
  const get = (ref: RoomRef): RoomState => {
    const key = roomKey(ref);
    let room = rooms.get(key);
    if (!room) {
      room = seed(ref);
      rooms.set(key, room);
    }
    return room;
  };

  const update = (ref: RoomRef, next: RoomState) => {
    rooms.set(roomKey(ref), next);
    listeners.forEach((listener) => listener());
  };

  return {
    get,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * `enqueue_recording`: adds the song at the end of the queue. A song
     * that's already queued or playing needs `allowDuplicate` (PRODUCT_SPEC.md
     * §5, "Already in queue"). With nothing playing, the song plays at once.
     */
    enqueue(
      ref: RoomRef,
      track: Omit<MockTrack, 'addedBy'>,
      addedBy: string,
      allowDuplicate = false,
    ): EnqueueResult {
      const room = get(ref);
      const present =
        room.nowPlaying?.id === track.id || room.queue.some((entry) => entry.id === track.id);
      if (present && !allowDuplicate) return { ok: false, error: 'already_in_queue' };
      added += 1;
      const entry: RoomEntry = { ...track, addedBy, entryId: `${roomKey(ref)}/added-${added}` };
      if (!room.nowPlaying) {
        // The queue takes over from provider autoplay.
        update(ref, { ...room, nowPlaying: entry, startAtMs: 0, autoplay: null });
        return {
          ok: true,
          entryId: entry.entryId,
          playingNow: true,
          queueLength: room.queue.length,
        };
      }
      const queue = [...room.queue, entry];
      update(ref, { ...room, queue });
      return { ok: true, entryId: entry.entryId, playingNow: false, queueLength: queue.length };
    },

    /**
     * `reorder_queue`: moves an entry to just after `afterEntryId`, or to the
     * top when it's null. Returns false if either entry isn't queued.
     */
    move(ref: RoomRef, entryId: string, afterEntryId: string | null): boolean {
      const room = get(ref);
      const moving = room.queue.find((e) => e.entryId === entryId);
      if (!moving || entryId === afterEntryId) return false;
      const rest = room.queue.filter((e) => e.entryId !== entryId);
      const at = afterEntryId === null ? 0 : rest.findIndex((e) => e.entryId === afterEntryId) + 1;
      if (at === 0 && afterEntryId !== null) return false;
      update(ref, { ...room, queue: [...rest.slice(0, at), moving, ...rest.slice(at)] });
      return true;
    },

    /** `remove_queue_entry`. Returns false if the entry isn't queued. */
    remove(ref: RoomRef, entryId: string): boolean {
      const room = get(ref);
      if (!room.queue.some((e) => e.entryId === entryId)) return false;
      update(ref, { ...room, queue: room.queue.filter((e) => e.entryId !== entryId) });
      return true;
    },

    /**
     * `advance_queue`: the next queued song becomes now playing. Returns false
     * when `fromEntryId` isn't playing anymore (`stale_state`), so a double
     * tap on Skip, or two screens noticing the same song end, moves on once.
     *
     * `autoplay`: the service that kept playing on its own when the song
     * ended (see `src/domain/autoplay`). It only counts when nothing is
     * queued: a queued song always comes first.
     */
    advance(
      ref: RoomRef,
      fromEntryId: string,
      reason: AdvanceReason,
      autoplay: MusicProvider | null = null,
    ): boolean {
      const room = get(ref);
      if (room.nowPlaying?.entryId !== fromEntryId) return false;
      const [next = null, ...rest] = room.queue;
      update(ref, {
        ...room,
        nowPlaying: next,
        queue: rest,
        startAtMs: 0,
        autoplay: !next && reason === 'ended' ? autoplay : null,
      });
      return true;
    },

    /** `report_playback_state` leaving `autoplay`: the provider stopped picking songs. */
    stopAutoplay(ref: RoomRef) {
      const room = get(ref);
      if (room.autoplay) update(ref, { ...room, autoplay: null });
    },

    /**
     * `switch_playback_provider`: the host answers the prompt for a song
     * that isn't on the room's service by switching to one it's on. Only the
     * host, only for the song that's up, and only before it starts
     * (`src/domain/provider-switch`). The room keeps the new service for the
     * songs after it. A repeat of the same answer changes nothing.
     */
    switchProvider(ref: RoomRef, request: SwitchRequest): SwitchResult {
      const room = get(ref);
      const song = room.nowPlaying;
      const check = checkSwitch({
        ...request,
        upEntryId: song?.entryId ?? null,
        availableOn: song ? availableOn(song) : [],
      });
      if (!check.ok) return check;
      update(ref, {
        ...room,
        playsThrough: check.to,
        switched: { entryId: request.forEntryId, from: check.from, to: check.to },
        // The song hasn't started, so it plays from the top through the new service.
        startAtMs: 0,
      });
      return { ok: true };
    },

    /**
     * `update_room_rules`: the host changes who adds songs and who controls
     * the music. `create_room` sets them too, from Start a room.
     */
    setRules(ref: RoomRef, rules: RoomRules) {
      update(ref, { ...get(ref), rules });
    },
  };
}
