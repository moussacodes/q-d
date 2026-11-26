import { z } from 'zod';

import { rpcErrorCodes } from '@/domain/rpc-error';
import { rpcError } from '@/test/fakeSupabaseData';

import { callRpc, DEFAULT_RETRY_AFTER_SECONDS, rpcErrorFrom, type RpcClientLike } from './rpc';

const schema = z.object({ room_id: z.string() }).transform((r) => ({ roomId: r.room_id }));

const client = (answer: Awaited<ReturnType<RpcClientLike['rpc']>> | Error): RpcClientLike => ({
  rpc: jest.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  }),
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('callRpc', () => {
  it('calls the function by name with snake_case arguments and parses the result', async () => {
    const rpc = client({ data: { room_id: 'r1' }, error: null });
    const result = await callRpc(
      rpc,
      'join_room_by_code',
      { code: 'ABC234', idempotency_key: 'k' },
      schema,
    );
    expect(rpc.rpc).toHaveBeenCalledWith('join_room_by_code', {
      code: 'ABC234',
      idempotency_key: 'k',
    });
    expect(result).toEqual({ ok: true, value: { roomId: 'r1' } });
  });

  it.each(rpcErrorCodes.filter((code) => code !== 'rate_limited'))(
    'maps a raised %s to that code',
    async (code) => {
      const result = await callRpc(client(rpcError(code)), 'x', {}, schema);
      expect(result).toEqual({ ok: false, error: { code }, details: {} });
    },
  );

  it('keeps the details the server sent, like already_in_queue’s status', async () => {
    const result = await callRpc(
      client(rpcError('already_in_queue', { status: 'playing' })),
      'enqueue_recording',
      {},
      schema,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'already_in_queue' },
      details: { status: 'playing' },
    });
  });

  it('reads rate_limited’s wait, rounding up', async () => {
    const result = await callRpc(
      client(rpcError('rate_limited', { retry_after_seconds: 12.2 })),
      'join_room_by_code',
      {},
      schema,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: 13 },
    });
  });

  it.each([{}, { retry_after_seconds: 'soon' }, { retry_after_seconds: -1 }])(
    'falls back to a 30-second wait for rate_limited without a usable one (%p)',
    async (details) => {
      const result = await callRpc(client(rpcError('rate_limited', details)), 'x', {}, schema);
      expect(result).toMatchObject({
        error: { code: 'rate_limited', retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS },
      });
    },
  );

  it('reads the HTTP 400 error_response path (a counted wrong code) like a raise', async () => {
    // private.error_response() answers 400 with { code: 'P0001', message, details, hint: 'qd' }.
    const result = await callRpc(
      client({
        data: null,
        error: { code: 'P0001', message: 'code_invalid', details: null, hint: 'qd' },
        status: 400,
      }),
      'join_room_by_code',
      {},
      schema,
    );
    expect(result).toEqual({ ok: false, error: { code: 'code_invalid' }, details: {} });
  });

  it('accepts details already parsed into an object', async () => {
    const result = await callRpc(
      client({
        data: null,
        error: { code: 'P0001', message: 'invalid_input', details: { field: 'name' }, hint: 'qd' },
      }),
      'create_room',
      {},
      schema,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid_input' },
      details: { field: 'name' },
    });
  });

  it('treats details that aren’t JSON as none', async () => {
    const result = await callRpc(
      client({
        data: null,
        error: { code: 'P0001', message: 'room_full', details: '{oops', hint: 'qd' },
      }),
      'x',
      {},
      schema,
    );
    expect(result).toEqual({ ok: false, error: { code: 'room_full' }, details: {} });
  });

  it('never trusts a message without the qd hint, even if it looks like a code', async () => {
    const result = await callRpc(
      client({ data: null, error: { code: '23505', message: 'room_full', hint: null } }),
      'x',
      {},
      schema,
    );
    expect(result).toEqual({ ok: false, error: { code: 'unexpected' }, details: {} });
  });

  it('treats a qd error with a code it doesn’t know as unexpected', async () => {
    const result = await callRpc(client(rpcError('reactions_off')), 'x', {}, schema);
    expect(result).toMatchObject({ error: { code: 'unexpected' } });
  });

  it.each([
    ['a fetch failure', { data: null, error: { message: 'TypeError: Network request failed' } }],
    ['status 0', { data: null, error: { message: '' }, status: 0 }],
    ['a timeout', { data: null, error: { message: 'Request timed out' } }],
  ])('calls %s a network failure', async (_, answer) => {
    expect(await callRpc(client(answer), 'x', {}, schema)).toMatchObject({
      ok: false,
      error: { code: 'network' },
    });
  });

  it('calls a thrown request a network failure, without throwing', async () => {
    await expect(callRpc(client(new Error('socket hang up')), 'x', {}, schema)).resolves.toEqual({
      ok: false,
      error: { code: 'network' },
      details: {},
    });
  });

  it('calls a result that doesn’t parse unexpected, never half-read', async () => {
    const result = await callRpc(client({ data: { room: 'r1' }, error: null }), 'x', {}, schema);
    expect(result).toEqual({ ok: false, error: { code: 'unexpected' }, details: {} });
  });

  it('never logs the arguments, the server’s message or the result', async () => {
    const warn = jest.spyOn(console, 'warn');
    const info = jest.spyOn(console, 'info');
    await callRpc(
      client({ data: null, error: { code: 'XX000', message: 'secret-token-abc', hint: null } }),
      'join_room_by_invite',
      { token: 'secret-token-abc' },
      schema,
    );
    await callRpc(client({ data: { leaked: 'QD-ABC234' }, error: null }), 'x', {}, schema);
    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).not.toContain('secret-token-abc');
    expect(logged).not.toContain('QD-ABC234');
  });
});

describe('rpcErrorFrom', () => {
  it('says unexpected for no error object at all', () => {
    expect(rpcErrorFrom(null)).toEqual({ error: { code: 'unexpected' }, details: {} });
  });
});
