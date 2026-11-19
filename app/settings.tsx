import { router, useLocalSearchParams } from 'expo-router';
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
} from '@/components';
import { idlePalette } from '@/design';
import { RoomMiniPlayer } from '@/features/playback/RoomMiniPlayer';
import { useLiveRoom } from '@/features/playback/usePlayback';
import { useMockSession } from '@/features/session/MockSession';
import { ServicesSection } from '@/features/settings/ServicesSection';

type Tab = 'services' | 'account';

/** 5.1 Settings · Music services and 5.2 Settings · Account. */
export default function Settings() {
  const { user, activeRoom: joined, leaveRoom } = useMockSession();
  const { room: activeRoom, playback } = useLiveRoom(joined);
  useScreenPalette(activeRoom?.nowPlaying?.palette ?? idlePalette);
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'account' ? 'account' : 'services');
  const [name, setName] = useState(user.name);

  return (
    <Screen
      header={<ScreenHeader title="Settings" />}
      footer={
        activeRoom?.nowPlaying ? (
          <RoomMiniPlayer room={activeRoom} playback={playback} />
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
          <TextField label="Display name" value={name} onChangeText={setName} />
          <TextField label="Email" value={user.email} editable={false} />
          <View style={styles.group}>
            <SectionLabel>Signed in with</SectionLabel>
            <Panel style={styles.row}>
              <Icon name="apple" size={18} />
              <Text variant="bodyStrong">{user.signedInWith}</Text>
            </Panel>
          </View>
          <Button
            block
            kind="secondary"
            icon="log-out"
            label="Sign out"
            onPress={() => {
              leaveRoom();
              router.dismissTo('/');
            }}
          />
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
