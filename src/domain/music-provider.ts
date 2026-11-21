/** Supported music providers (plan.md §3). Others are future/unavailable. */
export type MusicProvider = 'apple_music' | 'spotify';

export const providerNames: Record<MusicProvider, string> = {
  apple_music: 'Apple Music',
  spotify: 'Spotify',
};
