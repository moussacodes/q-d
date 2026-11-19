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
import { idlePalette, previewPalettes, useTheme } from '@/design';
import { providerNames } from '@/domain/music-provider';
import {
  Controls,
  QueueList,
  RoomStrip,
  Timeline,
  TrackInfo,
  UpNextPeek,
} from '@/features/room/RoomParts';
import { useLiveRoom } from '@/features/playback/usePlayback';
import { findRoom, mockQueue, type MockRoom } from '@/test/fixtures/mock-data';

type Preview = 'listener' | 'empty' | 'unavailable';

/**
 * 3.1 Room (default) and 3.2 (expanded), plus the 4.x states via `?view=`:
 * listener (4.1), empty (4.2) and unavailable (4.3, host side in aux mode).
 */
export default function Room() {
  const params = useLocalSearchParams<{ code: string; view?: Preview }>();
  const base = findRoom(params.code);
  const previewed: MockRoom =
    params.view === 'empty'
      ? { ...base, nowPlaying: null, queue: [], people: base.people.slice(0, 1) }
      : params.view === 'unavailable'
        ? {
            ...base,
            nowPlaying: { ...mockQueue[2], palette: previewPalettes.rebel },
            queue: base.queue.slice(3),
          }
        : base;
  const { room, playback } = useLiveRoom(previewed);
  const isHost = params.view === 'listener' ? false : room.youHost;
  const track = room.nowPlaying;
  useScreenPalette(track?.palette ?? idlePalette);

  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const coverSize = expanded ? width - 40 : Math.min(200, width * 0.52);

  const openSheet = (sheet: 'add-song' | 'invite' | 'listeners' | 'queue') =>
    router.push({ pathname: `/room/[code]/${sheet}`, params: { code: room.code } });

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

      {params.view === 'unavailable' && track ? (
        <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
          <View style={styles.noticeRow}>
            <Icon name="alert" size={18} color={colors.statusWarn} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">Not on {providerNames[room.playsThrough]}</Text>
              <Text variant="caption" color="text2">
                This song isn’t on the service your phone plays through. Skip it, or switch to Apple
                Music for the next song.
              </Text>
            </View>
          </View>
          <View style={styles.noticeActions}>
            <Button size="small" label="Skip" />
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
            onTogglePlay={playback.togglePlay}
          />
        </>
      ) : null}

      {expanded ? null : (
        <>
          <RoomStrip room={room} isHost={isHost} />
          <View style={styles.gap6}>
            <SectionLabel right={`${room.queue.length} songs`}>Up next</SectionLabel>
            {room.queue.length ? (
              <QueueList room={room} isHost={isHost} />
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
