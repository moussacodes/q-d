import type { MusicProvider } from '../music-provider';
import { trackMatchSchema, type CanonicalRecording, type ProviderTrack } from '../recording';
import {
  ISRC_DURATION_TOLERANCE_MS,
  MATCH_THRESHOLD,
  MIN_LEAD,
  MIN_SCORE,
  matchRecording,
  scoreCandidate,
  type MatchResult,
} from './match';

/**
 * Table-driven tests for the matching rules (PRODUCT_SPEC.md §6 and
 * DECISIONS.md "Track matching"): ISRC, durations, explicit/clean conflicts,
 * version tokens, normalization, thresholds, tie-breaking and ordering.
 */

const ISRC = 'GBAYE0000351';

/** A plain studio recording with every field known. */
const base: CanonicalRecording = {
  id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  title: 'Yellow Light',
  primaryArtist: 'Nova Harbor',
  artists: ['Nova Harbor'],
  album: 'Coastlines',
  durationMs: 200_000,
  isrc: null,
  explicit: false,
  versionTags: [],
};

const rec = (changes: Partial<CanonicalRecording> = {}): CanonicalRecording => ({
  ...base,
  ...changes,
});

/** A provider track identical to `base`, with id `id`. */
const cand = (id: string, changes: Partial<ProviderTrack> = {}): ProviderTrack => ({
  provider: 'spotify',
  providerTrackId: id,
  title: base.title,
  artists: [...base.artists],
  album: base.album,
  durationMs: base.durationMs,
  isrc: null,
  explicit: false,
  artworkUrl: null,
  artworkBackgroundColor: null,
  ...changes,
});

const run = (
  recording: CanonicalRecording,
  candidates: ProviderTrack[],
  provider: MusicProvider = 'spotify',
) => matchRecording(recording, candidates, { provider });

