import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Chip,
  ListenerRow,
  Panel,
  ProviderBadge,
  SectionLabel,
  SheetHeader,
  SheetScreen,
  Text,
  TextField,
} from '@/components';
import { providerNames } from '@/domain/music-provider';
import { ruleNames, toggleChosen } from '@/domain/room-rules';
import { PermissionChips, RoomRulesEditor, RoomRulesSummary } from '@/features/room/RoomRules';
import { useRoom, type RoomView } from '@/features/room/useRoom';

/**
 * Room settings, from the Room button left of Previous. Everyone sees the
 * room's name, the service it plays through, its rules, and who's in it with
 * what each person may do. The host renames the room, changes the rules and
 * picks the chosen people here. Changes apply as they're made, like in
 * Listeners.
 */
export default function RoomSettingsSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost, you, setRules, rename } = useRoom(params.code, params.view);
  const { rules } = room;
  const hostName = room.people.find((person) => person.isHost)?.name ?? room.hostName;
  const picking = isHost && ruleNames.some((name) => rules[name].who === 'chosen');
  // The field's text. Blank text isn't saved, so it can differ from the room's name.
  const [name, setName] = useState(room.name);

  return (
    <SheetScreen>
      {isHost ? (
        <SheetHeader title="Room settings" subtitle={room.code} />
      ) : (
        <SheetHeader title={room.name} subtitle={`Hosted by ${hostName} · ${room.code}`} />
      )}

      {isHost ? (
        <TextField
          label="Room name"
          value={name}
          returnKeyType="done"
          onChangeText={(text) => {
            setName(text);
            rename(text);
          }}
          // Leaving the field blank puts the saved name back.
          onBlur={() => setName(room.name)}
        />
      ) : null}

      <View style={styles.group}>
        <SectionLabel>Music</SectionLabel>
        <Panel style={styles.row}>
          <View style={styles.flex}>
            <Text variant="bodyStrong">Plays through {providerNames[room.playsThrough]}</Text>
            <Text variant="caption" color="text2">
              {isHost
                ? 'Connected on your phone, which plays the queue. Guests don’t need a music service.'
                : `Connected on ${hostName}’s phone, which plays the queue. You don’t need a music service.`}
            </Text>
          </View>
          <ProviderBadge provider={room.playsThrough} />
        </Panel>
      </View>

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
              ) : (
                <PermissionChips
                  rules={rules}
                  person={person}
                  onToggle={
                    isHost ? (rule) => setRules(toggleChosen(rules, rule, person.id)) : undefined
                  }
                />
              )
            }
          />
        ))}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
