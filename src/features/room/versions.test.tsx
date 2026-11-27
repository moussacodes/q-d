import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { CanonicalRecording, ProviderTrack } from '@/domain/recording';
import type { VersionSource } from '@/providers';

import { pinnedFirst, useVersionChoices, versionTags } from './versions';

const recording: CanonicalRecording = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Way Bigger',
  primaryArtist: 'Don Toliver',
  artists: ['Don Toliver'],
  album: 'Single',
  durationMs: 196_000,
  isrc: null,
  explicit: false,
  versionTags: [],
};

const track = (id: string, changes: Partial<ProviderTrack> = {}): ProviderTrack => ({
  provider: 'spotify',
  providerTrackId: id,
  title: 'Way Bigger',
  artists: ['Don Toliver'],
  album: 'Single',
  durationMs: 196_000,
  isrc: null,
  explicit: false,
  artworkUrl: null,
  artworkBackgroundColor: null,
  ...changes,
});

const source = (answer: () => Promise<ProviderTrack[]>): VersionSource => ({
  versions: jest.fn(async () => ({ recording, candidates: await answer(), isMock: true })),
});

describe('versionTags', () => {
  it.each<[string, Partial<ProviderTrack>, string[]]>([
    ['a plain clean track', {}, ['Clean']],
    ['an explicit track', { explicit: true }, ['Explicit']],
    ['a radio edit', { title: 'Way Bigger - Radio Edit' }, ['Radio edit', 'Clean']],
    ['a live, explicit take', { title: 'Way Bigger (Live)', explicit: true }, ['Live', 'Explicit']],
    [
      'several markers, in a fixed order',
      { title: 'Way Bigger (Sped Up) [Remix]' },
      ['Remix', 'Sped up', 'Clean'],
    ],
    ['a “(Clean)” title, shown once', { title: 'Way Bigger (Clean)' }, ['Clean']],
    ['a title word that only looks like a marker', { title: 'Live Forever' }, ['Clean']],
  ])('%s', (_label, changes, tags) => {
    expect(versionTags(track('t', changes))).toEqual(tags);
  });
});

describe('useVersionChoices', () => {
  it('loads, then lists the versions in the matcher’s order (closest first)', async () => {
    const far = track('far', { title: 'Way Bigger (Live)' });
    const close = track('close', { album: 'Mock Compilation', durationMs: 203_000 });
    const versions = source(async () => [far, close]);
    const { result } = await renderHook(() => useVersionChoices(recording.id, 'spotify', versions));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current).toMatchObject({ status: 'done', isMock: true });
    if (result.current.status !== 'done') throw new Error('not loaded');
    expect(result.current.tracks.map((t) => t.providerTrackId)).toEqual(['close', 'far']);
    expect(versions.versions).toHaveBeenCalledWith(recording.id, 'spotify');
  });

  it('is loading until the answer arrives', async () => {
    const versions = source(() => new Promise(() => {}));
    const { result } = await renderHook(() => useVersionChoices(recording.id, 'spotify', versions));
    expect(result.current.status).toBe('loading');
  });

  it('reports an error, and retry loads again', async () => {
    let fail = true;
    const versions = source(async () => {
      if (fail) throw new Error('offline');
      return [track('ok')];
    });
    const { result } = await renderHook(() => useVersionChoices(recording.id, 'spotify', versions));
    await waitFor(() => expect(result.current.status).toBe('error'));
    fail = false;
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(versions.versions).toHaveBeenCalledTimes(2);
  });

  it('is an error with no recording to look up, and asks nothing', async () => {
    const versions = source(async () => []);
    const { result } = await renderHook(() => useVersionChoices(null, 'spotify', versions));
    expect(result.current.status).toBe('error');
    expect(versions.versions).not.toHaveBeenCalled();
  });

  it('drops a late answer for a service it no longer shows', async () => {
    let resolveSpotify: (tracks: ProviderTrack[]) => void = () => {};
    const versions: VersionSource = {
      versions: jest.fn((_id, provider) =>
        provider === 'spotify'
          ? new Promise((resolve) => {
              resolveSpotify = (tracks) => resolve({ recording, candidates: tracks, isMock: true });
            })
          : Promise.resolve({
              recording,
              candidates: [track('am', { provider: 'apple_music' })],
              isMock: true,
            }),
      ),
    };
    const { result, rerender } = await renderHook(
      ({ provider }: { provider: 'spotify' | 'apple_music' }) =>
        useVersionChoices(recording.id, provider, versions),
      { initialProps: { provider: 'spotify' as 'spotify' | 'apple_music' } },
    );
    await rerender({ provider: 'apple_music' });
    await waitFor(() => expect(result.current.status).toBe('done'));
    await act(async () => {
      resolveSpotify([track('late')]);
    });
    if (result.current.status !== 'done') throw new Error('not loaded');
    expect(result.current.tracks.map((t) => t.providerTrackId)).toEqual(['am']);
  });
});

describe('pinnedFirst', () => {
  const t = (providerTrackId: string) => ({ providerTrackId });
  const ids = (tracks: { providerTrackId: string }[]) => tracks.map((x) => x.providerTrackId);
  const ranked = [t('a'), t('b'), t('c'), t('d')];

  it('puts what plays now first, then the pick, then the rest in order', () => {
    expect(ids(pinnedFirst(ranked, ['c', 'b']))).toEqual(['c', 'b', 'a', 'd']);
  });

  it('keeps the matcher’s order with nothing to pin', () => {
    expect(ids(pinnedFirst(ranked, [null, null]))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lists a version once when the pick is what plays now', () => {
    expect(ids(pinnedFirst(ranked, ['d', 'd']))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('ignores ids the service doesn’t list', () => {
    expect(ids(pinnedFirst(ranked, ['gone', 'b']))).toEqual(['b', 'a', 'c', 'd']);
  });
});
