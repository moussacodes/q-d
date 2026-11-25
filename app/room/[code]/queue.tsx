import { router, useLocalSearchParams } from 'expo-router';

import { SheetHeader, SheetScreen } from '@/components';
import {
  AddSongFooter,
  EmptyQueue,
  queueSummary,
  QueueList,
  RoomStrip,
} from '@/features/room/RoomParts';
import { roomParams, useRoom, type RoomView } from '@/features/room/useRoom';

/** 3.3 Up next (swiped up from the expanded room). */
export default function QueueSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost, canAdd, canControl, moveUp, moveDown, remove } = useRoom(
    params.code,
    params.view,
  );
  return (
    <SheetScreen
      footer={
        <AddSongFooter
          room={room}
          canAdd={canAdd}
          onPress={() =>
            router.replace({ pathname: '/room/[code]/add-song', params: roomParams(room) })
          }
        />
      }
    >
      <SheetHeader title="Up next" subtitle={queueSummary(room.queue)} />
      <RoomStrip room={room} isHost={isHost} />
      {room.queue.length ? (
        <QueueList room={room} controls={canControl ? { moveUp, moveDown, remove } : undefined} />
      ) : (
        <EmptyQueue />
      )}
    </SheetScreen>
  );
}
