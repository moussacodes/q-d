import { act, renderHook } from '@testing-library/react-native';

import type { RpcCallError } from '@/domain/rpc-error';

import { useCall, type CallResult } from './useCall';

// useCall decides when a retry reuses an idempotency key (API_CONTRACTS.md §1):
// only after a call that got no answer, and only for the same request.

type Answer = CallResult<string>;

async function setup(answers: (Answer | Error)[]) {
  const keys: string[] = [];
  const call = jest.fn(async (_args: { code: string }, key: string): Promise<Answer> => {
    keys.push(key);
    const next = answers.shift();
    if (!next) throw new Error('no answer left');
    if (next instanceof Error) throw next;
    return next;
  });
  const hook = await renderHook(() => useCall(call));
  const run = async (code: string) => {
    let value: string | null = null;
    await act(async () => {
      value = await hook.result.current.run({ code });
    });
    return value;
  };
  return { hook, keys, call, run };
}

const fail = (error: RpcCallError): Answer => ({ ok: false, error });
const ok: Answer = { ok: true, value: 'QD-7K4F9X' };

describe('useCall', () => {
  it('returns the value and goes back to idle on success', async () => {
    const { hook, run } = await setup([ok]);
    expect(await run('7K4F9X')).toBe('QD-7K4F9X');
    expect(hook.result.current.state).toEqual({ status: 'idle' });
  });

  it.each<RpcCallError>([{ code: 'network' }, { code: 'unexpected' }])(
    'reuses the key for the same request after no answer ($code)',
    async (error) => {
      const { keys, run, hook } = await setup([fail(error), ok]);
      expect(await run('7K4F9X')).toBeNull();
      expect(hook.result.current.state).toEqual({ status: 'failed', error });
      expect(await run('7K4F9X')).toBe('QD-7K4F9X');
      expect(keys[1]).toBe(keys[0]);
    },
  );

  it('uses a new key after an answered error: the server stored nothing', async () => {
    const { keys, run } = await setup([fail({ code: 'code_invalid' }), ok]);
    await run('7K4F9X');
    await run('7K4F9X');
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('uses a new key for a different request, even after no answer', async () => {
    const { keys, run } = await setup([fail({ code: 'network' }), ok]);
    await run('7K4F9X');
    await run('8M5G2H');
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('forgets the kept key once the retry is answered', async () => {
    const { keys, run } = await setup([fail({ code: 'network' }), ok, ok]);
    await run('7K4F9X');
    await run('7K4F9X');
    await run('7K4F9X');
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('counts a call that throws as no answer: says network, keeps the key, never sticks on busy', async () => {
    const { keys, run, hook } = await setup([new Error('fetch failed'), ok]);
    expect(await run('7K4F9X')).toBeNull();
    expect(hook.result.current.state).toEqual({ status: 'failed', error: { code: 'network' } });
    expect(await run('7K4F9X')).toBe('QD-7K4F9X');
    expect(keys[1]).toBe(keys[0]);
  });

  it('ignores a second tap while the first call is waiting', async () => {
    let answer: (value: Answer) => void = () => {};
    const call = jest.fn(
      (_args: { code: string }, _key: string) =>
        new Promise<Answer>((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = await renderHook(() => useCall(call));
    let first: Promise<string | null> = Promise.resolve(null);
    let second: string | null = 'not run';
    await act(async () => {
      first = result.current.run({ code: '7K4F9X' });
      second = await result.current.run({ code: '7K4F9X' });
    });
    expect(second).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'pending' });
    await act(async () => {
      answer(ok);
      await first;
    });
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('reset clears a failure', async () => {
    const { hook, run } = await setup([fail({ code: 'room_full' })]);
    await run('7K4F9X');
    await act(async () => hook.result.current.reset());
    expect(hook.result.current.state).toEqual({ status: 'idle' });
  });
});
