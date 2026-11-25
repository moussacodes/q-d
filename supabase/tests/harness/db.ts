/**
 * Database test harness: a fresh in-memory Postgres (PGlite) with the Supabase
 * shim and every migration in supabase/migrations applied in order.
 *
 * Usage, one database per test file:
 *
 *   let db: TestDb;
 *   beforeAll(async () => { db = await createTestDb(); });
 *   afterAll(() => db.close());
 *
 *   const host = await db.createUser({ provider: 'spotify' });
 *   const result = await db.as(host).rpc('create_room', { name: 'Friday', ... });
 *   await expect(db.as(member).rpc('end_room', { ... })).rejects.toMatchObject({ code: 'not_host' });
 *
 * `db.as(user)` runs each statement in its own transaction as the
 * `authenticated` role with `request.jwt.claim.sub` set, the way PostgREST
 * does, so RLS policies and security-definer functions run for real.
 * `db.asAnon()` uses the `anon` role. `db.query()` runs as the superuser, for
 * setup and for reading what the RPCs wrote.
 *
 * Like PostgREST, an RPC that sets `response.status` to 400 or more and returns
 * normally still commits, and the caller gets an error built from the body it
 * returned (private.error_response, used where a failed attempt must be kept).
 *
 * The same tests should also pass against a real Supabase local stack
 * (`supabase start` on a machine with Docker); PGlite is what runs in CI here.
 */
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_DIR = join(__dirname, '..', '..');
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');
const SHIM_FILE = join(__dirname, 'supabase-shim.sql');

/** Migration files in the order Supabase applies them (by filename). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/** A stable q’d error from an RPC (API_CONTRACTS.md §2), or a raw database error. */
export class DbError extends Error {
  /** The q’d error code (for example `room_full`), or the raw message. */
  readonly code: string;
  /** The Postgres SQLSTATE, for example `P0001` or `42501` (permission denied). */
  readonly sqlstate: string | undefined;
  /** Parsed `detail` JSON when the error carries extra fields. */
  readonly details: unknown;
  /** `qd` for errors raised by private.raise_error. */
  readonly hint: string | undefined;

  constructor(cause: unknown) {
    const err = cause as { message?: string; code?: string; detail?: string; hint?: string };
    super(err.message ?? String(cause));
    this.name = 'DbError';
    this.code = err.message ?? String(cause);
    this.sqlstate = err.code;
    this.hint = err.hint;
    let details: unknown = err.detail;
    if (typeof err.detail === 'string') {
      try {
        details = JSON.parse(err.detail);
      } catch {
        details = err.detail;
      }
    }
    this.details = details;
  }
}

export type TestUser = { id: string };

export type CreateUserOptions = {
  /** Finish onboarding step 1 (name, color, 18+). Default true. */
  profile?: boolean;
  displayName?: string;
  /** Connected music services. Default none. */
  provider?: 'apple_music' | 'spotify' | ('apple_music' | 'spotify')[];
};

type Row = Record<string, unknown>;

export type RoomBroadcast = {
  event: string;
  payload: { v: number; type: string; roomId: string; at: string };
  private: boolean;
};

export type Session = {
  /** Run SQL as this session. Returns the rows. */
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Call a public function with named arguments, like `supabase.rpc(name, args)`.
   * Returns the function's result value.
   */
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
};

