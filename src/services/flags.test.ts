import {
  analyticsAllowed,
  defaultFlags,
  enabledPlaybackModes,
  flags,
  isEnabled,
  isPlaybackModeEnabled,
  lockedOffFlags,
  resolveFlags,
  type FeatureFlags,
} from './flags';

const allOn: FeatureFlags = {
  realAppleMusic: true,
  realSpotify: true,
  sync: true,
  playlistImport: true,
  moderation: true,
  analytics: true,
};

describe('feature flags', () => {
  it('defines the six planned flags, all off by default', () => {
    expect(defaultFlags).toEqual({
      realAppleMusic: false,
      realSpotify: false,
      sync: false,
      playlistImport: false,
      moderation: false,
      analytics: false,
    });
    expect(Object.isFrozen(defaultFlags)).toBe(true);
  });

  it('keeps every flag off with no environment (the test run sets none)', () => {
    expect(flags).toEqual(defaultFlags);
    for (const flag of Object.keys(defaultFlags) as (keyof FeatureFlags)[]) {
      expect(isEnabled(flag)).toBe(false);
    }
  });

  it('lets the environment turn on every flag except sync', () => {
    const { flags: resolved, problems } = resolveFlags(allOn);
    expect(resolved).toEqual({ ...allOn, sync: false });
    expect(problems).toEqual([
      "EXPO_PUBLIC_FLAG_SYNC is ignored: sync (beta) is private and can't be enabled.",
    ]);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('reports nothing when sync is not requested', () => {
    expect(resolveFlags({ ...allOn, sync: false }).problems).toEqual([]);
    expect(resolveFlags(defaultFlags).problems).toEqual([]);
  });

  it('locks sync off', () => {
    expect(lockedOffFlags).toContain('sync');
  });
});

describe('playback modes', () => {
  it('offers only aux, whatever the flags say', () => {
    expect(enabledPlaybackModes(defaultFlags)).toEqual(['aux']);
    expect(enabledPlaybackModes(allOn)).toEqual(['aux']);
  });

  it('models sync but never enables it', () => {
    expect(isPlaybackModeEnabled('aux', defaultFlags)).toBe(true);
    expect(isPlaybackModeEnabled('sync', defaultFlags)).toBe(false);
    expect(isPlaybackModeEnabled('sync', allOn)).toBe(false);
  });
});

describe('analyticsAllowed', () => {
  it.each([
    [false, undefined, false],
    [false, true, false],
    [true, undefined, false],
    [true, false, false],
    [true, true, true],
  ])('flag %s with opt-in %s gives %s', (flag, optedIn, expected) => {
    expect(analyticsAllowed({ ...defaultFlags, analytics: flag }, optedIn)).toBe(expected);
  });
});
