import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Button,
  Intro,
  Panel,
  Screen,
  ScreenHeader,
  SectionLabel,
  Stepper,
  Text,
  TextField,
  Toggle,
  useScreenPalette,
} from '@/components';
import { avatarSwatches, useTheme } from '@/design';
import { MAX_NAME_LENGTH, useMockSession } from '@/features/session/MockSession';
import { useProfileSave } from '@/features/session/useProfileSave';

/**
 * 1.3 Onboarding step 1: display name, color and 18+ confirmation
 * (plan.md §2). Continue saves the profile; all three are required. In live
 * auth mode it waits for the server and stays here, saying why, if the save
 * fails. Back cancels sign-up and returns to Welcome.
 */
export default function OnboardingName() {
  useScreenPalette();
  const { colors } = useTheme();
  const { suggestedName, signOut } = useMockSession();
  const { saveOnboarding, saving, errorMessage, clearError } = useProfileSave();
  const [name, setName] = useState(suggestedName);
  const [color, setColor] = useState<string>(avatarSwatches[0]);
  const [adult, setAdult] = useState(false);
  const trimmed = name.trim();
  const displayName = trimmed || 'You';

  const next = async () => {
    if (await saveOnboarding({ displayName: name, color, adultConfirmed: adult })) {
      router.push('/onboarding/services');
    }
  };

  return (
    <Screen
      header={<ScreenHeader center={<Stepper step={1} />} onBack={signOut} />}
      footer={
        <>
          {errorMessage ? (
            <Text variant="caption" color="danger" accessibilityRole="alert">
              {errorMessage}
            </Text>
          ) : null}
          <Button
            block
            label={saving ? 'Saving…' : 'Continue'}
            disabled={!trimmed || !adult || saving}
            onPress={() => void next()}
          />
        </>
      }
    >
      <Intro
        eyebrow="Step 1 of 3 · You"
        title="What should we call you?"
        body="Your name shows up next to the songs you add."
      />
      <TextField
        label="Display name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          clearError();
        }}
        placeholder="Your name"
        maxLength={MAX_NAME_LENGTH}
        autoCapitalize="words"
        textContentType="nickname"
      />
      <View style={styles.group}>
        <SectionLabel>Your color</SectionLabel>
        <View style={styles.swatches}>
          {avatarSwatches.map((swatch, index) => {
            const selected = swatch === color;
            return (
              <Pressable
                key={swatch}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Color ${index + 1} of ${avatarSwatches.length}`}
                onPress={() => setColor(swatch)}
                style={[styles.ring, selected && { borderColor: colors.text }]}
              >
                <View style={[styles.swatch, { backgroundColor: swatch }]} />
              </Pressable>
            );
          })}
        </View>
      </View>
      <Panel style={styles.preview}>
        <Avatar initial={displayName[0].toUpperCase()} color={color} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{displayName}</Text>
          <Text variant="caption" color="text2">
            How you’ll show up: “Added by {displayName}”
          </Text>
        </View>
      </Panel>
      <Panel style={styles.preview}>
        <View style={styles.flex}>
          <Text variant="bodyStrong">I’m 18 or older</Text>
          <Text variant="caption" color="text2">
            q’d is for adults during the beta.
          </Text>
        </View>
        <Toggle value={adult} onValueChange={setAdult} accessibilityLabel="I’m 18 or older" />
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: 12 },
  swatches: { flexDirection: 'row', gap: 10 },
  ring: { borderRadius: 20, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
