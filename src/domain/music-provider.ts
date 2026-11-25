import { z } from 'zod';

/** The supported music providers (docs/API_CONTRACTS.md §5). No others exist in q’d. */
export const musicProviders = ['apple_music', 'spotify'] as const;
export const musicProviderSchema = z.enum(musicProviders);
export type MusicProvider = z.infer<typeof musicProviderSchema>;

/**
 * How a room plays. Only `aux` is enabled: `sync (beta)` is modeled here so the
 * types and feature flags can name it, but it must never be exposed or claimed.
 */
export const playbackModes = ['aux', 'sync'] as const;
export const playbackModeSchema = z.enum(playbackModes);
export type PlaybackMode = z.infer<typeof playbackModeSchema>;

export const providerNames: Record<MusicProvider, string> = {
  apple_music: 'Apple Music',
  spotify: 'Spotify',
};

/** The other supported provider, e.g. what the host could switch to. */
export function otherProvider(provider: MusicProvider): MusicProvider {
  return provider === 'spotify' ? 'apple_music' : 'spotify';
}
