import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, SheetHeader, SheetScreen, Text } from '@/components';
import { radii, spacing, useTheme } from '@/design';
import { latestOverride } from '@/domain/match-override';
import { providerNames } from '@/domain/music-provider';
import { formatArtists } from '@/domain/recording';
import { formatDuration } from '@/domain/time';

import { recordingIdOf, useRoom, type RoomEntry, type RoomView } from './useRoom';
import { useVersionChoices, versionTags } from './versions';

type Props = { code: string; view?: RoomView; entryId?: string };

/**
 * "Wrong version?" (PRODUCT_SPEC.md §6, rule 8): the host picks the version
 * of a song to play on the room's service. Lists the service's versions, best
 * match first, each with its title, artists, album, length and tags. Saving
 * calls `override_track_match`; the pick plays from the next time the song
 * comes up, never mid-song.
 */
export function WrongVersionSheet({ code, view, entryId }: Props) {
  const { room, isHost, overrideVersion } = useRoom(code, view);
  const entry: RoomEntry | undefined =
    room.nowPlaying?.entryId === entryId
      ? room.nowPlaying!
      : room.queue.find((queued) => queued.entryId === entryId);
  const recordingId = entry ? recordingIdOf(entry) : null;
  const service = providerNames[room.playsThrough];
  const choices = useVersionChoices(isHost ? recordingId : null, room.playsThrough);
  const { colors } = useTheme();

  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const close = () => router.back();

  if (!isHost || !entry || !recordingId) {
    return (
      <SheetScreen>
        <SheetHeader title="Wrong version?" />
        <Text variant="footnote" color="text2" accessibilityRole="alert">
          {!isHost
            ? 'Only the host can pick a different version.'
            : 'This song isn’t playing or in the queue anymore.'}
        </Text>
        <Button label="Close" kind="secondary" onPress={close} />
      </SheetScreen>
    );
  }

  // What this entry plays now, and the host's newest pick for the song.
  const playing = room.nowPlaying?.entryId === entry.entryId;
  const currentTrackId = entry.matches?.[room.playsThrough]?.providerTrackId ?? null;
  const pickedTrackId =
    latestOverride(room.overrides, recordingId, room.playsThrough)?.providerTrackId ?? null;
  // The version that will play next time: the pick, or else the current match.
  const nextTrackId = pickedTrackId ?? currentTrackId;

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await overrideVersion(entry, selected);
      if (result.ok) {
        close();
        return;
      }
      setSaveError('That song isn’t in the room anymore, so q’d couldn’t save your pick.');
    } catch {
      setSaveError('Couldn’t save your pick. Check your connection, then try again.');
    }
    setSaving(false);
  };

  const canSave = selected !== null && selected !== nextTrackId && !saving;

  return (
    <SheetScreen
      footer={
        <View style={styles.footer}>
          {saveError ? (
            <Text variant="footnote" color="statusWarn" accessibilityRole="alert">
              {saveError}
            </Text>
          ) : null}
          <Button
            block
            label={saving ? 'Saving…' : 'Use this version'}
            disabled={!canSave}
            accessibilityState={{ disabled: !canSave, busy: saving }}
            onPress={save}
          />
          <Button block kind="ghost" label="Cancel" disabled={saving} onPress={close} />
        </View>
      }
    >
      <SheetHeader
        title="Wrong version?"
        subtitle={`Pick the version of “${entry.title}” to play on ${service}.`}
      />
      <Text variant="caption" color="text3">
        {playing
          ? 'This play finishes as it started. Your pick plays from the next time this song comes up, for everyone in the room.'
          : 'Your pick plays when this song comes up, for everyone in the room.'}
      </Text>

      {choices.status === 'loading' ? (
        <Text variant="footnote" color="text2">
          Finding versions on {service}…
        </Text>
      ) : null}
      {choices.status === 'error' ? (
        <View style={styles.gap}>
          <Text variant="footnote" color="statusWarn" accessibilityRole="alert">
            Couldn’t load versions from {service}. Check your connection, then try again.
          </Text>
          <Button size="small" kind="secondary" label="Try again" onPress={choices.retry} />
        </View>
      ) : null}
      {choices.status === 'done' ? (
        <View style={styles.gap} accessibilityRole="radiogroup">
          {choices.isMock ? (
            <Text variant="caption" color="text3">
              Mock versions for testing. They aren’t from {service}’s catalog.
            </Text>
          ) : null}
          {choices.tracks.length === 0 ? (
            <Text variant="footnote" color="text2">
              {service} has no versions of this song.
            </Text>
          ) : null}
          {choices.tracks.map((track) => {
            const id = track.providerTrackId;
            const isSelected = selected === id;
            const tags = versionTags(track);
            const status =
              id === pickedTrackId
                ? 'Your pick'
                : id === currentTrackId
                  ? playing
                    ? 'Playing now'
                    : 'Current match'
                  : null;
            const details = [
              formatArtists(track.artists),
              track.album,
              formatDuration(track.durationMs),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: saving }}
                accessibilityLabel={[track.title, details, ...tags, status]
                  .filter(Boolean)
                  .join(', ')}
                disabled={saving}
                onPress={() => setSelected(id)}
                style={[
                  styles.row,
                  {
                    borderColor: isSelected ? colors.accent : colors.stroke,
                    backgroundColor: isSelected ? colors.accentSoft : colors.surface,
                  },
                ]}
              >
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {track.title}
                  </Text>
                  <Text variant="caption" color="text2" numberOfLines={2}>
                    {details}
                  </Text>
                  <View style={styles.tags}>
                    {tags.map((tag) => (
                      <Chip key={tag} label={tag} tone={tag === 'Explicit' ? 'warn' : 'neutral'} />
                    ))}
                    {status ? (
                      <Chip label={status} tone={status === 'Your pick' ? 'ok' : 'accent'} />
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
  gap: { gap: spacing.l },
  footer: { alignSelf: 'stretch', gap: spacing.m },
  row: { flexDirection: 'row', borderWidth: 1, borderRadius: radii.field, padding: spacing.xl },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, paddingTop: spacing.xs },
});
