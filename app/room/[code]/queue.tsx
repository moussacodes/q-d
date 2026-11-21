import { router, useLocalSearchParams } from 'expo-router';

import { Button, SheetHeader, SheetScreen } from '@/components';
import { QueueList, RoomStrip } from '@/features/room/RoomParts';
import { findRoom } from '@/test/fixtures/mock-data';

/** 3.3 Up next (swiped up from the expanded room). */
export default function QueueSheet() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const room = findRoom(code);
  return (
    <SheetScreen
      footer={
        <Button
          block
          icon="plus"
          label="Add a song"
          onPress={() => router.replace({ pathname: '/room/[code]/add-song', params: { code } })}
        />
      }
    >
      <SheetHeader title="Up next" subtitle={`${room.queue.length} songs · 25 min`} />
      <RoomStrip room={room} isHost={room.youHost} />
      <QueueList room={room} isHost={room.youHost} />
    </SheetScreen>
  );
}
