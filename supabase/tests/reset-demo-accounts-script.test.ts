/**
 * supabase/scripts/reset-demo-accounts.js: argument parsing, environment
 * checks, email lookup, dry-run default, and output that holds counts only.
 * The network is a fake `fetch`; the last block routes it to the PGlite
 * database, so the script and reset_demo_accounts are tested together.
 */
import * as script from '../scripts/reset-demo-accounts';
import type { Env, FetchLike, ResetResult } from '../scripts/reset-demo-accounts';
import { createTestDb, newKey, DbError, type TestDb } from './harness/db';

const {
  parseArgs,
  readConfig,
  resolveUserIds,
  createClient,
  formatSummary,
  describeError,
  main,
  RequestError,
  UsageError,
} = script;

const HOST_ID = '11111111-1111-4111-8111-111111111111';
const GUEST_ID = '22222222-2222-4222-8222-222222222222';
const HOST_EMAIL = 'host.demo@example.com';
const GUEST_EMAIL = 'guest.demo@example.com';
const KEY = 'service-role-key-that-must-never-be-printed';

const baseEnv = (extra: Env = {}): Env => ({
  SUPABASE_URL: 'https://demo-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  QD_DEMO_USER_IDS: `${HOST_ID},${GUEST_ID}`,
  ...extra,
});

const RESULT: ResetResult = {
  applied: false,
  users: 2,
  rooms_ended: 1,
  invites_revoked: 1,
  queue_entries_deleted: 3,
  import_batches_deleted: 0,
  memberships_deleted: 2,
  idempotency_keys_deleted: 6,
  join_attempts_deleted: 1,
  memberships_elsewhere: 0,
  profiles_incomplete: 0,
  users_without_service: 1,
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

/** A fake Supabase: the admin users list and the reset RPC. */
function fakeSupabase(
  options: {
    users?: { id: string; email: string | null }[];
    rpc?: (body: { user_ids: string[]; apply: boolean }) => { status: number; body: unknown };
  } = {},
) {
  const calls: Call[] = [];
  const users = options.users ?? [];
  const fetch: FetchLike = async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body });
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/admin/users') {
      const page = Number(parsed.searchParams.get('page'));
      const perPage = Number(parsed.searchParams.get('per_page'));
      return json(200, { users: users.slice((page - 1) * perPage, page * perPage) });
    }
    if (parsed.pathname === '/rest/v1/rpc/reset_demo_accounts') {
      const answer = options.rpc
        ? options.rpc(body)
        : { status: 200, body: { ...RESULT, applied: body.apply } };
      return json(answer.status, answer.body);
    }
    return json(404, { message: 'not found' });
  };
  return { fetch, calls };
}

async function runScript(argv: string[], env: Env, fetch: FetchLike) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv,
    env,
    fetch,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('the declaration file', () => {
  it('lists exactly what the script exports', () => {
    expect(
      Object.keys(script)
        .filter((key) => key !== 'default')
        .sort(),
    ).toEqual(
      [
        'USAGE',
        'UsageError',
        'RequestError',
        'parseArgs',
        'readConfig',
        'createClient',
        'resolveUserIds',
        'formatSummary',
        'describeError',
        'main',
      ].sort(),
    );
  });
});

describe('parseArgs', () => {
  it('is a dry run with no arguments', () => {
    expect(parseArgs([])).toEqual({ apply: false, help: false });
  });

  it('is a dry run with --dry-run', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ apply: false, help: false });
  });

  it('applies only with --yes', () => {
    expect(parseArgs(['--yes'])).toEqual({ apply: true, help: false });
  });

  it.each([['--help'], ['-h']])('%s asks for help', (arg) => {
    expect(parseArgs([arg]).help).toBe(true);
  });

  it('refuses --dry-run with --yes', () => {
    expect(() => parseArgs(['--dry-run', '--yes'])).toThrow(UsageError);
  });

  it.each([['-y'], ['--apply'], ['yes'], ['--yes=true'], ['--force']])(
    'refuses %s, so a typo never applies',
    (arg) => {
      expect(() => parseArgs([arg])).toThrow(UsageError);
    },
  );

  it('does not echo an unknown argument (it could be a pasted secret)', () => {
    expect(() => parseArgs([KEY])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(KEY) }),
    );
  });
});

