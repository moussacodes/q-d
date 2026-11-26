import {
  authMode,
  dataMode,
  isLiveAuth,
  isMockMode,
  LIVE_DATA_AVAILABLE,
  resolveAuthMode,
  resolveDataMode,
} from './dataMode';

const supabase = { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_x' };

describe('resolveDataMode', () => {
  it('uses mock when mock is asked for, with no warning', () => {
    expect(resolveDataMode({ requestedDataMode: 'mock', supabase: null })).toEqual({
      mode: 'mock',
      fallbackReason: null,
    });
    expect(resolveDataMode({ requestedDataMode: 'mock', supabase }, true).mode).toBe('mock');
  });

  it('falls back to mock and names the missing variables when live has no Supabase', () => {
    const decision = resolveDataMode({ requestedDataMode: 'live', supabase: null }, true);
    expect(decision.mode).toBe('mock');
    expect(decision.fallbackReason).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(decision.fallbackReason).toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(decision.fallbackReason).toContain('labels it as mock');
  });

  it('falls back to mock for a build without a live data layer', () => {
    const decision = resolveDataMode({ requestedDataMode: 'live', supabase }, false);
    expect(decision.mode).toBe('mock');
    expect(decision.fallbackReason).toContain("isn't available yet");
  });

  it('has a live data layer since the live room card', () => {
    expect(LIVE_DATA_AVAILABLE).toBe(true);
    expect(resolveDataMode({ requestedDataMode: 'live', supabase }).mode).toBe('live');
  });

  it('uses live only when asked, configured and available', () => {
    expect(resolveDataMode({ requestedDataMode: 'live', supabase }, true)).toEqual({
      mode: 'live',
      fallbackReason: null,
    });
  });

  it('never puts the key or URL in the reason', () => {
    for (const available of [true, false]) {
      const { fallbackReason } = resolveDataMode(
        { requestedDataMode: 'live', supabase: available ? supabase : null },
        false,
      );
      expect(fallbackReason).not.toContain(supabase.url);
      expect(fallbackReason).not.toContain(supabase.publishableKey);
    }
  });
});

describe('this run', () => {
  it('is in mock mode with no environment', () => {
    expect(dataMode).toBe('mock');
    expect(isMockMode).toBe(true);
  });
});

describe('module start-up', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('warns once per problem in development and still runs on mock', () => {
    process.env.EXPO_PUBLIC_DATA_MODE = 'live';
    process.env.EXPO_PUBLIC_FLAG_SYNC = 'true';
    process.env.EXPO_PUBLIC_FLAG_ANALYTICS = 'sometimes';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => {
      const mode = jest.requireActual<typeof import('./dataMode')>('./dataMode');
      const flagModule = jest.requireActual<typeof import('./flags')>('./flags');
      expect(mode.dataMode).toBe('mock');
      expect(flagModule.flags.sync).toBe(false);
      expect(flagModule.flags.analytics).toBe(false);
    });
    const messages = warn.mock.calls.map(([message]) => message as string);
    expect(messages).toEqual([
      '[env] EXPO_PUBLIC_FLAG_ANALYTICS is invalid. It was ignored.',
      expect.stringContaining('[env] EXPO_PUBLIC_DATA_MODE=live needs'),
      "[flags] EXPO_PUBLIC_FLAG_SYNC is ignored: sync (beta) is private and can't be enabled.",
    ]);
  });

  it('is silent with no environment', () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('EXPO_PUBLIC_')) delete process.env[key];
    }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => {
      jest.requireActual('./dataMode');
      jest.requireActual('./flags');
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveAuthMode', () => {
  it('signs in with the mock session unless live is asked for', () => {
    expect(resolveAuthMode({ requestedDataMode: 'mock', supabase: null })).toBe('mock');
    expect(resolveAuthMode({ requestedDataMode: 'mock', supabase })).toBe('mock');
  });

  it('stays mock when live has no Supabase settings', () => {
    expect(resolveAuthMode({ requestedDataMode: 'live', supabase: null })).toBe('mock');
  });

  it('uses Supabase Auth when live is asked for and Supabase is configured', () => {
    expect(resolveAuthMode({ requestedDataMode: 'live', supabase })).toBe('live');
  });

  it('is mock for this run, with no environment', () => {
    expect(authMode).toBe('mock');
    expect(isLiveAuth).toBe(false);
  });
});
