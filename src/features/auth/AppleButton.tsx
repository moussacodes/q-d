import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components';

import type { AppleButtonKind } from './useSocialSignIn';

/** Matches the large Button (52 pt tall, fully rounded), so the options line up. */
const HEIGHT = 52;
const CORNER_RADIUS = 26;

/**
 * "Continue with Apple". In live auth mode on iOS it's Apple's own button
 * (Human Interface Guidelines: the system button, white on q’d's dark
 * background, "Continue with Apple"), which opens the native sheet. On the
 * web and Android it isn't shown. In mock auth mode it's q’d's button, which
 * starts a mock account.
 */
export function AppleButton({
  kind,
  disabled,
  onPress,
}: {
  kind: AppleButtonKind;
  disabled: boolean;
  onPress: () => void;
}) {
  if (kind === 'hidden') return null;
  if (kind === 'mock') {
    return (
      <Button
        block
        icon="apple"
        label="Continue with Apple"
        disabled={disabled}
        onPress={onPress}
      />
    );
  }
  // Apple's button has no disabled state; while another sign-in runs it
  // ignores touches and dims like q’d's disabled buttons.
  return (
    <View
      pointerEvents={disabled ? 'none' : 'auto'}
      accessibilityState={{ disabled }}
      style={[styles.wrap, disabled && styles.disabled]}
    >
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={CORNER_RADIUS}
        style={styles.button}
        onPress={() => {
          if (!disabled) onPress();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  button: { height: HEIGHT, width: '100%' },
  disabled: { opacity: 0.4 },
});
