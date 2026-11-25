import {
  musicProviderSchema,
  musicProviders,
  otherProvider,
  playbackModeSchema,
  providerNames,
} from './music-provider';

describe('musicProviderSchema', () => {
  it.each(['apple_music', 'spotify'])('accepts %s', (provider) => {
    expect(musicProviderSchema.parse(provider)).toBe(provider);
  });

  it.each(['youtube_music', 'tidal', 'amazon_music', 'deezer', 'Spotify', '', null, 1])(
    'rejects %p',
    (provider) => {
      expect(musicProviderSchema.safeParse(provider).success).toBe(false);
    },
  );

  it('lists exactly Apple Music and Spotify, each with a name', () => {
    expect(musicProviders).toEqual(['apple_music', 'spotify']);
    expect(Object.keys(providerNames).sort()).toEqual([...musicProviders].sort());
  });
});

describe('playbackModeSchema', () => {
  it('models aux and sync', () => {
    expect(playbackModeSchema.parse('aux')).toBe('aux');
    expect(playbackModeSchema.parse('sync')).toBe('sync');
  });

  it('rejects anything else', () => {
    expect(playbackModeSchema.safeParse('party').success).toBe(false);
  });
});

describe('otherProvider', () => {
  it('swaps the two providers', () => {
    expect(otherProvider('spotify')).toBe('apple_music');
    expect(otherProvider('apple_music')).toBe('spotify');
  });
});