/** The invariants every result keeps, whatever the input. */
function expectConsistent(result: MatchResult) {
  expect(trackMatchSchema.safeParse(result.match).success).toBe(true);
  switch (result.status) {
    case 'matched':
      expect(result.match.warning).toBeNull();
      expect(result.match.providerTrackId).not.toBeNull();
      if (result.match.method === 'score') {
        expect(result.match.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      }
      break;
    case 'needs_review':
      expect(result.match.warning).not.toBeNull();
      expect(result.match.providerTrackId).not.toBeNull();
      expect(result.track?.providerTrackId).toBe(result.match.providerTrackId);
      break;
    case 'unavailable':
      expect(result.match).toMatchObject({ providerTrackId: null, confidence: 0, warning: null });
      expect(result.track).toBeNull();
      break;
  }
}

type Expectation = {
  status: MatchResult['status'];
  /** The provider track id chosen; `null` for none. */
  pick?: string | null;
  method?: 'isrc' | 'score' | 'override';
  warning?: 'low_confidence' | 'explicit_conflict' | null;
  reasons?: string[];
  confidence?: number;
};

type Row = [string, CanonicalRecording, ProviderTrack[], Expectation];

function check(recording: CanonicalRecording, candidates: ProviderTrack[], want: Expectation) {
  const result = run(recording, candidates);
  expectConsistent(result);
  expect(result.status).toBe(want.status);
  if (want.pick !== undefined) expect(result.match.providerTrackId).toBe(want.pick);
  if (want.method !== undefined) expect(result.match.method).toBe(want.method);
  if (want.warning !== undefined) expect(result.match.warning).toBe(want.warning);
  if (want.reasons !== undefined) expect(result.reasons).toEqual(want.reasons);
  if (want.confidence !== undefined) expect(result.match.confidence).toBe(want.confidence);
  return result;
}

describe('ISRC', () => {
  const rows: Row[] = [
    [
      'an exact ISRC matches with full confidence',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC })],
      { status: 'matched', pick: 'a', method: 'isrc', confidence: 100, reasons: ['isrc'] },
    ],
    [
      'an ISRC beats a better-looking text match',
      rec({ isrc: ISRC }),
      [cand('text'), cand('isrc', { isrc: ISRC, album: 'Hits', durationMs: 203_000 })],
      { status: 'matched', pick: 'isrc', method: 'isrc' },
    ],
    [
      'ISRCs compare case-insensitively and without hyphens or spaces',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: 'gb-aye-00-00351' })],
      { status: 'matched', pick: 'a', method: 'isrc' },
    ],
    [
      'an ISRC proves a remaster is the same recording',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, title: 'Yellow Light - 2011 Remaster' })],
      { status: 'matched', pick: 'a', method: 'isrc' },
    ],
    [
      'an ISRC proves a live-titled track is the same recording',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, title: 'Yellow Light (Live)' })],
      { status: 'matched', pick: 'a', method: 'isrc' },
    ],
    [
      'an ISRC matches even with a different title and artist spelling',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, title: 'Yelow Lite', artists: ['Nova Harbour'] })],
      { status: 'matched', pick: 'a', method: 'isrc' },
    ],
    [
      'an ISRC with an explicit/clean conflict needs review',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, explicit: true })],
      { status: 'needs_review', pick: 'a', method: 'isrc', warning: 'explicit_conflict' },
    ],
    [
      `an ISRC duration exactly ${ISRC_DURATION_TOLERANCE_MS} ms off still matches`,
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, durationMs: 200_000 + ISRC_DURATION_TOLERANCE_MS })],
      { status: 'matched', pick: 'a', method: 'isrc' },
    ],
    [
      'an ISRC duration 1 ms past the tolerance needs review',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, durationMs: 200_000 + ISRC_DURATION_TOLERANCE_MS + 1 })],
      {
        status: 'needs_review',
        pick: 'a',
        method: 'isrc',
        warning: 'low_confidence',
        reasons: ['isrc', 'isrc_duration_mismatch'],
      },
    ],
    [
      'duplicate ISRCs: the one with the matching explicit flag wins',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: ISRC, explicit: true }), cand('b', { isrc: ISRC, album: 'Hits' })],
      { status: 'matched', pick: 'b', method: 'isrc' },
    ],
    [
      'duplicate ISRCs: the closer duration wins',
      rec({ isrc: ISRC }),
      [
        cand('a', { isrc: ISRC, durationMs: 206_000 }),
        cand('b', { isrc: ISRC, durationMs: 201_000 }),
      ],
      { status: 'matched', pick: 'b', method: 'isrc' },
    ],
    [
      'duplicate ISRCs with identical data: the lower id wins',
      rec({ isrc: ISRC }),
      [cand('z', { isrc: ISRC }), cand('m', { isrc: ISRC })],
      { status: 'matched', pick: 'm', method: 'isrc' },
    ],
    [
      'a different ISRC falls back to scoring',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: 'USRC17607839' })],
      { status: 'matched', pick: 'a', method: 'score' },
    ],
    [
      'a missing ISRC on the recording falls back to scoring',
      rec({ isrc: null }),
      [cand('a', { isrc: ISRC })],
      { status: 'matched', pick: 'a', method: 'score' },
    ],
    [
      'a missing ISRC on the candidate falls back to scoring',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: null })],
      { status: 'matched', pick: 'a', method: 'score' },
    ],
    [
      'a malformed candidate ISRC is ignored',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: 'GBAYE000035' })],
      { status: 'matched', pick: 'a', method: 'score' },
    ],
    [
      'a different ISRC does not rescue another version',
      rec({ isrc: ISRC }),
      [cand('a', { isrc: 'USRC17607839', title: 'Yellow Light (Live)' })],
      { status: 'unavailable', reasons: ['version_mismatch'] },
    ],
  ];

  it.each(rows)('%s', (_name, recording, candidates, want) => {
    check(recording, candidates, want);
  });
});

