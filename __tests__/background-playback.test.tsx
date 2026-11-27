/// <reference types="node" />
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { AppState, type AppStateStatus } from 'react-native';

import { MockPlaybackAdapter } from '@/providers/mock/playback';
import { fillEmailForm } from '@/test/emailForm';

// Background playback with the screen locked (Forge card). The audio side is
// native (MusicKit's ApplicationMusicPlayer plus the `audio` background mode,
// checked in __tests__/app-config.test.ts). What JavaScript must not do is
// pause the host's music when the app goes to the background: Realtime and
// token refresh may stop, playback may not.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

let appStateListeners: ((state: AppStateStatus) => void)[];

beforeEach(() => {
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    const watcher = listener as (state: AppStateStatus) => void;
    if (type === 'change') appStateListeners.push(watcher);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((l) => l !== watcher);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

it('the host’s music keeps playing when the app goes to the background, long past the 30 s grace', async () => {
  const pause = jest.spyOn(MockPlaybackAdapter.prototype, 'pause');
  const disconnect = jest.spyOn(MockPlaybackAdapter.prototype, 'disconnect');
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await fillEmailForm();
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
  await act(async () => {
    router.push({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
  });
  // The host's phone is playing.
  expect(await screen.findByLabelText('Pause')).toBeEnabled();
  pause.mockClear();
  disconnect.mockClear();

  // The app does watch AppState (query focus), so the background change reaches it.
  expect(appStateListeners.length).toBeGreaterThan(0);
  // Screen locked: iOS moves the app to inactive, then background.
  await act(async () => {
    for (const state of ['inactive', 'background'] as const) {
      appStateListeners.forEach((listener) => listener(state));
    }
  });
  await act(async () => {
    jest.advanceTimersByTime(5 * 60_000);
  });

  expect(pause).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
  expect(screen.queryByText('Host reconnecting')).toBeNull();

  // Unlocked again: still playing, nothing to resume.
  await act(async () => {
    appStateListeners.forEach((listener) => listener('active'));
  });
  expect(screen.getByLabelText('Pause')).toBeEnabled();
});

/**
 * Only these files may watch AppState, and neither touches playback:
 * Supabase token refresh (stops in the background) and TanStack Query's
 * focus manager (refetches on return). A new AppState watcher in a feature
 * or provider has to be checked for pausing playback first.
 */
const APP_STATE_WATCHERS = ['src/services/queryClient.ts', 'src/services/supabase.ts'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The code without comments, so a comment that mentions AppState or pause() doesn't trip this. */
const codeOf = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

it('nothing else in the app watches AppState, so nothing pauses playback on background', () => {
  const root = join(__dirname, '..');
  const watchers = ['src', 'app', 'modules']
    .flatMap((dir) => sourceFiles(join(root, dir)))
    .filter((file) => /\bAppState\b/.test(codeOf(file)))
    .map((file) => file.slice(root.length + 1).replace(/\\/g, '/'))
    .sort();
  expect(watchers).toEqual(APP_STATE_WATCHERS);
  for (const file of APP_STATE_WATCHERS) {
    expect(codeOf(join(root, file))).not.toMatch(/\b(pause|disconnect|hold)\(/);
  }
});

it('the guard ignores comments but still sees code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qd-appstate-'));
  const commented = join(dir, 'commented.ts');
  const used = join(dir, 'used.ts');
  writeFileSync(commented, '// AppState could pause() here\n/* AppState */ export const a = 1;\n');
  writeFileSync(used, "import { AppState } from 'react-native';\nAppState.currentState;\n");
  expect(codeOf(commented)).not.toMatch(/\bAppState\b|pause\(/);
  expect(codeOf(used)).toMatch(/\bAppState\b/);
  rmSync(dir, { recursive: true, force: true });
});
