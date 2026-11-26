import type { RealtimeChannelLike, RealtimeClientLike, SubscribeStatus } from '@/services/realtime';

/** A fake supabase-js channel: tests play server messages and statuses into it. */
export class FakeChannel implements RealtimeChannelLike {
  broadcast: ((message: { event?: string; payload?: unknown }) => void) | null = null;
  sync: (() => void) | null = null;
  status: ((status: SubscribeStatus, error?: Error) => void) | null = null;
  state: Record<string, unknown[]> = {};
  tracked: Record<string, unknown>[] = [];
  untracked = 0;

  constructor(
    readonly name: string,
    readonly options: unknown,
  ) {}

  on(type: 'broadcast' | 'presence', _filter: unknown, callback: (...args: never[]) => void) {
    if (type === 'broadcast') this.broadcast = callback as FakeChannel['broadcast'];
    else this.sync = callback as FakeChannel['sync'];
    return this;
  }

  subscribe(callback: (status: SubscribeStatus, error?: Error) => void) {
    this.status = callback;
    return this;
  }

  presenceState() {
    return this.state;
  }

  async track(payload: Record<string, unknown>) {
    this.tracked.push(payload);
    return 'ok';
  }

  async untrack() {
    this.untracked += 1;
    return 'ok';
  }

  /** The server sends a broadcast on this channel. */
  send(payload: unknown, event = 'queue.changed') {
    this.broadcast?.({ event, payload });
  }
}

/** A fake client at the Realtime boundary: every channel it makes is kept for the test. */
export function createFakeRealtimeClient() {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const client: RealtimeClientLike & { channels: FakeChannel[]; removed: FakeChannel[] } = {
    channels,
    removed,
    channel: (name, options) => {
      const channel = new FakeChannel(name, options);
      channels.push(channel);
      return channel;
    },
    removeChannel: async (channel) => {
      removed.push(channel as FakeChannel);
      return 'ok';
    },
    realtime: { setAuth: async () => undefined },
  };
  return client;
}
