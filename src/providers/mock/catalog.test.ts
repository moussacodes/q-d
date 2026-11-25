import { mockCatalog, mockLinkIds, normalize } from './catalog';

const titles = async (query: string) =>
  (await mockCatalog.search(query, 'US')).map((result) => result.track.title);

describe('mock catalog', () => {
  it('normalizes case, accents, punctuation and "&"', () => {
    expect(normalize('  Beyoncé & JAY-Z!  ')).toBe('beyonce and jay z');
  });

  it('returns nothing for an empty query', async () => {
    expect(await titles('   ')).toEqual([]);
  });

  it('matches every word against title, artist or album, in a fixed order', async () => {
    expect(await titles('daniel caesar')).toEqual([
      'Have a Baby (With Me)',
      'Always',
      'Rain Down',
      'Valentina',
      'Ocho Rios',
      'Moon',
    ]);
    expect(await titles('caesar never enough')).toEqual(['Always', 'Valentina', 'Ocho Rios']);
    expect(await titles('DANIËL caesar moon')).toEqual(['Moon']);
  });

  it('says where each recording is available', async () => {
    const [valentina] = await mockCatalog.search('valentina', 'US');
    expect(valentina.availableOn).toEqual(['apple_music']);
    const [always] = await mockCatalog.search('always', 'US');
    expect(always.availableOn).toEqual(['apple_music', 'spotify']);
  });

  it('gets a track by id and rejects unknown ids', async () => {
    expect((await mockCatalog.getTrack('q2')).title).toBe('Always');
    await expect(mockCatalog.getTrack('nope')).rejects.toMatchObject({
      code: 'not_found',
      message: 'Mock catalog has no track nope',
    });
  });

  it('labels nothing as real provider metadata', async () => {
    const results = await mockCatalog.search('daniel caesar', 'US');
    for (const { track } of results) {
      expect(track.isrc).toBeNull();
      expect(track.explicit).toBe(false);
      expect(track.artworkUrl).toBeNull();
    }
  });

  describe('resolveLink', () => {
    it('resolves the made-up Apple Music and Spotify links to fixtures', async () => {
      expect(
        await mockCatalog.resolveLink('https://music.apple.com/us/song/always/1000000002'),
      ).toMatchObject({ kind: 'track', track: { providerTrackId: 'q2', title: 'Always' } });
      expect(
        await mockCatalog.resolveLink('https://open.spotify.com/track/0000000000000000000002'),
      ).toMatchObject({ kind: 'track', track: { providerTrackId: 'q2' } });
    });

    it('maps every made-up link to a fixture it has', async () => {
      for (const ids of Object.values(mockLinkIds)) {
        for (const fixtureId of Object.values(ids)) {
          await expect(mockCatalog.getTrack(fixtureId)).resolves.toBeTruthy();
        }
      }
    });

    it('rejects a well-formed link to a track it does not have with not_found', async () => {
      await expect(
        mockCatalog.resolveLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('says what a playlist link points at', async () => {
      expect(
        await mockCatalog.resolveLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
      ).toEqual({ kind: 'playlist', provider: 'spotify', playlistId: '37i9dQZF1DXcBWIGoYBM5M' });
    });

    it('has no playlists to fetch (post-demo)', () => {
      expect(mockCatalog.getPlaylist).toBeUndefined();
    });
  });
});