describe('durations', () => {
  // Everything else is perfect: title 40 + artist 25 + album 5 + explicit 5 + version 5 = 80.
  it.each([
    [0, 20, 'matched'],
    [1_999, 20, 'matched'],
    [2_000, 20, 'matched'],
    [2_001, 14, 'matched'],
    [5_000, 14, 'matched'],
    [5_001, 6, 'needs_review'],
    [10_000, 6, 'needs_review'],
    [10_001, 0, 'needs_review'],
    [60_000, 0, 'needs_review'],
  ] as const)('%d ms apart scores %d duration points → %s', (delta, points, status) => {
    for (const sign of [1, -1]) {
      const candidate = cand('a', { durationMs: base.durationMs + sign * delta });
      expect(scoreCandidate(base, candidate).breakdown.duration).toBe(points);
      expect(scoreCandidate(base, candidate).durationDeltaMs).toBe(delta);
      check(base, [candidate], { status, pick: 'a', confidence: 80 + points });
    }
  });

  it.each([
    ['the recording', rec({ durationMs: 0 }), cand('a')],
    ['the candidate', base, cand('a', { durationMs: 0 })],
  ])('an unknown duration on %s scores a neutral 10', (_name, recording, candidate) => {
    const scored = scoreCandidate(recording, candidate);
    expect(scored.breakdown.duration).toBe(10);
    expect(scored.durationDeltaMs).toBeNull();
    check(recording, [candidate], { status: 'matched', confidence: 90 });
  });
});

describe('explicit and clean', () => {
  const rows: Row[] = [
    [
      'both clean match',
      rec({ explicit: false }),
      [cand('a', { explicit: false })],
      { status: 'matched', pick: 'a' },
    ],
    [
      'both explicit match',
      rec({ explicit: true }),
      [cand('a', { explicit: true })],
      { status: 'matched', pick: 'a' },
    ],
    [
      'an explicit recording and a clean track never match automatically',
      rec({ explicit: true }),
      [cand('a', { explicit: false })],
      {
        status: 'needs_review',
        pick: 'a',
        warning: 'explicit_conflict',
        reasons: ['explicit_conflict'],
      },
    ],
    [
      'a clean recording and an explicit track never match automatically',
      rec({ explicit: false }),
      [cand('a', { explicit: true })],
      { status: 'needs_review', pick: 'a', warning: 'explicit_conflict' },
    ],
    [
      'a "(Clean)" title counts as clean even if flagged explicit',
      rec({ explicit: true }),
      [cand('a', { title: 'Yellow Light (Clean)', explicit: true })],
      { status: 'needs_review', pick: 'a', warning: 'explicit_conflict' },
    ],
    [
      'a "(Clean)" title matches a clean recording',
      rec({ explicit: false }),
      [cand('a', { title: 'Yellow Light (Clean)' })],
      { status: 'matched', pick: 'a' },
    ],
    [
      'a clean-tagged recording matches a clean track',
      rec({ explicit: true, versionTags: ['clean'] }),
      [cand('a', { explicit: false })],
      { status: 'matched', pick: 'a' },
    ],
    [
      'with both versions available, the matching one wins automatically',
      rec({ explicit: true }),
      [cand('clean', { explicit: false }), cand('explicit', { explicit: true })],
      { status: 'matched', pick: 'explicit' },
    ],
    [
      'the other version never counts against the lead',
      rec({ explicit: false }),
      [cand('explicit', { explicit: true }), cand('clean')],
      { status: 'matched', pick: 'clean' },
    ],
    [
      'a weak same-status candidate is preferred over a strong conflicting one',
      rec({ explicit: true }),
      [
        cand('clean', { explicit: false }),
        cand('weak', { explicit: true, album: 'Other', durationMs: 207_000 }),
      ],
      { status: 'needs_review', pick: 'weak', warning: 'low_confidence' },
    ],
    [
      'a conflicting candidate that is not close is not kept',
      rec({ explicit: true }),
      [
        cand('a', {
          explicit: false,
          title: 'Something Else',
          artists: ['Other'],
          durationMs: 90_000,
        }),
      ],
      { status: 'unavailable', pick: null },
    ],
  ];

  it.each(rows)('%s', (_name, recording, candidates, want) => {
    check(recording, candidates, want);
  });
});

