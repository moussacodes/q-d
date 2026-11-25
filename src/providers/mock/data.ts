import type { MusicProvider } from '@/domain/music-provider';
import type { TrackMatch } from '@/domain/recording';

import { mockMatches, type MockUncertainty } from './matches';

/**
 * Deterministic sample data for mock mode (see services/dataMode): rooms,
 * people and the mock catalog. The UI labels it as mock, so it is never
 * presented as live data. Supabase and the real adapters replace it.
 * Album art is intentionally absent (see docs/DECISIONS.md), so covers render
 * as placeholders.
 */

export type MockTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  /** The service the host's phone plays this song through. */
  provider: MusicProvider;
  addedBy: string;
  /**
   * The artwork background color Apple Music supplies with a song (sample
   * values chosen to match the Figma color modes). Only Apple-played songs
   * use it; Spotify supplies no usable color.
   */
  artworkColor: string;
  /** Set when the song is not on the host's service. */
  unavailableOn?: MusicProvider;
  /** Set when a service's closest track is kept with a warning (see `./matches`). */
  uncertainOn?: MockUncertainty;
  /**
   * The stored track match per service (`track_matches`), as the matcher
   * decides it for the fixture. Absent until a match is resolved.
   */
  matches?: Partial<Record<MusicProvider, TrackMatch>>;
};

export type MockPerson = {
  id: string;
  name: string;
  color: string;
  isHost?: boolean;
  /** Only the host needs a connected service in aux mode. */
  provider?: MusicProvider;
};

export type MockRoom = {
  code: string;
  name: string;
  hostName: string;
  youHost: boolean;
  people: MockPerson[];
  nowPlaying: MockTrack | null;
  queue: MockTrack[];
  /** "Today", "Friday"… */
  lastActive: string;
  playsThrough: MusicProvider;
};

export const mockUser = {
  /** Your entry in each room's `people`. */
  id: 'baron',
  name: 'Baron',
  email: 'baron@example.com',
  color: '#f2a27c',
  signedInWith: 'Apple',
};

export const avatarColors = ['#f2a27c', '#f6c9a5', '#e8c547', '#8fb4f0', '#e88fb4', '#8fe0b8'];

const people: MockPerson[] = [
  { id: 'baron', name: 'Baron', color: '#f2a27c', isHost: true, provider: 'spotify' },
  { id: 'maya', name: 'Maya', color: '#f6c9a5' },
  { id: 'jules', name: 'Jules', color: '#e8c547' },
  { id: 'priya', name: 'Priya', color: '#8fb4f0' },
  { id: 'theo', name: 'Theo', color: '#e88fb4' },
  { id: 'sam', name: 'Sam', color: '#8fe0b8' },
];

/** Some of the sample people, in a room `hostId` hosts through `provider`. */
const hostedBy = (hostId: string, provider: MusicProvider, ids: string[]): MockPerson[] =>
  people
    .filter((p) => ids.includes(p.id))
    .map((p) => ({
      ...p,
      isHost: p.id === hostId,
      provider: p.id === hostId ? provider : undefined,
    }));

const track = (
  t: Omit<MockTrack, 'artworkColor' | 'matches'> & { artworkColor?: string },
): MockTrack => ({
  artworkColor: '#c41e2a', // Figma "Son of Spergy" hue
  ...t,
  matches: mockMatches(t),
});

