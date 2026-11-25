import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Panel, ServiceCard, Text } from '@/components';
import { providerColors, useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import {
  supportedProviders,
  useProviderConnections,
  type ConnectAttempt,
} from '@/features/connections/ProviderConnections';
import { useActiveRoom } from '@/features/room/useRoom';
import type { ConnectionState } from '@/providers';

import { DisconnectConfirm } from './DisconnectConfirm';

const hints: Record<MusicProvider, string> = {
  spotify: 'Premium needed to play rooms',
  apple_music: 'Subscription needed for full tracks',
};

/** A mock connection says so, so it's never mistaken for a real account. */
function describe(
  provider: MusicProvider,
  connection: ConnectionState | undefined,
  attempt: ConnectAttempt | undefined,
) {
  if (!connection) {
    if (attempt === 'connecting') return `Connecting ${providerNames[provider]}…`;
    if (attempt === 'failed') return `Couldn’t connect ${providerNames[provider]}. Try again.`;
    return hints[provider];
  }
  if (connection.isMock) return `Mock connection · no ${providerNames[provider]} account used`;
  return connection.accountLabel ?? 'Connected';
}

/**
 * The live room you host, if any: disconnecting its service pauses its music.
 * Rooms you only joined don't depend on your services.
 */
function useHostedRoom() {
  const { room } = useActiveRoom();
  return room?.youHost ? room : null;
}

/**
 * Music-service cards plus the "Play rooms through" choice. Shared by
 * onboarding step 2, Start a room and Settings → Music services. With
 * `manage` (Settings), a connected service can be disconnected
 * (PRODUCT_SPEC.md §3). Disconnecting the service a live room you host
 * plays through asks first, because it pauses that room's music.
 */
export function ServicesSection({
  showPicker = true,
  manage = false,
}: {
  showPicker?: boolean;
  manage?: boolean;
}) {
  const { connections, attempts, connect, disconnect } = useProviderConnections();
  const hosted = useHostedRoom();
  const [confirming, setConfirming] = useState<MusicProvider | null>(null);
  const requestDisconnect = (provider: MusicProvider) => {
    if (hosted?.playsThrough === provider) setConfirming(provider);
    else disconnect(provider);
  };
  return (
    <View style={styles.group}>
      {supportedProviders.map((provider) => (
        <View key={provider} style={styles.group}>
          <ServiceCard
            provider={provider}
            name={providerNames[provider]}
            description={describe(provider, connections[provider], attempts[provider])}
            state={connections[provider] ? 'connected' : 'connect'}
            busy={attempts[provider] === 'connecting'}
            onConnect={() => connect(provider)}
            onDisconnect={manage ? () => requestDisconnect(provider) : undefined}
          />
          {manage && hosted && confirming === provider && connections[provider] ? (
            <DisconnectConfirm
              provider={provider}
              roomName={hosted.name}
              onConfirm={() => {
                setConfirming(null);
                disconnect(provider);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : null}
        </View>
      ))}
      {showPicker ? <PlaysThroughPicker /> : null}
      {showPicker && manage && hosted ? (
        <Text variant="caption" color="text3">
          {hosted.name} keeps playing through {providerNames[hosted.playsThrough]}. This choice is
          for rooms you start next.
        </Text>
      ) : null}
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
