import { useQueryClient } from '@tanstack/react-query';
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
import { afterQueueEnds } from '@/domain/autoplay';
import { planSong, type SongPlan } from '@/domain/provider-switch';
import { inviteLink } from '@/domain/invite';
import { allows, type RoomRules } from '@/domain/room-rules';
import { formatArtists } from '@/domain/recording';
import { formatDuration, parseDuration } from '@/domain/time';
import { useProviderConnections } from '@/features/connections/ProviderConnections';
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

import { entryAvailability } from './availability';
import { MockRoomServer, type RoomInvite } from './mockServer';
import { RoomPlayer } from './RoomPlayer';
import {
  forgetLiveInvites,
  roomsAreLive,
  useServerActiveRoom,
  useServerJoinByInvite,
  useServerJoinRoom,
  useServerRecentRooms,
  useServerRoom,
  useServerRoomInvite,
  useServerRoomStatus,
  useServerStartRoom,
  type ActiveRoom,
} from './liveRoom';
import type { AddOutcome, RoomStatus } from './roomHandle';
import { useCall } from './useCall';
import {
  availableOn,
  createRoomStore,
  listenerViews,
  previewRoom,
  roomKey,
  type RoomEntry,
  type RoomRef,
  type RoomState,
  type RoomStore,
  type RoomView,
} from './roomStore';

