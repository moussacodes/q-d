import { musicProviders } from '@/domain/music-provider';
import { playbackCapabilitiesSchema } from '@/domain/playback';
import { providerTrackSchema, type ProviderTrack } from '@/domain/recording';
import { isProviderError } from '@/providers/errors';
import type {
  CatalogAdapter,
  ConnectionState,
  PlaybackAdapter,
  ProviderErrorCode,
} from '@/providers/types';

/**
 * The shared provider contract suite (docs/API_CONTRACTS.md §5). Every
 * adapter, mock or real, runs it from its own test file, so they all behave
 * the same through the interface:
 *
 * - no adapter claims a capability it doesn't have, and mocks say `isMock`;
 * - `prepare` never starts audio, `play` does;
 * - errors are `ProviderError`s with a code, never silent no-ops;
 * - nothing is logged (so nothing private can be).
 *
 * An adapter that isn't in this build (the Apple Music and Spotify stubs) runs
 * the `unavailable` variant: it connects to `not_in_this_build` and every other
 * call rejects with that code.
 */

const connectionStatuses: ConnectionState['status'][] = [
  'connected',
  'needs_authorization',
  'needs_subscription',
  'app_not_installed',
  'error',
];

/** Resolves to the error a promise rejects with, or fails the test if it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to reject, but it resolved');
}

async function expectProviderError(
  promise: Promise<unknown>,
  code: ProviderErrorCode,
  provider?: string,
) {
  const error = await rejection(promise);
  expect(isProviderError(error)).toBe(true);
  if (!isProviderError(error)) return;
  expect(error.code).toBe(code);
  if (provider) expect(error.provider).toBe(provider);
}

/** Fails the test if the adapter writes anything to the console. */
function watchConsole() {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => {}),
  );
  return () => {
    spies.forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  };
}

type PlaybackContract = {
  name: string;
  /** A fresh adapter for each test. */
  create: () => PlaybackAdapter;
  isMock: boolean;
} & (
  | {
      available: true;
      /** Two playable tracks for this adapter's provider. */
      tracks: [ProviderTrack, ProviderTrack];
    }
  | { available: false }
);

