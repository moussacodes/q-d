import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { hostStatus, type HostStatus } from '@/domain/host-presence';
import type { MusicProvider } from '@/domain/music-provider';
import { allows, type RoomRules } from '@/domain/room-rules';
import { formatArtists } from '@/domain/recording';
import { formatDuration, parseDuration } from '@/domain/time';
import { useProviderConnections } from '@/features/connections/ProviderConnections';
import { usePlayback, type Playback } from '@/features/playback/usePlayback';
import { useMockSession } from '@/features/session/MockSession';
import { createPlayback, type CatalogResult } from '@/providers';
import {
  findRoom,
  mockUser,
  type MockPerson,
  type MockRoom,
  type MockTrack,
} from '@/providers/mock/data';

import { entryAvailability } from './availability';
import { RoomPlayer } from './RoomPlayer';
import {
  createRoomStore,
  listenerViews,
  previewRoom,
  roomKey,
  type RoomEntry,
  type RoomRef,
  type RoomStore,
  type RoomView,
} from './roomStore';

export type { EnqueueResult, RoomEntry, RoomView } from './roomStore';
export {
  availabilityLabel,
  entryAvailability,
  queueNote,
  resultAvailability,
} from './availability';

/** A room as everyone in it sees it right now. */
export type LiveRoom = Omit<MockRoom, 'nowPlaying' | 'queue'> & {
  nowPlaying: RoomEntry | null;
  queue: RoomEntry[];
  /** Who adds songs and who controls the music. */
  rules: RoomRules;
  /** The development preview being shown, if any. Sheets open with the same one. */
  view?: RoomView;
};

/** Route params for the room and its sheets, keeping the development preview. */
export function roomParams(room: Pick<LiveRoom, 'code' | 'view'>) {
  return room.view ? { code: room.code, view: room.view } : { code: room.code };
}

/** A catalog search result as a queue song, played through the room's service. */
export function trackFromResult(
  { track, availableOn, matches }: CatalogResult,
  playsThrough: MusicProvider,
): Omit<MockTrack, 'addedBy'> {
  const missing = (['apple_music', 'spotify'] as const).find((p) => !availableOn.includes(p));
  return {
    id: track.providerTrackId,
    title: track.title,
    artist: formatArtists(track.artists),
    album: track.album ?? '',
    duration: formatDuration(track.durationMs),
    provider: playsThrough,
    // Mock catalog songs always carry Apple's color; grey is the Figma "Rebel" fallback.
    artworkColor: track.artworkBackgroundColor ?? '#5a5a5a',
    ...(missing ? { unavailableOn: missing } : {}),
    ...(matches ? { matches } : {}),
  };
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

/** The clock, ticking every second while `ticking`, for the reconnecting countdown. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    // A stale first value only shows more time left: away time is never negative.
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

const isListenerView = (view?: RoomView) => !!view && listenerViews.includes(view);

/** Who's looking: you, or in a listener preview, the room's first listener. */
function viewerOf(room: MockRoom, view?: RoomView): MockPerson | undefined {
  return isListenerView(view)
    ? room.people.find((person) => !person.isHost)
    : room.people.find((person) => person.id === mockUser.id);
}

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

  // "Host reconnecting" for the grace period, then the room pauses (PRODUCT_SPEC.md §4).
  const hostPresent = state?.host.present ?? true;
  const now = useNow(!hostPresent);
  const host: HostStatus = state ? hostStatus(state.host, now) : { kind: 'connected' };
  const away = host.kind === 'away';
  const pausedForHost = state?.pausedForHost ?? false;
  useEffect(() => {
    if (ref && away) store.pauseForHost(ref);
  }, [ref, away, store]);
  // You host this room, but the service it plays through isn't connected on
  // your phone any more (disconnected in Settings): nothing can play.
  const { connections } = useProviderConnections();
  const serviceMissing = !!base?.youHost && !connections[base.playsThrough];
  const held = away || pausedForHost || serviceMissing;
  useEffect(() => {
    if (!player || player.isHeld === held) return;
    player.hold(held).then(refresh);
  }, [player, held, refresh]);

  const room = useMemo<LiveRoom | null>(() => {
    if (!base || !state) return null;
    return {
      ...previewRoom(base, view),
      nowPlaying: state.nowPlaying,
      queue: state.queue,
      rules: state.rules,
      ...(view ? { view } : {}),
    };
  }, [base, view, state]);
  const you = room ? viewerOf(room, view) : undefined;

  // Until the player has the new song (just after a skip), show it from the start.
  const loaded = nowPlaying !== null && playback.state.track?.providerTrackId === nowPlaying.id;
  const shown: Playback =
    nowPlaying && !loaded
      ? { ...playback, positionMs: 0, progress: 0, durationMs: parseDuration(nowPlaying.duration) }
      : playback;

  return {
    room,
    playback: shown,
    ref,
    /** You in this room's `people`. */
    you,
    /** The room's add-songs rule lets you in. */
    canAdd: !!room && allows(room.rules.addSongs, you),
    /** The room's rules let you play, pause, skip, reorder and remove. */
    canControl: !!room && allows(room.rules.control, you),
    /** Whether the host's phone is in the room. */
    host,
    /** The room paused while the host was away, until the host resumes. */
    pausedForHost,
    /** You host, and the room's service isn't connected on your phone. */
    serviceMissing,
    /**
     * The host resumes after coming back. Mock mode's store is already the
     * room's state; the real app refetches the room first (API_CONTRACTS.md §4).
     */
    resumeAfterHost: async () => {
      if (!ref || !player || serviceMissing || !store.resumeAfterHost(ref)) return;
      await player.hold(false);
      await player.play();
      await refresh();
    },
  };
}

