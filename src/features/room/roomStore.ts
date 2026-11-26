import { availabilityOf, canPlayOnHostPhone } from '@/domain/availability';
import {
  HOST_RECONNECT_GRACE_MS,
  nextHostPresence,
  type HostPresence,
} from '@/domain/host-presence';
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
  /** What presence says about the host's phone (src/domain/host-presence.ts). */
  host: HostPresence;
  /**
   * The room paused because the host was away past the grace period. It stays
   * paused, queue kept, until the returning host resumes.
   */
  pausedForHost: boolean;
  /** The service the room plays through after a switch. Null: the one it started with. */
  playsThrough: MusicProvider | null;
  /** The last switch, so everyone can be told while that song plays. */
  switched: { entryId: string; from: MusicProvider; to: MusicProvider } | null;
  /**
   * The queue ran out and this service kept playing songs it picked itself
   * (`report_playback_state` with status `autoplay`). Null otherwise.
   */
  autoplay: MusicProvider | null;
  /**
   * `room.ended` arrived: the host ended the room. Mock mode's stand-in for
   * the Realtime event; nothing plays or changes after it.
   */
  ended: boolean;
  /**
   * This phone can't reach the room (the Realtime channel dropped). Mock
   * mode's stand-in for the channel's `offline` status. It's this phone's
   * view, which is what the mock store is.
   */
  offline: boolean;
};

/**
 * Development previews of the room (docs/PRODUCT_SPEC.md §12, 4.1–4.3, plus
 * a low-confidence match and the Apple Music colors). `listener` and `apple` only change who's looking
 * or the service, so they share the real room's queue.
 */
export type RoomView =
  | 'listener'
  | 'empty'
  | 'unavailable'
  | 'uncertain'
  | 'apple'
  /** A listener, just after the host's phone dropped out. */
  | 'reconnecting'
  /** A listener, after the host has been away past the grace period. */
  | 'host-away'
  /** The host, back after the room paused without them. */
  | 'host-back';

/** Previews seen by the room's first listener rather than by you, the host. */
export const listenerViews: readonly RoomView[] = ['listener', 'reconnecting', 'host-away'];

/** Previews that get their own copy of the room, so trying them leaves the real room alone. */
const ownStateViews: readonly RoomView[] = [
  'empty',
  'unavailable',
  'uncertain',
  'reconnecting',
  'host-away',
  'host-back',
];

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

/**
 * The services the host's phone may start a queue song on, read from its
 * stored track matches (`availabilityOf`): an uncertain match counts, a
 * missing or unresolved one doesn't. This feeds `planSong`, so `standBy` is
 * the one path for "this song can't start".
 */
export function availableOn(entry: Pick<MockTrack, 'matches'>): MusicProvider[] {
  return (['spotify', 'apple_music'] as const).filter((provider) =>
    canPlayOnHostPhone(availabilityOf(entry.matches?.[provider])),
  );
}

/** What `enqueue_recording` answers. `queueLength` gives "Rain Down added · 8th in line". */
export type EnqueueResult =
  | { ok: true; entryId: string; playingNow: boolean; queueLength: number }
  | { ok: false; error: 'already_in_queue' };

/** Mock rooms open 1:40 into the song, like the Figma frames. */
export const MOCK_START_MS = 100_000;

/** Previews that change the queue get their own state, so trying them leaves the real room alone. */
export function roomKey({ code, view }: RoomRef): string {
  return view && ownStateViews.includes(view) ? `${code}~${view}` : code;
}

/** The sample room as a development preview shows it. */
export function previewRoom(room: MockRoom, view?: RoomView): MockRoom {
  switch (view) {
    case 'empty':
      return { ...room, nowPlaying: null, queue: [], people: room.people.slice(0, 1) };
    case 'unavailable':
      // "Phantom" isn't on Spotify, the service the sample room plays through.
      return { ...room, nowPlaying: mockQueue[2], queue: room.queue.slice(3) };
    case 'uncertain':
      // Spotify's closest "Way Bigger" is a low-confidence match.
      return { ...room, nowPlaying: mockQueue[4], queue: room.queue.slice(5) };
    case 'apple':
      return { ...room, playsThrough: 'apple_music' };
    default:
      return room;
  }
}

