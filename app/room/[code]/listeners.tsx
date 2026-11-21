import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Chip,
  ListenerRow,
  Panel,
  SectionLabel,
  SheetHeader,
  SheetScreen,
  Text,
} from '@/components';
import { useTheme } from '@/design';
import { findRoom } from '@/test/fixtures/mock-data';

/**
 * 3.6 Listeners. Demo rules are fixed (plan.md §2); per-person permissions
 * and host removal come later.
 */
export default function ListenersSheet() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const room = findRoom(code);
  const { colors } = useTheme();
  return (
    <SheetScreen>
      <SheetHeader title="Listeners" subtitle={`${room.people.length} people in the room`} />
      <Panel>
        <SectionLabel>Room rules</SectionLabel>
        <View style={styles.rule}>
          <Text variant="label" style={styles.flex}>
            Add songs
          </Text>
          <Text variant="label" color="text2">
            Everyone
          </Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.stroke }]} />
        <View style={styles.rule}>
          <Text variant="label" style={styles.flex}>
            Play, skip, reorder, remove
          </Text>
          <Text variant="label" color="text2">
            Host only
          </Text>
        </View>
      </Panel>
      <View>
        <SectionLabel right={`${room.people.length}`}>People</SectionLabel>
        {room.people.map((person) => (
          <ListenerRow
            key={person.id}
            name={person.name + (person.name === 'Baron' ? ' (you)' : '')}
            initial={person.name[0]}
            avatarColor={person.color}
            status={person.isHost ? 'Host · plays the music' : 'In the room'}
            provider={person.isHost ? person.provider : undefined}
            trailing={person.isHost ? <Chip label="Host" /> : undefined}
          />
        ))}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  rule: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 1 },
});
