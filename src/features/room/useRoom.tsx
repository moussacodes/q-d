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

import type { MusicProvider } from '@/domain/music-provider';
import { planSong, type SongPlan } from '@/domain/provider-switch';
import { allows, type RoomRules } from '@/domain/room-rules';
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

import { RoomPlayer } from './RoomPlayer';
import {
  availableOn,
  createRoomStore,
  previewRoom,
  roomKey,
  type RoomEntry,
  type RoomRef,
  type RoomState,
  type RoomStore,
  type RoomView,
} from './roomStore';

export type { EnqueueResult, RoomEntry, RoomView } from './roomStore';

/** A room as everyone in it sees it right now. */
export type LiveRoom = Omit<MockRoom, 'nowPlaying' | 'queue'> & {
  nowPlaying: RoomEntry | null;
  queue: RoomEntry[];
  /** Who adds songs and who controls the music. */
  rules: RoomRules;
  /** The room's last service switch, to tell everyone while that song plays. */
  switched: RoomState['switched'];
  /** The development preview being shown, if any. Sheets open with the same one. */
  view?: RoomView;
};

/** Route params for the room and its sheets, keeping the development preview. */
export function roomParams(room: Pick<LiveRoom, 'code' | 'view'>) {
  return room.view ? { code: room.code, view: room.view } : { code: room.code };
}

/** A catalog search result as a queue song, played through the room's service. */
export function trackFromResult(
  { track, availableOn }: CatalogResult,
  playsThrough: MusicProvider,
): Omit<MockTrack, 'addedBy'> {
  const missing = (['apple_music', 'spotify'] as const).find((p) => !availableOn.includes(p));
  return {
    id: track.providerTrackId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: formatDuration(track.durationMs),
    provider: playsThrough,
    // Mock catalog songs always carry Apple's color; grey is the Figma "Rebel" fallback.
    artworkColor: track.artworkBackgroundColor ?? '#5a5a5a',
    ...(missing ? { unavailableOn: missing } : {}),
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
    player = new RoomPlayer(createPlayback, room.playsThrough, (entryId) =>
      store.advance(ref, entryId, 'ended'),
    );
    players.set(key, player);
  }
  return player;
}

const noRoom = () => () => {};

/** Who's looking: you, or in the listener preview, the room's first listener. */
function viewerOf(room: MockRoom, view?: RoomView): MockPerson | undefined {
  return view === 'listener'
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
  // A switch changes the service; otherwise the room keeps the one it started with.
  const playsThrough = state?.playsThrough ?? (base ? previewRoom(base, view).playsThrough : null);
  // The host's phone plays through the room's service. If you host this room
  // and that service isn't connected on this phone any more, the music holds
  // until it's reconnected (docs/DECISIONS.md, "Music-service settings").
  const { connected } = useProviderConnections();
  const youHost = !!base?.youHost;
  const serviceMissing = youHost && !!playsThrough && !connected.includes(playsThrough);
  // What the host's phone can do with the song that's up. Mock mode knows the
  // host's services only when you're the host; another host is assumed to
  // have just the room's.
  const plan = useMemo<SongPlan | null>(
    () =>
      nowPlaying && playsThrough
        ? planSong({
            playsThrough,
            availableOn: availableOn(nowPlaying),
            hostConnected: youHost ? connected : [playsThrough],
          })
        : null,
    [nowPlaying, playsThrough, youHost, connected],
  );
  // A song that isn't on the room's service never starts: it waits for the
  // host to skip it or switch, which is "between songs" by construction.
  const holding = serviceMissing || (plan !== null && plan.kind !== 'play');
  const { refresh } = playback;
  useEffect(() => {
    if (!player || !playsThrough) return;
    const next = holding
      ? player.hold(nowPlaying)
      : player.load(nowPlaying, startAtMs, playsThrough);
    next.then(refresh);
  }, [player, nowPlaying, startAtMs, playsThrough, holding, refresh]);

  const room = useMemo<LiveRoom | null>(() => {
    if (!base || !state || !playsThrough) return null;
    return {
      ...previewRoom(base, view),
      playsThrough,
      nowPlaying: state.nowPlaying,
      queue: state.queue,
      rules: state.rules,
      switched: state.switched,
      ...(view ? { view } : {}),
    };
  }, [base, view, state, playsThrough]);
  const you = room ? viewerOf(room, view) : undefined;

  // Until the player has the new song (just after a skip), show it from the start.
  const loaded = nowPlaying !== null && playback.state.track?.providerTrackId === nowPlaying.id;
  const shown: Playback =
    nowPlaying && !loaded
      ? { ...playback, positionMs: 0, progress: 0, durationMs: parseDuration(nowPlaying.duration) }
      : playback;
  const canControl = !!room && allows(room.rules.control, you);

  return {
    room,
    playback: shown,
    ref,
    /** You in this room's `people`. */
    you,
    /** The room's add-songs rule lets you in. */
    canAdd: !!room && allows(room.rules.addSongs, you),
    /** The room's rules let you play, pause, skip, reorder and remove. */
    canControl,
    /** Play and pause work only while the host's phone can play the song that's up. */
    canPlay: canControl && !holding,
    /**
     * You host this room, but the service it plays through isn't connected on
     * this phone, so nothing can play until it's reconnected.
     */
    serviceMissing,
    /** What the host's phone can do with the song that's up; null with nothing up. */
    plan,
    /** The song that's up has started, so its service can't change any more. */
    songStarted: loaded && playback.state.status !== 'idle',
    hostConnected: connected,
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
    canPlay,
    serviceMissing,
    plan,
    songStarted,
    hostConnected,
  } = useLiveRoom(base, view);
  // There's always a room here: an unknown code shows the sample room.
  const live = room!;
  const at = ref!;
  const index = (entryId: string) => live.queue.findIndex((e) => e.entryId === entryId);
  const isHost = view === 'listener' ? false : live.youHost;

  return {
    room: live,
    playback,
    /**
     * Only the host invites, sets the rules and plays through their service.
     * Who adds songs and who controls the music follow the rules (PRODUCT_SPEC.md §4).
     */
    isHost,
    you,
    canAdd,
    canControl,
    canPlay,
    serviceMissing,
    plan,
    /** The services you have connected; the host's, when you host. */
    hostConnected,
    /**
     * `switch_playback_provider`: the host's answer to "Not on Spotify" when
     * the song is on another service they've connected. Refused for anyone
     * else, mid-song, or for a song that's no longer up.
     */
    switchProvider: (to: MusicProvider) =>
      live.nowPlaying
        ? store.switchProvider(at, {
            forEntryId: live.nowPlaying.entryId,
            to,
            isHost,
            songStarted,
            playsThrough: live.playsThrough,
            hostConnected,
          })
        : ({ ok: false, error: 'stale_state' } as const),
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
  const { room, playback, canControl, canPlay } = useLiveRoom(activeRoom);
  return { room, playback, canControl, canPlay };
}

/**
 * `create_room`: start hosting with the name, service and rules chosen on
 * Start a room. The room plays through `playsThrough` on this phone.
 */
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
