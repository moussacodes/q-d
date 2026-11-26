import {
  parseRoomEvent,
  parseRoomPresence,
  realtimeVersion,
  roomChannel,
  type RealtimeRejection,
  type RoomEvent,
  type RoomPresence,
} from '@/domain/realtime';
import type { RoomRole } from '@/domain/room';

import { log } from './logger';

/**
 * Supabase Realtime for one room (docs/API_CONTRACTS.md §4).
 *
 * - **Broadcast** tells the app something changed in the room. Events are
 *   hints, never data: every one is parsed with the versioned schema, and the
 *   app refetches from Postgres. An event it can't read (a newer `v`, an
 *   unknown type, another room's id, anything malformed) still means
 *   "something changed", so it refetches everything about the room and never
 *   crashes.
 * - **Presence** says who's in the room right now. Each phone tracks only its
 *   user id and role (`RoomPresence`): no name, email or song.
 * - The channel is private: Realtime Authorization (RLS on
 *   `realtime.messages`, the RLS card) lets only members listen and track.
 *   Clients never send broadcasts.
 * - **Connection loss** reports `offline` and reconnects with backoff. A
 *   reconnect asks for a full refetch, because events sent while offline are
 *   gone.
 */

/** What the room's channel is doing. */
export type RealtimeStatus = 'connecting' | 'online' | 'offline' | 'closed';

/** What a broadcast asks the app to do. */
export type RoomSignal =
  /** A known event: refetch what it names. */
  | { kind: 'event'; event: RoomEvent }
  /**
   * Refetch everything about the room: an event this client can't read, or
   * the channel came back after being offline and may have missed some.
   */
  | { kind: 'refetch'; reason: RealtimeRejection | 'reconnected' };

/** Reconnect delays in ms, doubling up to 30 s. The last one repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
}

/** The statuses supabase-js reports to `subscribe`. */
export type SubscribeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

/** The parts of a supabase-js `RealtimeChannel` this service uses. */
export interface RealtimeChannelLike {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (message: { event?: string; payload?: unknown }) => void,
  ): RealtimeChannelLike;
  on(type: 'presence', filter: { event: 'sync' }, callback: () => void): RealtimeChannelLike;
  subscribe(callback: (status: SubscribeStatus, error?: Error) => void): RealtimeChannelLike;
  presenceState(): Record<string, unknown[]>;
  track(payload: Record<string, unknown>): Promise<unknown>;
  untrack(): Promise<unknown>;
}

/** The parts of a `SupabaseClient` this service uses. */
export interface RealtimeClientLike {
  channel(
    name: string,
    options: { config: { private: boolean; presence: { key: string } } },
  ): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
  realtime: { setAuth(token?: string | null): Promise<void> | void };
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RoomRealtimeOptions {
  client: RealtimeClientLike;
  roomId: string;
  /** This phone's member: what it tracks in presence. */
  me: { userId: string; role: RoomRole };
  onSignal: (signal: RoomSignal) => void;
  /** Every presence entry that parses, after each sync. */
  onPresence: (entries: RoomPresence[]) => void;
  onStatus: (status: RealtimeStatus) => void;
  timers?: Timers;
}

const realtimeLog = log.child('realtime');

/** Reads a channel's presence state: the entries that parse, the rest dropped (and logged). */
export function presenceEntries(state: Record<string, unknown[]>): RoomPresence[] {
  const entries: RoomPresence[] = [];
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      const parsed = parseRoomPresence(meta);
      if (parsed.ok) entries.push(parsed.value);
      else
        realtimeLog.warn('Ignored a presence entry', {
          reason: parsed.reason,
          issues: parsed.issues,
        });
    }
  }
  return entries;
}

/** What a broadcast payload means for the app. Never throws. */
export function signalFor(payload: unknown, roomId: string): RoomSignal {
  const parsed = parseRoomEvent(payload, roomId);
  if (parsed.ok) return { kind: 'event', event: parsed.value };
  // Issues hold field paths and codes only, never values, so they're safe to log.
  realtimeLog.warn('Ignored a room event; refetching', {
    reason: parsed.reason,
    issues: parsed.issues,
  });
  return { kind: 'refetch', reason: parsed.reason };
}

/**
 * Joins the room's private channel, tracks this phone in presence, and keeps
 * the channel up until `close` is called. Returns `close`, which untracks,
 * removes the channel and cancels any pending reconnect.
 */
export function joinRoomChannel({
  client,
  roomId,
  me,
  onSignal,
  onPresence,
  onStatus,
  timers = defaultTimers,
}: RoomRealtimeOptions): () => void {
  let closed = false;
  let channel: RealtimeChannelLike | null = null;
  let attempt = 0;
  let retry: unknown = null;
  /** The channel was up before: the next SUBSCRIBED is a reconnect, so refetch. */
  let wasOnline = false;
  let status: RealtimeStatus | null = null;

  const report = (next: RealtimeStatus) => {
    if (next === status) return;
    status = next;
    onStatus(next);
  };

  const drop = (current: RealtimeChannelLike) => {
    if (channel === current) channel = null;
    client.removeChannel(current).catch((error: unknown) => {
      realtimeLog.warn('Removing the room channel failed', { error });
    });
  };

  const scheduleReconnect = () => {
    if (closed || retry !== null) return;
    const delay = reconnectDelay(attempt);
    attempt += 1;
    retry = timers.setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed) return;
    // The first try says "connecting"; a retry keeps saying "offline".
    if (status === null) report('connecting');
    const current = client.channel(roomChannel(roomId), {
      config: { private: true, presence: { key: me.userId } },
    });
    channel = current;
    current
      .on('broadcast', { event: '*' }, (message) => {
        if (closed || channel !== current) return;
        onSignal(signalFor(message.payload, roomId));
      })
      .on('presence', { event: 'sync' }, () => {
        if (closed || channel !== current) return;
        onPresence(presenceEntries(current.presenceState()));
      })
      .subscribe((subscribeStatus) => {
        if (closed || channel !== current) return;
        if (subscribeStatus === 'SUBSCRIBED') {
          attempt = 0;
          const reconnected = wasOnline;
          wasOnline = true;
          report('online');
          current
            .track({ v: realtimeVersion, userId: me.userId, role: me.role })
            .catch((error: unknown) => realtimeLog.warn('Presence track failed', { error }));
          // Events sent while the channel was down are gone: catch up.
          if (reconnected) onSignal({ kind: 'refetch', reason: 'reconnected' });
          return;
        }
        // TIMED_OUT, CHANNEL_ERROR or CLOSED: honest offline, then try again.
        realtimeLog.warn('Room channel lost', { status: subscribeStatus });
        report('offline');
        drop(current);
        scheduleReconnect();
      });
  };

  // A private channel needs the signed-in user's token before it joins.
  Promise.resolve(client.realtime.setAuth())
    .catch((error: unknown) => realtimeLog.warn('Realtime auth failed', { error }))
    .then(connect);

  return () => {
    if (closed) return;
    closed = true;
    if (retry !== null) timers.clearTimeout(retry);
    retry = null;
    const current = channel;
    channel = null;
    report('closed');
    if (current) {
      current
        .untrack()
        .catch(() => undefined)
        .finally(() => drop(current));
    }
  };
}
