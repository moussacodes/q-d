/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { QdMusicKit } from '..';
import { createQdMusicKit, QdMusicKitError } from './QdMusicKit';
import type { QdMusicKitNativeModule, QdMusicKitTrackRef } from './QdMusicKit.types';

const moduleRoot = join(__dirname, '..');
const apple = (id: string): QdMusicKitTrackRef => ({
  provider: 'apple_music',
  providerTrackId: id,
});
const spotify = (id: string): QdMusicKitTrackRef => ({ provider: 'spotify', providerTrackId: id });

/** The PlaybackAdapter methods from docs/API_CONTRACTS.md §5. */
const ADAPTER_METHODS = [
  'capabilities',
  'connect',
  'prepare',
  'play',
  'pause',
  'seek',
  'enqueue',
  'getState',
  'disconnect',
] as const;

function fakeNative(overrides: Partial<QdMusicKitNativeModule> = {}) {
  const native = {
    capabilities: jest.fn(() => ({
      inAppAudio: true,
      backgroundPlayback: true,
      requiresExternalApp: false,
      autoplay: false,
      isMock: false,
    })),
    connect: jest.fn(async () => ({ status: 'connected' })),
    prepare: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    seek: jest.fn(async () => {}),
    enqueue: jest.fn(async () => {}),
    getState: jest.fn(async () => ({
      status: 'playing',
      providerTrackId: '1440857781',
      positionMs: 1000,
    })),
    disconnect: jest.fn(async () => {}),
    ...overrides,
  };
  return native as typeof native & QdMusicKitNativeModule;
}

function nativeError(code: string, message = 'boom') {
  return Object.assign(new Error(message), { code });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(QdMusicKitError);
  expect((error as QdMusicKitError).code).toBe(code);
}

const NONE = {
  inAppAudio: false,
  backgroundPlayback: false,
  requiresExternalApp: false,
  autoplay: false,
  isMock: false,
};

describe('QdMusicKit without the native module (Expo Go, web, tests)', () => {
  it('the default export reports the module missing here', () => {
    expect(QdMusicKit.provider).toBe('apple_music');
    expect(QdMusicKit.availability()).toEqual({
      available: false,
      reason: expect.stringMatching(/native_module_missing|unsupported_platform/),
    });
  });

  const kit = createQdMusicKit(null, 'ios');

  it('says why it is unavailable', () => {
    expect(kit.availability()).toEqual({ available: false, reason: 'native_module_missing' });
    expect(createQdMusicKit(undefined, 'ios').availability().available).toBe(false);
  });

  it('claims no capabilities and is not a mock', () => {
    expect(kit.capabilities()).toEqual(NONE);
  });

  it('connect resolves to an unavailable error instead of throwing', async () => {
    await expect(kit.connect()).resolves.toEqual({ status: 'error', code: 'unavailable' });
  });

  it.each([
    ['prepare', () => kit.prepare(apple('1'))],
    ['play', () => kit.play()],
    ['pause', () => kit.pause()],
    ['seek', () => kit.seek(0)],
    ['enqueue', () => kit.enqueue([apple('1')])],
    ['enqueue (empty)', () => kit.enqueue([])],
    ['getState', () => kit.getState()],
  ])('%s throws unavailable, never a silent no-op', async (_name, run) => {
    await expectCode(run(), 'unavailable');
  });

  it('disconnect has nothing to undo and resolves', async () => {
    await expect(kit.disconnect()).resolves.toBeUndefined();
  });

  it('still validates input before reporting unavailable', async () => {
    await expectCode(kit.prepare(spotify('1')), 'wrong_provider');
  });
});

describe('QdMusicKit off iOS', () => {
  it.each(['web', 'android', 'macos'])(
    'is unsupported on %s even if a module exists',
    async (os) => {
      const native = fakeNative();
      const kit = createQdMusicKit(native, os);
      expect(kit.availability()).toEqual({ available: false, reason: 'unsupported_platform' });
      expect(kit.capabilities()).toEqual(NONE);
      await expect(kit.connect()).resolves.toEqual({ status: 'error', code: 'unavailable' });
      await expectCode(kit.play(), 'unavailable');
      expect(native.connect).not.toHaveBeenCalled();
      expect(native.play).not.toHaveBeenCalled();
    },
  );
});

