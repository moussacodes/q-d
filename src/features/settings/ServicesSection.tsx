import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Panel, ServiceCard, Text } from '@/components';
import { providerColors, useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import {
  supportedProviders,
  useProviderConnections,
} from '@/features/connections/ProviderConnections';
import type { ConnectionState } from '@/providers';

const hints: Record<MusicProvider, string> = {
  spotify: 'Premium needed to play rooms',
  apple_music: 'Subscription needed for full tracks',
};

/** A mock connection says so, so it's never mistaken for a real account. */
function describe(provider: MusicProvider, connection: ConnectionState | undefined) {
  if (!connection) return hints[provider];
  if (connection.isMock) return `Mock connection · no ${providerNames[provider]} account used`;
  return connection.accountLabel ?? 'Connected';
}

/**
 * Music-service cards plus the "Play rooms through" choice. Shared by
 * onboarding step 2, Start a room and Settings → Music services.
 */
export function ServicesSection({ showPicker = true }: { showPicker?: boolean }) {
  const { connections, connect } = useProviderConnections();
  return (
    <View style={styles.group}>
      {supportedProviders.map((provider) => (
        <ServiceCard
          key={provider}
          provider={provider}
          name={providerNames[provider]}
          description={describe(provider, connections[provider])}
          state={connections[provider] ? 'connected' : 'connect'}
          onConnect={() => connect(provider)}
        />
      ))}
      {showPicker ? <PlaysThroughPicker /> : null}
    </View>
  );
}

/**
 * Which connected service rooms play through. Hidden with nothing connected;
 * with both connected, tapping switches to the other one.
 */
export function PlaysThroughPicker() {
  const { colors } = useTheme();
  const { connected, playsThrough, choose } = useProviderConnections();
  if (!playsThrough) {
    return null;
  }
  const other = connected.find((provider) => provider !== playsThrough);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play rooms through ${providerNames[playsThrough]}`}
      accessibilityHint={other ? `Switches to ${providerNames[other]}` : undefined}
      disabled={!other}
      onPress={() => other && choose(other)}
    >
      <Panel style={styles.picker}>
        <View style={styles.flex}>
          <Text variant="eyebrow" color="text3">
            Play rooms through
          </Text>
          <View style={styles.choice}>
            <View style={[styles.dot, { backgroundColor: providerColors[playsThrough].solid }]} />
            <Text variant="bodyStrong">{providerNames[playsThrough]}</Text>
          </View>
        </View>
        {other ? <Icon name="chevron-down" size={18} color={colors.text2} /> : null}
      </Panel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 6 },
  group: { gap: 10 },
  picker: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
