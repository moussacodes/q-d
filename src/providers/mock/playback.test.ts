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

describe('MockPlaybackAdapter autoplay', () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    now = 0;
  });

  it('is off unless asked for, and says so in its capabilities', () => {
    expect(new MockPlaybackAdapter('spotify', clock).capabilities().autoplay).toBe(false);
    expect(
      new MockPlaybackAdapter('spotify', clock, { autoplay: true }).capabilities().autoplay,
    ).toBe(true);
  });

  it('picks its own songs once the queue runs out, always the same ones, and marks them', async () => {
    const player = new MockPlaybackAdapter('apple_music', clock, { autoplay: true });
    await player.prepare(track('a', 10_000), 9_000);
    await player.play();
    now = 3_000;
    const first = await player.getState();
    expect(first).toMatchObject({ status: 'playing', autoplay: true, positionMs: 2_000 });
    expect(first.track).toMatchObject({ title: 'Get You', provider: 'apple_music' });

    now = 3_000 + 278_000; // "Get You" is 4:38
    const second = await player.getState();
    expect(second.track?.title).toBe('Best Part');
    expect(second.autoplay).toBe(true);
  });

  it('plays the queue’s own songs first, unmarked', async () => {
    const player = new MockPlaybackAdapter('spotify', clock, { autoplay: true });
    await player.prepare(track('a', 10_000), 9_000);
    await player.enqueue([track('b', 5_000)]);
    await player.play();
    now = 2_000;
    const state = await player.getState();
    expect(state.track?.providerTrackId).toBe('b');
    expect(state.autoplay).toBeUndefined();
  });

  it('stops marking songs once q’d prepares one, or disconnects', async () => {
    const player = new MockPlaybackAdapter('spotify', clock, { autoplay: true });
    await player.prepare(track('a', 1_000));
    await player.play();
    now = 2_000;
    expect((await player.getState()).autoplay).toBe(true);

    await player.prepare(track('c', 5_000));
    expect((await player.getState()).autoplay).toBeUndefined();

    await player.play();
    now = 10_000;
    expect((await player.getState()).autoplay).toBe(true);
    await player.disconnect();
    expect(await player.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });
});