describe('readConfig', () => {
  it('reads the url, key, ids and emails, trimmed and lowercased', () => {
    const config = readConfig(
      baseEnv({
        SUPABASE_URL: 'https://demo-ref.supabase.co/',
        QD_DEMO_USER_IDS: ` ${HOST_ID.toUpperCase()} ,\n${GUEST_ID} `,
        QD_DEMO_EMAILS: 'Host.Demo@Example.com',
      }),
    );
    expect(config).toEqual({
      baseUrl: 'https://demo-ref.supabase.co',
      host: 'demo-ref.supabase.co',
      serviceRoleKey: KEY,
      userIds: [HOST_ID, GUEST_ID],
      emails: [HOST_EMAIL],
    });
  });

  it('accepts emails alone', () => {
    const config = readConfig(baseEnv({ QD_DEMO_USER_IDS: '', QD_DEMO_EMAILS: HOST_EMAIL }));
    expect(config.userIds).toEqual([]);
    expect(config.emails).toEqual([HOST_EMAIL]);
  });

  it('allows http only for a local stack', () => {
    expect(readConfig(baseEnv({ SUPABASE_URL: 'http://127.0.0.1:54321' })).baseUrl).toBe(
      'http://127.0.0.1:54321',
    );
    expect(readConfig(baseEnv({ SUPABASE_URL: 'http://localhost:54321' })).host).toBe(
      'localhost:54321',
    );
    expect(() => readConfig(baseEnv({ SUPABASE_URL: 'http://demo-ref.supabase.co' }))).toThrow(
      /https/,
    );
  });

  it.each([
    ['SUPABASE_URL', { SUPABASE_URL: undefined }, /SUPABASE_URL is not set/],
    ['SUPABASE_URL', { SUPABASE_URL: '  ' }, /SUPABASE_URL is not set/],
    ['SUPABASE_URL', { SUPABASE_URL: 'not a url' }, /not a URL/],
    ['the key', { SUPABASE_SERVICE_ROLE_KEY: undefined }, /SUPABASE_SERVICE_ROLE_KEY is not set/],
    ['the list', { QD_DEMO_USER_IDS: undefined }, /needs a list/],
    ['the list', { QD_DEMO_USER_IDS: ' , ' }, /needs a list/],
  ])('refuses a missing or bad %s', (_what, extra, message) => {
    expect(() => readConfig(baseEnv(extra))).toThrow(message);
  });

  it('reads only the server-side names, never an EXPO_PUBLIC_ one', () => {
    expect(() =>
      readConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'https://demo-ref.supabase.co',
        EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: KEY,
        QD_DEMO_USER_IDS: HOST_ID,
      }),
    ).toThrow(/SUPABASE_URL is not set/);
  });

  it('counts bad ids and emails without echoing them', () => {
    const run = (extra: Env) => {
      try {
        readConfig(baseEnv(extra));
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected a refusal');
    };
    const ids = run({ QD_DEMO_USER_IDS: `${HOST_ID},secret-looking-thing,another` });
    expect(ids).toBe("QD_DEMO_USER_IDS has 2 entry(s) that aren't ids.");
    const emails = run({ QD_DEMO_EMAILS: 'not-an-email' });
    expect(emails).toBe("QD_DEMO_EMAILS has 1 entry(s) that aren't emails.");
    expect(emails).not.toContain('not-an-email');
  });
});

