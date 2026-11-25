import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MiniPlayer } from '@/components';
import { availabilityOf, canPlayOnHostPhone } from '@/domain/availability';
import type { MockRoom } from '@/providers/mock/data';

import type { Playback } from './usePlayback';

/**
 * The mini player for the room you're in (Home and Settings). Its pause
 * button follows the room's control rule, like the room screen's controls,
 * and is off while the song can't play on the host's phone.
 */
export function RoomMiniPlayer({
  room,
  playback,
  canControl,
  waitingForHost = false,
}: {
  room: MockRoom;
  playback: Playback;
  canControl: boolean;
  /** The host's phone is away, or the room is paused until the host resumes. */
  waitingForHost?: boolean;
}) {
  const track = room.nowPlaying;
  if (!track) {
    return null;
  }
  const playable = canPlayOnHostPhone(availabilityOf(track.matches?.[room.playsThrough]));
  return (
    <View style={styles.stretch}>
      <MiniPlayer
        title={track.title}
        subtitle={`${track.artist} · ${room.name}`}
        playing={playback.playing}
        progress={playback.progress}
        onPress={() => router.push({ pathname: '/room/[code]', params: { code: room.code } })}
        onTogglePlay={canControl && playable && !waitingForHost ? playback.togglePlay : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stretch: { alignSelf: 'stretch' },
});
