/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { createQdMusicKit, QdMusicKitError } from './QdMusicKit';
import type { QdMusicKitNativeModule } from './QdMusicKit.types';

// The authorization, subscription and storefront calls the Apple Music
// connection card added to the TypeScript side. The Swift skeleton doesn't
// have them yet, so they must say `not_implemented`, never pretend.

const base = (): QdMusicKitNativeModule => ({
  capabilities: () => ({}),
  connect: async () => ({ status: 'error', code: 'not_implemented' }),
  prepare: async () => {},
  play: async () => {},
  pause: async () => {},
  seek: async () => {},
  enqueue: async () => {},
  getState: async () => ({ status: 'stopped', providerTrackId: null, positionMs: 0 }),
  disconnect: async () => {},
});

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(QdMusicKitError);
  return (error as QdMusicKitError).code;
}

const calls = [
  'authorizationStatus',
  'requestAuthorization',
  'subscription',
  'storefront',
] as const;

describe.each(calls)('%s', (call) => {
  it('is `unavailable` without the native module', async () => {
    expect(await codeOf(createQdMusicKit(null, 'ios')[call]())).toBe('unavailable');
    expect(await codeOf(createQdMusicKit(base(), 'web')[call]())).toBe('unavailable');
  });

  it('is `not_implemented` while the Swift side lacks it (today’s skeleton)', async () => {
    expect(await codeOf(createQdMusicKit(base(), 'ios')[call]())).toBe('not_implemented');
  });
});

describe('authorization status', () => {
  it.each([
    ['authorized', 'authorized'],
    ['denied', 'denied'],
    ['restricted', 'restricted'],
    ['notDetermined', 'not_determined'],
    ['not_determined', 'not_determined'],
  ])('maps %s to %s, asking or not', async (raw, expected) => {
    const kit = createQdMusicKit(
      { ...base(), authorizationStatus: async () => raw, requestAuthorization: async () => raw },
      'ios',
    );
    expect(await kit.authorizationStatus()).toBe(expected);
    expect(await kit.requestAuthorization()).toBe(expected);
  });

  it.each([['maybe'], [null], [1], [{ status: 'authorized' }]])(
    'refuses an unknown answer %p',
    async (raw) => {
      const kit = createQdMusicKit({ ...base(), authorizationStatus: async () => raw }, 'ios');
      expect(await codeOf(kit.authorizationStatus())).toBe('invalid_native_response');
    },
  );

  it('maps a native failure', async () => {
    const kit = createQdMusicKit(
      {
        ...base(),
        requestAuthorization: async () => {
          throw Object.assign(new Error('x'), { code: 'ERR_SOMETHING' });
        },
      },
      'ios',
    );
    expect(await codeOf(kit.requestAuthorization())).toBe('native_error');
  });
});

describe('subscription', () => {
  it('passes the two booleans through', async () => {
    const kit = createQdMusicKit(
      {
        ...base(),
        subscriptionStatus: async () => ({
          canPlayCatalogContent: true,
          canBecomeSubscriber: false,
        }),
      },
      'ios',
    );
    expect(await kit.subscription()).toEqual({
      canPlayCatalogContent: true,
      canBecomeSubscriber: false,
    });
  });

  it.each([[null], [{}], [{ canPlayCatalogContent: 'yes', canBecomeSubscriber: false }]])(
    'refuses %p',
    async (raw) => {
      const kit = createQdMusicKit({ ...base(), subscriptionStatus: async () => raw }, 'ios');
      expect(await codeOf(kit.subscription())).toBe('invalid_native_response');
    },
  );
});

describe('storefront', () => {
  it.each([
    ['us', 'us'],
    [' GB ', 'gb'],
    ['usa', null],
    ['', null],
    [null, null],
    [42, null],
  ])('%p → %p', async (raw, expected) => {
    const kit = createQdMusicKit({ ...base(), storefront: async () => raw }, 'ios');
    expect(await kit.storefront()).toBe(expected);
  });
});

it('the Swift skeleton still lacks these methods, so the README must list them for Moussa', () => {
  const root = join(__dirname, '..');
  const swift = readFileSync(join(root, 'ios', 'QdMusicKitModule.swift'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  for (const name of [
    'authorizationStatus',
    'requestAuthorization',
    'subscriptionStatus',
    'storefront',
  ]) {
    if (!swift.includes(`AsyncFunction("${name}")`)) expect(readme).toContain(`\`${name}\``);
  }
});
