import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Cover,
  Logo,
  ProviderBadge,
  Screen,
  SCREEN_PADDING,
  Text,
  useScreenPalette,
} from '@/components';
import { AppleButton } from '@/features/auth/AppleButton';
import { useSocialSignIn } from '@/features/auth/useSocialSignIn';

/**
 * 1.1 Welcome. In mock auth mode, Apple and Google here start a new account
 * (onboarding); Sign in is for returning users. In live auth mode they sign
 * in for real; Sign in with Apple shows only on iOS.
 */
export default function Welcome() {
  useScreenPalette();
  const social = useSocialSignIn('create-account');
  return (
    <Screen
      contentStyle={styles.content}
      header={
        <View style={styles.topBar}>
          <Logo dot={false} />
          {__DEV__ ? (
            <Button
              kind="ghost"
              size="small"
              icon="sliders"
              label="Screens"
              onPress={() => router.push('/dev')}
            />
          ) : null}
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
        <Text variant="display">Different apps. One aux.</Text>
        <Text variant="footnote" color="text2">
          Friends on Apple Music, Spotify or no service at all add songs to one shared queue. The
          host’s phone plays it.
        </Text>
      </View>
      <View style={styles.actions}>
        {social.error ? (
          <Text
            variant="caption"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {social.error}
          </Text>
        ) : null}
        <AppleButton
          kind={social.appleButton}
          disabled={social.pending !== null}
          onPress={() => void social.continueWith('apple')}
        />
        <Button
          block
          kind="secondary"
          icon="google"
          label={social.pending === 'google' ? 'Opening Google…' : 'Continue with Google'}
          disabled={social.pending !== null}
          onPress={() => void social.continueWith('google')}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The covers, hook and sign-in options sit together, centred under the top
  // bar. The screen scrolls so short phones can still reach every option.
  content: { flexGrow: 1, justifyContent: 'center', gap: 28 },
  topBar: {
    height: 56,
    paddingHorizontal: SCREEN_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
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
