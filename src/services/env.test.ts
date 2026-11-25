import { envNames, parseEnv, readRawEnv, type RawEnv } from './env';

const URL_OK = 'https://abcd1234.supabase.co';
const PUBLISHABLE = 'sb_publishable_0123456789abcdef';

function jwt(payload: object): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const allOff = {
  realAppleMusic: false,
  realSpotify: false,
  sync: false,
  playlistImport: false,
  moderation: false,
  analytics: false,
};

describe('parseEnv', () => {
  it('runs on mock with nothing set, and reports no problems', () => {
    expect(parseEnv({})).toEqual({
      env: { requestedDataMode: 'mock', supabase: null, requestedFlags: allOff },
      problems: [],
    });
  });

  it('treats empty and whitespace-only values as unset', () => {
    const raw: RawEnv = {
      EXPO_PUBLIC_DATA_MODE: '',
      EXPO_PUBLIC_SUPABASE_URL: '   ',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      EXPO_PUBLIC_FLAG_SYNC: ' ',
    };
    expect(parseEnv(raw)).toEqual(parseEnv({}));
  });

  it('accepts both data modes', () => {
    expect(parseEnv({ EXPO_PUBLIC_DATA_MODE: 'mock' }).env.requestedDataMode).toBe('mock');
    expect(parseEnv({ EXPO_PUBLIC_DATA_MODE: 'live' }).env.requestedDataMode).toBe('live');
    expect(parseEnv({ EXPO_PUBLIC_DATA_MODE: ' live ' }).env.requestedDataMode).toBe('live');
  });

  it('falls back to mock for an unknown data mode and says which variable', () => {
    const { env, problems } = parseEnv({ EXPO_PUBLIC_DATA_MODE: 'production' });
    expect(env.requestedDataMode).toBe('mock');
    expect(problems).toEqual(['EXPO_PUBLIC_DATA_MODE is invalid. It was ignored.']);
  });

  describe('Supabase', () => {
    it('is configured when the URL and a publishable key are both valid', () => {
      const { env, problems } = parseEnv({
        EXPO_PUBLIC_SUPABASE_URL: `${URL_OK}/`,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      });
      expect(env.supabase).toEqual({ url: URL_OK, publishableKey: PUBLISHABLE });
      expect(problems).toEqual([]);
    });

    it('accepts a legacy anon JWT', () => {
      const anon = jwt({ role: 'anon', iss: 'supabase' });
      const { env, problems } = parseEnv({
        EXPO_PUBLIC_SUPABASE_URL: URL_OK,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
      });
      expect(env.supabase?.publishableKey).toBe(anon);
      expect(problems).toEqual([]);
    });

    it('accepts a local http URL', () => {
      const { env } = parseEnv({
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      });
      expect(env.supabase?.url).toBe('http://127.0.0.1:54321');
    });

    it.each([
      ['a secret key', 'sb_secret_0123456789abcdef', 'is a secret key'],
      ['a service-role JWT', jwt({ role: 'service_role' }), 'has role "service_role"'],
      ['a JWT with no role', jwt({ sub: 'x' }), 'is not a Supabase publishable or anon key'],
      ['random text', 'not-a-key', 'is not a Supabase publishable or anon key'],
      [
        'a three-part string that is not JSON',
        'a.b.c',
        'is not a Supabase publishable or anon key',
      ],
      ['an empty publishable key', 'sb_publishable_', 'is incomplete'],
    ])('rejects %s', (_label, key, reason) => {
      const { env, problems } = parseEnv({
        EXPO_PUBLIC_SUPABASE_URL: URL_OK,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      });
      expect(env.supabase).toBeNull();
      expect(problems[0]?.startsWith(`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ${reason}`)).toBe(true);
      expect(problems[0]?.endsWith('. It was ignored.')).toBe(true);
      expect(problems[1]).toBe(
        'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or invalid, so Supabase is off.',
      );
    });

    it.each(['not a url', 'ftp://example.com', 'supabase.co', 'https://user:pass@x.supabase.co'])(
      'rejects the URL %j',
      (url) => {
        const { env, problems } = parseEnv({
          EXPO_PUBLIC_SUPABASE_URL: url,
          EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
        });
        expect(env.supabase).toBeNull();
        expect(problems[0]).toMatch(/^EXPO_PUBLIC_SUPABASE_URL (is invalid|must not contain)/);
        expect(problems[1]).toBe(
          'EXPO_PUBLIC_SUPABASE_URL is missing or invalid, so Supabase is off.',
        );
      },
    );

    it('is off, with a clear message, when only one half is set', () => {
      expect(parseEnv({ EXPO_PUBLIC_SUPABASE_URL: URL_OK })).toEqual({
        env: expect.objectContaining({ supabase: null }),
        problems: [
          'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or invalid, so Supabase is off.',
        ],
      });
      expect(parseEnv({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })).toEqual({
        env: expect.objectContaining({ supabase: null }),
        problems: ['EXPO_PUBLIC_SUPABASE_URL is missing or invalid, so Supabase is off.'],
      });
    });

    it('never puts a value into a problem message', () => {
      const secret = 'sb_secret_DO_NOT_LEAK_123';
      const { problems } = parseEnv({
        EXPO_PUBLIC_DATA_MODE: 'leaky-mode-value',
        EXPO_PUBLIC_SUPABASE_URL: 'https://leaky:password@x.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
        EXPO_PUBLIC_FLAG_ANALYTICS: 'leaky-flag',
      });
      expect(problems.length).toBeGreaterThan(0);
      for (const problem of problems) {
        expect(problem).not.toMatch(/leaky|DO_NOT_LEAK|password/);
      }
    });
  });

  describe('flags', () => {
    it.each(['true', 'TRUE', '1', 'on', 'Yes', ' true '])('reads %j as on', (value) => {
      expect(parseEnv({ EXPO_PUBLIC_FLAG_MODERATION: value }).env.requestedFlags.moderation).toBe(
        true,
      );
    });

    it.each(['false', 'FALSE', '0', 'off', 'no'])('reads %j as off', (value) => {
      expect(parseEnv({ EXPO_PUBLIC_FLAG_MODERATION: value }).env.requestedFlags.moderation).toBe(
        false,
      );
    });

    it('ignores a value that is not a boolean and names the variable', () => {
      const { env, problems } = parseEnv({ EXPO_PUBLIC_FLAG_ANALYTICS: 'maybe' });
      expect(env.requestedFlags.analytics).toBe(false);
      expect(problems).toEqual(['EXPO_PUBLIC_FLAG_ANALYTICS is invalid. It was ignored.']);
    });

    it('maps each variable to its own flag', () => {
      const cases = [
        ['EXPO_PUBLIC_FLAG_REAL_APPLE_MUSIC', 'realAppleMusic'],
        ['EXPO_PUBLIC_FLAG_REAL_SPOTIFY', 'realSpotify'],
        ['EXPO_PUBLIC_FLAG_SYNC', 'sync'],
        ['EXPO_PUBLIC_FLAG_PLAYLIST_IMPORT', 'playlistImport'],
        ['EXPO_PUBLIC_FLAG_MODERATION', 'moderation'],
        ['EXPO_PUBLIC_FLAG_ANALYTICS', 'analytics'],
      ] as const;
      for (const [name, flag] of cases) {
        expect(parseEnv({ [name]: 'true' }).env.requestedFlags).toEqual({
          ...allOff,
          [flag]: true,
        });
      }
    });
  });
});

describe('readRawEnv', () => {
  it('reads every listed variable from process.env', () => {
    const names = Object.values(envNames);
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) process.env[name] = `value-of-${name}`;
      const raw = readRawEnv();
      expect(Object.keys(raw).sort()).toEqual([...names].sort());
      for (const name of names) expect(raw[name]).toBe(`value-of-${name}`);
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});
