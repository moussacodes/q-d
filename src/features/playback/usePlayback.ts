import { useCallback, useEffect, useState } from 'react';

import { createPlayback, type PlaybackAdapter, type PlaybackState } from '@/providers';
import { toProviderTrack } from '@/providers/mock/catalog';
import { roomAt, type MockRoom } from '@/test/fixtures/mock-data';

/** Mock rooms open part-way into the song, like the Figma frames (1:40). */
const MOCK_START_MS = 100_000;
const POLL_MS = 500;

/**
 * One player per room and song, so Home's mini player and the room screen
 * show the same progress. Mock mode only: the real host player lives on the
 * host's phone and reaches listeners through Realtime.
 */
const players = new Map<string, PlaybackAdapter>();

function playerFor(room: MockRoom): PlaybackAdapter | null {
  if (!room.nowPlaying) {
    return null;
  }
  const key = `${room.code}:${room.nowPlaying.id}`;
  let player = players.get(key);
  if (!player) {
    const created = createPlayback(room.playsThrough);
    player = created;
    void (async () => {
      await created.prepare(toProviderTrack(room.nowPlaying!), MOCK_START_MS);
      await created.enqueue(room.queue.map(toProviderTrack));
      await created.play();
    })();
    players.set(key, player);
  }
  return player;
}

const idle: PlaybackState = { status: 'idle', track: null, positionMs: 0 };

/** Playback state for a room's now-playing song, refreshed twice a second. */
export function usePlayback(room: MockRoom | null) {
  const player = room ? playerFor(room) : null;
  const [state, setState] = useState<PlaybackState>(idle);

  useEffect(() => {
    if (!player) {
      setState(idle);
      return;
    }
    let active = true;
    const refresh = () =>
      player.getState().then((next) => {
        if (active) setState(next);
      });
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [player]);

  const togglePlay = useCallback(async () => {
    if (!player) return;
    const current = await player.getState();
    await (current.status === 'playing' ? player.pause() : player.play());
    setState(await player.getState());
  }, [player]);

  const seek = useCallback(
    async (positionMs: number) => {
      if (!player) return;
      await player.seek(positionMs);
      setState(await player.getState());
    },
    [player],
  );

  const durationMs = state.track?.durationMs ?? 0;
  return {
    state,
    playing: state.status === 'playing',
    positionMs: state.positionMs,
    durationMs,
    progress: durationMs ? state.positionMs / durationMs : 0,
    togglePlay,
    seek,
  };
}

export type Playback = ReturnType<typeof usePlayback>;

/**
 * The room as its player has it right now: when a song ends, the next queued
 * song becomes now playing and leaves the queue.
 */
export function useLiveRoom<T extends MockRoom | null>(room: T): { room: T; playback: Playback } {
  const playback = usePlayback(room);
  const live = room ? roomAt(room, playback.state.track?.providerTrackId) : room;
  return { room: live as T, playback };
}
