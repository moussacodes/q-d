import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { MusicProvider } from '@/domain/music-provider';
import { inviteLink } from '@/domain/invite';
import { allows, type RoomRules } from '@/domain/room-rules';
import type { RpcError } from '@/domain/rpc-error';
import { formatDuration, parseDuration } from '@/domain/time';
import { usePlayback, type Playback } from '@/features/playback/usePlayback';
import { useMockSession } from '@/features/session/MockSession';
import { createPlayback, type CatalogResult } from '@/providers';
import {
  findRoom,
  mockRooms,
  mockUser,
  type MockPerson,
  type MockRoom,
  type MockTrack,
} from '@/providers/mock/data';

import { MockRoomServer, newIdempotencyKey, type RoomInvite } from './mockServer';
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

export type { EnqueueResult, RoomEntry, RoomView } from './roomStore';
export type { MockRoom } from '@/providers/mock/data';

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

type Rooms = {
  store: RoomStore;
  players: Map<string, RoomPlayer>;
  server: MockRoomServer;
  /**
   * The invite this phone made for each room it hosts. The server keeps only
   * a hash of the token, so the host's phone is the one place it can be read
   * again.
   */
  invites: Map<string, RoomInvite>;
};

const RoomsContext = createContext<Rooms | null>(null);

/**
 * Holds every room's queue (mock mode's stand-in for Postgres) and, on the
 * host's phone, each room's player. Mock mode plays the host's part for
 * every room, so listeners still see a song progress.
 */
export function RoomsProvider({ children }: { children: ReactNode }) {
  const [rooms] = useState<Rooms>(() => ({
    store: createRoomStore(),
    players: new Map(),
    server: new MockRoomServer(),
    invites: new Map(),
  }));
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
  const { room, playback, ref, you, canAdd, canControl } = useLiveRoom(base, view);
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
    isHost: view === 'listener' ? false : live.youHost,
    you,
    canAdd,
    canControl,
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
  const { room, playback, canControl } = useLiveRoom(activeRoom);
  return { room, playback, canControl };
}

/** Rooms you've been in, newest first, for Home. Mock mode shows the sample rooms. */
export function useRecentRooms(): MockRoom[] {
  return mockRooms;
}

/** Where a call to the server is: not started, waiting for its answer, or failed with an error. */
export type CallState =
  { status: 'idle' } | { status: 'pending' } | { status: 'failed'; error: RpcError };

const idle: CallState = { status: 'idle' };

/**
 * One server call at a time: while one is pending, another tap does nothing,
 * so a double tap can't send two. Each tap gets its own idempotency key.
 */
function useCall<A, T>(
  call: (
    args: A,
    idempotencyKey: string,
  ) => Promise<{ ok: true; value: T } | { ok: false; error: RpcError }>,
) {
  const [state, setState] = useState<CallState>(idle);
  const busy = useRef(false);
  const run = useCallback(
    async (args: A): Promise<T | null> => {
      if (busy.current) return null;
      busy.current = true;
      setState({ status: 'pending' });
      try {
        const result = await call(args, newIdempotencyKey());
        setState(result.ok ? idle : { status: 'failed', error: result.error });
        return result.ok ? result.value : null;
      } catch {
        // A call that throws (not an RPC error) must not leave the button
        // stuck on busy. The RPC cards map unexpected errors to copy.
        setState(idle);
        return null;
      } finally {
        busy.current = false;
      }
    },
    [call],
  );
  const reset = useCallback(() => setState(idle), []);
  return { state, run, reset };
}

/**
 * `join_room_by_code` from Home. On success you're in the room and `join`
 * returns `{ code }` (`QD-…`); on failure it returns null and `state` holds
 * the error.
 */
export function useJoinRoom() {
  const { server } = useRooms();
  const { enterRoom } = useMockSession();
  const call = useCallback(
    async (code: string, idempotencyKey: string) => {
      const result = await server.joinRoomByCode({ code, idempotencyKey });
      if (result.ok) enterRoom(result.value.code);
      return result;
    },
    [server, enterRoom],
  );
  const { state, run, reset } = useCall(call);
  return { state, join: run, reset };
}

/**
 * `create_room`: start hosting with the name, service and rules chosen on
 * Start a room. The room is always `aux` and plays through `playsThrough` on
 * this phone. On success `start` returns `{ code }`; on failure, null.
 */
export function useStartRoom() {
  const { store, server } = useRooms();
  const { startRoom } = useMockSession();
  const call = useCallback(
    async (
      {
        name,
        playsThrough,
        rules,
      }: { name: string; playsThrough: MusicProvider | null; rules: RoomRules },
      idempotencyKey: string,
    ) => {
      const trimmed = name.trim();
      const result = await server.createRoom({
        name: trimmed,
        playbackProvider: playsThrough,
        rules,
        mode: 'aux',
        idempotencyKey,
      });
      if (result.ok && playsThrough) {
        store.setRules({ code: result.value.code }, rules);
        startRoom(result.value.code, { name: trimmed, playsThrough });
      }
      return result;
    },
    [server, store, startRoom],
  );
  const { state, run } = useCall(call);
  return { state, start: run };
}

/**
 * `join_room_by_invite`, for a scanned QR code or a shared link. On success
 * you're in the room and `join` returns `{ code }`.
 */
export function useJoinByInvite() {
  const { server } = useRooms();
  const { enterRoom } = useMockSession();
  const call = useCallback(
    async (token: string, idempotencyKey: string) => {
      const result = await server.joinRoomByInvite({ token, idempotencyKey });
      if (result.ok) enterRoom(result.value.code);
      return result;
    },
    [server, enterRoom],
  );
  const { state, run } = useCall(call);
  return { state, join: run };
}

/**
 * The host's invite for a room: the link the QR code encodes, Copy link
 * copies and Share sends. Opening Invite reuses the link this phone already
 * made; the first time, it calls `create_room_invite`. `replace` makes a new
 * one, and the old link and QR code stop working. Nothing happens for
 * someone who isn't the host.
 */
export function useRoomInvite(roomCode: string, isHost: boolean) {
  const { server, invites } = useRooms();
  // A kept invite that has expired would draw a QR code that no longer works.
  const current = () => {
    const kept = invites.get(roomCode);
    return kept && Date.parse(kept.expiresAt) > Date.now() ? kept : null;
  };
  const [invite, setInvite] = useState<RoomInvite | null>(current);
  const call = useCallback(
    async (_: void, idempotencyKey: string) => {
      const result = await server.createRoomInvite({ roomCode, asHost: isHost, idempotencyKey });
      if (result.ok) {
        invites.set(roomCode, result.value);
        setInvite(result.value);
      }
      return result;
    },
    [server, invites, roomCode, isHost],
  );
  const { state, run } = useCall(call);

  useEffect(() => {
    if (isHost && !invite) run();
  }, [isHost, invite, roomCode, run]);

  return {
    /** Null until the first invite exists. */
    link: invite ? inviteLink(invite.token) : null,
    token: invite?.token ?? null,
    state,
    /** Try again after an error, or make a new link that replaces the old one. */
    replace: () => run(),
  };
}
