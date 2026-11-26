import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { hostStatus, type HostStatus } from '@/domain/host-presence';
import { inviteLink } from '@/domain/invite';
import type { MusicProvider } from '@/domain/music-provider';
import { planSong, type SongPlan } from '@/domain/provider-switch';
import { formatArtists } from '@/domain/recording';
import { formatRoomCode, isRoomCode, roomCodeFromInput } from '@/domain/room-code';
import { allows, type RoomRules } from '@/domain/room-rules';
import type { RpcCallError } from '@/domain/rpc-error';
import { formatDuration, parseDuration } from '@/domain/time';
import type { Playback } from '@/features/playback/usePlayback';
import { useMockSession } from '@/features/session/MockSession';
import type { CatalogResult } from '@/providers';
import type { MockPerson, MockRoom } from '@/providers/mock/data';
import { isMockMode } from '@/services/dataMode';
import type { RealtimeClientLike } from '@/services/realtime';
import { roomKeys } from '@/services/roomQueryKeys';
import {
  roomReads,
  roomRpc,
  type Member,
  type QueueEntry,
  type ReadClientLike,
  type RoomDetail,
} from '@/services/rooms';
import type { RpcClientLike } from '@/services/rpc';
import { getSupabase } from '@/services/supabase';

import { entryAvailability } from './availability';
import { networkMessage } from './errorCopy';
import { newIdempotencyKey, type RoomInvite } from './mockServer';
import { availableOn, type RoomEntry, type RoomView } from './roomStore';
import type { AddOutcome, RoomStatus } from './roomHandle';
import { unanswered, useCall, type CallResult } from './useCall';
import type { LiveRoom, RoomHandle } from './useRoom';
import { useRoomRealtime } from './useRoomRealtime';

/**
 * Live rooms (Forge card "Wire room screens to live data"): the same hooks
 * the screens use in mock mode, backed by Supabase. Reads go through
 * TanStack Query (RLS limits them to your rooms), writes through the RPCs
 * with an idempotency key per tap, and Realtime makes the queries refetch.
 * Postgres is the source of truth; nothing is changed locally first.
 *
 * Live when the build's data mode is `live` (EXPO_PUBLIC_DATA_MODE=live with
 * both Supabase values valid, services/dataMode.ts) and someone is signed in
 * to Supabase. Without a session the queries don't run.
 *
 * Not on the server yet, so off or unchanged in live rooms, with copy that
 * says so: `advance_queue` (Skip), `report_playback_state` (play, pause and
 * progress), `request_playback`, `switch_playback_provider`,
 * `override_track_match` ("Wrong version?") and `update_room_rules`.
 */

const newKey = newIdempotencyKey;

/** Rooms are live in this build (fixed at startup, like the data mode). */
export const roomsAreLive = !isMockMode;

type LiveClient = RpcClientLike & ReadClientLike & RealtimeClientLike;

/** The Supabase client as the room services see it, or null without one. */
function liveClient(): LiveClient | null {
  return getSupabase() as unknown as LiveClient | null;
}

/** Shown in live rooms under the controls while playback isn't on the server yet. */
export const livePlaybackNote =
  'Playback isn’t connected to live rooms yet: the queue is shared, but q’d doesn’t play it from here. Skip comes with it.';

/** Shown to the host in Listeners while `update_room_rules` isn't on the server yet. */
export const liveRulesNote =
  'Changing the rules isn’t connected to live rooms yet. The room keeps the rules it started with.';

const neutralColor = '#8a8a8a';
/** Songs have no Apple artwork color in live rooms yet; grey is the Figma "Rebel" fallback. */
const noArtworkColor = '#5a5a5a';

const nameOf = (member: Pick<Member, 'name'> | undefined) => member?.name ?? 'Someone';

function personOf(member: Member, room: RoomDetail): MockPerson {
  return {
    id: member.userId,
    name: nameOf(member),
    color: member.color ?? neutralColor,
    ...(member.role === 'host' ? { isHost: true, provider: room.playsThrough } : {}),
  };
}

function entryOf(entry: QueueEntry, room: RoomDetail, members: Member[]): RoomEntry {
  const adder = members.find((m) => m.userId === entry.addedBy);
  return {
    entryId: entry.entryId,
    // The canonical recording: what search results carry as `recordingId`.
    id: entry.recording.id,
    title: entry.recording.title,
    artist: formatArtists(entry.recording.artists),
    album: entry.recording.album ?? '',
    duration: formatDuration(entry.recording.durationMs),
    provider: room.playsThrough,
    addedBy: nameOf(adder),
    artworkColor: noArtworkColor,
    matches: entry.matches,
  };
}

