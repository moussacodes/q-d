import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Intro, Screen, Text, useScreenPalette } from '@/components';
import { useTheme } from '@/design';
import { useAuthCallback } from '@/features/auth/useAuthCallback';

/**
 * Where Google and email links bring people back (`qd://auth/callback`).
 * Finishes the sign-in, or says why it couldn't and offers a way back.
 */
export default function AuthCallback() {
  useScreenPalette();
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const state = useAuthCallback(params);

  if (state.status !== 'failed') {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator color={colors.accent} accessibilityLabel="Signing you in" />
        <Text variant="footnote" color="text2">
          Signing you in…
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={styles.actions}>
          <Button block label="Back to sign in" onPress={() => router.replace('/sign-in')} />
          <Button block kind="ghost" label="Go to Welcome" onPress={() => router.replace('/')} />
        </View>
      }
    >
      <Intro title="That didn’t work." body={state.message} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  actions: { gap: 10 },
});
