import type { MusicProvider } from '../music-provider';
import type { CanonicalRecording, ProviderTrack, TrackMatch } from '../recording';
import { normalizeIsrc, normalizeText, parseTitle, similarity, splitArtists } from './text';

/**
 * Deterministic track matching (docs/PRODUCT_SPEC.md §6): which of a
 * provider's tracks is the canonical recording. Pure: the same recording and
 * candidates always give the same answer, whatever order the candidates come in.
 *
 * 1. An exact ISRC match is the strongest signal. It proves the recording even
 *    when the titles' version markers differ.
 * 2. Otherwise candidates are scored out of 100 on title, primary artist,
 *    duration, album, explicit status and version markers (see `scoreCandidate`).
 * 3. A different version (live, remix, sped up, …) is a different recording,
 *    so it's never chosen without an ISRC; it's only listed for "Wrong version?".
 * 4. An automatic match needs at least `MATCH_THRESHOLD` and a lead of at least
 *    `MIN_LEAD` over the next same-version candidate.
 * 5. An explicit/clean conflict never matches automatically.
 * 6. Anything short of that keeps the best mapping with a warning, or is
 *    unavailable when nothing is close (`MIN_SCORE`).
 * 7. A host override ("Wrong version?") always wins.
 */

/** The lowest score that matches automatically (PRODUCT_SPEC.md §6, rule 5). */
export const MATCH_THRESHOLD = 90;
/** How far the best candidate has to lead the next one to match automatically. */
export const MIN_LEAD = 5;
/** Below this, a candidate isn't kept as a low-confidence mapping. */
export const MIN_SCORE = 50;
/** An ISRC match whose duration is further off than this is suspicious and needs review. */
export const ISRC_DURATION_TOLERANCE_MS = 10_000;

/** Points per part of the score. They add up to 100. */
export const SCORE_WEIGHTS = {
  title: 40,
  artist: 25,
  duration: 20,
  album: 5,
  explicit: 5,
  version: 5,
} as const;

/** Duration points by how far apart the two lengths are, closest band first. */
export const DURATION_BANDS: readonly { withinMs: number; points: number }[] = [
  { withinMs: 2_000, points: 20 },
  { withinMs: 5_000, points: 14 },
  { withinMs: 10_000, points: 6 },
];
/** Duration points when either length is unknown (0). */
const UNKNOWN_DURATION_POINTS = 10;
/** Album points when either album is unknown. */
const UNKNOWN_ALBUM_POINTS = 3;

export type ScoreBreakdown = Record<keyof typeof SCORE_WEIGHTS, number>;

export type ScoredCandidate = {
  track: ProviderTrack;
  /** 0–100, the sum of `breakdown`. */
  score: number;
  breakdown: ScoreBreakdown;
  isrcMatch: boolean;
  /** One is explicit and the other clean. */
  explicitConflict: boolean;
  /** The version markers differ (live, remix, remastered, …). */
  versionMismatch: boolean;
  durationDeltaMs: number | null;
};

/** Why a result isn't an automatic match, or how it was made. */
export type MatchReason =
  | 'override'
  | 'isrc'
  | 'isrc_duration_mismatch'
  | 'below_threshold'
  | 'no_clear_lead'
  | 'explicit_conflict'
  | 'version_mismatch'
  | 'no_candidates';

export type MatchResult = {
  /**
   * - `matched`: safe to play automatically.
   * - `needs_review`: mapped, but the host sees a warning and can correct it.
   * - `unavailable`: no candidate is this recording on this provider.
   */
  status: 'matched' | 'needs_review' | 'unavailable';
  /** What to store in `track_matches`. */
  match: TrackMatch;
  /** The chosen track, or `null` when unavailable. */
  track: ProviderTrack | null;
  reasons: MatchReason[];
  /** Every candidate for this provider, best first, for "Wrong version?". */
  ranked: ScoredCandidate[];
};

export type MatchOptions = {
  provider: MusicProvider;
  /** The host's stored "Wrong version?" choice for this recording, if any. */
  overrideTrackId?: string | null;
};

type Features = {
  core: string;
  markers: string[];
  artists: string[];
  primary: string | undefined;
  explicit: boolean;
  album: string | null;
  durationMs: number;
  isrc: string | null;
};

function normalizeAlbum(album: string | null): string | null {
  if (!album) return null;
  const text = normalizeText(
    album.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s+-\s+(single|ep)\s*$/i, ''),
  );
  return text || null;
}

