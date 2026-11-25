import {
  catalogSearchResponseSchema,
  edgeFunctionErrorSchema,
  normalizeCatalogQuery,
} from './catalog';

const track = {
  provider: 'apple_music',
  providerTrackId: '9000000001',
  title: 'Paper Lanterns',
  artists: ['The Fixture Band'],
  album: 'Synthetic Weather',
  durationMs: 214000,
  isrc: 'QZSYN2600001',
  explicit: true,
  artworkUrl: 'https://artwork.example.test/a1/{w}x{h}bb.jpg',
  artworkBackgroundColor: '#1A2B3C',
};
const result = {
  recordingId: '00000000-0000-4000-8000-000000000001',
  track,
  availableOn: ['apple_music'],
};

describe('catalogSearchResponseSchema', () => {
  it('accepts what catalog-search answers', () => {
    const body = { storefront: 'us', results: [result] };
    expect(catalogSearchResponseSchema.parse(body)).toEqual(body);
  });

  it('strips unknown fields, so a new server field is additive', () => {
    const parsed = catalogSearchResponseSchema.parse({
      storefront: 'us',
      extra: 1,
      results: [{ ...result, versionTags: ['live'], track: { ...track, popularity: 3 } }],
    });
    expect(parsed).toEqual({ storefront: 'us', results: [result] });
  });

  it.each<[string, unknown]>([
    ['a recording id that is not a UUID', { ...result, recordingId: '9000000001' }],
    ['no availability', { ...result, availableOn: [] }],
    ['an unsupported service', { ...result, availableOn: ['youtube_music'] }],
    ['a negative duration', { ...result, track: { ...track, durationMs: -1 } }],
    ['a malformed ISRC', { ...result, track: { ...track, isrc: 'QZ-SYN' } }],
  ])('rejects %s', (_name, bad) => {
    expect(
      catalogSearchResponseSchema.safeParse({ storefront: 'us', results: [bad] }).success,
    ).toBe(false);
  });

  it('rejects more than 25 results and a bad storefront', () => {
    expect(
      catalogSearchResponseSchema.safeParse({
        storefront: 'us',
        results: Array.from({ length: 26 }, () => result),
      }).success,
    ).toBe(false);
    expect(catalogSearchResponseSchema.safeParse({ storefront: 'USA', results: [] }).success).toBe(
      false,
    );
  });
});

describe('edgeFunctionErrorSchema', () => {
  it('reads a code and its details', () => {
    expect(edgeFunctionErrorSchema.parse({ code: 'rate_limited', retry_after_seconds: 7 })).toEqual(
      {
        code: 'rate_limited',
        retry_after_seconds: 7,
      },
    );
  });

  it('rejects a body without a code', () => {
    expect(edgeFunctionErrorSchema.safeParse({}).success).toBe(false);
    expect(edgeFunctionErrorSchema.safeParse(null).success).toBe(false);
  });
});

describe('normalizeCatalogQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCatalogQuery('  paper \n  lanterns\t')).toBe('paper lanterns');
    expect(normalizeCatalogQuery('   ')).toBe('');
  });
});
