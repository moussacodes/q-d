import { MockPlaybackAdapter } from '@/providers/mock/playback';

import { RoomPlayer } from './RoomPlayer';
import { createRoomStore } from './roomStore';

const room = { code: 'QD-7K4F9X' };

/** A room player on a clock the test moves by hand. */
function setup() {
  let now = 0;
  const adapter = new MockPlaybackAdapter('spotify', () => now);
  const ended = jest.fn();
  const player = new RoomPlayer(adapter, ended);
  const entries = createRoomStore().get(room);
  return {
    player,
    adapter,
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
      await player.hold(true);
      wait(600_000);
      expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 105_000 });

      await player.load(entries.nowPlaying, 0);
      expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 105_000 });
      expect(ended).not.toHaveBeenCalled();
    });

    it('ignores Play while held, and releasing doesn’t play by itself', async () => {
      const { player, entries } = setup();
      await player.load(entries.nowPlaying, 0);
      await player.hold(true);
      await player.play();
      expect((await player.getState()).status).toBe('paused');
      expect(player.isHeld).toBe(true);

      await player.hold(false);
      expect(player.isHeld).toBe(false);
      expect((await player.getState()).status).toBe('paused');
      await player.play();
      expect((await player.getState()).status).toBe('playing');
    });

    it('keeps a song loaded during the hold paused, even after the release', async () => {
      // A skip while the service is disconnected, then a reconnect: the
      // next song waits at 0:00 for the host's Play (never resumes by itself).
      const { player, entries } = setup();
      await player.load(entries.nowPlaying, 0);
      await player.hold(true);
      await player.load(entries.queue[0], 0);
      expect(await player.getState()).toMatchObject({ status: 'paused', positionMs: 0 });
      expect((await player.getState()).track?.title).toBe('Lovers Rock');

      await player.hold(false);
      await player.load(entries.queue[0], 0);
      expect((await player.getState()).status).toBe('paused');
    });

    it('doesn’t let a song that was still loading start', async () => {
      const { player, entries } = setup();
      const loading = player.load(entries.nowPlaying, 0);
      await player.hold(true);
      await loading;
      expect((await player.getState()).status).not.toBe('playing');
    });

    it('with nothing playing, stays stopped', async () => {
      const { player } = setup();
      await player.hold(true);
      await player.load(null, 0);
      expect((await player.getState()).status).toBe('idle');
    });
  });
});