function features(
  title: string,
  credits: readonly string[],
  primaryCredit: string | undefined,
  extraMarkers: readonly string[],
  explicit: boolean,
  album: string | null,
  durationMs: number,
  isrc: string | null,
): Features {
  const parsed = parseTitle(title, credits);
  const markerSet = new Set<string>([...parsed.markers, ...extraMarkers]);
  // "Clean" is the explicit flag's business, not a separate version.
  const clean = markerSet.delete('clean');
  const artists = splitArtists(credits);
  parsed.featured.forEach((name) => artists.includes(name) || artists.push(name));
  return {
    core: parsed.core,
    markers: [...markerSet].sort(),
    artists,
    primary: (primaryCredit ? splitArtists([primaryCredit])[0] : undefined) ?? artists[0],
    explicit: explicit && !clean,
    album: normalizeAlbum(album),
    durationMs,
    isrc: normalizeIsrc(isrc),
  };
}

function recordingFeatures(recording: CanonicalRecording): Features {
  return features(
    recording.title,
    recording.artists.length > 0 ? recording.artists : [recording.primaryArtist],
    recording.primaryArtist,
    recording.versionTags,
    recording.explicit,
    recording.album,
    recording.durationMs,
    recording.isrc,
  );
}

function trackFeatures(track: ProviderTrack): Features {
  return features(
    track.title,
    track.artists,
    undefined,
    [],
    track.explicit,
    track.album,
    track.durationMs,
    track.isrc,
  );
}

function durationPoints(deltaMs: number | null): number {
  if (deltaMs === null) return UNKNOWN_DURATION_POINTS;
  return DURATION_BANDS.find((band) => deltaMs <= band.withinMs)?.points ?? 0;
}

function artistPoints(recording: Features, track: Features): number {
  if (!recording.primary || !track.primary) return 0;
  if (recording.primary === track.primary) return SCORE_WEIGHTS.artist;
  if (track.artists.includes(recording.primary) || recording.artists.includes(track.primary)) {
    return 20;
  }
  return Math.round(15 * similarity(recording.primary, track.primary));
}

function score(recording: Features, track: ProviderTrack): ScoredCandidate {
  const candidate = trackFeatures(track);
  const durationDeltaMs =
    recording.durationMs > 0 && candidate.durationMs > 0
      ? Math.abs(recording.durationMs - candidate.durationMs)
      : null;
  const explicitConflict = recording.explicit !== candidate.explicit;
  const versionMismatch = recording.markers.join('|') !== candidate.markers.join('|');
  const breakdown: ScoreBreakdown = {
    title: Math.round(SCORE_WEIGHTS.title * similarity(recording.core, candidate.core)),
    artist: artistPoints(recording, candidate),
    duration: durationPoints(durationDeltaMs),
    album:
      recording.album && candidate.album
        ? recording.album === candidate.album
          ? SCORE_WEIGHTS.album
          : 0
        : UNKNOWN_ALBUM_POINTS,
    explicit: explicitConflict ? 0 : SCORE_WEIGHTS.explicit,
    version: versionMismatch ? 0 : SCORE_WEIGHTS.version,
  };
  return {
    track,
    score: Object.values(breakdown).reduce((sum, points) => sum + points, 0),
    breakdown,
    isrcMatch: recording.isrc !== null && recording.isrc === candidate.isrc,
    explicitConflict,
    versionMismatch,
    durationDeltaMs,
  };
}

/** Scores one provider track against a recording. */
export function scoreCandidate(
  recording: CanonicalRecording,
  track: ProviderTrack,
): ScoredCandidate {
  return score(recordingFeatures(recording), track);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A total order, so ties always break the same way: ISRC matches, then
 * no explicit conflict, then same version, then score, then closer duration,
 * then provider track id.
 */
function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  return (
    Number(b.isrcMatch) - Number(a.isrcMatch) ||
    Number(a.explicitConflict) - Number(b.explicitConflict) ||
    Number(a.versionMismatch) - Number(b.versionMismatch) ||
    b.score - a.score ||
    (a.durationDeltaMs ?? Number.MAX_SAFE_INTEGER) -
      (b.durationDeltaMs ?? Number.MAX_SAFE_INTEGER) ||
    compareText(a.track.providerTrackId, b.track.providerTrackId) ||
    compareText(JSON.stringify(a.track), JSON.stringify(b.track))
  );
}

