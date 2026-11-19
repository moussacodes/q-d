import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Icon,
  Panel,
  ProviderBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  Text,
  TextField,
  useScreenPalette,
} from '@/components';
import { useTheme } from '@/design';
import { providerNames } from '@/domain/music-provider';
import { useProviderConnections } from '@/features/connections/ProviderConnections';
import { useMockSession } from '@/features/session/MockSession';
import { ServicesSection } from '@/features/settings/ServicesSection';
import { mockRooms } from '@/test/fixtures/mock-data';

/**
 * 2.4 Start a room. Demo rules are fixed (plan.md §2): everyone adds songs,
 * only the host controls playback and the queue. "Chosen people" and
 * ask-before-join are post-demo and intentionally absent.
 *
 * Hosting is the one place a music service is required, because the host's
 * phone plays the queue. Without one connected, this screen asks for it.
 */
export default function CreateRoom() {
  useScreenPalette();
  const { colors } = useTheme();
  const { startRoom } = useMockSession();
  const { connected, playsThrough, choose } = useProviderConnections();
  const [name, setName] = useState('Sunday Slow Burn');
  const room = mockRooms[0];
  const other = connected.find((provider) => provider !== playsThrough);

  const start = () => {
    if (!playsThrough) return;
    startRoom(room.code, { name: name.trim(), playsThrough });
    router.replace({ pathname: '/room/[code]', params: { code: room.code } });
  };

  return (
    <Screen
      header={<ScreenHeader title="Start a room" />}
      footer={
        <>
          <Button
            block
            label="Start room"
            disabled={!name.trim() || !playsThrough}
            onPress={start}
          />
          {playsThrough ? null : (
            <Text variant="caption" color="text3">
              Connect a music service to start a room.
            </Text>
          )}
        </>
      }
    >
      <TextField label="Room name" value={name} onChangeText={setName} />

      <View style={styles.group}>
        <SectionLabel>Room rules</SectionLabel>
        <Panel>
          <Rule label="Add songs" value="Everyone" />
          <View style={[styles.divider, { backgroundColor: colors.stroke }]} />
          <Rule label="Play, skip, reorder, remove" value="Only you" />
        </Panel>
      </View>

      <View style={styles.group}>
        <SectionLabel>Plays on this phone</SectionLabel>
        {playsThrough ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Plays through ${providerNames[playsThrough]}`}
            accessibilityHint={other ? `Switches to ${providerNames[other]}` : undefined}
            disabled={!other}
            onPress={() => other && choose(other)}
          >
            <Panel style={styles.row}>
              <View style={styles.flex}>
                <Text variant="bodyStrong">Through {providerNames[playsThrough]}</Text>
                <Text variant="caption" color="text2">
                  Guests don’t need a music service. Your phone plays the queue.
                </Text>
              </View>
              <ProviderBadge provider={playsThrough} />
              {other ? <Icon name="chevron-down" size={18} color={colors.text2} /> : null}
            </Panel>
          </Pressable>
        ) : (
          <>
            <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
              <Icon name="music" size={18} color={colors.statusWarn} />
              <View style={styles.flex}>
                <Text variant="bodyStrong">Connect a music service to host</Text>
                <Text variant="caption" color="text2">
                  The queue plays on the host’s phone, so it needs Apple Music or Spotify. Guests
                  don’t need one.
                </Text>
              </View>
            </Panel>
            <ServicesSection showPicker={false} />
          </>
        )}
      </View>
    </Screen>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="label" style={styles.flex}>
        {label}
      </Text>
      <Text variant="label" color="text2">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  divider: { height: 1 },
});