function rulesOf(room: RoomDetail): RoomRules {
  return {
    addSongs: { who: room.addSongs, chosen: room.chosen.addSongs },
    control: { who: room.control, chosen: room.chosen.control },
  };
}

/** A live room in the shape the screens use. */
export function liveRoomOf(
  room: RoomDetail,
  members: Member[],
  queue: { nowPlaying: QueueEntry | null; queue: QueueEntry[] },
  me: string | null,
  signals: { ended: boolean; offline: boolean },
): LiveRoom {
  const host = members.find((m) => m.userId === room.hostId);
  return {
    code: formatRoomCode(room.code),
    name: room.name,
    hostName: host ? nameOf(host) : 'The host',
    youHost: !!me && room.hostId === me,
    people: members.map((m) => personOf(m, room)),
    nowPlaying: queue.nowPlaying ? entryOf(queue.nowPlaying, room, members) : null,
    queue: queue.queue.map((e) => entryOf(e, room, members)),
    lastActive: 'Now',
    playsThrough: room.playsThrough,
    rules: rulesOf(room),
    switched: null,
    autoplay: null,
    ended: room.ended || signals.ended,
    offline: signals.offline,
  };
}

/** Nothing plays from q’d in a live room yet, so its playback is still. */
function stillPlayback(durationMs: number): Playback {
  const none = async () => {};
  return {
    state: { status: 'idle', track: null, positionMs: 0 },
    playing: false,
    positionMs: 0,
    durationMs,
    progress: 0,
    togglePlay: none,
    seek: none,
    refresh: none,
  };
}

/** The clock, ticking every second while `ticking`, for the reconnecting countdown. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** Reads a room by its code: which room, then its row, people and queue. */
function useLiveRoomQueries(code: string | undefined) {
  const { liveUserId } = useMockSession();
  const client = liveClient();
  const body = roomCodeFromInput(code ?? '');
  const signedIn = !!client && !!liveUserId;
  const byCode = useQuery({
    queryKey: roomKeys.byCode(body),
    queryFn: () => roomReads.roomByCode(client!, body),
    enabled: signedIn && isRoomCode(body),
  });
  const roomId = byCode.data?.id ?? null;
  const detail = useQuery({
    queryKey: roomKeys.detail(roomId ?? ''),
    queryFn: () => roomReads.detail(client!, roomId!),
    enabled: signedIn && !!roomId,
  });
  const members = useQuery({
    queryKey: roomKeys.members(roomId ?? ''),
    queryFn: () => roomReads.members(client!, roomId!),
    enabled: signedIn && !!roomId,
  });
  const queue = useQuery({
    queryKey: roomKeys.queue(roomId ?? ''),
    queryFn: () => roomReads.queue(client!, roomId!),
    enabled: signedIn && !!roomId,
  });
  // A read that failed before it ever answered can't be shown. One that fails
  // on a later refetch keeps what it read (TanStack keeps `data`), so a
  // flaky refetch never swaps the room for an error. The people and the
  // queue count too: a queue that couldn't be read isn't an empty queue.
  const failed = (query: { isError: boolean; data: unknown }) =>
    query.isError && query.data === undefined;
  let status: RoomStatus;
  if (!isRoomCode(body)) status = 'missing';
  else if ([byCode, detail, members, queue].some(failed)) status = 'error';
  else if (!signedIn || byCode.isPending) status = 'loading';
  else if (!byCode.data) status = 'missing';
  else if (detail.isPending || members.isPending || queue.isPending) status = 'loading';
  else status = detail.data ? 'ready' : 'missing';
  return { client, liveUserId, roomId, status, detail, members, queue, byCode };
}

/** Whether the room behind a `/room/QD-…` link can be shown yet. */
export function useServerRoomStatus(code: string | undefined): RoomStatus {
  return useLiveRoomQueries(code).status;
}

const emptyQueue = { nowPlaying: null, queue: [] };

/** What a failed queue edit says. The view refetches either way. */
function queueErrorMessage(error: RpcCallError): string {
  switch (error.code) {
    case 'network':
      return networkMessage;
    case 'not_allowed':
      return 'The room’s rules don’t let you change the queue.';
    case 'entry_not_found':
    case 'stale_state':
      return 'The queue changed before that went through. Here’s how it is now.';
    case 'room_ended':
      return 'This room has ended.';
    default:
      return 'That didn’t go through. Try again.';
  }
}

