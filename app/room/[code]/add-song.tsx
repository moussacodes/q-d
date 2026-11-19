import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
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
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import { formatDuration } from '@/domain/time';
import { useRoom, type RoomView } from '@/features/room/useRoom';
import { useCatalogSearch, type SearchResult } from '@/features/search/useCatalogSearch';

type Filter = 'all' | MusicProvider;

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * 3.4 Add a song. Search uses the canonical catalog (plan.md §2); each result
 * says whether it's on the service the host's phone plays through.
 */
export default function AddSongSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room } = useRoom(params.code, params.view);
  const { colors } = useTheme();
  const [query, setQuery] = useState('daniel caesar');
  const [filter, setFilter] = useState<Filter>('all');
  const [added, setAdded] = useState<SearchResult | null>(null);
  const service = providerNames[room.playsThrough];

  const results = useCatalogSearch(query);

  const shown = filter === 'all' ? results : results.filter((r) => r.availableOn.includes(filter));

  const statusOf = (id: string) => {
    if (room.nowPlaying?.id === id) return 'playing';
    if (room.queue.some((t) => t.id === id)) return 'queued';
    if (added?.track.providerTrackId === id) return 'added';
    return null;
  };

  return (
    <SheetScreen
      footer={
        added ? (
          <View style={[styles.toast, { backgroundColor: colors.text }]}>
            <Icon name="check" size={16} color={colors.bg} />
            <Text variant="label" color={colors.bg} style={styles.flex}>
              {added.track.title} added · {ordinal(room.queue.length + 1)} in line
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setAdded(null)} hitSlop={8}>
              <Text variant="label" color={colors.bg}>
                Undo
              </Text>
            </Pressable>
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
      <View style={styles.results}>
        <SectionLabel>Songs</SectionLabel>
        {query.trim() === '' ? (
          <Text variant="footnote" color="text2">
            Search by song, artist or album.
          </Text>
        ) : shown.length === 0 ? (
          <Text variant="footnote" color="text2">
            No songs match “{query.trim()}”.
          </Text>
        ) : null}
        {shown.map((result) => {
          const { track } = result;
          const status = statusOf(track.providerTrackId);
          const missing = !result.availableOn.includes(room.playsThrough);
          return (
            <View key={track.providerTrackId} style={styles.result}>
              <Cover source={track.artworkUrl} size={44} />
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {track.title}
                </Text>
                <Text variant="caption" color="text2" numberOfLines={1}>
                  {track.artist} · {track.album} · {formatDuration(track.durationMs)}
                </Text>
                <View style={styles.availability}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: missing ? colors.statusWarn : colors.statusOk },
                    ]}
                  />
                  <Text variant="caption" color={missing ? 'statusWarn' : 'text3'}>
                    {missing ? `Not on ${service}` : `On ${service}`}
                  </Text>
                </View>
              </View>
              {status === 'playing' ? <Chip label="Playing" tone="accent" /> : null}
              {status === 'queued' ? <Chip label="In queue" /> : null}
              {status === 'added' ? <Chip label="Added" tone="ok" icon="check" /> : null}
              {status === null ? (
                <IconButton
                  icon="plus"
                  accessibilityLabel={`Add ${track.title}`}
                  disabled={missing}
                  onPress={() => setAdded(result)}
                />
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