/**
 * The room you're looking at: its live queue, its player, and the host's
 * queue actions. With `view`, a development preview of it.
 */
export function useRoom(code: string | undefined, view?: RoomView) {
  const { activeRoom, user } = useMockSession();
  // The room you started or joined, with the name and service you chose.
  const base = activeRoom && activeRoom.code === code ? activeRoom : findRoom(code);
  const { store } = useRooms();
  const {
    room,
    playback,
    ref,
    you,
    canAdd,
    canControl,
    host,
    pausedForHost,
    serviceMissing,
    resumeAfterHost,
  } = useLiveRoom(base, view);
  // There's always a room here: an unknown code shows the sample room.
  const live = room!;
  const at = ref!;
  const index = (entryId: string) => live.queue.findIndex((e) => e.entryId === entryId);

  return {
    room: live,
    playback,
    /**
     * Only the host invites, sets the rules and plays through their service.
     * Who adds songs and who controls the music follow the rules (PRODUCT_SPEC.md §4).
     */
    isHost: isListenerView(view) ? false : live.youHost,
    you,
    canAdd,
    canControl,
    /**
     * How the playing song stands on the room's service: playable, an
     * uncertain match (plays with a warning), unavailable or unresolved.
     */
    host,
    pausedForHost,
    serviceMissing,
    resumeAfterHost,
    nowPlayingAvailability: live.nowPlaying
      ? entryAvailability(live.nowPlaying, live.playsThrough)
      : null,
    /** `update_room_rules`. Only the host sees the controls for it. */
    setRules: (rules: RoomRules) => store.setRules(at, rules),
    skip: () => {
      if (live.nowPlaying) store.advance(at, live.nowPlaying.entryId, 'skipped');
    },
    moveUp: (entryId: string) => {
      const i = index(entryId);
      if (i < 1) return;
      store.move(at, entryId, i === 1 ? null : live.queue[i - 2].entryId);
    },
    moveDown: (entryId: string) => {
      const i = index(entryId);
      if (i < 0 || i >= live.queue.length - 1) return;
      store.move(at, entryId, live.queue[i + 1].entryId);
    },
    remove: (entryId: string) => {
      store.remove(at, entryId);
    },
    /**
     * Adds a song; the screens offer it only when `canAdd`. A song that's
     * already queued or playing comes back as `already_in_queue` unless
     * `allowDuplicate` confirms it.
     */
    add: (result: CatalogResult, allowDuplicate = false) =>
      store.enqueue(at, trackFromResult(result, live.playsThrough), user.name, allowDuplicate),
    /** Undo on the "added" toast: takes back your own song while it's still queued. */
    undoAdd: (entryId: string) => {
      store.remove(at, entryId);
    },
  };
}

export type RoomHandle = ReturnType<typeof useRoom>;

/** The room you're in, for the mini player on Home and Settings. Null when you aren't in one. */
export function useActiveRoom() {
  const { activeRoom } = useMockSession();
  const { room, playback, canControl, host, pausedForHost, serviceMissing } =
    useLiveRoom(activeRoom);
  /**
   * Playback waits for the host's phone, for the returning host to resume in
   * the room, or for you, the host, to connect the room's service again.
   */
  const waitingForHost = host.kind !== 'connected' || pausedForHost || serviceMissing;
  return { room, playback, canControl, host, pausedForHost, waitingForHost };
}

/**
 * `create_room`: start hosting with the name, service and rules chosen on
 * Start a room. The room plays through `playsThrough` on this phone.
 */
/**
 * Mock mode's stand-in for Realtime Presence: says whether the host's phone
 * is in the room `code`. The `/dev` toggle uses it to show a host who
 * disappears and comes back.
 */
export function useMockHostPresence() {
  const { store } = useRooms();
  return useCallback(
    (code: string, present: boolean) => store.setHostPresent({ code }, present),
    [store],
  );
}

export function useStartRoom() {
  const { store } = useRooms();
  const { startRoom } = useMockSession();
  return useCallback(
    (
      code: string,
      { rules, ...room }: { name: string; playsThrough: MusicProvider; rules: RoomRules },
    ) => {
      store.setRules({ code }, rules);
      startRoom(code, room);
    },
    [store, startRoom],
  );
}
