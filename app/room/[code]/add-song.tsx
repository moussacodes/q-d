import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  Cover,
  Icon,
  IconButton,
  SectionLabel,
  SegmentedControl,
  SheetHeader,
  SheetScreen,
  Text,
  TextField,
} from '@/components';
import { useTheme } from '@/design';
import type { TrackAvailability } from '@/domain/availability';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import { sizedArtworkUrl } from '@/domain/artwork';
import { formatArtists } from '@/domain/recording';
import { formatDuration } from '@/domain/time';
import { RoomGate } from '@/features/room/RoomGate';
import {
  availabilityLabel,
  mayBeOn,
  resultAvailability,
  useRoom,
  type RoomView,
} from '@/features/room/useRoom';
import {
  searchErrorMessage,
  useCatalogSearch,
  type SearchResult,
} from '@/features/search/useCatalogSearch';

type Filter = 'all' | MusicProvider;

/** Artwork pixels for a 44 pt cover on a 3× screen. Apple sizes artwork to order. */
const COVER_PX = 44 * 3;

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * A result's identity in the room: the canonical recording the server saved
 * (live search), which queue entries carry too, or the mock track's id.
 */
const resultId = (result: SearchResult) => result.recordingId ?? result.track.providerTrackId;

/** The toast's ending for a song that went straight to the top of an empty room. */
function upNowNote(availability: TrackAvailability, service: string, playbackLive: boolean) {
  if (availability.kind === 'unavailable') return `up now · not on ${service}`;
  if (availability.kind === 'unknown') return `up now · waiting for a ${service} match`;
  // A live room's queue is shared, but q’d doesn't play it from here yet.
  return playbackLive ? 'playing now' : 'up now';
}

/** The last song added from this sheet, for the toast. */
type Added = {
  entryId: string;
  trackId: string;
  title: string;
  playingNow: boolean;
  /** How the song stands on the room's service, for "up now · …". */
  availability: TrackAvailability;
  queueLength: number;
};

/**
 * 3.4 Add a song. Search uses the canonical catalog (plan.md §2); each result
 * says whether it's on the service the host's phone plays through. Anyone
 * in the room can add, with or without a music service.
 */
function AddSongSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, add, undoAdd, playbackLive } = useRoom(params.code, params.view);
  const { colors } = useTheme();
  const [query, setQuery] = useState('daniel caesar');
  const [filter, setFilter] = useState<Filter>('all');
  const [added, setAdded] = useState<Added | null>(null);
  /** Songs added from this sheet, for their "Added" chip. */
  const [addedIds, setAddedIds] = useState<string[]>([]);
  /** The song waiting for "Add it again?". */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Why the last add didn't go through (live rooms: offline, the rules, an ended room). */
  const [addError, setAddError] = useState<string | null>(null);
  const service = providerNames[room.playsThrough];

  const search = useCatalogSearch(query);
  const { results } = search;

  const shown = filter === 'all' ? results : results.filter((r) => mayBeOn(r, filter));

  const statusOf = (id: string) => {
    if (room.nowPlaying?.id === id) return 'playing';
    if (room.queue.some((entry) => entry.id === id)) {
      return addedIds.includes(id) ? 'added' : 'queued';
    }
    return null;
  };

  const addSong = async (result: SearchResult, allowDuplicate = false) => {
    const outcome = await add(result, allowDuplicate);
    if (!outcome.ok) {
      if (outcome.error === 'failed') {
        setAddError(outcome.message);
        return;
      }
      // PRODUCT_SPEC.md §5: ask before adding a song that's already there.
      setConfirming(resultId(result));
      return;
    }
    setAddError(null);
    setConfirming(null);
    setAdded({
      entryId: outcome.entryId,
      trackId: resultId(result),
      title: result.track.title,
      playingNow: outcome.playingNow,
      availability: resultAvailability(result, room.playsThrough),
      queueLength: outcome.queueLength,
    });
    setAddedIds((ids) => [...ids, resultId(result)]);
  };

  // Undo only while the song is still waiting in the queue.
  const canUndo = !!added && room.queue.some((entry) => entry.entryId === added.entryId);
  const undo = () => {
    if (!added) return;
    undoAdd(added.entryId);
    setAddedIds((ids) => {
      const at = ids.indexOf(added.trackId);
      return at < 0 ? ids : [...ids.slice(0, at), ...ids.slice(at + 1)];
    });
    setAdded(null);
  };

  return (
    <SheetScreen
      footer={
        added ? (
          <View style={[styles.toast, { backgroundColor: colors.text }]}>
            <Icon name="check" size={16} color={colors.bg} />
            <Text variant="label" color={colors.bg} style={styles.flex}>
              {added.title} added ·{' '}
              {added.playingNow
                ? upNowNote(added.availability, service, playbackLive)
                : `${ordinal(added.queueLength)} in line`}
            </Text>
            {canUndo ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Undo adding ${added.title}`}
                onPress={undo}
                hitSlop={8}
              >
                <Text variant="label" color={colors.bg}>
                  Undo
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
    >
      <SheetHeader title="Add a song" />
      <TextField label="Search" value={query} onChangeText={setQuery} icon="search" autoFocus />
      <SegmentedControl
        options={[
          { value: 'all', label: 'All' },
          { value: 'spotify', label: 'Spotify' },
          { value: 'apple_music', label: 'Apple Music' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Text variant="caption" color="text3">
        Songs play on {room.youHost ? 'your' : `${room.hostName}’s`} phone through {service}.
      </Text>
      {addError ? (
        <Text variant="footnote" color="statusWarn" accessibilityRole="alert">
          {addError}
        </Text>
      ) : null}
      <View style={styles.results}>
        <SectionLabel>Songs</SectionLabel>
        {query.trim() === '' ? (
          <Text variant="footnote" color="text2">
            Search by song, artist or album.
          </Text>
        ) : search.error ? (
          <Text variant="footnote" color="statusWarn" accessibilityRole="alert">
            {searchErrorMessage(search.error)}
          </Text>
        ) : shown.length === 0 && search.status === 'loading' ? (
          <Text variant="footnote" color="text2">
            Searching…
          </Text>
        ) : shown.length === 0 ? (
          <Text variant="footnote" color="text2">
            No songs match “{query.trim()}”.
          </Text>
        ) : null}
        {(search.error || query.trim() === '' ? [] : shown).map((result) => {
          const { track } = result;
          const id = resultId(result);
          const status = statusOf(id);
          const availability = resultAvailability(result, room.playsThrough);
          // Not on the room's service, or only a match that might be wrong.
          const warn = availability.kind === 'unavailable' || availability.kind === 'uncertain';
          // Not matched on the room's service yet: neither a warning nor a promise.
          const dot =
            availability.kind === 'unknown'
              ? colors.text3
              : warn
                ? colors.statusWarn
                : colors.statusOk;
          return (
            <View key={id}>
              <View style={styles.result}>
                <Cover source={sizedArtworkUrl(track.artworkUrl, COVER_PX)} size={44} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text variant="caption" color="text2" numberOfLines={1}>
                    {[formatArtists(track.artists), track.album, formatDuration(track.durationMs)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={styles.availability}>
                    <View style={[styles.dot, { backgroundColor: dot }]} />
                    <Text variant="caption" color={warn ? 'statusWarn' : 'text3'}>
                      {availabilityLabel(availability, room.playsThrough)}
                    </Text>
                  </View>
                </View>
                {status === 'playing' ? <Chip label="Playing" tone="accent" /> : null}
                {status === 'queued' ? <Chip label="In queue" /> : null}
                {status === 'added' ? <Chip label="Added" tone="ok" icon="check" /> : null}
                <IconButton
                  icon="plus"
                  accessibilityLabel={`Add ${track.title}`}
                  onPress={() => addSong(result)}
                />
              </View>
              {confirming === id ? (
                <View style={styles.confirm}>
                  <Text variant="caption" color="text2" style={styles.flex}>
                    {status === 'playing' ? 'Playing now.' : 'Already in queue.'} Add it again?
                  </Text>
                  <Button
                    size="small"
                    label="Add again"
                    accessibilityLabel={`Add ${track.title} again`}
                    onPress={() => addSong(result, true)}
                  />
                  <Button
                    size="small"
                    kind="ghost"
                    label="Cancel"
                    onPress={() => setConfirming(null)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  results: { gap: 6 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  availability: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 56,
    paddingBottom: 8,
  },
  toast: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 14,
  },
});

/** Waits for the room (live rooms are read from Supabase) before showing it. */
export default function AddSongSheetRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <RoomGate code={code}>
      <AddSongSheet />
    </RoomGate>
  );
}
