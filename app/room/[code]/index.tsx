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
  EmptyQueue,
  QueueList,
  RoomStrip,
  songCount,
  Timeline,
  TrackInfo,
  UpNextPeek,
} from '@/features/room/RoomParts';
import { AutoplayNotice } from '@/features/room/AutoplayNotice';
import { hostAwayNote, HostNotice } from '@/features/room/HostNotice';
import { MatchNotice } from '@/features/room/MatchNotice';
import { ServiceMissingNotice } from '@/features/room/ServiceMissingNotice';
import { SwitchedNote, UnavailableNotice } from '@/features/room/UnavailableNotice';
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
    canPlay,
    nowPlayingAvailability: availability,
    host,
    pausedForHost,
    serviceMissing,
    resumeAfterHost,
    plan,
    switchProvider,
    hostConnected,
    skip,
    moveUp,
    moveDown,
    remove,
  } = useRoom(params.code, params.view);
  const track = room.nowPlaying;
  // 4.3: the song isn't on the service the host's phone plays through.
  // The host is asked to skip it or switch; everyone else is told why it can't
  // play. A song with no stored match yet isn't "not on" the service: the
  // match notice says it's still being matched.
  const missing = plan !== null && plan.kind !== 'play' && availability?.kind !== 'unknown';
  // Only the host's phone plays, so its controls wait for it (PRODUCT_SPEC.md §4).
  // A returning host's Play resumes the room; everyone else waits for that.
  const hostAway = host.kind !== 'connected';
  const waitingForHost = hostAway || (pausedForHost && !isHost);
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
        <QueueList
          room={room}
          controls={canControl ? { moveUp, moveDown, remove } : undefined}
          hostConnected={isHost ? hostConnected : undefined}
        />
      ) : (
        <EmptyQueue />
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
          ) : room.autoplay ? (
            <AutoplayNotice
              provider={room.autoplay}
              isHost={isHost}
              canAdd={canAdd}
              canPlay={canPlay}
              playback={playback}
            />
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

          <HostNotice
            host={host}
            pausedForHost={pausedForHost}
            isHost={isHost}
            hostName={room.hostName}
            onResume={resumeAfterHost}
          />

          {serviceMissing && isHost ? (
            <ServiceMissingNotice playsThrough={room.playsThrough} />
          ) : null}

          {missing ? (
            <UnavailableNotice
              playsThrough={room.playsThrough}
              plan={plan}
              isHost={isHost}
              onSkip={skip}
              onSwitch={switchProvider}
            />
          ) : null}
          {track && room.switched?.entryId === track.entryId ? (
            <SwitchedNote from={room.switched.from} to={room.switched.to} isHost={isHost} />
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
                canControl={canControl && !waitingForHost}
                canPlay={canPlay}
                playing={playback.playing}
                repeat={repeat}
                onTogglePlay={pausedForHost && isHost ? resumeAfterHost : playback.togglePlay}
                onSkip={skip}
                onPrevious={() => playback.seek(0)}
                onToggleRepeat={() => setRepeat((on) => !on)}
              />
              {canControl && waitingForHost ? (
                <Text variant="caption" color="text3" style={styles.center}>
                  {hostAway ? hostAwayNote : 'Playback controls come back when the host resumes.'}
                </Text>
              ) : null}
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
  center: { textAlign: 'center' },
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
});
