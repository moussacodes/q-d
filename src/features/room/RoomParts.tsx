import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Button,
  Chip,
  Cover,
  Icon,
  IconButton,
  Panel,
  ProviderBadge,
  QueueRow,
  SwipeToDelete,
  Text,
  type IconName,
} from '@/components';
import { useTheme } from '@/design';
import { providerNames } from '@/domain/music-provider';
import { formatDuration, formatMinutes, parseDuration } from '@/domain/time';
import type { MockRoom, MockTrack } from '@/providers/mock/data';

import { cantAddNote } from './RoomRules';
import { roomParams, type LiveRoom, type RoomHandle } from './useRoom';

/** The room lists this many songs. The Up next bar opens the whole queue. */
export const ROOM_QUEUE_LIMIT = 10;

/** "1 song", "7 songs". */
export function songCount(count: number) {
  return count === 1 ? '1 song' : `${count} songs`;
}

/** "7 songs · 25 min" for the Up next sheet. */
export function queueSummary(queue: MockTrack[]) {
  const total = queue.reduce((sum, track) => sum + parseDuration(track.duration), 0);
  return queue.length ? `${songCount(queue.length)} · ${formatMinutes(total)}` : songCount(0);
}

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
 * Playback controls, for whoever the room's control rule lets in. Aux mode:
 * only the host's phone plays, so there is no "Resync". Everyone else sees
 * the controls disabled.
 *
 * Five equal slots keep Play on the screen's center line: the empty first
 * slot balances Repeat in the last one.
 */
export function Controls({
  canControl,
  playing,
  repeat,
  onTogglePlay,
  onSkip,
  onPrevious,
  onToggleRepeat,
}: {
  canControl: boolean;
  playing: boolean;
  /** Repeat the current song when it ends. */
  repeat: boolean;
  onTogglePlay: () => void;
  onSkip: () => void;
  onPrevious?: () => void;
  onToggleRepeat?: () => void;
}) {
  return (
    <View style={[styles.controls, !canControl && styles.disabled]}>
      <View style={styles.control} />
      <ControlButton icon="previous" label="Previous" disabled={!canControl} onPress={onPrevious} />
      <ControlButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? 'Pause' : 'Play'}
        big
        disabled={!canControl}
        onPress={onTogglePlay}
      />
      <ControlButton icon="skip" label="Skip" disabled={!canControl} onPress={onSkip} />
      <ControlButton
        icon="repeat"
        label="Repeat"
        accessibilityLabel="Repeat this song"
        active={repeat}
        disabled={!canControl}
        onPress={onToggleRepeat}
      />
    </View>
  );
}

