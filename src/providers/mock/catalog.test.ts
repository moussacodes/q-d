import { mockCatalog, normalize } from './catalog';

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
    await expect(mockCatalog.getTrack('nope')).rejects.toThrow('Mock catalog has no track nope');
  });
});