describe('QdMusicKit with the native module', () => {
  it('is available and matches the PlaybackAdapter contract', () => {
    const kit = createQdMusicKit(fakeNative(), 'ios');
    expect(kit.availability()).toEqual({ available: true });
    for (const method of ADAPTER_METHODS) expect(typeof kit[method]).toBe('function');
  });

  describe('capabilities', () => {
    it('passes native booleans through', () => {
      const kit = createQdMusicKit(fakeNative(), 'ios');
      expect(kit.capabilities()).toEqual({ ...NONE, inAppAudio: true, backgroundPlayback: true });
    });

    it('only counts an explicit true, and is never a mock', () => {
      const native = fakeNative({
        capabilities: () => ({
          inAppAudio: 1,
          backgroundPlayback: 'yes',
          autoplay: true,
          isMock: true,
        }),
      });
      expect(createQdMusicKit(native, 'ios').capabilities()).toEqual({ ...NONE, autoplay: true });
    });

    it.each([null, 'all', [true]])('claims nothing for a native value of %p', (value) => {
      const kit = createQdMusicKit(fakeNative({ capabilities: () => value }), 'ios');
      expect(kit.capabilities()).toEqual(NONE);
    });

    it('claims nothing if the native call throws', () => {
      const native = fakeNative({
        capabilities: () => {
          throw new Error('bridge down');
        },
      });
      expect(createQdMusicKit(native, 'ios').capabilities()).toEqual(NONE);
    });
  });

  describe('connect', () => {
    it.each(['connected', 'needs_authorization', 'needs_subscription', 'app_not_installed'])(
      'passes %s through',
      async (status) => {
        const kit = createQdMusicKit(fakeNative({ connect: async () => ({ status }) }), 'ios');
        await expect(kit.connect()).resolves.toEqual({ status });
      },
    );

    it('keeps the native error code', async () => {
      const native = fakeNative({
        connect: async () => ({ status: 'error', code: 'not_implemented' }),
      });
      await expect(createQdMusicKit(native, 'ios').connect()).resolves.toEqual({
        status: 'error',
        code: 'not_implemented',
      });
    });

    it('fills in a missing error code', async () => {
      const native = fakeNative({ connect: async () => ({ status: 'error' }) });
      await expect(createQdMusicKit(native, 'ios').connect()).resolves.toEqual({
        status: 'error',
        code: 'native_error',
      });
    });

    it.each([null, 'connected', { status: 'ready' }, { status: 3 }])(
      'rejects the unknown native answer %p',
      async (value) => {
        const kit = createQdMusicKit(fakeNative({ connect: async () => value }), 'ios');
        await expect(kit.connect()).resolves.toEqual({
          status: 'error',
          code: 'invalid_native_response',
        });
      },
    );

    it('turns a native throw into an error state', async () => {
      const notBuilt = fakeNative({
        connect: async () => {
          throw nativeError('ERR_QD_NOT_IMPLEMENTED');
        },
      });
      await expect(createQdMusicKit(notBuilt, 'ios').connect()).resolves.toEqual({
        status: 'error',
        code: 'not_implemented',
      });
      const broken = fakeNative({
        connect: async () => {
          throw nativeError('ERR_SOMETHING');
        },
      });
      await expect(createQdMusicKit(broken, 'ios').connect()).resolves.toEqual({
        status: 'error',
        code: 'native_error',
      });
    });
  });

  describe('prepare', () => {
    it('sends the trimmed Apple id and a whole-millisecond start', async () => {
      const native = fakeNative();
      const kit = createQdMusicKit(native, 'ios');
      await kit.prepare(apple(' 1440857781 '), 1500.6);
      expect(native.prepare).toHaveBeenCalledWith('1440857781', 1501);
    });

    it('starts at 0 by default and never calls play', async () => {
      const native = fakeNative();
      await createQdMusicKit(native, 'ios').prepare(apple('1'));
      expect(native.prepare).toHaveBeenCalledWith('1', 0);
      expect(native.play).not.toHaveBeenCalled();
    });

    it('accepts a full ProviderTrack-shaped object', async () => {
      const native = fakeNative();
      const track = { ...apple('9'), title: 'Song', durationMs: 1000, explicit: false };
      await createQdMusicKit(native, 'ios').prepare(track);
      expect(native.prepare).toHaveBeenCalledWith('9', 0);
    });

    it('refuses a Spotify track', async () => {
      const native = fakeNative();
      await expectCode(createQdMusicKit(native, 'ios').prepare(spotify('1')), 'wrong_provider');
      expect(native.prepare).not.toHaveBeenCalled();
    });

    it.each(['', '   '])('refuses the empty id %p', async (id) => {
      const native = fakeNative();
      await expectCode(createQdMusicKit(native, 'ios').prepare(apple(id)), 'invalid_argument');
      expect(native.prepare).not.toHaveBeenCalled();
    });

    it('refuses a missing track', async () => {
      const kit = createQdMusicKit(fakeNative(), 'ios');
      await expectCode(kit.prepare(null as unknown as QdMusicKitTrackRef), 'invalid_argument');
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number])(
      'refuses the start position %p',
      async (start) => {
        const native = fakeNative();
        await expectCode(
          createQdMusicKit(native, 'ios').prepare(apple('1'), start),
          'invalid_argument',
        );
        expect(native.prepare).not.toHaveBeenCalled();
      },
    );
  });

  describe('seek', () => {
    it('sends whole milliseconds, 0 included', async () => {
      const native = fakeNative();
      const kit = createQdMusicKit(native, 'ios');
      await kit.seek(0);
      await kit.seek(61_000.4);
      expect((native.seek as jest.Mock).mock.calls).toEqual([[0], [61_000]]);
    });

    it.each([-0.5, Number.NaN, Number.NEGATIVE_INFINITY])('refuses %p', async (position) => {
      const native = fakeNative();
      await expectCode(createQdMusicKit(native, 'ios').seek(position), 'invalid_argument');
      expect(native.seek).not.toHaveBeenCalled();
    });
  });

  describe('enqueue', () => {
    it('sends ids in order, duplicates kept', async () => {
      const native = fakeNative();
      await createQdMusicKit(native, 'ios').enqueue([apple('1'), apple('2'), apple('1')]);
      expect(native.enqueue).toHaveBeenCalledWith(['1', '2', '1']);
    });

    it('skips the bridge for an empty list', async () => {
      const native = fakeNative();
      await createQdMusicKit(native, 'ios').enqueue([]);
      expect(native.enqueue).not.toHaveBeenCalled();
    });

    it('sends nothing if any track is from Spotify', async () => {
      const native = fakeNative();
      await expectCode(
        createQdMusicKit(native, 'ios').enqueue([apple('1'), spotify('2')]),
        'wrong_provider',
      );
      expect(native.enqueue).not.toHaveBeenCalled();
    });

    it('refuses a value that is not a list', async () => {
      const kit = createQdMusicKit(fakeNative(), 'ios');
      await expectCode(
        kit.enqueue(apple('1') as unknown as QdMusicKitTrackRef[]),
        'invalid_argument',
      );
    });
  });

  describe('getState', () => {
    it('passes a valid state through', async () => {
      await expect(createQdMusicKit(fakeNative(), 'ios').getState()).resolves.toEqual({
        status: 'playing',
        providerTrackId: '1440857781',
        positionMs: 1000,
      });
    });

    it.each([undefined, null, ''])('reads providerTrackId %p as nothing loaded', async (id) => {
      const native = fakeNative({
        getState: async () => ({ status: 'stopped', providerTrackId: id, positionMs: 0 }),
      });
      await expect(createQdMusicKit(native, 'ios').getState()).resolves.toEqual({
        status: 'stopped',
        providerTrackId: null,
        positionMs: 0,
      });
    });

    it.each([
      null,
      { status: 'buffering', providerTrackId: null, positionMs: 0 },
      { status: 'paused', providerTrackId: null, positionMs: -1 },
      { status: 'paused', providerTrackId: null, positionMs: Number.NaN },
      { status: 'paused', providerTrackId: null },
      { status: 'paused', providerTrackId: 42, positionMs: 0 },
    ])('rejects the native state %p', async (value) => {
      const kit = createQdMusicKit(fakeNative({ getState: async () => value }), 'ios');
      await expectCode(kit.getState(), 'invalid_native_response');
    });
  });

  describe('native failures', () => {
    it.each(['play', 'pause', 'disconnect'] as const)(
      '%s maps ERR_QD_NOT_IMPLEMENTED',
      async (method) => {
        const native = fakeNative({
          [method]: async () => {
            throw nativeError('ERR_QD_NOT_IMPLEMENTED', `${method} not built`);
          },
        });
        const error = await createQdMusicKit(native, 'ios')
          [method]()
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(QdMusicKitError);
        expect(error).toMatchObject({ code: 'not_implemented', message: `${method} not built` });
      },
    );

    it('maps any other native error to native_error', async () => {
      const native = fakeNative({
        pause: async () => {
          throw nativeError('ERR_MUSICKIT');
        },
      });
      await expectCode(createQdMusicKit(native, 'ios').pause(), 'native_error');
    });

    it('handles a thrown non-Error value', async () => {
      const native = fakeNative({
        play: async () => {
          throw 'nope';
        },
      });
      const error = await createQdMusicKit(native, 'ios')
        .play()
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'native_error', message: 'MusicKit call failed' });
    });

    it('calls play and pause on the native player', async () => {
      const native = fakeNative();
      const kit = createQdMusicKit(native, 'ios');
      await kit.play();
      await kit.pause();
      await kit.disconnect();
      expect(native.play).toHaveBeenCalledTimes(1);
      expect(native.pause).toHaveBeenCalledTimes(1);
      expect(native.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});

describe('the Swift stub matches the JavaScript side', () => {
  const swift = readFileSync(join(moduleRoot, 'ios', 'QdMusicKitModule.swift'), 'utf8');
  const index = readFileSync(join(moduleRoot, 'index.ts'), 'utf8');
  const config = JSON.parse(readFileSync(join(moduleRoot, 'expo-module.config.json'), 'utf8'));

  it('declares every native method the wrapper calls', () => {
    const declared = [...swift.matchAll(/(?:Async)?Function\("(\w+)"\)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...ADAPTER_METHODS].sort());
  });

  it('keeps capabilities synchronous and everything else async', () => {
    expect(swift).toMatch(/[^c]Function\("capabilities"\)/);
    for (const method of ADAPTER_METHODS.filter((m) => m !== 'capabilities')) {
      expect(swift).toContain(`AsyncFunction("${method}")`);
    }
  });

  it('claims no capabilities until playback is built', () => {
    expect(swift).not.toMatch(/"(inAppAudio|backgroundPlayback|autoplay|isMock)": true/);
  });

  it('uses the native name the wrapper asks for', () => {
    expect(swift).toContain('Name("QdMusicKit")');
    expect(index).toContain("requireOptionalNativeModule<QdMusicKitNativeModule>('QdMusicKit')");
  });

  it('throws the error code the wrapper maps', () => {
    expect(swift).toContain('"ERR_QD_NOT_IMPLEMENTED"');
  });

  it('is autolinked as an Apple-only module with the Swift class name', () => {
    expect(config).toEqual({ platforms: ['apple'], apple: { modules: ['QdMusicKitModule'] } });
    expect(swift).toContain('public class QdMusicKitModule: Module');
  });
});
