import { afterQueueEnds, autoplayLabel } from './autoplay';

describe('afterQueueEnds', () => {
  it('names the provider when it keeps playing in aux', () => {
    expect(afterQueueEnds({ mode: 'aux', provider: 'spotify', providerKeptPlaying: true })).toEqual(
      { autoplay: 'spotify' },
    );
    expect(
      afterQueueEnds({ mode: 'aux', provider: 'apple_music', providerKeptPlaying: true }),
    ).toEqual({ autoplay: 'apple_music' });
  });

  it('says nothing is playing when the provider stopped', () => {
    expect(
      afterQueueEnds({ mode: 'aux', provider: 'spotify', providerKeptPlaying: false }),
    ).toEqual({ autoplay: null });
  });

  it('never autoplays in sync (beta)', () => {
    expect(
      afterQueueEnds({ mode: 'sync', provider: 'spotify', providerKeptPlaying: true }),
    ).toEqual({ autoplay: null });
  });
});

describe('autoplayLabel', () => {
  it('names the service, never q’d', () => {
    expect(autoplayLabel('apple_music')).toBe('Autoplay by Apple Music');
    expect(autoplayLabel('spotify')).toBe('Autoplay by Spotify');
  });
});
