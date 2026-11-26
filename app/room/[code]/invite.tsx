import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Share, StyleSheet, View } from 'react-native';

import { Button, Chip, Panel, QrCode, SheetHeader, SheetScreen, Text } from '@/components';
import { typography, useTheme } from '@/design';
import { isMockInviteToken } from '@/domain/invite';
import { spokenRoomCode } from '@/domain/room-code';
import { createInviteErrorMessage } from '@/features/room/errorCopy';
import { RoomGate } from '@/features/room/RoomGate';
import { useRoom, useRoomInvite, type RoomView } from '@/features/room/useRoom';

/** Upper bound for the QR so it stays square and in proportion on tablets. */
const QR_MAX_SIZE = 320;

/** How long "Link copied" shows before the button reads "Copy link" again. */
const COPIED_MS = 2000;

/**
 * 3.5 Invite people. Only the host invites (PRODUCT_SPEC.md §4). The QR code
 * and the link carry an invite token from `create_room_invite`, never the
 * room code, which is shown on its own for reading aloud. Ask-before-join is
 * post-demo and intentionally absent.
 *
 * The code card sits centered in the space under the header and the QR fills
 * the card's width, so a phone across the table can scan it quickly. Copy
 * link and Share are pinned to the bottom of the sheet.
 */
function InviteSheet() {
  const { code, view } = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost } = useRoom(code, view);
  const { link, token, state, replace } = useRoomInvite(room.code, isHost);
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!isHost) {
    return (
      <SheetScreen>
        <SheetHeader title="Invite people" />
        <Panel>
          <Text variant="bodyStrong">Only {room.hostName} can invite people.</Text>
          <Text variant="caption" color="text2">
            Ask them for the room code or a link.
          </Text>
        </Panel>
      </SheetScreen>
    );
  }

  const making = state.status === 'pending';
  const failed = state.status === 'failed';
  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    AccessibilityInfo.announceForAccessibility('Invite link copied');
  };
  const share = async () => {
    if (!link) return;
    try {
      await Share.share({ message: `Join “${room.name}” on q’d: ${link}` });
    } catch {
      // A closed or failed share sheet changes nothing here.
    }
  };

  const everyoneAdds = room.rules.addSongs.who === 'everyone';

  return (
    <SheetScreen
      contentStyle={styles.fill}
      footer={
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              block
              kind="secondary"
              icon={copied ? 'check' : 'copy'}
              label={copied ? 'Link copied' : 'Copy link'}
              accessibilityLabel="Copy link"
              disabled={!link || making}
              onPress={copy}
            />
          </View>
          <View style={styles.flex}>
            <Button block icon="share" label="Share" disabled={!link || making} onPress={share} />
          </View>
        </View>
      }
    >
      <SheetHeader
        title="Invite people"
        subtitle={`Anyone with the code or link can join${
          everyoneAdds ? ' and add songs' : ''
        }. No music service needed.`}
      />
      <View style={styles.center}>
        <Panel style={styles.codeCard}>
          <Text variant="eyebrow" color="text3">
            Room code
          </Text>
          <Text
            variant="title"
            style={styles.code}
            accessibilityLabel={`Room code ${spokenRoomCode(room.code)}`}
          >
            {room.code}
          </Text>
          <Text variant="caption" color="text2">
            Read it out, or let people scan the QR code.
          </Text>

          {link && !making ? (
            <QrCode
              value={link}
              color={colors.bg}
              background={colors.text}
              accessibilityLabel="QR code with the invite link"
              style={styles.qr}
            />
          ) : (
            <View style={[styles.qr, styles.qrPlaceholder, { borderColor: colors.stroke }]}>
              <Text
                variant="caption"
                color={failed ? 'statusWarn' : 'text2'}
                accessibilityRole={failed ? 'alert' : undefined}
                accessibilityLiveRegion="polite"
                style={styles.centerText}
              >
                {failed ? createInviteErrorMessage(state.error) : 'Making an invite link…'}
              </Text>
              {failed ? (
                <Button size="small" kind="secondary" label="Try again" onPress={replace} />
              ) : null}
            </View>
          )}

          {token && isMockInviteToken(token) ? (
            <Chip label="Mock invite · not a working link" tone="warn" />
          ) : null}
        </Panel>

        {link ? (
          <View style={styles.renew}>
            <Button
              size="small"
              kind="ghost"
              icon="refresh"
              label="Make a new link"
              accessibilityHint="The current QR code and link stop working"
              disabled={making}
              onPress={replace}
            />
            {failed ? (
              // The new link wasn't made, so the one on screen still works.
              <Text
                variant="caption"
                color="statusWarn"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.centerText}
              >
                {createInviteErrorMessage(state.error)} The current link still works.
              </Text>
            ) : (
              <Text variant="caption" color="text3" style={styles.centerText}>
                The old QR code and link stop working. The room code stays the same.
              </Text>
            )}
          </View>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', gap: 12 },
  codeCard: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  code: { fontFamily: typography.eyebrow.fontFamily, letterSpacing: 2 },
  qr: {
    width: '100%',
    maxWidth: QR_MAX_SIZE,
    aspectRatio: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  qrPlaceholder: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
  },
  centerText: { textAlign: 'center' },
  renew: { alignItems: 'center', gap: 4 },
  actions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
});

/** Waits for the room (live rooms are read from Supabase) before showing it. */
export default function InviteSheetRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <RoomGate code={code}>
      <InviteSheet />
    </RoomGate>
  );
}
