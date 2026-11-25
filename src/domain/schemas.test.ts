import type { z } from 'zod';

import {
  playbackCapabilitiesSchema,
  playbackSlotSchema,
  playbackStateSchema,
  type PlaybackSlot,
  type PlaybackState,
  type ProviderCapabilities,
} from './playback';
import { isrcSchema, millisecondsSchema, timestampSchema, versionTagSchema } from './primitives';
import {
  playlistImportBatchSchema,
  queueEntrySchema,
  type PlaylistImportBatch,
  type QueueEntry,
} from './queue';
import {
  canonicalRecordingSchema,
  providerTrackSchema,
  trackMatchSchema,
  type CanonicalRecording,
  type ProviderTrack,
  type TrackMatch,
} from './recording';
import { roomCodeSchema, roomMemberSchema, roomSchema, type Room, type RoomMember } from './room';

const ID = {
  room: '6f1c1f3e-1b7a-4c8e-9d2f-0a1b2c3d4e5f',
  host: '0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70',
  guest: '11111111-2222-4333-8444-555555555555',
  recording: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  entry: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  batch: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
};
const AT = '2026-11-24T18:30:00.000Z';

const room = {
  id: ID.room,
  name: 'Friday night',
  hostId: ID.host,
  mode: 'aux',
  state: 'live',
  playbackProvider: 'spotify',
  code: '7K4F9X',
  codeExpiresAt: '2026-11-25T18:30:00+00:00',
  createdAt: AT,
  endedAt: null,
} satisfies Room;

const member = {
  roomId: ID.room,
  userId: ID.guest,
  role: 'member',
  displayName: 'Maya',
  color: '#f2a27c',
  joinedAt: AT,
} satisfies RoomMember;

const recording = {
  id: ID.recording,
  title: 'Rain Down',
  primaryArtist: 'Delerium',
  artists: ['Delerium', 'Sarah McLachlan'],
  album: 'Karma',
  durationMs: 225_000,
  isrc: 'CAA019700123',
  explicit: false,
  versionTags: [],
} satisfies CanonicalRecording;

const track = {
  provider: 'apple_music',
  providerTrackId: '1440857781',
  title: 'Rain Down',
  artists: ['Delerium', 'Sarah McLachlan'],
  durationMs: 225_400,
  isrc: 'CAA019700123',
  explicit: false,
  artworkUrl: null,
  artworkBackgroundColor: '1a1a2e',
} satisfies ProviderTrack;

const match = {
  recordingId: ID.recording,
  provider: 'spotify',
  providerTrackId: '4uLU6hMCjMI75M1A2tKUQC',
  confidence: 100,
  method: 'isrc',
  warning: null,
} satisfies TrackMatch;

const entry = {
  id: ID.entry,
  roomId: ID.room,
  recordingId: ID.recording,
  position: 3,
  addedBy: ID.guest,
  batchId: null,
  status: 'queued',
  addedAt: AT,
} satisfies QueueEntry;

const batch = {
  id: ID.batch,
  roomId: ID.room,
  provider: 'apple_music',
  sourceName: 'Road trip',
  itemCount: 50,
  addedCount: 47,
  skippedCount: 3,
  status: 'done',
} satisfies PlaylistImportBatch;

const playback = {
  roomId: ID.room,
  entryId: ID.entry,
  status: 'playing',
  positionMs: 100_000,
  reportedAt: AT,
} satisfies PlaybackState;

const slot = {
  roomId: ID.room,
  slot: 1,
  userId: ID.host,
  provider: 'apple_music',
  readiness: 'ready',
} satisfies PlaybackSlot;

const capabilities = {
  inAppAudio: false,
  backgroundPlayback: false,
  requiresExternalApp: true,
  autoplay: true,
  isMock: false,
} satisfies ProviderCapabilities;

type Case = {
  name: string;
  schema: z.ZodType;
  valid: Record<string, unknown>;
  /** [description, fields to override] that must fail. */
  invalid: [string, Record<string, unknown>][];
  /** Other variants that must parse. */
  alsoValid?: [string, Record<string, unknown>][];
};

