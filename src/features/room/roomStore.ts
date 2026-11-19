import { findRoom, mockQueue, type MockRoom, type MockTrack } from '@/providers/mock/data';

/**
 * Mock mode's stand-in for the room's rows in Postgres: what's playing and
 * what's next. Its actions follow the queue RPCs in docs/API_CONTRACTS.md
 * (`enqueue_recording`, `reorder_queue`, `remove_queue_entry`, `advance_queue`),
 * so the screens call the same operations the real backend will offer. The
 * Supabase cards replace it; the server, not this store, will check who may
 * do what.
 */

/** A song in a room's queue. Entries have their own id, so one song can be queued twice. */
export type RoomEntry = MockTrack & { entryId: string };

/** The parts of a room that change while it plays. */
export type RoomQueue = {
  nowPlaying: RoomEntry | null;
  queue: RoomEntry[];
  /** Where the host's player starts the now-playing song. */
  startAtMs: number;
};

/**
 * Development previews of the room (docs/PRODUCT_SPEC.md §12, 4.1–4.3, plus
 * the Apple Music colors). `listener` and `apple` only change who's looking
 * or the service, so they share the real room's queue.
 */
export type RoomView = 'listener' | 'empty' | 'unavailable' | 'apple';

export type RoomRef = { code: string; view?: RoomView };

export type AdvanceReason = 'ended' | 'skipped' | 'unavailable';

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

function seed(ref: RoomRef): RoomQueue {
  const room = previewRoom(findRoom(ref.code), ref.view);
  const key = roomKey(ref);
  const entry = (track: MockTrack): RoomEntry => ({ ...track, entryId: `${key}/${track.id}` });
  return {
    nowPlaying: room.nowPlaying ? entry(room.nowPlaying) : null,
    queue: room.queue.map(entry),
    startAtMs: room.nowPlaying ? MOCK_START_MS : 0,
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;

export function createRoomStore() {
  const rooms = new Map<string, RoomQueue>();
  const listeners = new Set<() => void>();
  let added = 0;

  /**
   * The room's current state. A room nobody has touched yet starts from the
   * sample data; that's deterministic, so filling it in on first read is safe.
   */
  const get = (ref: RoomRef): RoomQueue => {
    const key = roomKey(ref);
    let room = rooms.get(key);
    if (!room) {
      room = seed(ref);
      rooms.set(key, room);
    }
    return room;
  };

  const update = (ref: RoomRef, next: RoomQueue) => {
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
        update(ref, { nowPlaying: entry, queue: room.queue, startAtMs: 0 });
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
     */
    advance(ref: RoomRef, fromEntryId: string, _reason: AdvanceReason): boolean {
      const room = get(ref);
      if (room.nowPlaying?.entryId !== fromEntryId) return false;
      const [next = null, ...rest] = room.queue;
      update(ref, { nowPlaying: next, queue: rest, startAtMs: 0 });
      return true;
    },
  };
}