export const mockQueue: MockTrack[] = [
  track({
    id: 'q1',
    title: 'Lovers Rock',
    artist: 'TV Girl',
    album: 'French Exit',
    duration: '3:33',
    provider: 'spotify',
    addedBy: 'Jules',
    artworkColor: '#c2186f', // Figma "French Exit" hue
  }),
  track({
    id: 'q2',
    title: 'Always',
    artist: 'Daniel Caesar',
    album: 'Never Enough',
    duration: '3:45',
    provider: 'spotify',
    addedBy: 'Priya',
    artworkColor: '#1f3ac4', // Figma "Never Enough" hue
  }),
  track({
    id: 'q3',
    title: 'Phantom',
    artist: 'EsDeeKid, Rico Ace',
    album: 'Rebel',
    duration: '1:49',
    provider: 'spotify',
    addedBy: 'Theo',
    artworkColor: '#5a5a5a', // grey, like Figma "Rebel"
    unavailableOn: 'spotify',
  }),
  track({
    id: 'q4',
    title: '175 Months',
    artist: 'Dave',
    album: 'Single',
    duration: '4:37',
    provider: 'spotify',
    addedBy: 'Sam',
  }),
  track({
    id: 'q5',
    title: 'Way Bigger',
    artist: 'Don Toliver',
    album: 'Single',
    duration: '3:16',
    provider: 'spotify',
    addedBy: 'Maya',
    // Spotify's closest track is on another album and 7 s longer.
    uncertainOn: { provider: 'spotify', because: 'low_confidence' },
  }),
  track({
    id: 'q6',
    title: 'Butterflies',
    artist: 'Brent Faiyaz',
    album: 'Single',
    duration: '4:06',
    provider: 'spotify',
    addedBy: 'Jules',
  }),
  track({
    id: 'q7',
    title: 'Heartbreak Anniversary',
    artist: 'Giveon',
    album: 'Single',
    duration: '3:18',
    provider: 'spotify',
    addedBy: 'Baron',
  }),
];

export const mockNowPlaying = track({
  id: 'np',
  title: 'Have a Baby (With Me)',
  artist: 'Daniel Caesar',
  album: 'Son of Spergy',
  duration: '3:45',
  provider: 'spotify',
  addedBy: 'Maya',
});

export const mockRooms: MockRoom[] = [
  {
    code: 'QD-7K4F9X',
    name: 'Sunday Slow Burn',
    hostName: 'Baron',
    youHost: true,
    people,
    nowPlaying: mockNowPlaying,
    queue: mockQueue,
    lastActive: 'Today',
    playsThrough: 'spotify',
  },
  {
    code: 'QD-9M2XR4',
    name: 'Kitchen Disco',
    hostName: 'Jules',
    youHost: false,
    people: hostedBy(
      'jules',
      'spotify',
      people.map((p) => p.id),
    ),
    nowPlaying: track({
      id: 'kd',
      title: '175 Months',
      artist: 'Dave',
      album: 'Single',
      duration: '4:37',
      provider: 'spotify',
      addedBy: 'Jules',
    }),
    queue: mockQueue.slice(0, 4),
    lastActive: 'Friday',
    playsThrough: 'spotify',
  },
  {
    code: 'QD-3HV8PL',
    name: 'Late Drive Home',
    hostName: 'Priya',
    youHost: false,
    people: hostedBy('priya', 'apple_music', ['baron', 'maya', 'priya']),
    nowPlaying: null,
    queue: [],
    lastActive: 'Last week',
    playsThrough: 'apple_music',
  },
  {
    code: 'QD-T6W2NB',
    name: 'Study Hall',
    hostName: 'Theo',
    youHost: false,
    people: hostedBy('theo', 'apple_music', ['baron', 'maya', 'jules', 'theo']),
    nowPlaying: null,
    queue: [],
    lastActive: 'Oct 12',
    playsThrough: 'apple_music',
  },
];

export const findRoom = (code: string | undefined) =>
  mockRooms.find((room) => room.code === code) ?? mockRooms[0];

export const mockSearchResults = [
  { ...mockNowPlaying, status: 'playing' as const },
  { ...mockQueue[1], status: 'queued' as const },
  track({
    id: 's3',
    title: 'Rain Down',
    artist: 'Daniel Caesar, Sampha',
    album: 'Son of Spergy',
    duration: '3:07',
    provider: 'spotify',
    addedBy: '',
  }),
  track({
    id: 's4',
    title: 'Valentina',
    artist: 'Daniel Caesar',
    album: 'Never Enough',
    duration: '2:34',
    provider: 'spotify',
    addedBy: '',
    unavailableOn: 'spotify',
  }),
  track({
    id: 's5',
    title: 'Ocho Rios',
    artist: 'Daniel Caesar',
    album: 'Never Enough',
    duration: '2:33',
    provider: 'spotify',
    addedBy: '',
    // Spotify only has the explicit version of this clean recording.
    uncertainOn: { provider: 'spotify', because: 'explicit_conflict' },
  }),
  track({
    id: 's6',
    title: 'Moon',
    artist: 'Daniel Caesar, Bon Iver',
    album: 'Son of Spergy',
    duration: '5:17',
    provider: 'spotify',
    addedBy: '',
  }),
];
