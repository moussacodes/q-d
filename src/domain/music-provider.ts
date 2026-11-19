/** Supported music providers (plan.md §3). Others are future/unavailable. */
export type MusicProvider = 'apple_music' | 'spotify';

export const providerNames: Record<MusicProvider, string> = {
  apple_music: 'Apple Music',
  spotify: 'Spotify',
};

/** The other supported provider, e.g. what the host could switch to. */
export function otherProvider(provider: MusicProvider): MusicProvider {
  return provider === 'spotify' ? 'apple_music' : 'spotify';
}
