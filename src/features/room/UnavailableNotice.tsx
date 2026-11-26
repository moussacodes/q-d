import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, Text } from '@/components';
import { useTheme } from '@/design';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import type { SongPlan } from '@/domain/provider-switch';

/**
 * 4.3: the song that's up isn't on the service the room plays through
 * (PRODUCT_SPEC.md §6), so the host's phone doesn't start it. The host is
 * asked to skip it, or, when it's on another service they've connected, to
 * switch to that one. q’d never switches on its own, and since the song
 * hasn't started, a switch happens between songs. Everyone else is told
 * what the host can do.
 */
export function UnavailableNotice({
  playsThrough,
  plan,
  isHost,
  onSkip,
  onSwitch,
}: {
  playsThrough: MusicProvider;
  plan: SongPlan;
  isHost: boolean;
  /** Absent while Skip isn't on the server (live rooms): the button shows, turned off. */
  onSkip?: () => void;
  onSwitch: (to: MusicProvider) => void;
}) {
  const { colors } = useTheme();
  const service = providerNames[playsThrough];
  // Only the host's own connections matter: their phone does the playing.
  const to = isHost && plan.kind === 'offer_switch' ? plan.to : null;

  let body: string;
  if (!isHost) {
    body = `This song isn’t on ${service}, so the host’s phone can’t play it. The host can skip it.`;
  } else if (to) {
    body = `This song isn’t on ${service}, but it’s on ${providerNames[to]}. Skip it, or switch to ${providerNames[to]} for this song and the ones after it.`;
  } else {
    body = `This song isn’t on the service your phone plays through. Skip it to keep the room going.`;
  }

  return (
    <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
      <View style={styles.row}>
        <Icon name="alert" size={18} color={colors.statusWarn} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">Not on {service}</Text>
          <Text variant="caption" color="text2">
            {body}
          </Text>
        </View>
      </View>
      {isHost ? (
        <View style={styles.actions}>
          <Button
            size="small"
            label="Skip"
            accessibilityLabel="Skip this song"
            disabled={!onSkip}
            onPress={onSkip}
          />
          {to ? (
            <Button
              size="small"
              kind="secondary"
              label={`Switch to ${providerNames[to]}`}
              onPress={() => onSwitch(to)}
            />
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

/**
 * Said to everyone while the song the host switched for plays, so nobody
 * wonders why the room's service changed.
 */
export function SwitchedNote({
  from,
  to,
  isHost,
}: {
  from: MusicProvider;
  to: MusicProvider;
  isHost: boolean;
}) {
  return (
    <Text variant="caption" color="text2">
      {isHost
        ? `You switched from ${providerNames[from]} to ${providerNames[to]} between songs. The room plays through ${providerNames[to]} now.`
        : `The host switched from ${providerNames[from]} to ${providerNames[to]} between songs.`}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  notice: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
