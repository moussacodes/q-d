import { availabilityOf, canPlayOnHostPhone } from './availability';
import { matchRecording } from './matching';
import {
  latestOverride,
  overriddenMatch,
  trackMatchOverrideSchema,
  type TrackMatchOverride,
} from './match-override';
import type { CanonicalRecording, ProviderTrack, TrackMatch } from './recording';

const recordingId = '00000000-0000-4000-8000-000000000001';
const otherRecording = '00000000-0000-4000-8000-000000000002';

const row = (overrides: Partial<TrackMatchOverride> = {}): TrackMatchOverride => ({
  id: '10000000-0000-4000-8000-000000000001',
  roomId: '20000000-0000-4000-8000-000000000001',
  recordingId,
  provider: 'spotify',
  providerTrackId: 'sp-radio-edit',
  createdBy: '30000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-25T20:00:00.000Z',
  ...overrides,
});

const uncertain: TrackMatch = {
  recordingId,
  provider: 'spotify',
  providerTrackId: 'sp-compilation',
  confidence: 81,
  method: 'score',
  warning: 'low_confidence',
};

describe('trackMatchOverrideSchema', () => {
  it('parses a row as the server sends it (offset timestamps included)', () => {
    const parsed = trackMatchOverrideSchema.parse(row({ createdAt: '2026-11-25T20:00:00+00:00' }));
    expect(parsed.providerTrackId).toBe('sp-radio-edit');
  });

  it('keeps an override whose host deleted their account', () => {
    expect(trackMatchOverrideSchema.safeParse(row({ createdBy: null })).success).toBe(true);
  });

  it.each([
    ['an empty track id', { providerTrackId: '' }],
    ['a track id over 200 characters', { providerTrackId: 'x'.repeat(201) }],
    ['a service q’d doesn’t support', { provider: 'tidal' }],
    ['a room id that isn’t a UUID', { roomId: 'QD-7K4F9X' }],
    ['a time without a zone', { createdAt: '2026-11-25 20:00' }],
  ])('rejects %s', (_label, bad) => {
    expect(trackMatchOverrideSchema.safeParse({ ...row(), ...bad }).success).toBe(false);
  });

  it('strips unknown fields', () => {
    const parsed = trackMatchOverrideSchema.parse({ ...row(), email: 'host@example.com' });
    expect(parsed).not.toHaveProperty('email');
  });
});

