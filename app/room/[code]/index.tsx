import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  Cover,
  Icon,
  IconButton,
  Logo,
  Screen,
  SCREEN_GAP,
  SectionLabel,
  Text,
  useMeasuredHeight,
  useScreenPalette,
} from '@/components';
import { useTheme } from '@/design';
import { roomPalette } from '@/features/playback/palette';
import {
  EXPANDED_COVER_GAP,
  EXPANDED_DECK_GAP,
  expandedLayout,
} from '@/features/room/expandedLayout';
import {
  AddSongFooter,
  Controls,
  QueueList,
  RoomStrip,
  songCount,
  Timeline,
  TrackInfo,
  UpNextPeek,
} from '@/features/room/RoomParts';
import { MatchNotice } from '@/features/room/MatchNotice';
import { UnavailableNotice } from '@/features/room/UnavailableNotice';
import { roomParams, useRoom, type RoomView } from '@/features/room/useRoom';

/**
 * 3.2 Room (expanded), plus the 4.x states via `?view=`: listener (4.1),
 * empty (4.2) and unavailable (4.3, host side in aux mode).
 *
 * A playing song always gets the expanded cover; there's no smaller-cover
 * layout. The first page is sized to the screen: the cover shrinks until the
 * song info and playback controls fit above the Up next bar. Scrolling down
 * shows the whole queue. With nothing playing there's no cover to expand, so
 * the room keeps the 3.1 layout: empty cover, people strip and Add a song.
 */
export default function Room() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const {
    room,
    playback,
    isHost,
    canAdd,
    canControl,
    nowPlayingAvailability: availability,
    skip,
    moveUp,
    moveDown,
    remove,
  } = useRoom(params.code, params.view);
  const track = room.nowPlaying;
  // 4.3: the song isn't on the service the host's phone plays through.
  // The host is asked to skip it; everyone else is told why it can't play.
  const missing = availability?.kind === 'unavailable';
  // The host's phone doesn't play a song it can't find, so only Skip works.
  const playable = availability?.kind === 'playable' || availability?.kind === 'uncertain';
  useScreenPalette(roomPalette(room));

  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // Only a playing song has a cover to expand.
  const expanded = track !== null;
  const [repeat, setRepeat] = useState(false);
  // Read before the first paint, so the cover opens at its final size.
  const viewport = useMeasuredHeight();
  const { height: below, target: belowTarget, onLayout: onBelowLayout } = useMeasuredHeight(track);
  const layout = expandedLayout({ width, viewport: viewport.height, below });
  const coverSize = expanded ? layout.cover : Math.min(200, width * 0.52);

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
    <UpNextPeek room={room} canAdd={canAdd} />
  ) : (
    <AddSongFooter room={room} canAdd={canAdd} onPress={() => openSheet('add-song')} />
  );

  const queue = (
    <View style={styles.gap6}>
      <SectionLabel right={songCount(room.queue.length)}>Up next</SectionLabel>
      {room.queue.length ? (
        <QueueList room={room} controls={canControl ? { moveUp, moveDown, remove } : undefined} />
      ) : (
        <View style={[styles.emptyQueue, { borderColor: colors.strokeStrong }]}>
          <Text variant="bodyStrong">The queue is empty</Text>
          <Text variant="caption" color="text2">
            Songs people add show up here, in order.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <Screen header={header} footer={footer} viewport={viewport}>
      <View style={[styles.page, expanded && { minHeight: layout.page, gap: EXPANDED_COVER_GAP }]}>
        <View style={[styles.hero, expanded && styles.heroExpanded]}>
          {track ? (
            <Cover size={coverSize} radius={22} />
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

        {/* Measured so the cover leaves room for everything under it. */}
        <View
          style={[styles.page, expanded && { gap: EXPANDED_DECK_GAP }]}
          ref={belowTarget}
          onLayout={onBelowLayout}
        >
          {track ? (
            <TrackInfo track={track} room={room} />
          ) : (
            <View style={styles.gap6}>
              <Text variant="display">Nothing playing yet</Text>
              <Text variant="footnote" color="text2">
                {canAdd
                  ? 'Add a song to get the room going. It plays on the host’s phone.'
                  : 'Waiting for the first song. It plays on the host’s phone.'}
              </Text>
            </View>
          )}

          {missing ? (
            <UnavailableNotice playsThrough={room.playsThrough} isHost={isHost} onSkip={skip} />
          ) : null}
          {availability?.kind === 'uncertain' || availability?.kind === 'unknown' ? (
            // "Wrong version?" (onWrongVersion) comes with the override card.
            <MatchNotice
              availability={availability}
              playsThrough={room.playsThrough}
              isHost={isHost}
              onSkip={skip}
            />
          ) : null}

          {track ? (
            <>
              <Timeline positionMs={playback.positionMs} durationMs={playback.durationMs} />
              <Controls
                canControl={canControl}
                canPlay={playable}
                playing={playback.playing}
                repeat={repeat}
                onTogglePlay={playback.togglePlay}
                onSkip={skip}
                onPrevious={() => playback.seek(0)}
                onToggleRepeat={() => setRepeat((on) => !on)}
              />
            </>
          ) : null}
        </View>
      </View>

      {expanded ? null : <RoomStrip room={room} isHost={isHost} />}
      {queue}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap6: { gap: 6 },
  // Same gap as Screen's, so wrapping content in a page doesn't move it.
  page: { gap: SCREEN_GAP },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCenter: { alignItems: 'center', gap: 2 },
  hero: { alignItems: 'center' },
  // Any height left on a tall screen goes around the cover.
  heroExpanded: { flexGrow: 1, justifyContent: 'center' },
  emptyCover: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyQueue: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 20,
    alignItems: 'center',
    gap: 4,
  },
});
