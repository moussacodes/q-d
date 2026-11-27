import { matchRecording } from '@/domain/matching';
import { musicProviders, type MusicProvider } from '@/domain/music-provider';
import type { CanonicalRecording, ProviderTrack, TrackMatch } from '@/domain/recording';
import { parseDuration } from '@/domain/time';

/**
 * Mock track matches. Each fixture is a canonical recording, and each service
 * gets made-up candidate tracks that `matchRecording` (src/domain/matching)
 * scores, so mock mode shows what the real matcher would decide for them:
 *
 * - by default, one candidate identical to the recording: an automatic match;
 * - `unavailableOn`: no candidate on that service: unavailable;
 * - `uncertainOn` `low_confidence`: the closest candidate has another album
 *   and is 7 s longer (81/100): kept with a warning;
 * - `uncertainOn` `explicit_conflict`: the only candidate of the same version
 *   is the explicit one of a clean recording: kept with a warning, never
 *   automatic.
 *
 * An uncertain fixture's service also offers other versions (a radio edit,
 * live or sped-up take), which the matcher never picks without an ISRC. They
 * are what "Wrong version?" lists next to the closest match.
 *
 * The candidates are invented and labeled mock; they aren't real catalog data.
 */

/** Why a fixture's closest match on a service isn't automatic. */
export type MockUncertainty = {
  provider: MusicProvider;
  because: 'low_confidence' | 'explicit_conflict';
};

/** The fixture fields matching reads. */
export type MockMatchInput = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  unavailableOn?: MusicProvider;
  uncertainOn?: MockUncertainty;
};

/** A fixed UUID per fixture id, because recording ids are UUIDs. */
export function mockRecordingId(fixtureId: string): string {
  const hex = [...fixtureId]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(12, '0')
    .slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

export function mockRecording(fixture: MockMatchInput): CanonicalRecording {
  return {
    id: mockRecordingId(fixture.id),
    title: fixture.title,
    primaryArtist: fixture.artist.split(', ')[0],
    artists: fixture.artist.split(', '),
    album: fixture.album,
    durationMs: parseDuration(fixture.duration),
    isrc: null,
    explicit: false,
    versionTags: [],
  };
}

/** The made-up tracks a service offers for a fixture. */
export function mockCandidates(fixture: MockMatchInput, provider: MusicProvider): ProviderTrack[] {
  if (fixture.unavailableOn === provider) return [];
  const recording = mockRecording(fixture);
  const exact: ProviderTrack = {
    provider,
    providerTrackId: `mock-${provider}-${fixture.id}`,
    title: recording.title,
    artists: recording.artists,
    album: recording.album,
    durationMs: recording.durationMs,
    isrc: null,
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
  };
  if (fixture.uncertainOn?.provider !== provider) return [exact];
  /** Another version on the service, with its own made-up id. */
  const version = (slug: string, title: string, changes: Partial<ProviderTrack> = {}) => ({
    ...exact,
    providerTrackId: `mock-${provider}-${fixture.id}-${slug}`,
    title: `${recording.title}${title}`,
    ...changes,
  });
  if (fixture.uncertainOn.because === 'explicit_conflict') {
    return [
      { ...exact, explicit: true },
      version('radio-edit', ' - Radio Edit', { durationMs: recording.durationMs - 12_000 }),
      version('live', ' (Live)', { album: 'Mock Live Sessions', explicit: true }),
    ];
  }
  return [
    { ...exact, album: 'Mock Compilation', durationMs: recording.durationMs + 7_000 },
    version('radio-edit', ' - Radio Edit', { durationMs: recording.durationMs - 15_000 }),
    version('sped-up', ' - Sped Up', { durationMs: Math.round(recording.durationMs * 0.8) }),
    version('live', ' (Live)', { album: 'Mock Live Sessions', explicit: true }),
  ];
}

/** What the matcher decides for a fixture on every service. */
export function mockMatches(fixture: MockMatchInput): Record<MusicProvider, TrackMatch> {
  const recording = mockRecording(fixture);
  const entries = musicProviders.map((provider) => {
    const { match } = matchRecording(recording, mockCandidates(fixture, provider), { provider });
    return [provider, match] as const;
  });
  return Object.fromEntries(entries) as Record<MusicProvider, TrackMatch>;
}