describe('version tokens', () => {
  const versioned: [string, string][] = [
    ['live', 'Yellow Light (Live)'],
    ['live', 'Yellow Light - Live at Wembley 1986'],
    ['live', 'Yellow Light [Live in Concert]'],
    ['remix', 'Yellow Light (Club Remix)'],
    ['remix', 'Yellow Light - Remixed'],
    ['acoustic', 'Yellow Light (Acoustic Version)'],
    ['acoustic', 'Yellow Light - Unplugged'],
    ['instrumental', 'Yellow Light (Instrumental)'],
    ['sped_up', 'Yellow Light (Sped Up)'],
    ['sped_up', 'Yellow Light - Nightcore'],
    ['slowed', 'Yellow Light (Slowed + Reverb)'],
    ['remastered', 'Yellow Light - 2011 Remaster'],
    ['remastered', 'Yellow Light (Remastered 2009)'],
    ['radio_edit', 'Yellow Light (Radio Edit)'],
    ['extended', 'Yellow Light (Extended Mix)'],
    ['demo', 'Yellow Light (Demo)'],
    ['karaoke', 'Yellow Light (Karaoke Version)'],
    ['a_cappella', 'Yellow Light (A Cappella)'],
  ];

  it.each(versioned)('a %s version (%s) is a different recording without an ISRC', (_m, title) => {
    const result = check(base, [cand('a', { title })], {
      status: 'unavailable',
      pick: null,
      reasons: ['version_mismatch'],
    });
    expect(result.ranked[0]).toMatchObject({ versionMismatch: true });
  });

  it.each(versioned)(
    'a %s version (%s) is matched when the recording is that version',
    (marker, title) => {
      check(rec({ versionTags: [marker] }), [cand('a', { title })], {
        status: 'matched',
        pick: 'a',
      });
    },
  );

  it.each(versioned)('the plain recording is not matched to a %s version (%s)', (_m, title) => {
    check(rec({ title }), [cand('a')], { status: 'unavailable', reasons: ['version_mismatch'] });
  });

  it.each([
    ['"(Live)" and "- Live"', 'Yellow Light (Live)', 'Yellow Light - Live'],
    ['brackets and parentheses', 'Yellow Light [Remastered]', 'Yellow Light (2011 Remaster)'],
    ['marker order', 'Yellow Light (Live) [Acoustic]', 'Yellow Light (Acoustic) - Live'],
  ])('the same markers written differently match: %s', (_name, recordingTitle, trackTitle) => {
    check(rec({ title: recordingTitle }), [cand('a', { title: trackTitle })], {
      status: 'matched',
      pick: 'a',
    });
  });

  it.each([
    ['Live Forever'],
    ['Remix to Ignition'],
    ['Slowed Down'],
    ['Demo Tape Blues'],
    ['Clean Getaway'],
    ['Acoustic Soul'],
  ])('a marker word that is part of the title (%s) is not a version', (title) => {
    check(rec({ title }), [cand('a', { title })], { status: 'matched', pick: 'a' });
  });

  it('a live and a studio track: the studio one wins automatically', () => {
    check(base, [cand('live', { title: 'Yellow Light (Live)' }), cand('studio')], {
      status: 'matched',
      pick: 'studio',
    });
  });

  it('a live remix is not a live version', () => {
    check(rec({ versionTags: ['live'] }), [cand('a', { title: 'Yellow Light (Live Remix)' })], {
      status: 'unavailable',
    });
  });

  it('lists the other versions for "Wrong version?"', () => {
    const result = run(base, [
      cand('remix', { title: 'Yellow Light (Remix)' }),
      cand('live', { title: 'Yellow Light (Live)' }),
    ]);
    expect(result.status).toBe('unavailable');
    expect(result.ranked.map((c) => c.track.providerTrackId).sort()).toEqual(['live', 'remix']);
  });
});

