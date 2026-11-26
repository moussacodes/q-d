import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, Text } from '@/components';
import { useTheme } from '@/design';

/**
 * This phone lost its connection to the room (the Realtime channel dropped).
 * What's on screen may be out of date, and anything that goes to the server
 * (adding, reordering, removing) waits. The app reconnects by itself and
 * refetches the room when it's back (docs/API_CONTRACTS.md §4).
 */
export const offlineCopy = {
  title: 'You’re offline',
  body: 'q’d can’t reach the room right now, so this may be out of date. It catches up by itself when you’re back.',
  /** Under Add a song while offline. */
  addNote: 'You’re offline. Adding songs works again once you’re back.',
};

/** The host ended the room (`room.ended`). */
export const endedCopy = {
  title: 'This room has ended',
  host: 'You ended this room. Nothing more plays, and its code doesn’t work any more.',
  listener: (hostName: string) =>
    `${hostName} ended this room. Nothing more plays, and its code doesn’t work any more.`,
  addNote: 'This room has ended.',
};

export function OfflineNotice() {
  const { colors } = useTheme();
  return (
    <Panel style={[styles.notice, { borderColor: colors.statusWarn }]}>
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Icon name="alert" size={18} color={colors.statusWarn} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{offlineCopy.title}</Text>
          <Text variant="caption" color="text2">
            {offlineCopy.body}
          </Text>
        </View>
      </View>
    </Panel>
  );
}

/** Replaces the room once it has ended, with the way out. */
export function RoomEndedNotice({
  isHost,
  hostName,
  onLeave,
}: {
  isHost: boolean;
  hostName: string;
  onLeave: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Panel style={[styles.notice, { borderColor: colors.strokeStrong }]}>
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Icon name="music" size={18} color={colors.text2} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{endedCopy.title}</Text>
          <Text variant="caption" color="text2">
            {isHost ? endedCopy.host : endedCopy.listener(hostName)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button size="small" label="Back to Home" onPress={onLeave} />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  notice: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
