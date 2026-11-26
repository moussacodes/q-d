import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, Text } from '@/components';
import { useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import { useProviderConnections } from '@/features/connections/ProviderConnections';

/**
 * The host disconnected the service their room plays through (Settings →
 * Music services). Their phone can't play, so the music holds where it was;
 * the room and its queue stay. Reconnecting doesn't resume by itself: the
 * host presses Play. Only the host sees this. Everyone else just sees the
 * music paused, which is all a listener's phone would know.
 */
export function ServiceMissingNotice({ playsThrough }: { playsThrough: MusicProvider }) {
  const { colors } = useTheme();
  const { connect, attempts } = useProviderConnections();
  const service = providerNames[playsThrough];
  const attempt = attempts[playsThrough];
  return (
    <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
      <View style={styles.row}>
        <Icon name="alert" size={18} color={colors.statusWarn} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{service} isn’t connected</Text>
          <Text variant="caption" color="text2">
            {attempt === 'failed'
              ? `Couldn’t connect ${service}. Try again.`
              : `This room plays through ${service} on your phone, so the music is paused. The room and its queue are still here.`}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          size="small"
          label={`Reconnect ${service}`}
          disabled={attempt === 'connecting'}
          onPress={() => connect(playsThrough)}
        />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  notice: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
