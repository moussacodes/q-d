import { ProviderError } from '../errors';
import type { VersionSource } from '../types';
import { mockNowPlaying, mockQueue, mockRooms, mockSearchResults, type MockTrack } from './data';
import { mockCandidates, mockRecording, mockRecordingId } from './matches';

/** Every fixture once, so a recording id finds its fixture. */
const fixtures: MockTrack[] = [
  mockNowPlaying,
  ...mockQueue,
  ...mockSearchResults,
  ...mockRooms.flatMap((room) => (room.nowPlaying ? [room.nowPlaying] : [])),
].filter((track, index, all) => all.findIndex((other) => other.id === track.id) === index);

/**
 * Mock versions for "Wrong version?": the same made-up candidates the mock
 * matches were decided from (`./matches`), so the list and the stored match
 * agree. Labeled mock; nothing here is real catalog data. Results are copies.
 */
export const mockVersions: VersionSource = {
  async versions(recordingId, provider) {
    const fixture = fixtures.find((track) => mockRecordingId(track.id) === recordingId);
    if (!fixture) throw new ProviderError('not_found', provider, 'No mock recording with that id');
    return {
      recording: mockRecording(fixture),
      candidates: mockCandidates(fixture, provider).map((track) => ({
        ...track,
        artists: [...track.artists],
      })),
      isMock: true,
    };
  },
};
