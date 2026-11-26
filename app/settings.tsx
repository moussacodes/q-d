import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Button,
  Icon,
  Panel,
  Screen,
  ScreenHeader,
  SectionLabel,
  SegmentedControl,
  Text,
  TextField,
  useScreenPalette,
  type IconName,
} from '@/components';
import { RoomMiniPlayer } from '@/features/playback/RoomMiniPlayer';
import { roomPalette } from '@/features/playback/palette';
import { useActiveRoom } from '@/features/room/useRoom';
import {
  MAX_NAME_LENGTH,
  signInMethodNames,
  useMockSession,
  type SignInMethod,
} from '@/features/session/MockSession';
import { useProfileSave } from '@/features/session/useProfileSave';
import { AvatarColorPicker } from '@/features/settings/AvatarColorPicker';
import { ServicesSection } from '@/features/settings/ServicesSection';

type Tab = 'services' | 'account';

const methodIcons: Record<SignInMethod, IconName> = {
  apple: 'apple',
  google: 'google',
  email: 'mail',
};

/**
 * 5.1 Settings · Music services and 5.2 Settings · Account. In mock auth mode
 * the name saves as it's typed. In live auth mode a name saves when the field
 * is left or submitted, and a color when it's picked; each waits for the
 * server and says so if it fails.
 */
export default function Settings() {
  const { user, signOut } = useMockSession();
  const profile = useProfileSave();
  const { room: activeRoom, playback, canPlay, waitingForHost } = useActiveRoom();
  useScreenPalette(roomPalette(activeRoom));
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'account' ? 'account' : 'services');
  const [name, setName] = useState(user.name);
  const [pickingColor, setPickingColor] = useState(false);
  // Live: the saved name, so an unsaved edit never looks saved.
  const shownName = profile.live ? user.name : name.trim();

  return (
    <Screen
      header={<ScreenHeader title="Settings" />}
      footer={
        activeRoom?.nowPlaying || activeRoom?.autoplay ? (
          <RoomMiniPlayer
            room={activeRoom}
            playback={playback}
            canControl={canPlay}
            waitingForHost={waitingForHost}
          />
        ) : undefined
      }
    >
      <SegmentedControl
        fill
        options={[
          { value: 'services', label: 'Music services' },
          { value: 'account', label: 'Account' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'services' ? (
        <>
          <Text variant="footnote" color="text2">
            Connect a service to host rooms from this phone. Joining a friend’s room works without
            one.
          </Text>
          <ServicesSection manage />
        </>
      ) : (
        <>
          <View style={styles.profile}>
            <Avatar initial={shownName[0] ?? 'Y'} color={user.color} size={40} />
            <View>
              <Text variant="heading">{shownName || 'You'}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: pickingColor }}
                onPress={() => setPickingColor((open) => !open)}
                hitSlop={8}
              >
                <Text variant="caption" color="text2">
                  {pickingColor ? 'Done' : 'Change your color'}
                </Text>
              </Pressable>
            </View>
          </View>
          {pickingColor ? (
            <AvatarColorPicker
              value={user.color}
              onChange={(color) => {
                if (!profile.saving) void profile.saveChange({ color });
              }}
            />
          ) : null}
          <TextField
            label="Display name"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChangeText={(text) => {
              setName(text);
              profile.clearError();
              // An empty name isn't saved; the last one stays until a new one is typed.
              if (!profile.live && text.trim()) void profile.saveChange({ displayName: text });
            }}
            onBlur={() => {
              if (!profile.live) return;
              // Nothing changed, or blank: keep the saved name and show it again.
              if (!name.trim()) setName(user.name);
              else if (name.trim() !== user.name) void profile.saveChange({ displayName: name });
            }}
            editable={!profile.saving}
          />
          {profile.saving ? (
            <Text variant="caption" color="text2">
              Saving…
            </Text>
          ) : profile.errorMessage ? (
            <Text variant="caption" color="danger" accessibilityRole="alert">
              {profile.errorMessage}
            </Text>
          ) : null}
          <TextField label="Email" value={user.email} editable={false} />
          <View style={styles.group}>
            <SectionLabel>Signed in with</SectionLabel>
            <Panel style={styles.row}>
              <Icon name={methodIcons[user.signedInWith]} size={18} />
              <Text variant="bodyStrong">{signInMethodNames[user.signedInWith]}</Text>
            </Panel>
          </View>
          <Button block kind="secondary" icon="log-out" label="Sign out" onPress={signOut} />
          {/* Account deletion (PRODUCT_SPEC.md §7) needs the real backend. */}
          <View style={styles.delete} accessibilityState={{ disabled: true }} accessible>
            <Text variant="caption" color="danger" style={styles.dim}>
              Delete account
            </Text>
            <Text variant="caption" color="text3">
              Not available in this preview yet.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  delete: { alignItems: 'center', gap: 2 },
  dim: { opacity: 0.5 },
});
