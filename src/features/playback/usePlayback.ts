import { useCallback, useEffect, useState } from 'react';

import type { PlaybackAdapter, PlaybackState } from '@/providers';

const POLL_MS = 500;

/** What the playback hook needs from a player. */
export type PlayerControls = Pick<PlaybackAdapter, 'getState' | 'play' | 'pause' | 'seek'>;

const idle: PlaybackState = { status: 'idle', track: null, positionMs: 0 };

/** A player's state, refreshed twice a second, plus play/pause and seek. */
export function usePlayback(player: PlayerControls | null) {
  // Tagged with its player, so switching rooms never shows the old room's state.
  const [snapshot, setSnapshot] = useState<{ player: PlayerControls; state: PlaybackState }>();

  const refresh = useCallback(async () => {
    if (!player) return;
    const state = await player.getState();
    setSnapshot({ player, state });
  }, [player]);

  useEffect(() => {
    if (!player) return;
    let active = true;
    const poll = () =>
      player.getState().then((state) => {
        if (active) setSnapshot({ player, state });
      });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [player]);

  const togglePlay = useCallback(async () => {
    if (!player) return;
    const current = await player.getState();
    await (current.status === 'playing' ? player.pause() : player.play());
    await refresh();
  }, [player, refresh]);

  const seek = useCallback(
    async (positionMs: number) => {
      if (!player) return;
      await player.seek(positionMs);
      await refresh();
    },
    [player, refresh],
  );

  const state = player && snapshot?.player === player ? snapshot.state : idle;
  const durationMs = state.track?.durationMs ?? 0;
  return {
    state,
    playing: state.status === 'playing',
    positionMs: state.positionMs,
    durationMs,
    progress: durationMs ? state.positionMs / durationMs : 0,
    togglePlay,
    seek,
    refresh,
  };
}

export type Playback = ReturnType<typeof usePlayback>;
