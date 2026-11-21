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
import { providerNames } from '@/domain/music-provider';
import { findRoom, mockSearchResults } from '@/test/fixtures/mock-data';

/**
 * 3.4 Add a song. Search uses the canonical catalog (plan.md §2); each result
 * says whether it's on the service the host's phone plays through.
 */
export default function AddSongSheet() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const room = findRoom(code);
  const { colors } = useTheme();
  const [query, setQuery] = useState('daniel caesar');
  const [filter, setFilter] = useState<'all' | 'spotify' | 'apple_music'>('all');
  const [added, setAdded] = useState<string | null>(null);
  const service = providerNames[room.playsThrough];

  return (
    <SheetScreen
      footer={
        added ? (
          <View style={[styles.toast, { backgroundColor: colors.text }]}>
            <Icon name="check" size={16} color={colors.bg} />
            <Text variant="label" color={colors.bg} style={styles.flex}>
              {added} added · {room.queue.length + 1}th in line
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
        Songs play on {room.hostName === 'Baron' ? 'your' : `${room.hostName}’s`} phone through{' '}
        {service}.
      </Text>
      <View style={styles.results}>
        <SectionLabel>Songs</SectionLabel>
        {mockSearchResults.map((song) => {
          const status = 'status' in song ? song.status : added === song.title ? 'added' : null;
          const missing = song.unavailableOn === room.playsThrough;
          return (
            <View key={song.id} style={styles.result}>
              <Cover size={44} />
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {song.title}
                </Text>
                <Text variant="caption" color="text2" numberOfLines={1}>
                  {song.artist} · {song.album} · {song.duration}
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
                  accessibilityLabel={`Add ${song.title}`}
                  disabled={missing}
                  onPress={() => setAdded(song.title)}
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
