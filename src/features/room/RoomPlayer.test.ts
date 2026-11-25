import { MockPlaybackAdapter } from '@/providers/mock/playback';

import { RoomPlayer } from './RoomPlayer';
import { createRoomStore } from './roomStore';

const room = { code: 'QD-7K4F9X' };

/** A room player on a clock the test moves by hand. */
function setup() {
  let now = 0;
  const adapter = new MockPlaybackAdapter('spotify', () => now);
  const ended = jest.fn();
  const adapters = {
    spotify: adapter,
    apple_music: new MockPlaybackAdapter('apple_music', () => now),
  };
  const player = new RoomPlayer((provider) => adapters[provider], 'spotify', ended);
  const entries = createRoomStore().get(room);
  return {
    player,
    adapter,
    apple: adapters.apple_music,
    ended,
    entries,
    wait: (ms: number) => {
      now += ms;
    },
  };
}

describe('room player', () => {
  it('plays the now-playing song from where the room is', async () => {
    const { player, entries } = setup();
    await player.load(entries.nowPlaying, 100_000);
    const state = await player.getState();
    expect(state.status).toBe('playing');
    expect(state.track?.title).toBe('Have a Baby (With Me)');
    expect(state.positionMs).toBe(100_000);
  });

  it('reports the end of the song once, and doesn’t play the next one by itself', async () => {
    const { player, ended, entries, wait } = setup();
    await player.load(entries.nowPlaying, 0);
    wait(225_000); // "Have a Baby (With Me)" is 3:45

    expect((await player.getState()).status).toBe('idle');
    await player.getState();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith(entries.nowPlaying!.entryId);
  });

  it('doesn’t report an end for a paused song', async () => {
    const { player, ended, entries, wait } = setup();
    await player.load(entries.nowPlaying, 0);
    await player.pause();
    wait(600_000);
    expect((await player.getState()).status).toBe('paused');
    expect(ended).not.toHaveBeenCalled();
  });

  it('switches songs when the room moves on, and ignores repeat loads', async () => {
    const { player, adapter, entries } = setup();
    const prepare = jest.spyOn(adapter, 'prepare');
    await player.load(entries.nowPlaying, 0);
    await player.load(entries.nowPlaying, 0);
    expect(prepare).toHaveBeenCalledTimes(1);

    await player.load(entries.queue[0], 0);
    expect((await player.getState()).track?.title).toBe('Lovers Rock');
  });

  it('stops when there’s nothing left to play', async () => {
    const { player, ended, entries } = setup();
    await player.load(entries.nowPlaying, 0);
    await player.load(null, 0);
    expect((await player.getState()).status).toBe('idle');
    expect(ended).not.toHaveBeenCalled();
  });

  describe('hold (the host disconnected the room’s service)', () => {
    it('pauses the playing song where it is, and a repeat load leaves it paused', async () => {
      const { player, ended, entries, wait } = setup();
      await player.load(entries.nowPlaying, 100_000);
      wait(5_000);
      await player.hold(entries.nowPlaying);
      wait(600_000);
      expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 105_000 });

      await player.load(entries.nowPlaying, 0);
      expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 105_000 });
      expect(ended).not.toHaveBeenCalled();

      await player.play();
      expect((await player.getState()).status).toBe('playing');
    });

    it('doesn’t start a song it hasn’t played yet, but plays it once loaded again', async () => {
      const { player, entries } = setup();
      await player.load(entries.nowPlaying, 0);
      await player.hold(entries.queue[0]);
      expect(await player.getState()).toMatchObject({ status: 'idle', track: null });

      await player.load(entries.queue[0], 0);
      expect(await player.getState()).toMatchObject({ status: 'playing' });
      expect((await player.getState()).track?.title).toBe('Lovers Rock');
    });

    it('stops a song that is still loading instead of letting it start', async () => {
      const { player, entries } = setup();
      const loading = player.load(entries.nowPlaying, 0);
      await player.hold(entries.nowPlaying);
      await loading;
      expect((await player.getState()).status).not.toBe('playing');
    });

    it('with nothing playing, stays stopped', async () => {
      const { player } = setup();
      await player.hold(null);
      expect((await player.getState()).status).toBe('idle');
    });
  });

  describe('switching services', () => {
    it('plays the next song through the new service, and lets the old one go', async () => {
      const { player, adapter, apple, entries } = setup();
      const stop = jest.spyOn(adapter, 'disconnect');
      await player.load(entries.nowPlaying, 0);
      expect(player.provider).toBe('spotify');

      await player.load(entries.queue[0], 0, 'apple_music');
      expect(player.provider).toBe('apple_music');
      expect(stop).toHaveBeenCalled();
      const state = await apple.getState();
      expect(state).toMatchObject({ status: 'playing' });
      expect(state.track).toMatchObject({ title: 'Lovers Rock', provider: 'apple_music' });
      expect((await adapter.getState()).status).toBe('idle');
    });

    it('never changes service in the middle of a song', async () => {
      const { player, adapter, entries } = setup();
      await player.load(entries.nowPlaying, 0);
      await player.load(entries.nowPlaying, 0, 'apple_music');
      expect(player.provider).toBe('spotify');
      expect((await adapter.getState()).status).toBe('playing');
    });

    it('reports the end of a song played through the new service', async () => {
      const { player, ended, entries, wait } = setup();
      await player.load(entries.queue[0], 0, 'apple_music');
      wait(213_000); // "Lovers Rock" is 3:33
      await player.getState();
      expect(ended).toHaveBeenCalledWith(entries.queue[0].entryId);
    });
  });
});
