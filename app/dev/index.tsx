import { type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Screen, ScreenHeader, SectionLabel, Text, useScreenPalette } from '@/components';
import { useTheme } from '@/design';
import { useMockSession, type AuthStatus } from '@/features/session/MockSession';

const room = 'QD-7K4F9X';

const sections: { title: string; links: { label: string; href: Href; enter?: boolean }[] }[] = [
  {
    title: '1 · Sign-in & onboarding',
    links: [
      { label: '1.1 Welcome', href: '/' },
      { label: '1.2 Sign in', href: '/sign-in' },
      { label: 'Create account', href: '/create-account' },
      { label: '1.3 Step 1 · Your name', href: '/onboarding/name' },
      { label: '1.4 Step 2 · Music services', href: '/onboarding/services' },
      { label: '1.5 Step 3 · Start or join', href: '/onboarding/start' },
    ],
  },
  {
    title: '2 · Home & joining',
    links: [
      { label: '2.1 Home · nothing playing', href: '/home' },
      { label: '2.2 Home · room playing (mini player)', href: '/home', enter: true },
      { label: '2.3 Join with a code', href: '/join' },
      { label: '2.4 Start a room', href: '/create-room' },
    ],
  },
  {
    title: '3 · Room',
    links: [
      { label: '3.1 Room · host', href: { pathname: '/room/[code]', params: { code: room } } },
      { label: '3.3 Up next', href: { pathname: '/room/[code]/queue', params: { code: room } } },
      {
        label: '3.4 Add a song',
        href: { pathname: '/room/[code]/add-song', params: { code: room } },
      },
      {
        label: '3.5 Invite people',
        href: { pathname: '/room/[code]/invite', params: { code: room } },
      },
      {
        label: '3.6 Listeners',
        href: { pathname: '/room/[code]/listeners', params: { code: room } },
      },
    ],
  },
  {
    title: '4 · Room states',
    links: [
      {
        label: '4.1 Listener view',
        href: { pathname: '/room/[code]', params: { code: room, view: 'listener' } },
      },
      {
        label: '4.2 Empty queue',
        href: { pathname: '/room/[code]', params: { code: room, view: 'empty' } },
      },
      {
        label: '4.3 Song not on host’s service',
        href: { pathname: '/room/[code]', params: { code: room, view: 'unavailable' } },
      },
    ],
  },
  {
    title: '5 · Settings',
    links: [
      { label: '5.1 Music services', href: '/settings' },
      { label: '5.2 Account', href: { pathname: '/settings', params: { tab: 'account' } } },
    ],
  },
  {
    title: 'Design system',
    links: [{ label: 'Component gallery', href: '/dev/components' }],
  },
];

/** The sign-in state a screen belongs to, so its route guard lets it open. */
function authFor(href: Href): AuthStatus {
  const path = typeof href === 'string' ? href : href.pathname;
  if (path === '/' || path === '/sign-in' || path === '/create-account') return 'signedOut';
  if (path.startsWith('/onboarding')) return 'onboarding';
  return 'ready';
}

/**
 * Development-only index of every screen shell, matching the Figma sections.
 * Opening a screen switches the mock session to the state that screen needs.
 */
export default function ScreenIndex() {
  useScreenPalette();
  const { colors } = useTheme();
  const { enterRoom, leaveRoom, previewAs } = useMockSession();
  return (
    <Screen header={<ScreenHeader title="Screens" />}>
      <Text variant="footnote" color="text2">
        Every screen shell, numbered like the Figma page. Mock data only. Opening a screen switches
        the mock sign-in state to the one it needs. Tip: 3.2 Expanded is the resize button on the
        room cover.
      </Text>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <SectionLabel>{section.title}</SectionLabel>
          {section.links.map((link) => (
            <Pressable
              key={link.label}
              accessibilityRole="link"
              onPress={() => {
                if (link.enter) enterRoom(room);
                else if (link.href === '/home') leaveRoom();
                previewAs(authFor(link.href), link.href);
              }}
              style={[styles.link, { borderColor: colors.stroke }]}
            >
              <Text variant="label" style={styles.flex}>
                {link.label}
              </Text>
              <Icon name="chevron-right" size={16} color={colors.text3} />
            </Pressable>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: 4 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
});
