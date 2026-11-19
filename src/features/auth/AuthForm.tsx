import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Intro, Screen, ScreenHeader, Text, TextField, useScreenPalette } from '@/components';
import { useTheme } from '@/design';

type AuthFormProps = {
  title: string;
  body: string;
  submitLabel: string;
  /** Where the mock submit goes. */
  next: Href;
  showForgot?: boolean;
  switchPrompt: string;
  switchLabel: string;
  switchTo: Href;
};

/** 1.2 Sign in, also used for account creation. Mock only: no real auth yet. */
export function AuthForm({
  title,
  body,
  submitLabel,
  next,
  showForgot,
  switchPrompt,
  switchLabel,
  switchTo,
}: AuthFormProps) {
  useScreenPalette();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <View style={styles.passwordRow}>
          <TextField
            label="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="password"
            textContentType="password"
            icon="eye"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            onPress={() => setShowPassword((v) => !v)}
            style={styles.eye}
          />
        </View>
        {showForgot ? (
          <Text variant="caption" color="text2" style={styles.forgot}>
            Forgot password?
          </Text>
        ) : null}
        <Button block label={submitLabel} onPress={() => router.replace(next)} />
      </View>
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: colors.stroke }]} />
        <Text variant="caption" color="text3">
          or
        </Text>
        <View style={[styles.line, { backgroundColor: colors.stroke }]} />
      </View>
      <View style={styles.form}>
        <Button block icon="apple" label="Continue with Apple" onPress={() => router.replace(next)} />
        <Button
          block
          kind="secondary"
          icon="google"
          label="Continue with Google"
          onPress={() => router.replace(next)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  passwordRow: { position: 'relative' },
  eye: { position: 'absolute', right: 0, bottom: 0, width: 52, height: 52 },
  forgot: { alignSelf: 'flex-end' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 1 },
});
