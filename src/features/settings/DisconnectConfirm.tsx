import { StyleSheet, View } from 'react-native';

import { Button, Panel, Text } from '@/components';
import { useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';

/**
 * Asked before disconnecting the service a live room you host plays through.
 * In aux only your phone plays, so disconnecting pauses that room's music for
 * everyone. The room and its queue stay, and reconnecting lets you press Play
 * again. Nothing about it is hidden or done without asking.
 */
export function DisconnectConfirm({
  provider,
  roomName,
  onConfirm,
  onCancel,
}: {
  provider: MusicProvider;
  roomName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const service = providerNames[provider];
  return (
    <Panel style={[styles.panel, { borderColor: colors.statusWarn }]}>
      <View style={styles.text} accessibilityRole="alert">
        <Text variant="bodyStrong">Disconnect {service}?</Text>
        <Text variant="caption" color="text2">
          {roomName} plays through {service} on this phone. Disconnecting pauses the music for
          everyone in the room. The room and its queue stay, and you can reconnect any time.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          size="small"
          label="Disconnect and pause"
          accessibilityLabel={`Disconnect ${service} and pause ${roomName}`}
          onPress={onConfirm}
        />
        <Button size="small" kind="secondary" label="Keep connected" onPress={onCancel} />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  text: { gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
