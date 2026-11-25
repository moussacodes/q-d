import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { fontAssets, neutral, ThemeProvider } from '@/design';
import { AuthSync } from '@/features/auth/AuthSync';
import { ProviderConnectionsProvider } from '@/features/connections/ProviderConnections';
import { MockModeFrame } from '@/features/dev/MockModeFrame';
import { RoomsProvider } from '@/features/room/useRoom';
import { ServerStateProvider } from '@/features/server-state/ServerStateProvider';
import { landingFor, MockSessionProvider, useMockSession } from '@/features/session/MockSession';

SplashScreen.preventAutoHideAsync();

const sheet = { presentation: 'modal', contentStyle: { backgroundColor: neutral.bg } } as const;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const ready = fontsLoaded || fontError !== null;

  if (!ready) {
    return null;
  }

  return (
    <ServerStateProvider>
      <ThemeProvider>
        <MockSessionProvider>
          <ProviderConnectionsProvider>
            <RoomsProvider>
              <AuthSync />
              <StatusBar style="light" />
              <MockModeFrame>
                <RootStack />
              </MockModeFrame>
            </RoomsProvider>
          </ProviderConnectionsProvider>
        </MockSessionProvider>
      </ThemeProvider>
    </ServerStateProvider>
  );
}

/**
 * Routes by sign-in state (docs/DECISIONS.md, "Auth and onboarding
 * navigation"). A screen outside the current state's group redirects to
 * that state's landing screen: Welcome, onboarding step 1 or Home.
 */
function RootStack() {
  const { auth, restoring } = useMockSession();
  const redirectTo = landingFor[auth];

  // The splash stays up until fonts are loaded and, in live auth mode, the
  // stored session has been restored, so a signed-in person never sees
  // Welcome. The navigator mounts straight away (Expo Router needs it) but
  // stays hidden until then.
  useEffect(() => {
    if (!restoring) SplashScreen.hideAsync();
  }, [restoring]);

  return (
    <View style={[styles.fill, restoring && styles.hidden]}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: neutral.bg } }}>
        <Stack.Protected guard={auth === 'signedOut'} redirectTo={redirectTo}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="create-account" />
        </Stack.Protected>

        <Stack.Protected guard={auth === 'onboarding'} redirectTo={redirectTo}>
          <Stack.Screen name="onboarding/name" />
          <Stack.Screen name="onboarding/services" />
          <Stack.Screen name="onboarding/start" />
        </Stack.Protected>

        <Stack.Protected guard={auth === 'ready'} redirectTo={redirectTo}>
          <Stack.Screen name="home" />
          <Stack.Screen name="join" />
          <Stack.Screen name="create-room" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="room/[code]/index" />
          <Stack.Screen name="room/[code]/queue" options={sheet} />
          <Stack.Screen name="room/[code]/add-song" options={sheet} />
          <Stack.Screen name="room/[code]/invite" options={sheet} />
          <Stack.Screen name="room/[code]/listeners" options={sheet} />
        </Stack.Protected>

        {/* Sign-in redirects land here in any state (Google, email links). */}
        <Stack.Screen name="auth/callback" />

        <Stack.Protected guard={__DEV__} redirectTo={redirectTo}>
          <Stack.Screen name="dev/index" />
          <Stack.Screen name="dev/components" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
});
