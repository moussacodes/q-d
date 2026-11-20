import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  Button,
  Chip,
  Cover,
  Intro,
  Panel,
  ProviderBadge,
  Screen,
  ScreenHeader,
  Text,
  useScreenPalette,
} from '@/components';
import { typography, useTheme } from '@/design';
import { useMockSession } from '@/features/session/MockSession';
import { mockRooms } from '@/test/fixtures/mock-data';

const CODE_LENGTH = 6;
/** Any complete code finds this room in the mock. */
const mockFound = mockRooms[1];

/** 2.3 Join with a code. Six characters after QD- (plan.md §2). */
export default function Join() {
  useScreenPalette();
  const { colors } = useTheme();
  const { enterRoom } = useMockSession();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState((params.code ?? '').slice(0, CODE_LENGTH));
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const found = code.length === CODE_LENGTH;

  const join = () => {
    enterRoom(mockFound.code);
    router.replace({ pathname: '/room/[code]', params: { code: mockFound.code } });
  };

  return (
    <Screen
      header={<ScreenHeader title="Join a room" />}
      footer={
        <>
          <Button
            block
            label={found ? `Join ${mockFound.name}` : 'Join'}
            disabled={!found}
            onPress={join}
          />
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
          onChangeText={(t) =>
            setCode(
              t
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, CODE_LENGTH),
            )
          }
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardAppearance="dark"
          caretHidden
          style={styles.hiddenInput}
        />
      </Pressable>
      <Chip label="Paste from clipboard" icon="clipboard" />
      {found ? (
        <Panel>
          <Chip label="Room found" tone="ok" icon="check" />
          <View style={styles.room}>
            <Cover size={44} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{mockFound.name}</Text>
              <Text variant="caption" color="text2">
                {mockFound.hostName}’s room · {mockFound.people.length} people
              </Text>
              {mockFound.nowPlaying ? (
                <Text variant="caption" color="text3">
                  Now playing {mockFound.nowPlaying.title} · {mockFound.nowPlaying.artist}
                </Text>
              ) : null}
            </View>
          </View>
          <ProviderBadge provider={mockFound.playsThrough} />
        </Panel>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
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
  room: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
