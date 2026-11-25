import { availabilityOf, canPlayOnHostPhone, type TrackAvailability } from './availability';
import type { TrackMatch } from './recording';

const base: TrackMatch = {
  recordingId: '00000000-0000-4000-8000-000000000001',
  provider: 'spotify',
  providerTrackId: 'sp-1',
  confidence: 100,
  method: 'score',
  warning: null,
};

describe('availabilityOf', () => {
  it.each<[string, TrackMatch | null | undefined, TrackAvailability]>([
    ['no stored match', undefined, { kind: 'unknown' }],
    ['a null match', null, { kind: 'unknown' }],
    ['an automatic score match', base, { kind: 'playable', confidence: 100 }],
    [
      'an ISRC match',
      { ...base, method: 'isrc', confidence: 100 },
      { kind: 'playable', confidence: 100 },
    ],
    [
      'a low-confidence match',
      { ...base, confidence: 81, warning: 'low_confidence' },
      { kind: 'uncertain', warning: 'low_confidence', confidence: 81 },
    ],
    [
      'an explicit/clean conflict, even with a high score',
      { ...base, confidence: 95, warning: 'explicit_conflict' },
      { kind: 'uncertain', warning: 'explicit_conflict', confidence: 95 },
    ],
    [
      'an ISRC match with a suspicious duration',
      { ...base, method: 'isrc', confidence: 89, warning: 'low_confidence' },
      { kind: 'uncertain', warning: 'low_confidence', confidence: 89 },
    ],
    [
      'no track on the service',
      { ...base, providerTrackId: null, confidence: 0 },
      { kind: 'unavailable' },
    ],
    [
      'no track on the service, whatever the warning says',
      { ...base, providerTrackId: null, confidence: 0, warning: 'low_confidence' },
      { kind: 'unavailable' },
    ],
    [
      'the host’s "Wrong version?" choice',
      { ...base, method: 'override', confidence: 100 },
      { kind: 'playable', confidence: 100 },
    ],
    [
      'an override that somehow carries a warning',
      { ...base, method: 'override', confidence: 100, warning: 'low_confidence' },
      { kind: 'playable', confidence: 100 },
    ],
  ])('%s', (_name, match, expected) => {
    expect(availabilityOf(match)).toEqual(expected);
  });
});

describe('canPlayOnHostPhone', () => {
  it('plays automatic and uncertain matches, never missing or unresolved ones', () => {
    expect(canPlayOnHostPhone({ kind: 'playable', confidence: 100 })).toBe(true);
    expect(
      canPlayOnHostPhone({ kind: 'uncertain', warning: 'low_confidence', confidence: 60 }),
    ).toBe(true);
    expect(canPlayOnHostPhone({ kind: 'unavailable' })).toBe(false);
    expect(canPlayOnHostPhone({ kind: 'unknown' })).toBe(false);
  });
});
