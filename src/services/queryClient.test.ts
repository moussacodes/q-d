import { focusManager, QueryClient } from '@tanstack/react-query';

import {
  connectQueryFocus,
  createQueryClient,
  MAX_QUERY_RETRIES,
  queryClient,
  shouldRetryQuery,
} from './queryClient';

describe('shouldRetryQuery', () => {
  it('retries network-style failures up to the limit', () => {
    const error = new TypeError('Network request failed');
    expect(MAX_QUERY_RETRIES).toBe(2);
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });

  it.each([
    ['an RPC error code', { code: 'not_allowed' }],
    ['another RPC error code', { code: 'room_full' }],
    ['a 401', { status: 401 }],
    ['a 404', { status: 404 }],
    ['a raw q’d RPC error', { code: 'P0001', message: 'room_not_found', hint: 'qd' }],
  ])('does not retry %s', (_label, error) => {
    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  it.each([
    ['a 500', { status: 500 }],
    ['a timeout (408)', { status: 408 }],
    ['rate limiting (429)', { status: 429 }],
    ['a Postgres code', { code: '57014' }],
    ['a PostgREST code', { code: 'PGRST301' }],
    ['a P0001 without the qd hint', { code: 'P0001', message: 'boom', hint: null }],
    ['a string', 'offline'],
    ['null', null],
  ])('retries %s', (_label, error) => {
    expect(shouldRetryQuery(0, error)).toBe(true);
  });
});

describe('createQueryClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sets the defaults', () => {
    const client = createQueryClient();
    const { queries, mutations } = client.getDefaultOptions();
    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(mutations?.retry).toBe(false);
  });

  it('creates independent clients', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('logs a failed query redacted, without its key', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createQueryClient();
    await client
      .fetchQuery({
        queryKey: ['room', 'QD-7K4F9X', 'queue'],
        queryFn: async () => {
          throw Object.assign(new Error('denied for a@b.io'), { code: 'not_allowed' });
        },
        meta: { scope: 'room.queue' },
        retry: false,
      })
      .catch(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(warn.mock.calls);
    expect(text).toContain('room.queue');
    expect(text).toContain('not_allowed');
    expect(text).not.toContain('QD-7K4F9X');
    expect(text).not.toContain('a@b.io');
    client.clear();
  });

  it('logs a failed mutation redacted', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createQueryClient();
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error('enqueue failed in QD-7K4F9X');
      },
      meta: { scope: 'room.enqueue' },
    });
    await mutation.execute(undefined).catch(() => {});
    const text = JSON.stringify(warn.mock.calls);
    expect(text).toContain('Mutation failed');
    expect(text).not.toContain('QD-7K4F9X');
    client.clear();
  });
});

describe('connectQueryFocus', () => {
  afterEach(() => focusManager.setFocused(undefined));

  function fakeAppState() {
    let listener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    return {
      addEventListener: jest.fn((_type: 'change', next: (state: string) => void) => {
        listener = next;
        return { remove };
      }),
      emit: (state: string) => listener?.(state),
      remove,
    };
  }

  it('follows the app state on devices', () => {
    const appState = fakeAppState();
    const stop = connectQueryFocus(appState, 'ios');
    appState.emit('background');
    expect(focusManager.isFocused()).toBe(false);
    appState.emit('active');
    expect(focusManager.isFocused()).toBe(true);
    stop();
    expect(appState.remove).toHaveBeenCalled();
  });

  it('leaves the web to window focus', () => {
    const appState = fakeAppState();
    connectQueryFocus(appState, 'web')();
    expect(appState.addEventListener).not.toHaveBeenCalled();
  });
});
