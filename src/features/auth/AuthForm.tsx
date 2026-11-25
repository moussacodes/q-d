import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Intro,
  Screen,
  ScreenHeader,
  Text,
  TextField,
  useScreenPalette,
} from '@/components';
import { useTheme } from '@/design';

import { useEmailAuth } from './useEmailAuth';
import { useSocialSignIn } from './useSocialSignIn';

type AuthFormProps = {
  title: string;
  body: string;
  submitLabel: string;
  /** Shown on the button while the request runs, e.g. "Signing in…". */
  busyLabel: string;
  /** Signing in goes to Home; creating an account goes to onboarding. */
  mode: 'sign-in' | 'create-account';
  showForgot?: boolean;
  switchPrompt: string;
  switchLabel: string;
  switchTo: Href;
};

/**
 * 1.2 Sign in, also used for account creation. The email form is checked
 * before sending and shows each failure in words (features/auth/messages.ts).
 * In mock auth mode it signs in with the mock session; in live mode with
 * Supabase Auth.
 */
export function AuthForm({
  title,
  body,
  submitLabel,
  busyLabel,
  mode,
  showForgot,
  switchPrompt,
  switchLabel,
  switchTo,
}: AuthFormProps) {
  useScreenPalette();
  const { colors } = useTheme();
  const form = useEmailAuth(mode);
  const social = useSocialSignIn(mode);
  const [showPassword, setShowPassword] = useState(false);
  const formMessage = form.formError ?? social.error;

  return (
    <Screen
      header={<ScreenHeader />}
      footer={
        <Pressable accessibilityRole="link" onPress={() => router.replace(switchTo)} hitSlop={8}>
          <Text variant="caption" color="text2">
            {switchPrompt} <Text variant="caption">{switchLabel}</Text>
          </Text>
        </Pressable>
      }
    >
      <Intro title={title} body={body} />
      <View style={styles.form}>
        <TextField
          label="Email"
          placeholder="you@example.com"
          value={form.email}
          onChangeText={form.setEmail}
          editable={!form.submitting}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <FieldError message={form.emailError} />
        <View style={styles.passwordRow}>
          <TextField
            label="Password"
            placeholder="Password"
            value={form.password}
            onChangeText={form.setPassword}
            editable={!form.submitting}
            secureTextEntry={!showPassword}
            autoComplete={mode === 'sign-in' ? 'password' : 'new-password'}
            textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
            icon="eye"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            onPress={() => setShowPassword((v) => !v)}
            style={styles.eye}
          />
        </View>
        <FieldError message={form.passwordError} />
        {showForgot ? (
          <Text variant="caption" color="text2" style={styles.forgot}>
            Forgot password?
          </Text>
        ) : null}
        {formMessage ? (
          <Text
            variant="caption"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {formMessage}
          </Text>
        ) : null}
        {form.notice ? (
          <Text variant="caption" color="statusOk" accessibilityLiveRegion="polite">
            {form.notice}
          </Text>
        ) : null}
        <Button
          block
          label={form.submitting ? busyLabel : submitLabel}
          disabled={form.submitting}
          accessibilityState={{ busy: form.submitting, disabled: form.submitting }}
          onPress={() => void form.submit()}
        />
      </View>
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: colors.stroke }]} />
        <Text variant="caption" color="text3">
          or
        </Text>
        <View style={[styles.line, { backgroundColor: colors.stroke }]} />
      </View>
      <View style={styles.form}>
        <Button
          block
          icon="apple"
          label="Continue with Apple"
          disabled={form.submitting}
          onPress={() => social.continueWith('apple')}
        />
        <Button
          block
          kind="secondary"
          icon="google"
          label="Continue with Google"
          disabled={form.submitting}
          onPress={() => social.continueWith('google')}
        />
      </View>
    </Screen>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text
      variant="caption"
      color="danger"
      accessibilityLiveRegion="polite"
      style={styles.fieldError}
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  fieldError: { marginTop: -8 },
  form: { gap: 14 },
  passwordRow: { position: 'relative' },
  eye: { position: 'absolute', right: 0, bottom: 0, width: 52, height: 52 },
  forgot: { alignSelf: 'flex-end' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 1 },
});