describe('normalization', () => {
  const rows: [string, Partial<CanonicalRecording>, Partial<ProviderTrack>][] = [
    ['case', { title: 'Yellow Light' }, { title: 'YELLOW LIGHT' }],
    ['punctuation', { title: 'Yellow Light!' }, { title: 'Yellow... Light' }],
    ['curly and straight apostrophes', { title: 'Don’t Stop' }, { title: "Don't Stop" }],
    ['a dropped apostrophe', { title: "Don't Stop" }, { title: 'Dont Stop' }],
    [
      'accents',
      { title: 'Café del Mar', primaryArtist: 'Beyoncé', artists: ['Beyoncé'] },
      { title: 'Cafe Del Mar', artists: ['Beyonce'] },
    ],
    ['umlauts', { primaryArtist: 'Motörhead', artists: ['Motörhead'] }, { artists: ['Motorhead'] }],
    ['ß', { title: 'Straße' }, { title: 'Strasse' }],
    ['ø', { primaryArtist: 'Røyksopp', artists: ['Røyksopp'] }, { artists: ['Royksopp'] }],
    [
      '& and "and"',
      { primaryArtist: 'Simon & Garfunkel', artists: ['Simon & Garfunkel'] },
      { artists: ['Simon and Garfunkel'] },
    ],
    ['+ and "and"', { title: 'Salt + Light' }, { title: 'Salt and Light' }],
    [
      '"feat." in the title vs a credit',
      { title: 'Yellow Light (feat. Ivy Lane)' },
      { artists: ['Nova Harbor', 'Ivy Lane'] },
    ],
    [
      '"ft." vs "featuring"',
      { title: 'Yellow Light (ft. Ivy Lane)' },
      { title: 'Yellow Light (featuring Ivy Lane)' },
    ],
    ['unbracketed "feat."', { title: 'Yellow Light feat. Ivy Lane' }, { title: 'Yellow Light' }],
    [
      '"(with X)" when X is credited',
      { title: 'Yellow Light (with Ivy Lane)', artists: ['Nova Harbor', 'Ivy Lane'] },
      { title: 'Yellow Light', artists: ['Nova Harbor', 'Ivy Lane'] },
    ],
    [
      'one credit vs a list',
      { artists: ['Nova Harbor & Ivy Lane'] },
      { artists: ['Nova Harbor', 'Ivy Lane'] },
    ],
    ['extra spaces', { title: '  Yellow   Light ' }, { title: 'Yellow Light' }],
    [
      'Japanese',
      { title: '東京の夜', primaryArtist: '星野', artists: ['星野'] },
      { title: '東京の夜', artists: ['星野'] },
    ],
    ['full-width letters', { title: 'ＹＥＬＬＯＷ Light' }, { title: 'Yellow Light' }],
    ['an album edition', { album: 'Coastlines (Deluxe Edition)' }, { album: 'Coastlines' }],
    ['an Apple single suffix', { album: 'Yellow Light - Single' }, { album: 'Yellow Light' }],
  ];

  it.each(rows)('ignores %s', (_name, recordingChanges, trackChanges) => {
    const result = check(rec(recordingChanges), [cand('a', { ...trackChanges })], {
      status: 'matched',
      pick: 'a',
    });
    if (!trackChanges.album && !recordingChanges.album) {
      expect(result.match.confidence).toBe(100);
    }
  });

  it('keeps "(With Me)" as part of a title when "Me" is not an artist', () => {
    check(rec({ title: 'Stay (With Me)' }), [cand('a', { title: 'Stay' })], {
      status: 'needs_review',
      warning: 'low_confidence',
    });
  });

  it('a title in another script never matches automatically', () => {
    const result = check(rec({ title: '東京の夜' }), [cand('a', { title: 'Tokyo no Yoru' })], {
      status: 'needs_review',
      warning: 'low_confidence',
    });
    expect(result.ranked[0].breakdown.title).toBe(0);
  });
});