export function describePlaybackAdapterContract(contract: PlaybackContract) {
  describe(`${contract.name} · PlaybackAdapter contract`, () => {
    let checkConsole: () => void;
    beforeEach(() => {
      checkConsole = watchConsole();
    });
    afterEach(() => checkConsole());

    it('is for Apple Music or Spotify', () => {
      expect(musicProviders).toContain(contract.create().provider);
    });

    it('reports valid capabilities, labeled mock only if it is one', () => {
      const capabilities = contract.create().capabilities();
      expect(playbackCapabilitiesSchema.parse(capabilities)).toEqual(capabilities);
      expect(capabilities.isMock).toBe(contract.isMock);
    });

    it('reports the same capabilities every time, and callers can’t change them', () => {
      const adapter = contract.create();
      const first = adapter.capabilities();
      first.inAppAudio = !first.inAppAudio;
      expect(adapter.capabilities()).toEqual(contract.create().capabilities());
    });

    it('connects to a known state that says whether it is a mock', async () => {
      const state = await contract.create().connect();
      expect(connectionStatuses).toContain(state.status);
      expect(state.isMock).toBe(contract.isMock);
    });

    it('disconnects without throwing, even when never connected', async () => {
      await expect(contract.create().disconnect()).resolves.toBeUndefined();
    });

    if (!contract.available) {
      it('says it is not in this build instead of connecting', async () => {
        const adapter = contract.create();
        expect(await adapter.connect()).toEqual({
          status: 'error',
          code: 'not_in_this_build',
          isMock: false,
        });
      });

      it('claims no capability', () => {
        const capabilities = contract.create().capabilities();
        expect(Object.values(capabilities).every((value) => value === false)).toBe(true);
      });

      const track = {
        provider: 'spotify',
        providerTrackId: 'x',
        title: 'x',
        artists: ['x'],
        album: null,
        durationMs: 1,
        isrc: null,
        explicit: false,
        artworkUrl: null,
        artworkBackgroundColor: null,
      } satisfies ProviderTrack;
      const calls: [string, (adapter: PlaybackAdapter) => Promise<unknown>][] = [
        ['prepare', (adapter) => adapter.prepare({ ...track, provider: adapter.provider })],
        ['play', (adapter) => adapter.play()],
        ['pause', (adapter) => adapter.pause()],
        ['seek', (adapter) => adapter.seek(0)],
        ['enqueue', (adapter) => adapter.enqueue([])],
        ['getState', (adapter) => adapter.getState()],
      ];
      it.each(calls)('rejects %s with not_in_this_build', async (_name, call) => {
        const adapter = contract.create();
        await expectProviderError(call(adapter), 'not_in_this_build', adapter.provider);
      });
      return;
    }

    const [first, second] = contract.tracks;

    it('starts idle with nothing loaded', async () => {
      expect(await contract.create().getState()).toEqual({
        status: 'idle',
        track: null,
        positionMs: 0,
      });
    });

    it('prepare loads the track without starting audio', async () => {
      const adapter = contract.create();
      await adapter.prepare(first, 1_000);
      const state = await adapter.getState();
      expect(state.status).not.toBe('playing');
      expect(state.track).toEqual(first);
      expect(state.positionMs).toBe(1_000);
    });

    it('play starts the prepared track, and pause stops it', async () => {
      const adapter = contract.create();
      await adapter.prepare(first);
      await adapter.play();
      expect((await adapter.getState()).status).toBe('playing');
      await adapter.pause();
      expect((await adapter.getState()).status).toBe('paused');
    });

    it('play with nothing prepared stays idle', async () => {
      const adapter = contract.create();
      await adapter.play();
      expect((await adapter.getState()).status).toBe('idle');
    });

    it('seek moves the position and stays within the track', async () => {
      const adapter = contract.create();
      await adapter.prepare(first);
      await adapter.seek(2_000);
      expect((await adapter.getState()).positionMs).toBe(2_000);
      await adapter.seek(first.durationMs * 10);
      expect((await adapter.getState()).positionMs).toBeLessThanOrEqual(first.durationMs);
    });

    it.each([
      ['negative', -1],
      ['not a number', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
    ])('rejects a %s position with invalid_argument', async (_name, position) => {
      const adapter = contract.create();
      await adapter.prepare(first);
      await expectProviderError(adapter.seek(position), 'invalid_argument', adapter.provider);
      await expectProviderError(adapter.prepare(first, position), 'invalid_argument');
    });

    it('rejects another provider’s track with wrong_provider', async () => {
      const adapter = contract.create();
      const other = musicProviders.find((provider) => provider !== adapter.provider)!;
      const foreign = { ...first, provider: other };
      await expectProviderError(adapter.prepare(foreign), 'wrong_provider', adapter.provider);
      await expectProviderError(adapter.enqueue([second, foreign]), 'wrong_provider');
      expect((await adapter.getState()).track).toBeNull();
    });

    it('disconnect stops and forgets the track', async () => {
      const adapter = contract.create();
      await adapter.prepare(first);
      await adapter.enqueue([second]);
      await adapter.play();
      await adapter.disconnect();
      expect(await adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
    });
  });
}

type CatalogContract = {
  name: string;
  create: () => CatalogAdapter;
} & (
  | {
      available: true;
      /** A query that finds something. */
      query: string;
      /** An id `getTrack` knows. */
      trackId: string;
    }
  | { available: false }
);

export function describeCatalogAdapterContract(contract: CatalogContract) {
  describe(`${contract.name} · CatalogAdapter contract`, () => {
    let checkConsole: () => void;
    beforeEach(() => {
      checkConsole = watchConsole();
    });
    afterEach(() => checkConsole());

    it('is for Apple Music or Spotify', () => {
      expect(musicProviders).toContain(contract.create().provider);
    });

    if (!contract.available) {
      const calls: [string, (adapter: CatalogAdapter) => Promise<unknown>][] = [
        ['search', (adapter) => adapter.search('rain down', 'US')],
        ['resolveLink', (adapter) => adapter.resolveLink('https://open.spotify.com/track/x')],
        ['getTrack', (adapter) => adapter.getTrack('1')],
      ];
      it.each(calls)('rejects %s with not_in_this_build', async (_name, call) => {
        const adapter = contract.create();
        await expectProviderError(call(adapter), 'not_in_this_build', adapter.provider);
      });
      return;
    }

    it('finds valid tracks, each available somewhere', async () => {
      const results = await contract.create().search(contract.query, 'US');
      expect(results.length).toBeGreaterThan(0);
      for (const { track, availableOn } of results) {
        expect(providerTrackSchema.parse(track)).toEqual(track);
        expect(availableOn.length).toBeGreaterThan(0);
        availableOn.forEach((provider) => expect(musicProviders).toContain(provider));
      }
    });

    it('gives the same results in the same order every time', async () => {
      const adapter = contract.create();
      const once = await adapter.search(contract.query, 'US');
      await adapter.search('something else entirely', 'US');
      expect(await adapter.search(contract.query, 'US')).toEqual(once);
      expect(await contract.create().search(contract.query, 'US')).toEqual(once);
    });

    it('returns nothing for a blank query', async () => {
      expect(await contract.create().search('   ', 'US')).toEqual([]);
    });

    it('does not let a caller change the catalog through a result', async () => {
      const adapter = contract.create();
      const [result] = await adapter.search(contract.query, 'US');
      const before = await adapter.getTrack(result.track.providerTrackId);
      result.track.title = 'changed';
      result.track.artists.push('changed');
      result.availableOn.length = 0;
      expect(await adapter.getTrack(result.track.providerTrackId)).toEqual(before);
      expect((await adapter.search(contract.query, 'US'))[0].availableOn.length).toBeGreaterThan(0);
    });

    it('gets a known track', async () => {
      const track = await contract.create().getTrack(contract.trackId);
      expect(providerTrackSchema.parse(track)).toEqual(track);
      expect(track.providerTrackId).toBe(contract.trackId);
    });

    it('rejects an unknown track with not_found', async () => {
      await expectProviderError(contract.create().getTrack('no-such-track'), 'not_found');
    });

    it.each([
      'https://example.com/track/1',
      'https://music.youtube.com/watch?v=abc',
      'http://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      'not a link',
      '',
    ])('rejects the link %p with unsupported_link', async (url) => {
      await expectProviderError(contract.create().resolveLink(url), 'unsupported_link');
    });
  });
}
