import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, SheetHeader, SheetScreen, Text } from '@/components';
import { useTheme } from '@/design';
import { findRoom } from '@/test/fixtures/mock-data';

/** Upper bound for the QR so it stays square and in proportion on tablets. */
const QR_MAX_SIZE = 320;

/**
 * 3.5 Invite people. The QR code will carry a separate high-entropy invite
 * token, not the room code (plan.md §2); it is a placeholder until that card.
 * Ask-before-join is post-demo and intentionally absent.
 *
 * The code card sits centered in the space under the header and the QR fills
 * the card's width, so a phone across the table can scan it quickly. Copy
 * link and Share are pinned to the bottom of the sheet.
 */
export default function InviteSheet() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const room = findRoom(code);
  const { colors } = useTheme();
  return (
    <SheetScreen
      contentStyle={styles.fill}
      footer={
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button block kind="secondary" icon="copy" label="Copy link" />
          </View>
          <View style={styles.flex}>
            <Button block icon="share" label="Share" />
          </View>
        </View>
      }
    >
      <SheetHeader
        title="Invite people"
        subtitle="Anyone with the code can join and add songs. No music service needed."
      />
      <View style={styles.center}>
        <Panel style={styles.codeCard}>
          <Text variant="eyebrow" color="text3">
            Room code
          </Text>
          <Text variant="title" style={styles.code}>
            {room.code}
          </Text>
          <View
            style={[styles.qr, { backgroundColor: colors.text }]}
            accessibilityRole="image"
            accessibilityLabel={`QR code to join room ${room.code}`}
          >
            <Icon name="hash" size={56} color={colors.bg} />
            <Text variant="caption" color={colors.bg}>
              QR code
            </Text>
          </View>
        </Panel>
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center' },
  codeCard: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  code: { fontFamily: 'GeistMono-Medium', letterSpacing: 2 },
  qr: {
    width: '100%',
    maxWidth: QR_MAX_SIZE,
    aspectRatio: 1,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
});
