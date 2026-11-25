import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { IconButton, Panel, Text } from '@/components';
import { typography, useTheme } from '@/design';
import {
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  formatRoomCode,
  isRoomCode,
  lookalikesIn,
  roomCodeFromInput,
} from '@/domain/room-code';

import { joinErrorMessage, lookalikeMessage } from './errorCopy';
import { useJoinRoom } from './useRoom';

/**
 * Home's "Join with a code" (DECISIONS.md, 2026-11-20 · Join with a code on
 * Home). Typing or pasting is forgiving: lowercase, spaces and a pasted QD-
 * are fine. Join waits for six characters a code can use, then calls
 * `join_room_by_code`; while it's out the field and the arrow are disabled,
 * and every error the contract names gets its own honest line.
 */
export function JoinWithCode({ onJoined }: { onJoined: (code: string) => void }) {
  const { colors } = useTheme();
  const { state, join, reset } = useJoinRoom();
  const [code, setCode] = useState('');
  const joining = state.status === 'pending';
  const lookalikes = lookalikesIn(code);
  const ready = isRoomCode(code) && !joining;

  const submit = async () => {
    if (!ready) return;
    const room = await join(code);
    if (room) {
      setCode('');
      onJoined(room.code);
    }
  };

  const message =
    lookalikes.length > 0
      ? lookalikeMessage
      : state.status === 'failed'
        ? joinErrorMessage(state.error)
        : null;

  return (
    <Panel>
      <Text variant="bodyStrong">Join with a code</Text>
      <View style={styles.row}>
        <View
          style={[
            styles.field,
            {
              backgroundColor: colors.surface,
              borderColor: message ? colors.statusWarn : colors.stroke,
            },
          ]}
        >
          <Text variant="mono" color="text3">
            {ROOM_CODE_PREFIX}
          </Text>
          <TextInput
            value={code}
            onChangeText={(text) => {
              setCode(roomCodeFromInput(text));
              if (state.status === 'failed') reset();
            }}
            onSubmitEditing={submit}
            editable={!joining}
            placeholder={'X'.repeat(ROOM_CODE_LENGTH)}
            placeholderTextColor={colors.text3}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="go"
            accessibilityLabel="Room code"
            accessibilityHint="Six characters from the host, like 7K4F9X"
            keyboardAppearance="dark"
            style={[styles.input, typography.mono, { color: colors.text }]}
          />
        </View>
        <IconButton
          icon="arrow-right"
          accessibilityLabel="Join"
          accessibilityState={{ disabled: !ready, busy: joining }}
          disabled={!ready}
          onPress={submit}
        />
      </View>
      {joining ? (
        <Text variant="caption" color="text2" accessibilityLiveRegion="polite">
          Joining {formatRoomCode(code)}…
        </Text>
      ) : message ? (
        <Text
          variant="caption"
          color={colors.statusWarn}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {message}
        </Text>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  input: { flex: 1, paddingVertical: 0, letterSpacing: 1 },
});
