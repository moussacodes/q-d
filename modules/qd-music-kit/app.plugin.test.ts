/// <reference types="node" />
import type { ExpoConfig } from 'expo/config';
import { getConfig } from 'expo/config';
import { join } from 'path';

import appConfig from '../../app.config';
import withQdMusicKit, { DEFAULT_USAGE_DESCRIPTION, setMusicKitInfoPlist } from './app.plugin';

const projectRoot = join(__dirname, '..', '..');
const PLUGIN_PATH = './modules/qd-music-kit/app.plugin.js';

type ModdedConfig = ExpoConfig & {
  mods?: Record<string, Record<string, (config: unknown) => Promise<{ modResults: unknown }>>>;
};

/** Runs the Info.plist mod the plugin registered, as prebuild would. */
async function runInfoPlistMod(config: ModdedConfig, infoPlist: Record<string, unknown>) {
  const mod = config.mods?.ios?.infoPlist;
  if (!mod) throw new Error('no ios.infoPlist mod registered');
  const result = await mod({
    ...config,
    modResults: infoPlist,
    modRequest: {
      projectRoot,
      platformProjectRoot: join(projectRoot, 'ios'),
      modName: 'infoPlist',
      platform: 'ios',
      introspect: false,
    },
  });
  return result.modResults as Record<string, unknown>;
}

const baseConfig = (): ModdedConfig => ({ name: 'q’d', slug: 'qd' });

describe('setMusicKitInfoPlist', () => {
  it('adds the Apple Music usage description and the audio background mode', () => {
    expect(setMusicKitInfoPlist({})).toEqual({
      NSAppleMusicUsageDescription: DEFAULT_USAGE_DESCRIPTION,
      UIBackgroundModes: ['audio'],
    });
  });

  it('says q’d with the curly apostrophe and names Apple Music', () => {
    expect(DEFAULT_USAGE_DESCRIPTION).toContain('q’d');
    expect(DEFAULT_USAGE_DESCRIPTION).not.toContain("q'd");
    expect(DEFAULT_USAGE_DESCRIPTION).toContain('Apple Music');
  });

  it('keeps existing keys and background modes', () => {
    const result = setMusicKitInfoPlist({
      CFBundleName: 'q’d',
      UIBackgroundModes: ['remote-notification'],
    });
    expect(result.CFBundleName).toBe('q’d');
    expect(result.UIBackgroundModes).toEqual(['remote-notification', 'audio']);
  });

  it('does not duplicate audio and is idempotent', () => {
    const once = setMusicKitInfoPlist({ UIBackgroundModes: ['audio'] });
    expect(once.UIBackgroundModes).toEqual(['audio']);
    expect(setMusicKitInfoPlist(once)).toEqual(once);
  });

  it('does not mutate its input', () => {
    const input = { UIBackgroundModes: ['fetch'] };
    setMusicKitInfoPlist(input);
    expect(input).toEqual({ UIBackgroundModes: ['fetch'] });
  });

  it('replaces a malformed UIBackgroundModes value', () => {
    expect(setMusicKitInfoPlist({ UIBackgroundModes: 'audio' }).UIBackgroundModes).toEqual([
      'audio',
    ]);
  });

  it('leaves background modes alone when backgroundAudio is false', () => {
    expect(setMusicKitInfoPlist({}, { backgroundAudio: false })).toEqual({
      NSAppleMusicUsageDescription: DEFAULT_USAGE_DESCRIPTION,
    });
  });

  it('takes a custom description, trimmed', () => {
    const result = setMusicKitInfoPlist({}, { appleMusicUsageDescription: '  Custom text.  ' });
    expect(result.NSAppleMusicUsageDescription).toBe('Custom text.');
  });

  it.each(['', '   ', 42, null])('rejects the description %p', (value) => {
    expect(() =>
      setMusicKitInfoPlist({}, { appleMusicUsageDescription: value as unknown as string }),
    ).toThrow(/appleMusicUsageDescription/);
  });

  it('rejects a non-boolean backgroundAudio', () => {
    expect(() =>
      setMusicKitInfoPlist({}, { backgroundAudio: 'yes' as unknown as boolean }),
    ).toThrow(/backgroundAudio/);
  });
});

describe('withQdMusicKit config plugin', () => {
  it('registers only an iOS Info.plist mod: no entitlements, no Android', () => {
    const config = withQdMusicKit(baseConfig()) as ModdedConfig;
    expect(Object.keys(config.mods ?? {})).toEqual(['ios']);
    expect(Object.keys(config.mods?.ios ?? {})).toEqual(['infoPlist']);
  });

  it('writes the usage description and background audio through the mod', async () => {
    const config = withQdMusicKit(baseConfig()) as ModdedConfig;
    const plist = await runInfoPlistMod(config, { CFBundleDisplayName: 'q’d' });
    expect(plist).toEqual({
      CFBundleDisplayName: 'q’d',
      NSAppleMusicUsageDescription: DEFAULT_USAGE_DESCRIPTION,
      UIBackgroundModes: ['audio'],
    });
  });

  it('passes options through to the mod', async () => {
    const config = withQdMusicKit(baseConfig(), {
      appleMusicUsageDescription: 'Other text.',
      backgroundAudio: false,
    }) as ModdedConfig;
    expect(await runInfoPlistMod(config, {})).toEqual({
      NSAppleMusicUsageDescription: 'Other text.',
    });
  });

  it('fails when the config loads, not later, for bad options', () => {
    expect(() => withQdMusicKit(baseConfig(), { appleMusicUsageDescription: '' })).toThrow(
      /appleMusicUsageDescription/,
    );
  });

  it('runs once even if listed twice', async () => {
    const config = withQdMusicKit(withQdMusicKit(baseConfig()) as ModdedConfig) as ModdedConfig;
    expect(await runInfoPlistMod(config, {})).toEqual({
      NSAppleMusicUsageDescription: DEFAULT_USAGE_DESCRIPTION,
      UIBackgroundModes: ['audio'],
    });
  });
});

describe('app.config.ts wiring', () => {
  it('lists the plugin', () => {
    expect(appConfig.plugins).toContain(PLUGIN_PATH);
  });

  it('resolves and applies it when Expo loads the config', () => {
    const { exp } = getConfig(projectRoot, { skipSDKVersionRequirement: true });
    expect(Object.keys(exp._internal?.pluginHistory ?? {})).toContain('qd-music-kit');
    expect(exp.ios?.bundleIdentifier).toBe('app.qd.mobile');
  });
});
