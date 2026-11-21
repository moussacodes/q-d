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
import { useTheme } from '@/design';
import { avatarColors, mockUser } from '@/test/fixtures/mock-data';

/** 1.3 Onboarding step 1: name, color and 18+ confirmation (plan.md §2). */
export default function OnboardingName() {
  useScreenPalette();
  const { colors } = useTheme();
  const [name, setName] = useState(mockUser.name);
  const [color, setColor] = useState(avatarColors[0]);
  const [adult, setAdult] = useState(false);
  const displayName = name.trim() || 'You';

  return (
    <Screen
      header={<ScreenHeader center={<Stepper step={1} />} />}
      footer={
        <Button
          block
          label="Continue"
          disabled={!name.trim() || !adult}
          onPress={() => router.push('/onboarding/services')}
        />
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
        onChangeText={setName}
        autoCapitalize="words"
        textContentType="nickname"
      />
      <View style={styles.group}>
        <SectionLabel>Your color</SectionLabel>
        <View style={styles.swatches}>
          {avatarColors.map((swatch) => {
            const selected = swatch === color;
            return (
              <Pressable
                key={swatch}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Color ${swatch}`}
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
