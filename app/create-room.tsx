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
import { defaultRoomRules } from '@/domain/room-rules';
import { useProviderConnections } from '@/features/connections/ProviderConnections';
import { RoomRulesEditor } from '@/features/room/RoomRules';
import { useStartRoom } from '@/features/room/useRoom';
import { ServicesSection } from '@/features/settings/ServicesSection';
import { mockRooms } from '@/test/fixtures/mock-data';

/**
 * 2.4 Start a room. The host sets who adds songs and who plays, skips,
 * reorders and removes: Everyone, Chosen people or Only you
 * (PRODUCT_SPEC.md §4). Nobody has joined yet, so chosen people are picked
 * later in Listeners. Ask-before-join is post-demo and intentionally absent.
 *
 * Hosting is the one place a music service is required, because the host's
 * phone plays the queue. Without one connected, this screen asks for it.
 */
export default function CreateRoom() {
  useScreenPalette();
  const { colors } = useTheme();
  const startRoom = useStartRoom();
  const { connected, playsThrough, choose } = useProviderConnections();
  const [name, setName] = useState('Sunday Slow Burn');
  const [rules, setRules] = useState(defaultRoomRules);
  const room = mockRooms[0];
  const other = connected.find((provider) => provider !== playsThrough);

  const start = () => {
    if (!playsThrough) return;
    startRoom(room.code, { name: name.trim(), playsThrough, rules });
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
        <RoomRulesEditor
          rules={rules}
          onChange={setRules}
          chosenHint="Pick who in Listeners once people join. You can change these rules there too."
        />
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

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
