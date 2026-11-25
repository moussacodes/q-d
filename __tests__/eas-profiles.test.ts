/// <reference types="node" />
/**
 * eas.json invariants (Forge card "EAS build profiles").
 *
 * EAS itself needs a logged-in teammate, so this test checks what we can check
 * offline: the three profiles exist and do what their names say, the build is
 * iOS only, nothing secret sits in the file, and generated native folders and
 * local EAS credentials stay out of git.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import appConfig from '../app.config';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Profile = { [key: string]: Json } & { extends?: string; env?: Record<string, string> };

const root = join(__dirname, '..');
const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8')) as {
  cli: { version: string; appVersionSource?: string };
  build: Record<string, Profile>;
  submit?: Record<string, { [key: string]: Json }>;
};
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

/** Resolve `extends` the way EAS does: parent first, env merged, child wins. */
function resolve(name: string, seen: string[] = []): Profile {
  const profile = eas.build[name];
  if (!profile) throw new Error(`Unknown build profile "${name}"`);
  if (seen.includes(name)) throw new Error(`extends cycle: ${[...seen, name].join(' → ')}`);
  if (!profile.extends) return profile;
  const parent = resolve(profile.extends, [...seen, name]);
  const { extends: _ignored, ...own } = profile;
  return { ...parent, ...own, env: { ...parent.env, ...own.env } };
}

/** Every key path in a JSON value, for "no android anywhere" style checks. */
function keyPaths(value: Json, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...keyPaths(child, path)];
  });
}

function stringValues(value: Json): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(stringValues);
}

function gitIgnores(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

const PROFILES = ['development', 'preview', 'production'] as const;

describe('eas.json build profiles', () => {
  it('defines development, preview and production', () => {
    for (const name of PROFILES) expect(eas.build[name]).toBeDefined();
  });

  it('resolves every extends chain without unknown parents or cycles', () => {
    for (const name of Object.keys(eas.build)) expect(() => resolve(name)).not.toThrow();
  });

  it('development is an internal dev-client build', () => {
    const dev = resolve('development');
    expect(dev.developmentClient).toBe(true);
    expect(dev.distribution).toBe('internal');
  });

  it('development has expo-dev-client installed to build against', () => {
    expect(pkg.dependencies['expo-dev-client']).toBeDefined();
  });

  it('preview is an internal release build, not a dev client', () => {
    const preview = resolve('preview');
    expect(preview.distribution).toBe('internal');
    expect(preview.developmentClient).not.toBe(true);
  });

  it('production goes to the store (TestFlight) and bumps the build number', () => {
    const production = resolve('production');
    expect(production.distribution).toBe('store');
    expect(production.developmentClient).not.toBe(true);
    expect(production.autoIncrement).toBe(true);
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it('pins the same Node version as CI and the engines floor', () => {
    for (const name of PROFILES) expect(resolve(name).node).toBe('22.13.0');
  });

  it('is iOS only: no Android settings anywhere', () => {
    const paths = keyPaths(eas as unknown as Json);
    expect(paths.filter((p) => /(^|\.)android(\.|$)/.test(p))).toEqual([]);
    expect((appConfig as { android?: unknown }).android).toBeUndefined();
  });

  it('builds the app.qd.mobile bundle', () => {
    expect(appConfig.ios?.bundleIdentifier).toBe('app.qd.mobile');
  });
});

describe('eas.json env and secrets', () => {
  it('labels each profile with its own app env', () => {
    for (const name of PROFILES) expect(resolve(name).env?.EXPO_PUBLIC_APP_ENV).toBe(name);
  });

  it('keeps every profile on mock data until the live data mode exists', () => {
    for (const name of PROFILES) expect(resolve(name).env?.EXPO_PUBLIC_DATA_MODE).toBe('mock');
  });

  it('only sets public EXPO_PUBLIC_* names, with short plain values', () => {
    for (const name of Object.keys(eas.build)) {
      for (const [key, value] of Object.entries(resolve(name).env ?? {})) {
        expect(key).toMatch(/^EXPO_PUBLIC_[A-Z0-9_]+$/);
        expect(value).toMatch(/^[a-z0-9_-]{1,32}$/);
      }
    }
  });

  it('names no secret-looking variables', () => {
    const names = Object.keys(eas.build).flatMap((n) => Object.keys(resolve(n).env ?? {}));
    for (const key of names) expect(key).not.toMatch(/TOKEN|SECRET|PASSWORD|PRIVATE|_KEY$|KEY_/);
  });

  it('contains no token-, key- or email-shaped strings', () => {
    for (const value of stringValues(eas as unknown as Json)) {
      expect(value).not.toMatch(/@[\w-]+\.[a-z]{2,}/i); // email (e.g. an Apple ID)
      expect(value).not.toMatch(/^ey[A-Za-z0-9_-]{10,}\./); // JWT
      expect(value).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      expect(value).not.toMatch(/[A-Za-z0-9+/_-]{32,}/); // long opaque token
    }
  });

  it('points at no credential files and no Apple account details', () => {
    const forbidden =
      /credentialsSource|ascApiKeyPath|ascApiKeyId|ascApiKeyIssuerId|appleId|serviceAccountKeyPath|appleTeamId/;
    for (const path of keyPaths(eas as unknown as Json)) expect(path).not.toMatch(forbidden);
  });
});

describe('repository hygiene for native builds', () => {
  it.each(['ios', 'ios/Podfile', 'android', 'android/build.gradle'])(
    'ignores generated %s',
    (path) => {
      expect(gitIgnores(path)).toBe(true);
    },
  );

  it.each(['credentials.json', 'credentials/ios/dist.p12', '.env', 'AuthKey_ABC.p8'])(
    'ignores local secret %s',
    (path) => {
      expect(gitIgnores(path)).toBe(true);
    },
  );

  it('does not ignore eas.json itself', () => {
    expect(gitIgnores('eas.json')).toBe(false);
  });

  it('tracks nothing under ios/ or android/ and no credentials.json', () => {
    const tracked = execFileSync('git', ['ls-files', 'ios', 'android', 'credentials.json'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(tracked.trim()).toBe('');
    expect(existsSync(join(root, 'credentials.json'))).toBe(false);
  });
});

describe('npm scripts with expo-dev-client installed', () => {
  // With expo-dev-client installed, a bare `expo start` targets the dev client.
  // Baron reviews in Expo Go, so start and ios ask for it explicitly.
  it('npm start and npm run ios still open Expo Go', () => {
    expect(pkg.scripts.start).toMatch(/--go\b/);
    expect(pkg.scripts.ios).toMatch(/--go\b/);
  });

  it('has a separate script for the development build', () => {
    expect(pkg.scripts['start:dev-client']).toMatch(/--dev-client\b/);
  });
});
