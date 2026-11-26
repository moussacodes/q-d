import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
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
import { liveRulesNote } from '@/features/room/liveRoom';
import { RoomGate } from '@/features/room/RoomGate';
import { useRoom, type RoomView } from '@/features/room/useRoom';
import { useMockSession } from '@/features/session/MockSession';

/**
 * 3.6 Listeners. The host changes the room rules here and picks the chosen
 * people for any rule set to Chosen. Everyone else sees the rules as text.
 * Removing a person comes later (beta).
 */
function ListenersSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost, you, setRules, rulesEditable, endRoom } = useRoom(params.code, params.view);
  const { leaveRoom } = useMockSession();
  const { rules } = room;
  const editing = isHost && rulesEditable;
  const picking = editing && ruleNames.some((name) => rules[name].who === 'chosen');
  const [ending, setEnding] = useState<'ask' | 'pending' | 'failed' | null>(null);
  const end = async () => {
    setEnding('pending');
    if (await endRoom()) {
      leaveRoom();
      router.replace('/home');
    } else {
      setEnding('failed');
    }
  };
  const count = room.people.length;
  return (
    <SheetScreen>
      <SheetHeader
        title="Listeners"
        subtitle={count === 1 ? '1 person in the room' : `${count} people in the room`}
      />
      {editing ? (
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
          {isHost ? (
            <Text variant="caption" color="text3">
              {liveRulesNote}
            </Text>
          ) : null}
        </Panel>
      )}
      <View>
        <SectionLabel right={`${count}`}>People</SectionLabel>
        {picking && count <= 1 ? (
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
            // The service the room plays through, which the host chose for it.
            provider={person.isHost ? room.playsThrough : undefined}
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
      {isHost && !room.ended ? (
        <View style={styles.group}>
          {ending === 'ask' || ending === 'pending' ? (
            <Panel style={styles.group}>
              <Text variant="bodyStrong">End {room.name}?</Text>
              <Text variant="caption" color="text2">
                The music stops for everyone, the code stops working, and nobody can join again.
              </Text>
              <View style={styles.row}>
                <Button
                  size="small"
                  label={ending === 'pending' ? 'Ending…' : 'End room'}
                  accessibilityLabel={`End ${room.name} for everyone`}
                  disabled={ending === 'pending'}
                  onPress={end}
                />
                <Button
                  size="small"
                  kind="secondary"
                  label="Keep it going"
                  disabled={ending === 'pending'}
                  onPress={() => setEnding(null)}
                />
              </View>
            </Panel>
          ) : (
            <Button kind="secondary" label="End room" onPress={() => setEnding('ask')} />
          )}
          {ending === 'failed' ? (
            <Text variant="caption" color="statusWarn" accessibilityRole="alert">
              Couldn’t end the room. Check your connection, then try again.
            </Text>
          ) : null}
        </View>
      ) : null}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  row: { flexDirection: 'row', gap: 8 },
});

/** Waits for the room (live rooms are read from Supabase) before showing it. */
export default function ListenersSheetRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <RoomGate code={code}>
      <ListenersSheet />
    </RoomGate>
  );
}
