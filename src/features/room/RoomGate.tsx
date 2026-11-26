import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Panel, Screen, ScreenHeader, Text, useScreenPalette } from '@/components';
import { roomKeys } from '@/services/roomQueryKeys';

import { useRoomStatus } from './useRoom';

/** What a room route says before it can show the room (live rooms only; mock rooms are ready). */
export const roomGateCopy = {
  loading: 'Opening the room…',
  missingTitle: 'This room isn’t open to you',
  missingBody:
    'The code may be mistyped, the room may have ended, or you haven’t joined it yet. Join with the code on Home.',
  errorTitle: 'Couldn’t load the room',
  errorBody: 'q’d couldn’t reach the room just now. Check your connection, then try again.',
};

/**
 * Waits for the room behind `/room/QD-…` before the room screens render, so
 * they never show a half-read room. Live rooms are read from Supabase and
 * only rooms you're in can be read (RLS), so a code you haven't joined says
 * so instead of guessing. Mock rooms render at once.
 */
export function RoomGate({ code, children }: { code: string | undefined; children: ReactNode }) {
  const status = useRoomStatus(code);
  if (status === 'ready') return children;
  return <RoomGateScreen status={status} />;
}

function RoomGateScreen({ status }: { status: 'loading' | 'missing' | 'error' }) {
  useScreenPalette();
  const queryClient = useQueryClient();
  return (
    <Screen header={<ScreenHeader title="Room" />}>
      {status === 'loading' ? (
        <Text variant="footnote" color="text2" accessibilityLiveRegion="polite">
          {roomGateCopy.loading}
        </Text>
      ) : (
        <Panel style={styles.panel}>
          <View style={styles.text} accessibilityLiveRegion="polite">
            <Text variant="bodyStrong">
              {status === 'missing' ? roomGateCopy.missingTitle : roomGateCopy.errorTitle}
            </Text>
            <Text variant="caption" color="text2">
              {status === 'missing' ? roomGateCopy.missingBody : roomGateCopy.errorBody}
            </Text>
          </View>
          <View style={styles.actions}>
            {status === 'error' ? (
              <Button
                size="small"
                label="Try again"
                onPress={() => {
                  void queryClient.invalidateQueries({ queryKey: roomKeys.all });
                  void queryClient.invalidateQueries({ queryKey: ['room-code'] });
                }}
              />
            ) : null}
            <Button
              size="small"
              kind="secondary"
              label="Back to Home"
              onPress={() => router.replace('/home')}
            />
          </View>
        </Panel>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  text: { gap: 2 },
  actions: { flexDirection: 'row', gap: 8 },
});
