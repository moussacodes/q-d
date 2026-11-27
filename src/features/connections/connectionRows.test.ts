import type { MusicProvider } from '@/domain/music-provider';
import type { ConnectionState } from '@/providers';
import { addLogSink, type LogEntry } from '@/services/logger';

import {
  isRealConnection,
  localConnectionOf,
  reconcileProviderRows,
  type ConnectionRowDeps,
} from './connectionRows';

const providers: MusicProvider[] = ['spotify', 'apple_music'];

function deps(stored: Partial<Record<MusicProvider, ConnectionState | null | Error>>) {
  const value = {
    stored: jest.fn(async (provider: MusicProvider) => {
      const state = stored[provider] ?? null;
      if (state instanceof Error) throw state;
      return state;
    }),
    record: jest.fn(async (_provider: MusicProvider) => ({ ok: true as const, value: undefined })),
    remove: jest.fn(async (_provider: MusicProvider) => ({ ok: true as const, value: undefined })),
  } satisfies ConnectionRowDeps;
  return value;
}

let entries: LogEntry[];
let removeSink: () => void;
beforeEach(() => {
  entries = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const method of ['info', 'warn', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});
afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

describe('isRealConnection', () => {
  it.each([
    [{ status: 'connected', isMock: false }, true],
    [{ status: 'connected', accountLabel: 'Mock account', isMock: true }, false],
    [{ status: 'needs_authorization', isMock: false }, false],
    [{ status: 'error', code: 'provider_unavailable', isMock: false }, false],
    [null, false],
    [undefined, false],
  ] as const)('%j → %s', (state, expected) => {
    expect(isRealConnection(state as ConnectionState | null | undefined)).toBe(expected);
  });
});

describe('localConnectionOf', () => {
  it.each([
    [{ status: 'connected', isMock: false }, 'usable'],
    [{ status: 'needs_authorization', isMock: false }, 'unusable'],
    [{ status: 'error', code: 'not_approved_user', isMock: false }, 'unusable'],
    [{ status: 'error', code: 'permission_denied', isMock: false }, 'unusable'],
    // Offline or Spotify failing: keep the row, try later.
    [{ status: 'error', code: 'provider_unavailable', isMock: false }, 'unknown'],
    [{ status: 'error', code: 'rate_limited', isMock: false }, 'unknown'],
    [{ status: 'error', code: 'not_configured', isMock: false }, 'unknown'],
    [{ status: 'needs_subscription', isMock: false }, 'unknown'],
    [{ status: 'connected', accountLabel: 'Mock account', isMock: true }, 'unknown'],
    [null, 'unknown'],
  ] as const)('%j → %s', (state, expected) => {
    expect(localConnectionOf(state as ConnectionState | null)).toBe(expected);
  });
});

describe('reconcileProviderRows', () => {
  it('no tokens here: deletes the row and shows nothing connected', async () => {
    const d = deps({ spotify: { status: 'needs_authorization', isMock: false } });
    const outcome = await reconcileProviderRows(providers, d);
    expect(d.remove).toHaveBeenCalledWith('spotify');
    expect(d.record).not.toHaveBeenCalled();
    expect(outcome.connected).toEqual({});
    expect(outcome.plan).toEqual({ remove: ['spotify'], record: [] });
  });

  it('a real connection that checks out: writes its row and reports it connected', async () => {
    const d = deps({ spotify: { status: 'connected', isMock: false } });
    const outcome = await reconcileProviderRows(providers, d);
    expect(d.record).toHaveBeenCalledWith('spotify', { status: 'connected', isMock: false });
    expect(d.remove).not.toHaveBeenCalled();
    expect(outcome.connected).toEqual({ spotify: { status: 'connected', isMock: false } });
    expect(outcome.recorded).toEqual(['spotify']);
  });

  it('a failed write is not reported as recorded', async () => {
    const d = deps({ spotify: { status: 'connected', isMock: false } });
    d.record.mockResolvedValueOnce({ ok: false, error: 'network' } as never);
    const outcome = await reconcileProviderRows(providers, d);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.connected).toHaveProperty('spotify');
  });

  it('a build with no real path (flag off, Apple not built) writes nothing', async () => {
    const d = deps({});
    const outcome = await reconcileProviderRows(providers, d);
    expect(d.stored).toHaveBeenCalledTimes(2);
    expect(d.record).not.toHaveBeenCalled();
    expect(d.remove).not.toHaveBeenCalled();
    expect(outcome).toEqual({ plan: { remove: [], record: [] }, connected: {}, recorded: [] });
    expect(entries).toEqual([]);
  });

  it('offline: keeps the row', async () => {
    const d = deps({ spotify: { status: 'error', code: 'provider_unavailable', isMock: false } });
    await reconcileProviderRows(providers, d);
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it('a check that throws counts as unknown', async () => {
    const d = deps({ spotify: new Error('keychain locked') });
    await reconcileProviderRows(providers, d);
    expect(d.remove).not.toHaveBeenCalled();
  });

  it('a delete that fails is logged by service and result only', async () => {
    const d = deps({ spotify: { status: 'needs_authorization', isMock: false } });
    d.remove.mockResolvedValueOnce({ ok: false, error: 'network' } as never);
    await reconcileProviderRows(providers, d);
    expect(entries.map((entry) => [entry.message, entry.context])).toContainEqual([
      'Stale connection row kept',
      { provider: 'spotify', result: 'network' },
    ]);
  });

  it('a mock connection is never recorded', async () => {
    const d = deps({
      spotify: { status: 'connected', accountLabel: 'Mock account', isMock: true },
    });
    const outcome = await reconcileProviderRows(providers, d);
    expect(d.record).not.toHaveBeenCalled();
    expect(outcome.connected).toEqual({});
  });
});
