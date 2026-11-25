import { defaultRoomRules } from '@/domain/room-rules';

import {
  MOCK_HOSTED_CODE,
  MOCK_INVITE_HOURS,
  MOCK_JOIN_ATTEMPTS,
  MOCK_RETRY_AFTER_SECONDS,
  MockRoomServer,
  mockInviteToken,
  newIdempotencyKey,
  type CreateRoomInput,
} from './mockServer';

/** A server with a clock the test moves. */
function serverAt(start = 1_000_000) {
  const clock = { now: start };
  return { server: new MockRoomServer(() => clock.now), clock };
}

let keys = 0;
const key = () => `key-${++keys}`;

const join = (server: MockRoomServer, code: string, idempotencyKey = key()) =>
  server.joinRoomByCode({ code, idempotencyKey });

describe('newIdempotencyKey', () => {
  it('looks like a v4 UUID and differs every time', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('join_room_by_code (mock)', () => {
  it('finds a sample room whatever the case, prefix or spaces', async () => {
    const { server } = serverAt();
    for (const typed of ['9M2XR4', '9m2xr4', 'QD-9M2XR4', 'qd 9m2 xr4']) {
      expect(await join(server, typed)).toEqual({ ok: true, value: { code: 'QD-9M2XR4' } });
    }
  });

  it('answers a wrong code and an expired one with the same error', async () => {
    const { server } = serverAt();
    const wrong = await join(server, 'ZZZZZZ');
    const expired = await join(server, 'QD-STALE2');
    expect(wrong).toEqual({ ok: false, error: { code: 'code_invalid' } });
    expect(expired).toEqual(wrong);
  });

  it('says when the room is full or has ended', async () => {
    const { server } = serverAt();
    expect(await join(server, 'QD-FULL22')).toEqual({ ok: false, error: { code: 'room_full' } });
    expect(await join(server, 'ended2')).toEqual({ ok: false, error: { code: 'room_ended' } });
  });

  it('never finds a code with look-alike characters', async () => {
    const { server } = serverAt();
    expect(await join(server, '9M2XR0')).toEqual({ ok: false, error: { code: 'code_invalid' } });
  });

  it(`pauses after ${MOCK_JOIN_ATTEMPTS} wrong codes, before looking at the next one`, async () => {
    const { server, clock } = serverAt();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS; i++) {
      expect(await join(server, 'ZZZZZZ')).toEqual({ ok: false, error: { code: 'code_invalid' } });
    }
    // Even a right code waits: the limit is checked first.
    expect(await join(server, '9M2XR4')).toEqual({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: MOCK_RETRY_AFTER_SECONDS },
    });
    clock.now += 12_500;
    expect(await join(server, '9M2XR4')).toEqual({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: MOCK_RETRY_AFTER_SECONDS - 12 },
    });
    clock.now += MOCK_RETRY_AFTER_SECONDS * 1000;
    expect(await join(server, '9M2XR4')).toEqual({ ok: true, value: { code: 'QD-9M2XR4' } });
  });

  it('starts counting again after a code works', async () => {
    const { server } = serverAt();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS - 1; i++) await join(server, 'ZZZZZZ');
    await join(server, '9M2XR4');
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS - 1; i++) await join(server, 'ZZZZZZ');
    expect(await join(server, '9M2XR4')).toMatchObject({ ok: true });
  });

  it('does not count a full or ended room as a wrong code', async () => {
    const { server } = serverAt();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS + 2; i++) await join(server, 'QD-FULL22');
    expect(await join(server, '9M2XR4')).toMatchObject({ ok: true });
  });

  it('answers a replay with the stored result', async () => {
    const { server } = serverAt();
    const first = await join(server, '9M2XR4', 'same');
    expect(await join(server, 'qd-9m2xr4', 'same')).toEqual(first);
  });

  it('rejects the same key with a different code', async () => {
    const { server } = serverAt();
    await join(server, '9M2XR4', 'same');
    expect(await join(server, '3HV8PL', 'same')).toEqual({
      ok: false,
      error: { code: 'idempotency_conflict' },
    });
  });

  it('lets a rejected call be retried with the same key', async () => {
    const { server } = serverAt();
    expect(await join(server, 'ZZZZZZ', 'retry')).toMatchObject({ ok: false });
    expect(await join(server, '9M2XR4', 'retry')).toMatchObject({ ok: true });
  });
});

