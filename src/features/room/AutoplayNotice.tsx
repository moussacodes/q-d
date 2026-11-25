import { StyleSheet, View } from 'react-native';

import { Button, Chip, Text } from '@/components';
import { autoplayLabel } from '@/domain/autoplay';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import type { Playback } from '@/features/playback/usePlayback';

/**
 * The queue ran out and the host's service kept playing songs it picked
 * itself (PRODUCT_SPEC.md §5). Everyone sees "Autoplay by Spotify", so nobody
 * thinks q’d or someone in the room chose them. The host's phone knows the
 * song; a listener's only knows that the service is choosing. Adding a song
 * hands the room back to the queue.
 */
export function AutoplayNotice({
  provider,
  isHost,
  canAdd,
  canPlay,
  playback,
}: {
  provider: MusicProvider;
  isHost: boolean;
  canAdd: boolean;
  canPlay: boolean;
  playback: Playback;
}) {
  const service = providerNames[provider];
  const track = isHost && playback.state.autoplay ? playback.state.track : null;
  const handBack = canAdd ? ' Add a song and the queue takes over.' : '';
  return (
    <View style={styles.group}>
      <View style={styles.chip}>
        <Chip tone="accent" icon="music" label={autoplayLabel(provider)} />
      </View>
      {track ? (
        <View style={styles.track}>
          <Text variant="display" numberOfLines={2}>
            {track.title}
          </Text>
          <Text variant="callout" color="text2">
            {track.artist}
          </Text>
        </View>
      ) : (
        <Text variant="display">{service} is choosing</Text>
      )}
      <Text variant="footnote" color="text2">
        {isHost
          ? `The queue ran out, so ${service} is picking songs on your phone. q’d and the room didn’t choose them.${handBack}`
          : `The queue ran out, so the host’s ${service} is picking songs. q’d and the room didn’t choose them.${handBack}`}
      </Text>
      {canPlay ? (
        <View style={styles.chip}>
          <Button
            size="small"
            kind="secondary"
            icon={playback.playing ? 'pause' : 'play'}
            label={playback.playing ? 'Pause' : 'Play'}
            onPress={playback.togglePlay}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  chip: { flexDirection: 'row' },
  track: { gap: 2 },
});
