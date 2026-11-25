import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, Text } from '@/components';
import { useTheme } from '@/design';
import { otherProvider, providerNames, type MusicProvider } from '@/domain/music-provider';
import { useProviderConnections } from '@/features/connections/ProviderConnections';

/**
 * 4.3: the playing song isn't on the service the room plays through
 * (PRODUCT_SPEC.md §6). The host is asked to skip it, or, when they've
 * connected the other service, to switch to it for the next song. q’d never
 * switches on its own. Everyone else is told the host can skip it.
 */
export function UnavailableNotice({
  playsThrough,
  isHost,
  onSkip,
}: {
  playsThrough: MusicProvider;
  isHost: boolean;
  onSkip: () => void;
}) {
  const { colors } = useTheme();
  const { connections } = useProviderConnections();
  const service = providerNames[playsThrough];
  const other = otherProvider(playsThrough);
  // Only the host's own connections matter: their phone does the playing.
  const canSwitch = isHost && !!connections[other];

  let body: string;
  if (!isHost) {
    body = `This song isn’t on ${service}, so the host’s phone can’t play it. The host can skip it.`;
  } else if (canSwitch) {
    body = `This song isn’t on the service your phone plays through. Skip it, or switch to ${providerNames[other]} for the next song.`;
  } else {
    body = `This song isn’t on the service your phone plays through. Skip it to keep the room going.`;
  }

  return (
    <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
      <View style={styles.row}>
        <Icon name="alert" size={18} color={colors.statusWarn} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">Not on {service}</Text>
          <Text variant="caption" color="text2">
            {body}
          </Text>
        </View>
      </View>
      {isHost ? (
        <View style={styles.actions}>
          <Button size="small" label="Skip" accessibilityLabel="Skip this song" onPress={onSkip} />
          {canSwitch ? (
            // Switching itself comes with the provider-switching card.
            <Button size="small" kind="secondary" label="Switch for next song" />
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  notice: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
