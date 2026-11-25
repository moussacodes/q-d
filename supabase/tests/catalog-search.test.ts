/**
 * Catalog search in the database (20261125003000_catalog_search.sql):
 * save_catalog_tracks stores canonical recordings idempotently, the search
 * limit holds, and only the service role can run either function. The last
 * block runs the Edge Function handler against this database with a fake
 * Apple, end to end.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CatalogTrack } from '../functions/catalog-search/apple';
import { ServiceError } from '../functions/catalog-search/errors';
import { createHandler } from '../functions/catalog-search/handler';
import { createTestDb, DbError, type TestDb, type TestUser } from './harness/db';

type SavedRow = { provider_track_id: string; recording_id: string };

const track = (id: string, overrides: Record<string, unknown> = {}) => ({
  provider_track_id: id,
  title: `Song ${id}`,
  artists: ['The Fixture Band'],
  album: 'Synthetic Weather',
  duration_ms: 200000,
  isrc: null,
  explicit: false,
  artwork_url: 'https://artwork.example.test/a/{w}x{h}bb.jpg',
  artwork_background_color: '#1A2B3C',
  version_tags: [],
  ...overrides,
});

let db: TestDb;
let user: TestUser;

beforeAll(async () => {
  db = await createTestDb();
  user = await db.createUser();
});
afterAll(() => db.close());

const save = (tracks: unknown) =>
  db.asServiceRole().rpc<SavedRow[]>('save_catalog_tracks', { tracks: JSON.stringify(tracks) });

describe('save_catalog_tracks', () => {
  it('stores a provider track and a canonical recording per song, in input order', async () => {
    const saved = await save([
      track('100', { isrc: 'QZSYN2600100', explicit: true, version_tags: ['live'] }),
      track('101', { album: null, artwork_url: null, artwork_background_color: null }),
    ]);
    expect(saved.map((row) => row.provider_track_id)).toEqual(['100', '101']);

    const [recording] = await db.query(
      `select title, primary_artist, artists, album, duration_ms, isrc, explicit, version_tags,
              source_provider, source_track_id
         from public.recordings where id = $1`,
      [saved[0].recording_id],
    );
    expect(recording).toEqual({
      title: 'Song 100',
      primary_artist: 'The Fixture Band',
      artists: ['The Fixture Band'],
      album: 'Synthetic Weather',
      duration_ms: 200000,
      isrc: 'QZSYN2600100',
      explicit: true,
      version_tags: ['live'],
      source_provider: 'apple_music',
      source_track_id: '100',
    });

    const [providerTrack] = await db.query(
      `select title, artists, album, duration_ms, isrc, explicit, artwork_url, artwork_background_color
         from public.provider_tracks where provider = 'apple_music' and provider_track_id = '101'`,
    );
    expect(providerTrack).toEqual({
      title: 'Song 101',
      artists: ['The Fixture Band'],
      album: null,
      duration_ms: 200000,
      isrc: null,
      explicit: false,
      artwork_url: null,
      artwork_background_color: null,
    });
  });

  it('is idempotent: the same song keeps its recording id and is stored once', async () => {
    const first = await save([track('200')]);
    const again = await save([track('200')]);
    expect(again).toEqual(first);
    const [{ recordings, tracks }] = await db.query<{ recordings: number; tracks: number }>(
      `select (select count(*)::int from public.recordings where source_track_id = '200') as recordings,
              (select count(*)::int from public.provider_tracks where provider_track_id = '200') as tracks`,
    );
    expect({ recordings, tracks }).toEqual({ recordings: 1, tracks: 1 });
  });

  it('refreshes metadata Apple changed without changing the recording id', async () => {
    const [{ recording_id }] = await save([track('300', { title: 'Old Title' })]);
    const [{ recording_id: same }] = await save([
      track('300', { title: 'New Title', isrc: 'QZSYN2600300', album: null }),
    ]);
    expect(same).toBe(recording_id);
    const [row] = await db.query(
      `select r.title, r.isrc, r.album, r.updated_at > r.created_at as updated, p.title as track_title
         from public.recordings r
         join public.provider_tracks p on (p.provider, p.provider_track_id) = (r.source_provider, r.source_track_id)
        where r.id = $1`,
      [recording_id],
    );
    expect(row).toEqual({
      title: 'New Title',
      isrc: 'QZSYN2600300',
      album: null,
      updated: true,
      track_title: 'New Title',
    });
  });

  it('handles the same song twice in one call', async () => {
    const saved = await save([track('400'), track('400', { title: 'Second' })]);
    expect(saved[0].recording_id).toBe(saved[1].recording_id);
  });

  it('keeps two Apple songs with the same ISRC as two recordings', async () => {
    const saved = await save([
      track('500', { isrc: 'QZSYN2600500' }),
      track('501', { isrc: 'QZSYN2600500' }),
    ]);
    expect(saved[0].recording_id).not.toBe(saved[1].recording_id);
  });

  it('writes no track matches: those are resolved when playback needs them', async () => {
    await save([track('600')]);
    const rows = await db.query(
      `select 1 from public.track_matches m join public.recordings r on r.id = m.recording_id
        where r.source_track_id = '600'`,
    );
    expect(rows).toEqual([]);
  });

  it('accepts an empty list', async () => {
    expect(await save([])).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['a non-numeric id', [track('abc')]],
    ['no id', [track('1', { provider_track_id: null })]],
    ['a blank title', [track('1', { title: '  ' })]],
    ['a title over 300 characters', [track('1', { title: 'x'.repeat(301) })]],
    ['no artists', [track('1', { artists: [] })]],
    ['a blank artist', [track('1', { artists: [''] })]],
    ['artists that are not a list', [track('1', { artists: 'A' })]],
    ['a zero duration', [track('1', { duration_ms: 0 })]],
    ['a string duration', [track('1', { duration_ms: '200000' })]],
    ['a fractional duration', [track('1', { duration_ms: 1.5 })]],
    ['a lowercase ISRC', [track('1', { isrc: 'qzsyn2600001' })]],
    ['an http artwork URL', [track('1', { artwork_url: 'http://artwork.example.test/a.jpg' })]],
    ['a bad color', [track('1', { artwork_background_color: 'red' })]],
    ['a bad version tag', [track('1', { version_tags: ['Live!'] })]],
    ['an explicit flag that is not boolean', [track('1', { explicit: 'yes' })]],
    ['an element that is not an object', ['nope']],
  ])('rejects %s with invalid_input and the index', async (_name, tracks) => {
    await expect(save(tracks)).rejects.toMatchObject({
      code: 'invalid_input',
      hint: 'qd',
      details: { field: 'tracks', index: 0 },
    });
  });

  it('saves nothing when any element is bad', async () => {
    await expect(save([track('700'), track('bad')])).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'tracks', index: 1 },
    });
    const rows = await db.query(
      `select 1 from public.provider_tracks where provider_track_id = '700'`,
    );
    expect(rows).toEqual([]);
  });

  it('rejects a body that is not a list', async () => {
    await expect(
      db.asServiceRole().rpc('save_catalog_tracks', { tracks: JSON.stringify({}) }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'tracks' } });
  });

  it('rejects more than 25 tracks with limit_exceeded', async () => {
    const many = Array.from({ length: 26 }, (_, i) => track(String(800 + i)));
    await expect(save(many)).rejects.toMatchObject({
      code: 'limit_exceeded',
      details: { field: 'tracks', max: 25 },
    });
  });

  it('is not callable by signed-in users or anon', async () => {
    const args = { tracks: JSON.stringify([track('900')]) };
    await expect(db.as(user).rpc('save_catalog_tracks', args)).rejects.toMatchObject({
      sqlstate: '42501',
    });
    await expect(db.asAnon().rpc('save_catalog_tracks', args)).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });

  it('keeps clients from writing the catalog directly', async () => {
    await expect(
      db.as(user).query(
        `insert into public.recordings (title, primary_artist, duration_ms, source_provider, source_track_id)
           values ('x', 'y', 1, 'apple_music', '100')`,
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db
        .as(user)
        .query(
          `update public.provider_tracks set title = 'hacked' where provider_track_id = '100'`,
        ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('lets any signed-in user read what search saved, including guests with no service', async () => {
    const guest = await db.createUser();
    const [{ recording_id }] = await save([track('950')]);
    const rows = await db
      .as(guest)
      .query('select title from public.recordings where id = $1', [recording_id]);
    expect(rows).toEqual([{ title: 'Song 950' }]);
  });
});

describe('recordings source columns', () => {
  it('need both or neither of source_provider and source_track_id', async () => {
    await expect(
      db.query(
        `insert into public.recordings (title, primary_artist, duration_ms, source_provider)
         values ('x', 'y', 1, 'apple_music')`,
      ),
    ).rejects.toMatchObject({ code: expect.stringContaining('recordings_source_pair') });
  });

  it('must point at a stored provider track', async () => {
    await expect(
      db.query(
        `insert into public.recordings (title, primary_artist, duration_ms, source_provider, source_track_id)
         values ('x', 'y', 1, 'apple_music', '999999999')`,
      ),
    ).rejects.toMatchObject({ code: expect.stringContaining('recordings_source_track_fk') });
  });

  it('still allow a recording with no source', async () => {
    const rows = await db.query(
      `insert into public.recordings (title, primary_artist, duration_ms) values ('x', 'y', 1) returning id`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('consume_catalog_search', () => {
  const consume = (userId: string, perMinute?: number) =>
    db.asServiceRole().rpc('consume_catalog_search', {
      user_id: userId,
      ...(perMinute ? { per_minute: perMinute } : {}),
    });

  it('allows searches up to the limit, then rate_limited with a retry time', async () => {
    const searcher = await db.createUser();
    for (let i = 0; i < 3; i += 1) await consume(searcher.id, 3);
    const error = (await consume(searcher.id, 3).catch((e: unknown) => e)) as DbError;
    expect(error).toMatchObject({ code: 'rate_limited', hint: 'qd' });
    const retry = (error.details as { retry_after_seconds: number }).retry_after_seconds;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it('counts each user separately', async () => {
    const a = await db.createUser();
    const b = await db.createUser();
    await consume(a.id, 1);
    await expect(consume(a.id, 1)).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(consume(b.id, 1)).resolves.toBeDefined();
  });

  it('starts a new window after a minute', async () => {
    const searcher = await db.createUser();
    await consume(searcher.id, 1);
    await expect(consume(searcher.id, 1)).rejects.toMatchObject({ code: 'rate_limited' });
    await db.query(
      `update private.catalog_search_usage
          set window_started_at = now() - interval '61 seconds' where user_id = $1`,
      [searcher.id],
    );
    await expect(consume(searcher.id, 1)).resolves.toBeDefined();
    const [{ count }] = await db.query<{ count: number }>(
      'select count from private.catalog_search_usage where user_id = $1',
      [searcher.id],
    );
    expect(count).toBe(1);
  });

  it('defaults to 60 a minute', async () => {
    const searcher = await db.createUser();
    for (let i = 0; i < 60; i += 1) await consume(searcher.id);
    await expect(consume(searcher.id)).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('rejects a missing user and a bad limit', async () => {
    await expect(
      db.asServiceRole().rpc('consume_catalog_search', { user_id: null }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
    await expect(consume(user.id, -1)).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'per_minute' },
    });
  });

  it('is not callable by signed-in users or anon, and its table is private', async () => {
    await expect(
      db.as(user).rpc('consume_catalog_search', { user_id: user.id }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db.asAnon().rpc('consume_catalog_search', { user_id: user.id }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db.as(user).query('select * from private.catalog_search_usage'),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });
});

describe('catalog-search handler against the database', () => {
  const songs = readFileSync(join(__dirname, 'fixtures', 'apple-search-songs.json'), 'utf8');
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  function handlerFor(perMinute = 60) {
    const service = db.asServiceRole();
    return createHandler({
      fetch: async () => new Response(songs, { status: 200 }),
      tokens: { get: async () => 'token', clear: () => {} },
      consumeSearch: async (userId) => {
        try {
          await service.rpc('consume_catalog_search', { user_id: userId, per_minute: perMinute });
        } catch (error) {
          if (error instanceof DbError && error.code === 'rate_limited') {
            throw new ServiceError(429, 'rate_limited', error.details as Record<string, unknown>);
          }
          throw error;
        }
      },
      saveTracks: async (tracks: CatalogTrack[]) => {
        const rows = await service.rpc<SavedRow[]>('save_catalog_tracks', {
          tracks: JSON.stringify(
            tracks.map((t) => ({
              provider_track_id: t.providerTrackId,
              title: t.title,
              artists: t.artists,
              album: t.album,
              duration_ms: t.durationMs,
              isrc: t.isrc,
              explicit: t.explicit,
              artwork_url: t.artworkUrl,
              artwork_background_color: t.artworkBackgroundColor,
              version_tags: t.versionTags,
            })),
          ),
        });
        return new Map(rows.map((row) => [row.provider_track_id, row.recording_id]));
      },
    });
  }

  const request = (sub: string) =>
    new Request('http://localhost/catalog-search', {
      method: 'POST',
      headers: { authorization: `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub })}.sig` },
      body: JSON.stringify({ query: 'paper lanterns' }),
    });

  it('returns recording ids a later search returns again', async () => {
    const searcher = await db.createUser();
    const handler = handlerFor();
    const first = await (await handler(request(searcher.id))).json();
    const second = await (await handler(request(searcher.id))).json();
    expect(first.results).toHaveLength(5);
    expect(second).toEqual(first);
    const rows = await db.query<{ id: string; version_tags: string[] }>(
      'select id, version_tags from public.recordings where id = any($1::uuid[]) order by source_track_id',
      [first.results.map((r: { recordingId: string }) => r.recordingId)],
    );
    expect(rows.map((row) => row.version_tags)).toEqual([[], [], ['live'], [], ['sped_up']]);
  });

  it('answers rate_limited from the database limit', async () => {
    const searcher = await db.createUser();
    const handler = handlerFor(1);
    expect((await handler(request(searcher.id))).status).toBe(200);
    const limited = await handler(request(searcher.id));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited' });
  });
});
