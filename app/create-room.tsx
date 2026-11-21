import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
import { useMockSession } from '@/features/session/MockSession';
import { mockRooms } from '@/test/fixtures/mock-data';

/**
 * 2.4 Start a room. Demo rules are fixed (plan.md §2): everyone adds songs,
 * only the host controls playback and the queue. "Chosen people" and
 * ask-before-join are post-demo and intentionally absent.
 */
export default function CreateRoom() {
  useScreenPalette();
  const { colors } = useTheme();
  const { enterRoom } = useMockSession();
  const [name, setName] = useState('Sunday Slow Burn');
  const room = mockRooms[0];

  const start = () => {
    enterRoom(room.code);
    router.replace({ pathname: '/room/[code]', params: { code: room.code } });
  };

  return (
    <Screen
      header={<ScreenHeader title="Start a room" />}
      footer={<Button block label="Start room" disabled={!name.trim()} onPress={start} />}
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
        <Panel style={styles.row}>
          <View style={styles.flex}>
            <Text variant="bodyStrong">Through Spotify</Text>
            <Text variant="caption" color="text2">
              Guests don’t need a music service. Your phone plays the queue.
            </Text>
          </View>
          <ProviderBadge provider="spotify" />
          <Icon name="chevron-down" size={18} color={colors.text2} />
        </Panel>
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
  divider: { height: 1 },
});
