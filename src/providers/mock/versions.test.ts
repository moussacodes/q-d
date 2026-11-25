import { matchRecording } from '@/domain/matching';

import { isProviderError } from '../errors';
import { mockQueue, mockSearchResults } from './data';
import { mockRecordingId } from './matches';
import { mockVersions } from './versions';

const wayBigger = mockQueue[4];
const ochoRios = mockSearchResults.find((track) => track.title === 'Ocho Rios')!;

describe('mock versions for “Wrong version?”', () => {
  it('offers the closest match and the other versions for a low-confidence song', async () => {
    const { recording, candidates, isMock } = await mockVersions.versions(
      mockRecordingId(wayBigger.id),
      'spotify',
    );
    expect(recording.title).toBe('Way Bigger');
    expect(isMock).toBe(true);
    expect(candidates.map((track) => track.title)).toEqual([
      'Way Bigger',
      'Way Bigger - Radio Edit',
      'Way Bigger - Sped Up',
      'Way Bigger (Live)',
    ]);
    expect(candidates.every((track) => track.provider === 'spotify')).toBe(true);
    expect(new Set(candidates.map((track) => track.providerTrackId)).size).toBe(4);
  });

  it('agrees with the stored match: the matcher still picks the same closest track', async () => {
    for (const fixture of [wayBigger, ochoRios]) {
      const { recording, candidates } = await mockVersions.versions(
        mockRecordingId(fixture.id),
        'spotify',
      );
      const { match } = matchRecording(recording, candidates, { provider: 'spotify' });
      expect(match).toEqual(fixture.matches!.spotify);
    }
  });

  it('offers a clean radio edit next to the explicit-only match', async () => {
    const { candidates } = await mockVersions.versions(mockRecordingId(ochoRios.id), 'spotify');
    expect(candidates.map((track) => [track.title, track.explicit])).toEqual([
      ['Ocho Rios', true],
      ['Ocho Rios - Radio Edit', false],
      ['Ocho Rios (Live)', true],
    ]);
  });

  it('offers only the matched track for a song that matched automatically', async () => {
    const { candidates } = await mockVersions.versions(mockRecordingId(mockQueue[0].id), 'spotify');
    expect(candidates).toHaveLength(1);
  });

  it('only offers versions on the service asked for', async () => {
    const { candidates } = await mockVersions.versions(
      mockRecordingId(wayBigger.id),
      'apple_music',
    );
    expect(candidates.map((track) => track.provider)).toEqual(['apple_music']);
  });

  it('rejects an unknown recording with not_found', async () => {
    const error = await mockVersions
      .versions('00000000-0000-4000-8000-ffffffffffff', 'spotify')
      .catch((e: unknown) => e);
    expect(isProviderError(error) && error.code).toBe('not_found');
  });

  it('returns copies, so a caller can’t change the fixtures', async () => {
    const id = mockRecordingId(wayBigger.id);
    const first = await mockVersions.versions(id, 'spotify');
    first.candidates[0].artists.push('Someone Else');
    first.candidates[0].title = 'Changed';
    const second = await mockVersions.versions(id, 'spotify');
    expect(second.candidates[0]).toMatchObject({ title: 'Way Bigger', artists: ['Don Toliver'] });
  });
});