describe('artists', () => {
  it('a credited artist who is not first scores 20 of 25', () => {
    const scored = scoreCandidate(base, cand('a', { artists: ['Ivy Lane', 'Nova Harbor'] }));
    expect(scored.breakdown.artist).toBe(20);
  });

  it('the same title by another artist is not the recording', () => {
    const result = check(
      rec({
        title: 'Hello',
        primaryArtist: 'Adele',
        artists: ['Adele'],
        album: '25',
        durationMs: 295_000,
      }),
      [
        cand('a', {
          title: 'Hello',
          artists: ['Lionel Richie'],
          album: "Can't Slow Down",
          durationMs: 251_000,
        }),
      ],
      { status: 'unavailable' },
    );
    expect(result.ranked[0].breakdown.artist).toBeLessThan(15);
  });

  it('a cover by another artist is never chosen, even with everything else equal', () => {
    const result = check(base, [cand('a', { artists: ['Some Cover Band'] })], {
      status: 'unavailable',
      reasons: ['artist_mismatch'],
    });
    expect(result.ranked[0]).toMatchObject({ artistMismatch: true });
  });

  it('a slightly different spelling of the artist is still the artist', () => {
    const scored = scoreCandidate(base, cand('a', { artists: ['Nova Harbour'] }));
    expect(scored.artistMismatch).toBe(false);
    expect(scored.breakdown.artist).toBeGreaterThanOrEqual(10);
  });

  it('the right artist wins over a cover', () => {
    check(base, [cand('cover', { artists: ['Some Cover Band'] }), cand('original')], {
      status: 'matched',
      pick: 'original',
    });
  });
});

describe('threshold and lead', () => {
  it(`exactly ${MATCH_THRESHOLD} matches automatically`, () => {
    check(rec({ durationMs: 0 }), [cand('a')], { status: 'matched', confidence: 90 });
  });

  it(`${MATCH_THRESHOLD - 1} needs review`, () => {
    // Duration 3 s off (14) and another album (0): 40 + 25 + 14 + 0 + 5 + 5.
    check(base, [cand('a', { durationMs: 203_000, album: 'Other' })], {
      status: 'needs_review',
      confidence: 89,
      reasons: ['below_threshold'],
    });
  });

  it(`a lead of exactly ${MIN_LEAD} matches`, () => {
    check(base, [cand('best'), cand('next', { album: 'Other' })], {
      status: 'matched',
      pick: 'best',
      confidence: 100,
    });
  });

  it(`a lead of ${MIN_LEAD - 1} or less needs review`, () => {
    // 100 vs 98 (unknown album scores 3 of 5).
    check(base, [cand('best'), cand('next', { album: null })], {
      status: 'needs_review',
      pick: 'best',
      warning: 'low_confidence',
      reasons: ['no_clear_lead'],
    });
  });

  it('a tie needs review, choosing the lower id', () => {
    check(base, [cand('b'), cand('a')], {
      status: 'needs_review',
      pick: 'a',
      reasons: ['no_clear_lead'],
    });
  });

  it('below the threshold and without a lead reports both', () => {
    check(
      base,
      [
        cand('a', { album: 'X', durationMs: 204_000 }),
        cand('b', { album: 'Y', durationMs: 204_000 }),
      ],
      {
        status: 'needs_review',
        reasons: ['below_threshold', 'no_clear_lead'],
      },
    );
  });

  it(`a best score of ${MIN_SCORE} is kept with a warning`, () => {
    // title 0 + artist 25 + duration 20 + album 0 + explicit 5 + version 5 = 55.
    const result = run(base, [cand('a', { title: 'Zzzz', album: 'Other' })]);
    expect(result.ranked[0].score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(result.status).toBe('needs_review');
  });

  it(`below ${MIN_SCORE} nothing is kept`, () => {
    // title 0 + artist 25 + duration 0 + album 0 + explicit 5 + version 5 = 35.
    const result = run(base, [cand('a', { title: 'Zzzz', album: 'Other', durationMs: 100_000 })]);
    expect(result.ranked[0].score).toBeLessThan(MIN_SCORE);
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['below_threshold'] });
  });
});

