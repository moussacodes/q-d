import { previewPalettes, type NowPlayingPalette } from '@/design';
import type { MusicProvider } from '@/domain/music-provider';

/**
 * Deterministic sample data for the screen shells. It is never presented as
 * live data and is replaced by Supabase and the provider adapters later.
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
  palette: NowPlayingPalette;
  /** Set when the song is not on the host's service. */
  unavailableOn?: MusicProvider;
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

const track = (t: Omit<MockTrack, 'palette'> & { palette?: NowPlayingPalette }): MockTrack => ({
  palette: previewPalettes.sonOfSpergy,
  ...t,
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
    palette: previewPalettes.frenchExit,
  }),
  track({
    id: 'q2',
    title: 'Always',
    artist: 'Daniel Caesar',
    album: 'Never Enough',
    duration: '3:45',
    provider: 'spotify',
    addedBy: 'Priya',
    palette: previewPalettes.neverEnough,
  }),
  track({
    id: 'q3',
    title: 'Phantom',
    artist: 'EsDeeKid, Rico Ace',
    album: 'Rebel',
    duration: '1:49',
    provider: 'spotify',
    addedBy: 'Theo',
    palette: previewPalettes.rebel,
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
    people: people.map((p) => ({
      ...p,
      isHost: p.id === 'jules',
      provider: p.id === 'jules' ? 'spotify' : undefined,
    })),
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
    people: people.slice(0, 3),
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
    people: people.slice(0, 4),
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