/** What adding a song says when it fails. */
export function addErrorMessage(error: RpcCallError): string {
  switch (error.code) {
    case 'network':
      return networkMessage;
    case 'not_allowed':
      return 'The room’s rules don’t let you add songs.';
    case 'room_ended':
      return 'This room has ended.';
    case 'not_member':
      return 'You’re not in this room any more.';
    case 'invalid_input':
      return 'That song can’t be added yet. Try searching for it again.';
    default:
      return 'Couldn’t add that song. Try again.';
  }
}

/** The live room you're looking at, in the same shape as mock mode's `useRoom`. */
export function useServerRoom(code: string | undefined, view?: RoomView): RoomHandle {
  const { client, liveUserId, roomId, status, detail, members, queue } = useLiveRoomQueries(code);
  const queryClient = useQueryClient();
  const memberList = useMemo(() => members.data ?? [], [members.data]);
  const me = memberList.find((m) => m.userId === liveUserId);
  const realtime = useRoomRealtime({
    client,
    roomId,
    userId: liveUserId,
    role: me?.role ?? 'member',
    hostUserId: detail.data?.hostId ?? null,
  });
  const [queueError, setQueueError] = useState<string | null>(null);
  /**
   * The key of an add that got no answer, for the same add tried again: the
   * server may have queued it already, and a new key (above all with
   * `allow_duplicate`) could queue it twice (API_CONTRACTS.md §1).
   */
  const unansweredAdd = useRef<{ request: string; key: string } | null>(null);
  // `useRoomRealtime` hands back a new object each render; the room only
  // changes when these do.
  const offline = realtime.connection === 'offline';

  const room = useMemo<LiveRoom>(() => {
    const row: RoomDetail = detail.data ?? {
      id: roomId ?? '',
      name: '',
      hostId: null,
      ended: false,
      playsThrough: 'spotify',
      code: roomCodeFromInput(code ?? ''),
      addSongs: 'everyone',
      control: 'host',
      createdAt: '',
      chosen: { addSongs: [], control: [] },
    };
    const live = liveRoomOf(row, memberList, queue.data ?? emptyQueue, liveUserId, {
      ended: realtime.ended,
      offline,
    });
    return view ? { ...live, view } : live;
  }, [
    detail.data,
    memberList,
    queue.data,
    liveUserId,
    realtime.ended,
    offline,
    roomId,
    code,
    view,
  ]);

  const hostPresent = realtime.hostPresence.present;
  const now = useNow(!hostPresent);
  const host = hostStatus(realtime.hostPresence, now);
  const you = room.people.find((p) => p.id === liveUserId);
  const isHost = room.youHost;
  const reachable = !room.ended && !room.offline;
  const canAdd = reachable && allows(room.rules.addSongs, you);
  const canControl = reachable && allows(room.rules.control, you);
  // Nothing plays from here yet, so the host is never asked to switch:
  // `switch_playback_provider` isn't on the server.
  const plan = useMemo<SongPlan | null>(
    () =>
      room.nowPlaying
        ? planSong({
            playsThrough: room.playsThrough,
            availableOn: availableOn(room.nowPlaying),
            hostConnected: [room.playsThrough],
          })
        : null,
    [room.nowPlaying, room.playsThrough],
  );

  const refetchQueue = useCallback(() => {
    if (roomId) void queryClient.invalidateQueries({ queryKey: roomKeys.queue(roomId) });
  }, [queryClient, roomId]);

  /** One queue edit: a fresh key per tap, then the queue refetches whatever happened. */
  const edit = useCallback(
    async (call: (key: string) => Promise<CallResult<unknown>>): Promise<boolean> => {
      if (!client || !roomId) return false;
      const result = await call(newKey());
      setQueueError(result.ok ? null : queueErrorMessage(result.error));
      refetchQueue();
      return result.ok;
    },
    [client, roomId, refetchQueue],
  );

  const index = (entryId: string) => room.queue.findIndex((e) => e.entryId === entryId);

  return {
    status,
    room,
    playback: stillPlayback(room.nowPlaying ? parseDuration(room.nowPlaying.duration) : 0),
    playbackLive: false,
    rulesEditable: false,
    queueError,
    isHost,
    you,
    canAdd,
    canControl,
    canPlay: false,
    nowPlayingAvailability: room.nowPlaying
      ? entryAvailability(room.nowPlaying, room.playsThrough)
      : null,
    host,
    // The server records no "paused for the host" yet (report_playback_state).
    pausedForHost: false,
    serviceMissing: false,
    resumeAfterHost: async () => {},
    plan,
    hostConnected: [room.playsThrough],
    switchProvider: (_to: MusicProvider) => ({ ok: false, error: 'not_needed' }) as const,
    setRules: (_rules: RoomRules) => {},
    skip: () => {},
    moveUp: (entryId: string) => {
      const i = index(entryId);
      if (i < 1 || !client || !roomId) return;
      const after = i === 1 ? null : room.queue[i - 2].entryId;
      void edit((key) =>
        roomRpc.reorderQueue(client, { roomId, entryId, afterEntryId: after, idempotencyKey: key }),
      );
    },
    moveDown: (entryId: string) => {
      const i = index(entryId);
      if (i < 0 || i >= room.queue.length - 1 || !client || !roomId) return;
      const after = room.queue[i + 1].entryId;
      void edit((key) =>
        roomRpc.reorderQueue(client, { roomId, entryId, afterEntryId: after, idempotencyKey: key }),
      );
    },
    remove: (entryId: string) => {
      if (!client || !roomId) return;
      void edit((key) =>
        roomRpc.removeQueueEntry(client, { roomId, entryId, idempotencyKey: key }),
      );
    },
    add: async (result: CatalogResult, allowDuplicate = false): Promise<AddOutcome> => {
      if (!client || !roomId) return { ok: false, error: 'failed', message: networkMessage };
      if (!result.recordingId) {
        // A result the server didn't save can't be queued (enqueue_recording takes the recording).
        return { ok: false, error: 'failed', message: addErrorMessage({ code: 'invalid_input' }) };
      }
      const request = JSON.stringify([roomId, result.recordingId, allowDuplicate]);
      const kept = unansweredAdd.current;
      const key = kept && kept.request === request ? kept.key : newKey();
      const answer = await roomRpc.enqueueRecording(client, {
        roomId,
        recordingId: result.recordingId,
        allowDuplicate,
        idempotencyKey: key,
      });
      unansweredAdd.current = !answer.ok && unanswered(answer.error) ? { request, key } : null;
      refetchQueue();
      if (answer.ok) {
        return {
          ok: true,
          entryId: answer.value.entryId,
          playingNow: answer.value.position === 0,
          queueLength: answer.value.queueLength,
        };
      }
      if (answer.error.code === 'already_in_queue') return { ok: false, error: 'already_in_queue' };
      return { ok: false, error: 'failed', message: addErrorMessage(answer.error) };
    },
    undoAdd: (entryId: string) => {
      if (!client || !roomId) return;
      void edit((key) =>
        roomRpc.removeQueueEntry(client, { roomId, entryId, idempotencyKey: key }),
      );
    },
    endRoom: async () => {
      if (!client || !roomId || !isHost) return false;
      const answer = await roomRpc.endRoom(client, { roomId, idempotencyKey: newKey() });
      void queryClient.invalidateQueries({ queryKey: roomKeys.room(roomId) });
      void queryClient.invalidateQueries({ queryKey: roomKeys.mine });
      // A replay after the room ended still answers ok (API_CONTRACTS.md § end_room).
      return answer.ok || answer.error.code === 'room_ended';
    },
  };
}

