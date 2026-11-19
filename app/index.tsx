import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Cover,
  Logo,
  ProviderBadge,
  Screen,
  Text,
  useScreenPalette,
} from '@/components';

/** 1.1 Welcome. Sign-in buttons are mock until the auth cards land. */
export default function Welcome() {
  useScreenPalette();
  return (
    <Screen
      scroll={false}
      contentStyle={styles.content}
      header={
        __DEV__ ? (
          <View style={styles.devRow}>
            <Button
              kind="ghost"
              size="small"
              icon="sliders"
              label="Screens"
              onPress={() => router.push('/dev')}
            />
          </View>
        ) : undefined
      }
      footer={
        <View style={styles.actions}>
          <Button
            block
            icon="apple"
            label="Continue with Apple"
            onPress={() => router.push('/onboarding/name')}
          />
          <Button
            block
            kind="secondary"
            icon="google"
            label="Continue with Google"
            onPress={() => router.push('/onboarding/name')}
          />
          <Button
            block
            kind="secondary"
            icon="mail"
            label="Continue with email"
            onPress={() => router.push('/create-account')}
          />
          <Pressable accessibilityRole="link" onPress={() => router.push('/sign-in')} hitSlop={8}>
            <Text variant="caption" color="text2">
              Already have an account? <Text variant="caption">Sign in</Text>
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.hero}>
        <View style={[styles.fanned, styles.left]}>
          <Cover size={120} radius={16} />
        </View>
        <View style={[styles.fanned, styles.right]}>
          <Cover size={120} radius={16} />
        </View>
        <View style={styles.center}>
          <Cover size={150} radius={18} />
        </View>
        <View style={styles.badgeLeft}>
          <ProviderBadge provider="spotify" />
        </View>
        <View style={styles.badgeRight}>
          <ProviderBadge provider="apple_music" />
        </View>
      </View>
      <View style={styles.intro}>
        <Logo />
        <Text variant="display">Different apps. One aux.</Text>
        <Text variant="footnote" color="text2">
          Friends on Apple Music, Spotify or no service at all add songs to one shared queue. The
          host’s phone plays it.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'flex-end', gap: 28 },
  devRow: { alignItems: 'flex-end', paddingHorizontal: 12 },
  hero: { height: 230, alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute' },
  fanned: { position: 'absolute', opacity: 0.85 },
  left: { transform: [{ translateX: -90 }, { rotate: '-10deg' }] },
  right: { transform: [{ translateX: 90 }, { rotate: '10deg' }] },
  badgeLeft: { position: 'absolute', left: 8, top: 18 },
  badgeRight: { position: 'absolute', right: 8, top: 4 },
  intro: { gap: 12 },
  actions: { alignSelf: 'stretch', gap: 10, alignItems: 'center' },
});
