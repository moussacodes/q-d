import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Panel, ServiceCard, Text } from '@/components';
import { providerColors, useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import { createPlayback, type ConnectionState } from '@/providers';

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

const mockSpotify: ConnectionState = { status: 'connected', isMock: true };

/**
 * Music-service cards plus the "Play rooms through" choice. Shared by
 * onboarding step 2 and Settings → Music services. Connecting goes through
 * the provider adapter, which is a mock for now.
 */
export function ServicesSection() {
  const { colors } = useTheme();
  const [connections, setConnections] = useState<Partial<Record<MusicProvider, ConnectionState>>>(
    { spotify: mockSpotify },
  );
  const playsThrough: MusicProvider = connections.spotify ? 'spotify' : 'apple_music';

  const connect = async (provider: MusicProvider) => {
    const connection = await createPlayback(provider).connect();
    setConnections((current) => ({ ...current, [provider]: connection }));
  };

  return (
    <View style={styles.group}>
      {(['spotify', 'apple_music'] as const).map((provider) => (
        <ServiceCard
          key={provider}
          provider={provider}
          name={providerNames[provider]}
          description={describe(provider, connections[provider])}
          state={connections[provider] ? 'connected' : 'connect'}
          onConnect={() => connect(provider)}
        />
      ))}
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
        <Icon name="chevron-down" size={18} color={colors.text2} />
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 6 },
  group: { gap: 10 },
  picker: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
