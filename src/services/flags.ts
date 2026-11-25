import { env, envNames, type RequestedFlags } from './env';

/**
 * Feature flags (docs/ARCHITECTURE.md §8). Every flag is off unless the
 * environment turns it on, and some can't be turned on in this build at all.
 *
 * | Flag             | Default | Notes                                                        |
 * |------------------|---------|--------------------------------------------------------------|
 * | `realAppleMusic` | off     | Real MusicKit adapter. Off until it works on a device.        |
 * | `realSpotify`    | off     | Real Spotify adapter. Off until Spotify aux works on a device. |
 * | `sync`           | off     | Private research. Locked off: the environment can't enable it. |
 * | `playlistImport` | off     | Post-demo.                                                    |
 * | `moderation`     | off     | Off for the demo, on for the public beta.                     |
 * | `analytics`      | off     | When on, each person still has to opt in.                     |
 */
export type FeatureFlags = Readonly<RequestedFlags>;
export type FeatureFlag = keyof FeatureFlags;

export const defaultFlags: FeatureFlags = Object.freeze({
  realAppleMusic: false,
  realSpotify: false,
  sync: false,
  playlistImport: false,
  moderation: false,
  analytics: false,
});

/**
 * Flags this build refuses to turn on, whatever the environment says.
 * `sync (beta)` stays off until providers and a legal review approve it in
 * writing (PRODUCT_SPEC.md §2), so a stray `EXPO_PUBLIC_FLAG_SYNC=true`
 * can't expose it.
 */
export const lockedOffFlags: readonly FeatureFlag[] = ['sync'];

export interface FlagsResult {
  flags: FeatureFlags;
  problems: string[];
}

/** Applies the build's locks to the flags the environment asked for. Pure. */
export function resolveFlags(requested: RequestedFlags): FlagsResult {
  const problems: string[] = [];
  const flags = { ...defaultFlags, ...requested };
  for (const flag of lockedOffFlags) {
    if (flags[flag]) {
      flags[flag] = false;
      problems.push(
        `${envNames.flagSync} is ignored: sync (beta) is private and can't be enabled.`,
      );
    }
  }
  return { flags: Object.freeze(flags), problems };
}

/** Room playback modes. `sync` is modeled so types and the database can name it. */
export type PlaybackMode = 'aux' | 'sync';

/**
 * The modes a host may pick. Always just `aux`: `sync` is never offered,
 * even with its flag on, until a decision says otherwise.
 */
export function enabledPlaybackModes(_flags: FeatureFlags): readonly PlaybackMode[] {
  return ['aux'];
}

export function isPlaybackModeEnabled(mode: PlaybackMode, flags: FeatureFlags): boolean {
  return enabledPlaybackModes(flags).includes(mode);
}

/**
 * Analytics need both the flag and the person's own opt-in
 * (PRODUCT_SPEC.md §7). Opting in is never assumed.
 */
export function analyticsAllowed(flags: FeatureFlags, optedIn: boolean | undefined): boolean {
  return flags.analytics && optedIn === true;
}

const resolved = resolveFlags(env.requestedFlags);

if (__DEV__) {
  for (const message of resolved.problems) console.warn(message);
}

/** This run's flags. */
export const flags: FeatureFlags = resolved.flags;

export function isEnabled(flag: FeatureFlag): boolean {
  return flags[flag];
}
