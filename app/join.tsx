import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Intro, Screen, Text, useScreenPalette } from '@/components';
import { inviteJoinErrorMessage } from '@/features/room/errorCopy';
import { useJoinByInvite } from '@/features/room/useRoom';

/**
 * Where an invite link lands: `qd://join?invite=<token>`, from a scanned QR
 * code or a shared link. It isn't a screen for typing a code (that's on
 * Home): it calls `join_room_by_invite` and opens the room, or says why it
 * can't. Without a token it goes to Home.
 */
export default function JoinInvite() {
  useScreenPalette();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const { state, join } = useJoinByInvite();

  useEffect(() => {
    if (!invite) {
      router.replace('/home');
      return;
    }
    join(invite).then((room) => {
      if (room) router.replace({ pathname: '/room/[code]', params: { code: room.code } });
    });
  }, [invite, join]);

  const failed = state.status === 'failed';

  return (
    <Screen
      footer={
        failed ? (
          <Button block label="Go to Home" onPress={() => router.replace('/home')} />
        ) : undefined
      }
    >
      <View style={styles.body}>
        <Intro
          title={failed ? 'Couldn’t join.' : 'Joining the room…'}
          body={failed ? undefined : 'Checking the invite.'}
        />
        {failed ? (
          <Text
            variant="body"
            color="statusWarn"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {inviteJoinErrorMessage(state.error)}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
});