describe('latestOverride', () => {
  it('is null with no overrides, or none for this song and service', () => {
    expect(latestOverride([], recordingId, 'spotify')).toBeNull();
    expect(
      latestOverride(
        [row({ recordingId: otherRecording }), row({ provider: 'apple_music' })],
        recordingId,
        'spotify',
      ),
    ).toBeNull();
  });

  it('picks the newest, whatever order the rows come in', () => {
    const first = row({ id: '10000000-0000-4000-8000-00000000000a', providerTrackId: 'a' });
    const second = row({
      id: '10000000-0000-4000-8000-000000000001',
      providerTrackId: 'b',
      createdAt: '2026-11-25T20:05:00.000Z',
    });
    expect(latestOverride([first, second], recordingId, 'spotify')?.providerTrackId).toBe('b');
    expect(latestOverride([second, first], recordingId, 'spotify')?.providerTrackId).toBe('b');
  });

  it('compares times, not their text (an offset and Z for the same instant order correctly)', () => {
    const earlier = row({ providerTrackId: 'a', createdAt: '2026-11-25T21:00:00+02:00' });
    const later = row({
      id: '10000000-0000-4000-8000-000000000000',
      providerTrackId: 'b',
      createdAt: '2026-11-25T20:00:00.000Z',
    });
    expect(latestOverride([later, earlier], recordingId, 'spotify')?.providerTrackId).toBe('b');
  });

  it('breaks a tie on time by the larger id, like the server', () => {
    const low = row({ id: '10000000-0000-4000-8000-000000000001', providerTrackId: 'low' });
    const high = row({ id: '10000000-0000-4000-8000-0000000000ff', providerTrackId: 'high' });
    expect(latestOverride([high, low], recordingId, 'spotify')?.providerTrackId).toBe('high');
    expect(latestOverride([low, high], recordingId, 'spotify')?.providerTrackId).toBe('high');
  });

  it('orders to the microsecond, like Postgres (same millisecond, later microsecond wins)', () => {
    const earlier = row({
      id: '10000000-0000-4000-8000-0000000000ff',
      providerTrackId: 'earlier',
      createdAt: '2026-11-25T20:00:00.123456+00:00',
    });
    const later = row({
      id: '10000000-0000-4000-8000-000000000001',
      providerTrackId: 'later',
      createdAt: '2026-11-25T20:00:00.123457+00:00',
    });
    expect(latestOverride([earlier, later], recordingId, 'spotify')?.providerTrackId).toBe('later');
    expect(latestOverride([later, earlier], recordingId, 'spotify')?.providerTrackId).toBe('later');
  });

  it('reads fewer fraction digits as the same instant (.5 is .500000)', () => {
    const low = row({
      id: '10000000-0000-4000-8000-000000000001',
      providerTrackId: 'low',
      createdAt: '2026-11-25T20:00:00.5Z',
    });
    const high = row({
      id: '10000000-0000-4000-8000-0000000000ff',
      providerTrackId: 'high',
      createdAt: '2026-11-25T20:00:00.500000+00:00',
    });
    expect(latestOverride([high, low], recordingId, 'spotify')?.providerTrackId).toBe('high');
    expect(latestOverride([low, high], recordingId, 'spotify')?.providerTrackId).toBe('high');
  });

  it('treats the same instant written two ways as a tie', () => {
    const low = row({ id: '10000000-0000-4000-8000-000000000001', providerTrackId: 'low' });
    const high = row({
      id: '10000000-0000-4000-8000-0000000000ff',
      providerTrackId: 'high',
      createdAt: '2026-11-25T20:00:00+00:00',
    });
    expect(latestOverride([high, low], recordingId, 'spotify')?.providerTrackId).toBe('high');
  });
});

describe('overriddenMatch', () => {
  it('without an override, is the stored match (or null)', () => {
    expect(overriddenMatch(uncertain, null)).toBe(uncertain);
    expect(overriddenMatch(undefined, null)).toBeNull();
    expect(overriddenMatch(null, null)).toBeNull();
  });

  it('an override wins over a low-confidence match and plays with no warning', () => {
    const match = overriddenMatch(uncertain, row());
    expect(match).toEqual({
      recordingId,
      provider: 'spotify',
      providerTrackId: 'sp-radio-edit',
      confidence: 100,
      method: 'override',
      warning: null,
    });
    expect(availabilityOf(match)).toEqual({ kind: 'playable', confidence: 100 });
  });

  it('an override wins over an explicit/clean conflict', () => {
    const match = overriddenMatch({ ...uncertain, warning: 'explicit_conflict' }, row());
    expect(availabilityOf(match).kind).toBe('playable');
  });

  it('an override makes an unavailable or unresolved song playable', () => {
    const unavailable = { ...uncertain, providerTrackId: null, confidence: 0, warning: null };
    expect(canPlayOnHostPhone(availabilityOf(overriddenMatch(unavailable, row())))).toBe(true);
    expect(canPlayOnHostPhone(availabilityOf(overriddenMatch(undefined, row())))).toBe(true);
  });

  it('gives the same match the matcher stores for an override', () => {
    const recording: CanonicalRecording = {
      id: recordingId,
      title: 'Way Bigger',
      primaryArtist: 'Don Toliver',
      artists: ['Don Toliver'],
      album: 'Single',
      durationMs: 196_000,
      isrc: null,
      explicit: false,
      versionTags: [],
    };
    const candidate: ProviderTrack = {
      provider: 'spotify',
      providerTrackId: 'sp-radio-edit',
      title: 'Way Bigger - Radio Edit',
      artists: ['Don Toliver'],
      album: 'Single',
      durationMs: 180_000,
      isrc: null,
      explicit: false,
      artworkUrl: null,
      artworkBackgroundColor: null,
    };
    const { match } = matchRecording(recording, [candidate], {
      provider: 'spotify',
      overrideTrackId: 'sp-radio-edit',
    });
    expect(overriddenMatch(uncertain, row())).toEqual(match);
  });
});
