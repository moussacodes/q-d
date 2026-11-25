import type { RpcErrorCode } from '@/domain/rpc-error';

import {
  createRoomErrorMessage,
  joinErrorMessage,
  lookalikeMessage,
  roomNameMessage,
} from './errorCopy';

const plain = (code: Exclude<RpcErrorCode, 'rate_limited'>) => ({ code });

describe('joinErrorMessage', () => {
  it('has its own words for each error join_room_by_code can answer', () => {
    const codes = ['code_invalid', 'room_full', 'room_ended', 'profile_incomplete'] as const;
    const messages = codes.map((code) => joinErrorMessage(plain(code)));
    expect(new Set(messages).size).toBe(codes.length);
    expect(joinErrorMessage(plain('room_full'))).toMatch(/full/);
    expect(joinErrorMessage(plain('room_ended'))).toMatch(/ended/);
  });

  it('can’t tell a wrong code from an expired one', () => {
    expect(joinErrorMessage(plain('code_invalid'))).toBe(
      'That code doesn’t match a room. It may be mistyped or expired, so check it with the host.',
    );
  });

  it('says how long to wait when rate limited', () => {
    expect(joinErrorMessage({ code: 'rate_limited', retryAfterSeconds: 30 })).toBe(
      'Too many tries. Wait 30 seconds, then try again.',
    );
    expect(joinErrorMessage({ code: 'rate_limited', retryAfterSeconds: 1 })).toBe(
      'Too many tries. Wait 1 second, then try again.',
    );
  });

  it('asks a signed-out caller to sign in again', () => {
    expect(joinErrorMessage(plain('not_authenticated'))).toBe('Sign in again to join a room.');
  });

  it('never shows a raw code', () => {
    expect(joinErrorMessage(plain('stale_state'))).toBe('Couldn’t join right now. Try again.');
  });
});

describe('createRoomErrorMessage', () => {
  it('maps the errors create_room can answer', () => {
    expect(createRoomErrorMessage(plain('provider_required'))).toBe(
      'Connect a music service to start a room.',
    );
    expect(createRoomErrorMessage(plain('profile_incomplete'))).toMatch(/profile/);
    expect(createRoomErrorMessage(plain('invalid_input'))).toBe(
      'Room names need 1 to 40 characters.',
    );
    expect(createRoomErrorMessage({ code: 'rate_limited', retryAfterSeconds: 5 })).toMatch(
      /5 seconds/,
    );
    expect(createRoomErrorMessage(plain('feature_disabled'))).toBe(
      'Couldn’t start the room right now. Try again.',
    );
  });
});

describe('field messages', () => {
  it('explain the room name rule', () => {
    expect(roomNameMessage('blank')).toBe('Give the room a name.');
    expect(roomNameMessage('too_long')).toBe('Room names can be up to 40 characters.');
  });

  it('name the look-alike characters', () => {
    expect(lookalikeMessage).toMatch(/0, O, 1 or I/);
  });
});
