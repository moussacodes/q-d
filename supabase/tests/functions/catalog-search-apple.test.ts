/**
 * Apple catalog normalization and the developer token, against recorded
 * fixtures. The fixtures are synthetic (made-up songs, ids and an
 * example.test artwork host), shaped like Apple Music API search responses.
 */
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTokenCache,
  isSearchResponse,
  mintDeveloperToken,
  normalizeAppleSong,
  normalizeSearchResponse,
  searchUrl,
  TOKEN_LIFETIME_SECONDS,
  type AppleSong,
} from '../../functions/catalog-search/apple';
import { providerTrackSchema } from '../../../src/domain/recording';
import { versionTagSchema } from '../../../src/domain/primitives';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8'));

describe('normalizeSearchResponse', () => {
  const { tracks, skipped } = normalizeSearchResponse(fixture('apple-search-songs.json'));

  it('keeps usable songs in Apple order and skips the rest', () => {
    expect(tracks.map((t) => t.providerTrackId)).toEqual([
      '9000000001',
      '9000000002',
      '9000000003',
      '9000000004',
      '9000000007',
    ]);
    // No duration, a repeated id and a music video.
    expect(skipped).toBe(3);
  });

  it('produces valid domain provider tracks and version tags', () => {
    for (const { versionTags, ...track } of tracks) {
      expect(providerTrackSchema.parse(track)).toEqual(track);
      versionTags.forEach((tag) => expect(versionTagSchema.parse(tag)).toBe(tag));
    }
  });

  it('normalizes a full explicit song', () => {
    expect(tracks[0]).toEqual({
      provider: 'apple_music',
      providerTrackId: '9000000001',
      title: 'Paper Lanterns',
      artists: ['The Fixture Band'],
      album: 'Synthetic Weather',
      durationMs: 214000,
      isrc: 'QZSYN2600001', // from "QZ-SYN-26-00001"
      explicit: true,
      artworkUrl: 'https://artwork.example.test/image/thumb/Synthetic/a1/{w}x{h}bb.jpg',
      artworkBackgroundColor: '#1A2B3C',
      versionTags: [],
    });
  });

  it('treats "(Clean)" as the explicit flag, not a version', () => {
    expect(tracks[1]).toMatchObject({ explicit: false, versionTags: [] });
  });

  it('reads version markers, rounds durations and keeps a missing ISRC null', () => {
    expect(tracks[2]).toMatchObject({
      durationMs: 251001,
      isrc: null,
      explicit: false,
      versionTags: ['live'],
      artworkBackgroundColor: '#F0E0D0',
    });
    expect(tracks[4]).toMatchObject({ versionTags: ['sped_up'], isrc: null, album: null });
  });

  it('keeps the artist credit whole and drops unsafe artwork', () => {
    expect(tracks[3]).toMatchObject({
      artists: ['Northbound & Harbor Lights'],
      album: null,
      artworkUrl: null, // http, not https
      artworkBackgroundColor: null, // not a hex color
    });
  });

  it('reads an empty search as no results', () => {
    expect(normalizeSearchResponse(fixture('apple-search-empty.json'))).toEqual({
      tracks: [],
      skipped: 0,
    });
  });

  it.each([null, undefined, 'text', 42, [], { results: null }, { results: { songs: {} } }])(
    'never throws on a strange body (%p)',
    (body) => {
      expect(normalizeSearchResponse(body)).toEqual({ tracks: [], skipped: 0 });
    },
  );

  it('tells a search answer from an error answer', () => {
    expect(isSearchResponse(fixture('apple-search-songs.json'))).toBe(true);
    expect(isSearchResponse(fixture('apple-search-empty.json'))).toBe(true);
    expect(isSearchResponse(fixture('apple-error-unauthorized.json'))).toBe(false);
    expect(isSearchResponse(null)).toBe(false);
  });
});