describe('create_room (mock)', () => {
  const input = (overrides: Partial<CreateRoomInput> = {}): CreateRoomInput => ({
    name: 'Friday Fade',
    playbackProvider: 'spotify',
    rules: defaultRoomRules,
    mode: 'aux',
    idempotencyKey: key(),
    ...overrides,
  });

  it('hands out the sample host room', async () => {
    const { server } = serverAt();
    expect(await server.createRoom(input())).toEqual({
      ok: true,
      value: { code: MOCK_HOSTED_CODE },
    });
  });

  it('needs a name of 1 to 40 characters after trimming', async () => {
    const { server } = serverAt();
    expect(await server.createRoom(input({ name: '   ' }))).toEqual({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(await server.createRoom(input({ name: 'a'.repeat(41) }))).toEqual({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(await server.createRoom(input({ name: ` ${'a'.repeat(40)} ` }))).toMatchObject({
      ok: true,
    });
  });

  it('needs a connected service', async () => {
    const { server } = serverAt();
    expect(await server.createRoom(input({ playbackProvider: null }))).toEqual({
      ok: false,
      error: { code: 'provider_required' },
    });
  });

  it('refuses sync while its flag is off', async () => {
    const { server } = serverAt();
    const sync = input({ mode: 'sync' as unknown as 'aux' });
    expect(await server.createRoom(sync)).toEqual({
      ok: false,
      error: { code: 'feature_disabled' },
    });
  });

  it('answers a replay with the stored result and rejects changed arguments', async () => {
    const { server } = serverAt();
    const first = await server.createRoom(input({ idempotencyKey: 'tap' }));
    expect(await server.createRoom(input({ idempotencyKey: 'tap' }))).toEqual(first);
    expect(await server.createRoom(input({ idempotencyKey: 'tap', name: 'Other' }))).toEqual({
      ok: false,
      error: { code: 'idempotency_conflict' },
    });
  });
});

describe('create_room_invite and join_room_by_invite (mock)', () => {
  const invite = (server: MockRoomServer, asHost = true, idempotencyKey = key()) =>
    server.createRoomInvite({ roomCode: 'QD-7K4F9X', asHost, idempotencyKey });
  const joinInvite = (server: MockRoomServer, token: string) =>
    server.joinRoomByInvite({ token, idempotencyKey: key() });
  const tokenOf = (result: Awaited<ReturnType<typeof invite>>) => {
    if (!result.ok) throw new Error('expected an invite');
    return result.value.token;
  };

  it('makes a labeled, 128-bit-long token that isn’t the room code', async () => {
    const { server } = serverAt();
    const result = await invite(server);
    const token = tokenOf(result);
    expect(token).toMatch(/^mock-[0-9a-f]{32}$/);
    expect(token).not.toContain('7K4F9X');
    expect(result).toMatchObject({
      value: { expiresAt: new Date(1_000_000 + MOCK_INVITE_HOURS * 3_600_000).toISOString() },
    });
  });

  it('is deterministic', async () => {
    expect(await invite(serverAt().server)).toEqual(await invite(serverAt().server));
    expect(mockInviteToken('QD-7K4F9X', 1)).not.toBe(mockInviteToken('QD-9M2XR4', 1));
    expect(mockInviteToken('QD-7K4F9X', 1)).not.toBe(mockInviteToken('QD-7K4F9X', 2));
  });

  it('is only for the host', async () => {
    const { server } = serverAt();
    expect(await invite(server, false)).toEqual({ ok: false, error: { code: 'not_host' } });
  });

  it('answers a replay with the same token', async () => {
    const { server } = serverAt();
    expect(await invite(server, true, 'tap')).toEqual(await invite(server, true, 'tap'));
  });

  it('opens the room for the current token', async () => {
    const { server } = serverAt();
    const token = tokenOf(await invite(server));
    expect(await joinInvite(server, token)).toEqual({ ok: true, value: { code: 'QD-7K4F9X' } });
  });

  it('stops the old token working once a new one is made', async () => {
    const { server } = serverAt();
    const first = tokenOf(await invite(server));
    const second = tokenOf(await invite(server));
    expect(second).not.toBe(first);
    expect(await joinInvite(server, first)).toEqual({
      ok: false,
      error: { code: 'invite_invalid' },
    });
    expect(await joinInvite(server, second)).toMatchObject({ ok: true });
  });

  it('refuses a wrong or expired token', async () => {
    const { server, clock } = serverAt();
    const token = tokenOf(await invite(server));
    expect(await joinInvite(server, 'mock-nope')).toEqual({
      ok: false,
      error: { code: 'invite_invalid' },
    });
    clock.now += MOCK_INVITE_HOURS * 3_600_000;
    expect(await joinInvite(server, token)).toEqual({
      ok: false,
      error: { code: 'invite_invalid' },
    });
  });

  it('counts wrong tokens toward the same attempt limit as wrong codes', async () => {
    const { server } = serverAt();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS; i++) await joinInvite(server, `mock-${i}`);
    expect(await join(server, '9M2XR4')).toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
    });
  });
});
