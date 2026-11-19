import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { parseDuration } from '@/domain/time';
import { usePlayback, type Playback } from '@/features/playback/usePlayback';
import { useMockSession } from '@/features/session/MockSession';
import { createPlayback } from '@/providers';
import { findRoom, type MockRoom } from '@/providers/mock/data';

import { RoomPlayer } from './RoomPlayer';
import {
  createRoomStore,
  previewRoom,
  roomKey,
  type RoomEntry,
  type RoomRef,
  type RoomStore,
  type RoomView,
} from './roomStore';

export type { RoomEntry, RoomView } from './roomStore';

/** A room as everyone in it sees it right now. */
export type LiveRoom = Omit<MockRoom, 'nowPlaying' | 'queue'> & {
  nowPlaying: RoomEntry | null;
  queue: RoomEntry[];
  /** The development preview being shown, if any. Sheets open with the same one. */
  view?: RoomView;
};

/** Route params for the room and its sheets, keeping the development preview. */
export function roomParams(room: Pick<LiveRoom, 'code' | 'view'>) {
  return room.view ? { code: room.code, view: room.view } : { code: room.code };
}

type Rooms = { store: RoomStore; players: Map<string, RoomPlayer> };

const RoomsContext = createContext<Rooms | null>(null);

/**
 * Holds every room's queue (mock mode's stand-in for Postgres) and, on the
 * host's phone, each room's player. Mock mode plays the host's part for
 * every room, so listeners still see a song progress.
 */
export function RoomsProvider({ children }: { children: ReactNode }) {
  const [rooms] = useState<Rooms>(() => ({ store: createRoomStore(), players: new Map() }));
  return <RoomsContext.Provider value={rooms}>{children}</RoomsContext.Provider>;
}

function useRooms() {
  const rooms = useContext(RoomsContext);
  if (!rooms) {
    throw new Error('useRoom must be used inside <RoomsProvider>');
  }
  return rooms;
}

function playerFor({ store, players }: Rooms, ref: RoomRef, room: MockRoom) {
  const key = roomKey(ref);
  let player = players.get(key);
  if (!player) {
    player = new RoomPlayer(createPlayback(room.playsThrough), (entryId) =>
      store.advance(ref, entryId, 'ended'),
    );
    players.set(key, player);
  }
  return player;
}

const noRoom = () => () => {};

function useLiveRoom(base: MockRoom | null, view?: RoomView) {
  const rooms = useRooms();
  const { store } = rooms;
  const code = base?.code;
  const ref = useMemo<RoomRef | null>(() => (code ? { code, view } : null), [code, view]);

  const state = useSyncExternalStore(ref ? store.subscribe : noRoom, () =>
    ref ? store.get(ref) : null,
  );
  const player = ref && base ? playerFor(rooms, ref, base) : null;
  const playback = usePlayback(player);

  const nowPlaying = state?.nowPlaying ?? null;
  const startAtMs = state?.startAtMs ?? 0;
  const { refresh } = playback;
  useEffect(() => {
    if (!player) return;
    player.load(nowPlaying, startAtMs).then(refresh);
  }, [player, nowPlaying, startAtMs, refresh]);

  const room = useMemo<LiveRoom | null>(() => {
    if (!base || !state) return null;
    return {
      ...previewRoom(base, view),
      nowPlaying: state.nowPlaying,
      queue: state.queue,
      ...(view ? { view } : {}),
    };
  }, [base, view, state]);

  // Until the player has the new song (just after a skip), show it from the start.
  const loaded = nowPlaying !== null && playback.state.track?.providerTrackId === nowPlaying.id;
  const shown: Playback =
    nowPlaying && !loaded
      ? { ...playback, positionMs: 0, progress: 0, durationMs: parseDuration(nowPlaying.duration) }
      : playback;

  return { room, playback: shown, ref };
}

/**
 * The room you're looking at: its live queue, its player, and the host's
 * queue actions. With `view`, a development preview of it.
 */
export function useRoom(code: string | undefined, view?: RoomView) {
  const { activeRoom } = useMockSession();
  // The room you started or joined, with the name and service you chose.
  const base = activeRoom && activeRoom.code === code ? activeRoom : findRoom(code);
  const { store } = useRooms();
  const { room, playback, ref } = useLiveRoom(base, view);
  const live = room!;
  const at = (entryId: string) => live.queue.findIndex((e) => e.entryId === entryId);

  return {
    room: live,
    playback,
    /** Only the host plays, skips, reorders and removes (PRODUCT_SPEC.md §4). */
    isHost: view === 'listener' ? false : live.youHost,
    skip: () => {
      if (ref && live.nowPlaying) store.advance(ref, live.nowPlaying.entryId, 'skipped');
    },
    moveUp: (entryId: string) => {
      const index = at(entryId);
      if (!ref || index < 1) return;
      store.move(ref, entryId, index === 1 ? null : live.queue[index - 2].entryId);
    },
    moveDown: (entryId: string) => {
      const index = at(entryId);
      if (!ref || index < 0 || index >= live.queue.length - 1) return;
      store.move(ref, entryId, live.queue[index + 1].entryId);
    },
    remove: (entryId: string) => {
      if (ref) store.remove(ref, entryId);
    },
  };
}

export type RoomHandle = ReturnType<typeof useRoom>;

/** The room you're in, for the mini player on Home and Settings. Null when you aren't in one. */
export function useActiveRoom() {
  const { activeRoom } = useMockSession();
  const { room, playback } = useLiveRoom(activeRoom);
  return { room, playback };
}
