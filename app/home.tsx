import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  Avatar,
  Chip,
  Cover,
  Icon,
  IconButton,
  Logo,
  Panel,
  Screen,
  SectionLabel,
  Text,
  useScreenPalette,
} from '@/components';
import { typography, useTheme } from '@/design';
import { RoomMiniPlayer } from '@/features/playback/RoomMiniPlayer';
import { roomPalette } from '@/features/playback/palette';
import { useActiveRoom } from '@/features/room/useRoom';
import { useMockSession } from '@/features/session/MockSession';
import { mockRooms, type MockRoom } from '@/test/fixtures/mock-data';

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

/** 2.1 Home (nothing playing) and 2.2 Home (mini player while a room plays). */
export default function Home() {
  const { user } = useMockSession();
  const { room: activeRoom, playback } = useActiveRoom();
  useScreenPalette(roomPalette(activeRoom));
  const { colors } = useTheme();
  const [code, setCode] = useState('');

  const openRoom = (room: MockRoom) =>
    router.push({ pathname: '/room/[code]', params: { code: room.code } });

  return (
    <Screen
      header={
        <View style={styles.header}>
          <Logo />
          <View style={styles.headerRight}>
            <IconButton
              icon="settings"
              accessibilityLabel="Settings"
              onPress={() => router.push('/settings')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Account"
              onPress={() => router.push({ pathname: '/settings', params: { tab: 'account' } })}
            >
              <Avatar initial={user.name[0]} color={user.color} />
            </Pressable>
          </View>
        </View>
      }
      footer={
        activeRoom?.nowPlaying ? (
          <RoomMiniPlayer room={activeRoom} playback={playback} />
        ) : undefined
      }
    >
      <View style={styles.greeting}>
        <Text variant="display">
          {greeting()}, {user.name}.
        </Text>
        <Text variant="footnote" color="text2">
          Start a room or jump into one.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/create-room')}
          style={[styles.startCard, { backgroundColor: colors.accent }]}
        >
          <View style={styles.flex}>
            <Text variant="heading" color="onAccent">
              Start a room
            </Text>
            <Text variant="caption" color="onAccent" style={styles.dim}>
              Pick the room name, share the code.
            </Text>
          </View>
          <View style={[styles.plus, { backgroundColor: colors.onAccent }]}>
            <Icon name="plus" size={20} color={colors.accent} />
          </View>
        </Pressable>

        <Panel>
          <Text variant="bodyStrong">Join with a code</Text>
          <View style={styles.joinRow}>
            <View
              style={[
                styles.codeInput,
                { backgroundColor: colors.surface, borderColor: colors.stroke },
              ]}
            >
              <Text variant="mono" color="text3">
                QD-
              </Text>
              <TextInput
                value={code}
                onChangeText={(t) =>
                  setCode(
                    t
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 6),
                  )
                }
                placeholder="XXXXXX"
                placeholderTextColor={colors.text3}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Room code"
                keyboardAppearance="dark"
                style={[styles.codeText, typography.mono, { color: colors.text }]}
              />
            </View>
            <IconButton
              icon="arrow-right"
              accessibilityLabel="Join"
              onPress={() => router.push({ pathname: '/join', params: { code } })}
            />
          </View>
        </Panel>
      </View>

      <View style={styles.recent}>
        <SectionLabel>Recent rooms</SectionLabel>
        {mockRooms.map((room) => {
          const live = activeRoom?.code === room.code;
          return (
            <Pressable
              key={room.code}
              accessibilityRole="button"
              onPress={() => openRoom(room)}
              style={styles.roomRow}
            >
              <View style={styles.stack}>
                <Cover size={40} />
                <View style={styles.stackBack}>
                  <Cover size={32} radius={8} />
                </View>
              </View>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{room.name}</Text>
                <Text variant="caption" color="text2">
                  {room.youHost ? 'You host' : `Hosted by ${room.hostName}`} ·{' '}
                  {live
                    ? `${room.people.length} listening now`
                    : `${room.people.length} people · ${room.lastActive}`}
                </Text>
              </View>
              {live ? (
                <Chip label="Live" tone="accent" />
              ) : (
                <Icon name="chevron-right" size={18} color={colors.text3} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greeting: { gap: 8 },
  actions: { gap: 12 },
  startCard: {
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dim: { opacity: 0.7 },
  plus: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  codeText: { flex: 1, paddingVertical: 0, letterSpacing: 1 },
  recent: { gap: 6 },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  stack: { width: 48, height: 44, justifyContent: 'center' },
  stackBack: { position: 'absolute', right: 0, bottom: 0, opacity: 0.7 },
});
