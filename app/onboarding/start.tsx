import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Icon,
  Intro,
  Panel,
  Screen,
  ScreenHeader,
  Stepper,
  Text,
  useScreenPalette,
  type IconName,
} from '@/components';
import { useTheme } from '@/design';

/** 1.5 Onboarding step 3: start or join. */
export default function OnboardingStart() {
  useScreenPalette();
  return (
    <Screen
      header={<ScreenHeader center={<Stepper step={3} />} />}
      footer={
        <Button
          block
          kind="ghost"
          label="I’ll do this later"
          onPress={() => router.replace('/home')}
        />
      }
    >
      <Intro
        eyebrow="Step 3 of 3 · Listen"
        title="You’re all set."
        body="Start your own room, or hop into a friend’s with their code."
      />
      <View style={styles.options}>
        <Option
          icon="plus"
          title="Start a room"
          body="You set the queue going. Friends join with a code."
          href="/create-room"
        />
        <Option
          icon="hash"
          title="Join with a code"
          body="Got a code like QD-7K4F9X? Pop it in."
          href="/join"
        />
      </View>
    </Screen>
  );
}

function Option({
  icon,
  title,
  body,
  href,
}: {
  icon: IconName;
  title: string;
  body: string;
  href: Href;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)}>
      <Panel style={styles.option}>
        <View style={[styles.iconCircle, { backgroundColor: colors.surfaceRaised }]}>
          <Icon name={icon} size={20} />
        </View>
        <View style={styles.optionText}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="text2">
            {body}
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.text3} />
      </Panel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  optionText: { flex: 1, gap: 2 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
