import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
  const { room: activeRoom, playback, canControl } = useActiveRoom();
  useScreenPalette(roomPalette(activeRoom));
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'account' ? 'account' : 'services');
  const [name, setName] = useState(user.name);

  return (
    <Screen
      header={<ScreenHeader title="Settings" />}
      footer={
        activeRoom?.nowPlaying ? (
          <RoomMiniPlayer room={activeRoom} playback={playback} canControl={canControl} />
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
          <ServicesSection />
        </>
      ) : (
        <>
          <View style={styles.profile}>
            <Avatar initial={name[0] ?? 'Y'} color={user.color} size={40} />
            <View>
              <Text variant="heading">{name || 'You'}</Text>
              <Text variant="caption" color="text2">
                Change your color
              </Text>
            </View>
          </View>
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
          <Text variant="caption" color="danger" style={styles.center}>
            Delete account
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  center: { alignSelf: 'center' },
});
