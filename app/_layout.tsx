import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { fontAssets, neutral, ThemeProvider } from '@/design';
import { MockSessionProvider } from '@/features/session/MockSession';

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
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: neutral.bg },
          }}
        >
          <Stack.Screen name="room/[code]/queue" options={sheet} />
          <Stack.Screen name="room/[code]/add-song" options={sheet} />
          <Stack.Screen name="room/[code]/invite" options={sheet} />
          <Stack.Screen name="room/[code]/listeners" options={sheet} />
        </Stack>
      </MockSessionProvider>
    </ThemeProvider>
  );
}
