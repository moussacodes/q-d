import {
  HOST_RECONNECT_GRACE_MS,
  hostPresentIn,
  hostStatus,
  nextHostPresence,
  secondsLeft,
  type HostPresence,
  type HostStatus,
} from './host-presence';
import type { RoomPresence } from './realtime';

const left = (at: number): HostPresence => ({ present: false, lastSeenAt: at });

describe('hostStatus', () => {
  it('uses the 30-second grace period from PRODUCT_SPEC.md §4', () => {
    expect(HOST_RECONNECT_GRACE_MS).toBe(30_000);
  });

  it.each<[string, HostPresence, number, HostStatus]>([
    ['present', { present: true, lastSeenAt: 0 }, 1_000_000, { kind: 'connected' }],
    ['present, never timed', { present: true, lastSeenAt: null }, 0, { kind: 'connected' }],
    ['just left', left(1_000), 1_000, { kind: 'reconnecting', awayMs: 0, remainingMs: 30_000 }],
    [
      'gone 12.5 s',
      left(1_000),
      13_500,
      { kind: 'reconnecting', awayMs: 12_500, remainingMs: 17_500 },
    ],
    [
      'one ms before the pause',
      left(0),
      29_999,
      { kind: 'reconnecting', awayMs: 29_999, remainingMs: 1 },
    ],
    ['exactly at the grace period', left(0), 30_000, { kind: 'away', awayMs: 30_000 }],
    ['long gone', left(0), 600_000, { kind: 'away', awayMs: 600_000 }],
    ['never seen', { present: false, lastSeenAt: null }, 5, { kind: 'away', awayMs: null }],
    [
      'a clock that went backwards',
      left(10_000),
      4_000,
      { kind: 'reconnecting', awayMs: 0, remainingMs: 30_000 },
    ],
  ])('%s', (_name, presence, now, expected) => {
    expect(hostStatus(presence, now)).toEqual(expected);
  });

  it('takes another grace period', () => {
    expect(hostStatus(left(0), 5_000, 5_000).kind).toBe('away');
    expect(hostStatus(left(0), 4_999, 5_000).kind).toBe('reconnecting');
  });
});

describe('nextHostPresence', () => {
  const present: HostPresence = { present: true, lastSeenAt: 100 };

  it('times the host leaving from the first sync without them', () => {
    expect(nextHostPresence(present, false, 500)).toEqual({ present: false, lastSeenAt: 500 });
  });

  it('keeps the original time while the host stays away', () => {
    const gone = left(500);
    expect(nextHostPresence(gone, false, 9_000)).toBe(gone);
  });

  it('marks a returning host present', () => {
    expect(nextHostPresence(left(500), true, 9_000)).toEqual({ present: true, lastSeenAt: 9_000 });
  });
});

describe('hostPresentIn', () => {
  const host = '00000000-0000-4000-8000-000000000001';
  const member = '00000000-0000-4000-8000-000000000002';
  const entry = (userId: string, role: RoomPresence['role']): RoomPresence => ({
    v: 1,
    userId,
    role,
  });

  it('finds the host’s entry', () => {
    expect(hostPresentIn([entry(member, 'member'), entry(host, 'host')], host)).toBe(true);
  });

  it('needs the host role, not just the user', () => {
    expect(hostPresentIn([entry(host, 'member')], host)).toBe(false);
  });

  it('is false for an empty channel or only listeners', () => {
    expect(hostPresentIn([], host)).toBe(false);
    expect(hostPresentIn([entry(member, 'member')], host)).toBe(false);
  });

  it('ignores a different user claiming the host role', () => {
    expect(hostPresentIn([entry(member, 'host')], host)).toBe(false);
  });
});

describe('secondsLeft', () => {
  it('rounds up, and never shows 0 while still reconnecting', () => {
    expect(secondsLeft({ kind: 'reconnecting', awayMs: 0, remainingMs: 30_000 })).toBe(30);
    expect(secondsLeft({ kind: 'reconnecting', awayMs: 0, remainingMs: 12_001 })).toBe(13);
    expect(secondsLeft({ kind: 'reconnecting', awayMs: 0, remainingMs: 1 })).toBe(1);
  });
});