const cases: Case[] = [
  {
    name: 'Room',
    schema: roomSchema,
    valid: room,
    alsoValid: [
      ['sync mode is modeled', { mode: 'sync' }],
      ['an ended room', { state: 'ended', endedAt: AT }],
      ['Apple Music playback', { playbackProvider: 'apple_music' }],
    ],
    invalid: [
      ['an unknown mode', { mode: 'party' }],
      ['an unknown state', { state: 'closed' }],
      ['a provider q’d does not support', { playbackProvider: 'youtube_music' }],
      ['a lowercase code', { code: '7k4f9x' }],
      ['a code with the QD- prefix', { code: 'QD-7K4F9X' }],
      ['a five-character code', { code: '7K4F9' }],
      ['a non-UUID id', { id: 'room-1' }],
      ['an empty name', { name: '' }],
      ['a date without a time', { createdAt: '2026-11-24' }],
      ['a missing endedAt', { endedAt: undefined }],
    ],
  },
  {
    name: 'RoomMember',
    schema: roomMemberSchema,
    valid: member,
    alsoValid: [['the host', { role: 'host', userId: ID.host }]],
    invalid: [
      ['an unknown role', { role: 'admin' }],
      ['an empty display name', { displayName: '' }],
      ['a non-UUID user', { userId: 'maya' }],
    ],
  },
  {
    name: 'CanonicalRecording',
    schema: canonicalRecordingSchema,
    valid: recording,
    alsoValid: [
      ['no ISRC and no album', { isrc: null, album: null }],
      ['version tags', { versionTags: ['live', 'sped_up'] }],
    ],
    invalid: [
      ['no artists', { artists: [] }],
      ['a fractional duration', { durationMs: 225_000.5 }],
      ['a negative duration', { durationMs: -1 }],
      ['a malformed ISRC', { isrc: 'CA-A01-97-00123' }],
      ['a lowercase ISRC', { isrc: 'caa019700123' }],
      ['a version tag with spaces', { versionTags: ['sped up'] }],
      ['an explicit flag as a string', { explicit: 'false' }],
    ],
  },
  {
    name: 'ProviderTrack',
    schema: providerTrackSchema,
    valid: track,
    alsoValid: [
      [
        'a Spotify track with no color',
        { provider: 'spotify', artworkBackgroundColor: null, isrc: null },
      ],
    ],
    invalid: [
      ['an empty provider id', { providerTrackId: '' }],
      ['an unknown provider', { provider: 'tidal' }],
      ['a missing artwork url', { artworkUrl: undefined }],
    ],
  },
  {
    name: 'TrackMatch',
    schema: trackMatchSchema,
    valid: match,
    alsoValid: [
      ['unavailable on the provider', { providerTrackId: null, confidence: 0, method: 'score' }],
      ['a low-confidence score', { method: 'score', confidence: 72, warning: 'low_confidence' }],
      ['an explicit conflict', { method: 'score', confidence: 95, warning: 'explicit_conflict' }],
      ['a host override', { method: 'override' }],
    ],
    invalid: [
      ['confidence over 100', { confidence: 101 }],
      ['negative confidence', { confidence: -1 }],
      ['an unknown method', { method: 'guess' }],
      ['an unknown warning', { warning: 'maybe' }],
      ['an empty provider id', { providerTrackId: '' }],
    ],
  },
  {
    name: 'QueueEntry',
    schema: queueEntrySchema,
    valid: entry,
    alsoValid: [
      ['an imported entry', { batchId: ID.batch }],
      ['an entry whose adder deleted their account', { addedBy: null }],
      ['a fractional position', { position: 2.5 }],
      ['every status', { status: 'played' }],
    ],
    invalid: [
      ['an unknown status', { status: 'skipped' }],
      ['a missing batchId', { batchId: undefined }],
      ['a non-numeric position', { position: '3' }],
    ],
  },
  {
    name: 'PlaylistImportBatch',
    schema: playlistImportBatchSchema,
    valid: batch,
    alsoValid: [['a preview with nothing added yet', { status: 'previewing', addedCount: 0 }]],
    invalid: [
      ['more added and skipped than items', { addedCount: 48 }],
      ['an unknown status', { status: 'paused' }],
      ['a negative count', { skippedCount: -1 }],
    ],
  },
  {
    name: 'PlaybackState',
    schema: playbackStateSchema,
    valid: playback,
    alsoValid: [
      ['nothing playing', { entryId: null, status: 'stopped', positionMs: 0 }],
      ['provider autoplay', { entryId: null, status: 'autoplay' }],
    ],
    invalid: [
      ['an unknown status', { status: 'buffering' }],
      ['a negative position', { positionMs: -5 }],
      ['a position in seconds', { positionMs: 1.5 }],
    ],
  },
  {
    name: 'PlaybackSlot',
    schema: playbackSlotSchema,
    valid: slot,
    alsoValid: [['the last slot', { slot: 15, readiness: 'sitting_out' }]],
    invalid: [
      ['slot 0', { slot: 0 }],
      ['slot 16 (over the 15-person cap)', { slot: 16 }],
      ['an unknown readiness', { readiness: 'waiting' }],
    ],
  },
  {
    name: 'PlaybackCapabilities',
    schema: playbackCapabilitiesSchema,
    valid: capabilities,
    invalid: [
      ['a missing isMock', { isMock: undefined }],
      ['a string flag', { inAppAudio: 'yes' }],
    ],
  },
];

