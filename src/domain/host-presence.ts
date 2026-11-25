import type { RoomPresence } from './realtime';

/**
 * Whether the host's phone is in the room (PRODUCT_SPEC.md §4, "When the host
 * disappears"; API_CONTRACTS.md §4, Presence). Pure: the caller passes what
 * presence last said and the current time, so every phone decides the same
 * way and the rule is easy to test.
 *
 * 1. While the host's presence is in the channel, the host is `connected`.
 * 2. When it disappears, everyone sees "Host reconnecting" for
 *    `HOST_RECONNECT_GRACE_MS`.
 * 3. After that the host is `away`: playback pauses, and the room and its
 *    queue are kept.
 */

/** How long "Host reconnecting" shows before the room pauses (PRODUCT_SPEC.md §4). */
export const HOST_RECONNECT_GRACE_MS = 30_000;

/**
 * What presence says about the host. The Realtime Presence card fills it from
 * the room channel's sync, join and leave events (see `hostPresentIn`).
 */
export type HostPresence = {
  /** The host's presence entry is in the channel right now. */
  present: boolean;
  /**
   * When the host was last seen present, in epoch ms on this phone's clock:
   * the time their entry left. `null` if this phone has never seen them.
   */
  lastSeenAt: number | null;
};

export type HostStatus =
  | { kind: 'connected' }
  /** Within the grace period. `remainingMs` counts down to the pause. */
  | { kind: 'reconnecting'; awayMs: number; remainingMs: number }
  /** Past the grace period, or never seen: playback is paused. */
  | { kind: 'away'; awayMs: number | null };

export function hostStatus(
  presence: HostPresence,
  now: number,
  graceMs: number = HOST_RECONNECT_GRACE_MS,
): HostStatus {
  if (presence.present) return { kind: 'connected' };
  if (presence.lastSeenAt === null) return { kind: 'away', awayMs: null };
  // A clock that moved backwards never makes the host "more present".
  const awayMs = Math.max(0, now - presence.lastSeenAt);
  if (awayMs < graceMs) return { kind: 'reconnecting', awayMs, remainingMs: graceMs - awayMs };
  return { kind: 'away', awayMs };
}

/** Whether the host is among a room channel's presence entries. */
export function hostPresentIn(entries: readonly RoomPresence[], hostUserId: string): boolean {
  return entries.some((entry) => entry.userId === hostUserId && entry.role === 'host');
}

/**
 * The next presence after a sync: present now, or gone since `now` if the
 * host was present before. A host who was already gone keeps their time.
 */
export function nextHostPresence(
  previous: HostPresence,
  presentNow: boolean,
  now: number,
): HostPresence {
  if (presentNow) return { present: true, lastSeenAt: now };
  if (previous.present) return { present: false, lastSeenAt: now };
  return previous;
}

/** "Pauses in 12 s": whole seconds left, never below 1 while still reconnecting. */
export function secondsLeft(status: Extract<HostStatus, { kind: 'reconnecting' }>): number {
  return Math.max(1, Math.ceil(status.remainingMs / 1000));
}