export type { EnqueueResult, RoomEntry, RoomView } from './roomStore';
export type { AddOutcome, RoomStatus } from './roomHandle';
export type { MockRoom } from '@/providers/mock/data';
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
  /** The room's last service switch, to tell everyone while that song plays. */
  switched: RoomState['switched'];
  /** The service playing songs it picked itself after the queue ran out, if any. */
  autoplay: RoomState['autoplay'];
  /** The host ended the room (`room.ended`): nothing plays or changes any more. */
  ended: boolean;
  /** This phone can't reach the room right now: what it shows may be out of date. */
  offline: boolean;
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
  const { accountId } = useMockSession();
  const queryClient = useQueryClient();
  // Server state belongs to the account that read it: a different account
  // (or none) never sees the last one's rooms, even from the cache.
  useEffect(() => {
    queryClient.clear();
    forgetLiveInvites();
  }, [accountId, queryClient]);
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
  // The service the room plays through as this view shows it: the `apple`
  // preview shares the room's queue but plays through Apple Music, so it
  // needs its own player, or it would decide what plays with Spotify's matches.
  const { playsThrough } = previewRoom(room, ref.view);
  const key = `${roomKey(ref)}@${playsThrough}`;
  let player = players.get(key);
  if (!player) {
    const created: RoomPlayer = new RoomPlayer(
      createPlayback,
      playsThrough,
      (entryId, providerKeptPlaying) => {
        const { autoplay } = afterQueueEnds({
          mode: 'aux',
          provider: created.provider,
          providerKeptPlaying,
        });
        store.advance(ref, entryId, 'ended', autoplay);
      },
    );
    player = created;
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

function useMockRoomState(base: MockRoom | null, view?: RoomView) {
  const rooms = useRooms();
  const { store } = rooms;
  const code = base?.code;
  const ref = useMemo<RoomRef | null>(() => (code ? { code, view } : null), [code, view]);

  const state = useSyncExternalStore(ref ? store.subscribe : noRoom, () =>
    ref ? store.get(ref) : null,
  );
  const player = ref && base ? playerFor(rooms, ref, base) : null;
  const playback = usePlayback(player);

  // Once the room has ended, nothing plays on the host's phone.
  const nowPlaying = state && !state.ended ? state.nowPlaying : null;
  const startAtMs = state?.startAtMs ?? 0;
  // A switch changes the service; otherwise the room keeps the one it started with.
  const playsThrough = state?.playsThrough ?? (base ? previewRoom(base, view).playsThrough : null);
  // The host's phone plays through the room's service. If you host this room
  // and that service isn't connected on this phone any more, the music holds
  // until it's reconnected (docs/DECISIONS.md, "Music-service settings").
  const { connected } = useProviderConnections();
  const youHost = !!base?.youHost;
  // The `apple` preview only shows the room through Apple Music; the service
  // this phone needs is the real room's (after a switch, the switched one).
  const roomService = state?.playsThrough ?? base?.playsThrough ?? null;
  const serviceMissing = youHost && !!roomService && !connected.includes(roomService);
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
  const unplayable = plan !== null && plan.kind !== 'play';

  // "Host reconnecting" for the grace period, then the room pauses (PRODUCT_SPEC.md §4).
  const hostPresent = state?.host.present ?? true;
  const now = useNow(!hostPresent);
  const host: HostStatus = state ? hostStatus(state.host, now) : { kind: 'connected' };
  const away = host.kind === 'away';
  const pausedForHost = state?.pausedForHost ?? false;
  useEffect(() => {
    if (ref && away) store.pauseForHost(ref);
  }, [ref, away, store]);

  // One hold flag covers every reason this phone can't play right now
  // (docs/DECISIONS.md, integration of the room-states and provider-UI stacks).
  const held = away || pausedForHost || serviceMissing;
  const holding = serviceMissing || unplayable;
  const { refresh } = playback;
  useEffect(() => {
    if (!player || !playsThrough) return;
    // A phone that can't play stops provider autoplay too.
    if (holding && ref) store.stopAutoplay(ref);
    // Hold first, so a song loaded meanwhile (after a skip) stays paused too.
    player
      .hold(held)
      .then(() =>
        unplayable ? player.standBy(nowPlaying) : player.load(nowPlaying, startAtMs, playsThrough),
      )
      .then(refresh);
  }, [player, nowPlaying, startAtMs, playsThrough, held, unplayable, holding, refresh, store, ref]);

  const room = useMemo<LiveRoom | null>(() => {
    if (!base || !state || !playsThrough) return null;
    return {
      ...previewRoom(base, view),
      playsThrough,
      nowPlaying: state.nowPlaying,
      queue: state.queue,
      rules: state.rules,
      switched: state.switched,
      autoplay: state.autoplay,
      ended: state.ended,
      offline: state.offline,
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
  // Changes go to the server, so they wait while this phone is offline, and
  // stop for good once the room has ended.
  const reachable = !!room && !room.offline && !room.ended;
  const canControl = reachable && allows(room.rules.control, you);

  return {
    room,
    playback: shown,
    ref,
    /** You in this room's `people`. */
    you,
    /** The room's add-songs rule lets you in. */
    canAdd: reachable && allows(room.rules.addSongs, you),
    /** The room's rules let you play, pause, skip, reorder and remove. */
    canControl,
    /** Play and pause work only while the host's phone can play the song that's up. */
    canPlay: canControl && !holding,
    /** Whether the host's phone is in the room. */
    host,
    /** The room paused while the host was away, until the host resumes. */
    pausedForHost,
    /**
     * You host this room, but the service it plays through isn't connected on
     * this phone, so nothing can play until it's reconnected.
     */
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
function useMockRoom(code: string | undefined, view?: RoomView) {
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
    canPlay,
    plan,
    songStarted,
    hostConnected,
  } = useMockRoomState(base, view);
  // There's always a room here: an unknown code shows the sample room.
  const live = room!;
  const at = ref!;
  const index = (entryId: string) => live.queue.findIndex((e) => e.entryId === entryId);
  const isHost = isListenerView(view) ? false : live.youHost;

  return {
    /** Mock rooms are always ready: an unknown code shows the sample room. */
    status: 'ready' as RoomStatus,
    room: live,
    playback,
    /**
     * Whether the room's playback runs through q’d here. Live rooms say false
     * until `advance_queue` and `report_playback_state` exist on the server.
     */
    playbackLive: true,
    /** Whether the host can change the rules here (`update_room_rules`). */
    rulesEditable: true,
    /** Why the last queue edit didn't go through, if it didn't. */
    queueError: null as string | null,
    /**
     * Only the host invites, sets the rules and plays through their service.
     * Who adds songs and who controls the music follow the rules (PRODUCT_SPEC.md §4).
     */
    isHost,
    you,
    canAdd,
    canControl,
    canPlay,
    /**
     * How the playing song stands on the room's service: playable, an
     * uncertain match (plays with a warning), unavailable or unresolved.
     */
    nowPlayingAvailability: live.nowPlaying
      ? entryAvailability(live.nowPlaying, live.playsThrough)
      : null,
    /** Whether the host's phone is in the room, and whether the room paused for it. */
    host,
    pausedForHost,
    /** You host, and the room's service isn't connected on your phone. */
    serviceMissing,
    resumeAfterHost,
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
    add: async (result: CatalogResult, allowDuplicate = false): Promise<AddOutcome> =>
      store.enqueue(at, trackFromResult(result, live.playsThrough), user.name, allowDuplicate),
    /** Undo on the "added" toast: takes back your own song while it's still queued. */
    undoAdd: (entryId: string) => {
      store.remove(at, entryId);
    },
    /** `end_room`: the host ends the room for everyone. */
    endRoom: async (): Promise<boolean> => isHost && store.endRoom(at),
  };
}

export type RoomHandle = ReturnType<typeof useMockRoom>;

/** The room you're in, for the mini player on Home and Settings. Null when you aren't in one. */
function useMockActiveRoom() {
  const { activeRoom } = useMockSession();
  const { room, playback, canControl, canPlay, host, pausedForHost, serviceMissing } =
    useMockRoomState(activeRoom);
  /**
   * Playback waits for the host's phone, for the returning host to resume in
   * the room, or for you, the host, to connect the room's service again.
   */
  const waitingForHost = host.kind !== 'connected' || pausedForHost || serviceMissing;
  // An ended room has nothing to show on Home's mini player.
  const current = room && !room.ended ? room : null;
  return { room: current, playback, canControl, canPlay, host, pausedForHost, waitingForHost };
}

/**
 * Mock mode's stand-ins for the Realtime card's room signals, for `/dev`:
 * the host ends the room (`room.ended`), and this phone loses or gets back
 * its connection to the room's channel.
 */
export function useMockRoomSignals() {
  const { store } = useRooms();
  return useMemo(
    () => ({
      endRoom: (code: string) => store.endRoom({ code }),
      setOffline: (code: string, offline: boolean) =>
        store.setOffline({ code }, offline, { isHost: findRoom(code).youHost }),
    }),
    [store],
  );
}

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

/** Rooms you've been in, newest first, for Home. Mock mode shows the sample rooms. */
function useMockRecentRooms(): MockRoom[] {
  return mockRooms;
}

/**
 * `join_room_by_code` from Home. On success you're in the room and `join`
 * returns `{ code }` (`QD-…`); on failure it returns null and `state` holds
 * the error.
 */
function useMockJoinRoom() {
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
function useMockStartRoom() {
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
function useMockJoinByInvite() {
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
function useMockRoomInvite(roomCode: string, isHost: boolean) {
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

/** The room status a room route waits for: mock rooms are always ready. */
function useMockRoomStatus(_code: string | undefined): RoomStatus {
  return 'ready';
}

/*
 * Mock or live, fixed for the build (services/dataMode.ts): live rooms read
 * Supabase (./liveRoom), mock rooms the mock store. Both hand the screens the
 * same shapes, so the screens don't know which one they have.
 */
export const useRoom: (code: string | undefined, view?: RoomView) => RoomHandle = roomsAreLive
  ? useServerRoom
  : useMockRoom;
export const useRoomStatus = roomsAreLive ? useServerRoomStatus : useMockRoomStatus;
export const useActiveRoom: () => ActiveRoom = roomsAreLive
  ? useServerActiveRoom
  : useMockActiveRoom;
export const useRecentRooms = roomsAreLive ? useServerRecentRooms : useMockRecentRooms;
export const useJoinRoom = roomsAreLive ? useServerJoinRoom : useMockJoinRoom;
export const useStartRoom = roomsAreLive ? useServerStartRoom : useMockStartRoom;
export const useJoinByInvite = roomsAreLive ? useServerJoinByInvite : useMockJoinByInvite;
export const useRoomInvite = roomsAreLive ? useServerRoomInvite : useMockRoomInvite;