describe.each(cases)('$name schema', ({ schema, valid, invalid, alsoValid = [] }) => {
  it('parses a valid value unchanged', () => {
    expect(schema.parse(valid)).toEqual(valid);
  });

  it('drops fields it does not know', () => {
    expect(schema.parse({ ...valid, email: 'someone@example.com' })).toEqual(valid);
  });

  it.each(['', null, undefined, [], 42])('rejects %p', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  if (alsoValid.length > 0) {
    it.each(alsoValid)('accepts %s', (_name, changes) => {
      expect(schema.safeParse({ ...valid, ...changes }).success).toBe(true);
    });
  }

  it.each(invalid)('rejects %s', (_name, changes) => {
    expect(schema.safeParse({ ...valid, ...changes }).success).toBe(false);
  });
});

describe('primitives', () => {
  it.each([
    ['2026-11-24T18:30:00Z', true],
    ['2026-11-24T18:30:00.123456+00:00', true],
    ['2026-11-24T13:30:00-05:00', true],
    ['2026-11-24 18:30:00', false],
    ['yesterday', false],
  ])('timestamp %s → %s', (value, ok) => {
    expect(timestampSchema.safeParse(value).success).toBe(ok);
  });

  it.each([
    [0, true],
    [225_000, true],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])('milliseconds %p → %s', (value, ok) => {
    expect(millisecondsSchema.safeParse(value).success).toBe(ok);
  });

  it.each([
    ['USRC17607839', true],
    ['GBAYE0000351', true],
    ['USRC1760783', false],
    ['US-RC1-76-07839', false],
    ['usrc17607839', false],
  ])('ISRC %s → %s', (value, ok) => {
    expect(isrcSchema.safeParse(value).success).toBe(ok);
  });

  it.each([
    ['live', true],
    ['sped_up', true],
    ['Live', false],
    ['sped-up', false],
    ['', false],
  ])('version tag %s → %s', (value, ok) => {
    expect(versionTagSchema.safeParse(value).success).toBe(ok);
  });

  it.each([
    ['7K4F9X', true],
    ['000000', true],
    ['7K4F9', false],
    ['7K4F9XX', false],
    ['7K4 F9', false],
  ])('room code %s → %s', (value, ok) => {
    expect(roomCodeSchema.safeParse(value).success).toBe(ok);
  });
});