describe('unavailable', () => {
  it.each([
    ['no candidates', [] as ProviderTrack[], ['no_candidates']],
    ['only another provider’s tracks', [cand('a', { provider: 'apple_music' })], ['no_candidates']],
    ['only other versions', [cand('a', { title: 'Yellow Light (Live)' })], ['version_mismatch']],
    [
      'only unrelated songs',
      [cand('a', { title: 'Qqq', artists: ['Zzz'], durationMs: 5_000 })],
      ['artist_mismatch'],
    ],
    [
      'only weak matches by the right artist',
      [cand('a', { title: 'Qqq', durationMs: 5_000, album: 'Other' })],
      ['below_threshold'],
    ],
  ])('with %s', (_name, candidates, reasons) => {
    check(base, candidates, { status: 'unavailable', pick: null, reasons });
  });
});

describe('overrides', () => {
  it.each([
    ['no candidates', []],
    ['an exact ISRC for another track', [cand('isrc', { isrc: ISRC })]],
    ['a perfect score for another track', [cand('perfect')]],
  ])('the host override wins over %s', (_name, candidates) => {
    const result = matchRecording(rec({ isrc: ISRC }), candidates, {
      provider: 'spotify',
      overrideTrackId: 'chosen',
    });
    expectConsistent(result);
    expect(result.match).toMatchObject({
      providerTrackId: 'chosen',
      method: 'override',
      confidence: 100,
      warning: null,
    });
  });

  it('returns the overridden track when it is among the candidates', () => {
    const chosen = cand('chosen', { title: 'Yellow Light (Live)' });
    const result = matchRecording(base, [cand('studio'), chosen], {
      provider: 'spotify',
      overrideTrackId: 'chosen',
    });
    expect(result.track).toEqual(chosen);
  });

  it('ignores an empty override', () => {
    const result = matchRecording(base, [cand('a')], {
      provider: 'spotify',
      overrideTrackId: null,
    });
    expect(result.match.method).toBe('score');
  });
});

describe('determinism', () => {
  const candidates = [
    cand('d', { album: 'Hits' }),
    cand('b'),
    cand('c', { title: 'Yellow Light (Live)' }),
    cand('a', { explicit: true }),
    cand('e', { durationMs: 204_000 }),
  ];

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
        item,
        ...rest,
      ]),
    );
  }

  it('gives the same result for every order of the candidates (120 orders)', () => {
    const expected = run(base, candidates);
    for (const order of permutations(candidates)) {
      expect(run(base, order)).toEqual(expected);
    }
  });

  it('ranks the same way every time, best first', () => {
    expect(run(base, candidates).ranked.map((c) => c.track.providerTrackId)).toEqual([
      'b',
      'd',
      'e',
      'c',
      'a',
    ]);
  });

  it('counts a duplicated provider track id once', () => {
    const result = run(base, [cand('a'), cand('a'), cand('b', { album: 'Other' })]);
    expect(result.ranked.map((c) => c.track.providerTrackId)).toEqual(['a', 'b']);
    expect(result.status).toBe('matched');
  });

  it('keeps the better copy when one id comes with different data', () => {
    const result = run(base, [cand('a', { album: 'Other' }), cand('a')]);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].score).toBe(100);
  });

  it('ignores the other provider’s candidates', () => {
    const apple = cand('apple', { provider: 'apple_music' });
    expect(run(base, [cand('a'), apple])).toEqual(run(base, [cand('a')]));
    expect(run(base, [cand('a'), apple], 'apple_music').match.providerTrackId).toBe('apple');
  });

  it('does not change its inputs', () => {
    const recording = rec({ versionTags: ['live'] });
    const input = [cand('a', { title: 'Yellow Light (Live)' }), cand('b')];
    const before = JSON.stringify([recording, input]);
    run(recording, input);
    expect(JSON.stringify([recording, input])).toBe(before);
  });

  it('repeated calls agree', () => {
    expect(run(base, candidates)).toEqual(run(base, candidates));
  });
});