/** Live rooms have no mini player yet: nothing plays from q’d in them. */
export type ActiveRoom = {
  room: LiveRoom | null;
  playback: Playback;
  canControl: boolean;
  canPlay: boolean;
  host: HostStatus;
  pausedForHost: boolean;
  waitingForHost: boolean;
};

export function useServerActiveRoom(): ActiveRoom {
  return {
    room: null,
    playback: stillPlayback(0),
    canControl: false,
    canPlay: false,
    host: { kind: 'connected' },
    pausedForHost: false,
    waitingForHost: false,
  };
}

/** The live rooms you're in, for Home's list, newest first. */
export function useServerRecentRooms(): MockRoom[] {
  const { liveUserId } = useMockSession();
  const client = liveClient();
  const mine = useQuery({
    queryKey: roomKeys.mine,
    queryFn: async () => {
      const rooms = await roomReads.mine(client!, liveUserId!);
      return Promise.all(
        rooms.map(async (row) => {
          const people = await roomReads.members(client!, row.id);
          const detail: RoomDetail = { ...row, chosen: { addSongs: [], control: [] } };
          return liveRoomOf(detail, people, emptyQueue, liveUserId, {
            ended: false,
            offline: false,
          });
        }),
      );
    },
    enabled: !!client && !!liveUserId,
  });
  return mine.data ?? [];
}

/** What a live join answers: the room's display code, which the room route opens. */
async function codeOf(client: LiveClient, roomId: string): Promise<CallResult<{ code: string }>> {
  try {
    const room = await roomReads.detail(client, roomId);
    if (!room) return { ok: false, error: { code: 'room_not_found' } };
    return { ok: true, value: { code: formatRoomCode(room.code) } };
  } catch {
    return { ok: false, error: { code: 'network' } };
  }
}

