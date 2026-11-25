import { MATCH_THRESHOLD, MIN_SCORE } from '@/domain/matching';
import { trackMatchSchema } from '@/domain/recording';

import { mockCatalog } from './catalog';
import { mockNowPlaying, mockQueue, mockRooms, mockSearchResults, type MockTrack } from './data';
import { mockCandidates, mockMatches, mockRecording, mockRecordingId } from './matches';

const fixtures: MockTrack[] = [
  mockNowPlaying,
  ...mockQueue,
  ...mockSearchResults,
  ...mockRooms.flatMap((room) => (room.nowPlaying ? [room.nowPlaying] : [])),
];
const byTitle = (title: string) => fixtures.find((track) => track.title === title)!;

describe('mock track matches', () => {
  it('stores a valid track match for every fixture on both services', () => {
    for (const track of fixtures) {
      expect(track.matches).toBeDefined();
      for (const provider of ['apple_music', 'spotify'] as const) {
        const match = track.matches![provider]!;
        expect(trackMatchSchema.safeParse(match).success).toBe(true);
        expect(match.provider).toBe(provider);
        expect(match.recordingId).toBe(mockRecordingId(track.id));
      }
    }
  });

  it('gives each fixture its own recording id', () => {
    const tracks = [...mockQueue, ...mockSearchResults, mockNowPlaying];
    const fixtureIds = new Set(tracks.map((t) => t.id));
    const recordingIds = new Set(tracks.map((t) => mockRecordingId(t.id)));
    expect(recordingIds.size).toBe(fixtureIds.size);
  });

  it('matches an ordinary fixture automatically, with full confidence', () => {
    const match = byTitle('Lovers Rock').matches!.spotify!;
    expect(match).toMatchObject({ method: 'score', confidence: 100, warning: null });
    expect(match.providerTrackId).toBe('mock-spotify-q1');
  });

  it('finds no Spotify track for a song that isn’t on Spotify, but finds it on Apple Music', () => {
    const phantom = byTitle('Phantom');
    expect(phantom.matches!.spotify).toMatchObject({ providerTrackId: null, confidence: 0 });
    expect(phantom.matches!.apple_music).toMatchObject({ warning: null, confidence: 100 });
    expect(mockCandidates(phantom, 'spotify')).toEqual([]);
  });

  it('keeps a close but uncertain match with a low-confidence warning', () => {
    const match = byTitle('Way Bigger').matches!.spotify!;
    expect(match.warning).toBe('low_confidence');
    expect(match.providerTrackId).not.toBeNull();
    expect(match.confidence).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(match.confidence).toBeLessThan(MATCH_THRESHOLD);
    expect(match.confidence).toBe(81);
    // Apple Music has the same recording.
    expect(byTitle('Way Bigger').matches!.apple_music!.warning).toBeNull();
  });

  it('never matches an explicit track to a clean recording automatically', () => {
    const match = byTitle('Ocho Rios').matches!.spotify!;
    expect(match.warning).toBe('explicit_conflict');
    expect(match.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(mockCandidates(byTitle('Ocho Rios'), 'spotify')[0].explicit).toBe(true);
  });

  it('is deterministic', () => {
    const wayBigger = byTitle('Way Bigger');
    expect(mockMatches(wayBigger)).toEqual(mockMatches(wayBigger));
    expect(mockRecording(wayBigger)).toEqual(mockRecording(wayBigger));
  });

  it('splits a fixture’s artists into the recording’s credits', () => {
    expect(mockRecording(byTitle('Phantom'))).toMatchObject({
      primaryArtist: 'EsDeeKid',
      artists: ['EsDeeKid', 'Rico Ace'],
    });
  });

  it('hands the matches to catalog results, as copies', async () => {
    const [ocho] = await mockCatalog.search('ocho rios', 'US');
    expect(ocho.matches?.spotify?.warning).toBe('explicit_conflict');
    ocho.matches!.spotify!.warning = null;
    const [again] = await mockCatalog.search('ocho rios', 'US');
    expect(again.matches?.spotify?.warning).toBe('explicit_conflict');
  });
});