function ControlButton({
  icon,
  label,
  accessibilityLabel,
  big,
  active,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  accessibilityLabel?: string;
  big?: boolean;
  /** Toggle buttons: filled with the accent while on. */
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const filled = big || active;
  const size = big ? 64 : 44;
  return (
    <View style={styles.control}>
      <View style={styles.controlSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={active === undefined ? undefined : { selected: active }}
          disabled={disabled}
          onPress={onPress}
          style={[
            styles.controlButton,
            {
              width: size,
              height: size,
              backgroundColor: filled ? colors.accent : colors.surfaceRaised,
            },
          ]}
        >
          <Icon name={icon} size={big ? 26 : 20} color={filled ? colors.onAccent : colors.text} />
        </Pressable>
      </View>
      <Text variant="caption" color={active ? 'text' : 'text3'}>
        {label}
      </Text>
    </View>
  );
}

/** Who's in the room, plus host chip or invite chip. */
export function RoomStrip({ room, isHost }: { room: LiveRoom; isHost: boolean }) {
  const host = room.people.find((p) => p.isHost);
  const alone = room.people.length <= 1 || room.nowPlaying === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="People in this room"
      onPress={() => router.push({ pathname: '/room/[code]/listeners', params: roomParams(room) })}
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

/** Queue actions, for whoever the room's control rule lets in. */
export type QueueControls = Pick<RoomHandle, 'moveUp' | 'moveDown' | 'remove'>;

/**
 * "Up next" list (the room and the queue sheet). With `limit`, only the first
 * songs. With `controls`, a swipe left on a song shows Delete, and a tap
 * opens Up, Down and Remove. The buttons stand in for dragging the grip until
 * a gesture library is chosen (ARCHITECTURE.md, open decision 4).
 */
export function QueueList({
  room,
  controls,
  limit,
}: {
  room: LiveRoom;
  controls?: QueueControls;
  limit?: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  /** The song swiped open to show Delete. One at a time. */
  const [swiped, setSwiped] = useState<string | null>(null);
  const onSwipe = useCallback((entryId: string, next: boolean) => {
    if (next) setOpen(null);
    setSwiped((current) => (next ? entryId : current === entryId ? null : current));
  }, []);
  const shown = limit === undefined ? room.queue : room.queue.slice(0, limit);
  const swipedOpen = shown.some((entry) => entry.entryId === swiped);
  const last = room.queue.length - 1;
  return (
    <View>
      {shown.map((entry, index) => {
        const { entryId, title } = entry;
        const editing = controls && open === entryId;
        const row = (
          <QueueRow
            key={entryId}
            title={title}
            artist={entry.artist}
            provider={room.playsThrough}
            addedBy={`by ${entry.addedBy}`}
            duration={entry.duration}
            showGrip={!!controls}
            note={
              entry.unavailableOn === room.playsThrough
                ? `Not on ${providerNames[entry.unavailableOn]} · the host can skip it`
                : undefined
            }
            onPress={
              controls
                ? () => {
                    // With a Delete showing, a tap only closes it, like iOS lists.
                    if (swipedOpen) {
                      setSwiped(null);
                      return;
                    }
                    setOpen((current) => (current === entryId ? null : entryId));
                  }
                : undefined
            }
            accessibilityLabel={controls ? `Reorder or remove ${title}` : undefined}
            selected={editing}
            footer={
              editing ? (
                <View style={styles.rowActions}>
                  <Button
                    size="small"
                    kind="secondary"
                    icon="chevron-up"
                    label="Up"
                    accessibilityLabel={`Move ${title} up`}
                    disabled={index === 0}
                    onPress={() => controls.moveUp(entryId)}
                  />
                  <Button
                    size="small"
                    kind="secondary"
                    icon="chevron-down"
                    label="Down"
                    accessibilityLabel={`Move ${title} down`}
                    disabled={index === last}
                    onPress={() => controls.moveDown(entryId)}
                  />
                  <Button
                    size="small"
                    kind="ghost"
                    icon="x"
                    label="Remove"
                    accessibilityLabel={`Remove ${title}`}
                    onPress={() => {
                      setOpen(null);
                      controls.remove(entryId);
                    }}
                  />
                </View>
              ) : undefined
            }
          />
        );
        if (!controls) return row;
        return (
          <SwipeToDelete
            key={entryId}
            id={entryId}
            testID={`Swipe ${title}`}
            open={swiped === entryId}
            onOpenChange={onSwipe}
            deleteLabel={`Delete ${title}`}
            onDelete={() => {
              setSwiped(null);
              controls.remove(entryId);
            }}
          >
            {row}
          </SwipeToDelete>
        );
      })}
    </View>
  );
}

/**
 * The Add a song button at the foot of the room and Up next. Disabled, with
 * the reason under it, when the room's add-songs rule leaves you out.
 */
export function AddSongFooter({
  room,
  canAdd,
  onPress,
}: {
  room: LiveRoom;
  canAdd: boolean;
  onPress: () => void;
}) {
  return (
    <>
      <Button block icon="plus" label="Add a song" disabled={!canAdd} onPress={onPress} />
      {canAdd ? null : (
        <Text variant="caption" color="text3">
          {cantAddNote(room.rules.addSongs)}
        </Text>
      )}
    </>
  );
}

/** Expanded layout: bar that opens the queue sheet, plus the add button. */
export function UpNextPeek({ room, canAdd }: { room: LiveRoom; canAdd: boolean }) {
  const { colors } = useTheme();
  const next = room.queue[0];
  return (
    <View style={styles.peekRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open up next"
        onPress={() => router.push({ pathname: '/room/[code]/queue', params: roomParams(room) })}
        style={[
          styles.peek,
          { backgroundColor: colors.sheetGlass, borderColor: colors.strokeStrong },
        ]}
      >
        <Cover size={36} radius={8} />
        <View style={styles.flex}>
          <Text variant="eyebrow" color="text3">
            Up next · {songCount(room.queue.length)}
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
        accessibilityHint={canAdd ? undefined : cantAddNote(room.rules.addSongs)}
        disabled={!canAdd}
        onPress={() => router.push({ pathname: '/room/[code]/add-song', params: roomParams(room) })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  // Tight lines, so the expanded cover can be as big as possible.
  track: { gap: 2 },
  addedBy: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  timeline: { gap: 6 },
  track2: { height: 4, borderRadius: 2, justifyContent: 'center' },
  fill: { height: 4, borderRadius: 2 },
  knob: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 360 },
  disabled: { opacity: 0.45 },
  control: { flex: 1, alignItems: 'center', gap: 6 },
  /** As tall as the Play button, so every button shares its center line. */
  controlSlot: { height: 64, justifyContent: 'center' },
  controlButton: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 54 },
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
