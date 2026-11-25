import {
  parseRoomEvent,
  parseRoomPresence,
  realtimeVersion,
  roomChannel,
  roomEventTypes,
  type RoomEvent,
} from './realtime';

const ROOM = '6f1c1f3e-1b7a-4c8e-9d2f-0a1b2c3d4e5f';
const OTHER_ROOM = '7f1c1f3e-1b7a-4c8e-9d2f-0a1b2c3d4e5f';
const USER = '11111111-2222-4333-8444-555555555555';

const event = {
  v: 1,
  type: 'queue.changed',
  roomId: ROOM,
  at: '2026-11-24T18:30:00.000Z',
} satisfies RoomEvent;

describe('roomChannel', () => {
  it('names the private room channel', () => {
    expect(roomChannel(ROOM)).toBe(`room:${ROOM}`);
  });
});

describe('parseRoomEvent', () => {
  it('is version 1', () => {
    expect(realtimeVersion).toBe(1);
  });

  it.each(roomEventTypes)('accepts %s', (type) => {
    expect(parseRoomEvent({ ...event, type })).toEqual({
      ok: true,
      value: { ...event, type },
    });
  });

  it('accepts an event for the expected room', () => {
    expect(parseRoomEvent(event, ROOM)).toEqual({ ok: true, value: event });
  });

  it('rejects an event for a different room', () => {
    expect(parseRoomEvent(event, OTHER_ROOM)).toMatchObject({ ok: false, reason: 'wrong_room' });
  });

  it('strips fields an event must never carry, like names or song details', () => {
    const result = parseRoomEvent({ ...event, displayName: 'Maya', title: 'Rain Down' });
    expect(result).toEqual({ ok: true, value: event });
  });

  it.each([2, 3, 99])('ignores a newer envelope version (v %d)', (v) => {
    expect(parseRoomEvent({ ...event, v })).toEqual({
      ok: false,
      reason: 'unsupported_version',
      issues: [],
    });
  });

  it('ignores a newer version even when its shape is unrecognizable', () => {
    expect(parseRoomEvent({ v: 2, kind: 'something.else' })).toMatchObject({
      reason: 'unsupported_version',
    });
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '1'],
    ['null', null],
  ])('rejects a version that is %s as invalid', (_name, v) => {
    expect(parseRoomEvent({ ...event, v })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it.each(['queue.cleared', 'chat.message', 'QUEUE.CHANGED'])(
    'ignores the unknown event type %s',
    (type) => {
      expect(parseRoomEvent({ ...event, type })).toEqual({
        ok: false,
        reason: 'unknown_type',
        issues: [],
      });
    },
  );

  it.each([
    ['not an object', 'queue.changed'],
    ['null', null],
    ['undefined', undefined],
    ['an array', [event]],
    ['a number', 1],
  ])('rejects a payload that is %s', (_name, payload) => {
    expect(parseRoomEvent(payload)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it.each([
    ['a missing type', { type: undefined }, 'type'],
    ['a numeric type', { type: 7 }, 'type'],
    ['a non-UUID room id', { roomId: 'room-1' }, 'roomId'],
    ['a missing room id', { roomId: undefined }, 'roomId'],
    ['a malformed time', { at: 'now' }, 'at'],
    ['a missing time', { at: undefined }, 'at'],
  ])('rejects %s and says where', (_name, changes, path) => {
    const result = parseRoomEvent({ ...event, ...changes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  it('never puts payload values into the issues, so they are safe to log', () => {
    const secret = 'maya@example.com';
    const result = parseRoomEvent({ ...event, roomId: secret, at: secret });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [Symbol('x'), () => 1, new Date(), Object.create(null), NaN];
    for (const payload of odd) {
      expect(() => parseRoomEvent(payload)).not.toThrow();
      expect(parseRoomEvent(payload).ok).toBe(false);
    }
  });

  it('gives the same answer every time', () => {
    const payload = { ...event, type: 'room.ended' };
    expect(parseRoomEvent(payload)).toEqual(parseRoomEvent(payload));
  });
});

describe('parseRoomPresence', () => {
  const presence = { v: 1, userId: USER, role: 'host' };

  it.each(['host', 'member'])('accepts the %s role', (role) => {
    expect(parseRoomPresence({ ...presence, role })).toEqual({
      ok: true,
      value: { ...presence, role },
    });
  });

  it('strips personal fields', () => {
    expect(parseRoomPresence({ ...presence, email: 'x@example.com' })).toEqual({
      ok: true,
      value: presence,
    });
  });

  it('ignores a newer version', () => {
    expect(parseRoomPresence({ ...presence, v: 2 })).toMatchObject({
      reason: 'unsupported_version',
    });
  });

  it.each([
    ['an unknown role', { role: 'admin' }],
    ['a non-UUID user', { userId: 'baron' }],
    ['no version', { v: undefined }],
  ])('rejects %s', (_name, changes) => {
    expect(parseRoomPresence({ ...presence, ...changes })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a non-object', () => {
    expect(parseRoomPresence('host')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
