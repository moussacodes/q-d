import type { PostgrestErrorLike } from '@/services/rpc';

import { createFakeRealtimeClient } from './fakeRealtime';

/**
 * A stand-in for the Supabase client's data side at the service boundary:
 * in-memory tables behind `from(table).select().eq().in().order().limit()`,
 * plus `insert(row)`, `update(change).eq()…[.select()]` and
 * `delete().eq()…` for the few direct writes RLS allows (a duplicate key in
 * `UNIQUE_KEYS` answers `23505`, like Postgres),
 * `rpc` as a jest.fn the test answers, and a fake Realtime client. It filters
 * like PostgREST but returns whole rows (it ignores the select list), so
 * tests check the mapping, not PostgREST's column picking. Nothing here
 * touches the network.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type RpcAnswer = { data: unknown; error: PostgrestErrorLike | null; status?: number };

/** An error the way supabase-js reports one an RPC raised with `private.raise_error`. */
export function rpcError(code: string, details: Record<string, unknown> = {}): RpcAnswer {
  return {
    data: null,
    error: { code: 'P0001', message: code, details: JSON.stringify(details), hint: 'qd' },
    status: 400,
  };
}

/** Primary keys the fake enforces on insert. */
const UNIQUE_KEYS: Record<string, string[]> = {
  provider_connections: ['user_id', 'provider'],
};

type WriteAnswer = { data: Row[] | null; error: { code?: string; message?: string } | null };

export function createFakeSupabaseData(initial: Record<string, Row[]> = {}) {
  const tables = new Map<string, Row[]>(Object.entries(initial).map(([k, v]) => [k, [...v]]));
  /** Tables whose next read fails, e.g. to show a load error. */
  const failing = new Set<string>();
  /** Tables whose writes fail, with this error. */
  const failingWrites = new Map<string, { code?: string; message?: string }>();
  const reads: string[] = [];
  /** Every write, in order: what the app sent, for tests to check. */
  const writes: {
    table: string;
    op: 'insert' | 'update' | 'delete';
    values?: Row;
    filters: Row;
  }[] = [];

  /** `update(change)` or `delete()`: filters by `eq`, runs when awaited or on `select()`. */
  const mutation = (table: string, op: 'update' | 'delete', change?: Row) => {
    const filters: Row = {};
    const run = (): WriteAnswer => {
      writes.push({ table, op, values: change, filters: { ...filters } });
      const failure = failingWrites.get(table);
      if (failure) return { data: null, error: failure };
      const rows = tables.get(table) ?? [];
      const matches = (row: Row) => Object.entries(filters).every(([k, v]) => row[k] === v);
      const hit = rows.filter(matches);
      tables.set(
        table,
        op === 'delete'
          ? rows.filter((row) => !matches(row))
          : rows.map((row) => (matches(row) ? { ...row, ...change } : row)),
      );
      return { data: hit.map((row) => ({ ...row, ...change })), error: null };
    };
    const builder = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      select: async (_columns?: string) => run(),
      then<A = WriteAnswer, B = never>(
        resolve?: ((value: WriteAnswer) => A | PromiseLike<A>) | null,
        reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
      ): PromiseLike<A | B> {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  };

  const insertRow = async (table: string, row: Row): Promise<WriteAnswer> => {
    writes.push({ table, op: 'insert', values: { ...row }, filters: {} });
    const failure = failingWrites.get(table);
    if (failure) return { data: null, error: failure };
    const rows = tables.get(table) ?? [];
    const key = UNIQUE_KEYS[table];
    if (key && rows.some((existing) => key.every((column) => existing[column] === row[column]))) {
      return { data: null, error: { code: '23505', message: 'duplicate key value' } };
    }
    tables.set(table, [...rows, { ...row }]);
    return { data: null, error: null };
  };

  const from = jest.fn((table: string) => ({
    insert: (row: Row) => insertRow(table, row),
    update: (change: Row) => mutation(table, 'update', change),
    delete: () => mutation(table, 'delete'),
    select: (_columns: string) => {
      const filters: Filter[] = [];
      let order: { column: string; ascending: boolean } | null = null;
      let limit: number | null = null;
      type Answer = { data: Row[] | null; error: { code?: string; message?: string } | null };
      const run = (): Answer => {
        reads.push(table);
        if (failing.has(table)) {
          return { data: null, error: { code: '42501', message: 'permission denied' } };
        }
        let rows = (tables.get(table) ?? []).filter((row) => filters.every((f) => f(row)));
        if (order) {
          const { column, ascending } = order;
          rows = [...rows].sort((a, b) => {
            const x = a[column] as string | number;
            const y = b[column] as string | number;
            return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        if (limit !== null) rows = rows.slice(0, limit);
        return { data: rows.map((row) => ({ ...row })), error: null };
      };
      const builder = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        order(column: string, options: { ascending?: boolean } = {}) {
          order = { column, ascending: options.ascending ?? true };
          return builder;
        },
        limit(count: number) {
          limit = count;
          return builder;
        },
        maybeSingle: async () => {
          const { data, error } = run();
          return { data: data?.[0] ?? null, error };
        },
        then<A = Answer, B = never>(
          resolve?: ((value: Answer) => A | PromiseLike<A>) | null,
          reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
        ): PromiseLike<A | B> {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
    },
  }));

  const rpc = jest.fn(
    async (_name: string, _args: Record<string, unknown>): Promise<RpcAnswer> => ({
      data: null,
      error: { message: 'not answered by the test' },
    }),
  );

  const realtime = createFakeRealtimeClient();

  return {
    from,
    rpc,
    realtime,
    /** What to spread into a fake `SupabaseClient`. */
    client: {
      from,
      rpc,
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      realtime: realtime.realtime,
    },
    tables,
    reads,
    writes,
    /** Writes to `table` fail with `error` (or succeed again with null). */
    failWrites(table: string, error: { code?: string; message?: string } | null) {
      if (error) failingWrites.set(table, error);
      else failingWrites.delete(table);
    },
    rows: (table: string) => tables.get(table) ?? [],
    insert(table: string, ...rows: Row[]) {
      tables.set(table, [...(tables.get(table) ?? []), ...rows]);
    },
    update(table: string, where: Filter, change: Row) {
      tables.set(
        table,
        (tables.get(table) ?? []).map((row) => (where(row) ? { ...row, ...change } : row)),
      );
    },
    fail(table: string, on = true) {
      if (on) failing.add(table);
      else failing.delete(table);
    },
  };
}

export type FakeSupabaseData = ReturnType<typeof createFakeSupabaseData>;
