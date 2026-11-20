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
import { ruleNames, toggleChosen } from '@/domain/room-rules';
import { ChosenChips, RoomRulesEditor, RoomRulesSummary } from '@/features/room/RoomRules';
import { useRoom, type RoomView } from '@/features/room/useRoom';

/**
 * 3.6 Listeners. The host changes the room rules here and picks the chosen
 * people for any rule set to Chosen. Everyone else sees the rules as text.
 * Removing a person comes later (beta).
 */
export default function ListenersSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost, you, setRules } = useRoom(params.code, params.view);
  const { rules } = room;
  const picking = isHost && ruleNames.some((name) => rules[name].who === 'chosen');
  return (
    <SheetScreen>
      <SheetHeader title="Listeners" subtitle={`${room.people.length} people in the room`} />
      {isHost ? (
        <View style={styles.group}>
          <SectionLabel>Room rules</SectionLabel>
          <RoomRulesEditor
            rules={rules}
            onChange={setRules}
            chosenHint="Tap the chips next to people below to choose them."
          />
        </View>
      ) : (
        <Panel>
          <SectionLabel>Room rules</SectionLabel>
          <RoomRulesSummary rules={rules} you={you} />
        </Panel>
      )}
      <View>
        <SectionLabel right={`${room.people.length}`}>People</SectionLabel>
        {picking && room.people.length <= 1 ? (
          <Text variant="caption" color="text2">
            Nobody else is here yet. Invite people, then choose them here.
          </Text>
        ) : null}
        {room.people.map((person) => (
          <ListenerRow
            key={person.id}
            name={person.name + (person.id === you?.id ? ' (you)' : '')}
            initial={person.name[0]}
            avatarColor={person.color}
            status={person.isHost ? 'Host · plays the music' : 'In the room'}
            provider={person.isHost ? person.provider : undefined}
            trailing={
              person.isHost ? (
                <Chip label="Host" />
              ) : picking ? (
                <ChosenChips
                  rules={rules}
                  person={person}
                  onToggle={(name) => setRules(toggleChosen(rules, name, person.id))}
                />
              ) : undefined
            }
          />
        ))}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
});
