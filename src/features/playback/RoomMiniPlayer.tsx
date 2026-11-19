import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MiniPlayer } from '@/components';
import type { MockRoom } from '@/providers/mock/data';

import type { Playback } from './usePlayback';

/**
 * The mini player for the room you're in (Home and Settings). Only the host
 * can pause, because only the host's phone plays in aux mode.
 */
export function RoomMiniPlayer({ room, playback }: { room: MockRoom; playback: Playback }) {
  const track = room.nowPlaying;
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
        onTogglePlay={room.youHost ? playback.togglePlay : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stretch: { alignSelf: 'stretch' },
});
