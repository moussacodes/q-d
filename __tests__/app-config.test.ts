/**
 * What app.config.ts asks of iOS builds. There's no ios/ folder (AGENTS.md),
 * so these settings are the only record of the capabilities a build gets.
 */
import { getConfig } from 'expo/config';
import { join } from 'path';

import appConfig from '../app.config';

const pluginNames = (appConfig.plugins ?? []).map((plugin) =>
  Array.isArray(plugin) ? plugin[0] : plugin,
);

describe('Sign in with Apple', () => {
  it('turns on the capability for builds', () => {
    expect(appConfig.ios?.usesAppleSignIn).toBe(true);
  });

  it('adds the expo-apple-authentication config plugin', () => {
    expect(pluginNames).toContain('expo-apple-authentication');
  });

  it('keeps the bundle ID the Supabase Apple provider lists as a client ID', () => {
    expect(appConfig.ios?.bundleIdentifier).toBe('app.qd.mobile');
  });
});

describe('background audio (screen locked)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setMusicKitInfoPlist } = require('../modules/qd-music-kit/app.plugin.js') as {
    setMusicKitInfoPlist: (plist: Record<string, unknown>) => Record<string, unknown>;
  };

  it('asks for the audio background mode in app.config.ts', () => {
    expect(appConfig.ios?.infoPlist?.UIBackgroundModes).toEqual(['audio']);
  });

  it('resolves through Expo’s config loader with the audio mode', () => {
    const { exp } = getConfig(join(__dirname, '..'), { skipSDKVersionRequirement: true });
    expect(exp.ios?.infoPlist?.UIBackgroundModes).toEqual(['audio']);
  });

  it('keeps one audio entry after the qd-music-kit plugin adds its own, and keeps other modes', () => {
    const plist = setMusicKitInfoPlist({ ...appConfig.ios?.infoPlist });
    expect(plist.UIBackgroundModes).toEqual(['audio']);
    expect(
      setMusicKitInfoPlist({ UIBackgroundModes: ['remote-notification'] }).UIBackgroundModes,
    ).toEqual(['remote-notification', 'audio']);
  });

  it('still runs the qd-music-kit plugin, which adds the Apple Music usage text', () => {
    expect(pluginNames).toContain('./modules/qd-music-kit/app.plugin.js');
  });
});