/** Where the host's phone stands when a room or preview is first read. */
function seedHost(
  view: RoomView | undefined,
  now: number,
): Pick<RoomState, 'host' | 'pausedForHost'> {
  switch (view) {
    case 'reconnecting':
      return { host: { present: false, lastSeenAt: now }, pausedForHost: false };
    case 'host-away':
      return {
        host: { present: false, lastSeenAt: now - HOST_RECONNECT_GRACE_MS - 1_000 },
        pausedForHost: true,
      };
    case 'host-back':
      return { host: { present: true, lastSeenAt: now }, pausedForHost: true };
    default:
      return { host: { present: true, lastSeenAt: now }, pausedForHost: false };
  }
}

function seed(ref: RoomRef, now: number): RoomState {
  const room = previewRoom(findRoom(ref.code), ref.view);
  const key = roomKey(ref);
  const entry = (track: MockTrack): RoomEntry => ({ ...track, entryId: `${key}/${track.id}` });
  return {
    nowPlaying: room.nowPlaying ? entry(room.nowPlaying) : null,
    queue: room.queue.map(entry),
    startAtMs: room.nowPlaying ? MOCK_START_MS : 0,
    rules: defaultRoomRules,
    ...seedHost(ref.view, now),
    playsThrough: null,
    switched: null,
    autoplay: null,
    ended: false,
    offline: false,
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;

/** `now` is the clock presence times use; tests pass their own. */
export function createRoomStore(now: () => number = Date.now) {
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
      room = seed(ref, now());
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

    /**
     * What Realtime Presence says about the host's phone. This is the input
     * the Realtime Broadcast and Presence card plugs in: call it on every
     * presence sync with `hostPresentIn(entries, hostUserId)`. In mock mode
     * the `/dev` toggle calls it. Repeating the same answer changes nothing.
     */
    /**
     * `room.ended` (Realtime): the host ended the room. Playback stops and
     * the queue stays as history. Returns false if it had ended already.
     */
    endRoom(ref: RoomRef): boolean {
      const room = get(ref);
      if (room.ended) return false;
      update(ref, { ...room, ended: true, autoplay: null });
      return true;
    },

    /**
     * This phone lost (or got back) its connection to the room. On the
     * host's phone that's the host leaving the room's presence, so the room
     * shows "Reconnecting" and pauses after the grace period, like the live
     * app (API_CONTRACTS.md §4).
     */
    setOffline(ref: RoomRef, offline: boolean, { isHost }: { isHost: boolean }) {
      const room = get(ref);
      if (room.offline === offline) return;
      const host = isHost ? nextHostPresence(room.host, !offline, now()) : room.host;
      update(ref, { ...room, offline, host });
    },

    setHostPresent(ref: RoomRef, present: boolean) {
      const room = get(ref);
      const host = nextHostPresence(room.host, present, now());
      if (host.present === room.host.present && host.lastSeenAt === room.host.lastSeenAt) return;
      if (present && room.host.present) return;
      update(ref, { ...room, host });
    },

    /**
     * The host has been away past the grace period: the room pauses, with the
     * queue kept (PRODUCT_SPEC.md §4). The server will record this as the
     * room's paused playback state. Returns false if it was already paused.
     */
    pauseForHost(ref: RoomRef): boolean {
      const room = get(ref);
      if (room.pausedForHost) return false;
      update(ref, { ...room, pausedForHost: true });
      return true;
    },

    /** The returning host resumes the room. Returns false if it wasn't paused for them. */
    resumeAfterHost(ref: RoomRef): boolean {
      const room = get(ref);
      if (!room.pausedForHost || !room.host.present) return false;
      update(ref, { ...room, pausedForHost: false });
      return true;
    },
  };
}
