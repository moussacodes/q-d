import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { hostStatus, HOST_RECONNECT_GRACE_MS } from '@/domain/host-presence';
import { roomKeys } from '@/services/roomQueryKeys';
import { createFakeRealtimeClient } from '@/test/fakeRealtime';

import { useRoomRealtime, type UseRoomRealtimeOptions } from './useRoomRealtime';

const roomId = '6f1f8a3e-2a4b-4c1d-9e8f-0a1b2c3d4e5f';
const userId = '11111111-2222-4333-8444-555555555555';
const hostId = '99999999-8888-4777-8666-555555555555';
const at = '2026-11-25T18:00:00.000Z';

const event = (type: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  type,
  roomId,
  at,
  ...extra,
});

async function setup(options: Partial<UseRoomRealtimeOptions> = {}) {
  const client = createFakeRealtimeClient();
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  let clock = 1_000_000;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const props: UseRoomRealtimeOptions = {
    client,
    roomId,
    userId,
    role: 'member',
    hostUserId: hostId,
    now: () => clock,
    ...options,
  };
  const hook = await renderHook((p: UseRoomRealtimeOptions) => useRoomRealtime(p), {
    wrapper,
    initialProps: props,
  });
  const channel = () => client.channels[client.channels.length - 1];
  /** setAuth settles, then the channel joins. */
  const join = async () => {
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      channel().status?.('SUBSCRIBED');
    });
  };
  const sync = (entries: Record<string, unknown[]>) =>
    act(async () => {
      channel().state = entries;
      channel().sync?.();
    });
  const keys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return {
    client,
    hook,
    invalidate,
    channel,
    join,
    sync,
    keys,
    tick: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

const hostEntry = { v: 1, userId: hostId, role: 'host' };
const meEntry = { v: 1, userId, role: 'member' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useRoomRealtime', () => {
  it('connects nothing outside live mode', async () => {
    const { client, hook } = await setup({ client: null });
    expect(client.channels).toHaveLength(0);
    expect(hook.result.current.connection).toBe('connecting');
  });

  it('connects nothing until the room and the user are known', async () => {
    expect((await setup({ roomId: null })).client.channels).toHaveLength(0);
    expect((await setup({ userId: null })).client.channels).toHaveLength(0);
  });

  it('is online once the channel joins', async () => {
    const { hook, join } = await setup();
    await join();
    expect(hook.result.current.connection).toBe('online');
  });

  describe('invalidation (refetch, never trust payloads)', () => {
    it.each([
      ['queue.changed', [roomKeys.queue(roomId), roomKeys.playback(roomId)]],
      ['playback.changed', [roomKeys.playback(roomId), roomKeys.queue(roomId)]],
      ['members.changed', [roomKeys.members(roomId), roomKeys.detail(roomId)]],
      ['room.ended', [roomKeys.room(roomId), roomKeys.mine]],
    ])('%s refetches what it names', async (type, expected) => {
      const { join, channel, keys } = await setup();
      await join();
      await act(async () => {
        channel().send(event(type));
      });
      expect(keys()).toEqual(expected);
    });

    it.each([
      ['a newer version', event('queue.changed', { v: 2 })],
      ['an unknown type', event('reactions.changed')],
      ['another room', event('queue.changed', { roomId: hostId })],
      ['garbage', 'nope'],
    ])('refetches the whole room for %s, and doesn’t crash', async (_, payload) => {
      const { join, channel, keys, hook } = await setup();
      await join();
      await act(async () => {
        channel().send(payload);
      });
      expect(keys()).toEqual([roomKeys.room(roomId)]);
      expect(hook.result.current.ended).toBe(false);
    });

    it('never puts payload data in the cache', async () => {
      const { join, channel, invalidate } = await setup();
      await join();
      await act(async () => {
        channel().send(event('queue.changed', { title: 'Rain Down' }));
      });
      expect(JSON.stringify(invalidate.mock.calls)).not.toContain('Rain Down');
    });

    it('refetches everything after a reconnect', async () => {
      const { join, channel, keys, hook } = await setup();
      await join();
      await act(async () => {
        channel().status?.('CHANNEL_ERROR');
      });
      expect(hook.result.current.connection).toBe('offline');
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await act(async () => {
        channel().status?.('SUBSCRIBED');
      });
      expect(hook.result.current.connection).toBe('online');
      expect(keys()).toEqual([roomKeys.room(roomId)]);
    });
  });

  it('marks the room ended on room.ended', async () => {
    const { join, channel, hook } = await setup();
    await join();
    await act(async () => {
      channel().send(event('room.ended'));
    });
    expect(hook.result.current.ended).toBe(true);
  });

  describe('presence → host status', () => {
    it('counts the host as connected before the first sync', async () => {
      const { hook, now } = await setup();
      expect(hostStatus(hook.result.current.hostPresence, now())).toEqual({ kind: 'connected' });
    });

    it('is connected while the host’s entry is in the channel, and counts people', async () => {
      const { hook, join, sync, now } = await setup();
      await join();
      await sync({ [hostId]: [hostEntry], [userId]: [meEntry] });
      expect(hostStatus(hook.result.current.hostPresence, now())).toEqual({ kind: 'connected' });
      expect(hook.result.current.presentCount).toBe(2);
    });

    it('says the host is reconnecting when their entry leaves, then away after 30 s', async () => {
      const { hook, join, sync, tick, now } = await setup();
      await join();
      await sync({ [hostId]: [hostEntry], [userId]: [meEntry] });
      await sync({ [userId]: [meEntry] });
      expect(hostStatus(hook.result.current.hostPresence, now()).kind).toBe('reconnecting');
      tick(HOST_RECONNECT_GRACE_MS);
      expect(hostStatus(hook.result.current.hostPresence, now()).kind).toBe('away');
      await sync({ [hostId]: [hostEntry], [userId]: [meEntry] });
      expect(hostStatus(hook.result.current.hostPresence, now())).toEqual({ kind: 'connected' });
    });

    it('treats a host it has never seen as away, not reconnecting', async () => {
      const { hook, join, sync, now } = await setup();
      await join();
      await sync({ [userId]: [meEntry] });
      expect(hostStatus(hook.result.current.hostPresence, now())).toEqual({
        kind: 'away',
        awayMs: null,
      });
    });

    it('doesn’t take a member’s entry claiming the host’s id with another role as the host', async () => {
      const { hook, join, sync, now } = await setup();
      await join();
      await sync({ [hostId]: [{ v: 1, userId: hostId, role: 'member' }] });
      expect(hostStatus(hook.result.current.hostPresence, now()).kind).toBe('away');
    });

    it('ignores presence entries it can’t read', async () => {
      const { hook, join, sync } = await setup();
      await join();
      await sync({ [hostId]: [hostEntry], junk: [{ v: 9, userId, role: 'member' }, null] });
      expect(hook.result.current.presentCount).toBe(1);
    });

    it('on the host’s own phone, losing the channel is the host leaving: the room pauses after 30 s', async () => {
      const { hook, join, sync, channel, tick, now } = await setup({
        role: 'host',
        userId: hostId,
      });
      await join();
      expect(channel().tracked).toEqual([{ v: 1, userId: hostId, role: 'host' }]);
      await sync({ [hostId]: [hostEntry] });
      await act(async () => {
        channel().status?.('TIMED_OUT');
      });
      expect(hook.result.current.connection).toBe('offline');
      expect(hostStatus(hook.result.current.hostPresence, now()).kind).toBe('reconnecting');
      tick(HOST_RECONNECT_GRACE_MS);
      expect(hostStatus(hook.result.current.hostPresence, now()).kind).toBe('away');
    });

    it('on a listener’s phone, going offline keeps the host as last seen', async () => {
      const { hook, join, sync, channel, now } = await setup();
      await join();
      await sync({ [hostId]: [hostEntry] });
      await act(async () => {
        channel().status?.('CLOSED');
      });
      expect(hook.result.current.connection).toBe('offline');
      expect(hostStatus(hook.result.current.hostPresence, now())).toEqual({ kind: 'connected' });
    });
  });

  it('leaves the channel when unmounted', async () => {
    const { hook, join, client, channel } = await setup();
    await join();
    const joined = channel();
    await hook.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(joined.untracked).toBe(1);
    expect(client.removed).toContain(joined);
  });

  it('moves to the new room’s channel when the room changes', async () => {
    const { hook, join, client } = await setup();
    await join();
    const other = '0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f';
    await hook.rerender({
      client,
      roomId: other,
      userId,
      role: 'member',
      hostUserId: hostId,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.channels.map((c) => c.name)).toEqual([`room:${roomId}`, `room:${other}`]);
  });
});
