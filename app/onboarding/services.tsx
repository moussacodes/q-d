import { Pressable } from 'react-native';

import { Button, Intro, Screen, ScreenHeader, Stepper, Text, useScreenPalette } from '@/components';
import { useMockSession } from '@/features/session/MockSession';
import { ServicesSection } from '@/features/settings/ServicesSection';

/**
 * 1.4 Onboarding step 2, the last: connecting a service is optional
 * (plan.md §2). Continue and Skip both finish onboarding on Home.
 */
export default function OnboardingServices() {
  useScreenPalette();
  const { finishOnboarding } = useMockSession();
  const next = () => finishOnboarding();
  return (
    <Screen
      header={
        <ScreenHeader
          center={<Stepper step={2} />}
          right={
            <Pressable accessibilityRole="button" onPress={next} hitSlop={10}>
              <Text variant="label" color="text2">
                Skip
              </Text>
            </Pressable>
          }
        />
      }
      footer={<Button block label="Continue" onPress={next} />}
    >
      <Intro
        eyebrow="Step 2 of 2 · Connect"
        title="Bring your own music."
        body="Connect a service to host rooms from this phone. You don’t need one to join a friend’s room."
      />
      <ServicesSection />
    </Screen>
  );
}
