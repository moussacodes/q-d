import { createFakeMusicKit } from '@/test/fakeMusicKit';

import { AppleMusicPlaybackAdapter } from './apple';
import { createPlayback } from './index';
import { MockPlaybackAdapter } from './mock/playback';

// With the flag on and the native module present (a q’d app build), Apple
// Music plays through the MusicKit adapter. The Swift module is faked.
jest.mock('@/services/flags', () => ({
  ...jest.requireActual('@/services/flags'),
  isEnabled: (flag: string) => mockFlags.has(flag),
}));

const mockFlags = new Set<string>(['realAppleMusic']);

jest.mock('../../modules/qd-music-kit', () => {
  const actual = jest.requireActual('../../modules/qd-music-kit');
  const { createFakeMusicKit: fake } = jest.requireActual('@/test/fakeMusicKit');
  return { ...actual, QdMusicKit: actual.createQdMusicKit(fake().native, 'ios') };
});

afterEach(() => mockFlags.add('realAppleMusic'));

it('createPlayback("apple_music") is the MusicKit adapter, not a mock', () => {
  const player = createPlayback('apple_music');
  expect(player).toBeInstanceOf(AppleMusicPlaybackAdapter);
  expect(player.capabilities()).toMatchObject({ isMock: false, requiresExternalApp: false });
});

it('with the flag off it stays the labeled mock, even with the module here', () => {
  mockFlags.delete('realAppleMusic');
  const player = createPlayback('apple_music');
  expect(player).toBeInstanceOf(MockPlaybackAdapter);
  expect(player.capabilities().isMock).toBe(true);
});

it('the fake is only a fake', () => {
  expect(createFakeMusicKit().native.capabilities()).toMatchObject({ isMock: false });
});
