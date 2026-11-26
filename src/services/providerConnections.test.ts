import type { SupabaseClient } from '@supabase/supabase-js';

import { createFakeSupabaseData } from '@/test/fakeSupabaseData';

import { addLogSink, type LogEntry } from './logger';
import { recordProviderConnection, removeProviderConnection } from './providerConnections';

const USER = 'user-1';
const NOW = new Date('2026-11-26T10:00:00.000Z');

let entries: LogEntry[];
let removeSink: () => void;
beforeEach(() => {
  entries = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const method of ['info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});
afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

function setup(rows: Record<string, unknown>[] = []) {
  const data = createFakeSupabaseData({ provider_connections: rows });
  return { data, client: data.client as unknown as SupabaseClient };
}

/** Column names that would hold a credential. None may ever be sent. */
const CREDENTIAL = /token|secret|password|credential|refresh|access|key|code|verifier/i;

describe('recordProviderConnection', () => {
  it('inserts the caller’s row with metadata only', async () => {
    const { data, client } = setup();
    expect(await recordProviderConnection(USER, 'spotify', {}, { client, now: () => NOW })).toEqual(
      { ok: true, value: undefined },
    );
    expect(data.writes).toEqual([
      {
        table: 'provider_connections',
        op: 'insert',
        values: { user_id: USER, provider: 'spotify', last_verified_at: NOW.toISOString() },
        filters: {},
      },
    ]);
    expect(data.rows('provider_connections')).toHaveLength(1);
  });

  it('never sends connected_at (the database sets it) or a credential-like column', async () => {
    const { data, client } = setup([{ user_id: USER, provider: 'spotify' }]);
    await recordProviderConnection(USER, 'spotify', { storefront: 'US' }, { client });
    expect(data.writes).toHaveLength(2);
    for (const write of data.writes) {
      const columns = Object.keys(write.values ?? {});
      expect(columns).not.toContain('connected_at');
      expect(columns.filter((column) => CREDENTIAL.test(column))).toEqual([]);
    }
  });

  it('an existing row gets last_verified_at refreshed instead (no upsert of the key)', async () => {
    const { data, client } = setup([
      { user_id: USER, provider: 'spotify', connected_at: '2026-11-01T00:00:00Z' },
    ]);
    expect(await recordProviderConnection(USER, 'spotify', {}, { client, now: () => NOW })).toEqual(
      { ok: true, value: undefined },
    );
    expect(data.writes.map((write) => write.op)).toEqual(['insert', 'update']);
    expect(data.writes[1]).toEqual({
      table: 'provider_connections',
      op: 'update',
      values: { last_verified_at: NOW.toISOString() },
      filters: { user_id: USER, provider: 'spotify' },
    });
    expect(data.rows('provider_connections')).toEqual([
      {
        user_id: USER,
        provider: 'spotify',
        connected_at: '2026-11-01T00:00:00Z',
        last_verified_at: NOW.toISOString(),
      },
    ]);
  });

  it('keeps a valid storefront, lowercased, and drops anything else', async () => {
    const valid = setup();
    await recordProviderConnection(USER, 'apple_music', { storefront: 'US' }, valid);
    expect(valid.data.writes[0].values).toMatchObject({ storefront: 'us' });
    for (const storefront of ['usa', 'u', '12', '', null]) {
      const other = setup();
      await recordProviderConnection(USER, 'apple_music', { storefront }, other);
      expect(other.data.writes[0].values).not.toHaveProperty('storefront');
    }
  });

  it('says not_configured without a client', async () => {
    expect(await recordProviderConnection(USER, 'spotify', {}, { client: null })).toEqual({
      ok: false,
      error: 'not_configured',
    });
  });

  it.each([
    [{ message: 'Failed to fetch' }, 'network'],
    [{ code: '42501', message: 'permission denied' }, 'not_signed_in'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'not_signed_in'],
    [{ code: '23514', message: 'check' }, 'unknown'],
  ] as const)('maps an insert error %j to %s', async (error, expected) => {
    const { data, client } = setup();
    data.failWrites('provider_connections', error);
    expect(await recordProviderConnection(USER, 'spotify', {}, { client })).toEqual({
      ok: false,
      error: expected,
    });
    expect(entries.at(-1)?.context).toMatchObject({ step: 'insert', provider: 'spotify' });
  });

  it('an update that matched no row is not_signed_in', async () => {
    const fake = {
      from: () => ({
        insert: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }),
        update: () => ({
          eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await recordProviderConnection(USER, 'spotify', {}, { client: fake })).toEqual({
      ok: false,
      error: 'not_signed_in',
    });
  });

  it('a thrown request is network', async () => {
    const fake = {
      from: () => ({ insert: () => Promise.reject(new TypeError('Network request failed')) }),
    } as unknown as SupabaseClient;
    expect(await recordProviderConnection(USER, 'spotify', {}, { client: fake })).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('logs the service and step only, never the user id', async () => {
    const { client } = setup();
    await recordProviderConnection(USER, 'spotify', {}, { client });
    expect(entries.map((entry) => entry.context)).toEqual([
      { provider: 'spotify', step: 'insert' },
    ]);
    expect(JSON.stringify(entries)).not.toContain(USER);
  });
});

describe('removeProviderConnection', () => {
  it('deletes only the caller’s row for that service', async () => {
    const { data, client } = setup([
      { user_id: USER, provider: 'spotify' },
      { user_id: USER, provider: 'apple_music' },
      { user_id: 'someone-else', provider: 'spotify' },
    ]);
    expect(await removeProviderConnection(USER, 'spotify', client)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(data.writes).toEqual([
      {
        table: 'provider_connections',
        op: 'delete',
        values: undefined,
        filters: { user_id: USER, provider: 'spotify' },
      },
    ]);
    expect(data.rows('provider_connections')).toEqual([
      { user_id: USER, provider: 'apple_music' },
      { user_id: 'someone-else', provider: 'spotify' },
    ]);
  });

  it('deleting a row that isn’t there is fine', async () => {
    const { client } = setup();
    expect(await removeProviderConnection(USER, 'spotify', client)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('reports failures', async () => {
    const { data, client } = setup();
    data.failWrites('provider_connections', { message: 'Network request failed' });
    expect(await removeProviderConnection(USER, 'spotify', client)).toEqual({
      ok: false,
      error: 'network',
    });
    expect(await removeProviderConnection(USER, 'spotify', null)).toEqual({
      ok: false,
      error: 'not_configured',
    });
  });
});
