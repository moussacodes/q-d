import { connectProvider, disconnectProvider, storedConnection, usesRealAppleMusic } from './index';

// With the `realAppleMusic` flag on in Jest there's no native module, which
// is what Expo Go and the web see: Apple Music must say it needs the q’d
// app build, never connect the mock or pretend.
jest.mock('@/services/flags', () => ({
  ...jest.requireActual('@/services/flags'),
  isEnabled: (flag: string) => flag === 'realAppleMusic',
}));

describe('with the realAppleMusic flag on and no native module', () => {
  it('is on', () => {
    expect(usesRealAppleMusic()).toBe(true);
  });

  it('Connect is not_in_this_build, and not a mock', async () => {
    expect(await connectProvider('apple_music')).toEqual({
      status: 'error',
      code: 'not_in_this_build',
      isMock: false,
    });
  });

  it('the startup check can’t tell, so rows are left alone', async () => {
    expect(await storedConnection('apple_music')).toBeNull();
  });

  it('Disconnect resolves', async () => {
    await expect(disconnectProvider('apple_music')).resolves.toBeUndefined();
  });

  it('Spotify stays the labeled mock', async () => {
    expect(await connectProvider('spotify')).toMatchObject({ status: 'connected', isMock: true });
  });
});
