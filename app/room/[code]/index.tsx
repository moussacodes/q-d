import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  Button,
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
import { useTheme } from '@/design';
import { otherProvider, providerNames } from '@/domain/music-provider';
import { roomPalette } from '@/features/playback/palette';
import {
  Controls,
  QueueList,
  RoomStrip,
  songCount,
  Timeline,
  TrackInfo,
  UpNextPeek,
} from '@/features/room/RoomParts';
import { roomParams, useRoom, type RoomView } from '@/features/room/useRoom';

/**
 * 3.1 Room (default) and 3.2 (expanded), plus the 4.x states via `?view=`:
 * listener (4.1), empty (4.2) and unavailable (4.3, host side in aux mode).
 */
export default function Room() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, playback, isHost, skip, moveUp, moveDown, remove } = useRoom(
    params.code,
    params.view,
  );
  const track = room.nowPlaying;
  // 4.3: the song isn't on the service the host's phone plays through.
  const missing = track?.unavailableOn === room.playsThrough;
  useScreenPalette(roomPalette(room));

  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const coverSize = expanded ? width - 40 : Math.min(200, width * 0.52);

  const openSheet = (sheet: 'add-song' | 'invite' | 'listeners' | 'queue') =>
    router.push({ pathname: `/room/[code]/${sheet}`, params: roomParams(room) });

  const header = (
    <View style={styles.header}>
      <Logo />
      <View style={styles.headerCenter}>
        {expanded ? null : (
          <Text variant="eyebrow" color="text3">
            {room.code}
          </Text>
        )}
        <Text variant="bodyStrong">{room.name}</Text>
      </View>
      <IconButton
        icon={isHost ? 'link' : 'more'}
        accessibilityLabel={isHost ? 'Invite people' : 'Room options'}
        onPress={() => (isHost ? openSheet('invite') : openSheet('listeners'))}
      />
    </View>
  );

  const footer = expanded ? (
    <UpNextPeek room={room} />
  ) : (
    <Button block icon="plus" label="Add a song" onPress={() => openSheet('add-song')} />
  );

  return (
    <Screen header={header} footer={footer}>
      <View style={styles.hero}>
        {track ? (
          <View>
            <Cover size={coverSize} radius={expanded ? 22 : 18} />
            <View style={styles.resize}>
              <IconButton
                kind="glass"
                icon={expanded ? 'minimize' : 'maximize'}
                accessibilityLabel={expanded ? 'Smaller cover' : 'Bigger cover'}
                onPress={() => setExpanded((v) => !v)}
              />
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.emptyCover,
              { width: coverSize, height: coverSize, borderColor: colors.strokeStrong },
            ]}
          >
            <Icon name="music" size={32} color={colors.text3} />
          </View>
        )}
      </View>

      {track ? (
        <TrackInfo track={track} room={room} />
      ) : (
        <View style={styles.gap6}>
          <Text variant="display">Nothing playing yet</Text>
          <Text variant="footnote" color="text2">
            Add a song to get the room going. It plays on the host’s phone.
          </Text>
        </View>
      )}

      {missing && isHost ? (
        <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
          <View style={styles.noticeRow}>
            <Icon name="alert" size={18} color={colors.statusWarn} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">Not on {providerNames[room.playsThrough]}</Text>
              <Text variant="caption" color="text2">
                This song isn’t on the service your phone plays through. Skip it, or switch to{' '}
                {providerNames[otherProvider(room.playsThrough)]} for the next song.
              </Text>
            </View>
          </View>
          <View style={styles.noticeActions}>
            <Button size="small" label="Skip" accessibilityLabel="Skip this song" onPress={skip} />
            <Button size="small" kind="secondary" label="Switch for next song" />
          </View>
        </Panel>
      ) : null}

      {track ? (
        <>
          <Timeline positionMs={playback.positionMs} durationMs={playback.durationMs} />
          <Controls
            isHost={isHost}
            playing={playback.playing}
            repeat={repeat}
            onTogglePlay={playback.togglePlay}
            onSkip={skip}
            onPrevious={() => playback.seek(0)}
            onToggleRepeat={() => setRepeat((on) => !on)}
          />
        </>
      ) : null}

      {expanded ? null : (
        <>
          <RoomStrip room={room} isHost={isHost} />
          <View style={styles.gap6}>
            <SectionLabel right={songCount(room.queue.length)}>Up next</SectionLabel>
            {room.queue.length ? (
              <QueueList room={room} controls={isHost ? { moveUp, moveDown, remove } : undefined} />
            ) : (
              <View style={[styles.emptyQueue, { borderColor: colors.strokeStrong }]}>
                <Text variant="bodyStrong">The queue is empty</Text>
                <Text variant="caption" color="text2">
                  Songs anyone adds show up here, in order.
                </Text>
              </View>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  gap6: { gap: 6 },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCenter: { alignItems: 'center', gap: 2 },
  hero: { alignItems: 'center' },
  resize: { position: 'absolute', right: 10, bottom: 10 },
  emptyCover: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { gap: 12 },
  noticeRow: { flexDirection: 'row', gap: 10 },
  noticeActions: { flexDirection: 'row', gap: 8 },
  emptyQueue: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 20,
    alignItems: 'center',
    gap: 4,
  },
});
