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
import { AvatarColorPicker } from '@/features/settings/AvatarColorPicker';
import { ServicesSection } from '@/features/settings/ServicesSection';

type Tab = 'services' | 'account';

const methodIcons: Record<SignInMethod, IconName> = {
  apple: 'apple',
  google: 'google',
  email: 'mail',
};

/** 5.1 Settings · Music services and 5.2 Settings · Account. */
export default function Settings() {
  const { user, signOut, saveProfile } = useMockSession();
  const { room: activeRoom, playback, canControl, waitingForHost } = useActiveRoom();
  useScreenPalette(roomPalette(activeRoom));
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'account' ? 'account' : 'services');
  const [name, setName] = useState(user.name);
  const [pickingColor, setPickingColor] = useState(false);

  return (
    <Screen
      header={<ScreenHeader title="Settings" />}
      footer={
        activeRoom?.nowPlaying ? (
          <RoomMiniPlayer
            room={activeRoom}
            playback={playback}
            canControl={canControl}
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
            <Avatar initial={name.trim()[0] ?? 'Y'} color={user.color} size={40} />
            <View>
              <Text variant="heading">{name.trim() || 'You'}</Text>
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
              onChange={(color) => saveProfile({ name: user.name, color })}
            />
          ) : null}
          <TextField
            label="Display name"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChangeText={(text) => {
              setName(text);
              // An empty name isn't saved; the last one stays until a new one is typed.
              if (text.trim()) saveProfile({ name: text.trim(), color: user.color });
            }}
          />
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
