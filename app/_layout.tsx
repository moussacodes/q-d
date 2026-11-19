import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { fontAssets, neutral, ThemeProvider } from '@/design';
import { ProviderConnectionsProvider } from '@/features/connections/ProviderConnections';
import { MockModeFrame } from '@/features/dev/MockModeFrame';
import { landingFor, MockSessionProvider, useMockSession } from '@/features/session/MockSession';

SplashScreen.preventAutoHideAsync();

const sheet = { presentation: 'modal', contentStyle: { backgroundColor: neutral.bg } } as const;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <ThemeProvider>
      <MockSessionProvider>
        <ProviderConnectionsProvider>
          <StatusBar style="light" />
          <MockModeFrame>
            <RootStack />
          </MockModeFrame>
        </ProviderConnectionsProvider>
      </MockSessionProvider>
    </ThemeProvider>
  );
}

/**
 * Routes by sign-in state (docs/DECISIONS.md, "Auth and onboarding
 * navigation"). A screen outside the current state's group redirects to
 * that state's landing screen: Welcome, onboarding step 1 or Home.
 */
function RootStack() {
  const { auth } = useMockSession();
  const redirectTo = landingFor[auth];
  return (
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

      <Stack.Protected guard={__DEV__} redirectTo={redirectTo}>
        <Stack.Screen name="dev/index" />
        <Stack.Screen name="dev/components" />
      </Stack.Protected>
    </Stack>
  );
}
