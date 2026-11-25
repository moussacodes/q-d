import type { CatalogResult } from '@/providers';
import { mockQueue } from '@/providers/mock/data';

import {
  availabilityLabel,
  entryAvailability,
  entryNote,
  queueNote,
  resultAvailability,
} from './availability';

const result = (overrides: Partial<CatalogResult>): CatalogResult => ({
  track: {
    provider: 'apple_music',
    providerTrackId: 'x',
    title: 'X',
    artists: ['Y'],
    album: null,
    durationMs: 1000,
    isrc: null,
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
  },
  availableOn: ['apple_music', 'spotify'],
  ...overrides,
});

const byTitle = (title: string) => mockQueue.find((t) => t.title === title)!;

describe('entryAvailability', () => {
  it('reads the match for the service the room plays through', () => {
    expect(entryAvailability(byTitle('Phantom'), 'spotify').kind).toBe('unavailable');
    expect(entryAvailability(byTitle('Phantom'), 'apple_music').kind).toBe('playable');
    expect(entryAvailability({}, 'spotify').kind).toBe('unknown');
  });
});

describe('resultAvailability', () => {
  it('falls back on the catalog’s services when no match is stored yet', () => {
    expect(resultAvailability(result({}), 'spotify').kind).toBe('unknown');
    expect(resultAvailability(result({ availableOn: ['apple_music'] }), 'spotify').kind).toBe(
      'unavailable',
    );
  });

  it('prefers the stored match', () => {
    const found = result({ matches: byTitle('Way Bigger').matches });
    expect(resultAvailability(found, 'spotify')).toMatchObject({
      kind: 'uncertain',
      warning: 'low_confidence',
    });
  });
});

describe('copy', () => {
  it('labels each availability for search results', () => {
    expect(availabilityLabel({ kind: 'playable', confidence: 100 }, 'spotify')).toBe('On Spotify');
    expect(availabilityLabel({ kind: 'unknown' }, 'apple_music')).toBe('On Apple Music');
    expect(availabilityLabel({ kind: 'unavailable' }, 'spotify')).toBe('Not on Spotify');
    expect(
      availabilityLabel(
        { kind: 'uncertain', warning: 'low_confidence', confidence: 81 },
        'spotify',
      ),
    ).toBe('Closest match on Spotify · may be another version');
    expect(
      availabilityLabel(
        { kind: 'uncertain', warning: 'explicit_conflict', confidence: 95 },
        'apple_music',
      ),
    ).toBe('Explicit/clean version differs on Apple Music');
  });

  it('notes only queued songs that won’t play as found', () => {
    expect(queueNote({ kind: 'playable', confidence: 100 }, 'spotify')).toBeUndefined();
    expect(queueNote({ kind: 'unknown' }, 'spotify')).toBeUndefined();
    expect(queueNote({ kind: 'unavailable' }, 'spotify')).toBe(
      'Not on Spotify · the host can skip it',
    );
    expect(
      queueNote({ kind: 'uncertain', warning: 'low_confidence', confidence: 81 }, 'spotify'),
    ).toBe('May be another version on Spotify');
    expect(
      queueNote({ kind: 'uncertain', warning: 'explicit_conflict', confidence: 95 }, 'spotify'),
    ).toBe('Explicit/clean version differs on Spotify');
  });
});

describe('entryNote', () => {
  const recordingId = '00000000-0000-4000-8000-000000000001';
  const match = (method: 'score' | 'override', warning: 'low_confidence' | null) => ({
    recordingId,
    provider: 'spotify' as const,
    providerTrackId: 'sp-1',
    confidence: method === 'override' ? 100 : 81,
    method,
    warning,
  });

  it('says the host picked the version, for an override', () => {
    expect(entryNote({ matches: { spotify: match('override', null) } }, 'spotify')).toBe(
      'Version picked by the host',
    );
  });

  it('otherwise is the queue note', () => {
    expect(entryNote({ matches: { spotify: match('score', 'low_confidence') } }, 'spotify')).toBe(
      'May be another version on Spotify',
    );
    expect(entryNote({ matches: { spotify: match('score', null) } }, 'spotify')).toBeUndefined();
    expect(entryNote({}, 'spotify')).toBeUndefined();
  });

  it('reads only the room’s service: an override on another service doesn’t count', () => {
    expect(
      entryNote(
        { matches: { apple_music: { ...match('override', null), provider: 'apple_music' } } },
        'spotify',
      ),
    ).toBeUndefined();
  });
});
