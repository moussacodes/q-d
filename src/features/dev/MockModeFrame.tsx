import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components';
import { neutral } from '@/design';
import { isLiveAuth, isMockMode } from '@/services/dataMode';

const STRIP_HEIGHT = 20;

/**
 * In mock mode, a strip under the status bar says that nothing on screen is
 * live, so sample rooms, people and "connected" services are never mistaken
 * for real ones. When sign-in is live but rooms are still mock, it says so. Screens below it see a top inset of 0, so their layout is
 * unchanged apart from starting lower.
 */
export function MockModeFrame({
  children,
  liveAuth = isLiveAuth,
}: {
  children: ReactNode;
  liveAuth?: boolean;
}) {
  const insets = useSafeAreaInsets();
  if (!isMockMode) {
    return children;
  }
  return (
    <View style={styles.frame}>
      <View
        style={[styles.strip, { paddingTop: insets.top, height: insets.top + STRIP_HEIGHT }]}
        accessible
        accessibilityLabel={
          liveAuth
            ? 'Mock data. Sign-in is live, but rooms, people and music services are sample data.'
            : 'Mock data. No real accounts, rooms or music services are connected.'
        }
      >
        <Text variant="eyebrow" color="statusWarn">
          {liveAuth ? 'Mock data · only sign-in is live' : 'Mock data · nothing here is live'}
        </Text>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.frame}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: neutral.bg },
  strip: { alignItems: 'center', justifyContent: 'center' },
});