/** `join_room_by_code` from Home, live. Same shape as mock mode's `useJoinRoom`. */
export function useServerJoinRoom() {
  const { enterRoom } = useMockSession();
  const queryClient = useQueryClient();
  const call = useCallback(
    async (code: string, idempotencyKey: string): Promise<CallResult<{ code: string }>> => {
      const client = liveClient();
      if (!client) return { ok: false, error: { code: 'not_authenticated' } };
      const joined = await roomRpc.joinRoomByCode(client, {
        code: roomCodeFromInput(code),
        idempotencyKey,
      });
      if (!joined.ok) return joined;
      const found = await codeOf(client, joined.value.roomId);
      if (found.ok) {
        enterRoom(found.value.code);
        void queryClient.invalidateQueries({ queryKey: roomKeys.mine });
      }
      return found;
    },
    [enterRoom, queryClient],
  );
  const { state, run, reset } = useCall(call);
  return { state, join: run, reset };
}

/** `create_room`, live. Same shape as mock mode's `useStartRoom`. */
export function useServerStartRoom() {
  const { startRoom } = useMockSession();
  const queryClient = useQueryClient();
  const call = useCallback(
    async (
      {
        name,
        playsThrough,
        rules,
      }: { name: string; playsThrough: MusicProvider | null; rules: RoomRules },
      idempotencyKey: string,
    ): Promise<CallResult<{ code: string }>> => {
      const client = liveClient();
      if (!client) return { ok: false, error: { code: 'not_authenticated' } };
      if (!playsThrough) return { ok: false, error: { code: 'provider_required' } };
      const trimmed = name.trim();
      const created = await roomRpc.createRoom(client, {
        name: trimmed,
        playbackProvider: playsThrough,
        addSongs: rules.addSongs.who,
        control: rules.control.who,
        idempotencyKey,
      });
      if (!created.ok) return created;
      const code = formatRoomCode(created.value.code);
      startRoom(code, { name: trimmed, playsThrough });
      void queryClient.invalidateQueries({ queryKey: roomKeys.mine });
      return { ok: true, value: { code } };
    },
    [startRoom, queryClient],
  );
  const { state, run } = useCall(call);
  return { state, start: run };
}

/** `join_room_by_invite`, live. Same shape as mock mode's `useJoinByInvite`. */
export function useServerJoinByInvite() {
  const { enterRoom } = useMockSession();
  const call = useCallback(
    async (token: string, idempotencyKey: string): Promise<CallResult<{ code: string }>> => {
      const client = liveClient();
      if (!client) return { ok: false, error: { code: 'not_authenticated' } };
      const joined = await roomRpc.joinRoomByInvite(client, { token, idempotencyKey });
      if (!joined.ok) return joined;
      const found = await codeOf(client, joined.value.roomId);
      if (found.ok) enterRoom(found.value.code);
      return found;
    },
    [enterRoom],
  );
  const { state, run } = useCall(call);
  return { state, join: run };
}

/**
 * The host's invite, live: `create_room_invite`. The server keeps only a
 * hash, so this phone keeps the token it got for as long as the app runs.
 */
const liveInvites = new Map<string, RoomInvite>();

export function useServerRoomInvite(roomCode: string, isHost: boolean) {
  const queries = useLiveRoomQueries(roomCode);
  const roomId = queries.roomId;
  const kept = () => {
    const invite = roomId ? liveInvites.get(roomId) : undefined;
    return invite && Date.parse(invite.expiresAt) > Date.now() ? invite : null;
  };
  const [invite, setInvite] = useState<RoomInvite | null>(kept);
  const call = useCallback(
    async (_: void, idempotencyKey: string): Promise<CallResult<RoomInvite>> => {
      const client = liveClient();
      if (!client || !roomId) return { ok: false, error: { code: 'room_not_found' } };
      if (!isHost) return { ok: false, error: { code: 'not_host' } };
      const made = await roomRpc.createRoomInvite(client, { roomId, idempotencyKey });
      if (made.ok) {
        liveInvites.set(roomId, made.value);
        setInvite(made.value);
      }
      return made;
    },
    [roomId, isHost],
  );
  const { state, run } = useCall(call);
  useEffect(() => {
    if (isHost && roomId && !invite) void run();
  }, [isHost, roomId, invite, run]);
  return {
    /** Null until the first invite exists. */
    link: invite ? inviteLink(invite.token) : null,
    token: invite?.token ?? null,
    state,
    /** Try again after an error, or make a new link that replaces the old one. */
    replace: () => run(),
  };
}

/** Forgets the invite tokens this phone kept: on an account change, and in tests. */
export function forgetLiveInvites() {
  liveInvites.clear();
}