describe('resolveUserIds', () => {
  const config = (ids: string[], emails: string[]) => ({
    ...readConfig(baseEnv()),
    userIds: ids,
    emails,
  });

  it('returns the ids sorted and once each, without calling the admin API for ids alone', async () => {
    const { fetch, calls } = fakeSupabase();
    const client = createClient(readConfig(baseEnv()), fetch);
    expect(await resolveUserIds(client, config([GUEST_ID, HOST_ID, GUEST_ID], []))).toEqual([
      HOST_ID,
      GUEST_ID,
    ]);
    expect(calls).toEqual([]);
  });

  it('finds emails case-insensitively, across pages', async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      email: `someone${i}@example.com`,
    }));
    const { fetch, calls } = fakeSupabase({
      users: [
        ...filler,
        { id: GUEST_ID.toUpperCase(), email: 'GUEST.demo@example.com' },
        { id: HOST_ID, email: null },
      ],
    });
    const client = createClient(readConfig(baseEnv()), fetch);
    expect(await resolveUserIds(client, config([HOST_ID], [GUEST_EMAIL]))).toEqual([
      HOST_ID,
      GUEST_ID,
    ]);
    expect(calls.map((c) => new URL(c.url).search)).toEqual([
      '?page=1&per_page=1000',
      '?page=2&per_page=1000',
    ]);
    expect(calls[0].headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}` });
  });

  it('refuses an email with no account, by count only', async () => {
    const { fetch } = fakeSupabase({ users: [{ id: HOST_ID, email: HOST_EMAIL }] });
    const client = createClient(readConfig(baseEnv()), fetch);
    await expect(resolveUserIds(client, config([], [HOST_EMAIL, GUEST_EMAIL]))).rejects.toThrow(
      new UsageError('1 demo email(s) have no account in this project.'),
    );
  });
});

describe('formatSummary', () => {
  it('describes a dry run as planned changes', () => {
    expect(formatSummary(RESULT, false)).toBe(
      [
        'Dry run. Nothing changed. Run with --yes to apply:',
        '  accounts: 2',
        '  live rooms to end: 1',
        '  live invites to revoke: 1',
        '  queue entries to delete: 3',
        '  import batches to delete: 0',
        '  room memberships to delete: 2',
        '  idempotency keys to delete: 6',
        '  failed join attempts to delete: 1',
        '  note: 1 account(s) with no music service connected (fine for the guest)',
      ].join('\n'),
    );
  });

  it('describes an applied reset in the past tense, with every note that applies', () => {
    const text = formatSummary(
      { ...RESULT, applied: true, memberships_elsewhere: 2, profiles_incomplete: 1 },
      true,
    );
    expect(text).toContain('Reset applied:');
    expect(text).toContain('  live rooms ended: 1');
    expect(text).toContain('  failed join attempts deleted: 1');
    expect(text).toContain('note: 2 membership(s) in rooms other people host (left alone)');
    expect(text).toContain('note: 1 account(s) without a finished profile');
    expect(text).not.toContain('to delete');
  });

  it('prints only numbers from the result, whatever else it holds', () => {
    const text = formatSummary(
      {
        ...RESULT,
        rooms_ended: 'QD-ABC234' as unknown as number,
        queue_entries_deleted: -4,
        users: 1.5,
        ...({ code: 'ABC234', email: HOST_EMAIL } as object),
      },
      false,
    );
    expect(text).toContain('live rooms to end: 0');
    expect(text).toContain('queue entries to delete: 0');
    expect(text).toContain('accounts: 0');
    expect(text).not.toMatch(/ABC234|@/);
  });
});

describe('describeError', () => {
  it.each([
    [
      new RequestError(400, {
        message: 'feature_disabled',
        hint: 'qd',
        details: '{"flag":"demo_reset"}',
      }),
      /demo_reset flag is off/,
    ],
    [
      new RequestError(400, {
        message: 'invalid_input',
        hint: 'qd',
        details: '{"field":"user_ids","reason":"unknown_user","count":2}',
      }),
      /^2 demo id\(s\) have no account in this project\.$/,
    ],
    [
      new RequestError(400, { message: 'limit_exceeded', hint: 'qd', details: '{"limit":10}' }),
      /at most 10/,
    ],
    [
      new RequestError(400, {
        message: 'invalid_input',
        hint: 'qd',
        details: '{"reason":"empty"}',
      }),
      /refused: invalid_input/,
    ],
    [new RequestError(401, { message: 'Invalid API key' }), /HTTP 401.*service-role key/],
    [
      new RequestError(500, { message: `duplicate key ${HOST_ID}` }),
      /^The request failed \(HTTP 500\)\.$/,
    ],
    [new TypeError('fetch failed: getaddrinfo demo-ref.supabase.co'), /network or unexpected/],
  ])('%#: gives a short message and no server text', (error, message) => {
    const text = describeError(error);
    expect(text).toMatch(message);
    expect(text).not.toContain(HOST_ID);
  });

  it('copes with a body that isn’t JSON', () => {
    expect(new RequestError(502, null).message).toBe('HTTP 502');
    expect(
      new RequestError(400, { hint: 'qd', message: 'not_allowed', details: '{oops' }).details,
    ).toBeUndefined();
  });
});

describe('main', () => {
  it('runs a dry run by default and sends apply: false', async () => {
    const { fetch, calls } = fakeSupabase();
    const { code, out, err } = await runScript([], baseEnv(), fetch);
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).toContain('Project: demo-ref.supabase.co');
    expect(out).toContain('Dry run. Nothing changed.');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'https://demo-ref.supabase.co/rest/v1/rpc/reset_demo_accounts',
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: { user_ids: [HOST_ID, GUEST_ID], apply: false },
    });
  });

  it('applies with --yes', async () => {
    const { fetch, calls } = fakeSupabase();
    const { code, out } = await runScript(['--yes'], baseEnv(), fetch);
    expect(code).toBe(0);
    expect(out).toContain('Reset applied:');
    expect(calls[0].body).toEqual({ user_ids: [HOST_ID, GUEST_ID], apply: true });
  });

  it('resolves emails before the reset', async () => {
    const { fetch, calls } = fakeSupabase({
      users: [
        { id: HOST_ID, email: HOST_EMAIL },
        { id: GUEST_ID, email: GUEST_EMAIL },
      ],
    });
    const env = baseEnv({
      QD_DEMO_USER_IDS: undefined,
      QD_DEMO_EMAILS: `${HOST_EMAIL} ${GUEST_EMAIL}`,
    });
    const { code } = await runScript(['--yes'], env, fetch);
    expect(code).toBe(0);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/auth/v1/admin/users',
      '/rest/v1/rpc/reset_demo_accounts',
    ]);
    expect(calls[1].body).toEqual({ user_ids: [HOST_ID, GUEST_ID], apply: true });
  });

  it('prints help and calls nothing', async () => {
    const { fetch, calls } = fakeSupabase();
    const { code, out } = await runScript(['--help'], baseEnv(), fetch);
    expect(code).toBe(0);
    expect(out).toBe(script.USAGE);
    expect(calls).toEqual([]);
  });

  it('exits 2 on a bad argument and calls nothing', async () => {
    const { fetch, calls } = fakeSupabase();
    const { code, err } = await runScript(['--yes', '--dry-run'], baseEnv(), fetch);
    expect(code).toBe(2);
    expect(err).toContain('not both');
    expect(err).toContain('Usage:');
    expect(calls).toEqual([]);
  });

  it('exits 1 on a bad environment and calls nothing', async () => {
    const { fetch, calls } = fakeSupabase();
    const { code, err } = await runScript(
      ['--yes'],
      baseEnv({ SUPABASE_SERVICE_ROLE_KEY: '' }),
      fetch,
    );
    expect(code).toBe(1);
    expect(err).toBe('SUPABASE_SERVICE_ROLE_KEY is not set.');
    expect(calls).toEqual([]);
  });

  it('exits 1 when the server refuses', async () => {
    const { fetch } = fakeSupabase({
      rpc: () => ({
        status: 400,
        body: {
          code: 'P0001',
          message: 'feature_disabled',
          details: '{"flag":"demo_reset"}',
          hint: 'qd',
        },
      }),
    });
    const { code, out, err } = await runScript(['--yes'], baseEnv(), fetch);
    expect(code).toBe(1);
    expect(err).toMatch(/demo_reset flag is off/);
    expect(out).not.toContain('Reset applied');
  });

  it('exits 1 when the network fails', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const { code, err } = await runScript([], baseEnv(), fetch);
    expect(code).toBe(1);
    expect(err).toMatch(/network/);
  });

  it('never prints the key, an id or an email, whatever happens', async () => {
    const env = baseEnv({ QD_DEMO_EMAILS: GUEST_EMAIL });
    const users = [{ id: GUEST_ID, email: GUEST_EMAIL }];
    const outcomes = [
      await runScript([], env, fakeSupabase({ users }).fetch),
      await runScript(['--yes'], env, fakeSupabase({ users }).fetch),
      await runScript(['--yes'], env, fakeSupabase().fetch),
      await runScript(
        ['--yes'],
        env,
        fakeSupabase({
          users,
          rpc: () => ({ status: 500, body: { message: `boom ${HOST_ID} ${GUEST_EMAIL} ${KEY}` } }),
        }).fetch,
      ),
    ];
    for (const { out, err } of outcomes) {
      for (const secret of [KEY, HOST_ID, GUEST_ID, GUEST_EMAIL, HOST_EMAIL, 'guest.demo']) {
        expect(out + err).not.toContain(secret);
      }
    }
  });
});

describe('main against the database', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.query(`update private.feature_flags set enabled = true where flag = 'demo_reset'`);
  });

  afterAll(() => db.close());

  /** Routes the RPC to PGlite as the service role, like PostgREST would. */
  const dbFetch: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const name = pathname.replace('/rest/v1/rpc/', '');
    try {
      const result = await db.asServiceRole().rpc(name, JSON.parse(init.body ?? '{}'));
      return json(200, result);
    } catch (error) {
      const e = error as DbError;
      return json(400, {
        code: e.sqlstate,
        message: e.code,
        details: e.details === undefined ? null : JSON.stringify(e.details),
        hint: e.hint ?? null,
      });
    }
  };

  it('dry run, then --yes, then --yes again', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const guest = await db.createUser();
    const room = await db.as(host).rpc<{ room_id: string; code: string }>('create_room', {
      name: 'Rehearsal',
      playback_provider: 'spotify',
      idempotency_key: newKey(),
    });
    await db.as(guest).rpc('join_room_by_code', { code: room.code, idempotency_key: newKey() });
    const env = baseEnv({ QD_DEMO_USER_IDS: `${host.id} ${guest.id}` });
    const state = async () =>
      (
        await db.query<{ state: string }>('select state from public.rooms where id = $1', [
          room.room_id,
        ])
      )[0].state;

    const dry = await runScript([], env, dbFetch);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('live rooms to end: 1');
    expect(dry.out).toContain('room memberships to delete: 2');
    expect(await state()).toBe('live');

    const applied = await runScript(['--yes'], env, dbFetch);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain('live rooms ended: 1');
    expect(await state()).toBe('ended');

    const again = await runScript(['--yes'], env, dbFetch);
    expect(again.out).toContain('live rooms ended: 0');
    expect(again.out).toContain('room memberships deleted: 0');

    for (const run of [dry, applied, again]) {
      expect(run.out + run.err).not.toMatch(
        new RegExp(`${host.id}|${guest.id}|${room.code}|${KEY}`),
      );
    }
  });

  it('reports an unknown id from the database by count', async () => {
    const env = baseEnv({ QD_DEMO_USER_IDS: `${HOST_ID} ${GUEST_ID}` });
    const { code, err } = await runScript(['--yes'], env, dbFetch);
    expect(code).toBe(1);
    expect(err).toBe('2 demo id(s) have no account in this project.');
  });
});
