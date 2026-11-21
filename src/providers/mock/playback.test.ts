import type { ProviderTrack } from '../types';

import { MockPlaybackAdapter } from './playback';

const track = (id: string, durationMs: number): ProviderTrack => ({
  provider: 'spotify',
  providerTrackId: id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  durationMs,
  explicit: false,
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

  it('only plays inside q’d for Apple Music', () => {
    expect(new MockPlaybackAdapter('apple_music').capabilities().playsInsideApp).toBe(true);
    expect(new MockPlaybackAdapter('spotify').capabilities().playsInsideApp).toBe(false);
  });
});
