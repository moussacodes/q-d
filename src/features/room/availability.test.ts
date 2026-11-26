import type { CatalogResult } from '@/providers';
import { mockQueue } from '@/providers/mock/data';

import {
  availabilityLabel,
  entryAvailability,
  mayBeOn,
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
    // Not matched yet is neither "on" nor "not on" (live search knows only Apple Music).
    expect(availabilityLabel({ kind: 'unknown' }, 'apple_music')).toBe(
      'Apple Music version not matched yet',
    );
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

describe('live search results (only Apple Music checked)', () => {
  const live = (overrides: Partial<CatalogResult> = {}): CatalogResult => ({
    recordingId: 'c0000000-0000-4000-8000-00000000000a',
    track: {
      provider: 'apple_music',
      providerTrackId: '1440857781',
      title: 'Glass Harbor',
      artists: ['The Paper Lanterns'],
      album: 'Low Tide',
      durationMs: 201_000,
      isrc: null,
      explicit: false,
      artworkUrl: null,
      artworkBackgroundColor: null,
    },
    availableOn: ['apple_music'],
    checkedOn: ['apple_music'],
    ...overrides,
  });

  it('is unknown on Spotify until matched, never "Not on Spotify"', () => {
    const availability = resultAvailability(live(), 'spotify');
    expect(availability).toEqual({ kind: 'unknown' });
    expect(availabilityLabel(availability, 'spotify')).toBe('Spotify version not matched yet');
  });

  it('is on Apple Music, the catalog it came from', () => {
    expect(resultAvailability(live(), 'apple_music')).toEqual({
      kind: 'playable',
      confidence: 100,
    });
  });

  it('follows a stored match once there is one', () => {
    const notOnSpotify = live({
      matches: {
        spotify: {
          recordingId: 'c0000000-0000-4000-8000-00000000000a',
          provider: 'spotify',
          providerTrackId: null,
          confidence: 0,
          method: 'score',
          warning: null,
        },
      },
    });
    expect(resultAvailability(notOnSpotify, 'spotify')).toEqual({ kind: 'unavailable' });
  });

  it('keeps the mock catalog’s answers: a song it doesn’t list on a service is not on it', () => {
    expect(resultAvailability(live({ checkedOn: undefined }), 'spotify')).toEqual({
      kind: 'unavailable',
    });
  });

  it('shows an unchecked song under every filter chip, a ruled-out one only where it is', () => {
    expect(mayBeOn(live(), 'spotify')).toBe(true);
    expect(mayBeOn(live(), 'apple_music')).toBe(true);
    expect(mayBeOn(live({ checkedOn: undefined }), 'spotify')).toBe(false);
    expect(mayBeOn(live({ checkedOn: ['apple_music', 'spotify'] }), 'spotify')).toBe(false);
  });
});
