/**
 * Config plugin for qd-music-kit. It writes the iOS settings MusicKit playback
 * needs into the generated project, so `ios/` is never committed
 * (docs/ARCHITECTURE.md §4.9):
 *
 * - `NSAppleMusicUsageDescription`: the text iOS shows when q’d asks for
 *   Apple Music access.
 * - `UIBackgroundModes` gets `audio`, so the host's music keeps playing with
 *   the screen locked.
 *
 * MusicKit itself needs no entitlement key. It's an App Service turned on for
 * the bundle ID `app.qd.mobile` in the Apple Developer portal
 * (docs/PROVIDER_FEASIBILITY.md).
 */
const { createRunOncePlugin, withInfoPlist } = require('expo/config-plugins');

const DEFAULT_USAGE_DESCRIPTION =
  'q’d plays your room’s queue through Apple Music when you host from this iPhone.';

/**
 * @typedef {{ appleMusicUsageDescription?: string, backgroundAudio?: boolean }} QdMusicKitPluginOptions
 */

/**
 * @param {QdMusicKitPluginOptions | undefined | null} options
 * @returns {{ appleMusicUsageDescription: string, backgroundAudio: boolean }}
 */
function resolveOptions(options) {
  const { appleMusicUsageDescription = DEFAULT_USAGE_DESCRIPTION, backgroundAudio = true } =
    options ?? {};
  if (typeof appleMusicUsageDescription !== 'string' || !appleMusicUsageDescription.trim()) {
    throw new Error('qd-music-kit: appleMusicUsageDescription must be a non-empty string');
  }
  if (typeof backgroundAudio !== 'boolean') {
    throw new Error('qd-music-kit: backgroundAudio must be true or false');
  }
  return { appleMusicUsageDescription: appleMusicUsageDescription.trim(), backgroundAudio };
}

/**
 * Pure Info.plist change, exported for tests.
 * @param {Record<string, unknown>} infoPlist
 * @param {QdMusicKitPluginOptions} [options]
 * @returns {Record<string, unknown>}
 */
function setMusicKitInfoPlist(infoPlist, options) {
  const { appleMusicUsageDescription, backgroundAudio } = resolveOptions(options);
  const result = { ...infoPlist, NSAppleMusicUsageDescription: appleMusicUsageDescription };
  if (backgroundAudio) {
    const modes = Array.isArray(infoPlist.UIBackgroundModes) ? infoPlist.UIBackgroundModes : [];
    result.UIBackgroundModes = modes.includes('audio') ? [...modes] : [...modes, 'audio'];
  }
  return result;
}

/** @type {import('expo/config-plugins').ConfigPlugin<QdMusicKitPluginOptions | void>} */
const withQdMusicKit = (config, options) => {
  // Validate when the config loads, not later during prebuild.
  const resolved = resolveOptions(options);
  return withInfoPlist(config, (cfg) => {
    cfg.modResults = setMusicKitInfoPlist(cfg.modResults, resolved);
    return cfg;
  });
};

module.exports = createRunOncePlugin(withQdMusicKit, 'qd-music-kit', '0.1.0');
module.exports.setMusicKitInfoPlist = setMusicKitInfoPlist;
module.exports.DEFAULT_USAGE_DESCRIPTION = DEFAULT_USAGE_DESCRIPTION;
