import type { CanonicalRecording, ProviderTrack } from '../recording';
import { trackMatchSchema } from '../recording';
import {
  MATCH_THRESHOLD,
  MIN_LEAD,
  SCORE_WEIGHTS,
  matchRecording,
  rankCandidates,
  scoreCandidate,
} from './match';

const recording: CanonicalRecording = {
  id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  title: 'Rain Down',
  primaryArtist: 'Delerium',
  artists: ['Delerium', 'Sarah McLachlan'],
  album: 'Karma',
  durationMs: 225_000,
  isrc: 'CAA019700123',
  explicit: false,
  versionTags: [],
};

let nextId = 0;
function track(changes: Partial<ProviderTrack> = {}): ProviderTrack {
  nextId += 1;
  return {
    provider: 'spotify',
    providerTrackId: `t${nextId}`,
    title: 'Rain Down',
    artists: ['Delerium', 'Sarah McLachlan'],
    album: 'Karma',
    durationMs: 225_000,
    isrc: null,
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
    ...changes,
  };
}

const match = (candidates: ProviderTrack[], rec: CanonicalRecording = recording) =>
  matchRecording(rec, candidates, { provider: 'spotify' });

describe('scoreCandidate', () => {
  it('gives an identical track full marks', () => {
    const scored = scoreCandidate(recording, track());
    expect(scored.score).toBe(100);
    expect(scored.breakdown).toEqual(SCORE_WEIGHTS);
  });

  it('weights add up to 100', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('matchRecording', () => {
  it('matches an exact ISRC automatically with full confidence', () => {
    const exact = track({ isrc: 'CAA019700123', title: 'Rain Down - Radio Edit', album: null });
    const result = match([track({ title: 'Rain Down' }), exact]);
    expect(result).toMatchObject({
      status: 'matched',
      track: exact,
      reasons: ['isrc'],
      match: {
        providerTrackId: exact.providerTrackId,
        confidence: 100,
        method: 'isrc',
        warning: null,
      },
    });
  });

  it('matches through normalization: case, accents, punctuation, & and featured artists', () => {
    const rec = {
      ...recording,
      title: 'Rain Down (feat. Sarah McLachlan)',
      artists: ['Delerium'],
      isrc: null,
    };
    const candidate = track({ title: 'RAIN DOWN', artists: ['Delerium & Sarah McLachlan'] });
    expect(match([candidate], rec)).toMatchObject({
      status: 'matched',
      match: { method: 'score' },
    });
  });

  it('matches a high score with a clear lead', () => {
    const result = match([track(), track({ album: 'Best Of', durationMs: 229_000 })]);
    expect(result.status).toBe('matched');
    expect(result.match.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('needs review when two candidates are too close', () => {
    const result = match([track(), track()]);
    expect(result.status).toBe('needs_review');
    expect(result.match.warning).toBe('low_confidence');
    expect(result.reasons).toContain('no_clear_lead');
    expect(MIN_LEAD).toBeGreaterThan(0);
  });

  it('needs review below the threshold, keeping the mapping with a warning', () => {
    const result = match([track({ durationMs: 234_000, album: 'Other' })], {
      ...recording,
      isrc: null,
    });
    expect(result).toMatchObject({
      status: 'needs_review',
      reasons: ['below_threshold'],
      match: { warning: 'low_confidence', method: 'score' },
    });
    expect(result.match.providerTrackId).not.toBeNull();
  });

  it('never matches a live, remixed or remastered version automatically', () => {
    const result = match([track({ title: 'Rain Down (Live)' })], { ...recording, isrc: null });
    expect(result).toMatchObject({
      status: 'unavailable',
      reasons: ['version_mismatch'],
      match: { providerTrackId: null, confidence: 0 },
    });
    expect(result.ranked).toHaveLength(1);
  });

  it('lets an exact ISRC prove that a remaster is the same recording', () => {
    const remaster = track({ title: 'Rain Down - 2011 Remaster', isrc: 'CAA019700123' });
    expect(match([remaster]).status).toBe('matched');
  });

  it('blocks an explicit/clean conflict even with a perfect score otherwise', () => {
    const result = match([track({ explicit: true })], { ...recording, isrc: null });
    expect(result).toMatchObject({
      status: 'needs_review',
      reasons: ['explicit_conflict'],
      match: { warning: 'explicit_conflict' },
    });
  });

  it('blocks an explicit/clean conflict on an ISRC match too', () => {
    const result = match([track({ explicit: true, isrc: 'CAA019700123' })]);
    expect(result).toMatchObject({
      status: 'needs_review',
      match: { method: 'isrc', warning: 'explicit_conflict' },
    });
  });

  it('is unavailable with no candidates for this provider', () => {
    const result = match([track({ provider: 'apple_music' })]);
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['no_candidates'], ranked: [] });
  });

  it('is unavailable when nothing is close', () => {
    const result = match(
      [track({ title: 'Something Else', artists: ['Nobody'], durationMs: 100_000, album: 'X' })],
      { ...recording, isrc: null },
    );
    expect(result.status).toBe('unavailable');
  });

  it('uses the host override whatever the candidates say', () => {
    const result = matchRecording(recording, [track()], {
      provider: 'spotify',
      overrideTrackId: 'picked',
    });
    expect(result).toMatchObject({
      status: 'matched',
      reasons: ['override'],
      match: { providerTrackId: 'picked', method: 'override', confidence: 100, warning: null },
      track: null,
    });
  });

  it('always returns a valid TrackMatch', () => {
    for (const candidates of [
      [],
      [track()],
      [track(), track()],
      [track({ title: 'Rain Down (Live)' })],
    ]) {
      expect(trackMatchSchema.safeParse(match(candidates).match).success).toBe(true);
    }
  });

  it('gives the same answer whatever order the candidates come in', () => {
    const candidates = [
      track({ album: 'Best Of' }),
      track(),
      track({ title: 'Rain Down (Live)' }),
      track({ durationMs: 231_000 }),
    ];
    const forward = match(candidates);
    const backward = match([...candidates].reverse());
    expect(backward).toEqual(forward);
    expect(
      rankCandidates(recording, candidates, 'spotify').map((c) => c.track.providerTrackId),
    ).toEqual(forward.ranked.map((c) => c.track.providerTrackId));
  });
});
