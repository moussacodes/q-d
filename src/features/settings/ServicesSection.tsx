import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Panel, ServiceCard, Text } from '@/components';
import { providerColors, useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';

/**
 * Music-service cards plus the "Play rooms through" choice. Shared by
 * onboarding step 2 and Settings → Music services. Connecting is mocked.
 */
export function ServicesSection() {
  const { colors } = useTheme();
  const [connected, setConnected] = useState<Record<MusicProvider, boolean>>({
    spotify: true,
    apple_music: false,
  });
  const playsThrough: MusicProvider = connected.spotify ? 'spotify' : 'apple_music';

  return (
    <View style={styles.group}>
      <ServiceCard
        provider="spotify"
        name="Spotify"
        description={
          connected.spotify ? 'Connected as baron.li · Premium' : 'Premium needed to play rooms'
        }
        state={connected.spotify ? 'connected' : 'connect'}
        onConnect={() => setConnected((c) => ({ ...c, spotify: true }))}
      />
      <ServiceCard
        provider="apple_music"
        name="Apple Music"
        description={
          connected.apple_music
            ? 'Connected · Apple Music subscription'
            : 'Subscription needed for full tracks'
        }
        state={connected.apple_music ? 'connected' : 'connect'}
        onConnect={() => setConnected((c) => ({ ...c, apple_music: true }))}
      />
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
