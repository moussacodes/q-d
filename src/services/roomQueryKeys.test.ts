import { roomEventTypes } from '@/domain/realtime';

import { invalidationsFor, roomKeys } from './roomQueryKeys';

const roomId = '6f1f8a3e-2a4b-4c1d-9e8f-0a1b2c3d4e5f';

/** Whether `key` starts with `prefix`, the way TanStack Query matches a filter. */
const under = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

describe('roomKeys', () => {
  it('puts everything about a room under one prefix, so one invalidation refetches it all', () => {
    for (const key of [
      roomKeys.detail(roomId),
      roomKeys.members(roomId),
      roomKeys.queue(roomId),
      roomKeys.playback(roomId),
    ]) {
      expect(under(key, roomKeys.room(roomId))).toBe(true);
      expect(under(key, roomKeys.all)).toBe(true);
    }
  });

  it('keeps rooms apart', () => {
    expect(under(roomKeys.queue('other'), roomKeys.room(roomId))).toBe(false);
  });
});

describe('invalidationsFor', () => {
  it('covers every event type the contract lists', () => {
    for (const type of roomEventTypes) {
      expect(invalidationsFor(type, roomId).length).toBeGreaterThan(0);
    }
  });

  it('refetches the queue and playback for queue changes (adding to an empty room starts it)', () => {
    expect(invalidationsFor('queue.changed', roomId)).toEqual([
      roomKeys.queue(roomId),
      roomKeys.playback(roomId),
    ]);
  });

  it('refetches the queue with playback, because advancing moves the playing entry', () => {
    expect(invalidationsFor('playback.changed', roomId)).toEqual([
      roomKeys.playback(roomId),
      roomKeys.queue(roomId),
    ]);
  });

  it('refetches members and the room row (chosen people) for member changes', () => {
    expect(invalidationsFor('members.changed', roomId)).toEqual([
      roomKeys.members(roomId),
      roomKeys.detail(roomId),
    ]);
  });

  it('refetches the whole room and your room list when it ends', () => {
    expect(invalidationsFor('room.ended', roomId)).toEqual([roomKeys.room(roomId), roomKeys.mine]);
  });

  it('never refetches another room', () => {
    for (const type of roomEventTypes) {
      for (const key of invalidationsFor(type, roomId)) {
        if (key[0] === 'room') expect(key[1]).toBe(roomId);
      }
    }
  });
});