describe('normalizeAppleSong', () => {
  const good: AppleSong = {
    id: '123',
    type: 'songs',
    attributes: { name: 'Song', artistName: 'Artist', durationInMillis: 1000 },
  };

  it('needs only an id, title, artist and a positive duration', () => {
    expect(normalizeAppleSong(good)).toEqual({
      provider: 'apple_music',
      providerTrackId: '123',
      title: 'Song',
      artists: ['Artist'],
      album: null,
      durationMs: 1000,
      isrc: null,
      explicit: false,
      artworkUrl: null,
      artworkBackgroundColor: null,
      versionTags: [],
    });
  });

  it.each<[string, AppleSong]>([
    ['a non-numeric id', { ...good, id: 'l.abc' }],
    ['a numeric id that is not a string', { ...good, id: 123 }],
    ['no attributes', { id: '123', type: 'songs' }],
    ['a blank title', { ...good, attributes: { ...good.attributes, name: '   ' } }],
    [
      'a title over 300 characters',
      { ...good, attributes: { ...good.attributes, name: 'x'.repeat(301) } },
    ],
    ['no artist', { ...good, attributes: { ...good.attributes, artistName: undefined } }],
    ['a zero duration', { ...good, attributes: { ...good.attributes, durationInMillis: 0 } }],
    [
      'a string duration',
      { ...good, attributes: { ...good.attributes, durationInMillis: '1000' } },
    ],
    [
      'an infinite duration',
      { ...good, attributes: { ...good.attributes, durationInMillis: Infinity } },
    ],
    ['another resource type', { ...good, type: 'albums' }],
  ])('skips a song with %s', (_name, song) => {
    expect(normalizeAppleSong(song)).toBeNull();
  });

  it('trims text', () => {
    expect(
      normalizeAppleSong({
        ...good,
        attributes: { ...good.attributes, name: '  Song  ', albumName: ' Album ' },
      }),
    ).toMatchObject({ title: 'Song', album: 'Album' });
  });
});

describe('searchUrl', () => {
  it('asks for songs in the storefront and encodes the term', () => {
    expect(searchUrl('us', 'rain & down/?', 20)).toBe(
      'https://api.music.apple.com/v1/catalog/us/search?term=rain+%26+down%2F%3F&types=songs&limit=20',
    );
  });
});

describe('developer token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const key = { teamId: 'TEAMSYNTH1', keyId: 'KEYSYNTH01', privateKey: pem };

  const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

  it('is an ES256 JWT Apple can verify', async () => {
    const token = await mintDeveloperToken(key, 1_800_000_000);
    const [header, payload, signature] = token.split('.');
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEYSYNTH01', typ: 'JWT' });
    expect(decode(payload)).toEqual({
      iss: 'TEAMSYNTH1',
      iat: 1_800_000_000,
      exp: 1_800_000_000 + TOKEN_LIFETIME_SECONDS,
    });
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      {
        key: createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })),
        dsaEncoding: 'ieee-p1363',
      },
      Buffer.from(signature, 'base64url'),
    );
    expect(valid).toBe(true);
  });

  it('accepts a key whose newlines were escaped when stored as a secret', async () => {
    const escaped = { ...key, privateKey: pem.replace(/\n/g, '\\n') };
    await expect(mintDeveloperToken(escaped, 1)).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('rejects a key that is not PEM', async () => {
    await expect(mintDeveloperToken({ ...key, privateKey: 'not a key!' }, 1)).rejects.toThrow(
      'not a PEM key',
    );
  });

  it('is cached until an hour before it expires, and minted again after clear()', async () => {
    let now = 1_000;
    const cache = createTokenCache(key, () => now);
    const first = await cache.get();
    now += TOKEN_LIFETIME_SECONDS - 60 * 60 - 1;
    expect(await cache.get()).toBe(first);
    now += 1;
    const second = await cache.get();
    expect(second).not.toBe(first);
    expect(await cache.get()).toBe(second);
    cache.clear();
    now += 1;
    expect(await cache.get()).not.toBe(second);
  });
});
