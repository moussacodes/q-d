import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { hostPresentIn, nextHostPresence, type HostPresence } from '@/domain/host-presence';
import type { RoomRole } from '@/domain/room';
import {
  joinRoomChannel,
  type RealtimeClientLike,
  type RealtimeStatus,
  type RoomSignal,
} from '@/services/realtime';
import { invalidationsFor, roomKeys } from '@/services/roomQueryKeys';

/**
 * A live room's Realtime connection (docs/API_CONTRACTS.md §4): refetches
 * what each broadcast names, tracks this phone in presence, and reports
 * whether the host's phone is in the room, whether this phone is online, and
 * whether the room has ended. Postgres stays the source of truth: nothing a
 * payload says is shown, it only makes TanStack Query refetch.
 */
export type RoomRealtime = {
  /** This phone's connection to the room's channel. */
  connection: RealtimeStatus;
  /** What presence says about the host, for `hostStatus` (src/domain/host-presence.ts). */
  hostPresence: HostPresence;
  /** How many people are in the room right now, by presence. */
  presentCount: number;
  /** `room.ended` arrived: the room is over for everyone. */
  ended: boolean;
};

export type UseRoomRealtimeOptions = {
  /** Null outside live mode, or before the room and the user are known: nothing connects. */
  client: RealtimeClientLike | null;
  roomId: string | null;
  userId: string | null;
  role: RoomRole;
  hostUserId: string | null;
  now?: () => number;
};

/** `roomId` names the room the state is for, so another room's never shows. */
type State = RoomRealtime & { synced: boolean; roomId: string | null };

const initial: State = {
  connection: 'connecting',
  // Until the first presence sync, the host counts as present: nothing has
  // been seen yet, and "Host reconnecting" would be a guess.
  hostPresence: { present: true, lastSeenAt: null },
  presentCount: 0,
  ended: false,
  synced: false,
  roomId: null,
};

/** Never seen: a host missing from the first sync counts as away (host-presence.ts). */
const unseen: HostPresence = { present: false, lastSeenAt: null };

export function useRoomRealtime({
  client,
  roomId,
  userId,
  role,
  hostUserId,
  now = Date.now,
}: UseRoomRealtimeOptions): RoomRealtime {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<State>(initial);
  // Read at each sync, so learning the host's id later doesn't rejoin the channel.
  const hostRef = useRef(hostUserId);
  useEffect(() => {
    hostRef.current = hostUserId;
  }, [hostUserId]);

  useEffect(() => {
    if (!client || !roomId || !userId) return;
    // Changes for this room start from scratch when the room changes.
    const setState = (change: (current: State) => State) =>
      setSaved((current) => change(current.roomId === roomId ? current : { ...initial, roomId }));
    const onSignal = (signal: RoomSignal) => {
      if (signal.kind === 'refetch') {
        // Something changed that this client can't read, or it missed events.
        void queryClient.invalidateQueries({ queryKey: roomKeys.room(roomId) });
        return;
      }
      for (const queryKey of invalidationsFor(signal.event.type, roomId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      if (signal.event.type === 'room.ended') {
        setState((current) => ({ ...current, ended: true }));
      }
    };
    const close = joinRoomChannel({
      client,
      roomId,
      me: { userId, role },
      onSignal,
      onPresence: (entries) =>
        setState((current) => ({
          ...current,
          presentCount: new Set(entries.map((entry) => entry.userId)).size,
          synced: true,
          hostPresence: hostRef.current
            ? nextHostPresence(
                current.synced ? current.hostPresence : unseen,
                hostPresentIn(entries, hostRef.current),
                now(),
              )
            : current.hostPresence,
        })),
      onStatus: (connection) =>
        setState((current) => ({
          ...current,
          connection,
          // The host's own phone off the channel is the host gone from the
          // room (API_CONTRACTS.md §4): after 30 s its player pauses too.
          hostPresence:
            role === 'host' && connection === 'offline'
              ? nextHostPresence(current.hostPresence, false, now())
              : current.hostPresence,
        })),
    });
    return close;
  }, [client, roomId, userId, role, queryClient, now]);

  const state = saved.roomId === roomId ? saved : initial;
  const { synced: _synced, roomId: _roomId, ...realtime } = state;
  return realtime;
}
