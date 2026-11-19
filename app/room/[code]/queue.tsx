import { router, useLocalSearchParams } from 'expo-router';

import { Button, SheetHeader, SheetScreen } from '@/components';
import { queueSummary, QueueList, RoomStrip } from '@/features/room/RoomParts';
import { roomParams, useRoom, type RoomView } from '@/features/room/useRoom';

/** 3.3 Up next (swiped up from the expanded room). */
export default function QueueSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost, moveUp, moveDown, remove } = useRoom(params.code, params.view);
  return (
    <SheetScreen
      footer={
        <Button
          block
          icon="plus"
          label="Add a song"
          onPress={() =>
            router.replace({ pathname: '/room/[code]/add-song', params: roomParams(room) })
          }
        />
      }
    >
      <SheetHeader title="Up next" subtitle={queueSummary(room.queue)} />
      <RoomStrip room={room} isHost={isHost} />
      <QueueList room={room} controls={isHost ? { moveUp, moveDown, remove } : undefined} />
    </SheetScreen>
  );
}
