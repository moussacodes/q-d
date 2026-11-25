import type { ProviderTrack } from '../types';

import { MockPlaybackAdapter } from './playback';

const track = (id: string, durationMs: number): ProviderTrack => ({
  provider: 'spotify',
  providerTrackId: id,
  title: id,
  artists: ['Artist'],
  album: 'Album',
  durationMs,
  isrc: null,
  explicit: false,
  artworkUrl: null,
  artworkBackgroundColor: null,
});

describe('MockPlaybackAdapter', () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    now = 0;
  });

  it('starts idle and reports a mock connection', async () => {
    const player = new MockPlaybackAdapter('spotify', clock);
    expect(await player.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
    expect(await player.connect()).toMatchObject({ status: 'connected', isMock: true });
  });

  it('keeps time while playing and holds still while paused', async () => {
    const player = new MockPlaybackAdapter('spotify', clock);
    await player.prepare(track('a', 10_000), 4_000);
    expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 4_000 });

    await player.play();
    now = 3_000;
    expect((await player.getState()).positionMs).toBe(7_000);

    await player.pause();
    now = 9_000;
    expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 7_000 });
  });

  it('moves to the next enqueued song, carrying over the extra time', async () => {
    const player = new MockPlaybackAdapter('spotify', clock);
    await player.prepare(track('a', 10_000), 9_000);
    await player.enqueue([track('b', 5_000)]);
    await player.play();
    now = 2_000;
    const state = await player.getState();
    expect(state.track?.providerTrackId).toBe('b');
    expect(state.positionMs).toBe(1_000);
  });

  it('goes idle when the queue runs out', async () => {
    const player = new MockPlaybackAdapter('spotify', clock);
    await player.prepare(track('a', 10_000));
    await player.play();
    await player.seek(99_999);
    expect(await player.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });

  it('is labeled a mock and claims no real capability, for either provider', () => {
    for (const provider of ['apple_music', 'spotify'] as const) {
      expect(new MockPlaybackAdapter(provider).capabilities()).toEqual({
        inAppAudio: false,
        backgroundPlayback: false,
        requiresExternalApp: false,
        autoplay: false,
        isMock: true,
      });
    }
  });

  it('rounds a fractional position to whole milliseconds', async () => {
    const player = new MockPlaybackAdapter('spotify', clock);
    await player.prepare(track('a', 10_000), 1_234.6);
    expect((await player.getState()).positionMs).toBe(1_235);
  });

  it('pausing twice or playing twice changes nothing', async () => {
    const player = new MockPlaybackAdapter('spotify', clock);
    await player.prepare(track('a', 10_000));
    await player.play();
    now = 1_000;
    await player.play();
    now = 2_000;
    await player.pause();
    await player.pause();
    expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 2_000 });
  });

  it('is deterministic: the same calls at the same times give the same states', async () => {
    const run = async () => {
      let time = 0;
      const player = new MockPlaybackAdapter('apple_music', () => time);
      const states = [];
      await player.prepare({ ...track('a', 10_000), provider: 'apple_music' }, 2_000);
      await player.enqueue([{ ...track('b', 4_000), provider: 'apple_music' }]);
      await player.play();
      for (const step of [3_000, 4_000, 2_500, 1_000]) {
        time += step;
        states.push(await player.getState());
      }
      await player.seek(500);
      states.push(await player.getState());
      return states;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(
      first.map((state) => [state.status, state.track?.providerTrackId, state.positionMs]),
    ).toEqual([
      ['playing', 'a', 5_000],
      ['playing', 'a', 9_000],
      ['playing', 'b', 1_500],
      ['playing', 'b', 2_500],
      ['playing', 'b', 500],
    ]);
  });
});
