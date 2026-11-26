import { roomChannel } from '@/domain/realtime';

import { FakeChannel } from '@/test/fakeRealtime';

import {
  joinRoomChannel,
  presenceEntries,
  RECONNECT_DELAYS_MS,
  reconnectDelay,
  signalFor,
  type RealtimeClientLike,
  type RealtimeStatus,
  type RoomSignal,
} from './realtime';

const roomId = '6f1f8a3e-2a4b-4c1d-9e8f-0a1b2c3d4e5f';
const otherRoomId = '0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f';
const userId = '11111111-2222-4333-8444-555555555555';
const hostId = '99999999-8888-4777-8666-555555555555';
const at = '2026-11-25T18:00:00.000Z';

function setup(role: 'host' | 'member' = 'member', authFails = false) {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const setAuth = jest.fn(async () => {
    if (authFails) throw new Error('no session');
  });
  const client: RealtimeClientLike = {
    channel: (name, options) => {
      const channel = new FakeChannel(name, options);
      channels.push(channel);
      return channel;
    },
    removeChannel: async (channel) => {
      removed.push(channel as FakeChannel);
      return 'ok';
    },
    realtime: { setAuth },
  };
  const signals: RoomSignal[] = [];
  const presence: unknown[][] = [];
  const statuses: RealtimeStatus[] = [];
  const close = joinRoomChannel({
    client,
    roomId,
    me: { userId, role },
    onSignal: (signal) => signals.push(signal),
    onPresence: (entries) => presence.push(entries),
    onStatus: (status) => statuses.push(status),
  });
  /** Lets the setAuth promise settle so the first channel exists. */
  const started = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const latest = () => channels[channels.length - 1];
  return { channels, removed, setAuth, signals, presence, statuses, close, started, latest };
}

