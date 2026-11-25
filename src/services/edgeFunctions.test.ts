import { createEdgeFunctionInvoker, EdgeFunctionNetworkError } from './edgeFunctions';

const config = (fetch: jest.Mock, token: string | null = 'user-session-token') => ({
  url: 'https://project.example.test/',
  anonKey: 'publishable-key',
  getAccessToken: async () => token,
  fetch: fetch as unknown as typeof globalThis.fetch,
});

describe('createEdgeFunctionInvoker', () => {
  it('POSTs JSON to the function with the session token and the anon key', async () => {
    const fetch = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const invoke = createEdgeFunctionInvoker(config(fetch));
    expect(await invoke('catalog-search', { query: 'paper' })).toEqual({
      status: 200,
      body: { ok: true },
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://project.example.test/functions/v1/catalog-search');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      apikey: 'publishable-key',
      authorization: 'Bearer user-session-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({ query: 'paper' });
  });

  it('returns error answers for the caller to read', async () => {
    const fetch = jest.fn(async () => new Response('{"code":"rate_limited"}', { status: 429 }));
    expect(await createEdgeFunctionInvoker(config(fetch))('catalog-search', {})).toEqual({
      status: 429,
      body: { code: 'rate_limited' },
    });
  });

  it('reads a body that is not JSON as null', async () => {
    const fetch = jest.fn(async () => new Response('<html>', { status: 502 }));
    expect(await createEdgeFunctionInvoker(config(fetch))('catalog-search', {})).toEqual({
      status: 502,
      body: null,
    });
  });

  it('needs a session', async () => {
    const fetch = jest.fn();
    await expect(
      createEdgeFunctionInvoker(config(fetch, null))('catalog-search', {}),
    ).rejects.toEqual(new EdgeFunctionNetworkError('not_authenticated'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a network failure', async () => {
    const fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(
      createEdgeFunctionInvoker(config(fetch))('catalog-search', {}),
    ).rejects.toMatchObject({ name: 'EdgeFunctionNetworkError', reason: 'network' });
  });

  it('gives up after the timeout', async () => {
    const fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const invoke = createEdgeFunctionInvoker({ ...config(fetch as jest.Mock), timeoutMs: 5 });
    await expect(invoke('catalog-search', {})).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('refuses a function name that could change the path', async () => {
    const fetch = jest.fn();
    await expect(createEdgeFunctionInvoker(config(fetch))('../rest/v1/rpc/x', {})).rejects.toThrow(
      'Bad Edge Function name',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
