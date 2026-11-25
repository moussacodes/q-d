import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  Button,
  Chip,
  Intro,
  Panel,
  Screen,
  ScreenHeader,
  Text,
  useScreenPalette,
} from '@/components';
import { typography, useTheme } from '@/design';
import { isRoomCode, lookalikesIn, ROOM_CODE_LENGTH, roomCodeFromInput } from '@/domain/room-code';
import {
  canRetryJoin,
  joinErrorCopy,
  lookalikeMessage,
  useJoinByCode,
} from '@/features/room/roomCodes';
import { useMockSession } from '@/features/session/MockSession';

const CODE_LENGTH = ROOM_CODE_LENGTH;

/**
 * 2.3 Join with a code. Six characters after QD- (plan.md §2). Join calls
 * `join_room_by_code` (mock), which checks the code and joins in one call,
 * like the real RPC, so there's no "Room found" preview before it. Every
 * answer is shown: a wrong or expired code, a full or ended room, too many
 * tries, an incomplete profile, a lost session, or no connection.
 */
export default function Join() {
  useScreenPalette();
  const { colors } = useTheme();
  const { enterRoom } = useMockSession();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(roomCodeFromInput(params.code ?? ''));
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const { state, join, reset } = useJoinByCode();
  const joining = state.status === 'pending';
  const lookalikes = lookalikesIn(code).length > 0;
  const ready = isRoomCode(code) && !joining;

  const submit = async () => {
    if (!ready) return;
    const joined = await join(code);
    if (!joined) return;
    enterRoom(joined);
    router.replace({ pathname: '/room/[code]', params: { code: joined } });
  };

  const error = state.status === 'failed' ? state.error : null;

  return (
    <Screen
      header={<ScreenHeader title="Join a room" />}
      footer={
        <>
          <Button block label={joining ? 'Joining…' : 'Join'} disabled={!ready} onPress={submit} />
          <Text variant="caption" color="text3">
            The host’s phone plays the music. You don’t need a music service.
          </Text>
        </>
      }
    >
      <Intro
        title="Enter the room code."
        body="Ask the host for their code. It looks like QD-7K4F9X."
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Room code"
        onPress={() => input.current?.focus()}
        style={styles.codeRow}
      >
        <Text variant="title" style={[typography.mono, styles.prefix]} color="text3">
          QD-
        </Text>
        {Array.from({ length: CODE_LENGTH }, (_, index) => {
          const active = index === Math.min(code.length, CODE_LENGTH - 1);
          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  backgroundColor: colors.surface,
                  borderColor: active ? colors.text : colors.stroke,
                },
              ]}
            >
              <Text variant="title">{code[index] ?? ''}</Text>
            </View>
          );
        })}
        <TextInput
          ref={input}
          value={code}
          onChangeText={(t) => {
            setCode(roomCodeFromInput(t));
            // A changed code hasn't been tried yet.
            reset();
          }}
          editable={!joining}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardAppearance="dark"
          caretHidden
          style={styles.hiddenInput}
        />
      </Pressable>
      <Chip label="Paste from clipboard" icon="clipboard" />
      {lookalikes ? (
        <Text variant="caption" color="statusWarn" accessibilityRole="alert">
          {lookalikeMessage}
        </Text>
      ) : null}
      {error ? (
        <Panel style={[styles.error, { borderColor: colors.statusWarn }]}>
          <Text variant="bodyStrong" accessibilityRole="alert">
            {joinErrorCopy(error).title}
          </Text>
          <Text variant="caption" color="text2">
            {joinErrorCopy(error).body}
          </Text>
          {canRetryJoin(error) ? (
            <View style={styles.retry}>
              <Button size="small" kind="secondary" label="Try again" onPress={submit} />
            </View>
          ) : null}
        </Panel>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prefix: { fontSize: 22, marginRight: 2 },
  box: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  error: { gap: 4 },
  retry: { flexDirection: 'row', paddingTop: 8 },
});
