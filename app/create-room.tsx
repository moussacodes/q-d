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
import { MAX_ROOM_NAME_LENGTH, roomNameProblem } from '@/domain/room-name';
import { defaultRoomRules } from '@/domain/room-rules';
import { useProviderConnections } from '@/features/connections/ProviderConnections';
import { createRoomErrorMessage, roomNameMessage } from '@/features/room/errorCopy';
import { RoomRulesEditor } from '@/features/room/RoomRules';
import { useStartRoom } from '@/features/room/useRoom';
import { ServicesSection } from '@/features/settings/ServicesSection';

/**
 * 2.4 Start a room. The host sets who adds songs and who plays, skips,
 * reorders and removes: Everyone, Chosen people or Only you
 * (PRODUCT_SPEC.md §4). Nobody has joined yet, so chosen people are picked
 * later in Listeners. Ask-before-join is post-demo and intentionally absent.
 *
 * Hosting is the one place a music service is required, because the host's
 * phone plays the queue. Without one connected, this screen asks for it.
 *
 * The room is always `aux`: there's no mode choice, because `sync (beta)` is
 * never shown. The name is trimmed and needs 1–40 characters.
 */
export default function CreateRoom() {
  useScreenPalette();
  const { colors } = useTheme();
  const { state, start: startRoom } = useStartRoom();
  const { connected, playsThrough, choose } = useProviderConnections();
  const [name, setName] = useState('Sunday Slow Burn');
  const [rules, setRules] = useState(defaultRoomRules);
  const other = connected.find((provider) => provider !== playsThrough);
  const nameProblem = roomNameProblem(name);
  const starting = state.status === 'pending';
  const blocked = !playsThrough || nameProblem !== null || starting;

  const start = async () => {
    if (blocked) return;
    const room = await startRoom({ name, playsThrough, rules });
    if (room) router.replace({ pathname: '/room/[code]', params: { code: room.code } });
  };

  return (
    <Screen
      header={<ScreenHeader title="Start a room" />}
      footer={
        <>
          <Button
            block
            label={starting ? 'Starting…' : 'Start room'}
            accessibilityLabel="Start room"
            accessibilityState={{ disabled: blocked, busy: starting }}
            disabled={blocked}
            onPress={start}
          />
          {state.status === 'failed' ? (
            <Text
              variant="caption"
              color="statusWarn"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {createRoomErrorMessage(state.error)}
            </Text>
          ) : playsThrough ? null : (
            <Text variant="caption" color="text3">
              Connect a music service to start a room.
            </Text>
          )}
        </>
      }
    >
      <View style={styles.field}>
        <TextField
          label="Room name"
          value={name}
          onChangeText={setName}
          maxLength={MAX_ROOM_NAME_LENGTH}
          autoCapitalize="words"
          returnKeyType="done"
          accessibilityHint={`Up to ${MAX_ROOM_NAME_LENGTH} characters`}
        />
        {nameProblem ? (
          <Text variant="caption" color="statusWarn" accessibilityLiveRegion="polite">
            {roomNameMessage(nameProblem)}
          </Text>
        ) : null}
      </View>

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
  field: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
