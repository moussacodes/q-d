import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Panel, SheetHeader, SheetScreen, Text } from '@/components';
import { useTheme } from '@/design';
import { findRoom } from '@/test/fixtures/mock-data';

/**
 * 3.5 Invite people. The QR code will carry a separate high-entropy invite
 * token, not the room code (plan.md §2); it is a placeholder until that card.
 * Ask-before-join is post-demo and intentionally absent.
 */
export default function InviteSheet() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const room = findRoom(code);
  const { colors } = useTheme();
  return (
    <SheetScreen>
      <SheetHeader
        title="Invite people"
        subtitle="Anyone with the code can join and add songs. No music service needed."
      />
      <Panel style={styles.codeCard}>
        <Text variant="eyebrow" color="text3">
          Room code
        </Text>
        <Text variant="title" style={styles.code}>
          {room.code}
        </Text>
        <View style={[styles.qr, { backgroundColor: colors.text }]}>
          <Icon name="hash" size={40} color={colors.bg} />
          <Text variant="caption" color={colors.bg}>
            QR code
          </Text>
        </View>
      </Panel>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button block kind="secondary" icon="copy" label="Copy link" />
        </View>
        <View style={styles.flex}>
          <Button block icon="share" label="Share" />
        </View>
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  codeCard: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  code: { fontFamily: 'GeistMono-Medium', letterSpacing: 2 },
  qr: {
    width: 160,
    height: 160,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actions: { flexDirection: 'row', gap: 10 },
});
