import { router, useLocalSearchParams } from 'expo-router';

import { SheetHeader, SheetScreen, Text } from '@/components';
import {
  AddSongFooter,
  EmptyQueue,
  queueSummary,
  QueueList,
  RoomStrip,
} from '@/features/room/RoomParts';
import { RoomGate } from '@/features/room/RoomGate';
import { roomParams, useRoom, type RoomView } from '@/features/room/useRoom';

/** 3.3 Up next (swiped up from the expanded room). */
function QueueSheet() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView }>();
  const { room, isHost, canAdd, canControl, moveUp, moveDown, remove, queueError } = useRoom(
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
      {queueError ? (
        <Text variant="caption" color="statusWarn" accessibilityRole="alert">
          {queueError}
        </Text>
      ) : null}
      {room.queue.length ? (
        <QueueList room={room} controls={canControl ? { moveUp, moveDown, remove } : undefined} />
      ) : (
        <EmptyQueue />
      )}
    </SheetScreen>
  );
}

/** Waits for the room (live rooms are read from Supabase) before showing it. */
export default function QueueSheetRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <RoomGate code={code}>
      <QueueSheet />
    </RoomGate>
  );
}
