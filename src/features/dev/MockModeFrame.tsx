import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components';
import { neutral } from '@/design';
import { isMockMode } from '@/services/dataMode';

const STRIP_HEIGHT = 20;

/**
 * In mock mode, a strip under the status bar says that nothing on screen is
 * live, so sample rooms, people and "connected" services are never mistaken
 * for real ones. Screens below it see a top inset of 0, so their layout is
 * unchanged apart from starting lower.
 */
export function MockModeFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  if (!isMockMode) {
    return children;
  }
  return (
    <View style={styles.frame}>
      <View
        style={[styles.strip, { paddingTop: insets.top, height: insets.top + STRIP_HEIGHT }]}
        accessible
        accessibilityLabel="Mock data. No real accounts, rooms or music services are connected."
      >
        <Text variant="eyebrow" color="statusWarn">
          Mock data · nothing here is live
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
