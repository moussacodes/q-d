import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Chip,
  Cover,
  Icon,
  IconButton,
  Panel,
  ProviderBadge,
  QueueRow,
  Text,
  type IconName,
} from '@/components';
import { useTheme } from '@/design';
import { providerNames } from '@/domain/music-provider';
import { formatDuration } from '@/domain/time';
import type { MockRoom, MockTrack } from '@/providers/mock/data';

/** Song details under the cover: title, artist · album, added-by line. */
export function TrackInfo({ track, room }: { track: MockTrack; room: MockRoom }) {
  const adder = room.people.find((p) => p.name === track.addedBy);
  return (
    <View style={styles.track}>
      <Text variant="display" numberOfLines={2}>
        {track.title}
      </Text>
      <Text variant="callout" color="text2">
        {track.artist} · {track.album}
      </Text>
      <View style={styles.addedBy}>
        <Avatar initial={track.addedBy[0] ?? '?'} color={adder?.color} size={16} />
        <Text variant="caption" color="text2">
          Added by {track.addedBy}
        </Text>
        <ProviderBadge provider={room.playsThrough} />
      </View>
    </View>
  );
}

/** Progress bar with elapsed / remaining time. */
export function Timeline({ positionMs, durationMs }: { positionMs: number; durationMs: number }) {
  const { colors } = useTheme();
  const progress = durationMs ? Math.min(Math.max(positionMs / durationMs, 0), 1) : 0;
  return (
    <View
      style={styles.timeline}
      accessibilityRole="progressbar"
      accessibilityLabel={`${formatDuration(positionMs)} of ${formatDuration(durationMs)}`}
    >
      <View style={[styles.track2, { backgroundColor: colors.surfaceRaised }]}>
        <View
          style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]}
        />
        <View style={[styles.knob, { left: `${progress * 100}%`, backgroundColor: colors.text }]} />
      </View>
      <View style={styles.times}>
        <Text variant="monoSmall" color="text3">
          {formatDuration(positionMs)}
        </Text>
        <Text variant="monoSmall" color="text3">
          -{formatDuration(durationMs - positionMs)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Host playback controls. Aux mode: only the host's phone plays, so there is
 * no "Resync". Listeners see the controls disabled.
 */
export function Controls({
  isHost,
  playing,
  onTogglePlay,
}: {
  isHost: boolean;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.controls, !isHost && styles.disabled]}>
      <ControlButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? 'Pause' : 'Play'}
        big
        disabled={!isHost}
        onPress={onTogglePlay}
      />
      <ControlButton icon="skip" label="Skip" disabled={!isHost} color={colors.text} />
    </View>
  );
}

function ControlButton({
  icon,
  label,
  big,
  disabled,
  color,
  onPress,
}: {
  icon: IconName;
  label: string;
  big?: boolean;
  disabled?: boolean;
  color?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.control}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.controlButton,
          big
            ? { width: 64, height: 64, backgroundColor: colors.accent }
            : { width: 44, height: 44, backgroundColor: colors.surfaceRaised },
        ]}
      >
        <Icon name={icon} size={big ? 26 : 20} color={big ? colors.onAccent : color} />
      </Pressable>
      <Text variant="caption" color="text3">
        {label}
      </Text>
    </View>
  );
}

/** Who's in the room, plus host chip or invite chip. */
export function RoomStrip({ room, isHost }: { room: MockRoom; isHost: boolean }) {
  const host = room.people.find((p) => p.isHost);
  const alone = room.people.length <= 1 || room.nowPlaying === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="People in this room"
      onPress={() =>
        router.push({ pathname: '/room/[code]/listeners', params: { code: room.code } })
      }
    >
      <Panel style={styles.strip}>
        {alone ? (
          <Avatar initial={room.people[0]?.name[0] ?? 'Y'} color={room.people[0]?.color} />
        ) : (
          <View style={styles.avatars}>
            {room.people.slice(0, 4).map((person, index) => (
              <View key={person.id} style={{ marginLeft: index === 0 ? 0 : -8 }}>
                <Avatar initial={person.name[0]} color={person.color} />
              </View>
            ))}
          </View>
        )}
        <Text variant="label" style={styles.flex}>
          {alone ? 'Just you so far' : `${room.people.length} in the room`}
        </Text>
        {isHost ? (
          <Chip label="Invite" icon="link" />
        ) : (
          <Chip label={`Host: ${host?.name ?? room.hostName}`} icon="lock" />
        )}
      </Panel>
    </Pressable>
  );
}

/** "Up next" list (default layout and the queue sheet). */
export function QueueList({ room, isHost }: { room: MockRoom; isHost: boolean }) {
  return (
    <View>
      {room.queue.map((track) => (
        <QueueRow
          key={track.id}
          title={track.title}
          artist={track.artist}
          provider={room.playsThrough}
          addedBy={`by ${track.addedBy}`}
          duration={track.duration}
          showGrip={isHost}
          note={
            track.unavailableOn
              ? `Not on ${providerNames[track.unavailableOn]} · the host can skip it`
              : undefined
          }
        />
      ))}
    </View>
  );
}

/** Expanded layout: bar that opens the queue sheet, plus the add button. */
export function UpNextPeek({ room }: { room: MockRoom }) {
  const { colors } = useTheme();
  const next = room.queue[0];
  return (
    <View style={styles.peekRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open up next"
        onPress={() => router.push({ pathname: '/room/[code]/queue', params: { code: room.code } })}
        style={[
          styles.peek,
          { backgroundColor: colors.sheetGlass, borderColor: colors.strokeStrong },
        ]}
      >
        <Cover size={36} radius={8} />
        <View style={styles.flex}>
          <Text variant="eyebrow" color="text3">
            Up next · {room.queue.length} songs
          </Text>
          {next ? (
            <Text variant="label" numberOfLines={1}>
              {next.title} · {next.artist}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-up" size={18} color={colors.text2} />
      </Pressable>
      <IconButton
        icon="plus"
        kind="accent"
        accessibilityLabel="Add a song"
        onPress={() =>
          router.push({ pathname: '/room/[code]/add-song', params: { code: room.code } })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  track: { gap: 6 },
  addedBy: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  timeline: { gap: 6 },
  track2: { height: 4, borderRadius: 2, justifyContent: 'center' },
  fill: { height: 4, borderRadius: 2 },
  knob: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 40 },
  disabled: { opacity: 0.45 },
  control: { alignItems: 'center', gap: 6 },
  controlButton: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  avatars: { flexDirection: 'row' },
  peekRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  peek: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