/** Ranks the provider's candidates, best first, keeping one entry per provider track id. */
export function rankCandidates(
  recording: CanonicalRecording,
  candidates: readonly ProviderTrack[],
  provider: MusicProvider,
): ScoredCandidate[] {
  const recordingSide = recordingFeatures(recording);
  const ranked = candidates
    .filter((track) => track.provider === provider)
    .map((track) => score(recordingSide, track))
    .sort(compareCandidates);
  const seen = new Set<string>();
  return ranked.filter(({ track }) => {
    if (seen.has(track.providerTrackId)) return false;
    seen.add(track.providerTrackId);
    return true;
  });
}

type Outcome = {
  status: MatchResult['status'];
  chosen: { track: ProviderTrack; confidence: number } | null;
  method: TrackMatch['method'];
  warning: TrackMatch['warning'];
  reasons: MatchReason[];
};

/** Matches a canonical recording to one provider's candidate tracks. */
export function matchRecording(
  recording: CanonicalRecording,
  candidates: readonly ProviderTrack[],
  { provider, overrideTrackId }: MatchOptions,
): MatchResult {
  const ranked = rankCandidates(recording, candidates, provider);
  const done = (
    status: Outcome['status'],
    chosen: Outcome['chosen'],
    method: Outcome['method'],
    warning: Outcome['warning'],
    reasons: MatchReason[],
  ): MatchResult => ({
    status,
    match: {
      recordingId: recording.id,
      provider,
      providerTrackId: chosen?.track.providerTrackId ?? null,
      confidence: chosen?.confidence ?? 0,
      method,
      warning,
    },
    track: chosen?.track ?? null,
    reasons,
    ranked,
  });

  // 7. The host's correction wins. The track may not be among today's candidates.
  if (overrideTrackId) {
    const picked = ranked.find(({ track }) => track.providerTrackId === overrideTrackId);
    return {
      ...done('matched', null, 'override', null, ['override']),
      match: {
        recordingId: recording.id,
        provider,
        providerTrackId: overrideTrackId,
        confidence: 100,
        method: 'override',
        warning: null,
      },
      track: picked?.track ?? null,
    };
  }

  if (ranked.length === 0) {
    return done('unavailable', null, 'score', null, ['no_candidates']);
  }

  // 1. ISRC. The ranking puts ISRC matches first, the safest of them first.
  const isrcBest = ranked[0].isrcMatch ? ranked[0] : null;
  if (isrcBest) {
    if (isrcBest.explicitConflict) {
      return done(
        'needs_review',
        { track: isrcBest.track, confidence: isrcBest.score },
        'isrc',
        'explicit_conflict',
        ['isrc', 'explicit_conflict'],
      );
    }
    if (
      isrcBest.durationDeltaMs !== null &&
      isrcBest.durationDeltaMs > ISRC_DURATION_TOLERANCE_MS
    ) {
      return done(
        'needs_review',
        { track: isrcBest.track, confidence: Math.min(isrcBest.score, MATCH_THRESHOLD - 1) },
        'isrc',
        'low_confidence',
        ['isrc', 'isrc_duration_mismatch'],
      );
    }
    return done('matched', { track: isrcBest.track, confidence: 100 }, 'isrc', null, ['isrc']);
  }

  // 2–4. Score the candidates that are the same version and the same explicit status.
  const same = ranked.filter((c) => !c.versionMismatch && !c.explicitConflict);
  const [best, second] = same;
  if (best && best.score >= MIN_SCORE) {
    const lead = second ? best.score - second.score : Number.POSITIVE_INFINITY;
    if (best.score >= MATCH_THRESHOLD && lead >= MIN_LEAD) {
      return done('matched', { track: best.track, confidence: best.score }, 'score', null, []);
    }
    const reasons: MatchReason[] = [];
    if (best.score < MATCH_THRESHOLD) reasons.push('below_threshold');
    if (lead < MIN_LEAD) reasons.push('no_clear_lead');
    return done(
      'needs_review',
      { track: best.track, confidence: best.score },
      'score',
      'low_confidence',
      reasons,
    );
  }

  // 5. Only the other explicit status is close: keep it, with the conflict shown.
  const conflict = ranked.find((c) => !c.versionMismatch && c.explicitConflict);
  if (conflict && conflict.score >= MIN_SCORE) {
    return done(
      'needs_review',
      { track: conflict.track, confidence: conflict.score },
      'score',
      'explicit_conflict',
      ['explicit_conflict'],
    );
  }

  // 3. Different versions are different recordings: listed in `ranked`, never chosen.
  const reasons: MatchReason[] = ranked.some((c) => c.versionMismatch)
    ? ['version_mismatch']
    : ['below_threshold'];
  return done('unavailable', null, 'score', null, reasons);
}
