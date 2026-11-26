import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, Text } from '@/components';
import { useTheme } from '@/design';
import { secondsLeft, type HostStatus } from '@/domain/host-presence';

type Props = {
  host: HostStatus;
  pausedForHost: boolean;
  /** You're the host: your own phone is the one that dropped out or came back. */
  isHost: boolean;
  hostName: string;
  /** The returning host resumes the room. */
  onResume: () => void;
};

/** Why playback controls are off while the host's phone is away. */
export const hostAwayNote = 'Playback controls come back when the host’s phone reconnects.';

/**
 * The host's phone left the room (PRODUCT_SPEC.md §4). Everyone sees "Host
 * reconnecting" for 30 seconds, then the music pauses with the room and queue
 * kept. A returning host resumes once the room is up to date. Renders nothing
 * while the host is connected and the room isn't paused for them.
 */
export function HostNotice({ host, pausedForHost, isHost, hostName, onResume }: Props) {
  const { colors } = useTheme();
  const content = noticeContent({ host, pausedForHost, isHost, hostName });
  if (!content) return null;
  const { title, body, tone, resume } = content;
  const color = tone === 'warn' ? colors.statusWarn : colors.statusOk;
  return (
    <Panel style={[styles.notice, { borderColor: color }]}>
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Icon name={tone === 'warn' ? 'alert' : 'check'} size={18} color={color} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="text2">
            {body}
          </Text>
        </View>
      </View>
      {resume ? (
        <View style={styles.actions}>
          <Button
            size="small"
            label="Resume"
            accessibilityLabel="Resume the music"
            onPress={onResume}
          />
        </View>
      ) : null}
    </Panel>
  );
}

/** The notice's copy, or null when there's nothing to say. Exported for tests. */
export function noticeContent({ host, pausedForHost, isHost, hostName }: Omit<Props, 'onResume'>): {
  title: string;
  body: string;
  tone: 'warn' | 'ok';
  resume: boolean;
} | null {
  if (host.kind === 'reconnecting') {
    const left = `${secondsLeft(host)} s`;
    return isHost
      ? {
          title: 'Reconnecting',
          body: `Your phone lost the room. If it isn’t back in ${left}, the music pauses. The queue is kept.`,
          tone: 'warn',
          resume: false,
        }
      : {
          title: 'Host reconnecting',
          body: `${hostName}’s phone plays the music and lost the room. If it isn’t back in ${left}, the music pauses. The queue is kept.`,
          tone: 'warn',
          resume: false,
        };
  }
  if (host.kind === 'away') {
    return isHost
      ? {
          title: 'Paused · you’re offline',
          body: 'Your phone couldn’t reach the room for 30 seconds, so the music paused. The room and the queue are kept.',
          tone: 'warn',
          resume: false,
        }
      : {
          title: 'Paused',
          body: `${hostName}’s phone hasn’t come back, so the music is paused. The room and the queue are kept.`,
          tone: 'warn',
          resume: false,
        };
  }
  if (!pausedForHost) return null;
  return isHost
    ? {
        title: 'You’re back',
        body: 'The music paused while your phone was away. The room and the queue are up to date, so resume when you’re ready.',
        tone: 'ok',
        resume: true,
      }
    : {
        title: 'Paused',
        body: `${hostName} is back. The music starts again when they resume it.`,
        tone: 'ok',
        resume: false,
      };
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  notice: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