export type TestDb = Session & {
  pg: PGlite;
  /** Run several SQL statements as the superuser (setup only). */
  exec(sql: string): Promise<void>;
  /**
   * Act as a signed-in user. `settings` sets extra transaction-local settings,
   * for example `{ 'realtime.topic': 'room:<id>' }` to act as a Realtime
   * subscriber on that channel.
   */
  as(user: TestUser | string, settings?: Record<string, string>): Session;
  asAnon(): Session;
  asServiceRole(): Session;
  createUser(options?: CreateUserOptions): Promise<TestUser>;
  /** Broadcasts sent on a room's channel (`room:<id>`), oldest first. */
  broadcasts(roomId: string): Promise<RoomBroadcast[]>;
  close(): Promise<void>;
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function rpcSql(name: string, args: Record<string, unknown>): { sql: string; params: unknown[] } {
  if (!IDENTIFIER.test(name)) throw new Error(`Bad function name: ${name}`);
  const keys = Object.keys(args);
  const params = keys.map((key) => {
    if (!IDENTIFIER.test(key)) throw new Error(`Bad argument name: ${key}`);
    const value = args[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? JSON.stringify(value)
      : value;
  });
  const list = keys.map((key, i) => `${key} => $${i + 1}`).join(', ');
  return { sql: `select public.${name}(${list}) as result`, params };
}

type Role = {
  role: 'authenticated' | 'anon' | 'service_role';
  sub: string | null;
  settings?: Record<string, string>;
};

/** PostgREST's answer when a function set `response.status` to an error. */
class ErrorResponse {
  constructor(readonly body: unknown) {}
}

function session(pg: PGlite, who: Role | null): Session {
  const run = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    let result: T[] | ErrorResponse;
    try {
      if (who === null) {
        return (await pg.query<T>(sql, params)).rows;
      }
      result = await pg.transaction(async (tx) => {
        const claims = JSON.stringify(
          who.sub ? { sub: who.sub, role: who.role } : { role: who.role },
        );
        await tx.query(
          `select set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.role', $2, true),
                  set_config('request.jwt.claims', $3, true)`,
          [who.sub ?? '', who.role, claims],
        );
        for (const [name, value] of Object.entries(who.settings ?? {})) {
          await tx.query('select set_config($1, $2, true)', [name, value]);
        }
        await tx.exec(`set local role ${who.role}`);
        const rows = (await tx.query<T>(sql, params)).rows;
        const [{ status }] = (
          await tx.query<{ status: string | null }>(
            `select nullif(current_setting('response.status', true), '') as status`,
          )
        ).rows;
        if (status !== null && Number(status) >= 400) {
          const first = rows[0] as Record<string, unknown> | undefined;
          return new ErrorResponse(first ? Object.values(first)[0] : null);
        }
        return rows;
      });
    } catch (cause) {
      throw new DbError(cause);
    }
    if (result instanceof ErrorResponse) {
      // Committed, like PostgREST: only the response is an error. The body has
      // PostgREST's error shape ({ code, message, details, hint }).
      const body = (result.body ?? {}) as { details?: string | null };
      throw new DbError({ ...body, detail: body.details ?? undefined });
    }
    return result;
  };
  return {
    query: run,
    async rpc<T>(name: string, args: Record<string, unknown> = {}) {
      const { sql, params } = rpcSql(name, args);
      const rows = await run<{ result: T }>(sql, params);
      return rows[0].result;
    },
  };
}

/** A fresh database with the shim and every migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(readFileSync(SHIM_FILE, 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (cause) {
      throw new Error(`Migration ${file} failed: ${(cause as Error).message}`);
    }
  }
  const superuser = session(pg, null);
  let userCount = 0;

  return {
    pg,
    ...superuser,
    async exec(sql) {
      await pg.exec(sql);
    },
    as: (user, settings) =>
      session(pg, {
        role: 'authenticated',
        sub: typeof user === 'string' ? user : user.id,
        settings,
      }),
    asAnon: () => session(pg, { role: 'anon', sub: null }),
    asServiceRole: () => session(pg, { role: 'service_role', sub: null }),
    async createUser(options = {}) {
      userCount += 1;
      const id = randomUUID();
      await pg.query('insert into auth.users (id) values ($1)', [id]);
      if (options.profile ?? true) {
        await pg.query(
          `update public.profiles
              set display_name = $2, color = '#5B8DEF', adult_confirmed_at = now()
            where id = $1`,
          [id, options.displayName ?? `User ${userCount}`],
        );
      }
      const providers =
        options.provider === undefined
          ? []
          : Array.isArray(options.provider)
            ? options.provider
            : [options.provider];
      for (const provider of providers) {
        await pg.query(
          'insert into public.provider_connections (user_id, provider) values ($1, $2)',
          [id, provider],
        );
      }
      return { id };
    },
    async broadcasts(roomId) {
      const rows = await pg.query<RoomBroadcast>(
        `select event, payload, private from realtime.messages where topic = $1 order by id`,
        [`room:${roomId}`],
      );
      return rows.rows;
    },
    close: () => pg.close(),
  };
}

/** A fresh idempotency key, like the app creates per tap. */
export const newKey = (): string => randomUUID();
