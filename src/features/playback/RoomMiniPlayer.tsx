import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MiniPlayer } from '@/components';
import { autoplayLabel } from '@/domain/autoplay';
import type { MusicProvider } from '@/domain/music-provider';
import type { MockRoom } from '@/providers/mock/data';

import type { Playback } from './usePlayback';

/**
 * The mini player for the room you're in (Home and Settings). Its pause
 * button follows the room's control rule, like the room screen's controls.
 */
export function RoomMiniPlayer({
  room,
  playback,
  canControl,
}: {
  /** `autoplay`: the service playing its own picks after the queue ran out. */
  room: MockRoom & { autoplay?: MusicProvider | null };
  playback: Playback;
  canControl: boolean;
}) {
  const track = room.nowPlaying;
  if (!track && room.autoplay) {
    // Provider autoplay: say whose songs these are, never q’d's.
    return (
      <View style={styles.stretch}>
        <MiniPlayer
          title={autoplayLabel(room.autoplay)}
          subtitle={room.name}
          playing={playback.playing}
          progress={playback.progress}
          onPress={() => router.push({ pathname: '/room/[code]', params: { code: room.code } })}
          onTogglePlay={canControl ? playback.togglePlay : undefined}
        />
      </View>
    );
  }
  if (!track) {
    return null;
  }
  return (
    <View style={styles.stretch}>
      <MiniPlayer
        title={track.title}
        subtitle={`${track.artist} · ${room.name}`}
        playing={playback.playing}
        progress={playback.progress}
        onPress={() => router.push({ pathname: '/room/[code]', params: { code: room.code } })}
        onTogglePlay={canControl ? playback.togglePlay : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stretch: { alignSelf: 'stretch' },
});
