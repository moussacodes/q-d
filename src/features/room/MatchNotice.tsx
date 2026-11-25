import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, Text } from '@/components';
import { useTheme } from '@/design';
import type { TrackAvailability } from '@/domain/availability';
import { providerNames, type MusicProvider } from '@/domain/music-provider';

type Props = {
  availability: Extract<TrackAvailability, { kind: 'uncertain' | 'unknown' }>;
  playsThrough: MusicProvider;
  isHost: boolean;
  onSkip: () => void;
  /**
   * "Wrong version?" (PRODUCT_SPEC.md §6, rule 8). The override card passes
   * it; until then the button doesn't appear, so nothing pretends to work.
   */
  onWrongVersion?: () => void;
};

/**
 * The playing song's match isn't certain (PRODUCT_SPEC.md §6, rule 7). A
 * low-confidence or explicit/clean match plays on the host's phone, but never
 * silently: everyone sees why it might be wrong, and the host can skip it.
 * A song with no match yet doesn't play; the host's phone waits.
 */
export function MatchNotice({ availability, playsThrough, isHost, onSkip, onWrongVersion }: Props) {
  const { colors } = useTheme();
  const service = providerNames[playsThrough];

  let title: string;
  let body: string;
  if (availability.kind === 'unknown') {
    title = `Not matched on ${service} yet`;
    body = isHost
      ? `Your phone won’t play this song until q’d finds it on ${service}. Skip it to keep the room going.`
      : `The host’s phone won’t play this song until q’d finds it on ${service}. The host can skip it.`;
  } else {
    const confidence = `${Math.round(availability.confidence)}/100 match`;
    if (availability.warning === 'explicit_conflict') {
      title = 'Explicit/clean version differs';
      body = `${service} has this song, but not with the same explicit or clean lyrics (${confidence}).`;
    } else {
      title = 'Might be a different version';
      body = `This is the closest match ${service} has (${confidence}). It could be another recording.`;
    }
    body += isHost ? ' Skip it if it’s wrong.' : ' The host can skip it.';
  }

  return (
    <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
      <View style={styles.row}>
        <Icon name="alert" size={18} color={colors.statusWarn} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="text2">
            {body}
          </Text>
        </View>
      </View>
      {isHost ? (
        <View style={styles.actions}>
          <Button size="small" label="Skip" accessibilityLabel="Skip this song" onPress={onSkip} />
          {onWrongVersion && availability.kind === 'uncertain' ? (
            <Button size="small" kind="secondary" label="Wrong version?" onPress={onWrongVersion} />
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  notice: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