const event = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'queue.changed',
  roomId,
  at,
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('signalFor (versioned event validation)', () => {
  it.each(['queue.changed', 'playback.changed', 'members.changed', 'room.ended'])(
    'reads a %s event for this room',
    (type) => {
      expect(signalFor(event({ type }), roomId)).toEqual({
        kind: 'event',
        event: { v: 1, type, roomId, at },
      });
    },
  );

  it('refetches for a newer envelope version instead of guessing what it means', () => {
    expect(signalFor(event({ v: 2 }), roomId)).toEqual({
      kind: 'refetch',
      reason: 'unsupported_version',
    });
  });

  it('refetches for an event type this client doesn’t know yet', () => {
    expect(signalFor(event({ type: 'reactions.changed' }), roomId)).toEqual({
      kind: 'refetch',
      reason: 'unknown_type',
    });
  });

  it('refetches for an event that names another room', () => {
    expect(signalFor(event({ roomId: otherRoomId }), roomId)).toEqual({
      kind: 'refetch',
      reason: 'wrong_room',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'queue.changed'],
    ['an array', [1, 2]],
    ['no version', { type: 'queue.changed', roomId, at }],
    ['a bad time', event({ at: 'yesterday' })],
    ['a bad id', event({ roomId: 'not-a-uuid' })],
  ])('refetches, never throws, for %s', (_, payload) => {
    expect(() => signalFor(payload, roomId)).not.toThrow();
    expect(signalFor(payload, roomId).kind).toBe('refetch');
  });

  it('drops extra fields, so nothing personal a payload carries reaches the app', () => {
    const signal = signalFor(event({ email: 'someone@example.com', title: 'Rain Down' }), roomId);
    expect(signal).toEqual({ kind: 'event', event: { v: 1, type: 'queue.changed', roomId, at } });
  });

  it('logs only field paths and codes for a payload it ignores, never its values', () => {
    const warn = jest.spyOn(console, 'warn');
    signalFor(event({ roomId: 'someone@example.com' }), roomId);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('someone@example.com');
  });
});

describe('presenceEntries', () => {
  it('keeps every entry that parses and drops the rest', () => {
    expect(
      presenceEntries({
        [userId]: [{ v: 1, userId, role: 'member', presence_ref: 'a' }],
        [hostId]: [
          { v: 1, userId: hostId, role: 'host' },
          { v: 2, userId: hostId, role: 'host' },
        ],
        junk: [null, { name: 'Sam' }],
      }),
    ).toEqual([
      { v: 1, userId, role: 'member' },
      { v: 1, userId: hostId, role: 'host' },
    ]);
  });
});

describe('joinRoomChannel', () => {
  it('sets the user’s token, then joins the room’s private channel keyed by user id', async () => {
    const { setAuth, channels, started, statuses } = setup();
    expect(channels).toHaveLength(0);
    await started();
    expect(statuses).toEqual(['connecting']);
    expect(setAuth).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe(roomChannel(roomId));
    expect(channels[0].options).toEqual({
      config: { private: true, presence: { key: userId } },
    });
  });

  it('tracks only the user id and role once subscribed: no name, email or song', async () => {
    const { latest, started, statuses } = setup('host');
    await started();
    latest().status?.('SUBSCRIBED');
    expect(statuses).toEqual(['connecting', 'online']);
    expect(latest().tracked).toEqual([{ v: 1, userId, role: 'host' }]);
  });

  it('passes events through the versioned parser', async () => {
    const { latest, started, signals } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().send(event({ type: 'members.changed' }));
    latest().send(event({ v: 3 }));
    latest().send('garbage');
    expect(signals).toEqual([
      { kind: 'event', event: { v: 1, type: 'members.changed', roomId, at } },
      { kind: 'refetch', reason: 'unsupported_version' },
      { kind: 'refetch', reason: 'invalid' },
    ]);
  });

  it('reports presence after each sync', async () => {
    const { latest, started, presence } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().state = { [hostId]: [{ v: 1, userId: hostId, role: 'host' }] };
    latest().sync?.();
    latest().state = {};
    latest().sync?.();
    expect(presence).toEqual([[{ v: 1, userId: hostId, role: 'host' }], []]);
  });

  it('goes offline when the channel drops, and reconnects with growing delays', async () => {
    const { channels, latest, started, statuses, removed } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().status?.('CHANNEL_ERROR');
    expect(statuses.at(-1)).toBe('offline');
    expect(removed).toEqual([channels[0]]);

    // First retry after 1 s, then 2 s, 4 s…
    jest.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
    expect(channels).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(channels).toHaveLength(2);
    latest().status?.('TIMED_OUT');
    jest.advanceTimersByTime(RECONNECT_DELAYS_MS[1] - 1);
    expect(channels).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(channels).toHaveLength(3);
    expect(statuses.at(-1)).toBe('offline');
  });

  it('caps the delay at 30 s, and resets it after a successful reconnect', async () => {
    expect(reconnectDelay(0)).toBe(1_000);
    expect(reconnectDelay(5)).toBe(30_000);
    expect(reconnectDelay(50)).toBe(30_000);

    const { channels, latest, started } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    for (let i = 0; i < 8; i += 1) {
      latest().status?.('CLOSED');
      jest.advanceTimersByTime(reconnectDelay(i));
    }
    expect(channels).toHaveLength(9);
    latest().status?.('SUBSCRIBED');
    latest().status?.('CLOSED');
    jest.advanceTimersByTime(1_000);
    expect(channels).toHaveLength(10);
  });

  it('asks for a full refetch after reconnecting, because events sent meanwhile are gone', async () => {
    const { latest, started, signals, statuses } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    expect(signals).toEqual([]);
    latest().status?.('CLOSED');
    jest.advanceTimersByTime(1_000);
    latest().status?.('SUBSCRIBED');
    expect(signals).toEqual([{ kind: 'refetch', reason: 'reconnected' }]);
    expect(statuses).toEqual(['connecting', 'online', 'offline', 'online']);
    // It tracks presence again on the new channel.
    expect(latest().tracked).toHaveLength(1);
  });

  it('says offline when it never manages to join', async () => {
    const { latest, started, statuses } = setup();
    await started();
    latest().status?.('CHANNEL_ERROR');
    expect(statuses).toEqual(['connecting', 'offline']);
  });

  it('ignores messages from a channel it already replaced', async () => {
    const { channels, latest, started, signals } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().status?.('CLOSED');
    jest.advanceTimersByTime(1_000);
    channels[0].send(event());
    channels[0].status?.('SUBSCRIBED');
    expect(signals).toEqual([]);
  });

  it('closes cleanly: untracks, removes the channel and cancels a pending reconnect', async () => {
    const { channels, latest, started, statuses, close, removed } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().status?.('CLOSED');
    close();
    jest.advanceTimersByTime(60_000);
    expect(channels).toHaveLength(1);
    expect(statuses.at(-1)).toBe('closed');
    expect(removed).toHaveLength(1);
  });

  it('untracks and removes a live channel on close, and ignores anything after', async () => {
    const { latest, started, close, removed, signals } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    const channel = latest();
    close();
    close();
    await Promise.resolve();
    await Promise.resolve();
    expect(channel.untracked).toBe(1);
    expect(removed).toEqual([channel]);
    channel.send(event());
    expect(signals).toEqual([]);
  });

  it('joins nothing when closed before the token is set', async () => {
    const { channels, started, close, statuses } = setup();
    close();
    await started();
    await Promise.resolve();
    expect(channels).toHaveLength(0);
    expect(statuses).toEqual(['closed']);
  });

  it('keeps going when presence track or untrack fails, and still removes the channel', async () => {
    const { latest, started, close, removed, statuses } = setup();
    await started();
    const channel = latest();
    channel.track = jest.fn(async () => {
      throw new Error('track refused');
    });
    channel.untrack = jest.fn(async () => {
      throw new Error('untrack refused');
    });
    channel.status?.('SUBSCRIBED');
    await Promise.resolve();
    expect(statuses).toEqual(['connecting', 'online']);
    close();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(removed).toEqual([channel]);
  });

  it('never passes on more than the user id and role a member’s presence carries', async () => {
    const { latest, started, presence } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().state = {
      [hostId]: [
        { v: 1, userId: hostId, role: 'host', name: 'Sam', email: 'sam@example.com', song: 'x' },
      ],
    };
    latest().sync?.();
    expect(presence).toEqual([[{ v: 1, userId: hostId, role: 'host' }]]);
  });

  it('reports one offline for a drop, however many statuses follow', async () => {
    const { latest, started, statuses } = setup();
    await started();
    latest().status?.('SUBSCRIBED');
    latest().status?.('TIMED_OUT');
    jest.advanceTimersByTime(1_000);
    latest().status?.('CHANNEL_ERROR');
    expect(statuses).toEqual(['connecting', 'online', 'offline']);
  });

  it('still joins when setting the token fails, and lets Realtime refuse it', async () => {
    const { setAuth, channels, started } = setup('member', true);
    await started();
    await Promise.resolve();
    expect(setAuth).toHaveBeenCalled();
    expect(channels).toHaveLength(1);
  });
});
