import { useCallback, useEffect, useState } from 'react';

import { matchRecording, parseTitle, type VersionMarker } from '@/domain/matching';
import type { MusicProvider } from '@/domain/music-provider';
import type { ProviderTrack } from '@/domain/recording';
import { versions as versionSource, type VersionSource } from '@/providers';

/** How each version marker reads on a "Wrong version?" row. */
const markerLabels: Record<VersionMarker, string> = {
  live: 'Live',
  remix: 'Remix',
  acoustic: 'Acoustic',
  instrumental: 'Instrumental',
  sped_up: 'Sped up',
  slowed: 'Slowed',
  clean: 'Clean',
  remastered: 'Remastered',
  radio_edit: 'Radio edit',
  extended: 'Extended',
  demo: 'Demo',
  karaoke: 'Karaoke',
  a_cappella: 'A cappella',
};

/**
 * The tags a version shows: its version markers ("Radio edit", "Live"), then
 * "Explicit" or "Clean" from the explicit flag. A "(Clean)" title is the
 * flag, not a version (DECISIONS 2026-11-24), so it isn't shown twice.
 */
export function versionTags(track: Pick<ProviderTrack, 'title' | 'artists' | 'explicit'>) {
  const markers = parseTitle(track.title, track.artists).markers.filter((m) => m !== 'clean');
  return [...markers.map((marker) => markerLabels[marker]), track.explicit ? 'Explicit' : 'Clean'];
}

export type VersionChoices =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'done';
      /** The service's versions, best match first (`matchRecording`'s ranking). */
      tracks: ProviderTrack[];
      isMock: boolean;
    };

/**
 * The versions the room's service has of a recording, for "Wrong version?".
 * Ranked by the matcher, so the closest match comes first and the list is the
 * same on every phone. `retry` loads again after an error.
 */
export function useVersionChoices(
  recordingId: string | null,
  provider: MusicProvider,
  source: VersionSource = versionSource,
): VersionChoices & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; choices: VersionChoices } | null>(null);
  const key = `${recordingId}|${provider}|${attempt}`;

  useEffect(() => {
    if (!recordingId) return;
    let current = true;
    source.versions(recordingId, provider).then(
      ({ recording, candidates, isMock }) => {
        if (!current) return;
        const { ranked } = matchRecording(recording, candidates, { provider });
        setAnswer({
          key,
          choices: { status: 'done', tracks: ranked.map(({ track }) => track), isMock },
        });
      },
      () => {
        if (current) setAnswer({ key, choices: { status: 'error' } });
      },
    );
    return () => {
      current = false;
    };
  }, [recordingId, provider, source, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!recordingId) return { status: 'error', retry };
  return { ...(answer?.key === key ? answer.choices : { status: 'loading' }), retry };
}

/**
 * The versions in the order "Wrong version?" shows them: what the entry plays
 * now first, then the host's pick, then the rest in the matcher's order. The
 * host sees what they're hearing before the alternatives, even when the
 * matcher ranks another version above it (a clean radio edit above an
 * explicit match).
 */
export function pinnedFirst<T extends Pick<ProviderTrack, 'providerTrackId'>>(
  tracks: readonly T[],
  first: readonly (string | null)[],
): T[] {
  const pinned = first.flatMap((id, index) =>
    id !== null && first.indexOf(id) === index
      ? tracks.filter((track) => track.providerTrackId === id)
      : [],
  );
  return [...pinned, ...tracks.filter((track) => !pinned.includes(track))];
}
