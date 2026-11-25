import { createPlayback, usesRealSpotify } from './index';
import { MockPlaybackAdapter } from './mock/playback';
import { SpotifyPlaybackAdapter } from './spotify/playback';

/** With the `realSpotify` flag on, Spotify playback is the Web API remote; Apple stays mock. */
jest.mock('@/services/flags', () => ({
  ...jest.requireActual('@/services/flags'),
  isEnabled: (flag: string) => flag === 'realSpotify',
}));

describe('with the realSpotify flag on', () => {
  it('Spotify playback remote-controls the Spotify app and is not a mock', () => {
    expect(usesRealSpotify()).toBe(true);
    const player = createPlayback('spotify');
    expect(player).toBeInstanceOf(SpotifyPlaybackAdapter);
    expect(player.capabilities()).toMatchObject({ isMock: false, requiresExternalApp: true });
  });

  it('Apple Music stays the labeled mock', () => {
    const player = createPlayback('apple_music');
    expect(player).toBeInstanceOf(MockPlaybackAdapter);
    expect(player.capabilities().isMock).toBe(true);
  });
});
